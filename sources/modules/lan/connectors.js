/** Коннекторы зарегистрированных LAN-сервисов. Адрес и тип задаёт администратор, не аргументы вызова. */
import { loadConfig } from '../agent/system.js';
import { lanRequest } from './net.js';
import { ippRequest } from './ipp.js';
import { audit } from '../../server/access/audit.js';
import { setTimeout as delay } from 'node:timers/promises';

export const SCHEMAS = {
    printer: {
        status: { readonly: true, description: 'Атрибуты и состояние IPP-принтера', params: { type: 'object', properties: {} } },
        print: { readonly: false, description: 'Напечатать файл WORK через IPP (формат должен поддерживаться принтером)', params: {
            type: 'object', properties: { path: { type: 'string' }, format: { type: 'string', description: 'MIME, например application/pdf' } }, required: ['path'],
        } },
    },
    scanner: {
        status: { readonly: true, description: 'Возможности и состояние eSCL-сканера', params: { type: 'object', properties: {} } },
        scan: { readonly: false, description: 'Сканировать одну страницу A4 через eSCL и сохранить в ролевую зону точки WORK', params: {
            type: 'object', properties: { to: { type: 'string', description: 'Класс WORK для сохранения' }, filename: { type: 'string' },
                role: { type: 'string' }, dpi: { type: 'integer', enum: [75, 150, 200, 300, 600] },
                source: { type: 'string', enum: ['Platen', 'Feeder'] } }, required: ['to'],
        } },
    },
    onec: {
        catalogs: { readonly: true, description: 'Метаданные сущностей OData-публикации 1С', params: { type: 'object', properties: {} } },
        query: { readonly: true, description: 'Прочитать объекты 1С через OData (до 500 записей)', params: {
            type: 'object', properties: { entity: { type: 'string' }, filter: { type: 'string' }, select: { type: 'string' },
                top: { type: 'integer' }, skip: { type: 'integer' } }, required: ['entity'],
        } },
    },
    web: { status: { readonly: true, description: 'Прочитать зарегистрированную страницу устройства', params: { type: 'object', properties: {} } } },
    share: { status: { readonly: true, description: 'Адрес зарегистрированного SMB-сервиса', params: { type: 'object', properties: {} } } },
    sql: { status: { readonly: true, description: 'Адрес обнаруженного SQL-сервера (драйвер подключения настраивается отдельно)', params: { type: 'object', properties: {} } } },
};

function requireOk(res) {
    if (res.status < 200 || res.status >= 300) throw new Error('Устройство: HTTP ' + res.status);
    return res;
}

async function headersFor(service, data) {
    if (!data.credentialFile) return {};
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(data.credentialFile)) throw new Error('Некорректная ссылка на секрет');
    const secret = await service.read_secret({ filename: data.credentialFile });
    if (secret.token) return { authorization: 'Bearer ' + secret.token };
    if (typeof secret.username === 'string' && typeof secret.password === 'string')
        return { authorization: 'Basic ' + Buffer.from(secret.username + ':' + secret.password).toString('base64') };
    throw new Error('В секрете нужны token или username/password');
}

