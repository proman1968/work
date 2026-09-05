/**
 * 1C — клиент штатного OData-интерфейса информационной базы (только чтение).
 *
 * baseUrl — корень публикации ИБ; к нему дописывается /odata/standard.odata.
 * login / password — Basic-auth.
 *
 * SCHEMA — описание методов для ИИ (function calling).
 */
const ODATA_SUFFIX = '/odata/standard.odata';
const DEFAULT_TOP = 20;
const MAX_TOP = 100;
const TIMEOUT_MS = 15000;

function odataRoot(svc) {
    const base = String(svc.baseUrl || '').trim().replace(/\/$/, '');
    if (!base)
        return '';
    if (/\/odata\/standard\.odata$/i.test(base))
        return base;
    return base + ODATA_SUFFIX;
}

function authHeaders(svc) {
    const headers = { Accept: 'application/json' };
    const login = String(svc.login || '').trim();
    const password = String(svc.password || '');
    if (login)
        headers.Authorization = 'Basic ' + Buffer.from(login + ':' + password, 'utf8').toString('base64');
    return headers;
}

function odataErrorMessage(status, data) {
    const oerr = data?.['odata.error'] || data?.error;
    const msg = oerr?.message?.value || oerr?.message || oerr?.code;
    if (msg)
        return String(msg);
    return '1C OData HTTP ' + status;
}

async function request(svc, path, qs = {}) {
    const root = odataRoot(svc);
    if (!root)
        return { error: 'нужен baseUrl публикации 1С' };

    const url = new URL(root + (path.startsWith('/') ? path : '/' + path));
    for (const [key, val] of Object.entries(qs)) {
        if (val == null || val === '')
            continue;
        url.searchParams.set(key, String(val));
    }

    try {
        const response = await fetch(url, {
            headers: authHeaders(svc),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                if (!response.ok)
                    return { error: odataErrorMessage(response.status, null) };
                data = { raw: text };
            }
        }
        if (!response.ok)
            return { error: odataErrorMessage(response.status, data) };
        return { data };
    } catch (e) {
        return { error: e.message || '1C OData' };
    }
}

/** EntitySet из EDMX $metadata */
function parseEntitySets(xml) {
    const out = [];
    const seen = new Set();
    const re = /<EntitySet\b[^>]*\bName\s*=\s*"([^"]+)"[^>]*>/gi;
    let m;
    while ((m = re.exec(xml))) {
        const name = String(m[1] || '').trim();
        if (!name || seen.has(name))
            continue;
        seen.add(name);
        out.push(name);
    }
    out.sort((a, b) => a.localeCompare(b, 'ru'));
    return out;
}

function encodeEntity(entity) {
    return String(entity || '').trim().split('/').map(encodeURIComponent).join('/');
}

function guidKey(key) {
    const raw = String(key || '').trim();
    const m = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : raw;
}

export default {
    icon: 'carbon:data-base',
    description: 'Чтение данных 1С через штатный OData',

    capabilities: ['1c', 'odata'],

    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'baseUrl',
                type: 'String',
                placeholder: 'https://1c.example/base',
            }, {
                id: 'login',
                type: 'String',
                placeholder: 'пользователь 1С',
            }, {
                id: 'password',
                type: 'String',
                placeholder: 'пароль',
            }],
        },
    },

    SCHEMA: {
        list_entities: {
            description: 'Список EntitySet информационной базы 1С (Catalog_*, Document_* и др.) из $metadata. Вызови перед query/get.',
            params: {
                type: 'object',
                properties: {},
            },
        },
        query: {
            description: 'Выборка записей OData EntitySet. Имя сущности — как в list_entities (например Catalog_Номенклатура).',
            params: {
                type: 'object',
                properties: {
                    entity: { type: 'string', description: 'Имя EntitySet' },
                    filter: { type: 'string', description: 'OData $filter' },
                    select: { type: 'string', description: 'OData $select (поля через запятую)' },
                    top: { type: 'number', description: 'Лимит записей (по умолчанию 20, макс. 100)' },
                    skip: { type: 'number', description: 'OData $skip' },
                    orderby: { type: 'string', description: 'OData $orderby' },
                },
                required: ['entity'],
            },
        },
        get: {
            description: 'Одна запись EntitySet по Ref_Key (GUID).',
            params: {
                type: 'object',
                properties: {
                    entity: { type: 'string', description: 'Имя EntitySet' },
                    key: { type: 'string', description: 'Ref_Key (GUID)' },
                },
                required: ['entity', 'key'],
            },
        },
    },

    /** Контракт: { source, entities[] } */
    async list_entities() {
        const root = odataRoot(this);
        if (!root)
            return { error: 'нужен baseUrl публикации 1С' };

        try {
            const response = await fetch(root + '/$metadata', {
                headers: {
                    ...authHeaders(this),
                    Accept: 'application/xml, application/xml;odata=verbose, text/xml, */*',
                },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const xml = await response.text();
            if (!response.ok)
                return { error: '1C $metadata HTTP ' + response.status };
            const entities = parseEntitySets(xml);
            if (!entities.length)
                return { error: 'EntitySet не найдены в $metadata' };
            return { source: '1C', entities };
        } catch (e) {
            return { error: e.message || '1C $metadata' };
        }
    },

    /** Контракт: { source, entity, value[] } */
    async query(params = {}) {
        const entity = String(params.entity || '').trim();
        if (!entity)
            return { error: 'нужен entity' };

        let top = Number(params.top);
        if (!Number.isFinite(top) || top <= 0)
            top = DEFAULT_TOP;
        top = Math.min(Math.floor(top), MAX_TOP);

        const qs = { $top: top, $format: 'json' };
        if (params.filter)
            qs.$filter = String(params.filter).trim();
        if (params.select)
            qs.$select = String(params.select).trim();
        if (params.orderby)
            qs.$orderby = String(params.orderby).trim();
        const skip = Number(params.skip);
        if (Number.isFinite(skip) && skip > 0)
            qs.$skip = Math.floor(skip);

        const res = await request(this, '/' + encodeEntity(entity), qs);
        if (res.error)
            return { error: res.error, entity };

        const value = Array.isArray(res.data?.value) ? res.data.value
            : Array.isArray(res.data) ? res.data
                : res.data ? [res.data] : [];
        return { source: '1C', entity, value };
    },

    /** Контракт: { source, entity, key, value } */
    async get(params = {}) {
        const entity = String(params.entity || '').trim();
        const key = guidKey(params.key);
        if (!entity)
            return { error: 'нужен entity' };
        if (!key)
            return { error: 'нужен key (Ref_Key)', entity };

        const path = '/' + encodeEntity(entity) + '(guid\'' + key + '\')';
        const res = await request(this, path, { $format: 'json' });
        if (res.error)
            return { error: res.error, entity, key };

        const value = res.data?.value ?? res.data;
        if (value == null)
            return { error: 'запись не найдена', entity, key };
        return { source: '1C', entity, key, value };
    },
};
