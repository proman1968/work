/**
 * 1С:Предприятие (OData) — интеграция с типовыми конфигурациями 1С
 * (1С:Бухгалтерия 3.0, 1С:УНФ, 1С:Управление торговлей 11, 1С:КА, 1С:ERP)
 * через стандартный REST-интерфейс OData (`/odata/standard.odata`).
 *
 * Настройка подключения:
 *  - `baseUrl`: адрес опубликованной базы 1С, например `http://localhost/buh/odata/standard.odata`;
 *  - учётные данные: в `#secret/1c.json` (`{ "url": "...", "user": "Администратор", "password": "..." }`)
 *    или `apiKey` (Basic-строка `user:password` / Bearer).
 */

async function resolve1CConfig(service) {
    let sec = null;
    try {
        sec = await service.read_secret({ filename: '1c.json' });
    }
    catch { /* ignore */ }
    let baseUrl = String(sec?.url || sec?.baseUrl || service?.baseUrl || service?.DATA?.baseUrl || '').trim();
    if (baseUrl && !/\/odata\/standard\.odata\/?$/i.test(baseUrl))
        baseUrl = baseUrl.replace(/\/+$/, '') + '/odata/standard.odata';
    baseUrl = baseUrl.replace(/\/+$/, '');

    const user = String(sec?.user || sec?.username || '').trim();
    const password = String(sec?.password ?? '');
    const apiKey = String(sec?.token || service?.apiKey || service?.DATA?.apiKey || '').trim();

    let authHeader = '';
    if (user) {
        authHeader = 'Basic ' + Buffer.from(`${user}:${password}`, 'utf8').toString('base64');
    }
    else if (apiKey && !apiKey.startsWith('secret:')) {
        authHeader = apiKey.includes(':')
            ? 'Basic ' + Buffer.from(apiKey, 'utf8').toString('base64')
            : (apiKey.startsWith('Basic ') || apiKey.startsWith('Bearer ') ? apiKey : `Basic ${apiKey}`);
    }
    return { baseUrl, authHeader };
}

async function odataRequest(service, relPath = '', { method = 'GET', query = {}, body = null } = {}) {
    const { baseUrl, authHeader } = await resolve1CConfig(service);
    if (!baseUrl || baseUrl.includes('example.com')) {
        return {
            notConfigured: true,
            hint: 'Укажите адрес публикации OData вашей базы 1С в поле baseUrl сервиса /SERVICES/1C (например http://1c-server/buh/odata/standard.odata) и учётные данные в #secret/1c.json ({ "user": "...", "password": "..." }).',
        };
    }
    const qs = new URLSearchParams({ $format: 'json', ...query });
    const sep = relPath.startsWith('/') ? '' : '/';
    const url = `${baseUrl}${relPath ? sep + relPath : ''}?${qs.toString()}`;
    const headers = {
        Accept: 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
        ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    };
    const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
    });
    const raw = await res.text();
    if (!res.ok)
        return { error: `1С OData HTTP ${res.status}: ${raw.slice(0, 300)}` };
    try {
        return JSON.parse(raw);
    }
    catch {
        return { raw: raw.slice(0, 2000) };
    }
}