export async function execute(service, method, params = {}) {
    const session = params.session;
    if (!session?.uid || session.principal?.kind === 'node') throw new Error('Требуется локальный пользователь WORK');
    await service.init;
    const data = service.DATA;
    const spec = SCHEMAS[data.lanKind]?.[method];
    if (!spec || !await service.canSee(service, params)) throw new Error('Доступ запрещён');
    const cfg = loadConfig();
    if (!cfg.enabled) throw new Error('LAN выключена');
    audit('lan_service', { path: service.path, method, params });
    if (['share', 'sql'].includes(data.lanKind)) return { kind: data.lanKind, host: data.host, port: data.port, endpoint: data.endpoint };
    const headers = await headersFor(service, data);
    const endpoint = new URL(data.endpoint);
    const options = { headers, signal: params.signal };
    if (data.lanKind === 'printer') {
        if (method === 'status') return ippRequest(endpoint, cfg, { headers, signal: params.signal });
        const file = await WORK.get_item(params.path);
        if (!file || Array.isArray(file) || typeof file.load !== 'function') throw new Error('Укажите файл WORK');
        await file.assertAccess(params, 'read');
        if (Number(file.stat?.size) > 32 * 1024 * 1024) throw new Error('Файл для печати больше 32 МБ');
        const body = await file.load({ ...params, encoding: null });
        if (!Buffer.isBuffer(body)) throw new Error('Нужен файл');
        const mime = params.format || ({ pdf: 'application/pdf', txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' })[file.ext];
        const attrs = await ippRequest(endpoint, cfg, { headers, signal: params.signal });
        if (!mime || !attrs['document-format-supported']?.includes(mime))
            throw new Error('Принтер не подтвердил поддержку формата: ' + mime);
        return ippRequest(endpoint, cfg, { data: body, format: mime, name: file.id, headers, signal: params.signal });
    }
    if (data.lanKind === 'scanner') {
        if (!endpoint.pathname.endsWith('/')) endpoint.pathname += '/';
        const caps = requireOk(await lanRequest(new URL('ScannerCapabilities', endpoint), cfg, options)).body.toString('utf8');
        if (method === 'status') return { capabilities: caps, status: requireOk(await lanRequest(new URL('ScannerStatus', endpoint), cfg, options)).body.toString('utf8') };
        const target = await WORK.get_item(params.to);
        const { FS } = await import('../../server/index.js');
        if (!(target instanceof FS.$class)) throw new Error('to должен указывать на класс WORK');
        const saveParams = { session, role: params.role };
        const zone = await target.work_zone(saveParams);
        await zone.assertAccess(saveParams, 'write');
        const dpi = Number(params.dpi || 300);
        if (![75, 150, 200, 300, 600].includes(dpi)) throw new Error('Некорректное разрешение');
        const source = params.source || 'Platen';
        if (!['Platen', 'Feeder'].includes(source)) throw new Error('Некорректный источник');
        const format = caps.includes('application/pdf') ? 'application/pdf' : caps.includes('image/jpeg') ? 'image/jpeg' : '';
        if (!format) throw new Error('Сканер не объявил поддержку PDF/JPEG');
        const xml = `<?xml version="1.0"?><scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm"><pwg:Version>2.0</pwg:Version><pwg:ScanRegions><pwg:ScanRegion><pwg:Height>3508</pwg:Height><pwg:Width>2480</pwg:Width><pwg:XOffset>0</pwg:XOffset><pwg:YOffset>0</pwg:YOffset></pwg:ScanRegion></pwg:ScanRegions><pwg:InputSource>${source}</pwg:InputSource><scan:DocumentFormatExt>${format}</scan:DocumentFormatExt><scan:ColorMode>RGB24</scan:ColorMode><scan:XResolution>${dpi}</scan:XResolution><scan:YResolution>${dpi}</scan:YResolution></scan:ScanSettings>`;
        const jobs = new URL('ScanJobs', endpoint);
        const res = await lanRequest(jobs, cfg, { ...options, method: 'POST', headers: { ...headers, 'content-type': 'text/xml' }, body: xml });
        if (res.status !== 201 || !res.headers.location) throw new Error('Сканер не создал задание: HTTP ' + res.status);
        const job = new URL(res.headers.location, jobs);
        if (job.origin !== endpoint.origin || !job.pathname.startsWith(jobs.pathname + '/')) throw new Error('Сканер вернул некорректный адрес задания');
        const next = new URL(job.href.replace(/\/$/, '') + '/NextDocument');
        try {
            const deadline = AbortSignal.timeout(90_000);
            const signal = params.signal ? AbortSignal.any([deadline, params.signal]) : deadline;
            let page;
            // eSCL 503 означает, что задание принято, но страница ещё не готова.
            for (;;) {
                page = await lanRequest(next, cfg, { ...options, signal, timeout: 90_000, maxBytes: 32 * 1024 * 1024 });
                if (page.status !== 503) break;
                const seconds = Number(page.headers['retry-after']);
                await delay(Math.max(100, Math.min(5000, Number.isFinite(seconds) ? seconds * 1000 : 1000)), undefined, { signal });
            }
            requireOk(page);
            const actual = String(page.headers['content-type'] || '').split(';')[0];
            if (!['application/pdf', 'image/jpeg'].includes(actual)) throw new Error('Неожиданный формат скана');
            return target.save_file({ ...saveParams, filename: params.filename || ('scan.' + (actual === 'application/pdf' ? 'pdf' : 'jpg')), post: page.body });
        }
        finally { await lanRequest(job, cfg, { method: 'DELETE', headers }).catch(() => {}); }
    }
    if (data.lanKind === 'onec') {
        if (!endpoint.pathname.endsWith('/')) endpoint.pathname += '/';
        if (method === 'catalogs') return requireOk(await lanRequest(new URL('$metadata', endpoint), cfg, options)).body.toString('utf8');
        if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(params.entity || '')) throw new Error('Некорректное имя сущности');
        const url = new URL(encodeURIComponent(params.entity), endpoint);
        url.searchParams.set('$format', 'json');
        url.searchParams.set('$top', String(Math.max(1, Math.min(500, Number(params.top) || 50))));
        url.searchParams.set('$skip', String(Math.max(0, Math.trunc(Number(params.skip) || 0))));
        if (params.filter) url.searchParams.set('$filter', String(params.filter));
        if (params.select) url.searchParams.set('$select', String(params.select));
        return JSON.parse(requireOk(await lanRequest(url, cfg, options)).body.toString('utf8'));
    }
    const res = requireOk(await lanRequest(endpoint, cfg, options));
    return { status: res.status, type: res.headers['content-type'], text: res.body.toString('utf8').slice(0, 20000) };
}
