/**
 * YandexDisk — интеграция с облачным хранилищем «Яндекс 360 / Яндекс.Диск»
 * через официальный REST API `https://cloud-api.yandex.net/v1/disk`.
 *
 * Настройка:
 *  - укажите OAuth-токен Яндекс.Диска в `#secret/yandex_disk.json` (`{ "token": "y0_..." }`)
 *    или в поле `apiKey` сервиса `/SERVICES/YandexDisk`.
 */
const YADISK_API = 'https://cloud-api.yandex.net/v1/disk';

async function resolveYaDiskToken(service) {
    try {
        const sec = await service.read_secret({ filename: 'yandex_disk.json' });
        if (sec?.token || sec?.apiKey)
            return String(sec.token || sec.apiKey).trim();
    }
    catch { /* ignore */ }
    const direct = String(service?.apiKey || service?.DATA?.apiKey || '').trim();
    if (direct && !direct.startsWith('secret:'))
        return direct;
    return '';
}

async function yaDiskFetch(service, endpoint, { method = 'GET', query = {}, body = null, headers = {} } = {}) {
    const token = await resolveYaDiskToken(service);
    if (!token) {
        return {
            notConfigured: true,
            hint: 'Укажите OAuth-токен Яндекс.Диска в #secret/yandex_disk.json ({ "token": "y0_..." }) или в поле apiKey сервиса /SERVICES/YandexDisk.',
        };
    }
    const base = String(service?.baseUrl || YADISK_API).replace(/\/+$/, '');
    const qs = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
    const url = `${base}${endpoint}${qs}`;
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `OAuth ${token}`,
            Accept: 'application/json',
            ...headers,
        },
        body,
        signal: AbortSignal.timeout(15000),
    });
    if (res.status === 204 || res.status === 201 && method === 'PUT')
        return { ok: true };
    const data = await res.json().catch(() => null);
    if (!res.ok)
        return { error: `Яндекс.Диск HTTP ${res.status}: ${data?.message || data?.description || ''}` };
    return data;
}

export default {
    icon: 'carbon:cloud-upload',
    label: 'Яндекс 360 / Яндекс.Диск',
    description: 'Доступ к документам, папкам и публикациям на корпоративном Яндекс.Диске через официальный REST API',
    baseUrl: YADISK_API,
    apiKey: '',
    capabilities: ['cloud', 'storage', 'yandex_disk'],
    enabled: true,

    SCHEMA: {
        list_files: {
            readonly: true,
            description: 'Просмотреть список файлов и папок в каталоге Яндекс.Диска (по умолчанию — корень "disk:/").',
            params: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Путь на Яндекс.Диске, например "disk:/" или "disk:/Договоры"' },
                    limit: { type: 'number', description: 'Максимум элементов (по умолчанию 30)' },
                },
            },
        },
        get_download_link: {
            readonly: true,
            description: 'Получить прямую ссылку на скачивание файла с Яндекс.Диска.',
            params: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Путь к файлу на Яндекс.Диске, например "disk:/Отчет.xlsx"' },
                },
                required: ['path'],
            },
        },
        upload_text: {
            readonly: false,
            description: 'Сохранить текстовый файл, отчёт, Markdown или JSON на Яндекс.Диск.',
            params: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Целевой путь на Яндекс.Диске, например "disk:/WORK/report.md"' },
                    content: { type: 'string', description: 'Содержимое файла' },
                    overwrite: { type: 'boolean', description: 'Перезаписать при совпадении имени (по умолчанию true)' },
                },
                required: ['path', 'content'],
            },
        },
        publish_resource: {
            readonly: false,
            description: 'Опубликовать файл или папку на Яндекс.Диске и получить публичную ссылку для отправки контрагенту.',
            params: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Путь к файлу или папке на Яндекс.Диске' },
                },
                required: ['path'],
            },
        },
    },

    async list_files(params = {}) {
        const diskPath = String(params.path || 'disk:/').trim() || 'disk:/';
        const limit = Math.min(Math.max(Number(params.limit) || 30, 1), 100);
        const res = await yaDiskFetch(this, '/resources', {
            query: { path: diskPath, limit: String(limit) },
        });
        if (res?.notConfigured || res?.error)
            return res;
        const items = (res?._embedded?.items || []).map(it => ({
            name: it.name,
            type: it.type,
            path: it.path,
            size: it.size,
            modified: it.modified,
            public_url: it.public_url || undefined,
        }));
        return {
            source: 'Яндекс.Диск',
            path: res?.path || diskPath,
            count: items.length,
            items,
        };
    },

    async get_download_link(params = {}) {
        const diskPath = String(params.path || '').trim();
        if (!diskPath)
            return { error: 'get_download_link: укажите путь к файлу path' };
        const res = await yaDiskFetch(this, '/resources/download', {
            query: { path: diskPath },
        });
        if (res?.notConfigured || res?.error)
            return res;
        return { path: diskPath, href: res?.href };
    },

    async upload_text(params = {}) {
        const diskPath = String(params.path || '').trim();
        const content = String(params.content ?? '');
        if (!diskPath)
            return { error: 'upload_text: укажите путь на Яндекс.Диске path' };
        const overwrite = params.overwrite !== false ? 'true' : 'false';
        const linkRes = await yaDiskFetch(this, '/resources/upload', {
            query: { path: diskPath, overwrite },
        });
        if (linkRes?.notConfigured || linkRes?.error)
            return linkRes;
        if (!linkRes?.href)
            return { error: 'Яндекс.Диск не вернул URL загрузки' };

        const putRes = await fetch(linkRes.href, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: Buffer.from(content, 'utf8'),
            signal: AbortSignal.timeout(20000),
        });
        if (!putRes.ok)
            return { error: `Ошибка загрузки на Яндекс.Диск: HTTP ${putRes.status}` };
        return { ok: true, path: diskPath, bytes: Buffer.byteLength(content, 'utf8') };
    },

    async publish_resource(params = {}) {
        const diskPath = String(params.path || '').trim();
        if (!diskPath)
            return { error: 'publish_resource: укажите путь path' };
        const pub = await yaDiskFetch(this, '/resources/publish', {
            method: 'PUT',
            query: { path: diskPath },
        });
        if (pub?.notConfigured || pub?.error)
            return pub;
        const meta = await yaDiskFetch(this, '/resources', {
            query: { path: diskPath, fields: 'name,path,public_url,public_key' },
        });
        return {
            ok: true,
            path: diskPath,
            public_url: meta?.public_url || '',
        };
    },
};