export default {
    icon: 'carbon:data-share',
    label: '1С:Предприятие (OData)',
    description: 'Обмен справочниками, контрагентами, номенклатурой и документами с 1С:Бухгалтерия / УНФ / УТ / ERP через стандартный REST-интерфейс OData',
    baseUrl: '',
    apiKey: '',
    capabilities: ['1c', 'erp', 'odata', 'accounting'],
    enabled: true,

    SCHEMA: {
        list_entities: {
            readonly: true,
            description: 'Получить список опубликованных в 1С справочников (Catalog_*), документов (Document_*), планов счетов и регистров (InformationRegister_*, AccumulationRegister_*).',
            params: {
                type: 'object',
                properties: {
                    filter: { type: 'string', description: 'Фильтр по названию коллекции (например "Контрагенты", "Номенклатура", "Реализация")' },
                },
            },
        },
        query_entities: {
            readonly: true,
            description: 'Выбрать объекты из справочника, документа или регистра 1С по протоколу OData ($filter, $select, $top, $orderby).',
            params: {
                type: 'object',
                properties: {
                    entity: { type: 'string', description: 'Имя коллекции OData в 1С, например "Catalog_Контрагенты", "Catalog_Номенклатура" или "Document_РеализацияТоваровУслуг"' },
                    filter: { type: 'string', description: 'Выражение OData $filter, например "ИНН eq \'7707083893\' and DeletionMark eq false"' },
                    select: { type: 'string', description: 'Поля через запятую ($select), например "Ref_Key,Code,Description,ИНН,КПП"' },
                    orderby: { type: 'string', description: 'Сортировка ($orderby), например "Date desc"' },
                    top: { type: 'number', description: 'Максимальное количество записей ($top, по умолчанию 25)' },
                },
                required: ['entity'],
            },
        },
        get_counterparty_by_inn: {
            readonly: true,
            description: 'Найти контрагента в справочнике Catalog_Контрагенты базы 1С по ИНН.',
            params: {
                type: 'object',
                properties: {
                    inn: { type: 'string', description: 'ИНН контрагента (10 или 12 цифр)' },
                },
                required: ['inn'],
            },
        },
        create_entity: {
            readonly: false,
            description: 'Создать новый элемент справочника или документ в 1С через POST /odata/standard.odata/<entity>.',
            params: {
                type: 'object',
                properties: {
                    entity: { type: 'string', description: 'Имя коллекции OData в 1С, например "Catalog_Контрагенты"' },
                    data: { type: 'object', description: 'Поля создаваемого объекта 1С в формате JSON' },
                },
                required: ['entity', 'data'],
            },
        },
    },

    async list_entities(params = {}) {
        try {
            const res = await odataRequest(this, '');
            if (res?.notConfigured || res?.error)
                return res;
            const sets = (res?.value || []).map(v => ({
                name: v.name || v.url,
                kind: v.kind || 'EntitySet',
            }));
            const q = String(params.filter || '').trim().toLowerCase();
            const filtered = q ? sets.filter(s => String(s.name).toLowerCase().includes(q)) : sets;
            return {
                source: '1C OData',
                total: filtered.length,
                entities: filtered.slice(0, 100),
            };
        }
        catch (e) {
            return { error: String(e?.message || e) };
        }
    },

    async query_entities(params = {}) {
        const entity = String(params.entity || '').trim();
        if (!entity)
            return { error: 'query_entities: укажите имя коллекции entity (например Catalog_Контрагенты)' };
        const top = Math.min(Math.max(Number(params.top) || 25, 1), 200);
        const query = { $top: String(top) };
        if (params.filter) query.$filter = String(params.filter).trim();
        if (params.select) query.$select = String(params.select).trim();
        if (params.orderby) query.$orderby = String(params.orderby).trim();

        try {
            const res = await odataRequest(this, encodeURI(entity), { query });
            if (res?.notConfigured || res?.error)
                return res;
            const items = Array.isArray(res?.value) ? res.value : [];
            return {
                source: '1C OData',
                entity,
                count: items.length,
                items,
            };
        }
        catch (e) {
            return { error: String(e?.message || e) };
        }
    },

    async get_counterparty_by_inn(params = {}) {
        const inn = String(params.inn || '').replace(/\D+/g, '');
        if (!inn)
            return { error: 'get_counterparty_by_inn: укажите ИНН' };
        return this.query_entities({
            entity: 'Catalog_Контрагенты',
            filter: `ИНН eq '${inn}' and DeletionMark eq false`,
            select: 'Ref_Key,Code,Description,НаименованиеПолное,ИНН,КПП,ЮрФизЛицо',
            top: 10,
        });
    },

    async create_entity(params = {}) {
        const entity = String(params.entity || '').trim();
        const data = params.data;
        if (!entity || !data || typeof data !== 'object')
            return { error: 'create_entity: укажите entity и объект data' };
        try {
            const res = await odataRequest(this, encodeURI(entity), {
                method: 'POST',
                body: data,
            });
            return res;
        }
        catch (e) {
            return { error: String(e?.message || e) };
        }
    },
};
