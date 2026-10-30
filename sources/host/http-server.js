import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as fs from 'node:fs';
import process from 'node:process';
import * as mime from 'mime-types';
import * as zlib from 'node:zlib';
import { pipeline, Readable } from 'node:stream';
import multiparty from 'multiparty';
import { createHash } from 'node:crypto';
import { PORT, TLSPORT, TLSHOST, LOCAL_ORIGIN, HOST, DEV_MODE, MAX_BODY_BYTES, MAX_UPLOAD_BYTES } from './config.js';
import * as CORE from '../server/index.js';
import { $server } from '../server/server.js';
import * as GATEWAY from '../server/access/gateway.js';
import { markUpload } from '../server/upload-mark.js';

/** Активное содержимое из пользовательских зон (html/svg/xml/js) — в песочнице: нельзя исполнить на нашем домене. */
const ACTIVE_TYPE = /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml|application\/javascript|text\/javascript)/i;
const SYSTEM_PREFIX = /^\/(\$server|sources|oda)(\/|$)/;
/** Песочница пользовательского HTML: без allow-same-origin — уникальный непрозрачный источник. */
export const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';

/**
 * Свернуть одноимённые совпадения `~` в один элемент: контейнеры представлений
 * (`handlers/pages/form/` из distributive с видами внутри) тоже зовутся `form`,
 * но хендлерами не являются. Брать последний настоящий $handler, иначе страница
 * формы получает $folder без importView. Без хендлеров — как раньше (.last).
 */
export function pickTildeSingle(items) {
    return (items || []).filter(f => f?.type === '$handler').last ?? items.last;
}

function isLoopback(request) {
    const a = String(request.socket?.remoteAddress || '');
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function isSecure(request) {
    return !!request.socket?.encrypted || String(request.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/** Cookie сессии: HttpOnly, SameSite=Lax (не уходит с кросс-сайтовыми POST/подзапросами), Secure по TLS. */
function sessionCookie(session, request) {
    return `ssid=${session.ssid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}` + (isSecure(request) ? '; Secure' : '');
}

/** Файл пользовательских данных (не системный код/UI) — отдаётся с sandbox для активных типов. */
function isUserContent(item) {
    const path = String(item?.path || '');
    if (SYSTEM_PREFIX.test(path))
        return false;
    try {
        const owner = item.$owner || item.$class;
        const kind = owner?.areaOf?.(item)?.kind;
        return kind !== 'system';
    }
    catch {
        return true;
    }
}

async function readBody(request, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > limit)
            throw new Error('Тело запроса больше допустимого размера');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

const COMPRESS_MAX = 8 * 1024 * 1024;
const STATIC_CACHE = 'must-revalidate, public, max-age=3600';
/** В dev — всегда ревалидация (304 по ETag дешёв), правки видны сразу. */
const DEV_CACHE = 'no-cache';
const STATIC_PATH = /\.(m?js|css|svg|png|jpe?g|gif|webp|ico|wasm|map|woff2?|ttf|mp3)$/i;

/** ETag тела файла: собранная строка — хеш содержимого, файл на диске — размер+mtime. */
function etagOf(item, result) {
    if (typeof result === 'string')
        return '"' + createHash('sha1').update(result).digest('base64url').slice(0, 20) + '"';
    const st = item?.stat;
    if (st?.mtimeMs)
        return 'W/"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
    return null;
}

function resolveFileContentType(item) {
    // Типизатор `$ext` главнее системного mime (кастомные расширения / JSON-типы)
    const fromType = item?.contentType || item?.DATA?.contentType;
    if (fromType)
        return fromType;
    return mime.contentType(item?.id) || 'text/plain';
}

/** JSON / text/* — строка; иначе байты (octet-stream, video, office…). */
function parsePostBody(buffer, contentType) {
    if (contentType === 'application/json')
        return JSON.parse(buffer.toString('utf-8'));
    if (!contentType || contentType.startsWith('text/'))
        return buffer.toString('utf-8');
    return buffer;
}

function isStaticAssetType(mime_type) {
    const t = String(mime_type || '').split(';')[0].trim();
    return t === 'image/svg+xml'
        || t === 'text/css'
        || t === 'application/javascript'
        || t === 'text/javascript'
        || t === 'application/wasm';
}

function createBodyEncoder(acceptEncoding, size = 0) {
    if (size > COMPRESS_MAX)
        return null;
    if (/\bbr\b/.test(acceptEncoding)) {
        return {
            encoding: 'br',
            stream: zlib.createBrotliCompress({
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: size > 256 * 1024 ? 1 : 4,
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size,
                },
            }),
        };
    }
    if (/\bgzip\b/.test(acceptEncoding))
        return { encoding: 'gzip', stream: zlib.createGzip({ level: size > 256 * 1024 ? 1 : 4 }) };
    if (/\bdeflate\b/.test(acceptEncoding))
        return { encoding: 'deflate', stream: zlib.createDeflate({ level: size > 256 * 1024 ? 1 : 4 }) };
    return null;
}

function isFileBodyMethod(method) {
    return !method || method === 'load' || method === 'script';
}

function sendErrorResponse(response, error) {
    if (DEV_MODE) {
        console.error('[WORK]', error);
    }
    if (response.headersSent) {
        if (!response.writableEnded)
            response.end();
        return;
    }
    try {
        const headers = {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
        };
        if (Array.isArray(error?.errors) && error.errors.length) {
            try {
                headers['X-Work-Errors'] = encodeURIComponent(JSON.stringify(error.errors));
            }
            catch { /* ignore */ }
        }
        response.writeHead(400, headers);
        response.end(error?.toString?.() ?? String(error));
    }
    catch (err) {
        console.error(err);
    }
}

function onListenError(port, err) {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use.`);
        console.error(`Stop the other process (netstat -ano | findstr :${port}) or set WORK_PORT in .env`);
        process.exit(1);
    }
    throw err;
}

export function startServers(requestHandler) {
    const httpServer = http.createServer(requestHandler);
    httpServer.on('error', (err) => onListenError(PORT, err));
    httpServer.listen({ port: PORT }, () => {
        console.log(`Server running at ${LOCAL_ORIGIN}/`);
        console.log('Server running at http://localhost:8001/oda/components/structure/form/index.html');
        console.log('Server running at http://localhost:8001/oda/components/table/index.html');
        console.log('Server running at http://localhost:8001/torus/binnet/test-ui/index.html?tab=lab');
    });

    let httpsServer;
    if (process?.env?.WORK_TLS_CERT && process?.env?.WORK_TLS_KEY) {
        try {
            const options = {
                key: fs.readFileSync(process.env.WORK_TLS_KEY),
                cert: fs.readFileSync(process.env.WORK_TLS_CERT),
                allowHTTP1: true,
            };
            delete process.env.WORK_TLS_CERT;
            delete process.env.WORK_TLS_KEY;
            httpsServer = http2.createSecureServer(options, requestHandler);
            httpsServer.listen({ port: TLSPORT }, () => {
                const localTlsOrigin = `https://${TLSHOST}:${TLSPORT}`;
                console.log(`TLS Server running at ${localTlsOrigin}/`);
                console.log(`to launch: ${localTlsOrigin}/root/~/handlers//explorer/`);
            });
        }
        catch (e) {
            console.error(e);
        }
    }

    return { httpServer, httpsServer };
}

export function parseCookies(request) {
    const list = {};
    const cookieHeader = request.headers?.cookie;
    if (!cookieHeader) return list;

    cookieHeader.split(`;`).forEach(function (cookie) {
        let [name, ...rest] = cookie.split(`=`);
        name = name?.trim();
        if (!name) return;
        const value = rest.join(`=`).trim();
        if (!value) return;
        try {
            list[name] = decodeURIComponent(value);
        }
        catch {
            list[name] = value;
        }
    });
    return list;
}

function requestBody(params, request) {
    return params.post ?? request?.post;
}

/**
 * Вызов метода элемента из HTTP — только через шлюз доступа (access/gateway.js):
 * объявленные методы/геттеры, проверка уровня до вызова, CSRF для изменений, без сеттеров.
 */
export function execItemMethod(item, method, params, request) {
    if (!(item instanceof CORE.$folder))
        return item;

    method ||= item[request.method];
    if (!method)
        return item;

    return GATEWAY.invoke(item, method, params, {
        transport: 'http',
        request,
        post: requestBody(params, request),
    });
}

export function createRequestHandler() {
    return async function request_handler(request, response) {

    let item;
    try {
        // DEV отключает проверки прав — только для запросов с этой же машины
        if (DEV_MODE && !isLoopback(request)) {
            response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('WORK_DEV: доступ только с localhost');
            return;
        }
        // CORS не разрешён: предзапросы с чужих сайтов получают пустой ответ без разрешений;
        // для десктопного Office (WebDAV без Origin) возвращаем заголовки DAV
        if (request.method === 'OPTIONS') {
            const headers = { 'X-Content-Type-Options': 'nosniff' };
            if (!request.headers?.origin) {
                headers['DAV'] = '1, 2';
                headers['MS-Author-Via'] = 'DAV';
                headers['Allow'] = 'OPTIONS, GET, HEAD, PUT, PROPFIND, LOCK, UNLOCK';
            }
            response.writeHead(204, headers);
            response.end();
            return;
        }
        // WORK как MCP-сервер (внешние ИИ-клиенты, токен вместо cookie-сессии) — до разбора сессии и дерева
        const reqPath = String(request.url).split('?')[0];
        if (reqPath === '/mcp') {
            const { handleMcp } = await import('../modules/mcp/server.js');
            await handleMcp(request, response);
            return;
        }
        // 9.9: протокол A2A (/.well-known/agent.json, /a2a) и REST/SDK для встраивания (/api/agent, /sdk/work-agent.js)
        if (reqPath === '/.well-known/agent.json' || reqPath === '/a2a' || reqPath === '/api/agent' || reqPath === '/sdk/work-agent.js') {
            const { handleA2aHttp } = await import('../modules/a2a/server.js');
            if (await handleA2aHttp(request, response))
                return;
        }
        // 9.12: агент-«мост» на компьютере пользователя (/~bridge/register, /~bridge/poll, /~bridge/result)
        if (reqPath.startsWith('/~bridge/')) {
            const { handleBridgeHttp } = await import('../modules/bridge/hub.js');
            if (await handleBridgeHttp(request, response))
                return;
        }
        const cookies = parseCookies(request);
        let session;
        // Подписанный запрос узла сети WORK — эфемерная сессия субъекта-узла (без cookie)
        if (request.headers['work-signature']) {
            const { verifyNodeRequest } = await import('../modules/nodes/inbound.js');
            session = await verifyNodeRequest(request);
        }
        else {
            session = $server.get_session(cookies.ssid);
            session.ip = request.socket?.remoteAddress;
        }
        const url = new URL(`https://${request.headers.host || HOST}` + request.url);
        let path = decodeURIComponent(url.pathname);
        if (path.includes('\0'))
            throw new Error('Недопустимый путь');

        // Возврат со страницы входа провайдера (OAuth подключения агента) — до разбора дерева
        if (path === '/oauth/callback') {
            const { callback } = await import('../modules/agent/connections.js');
            const html = await callback(Object.fromEntries(url.searchParams), session);
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(html);
            return;
        }

        // Публичная карточка узла сети WORK (ключ, адрес, объявленные роли, известные узлы)
        if (path === '/.well-known/work-node') {
            const { wellKnown } = await import('../modules/nodes/identity.js');
            response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            response.end(JSON.stringify(await wellKnown()));
            return;
        }

        // Компьютер агента: страница просмотра, скриншот, takeover, клиент noVNC — до разбора дерева
        if (path.startsWith('/~computer/') || path.startsWith('/~/lib/novnc/')) {
            const { handleComputerHttp } = await import('../modules/sandbox/vnc-proxy.js');
            if (await handleComputerHttp(request, response, url, readBody))
                return;
        }

        // шаги `@свойство` — только разрешённые на чтение члены
        GATEWAY.assertPathProps(path);
        item = await WORK.get_item(path, 0, undefined, { session });

        const { method, params } = Array.from(url.searchParams).reduce(
            (res, [k, v], i) => {
                if (i === 0 && !v) {
                    res.method = k;
                }
                else {
                    res.params[k] = v;
                }
                return res;
            }, { method: '', params: {} }
        );
        if(path === '/' && !url.searchParams.length  && item === WORK && !method){
            response.writeHead(302, { Location: encodeURI(`/index.html`) });
            response.end();
            return;
        }



        // подписка сокета на изменения пути (reset → {path}) — после успешного ответа (доступ проверен);
        // статика UI (модули, стили, иконки) — не данные
        const subscribe = () => {
            if (!STATIC_PATH.test(path))
                session.sockets?.[request.headers['x-work-wsid']]?.events?.add(path);
        };
        params.session = session;
        if (item?.constructor === CORE.$file && ['LOCK', 'UNLOCK', 'PROPFIND', 'PUT'].includes(String(request.method || '').toUpperCase())) {
            const { handleOfficeWebDav } = await import('../modules/office/index.js');
            if (await handleOfficeWebDav(request, response, session, item, readBody, MAX_UPLOAD_BYTES))
                return;
        }
        if (item === undefined){
            if(!path.includes('/@')){
                if(path === '/index.html'){
                    response.writeHead(302, {

                        Location: encodeURI(`/~/handlers//${'explorer'}/index.html`),

                        // Location: encodeURI(session?.uid
                        //     ? `/~/handlers//${'explorer'}/index.html`
                        //     : `/PAAS/~/handlers//landing/`),
                    });
                    response.end();
                    return;
                }
                throw new Error(`item${path.includes('*') ? 's' : ''} "${path}" not found`);
            }

            response.writeHead(200, {"Content-Type": "text/html"});
            response.end('');
            return;
        }
        let result;
        if (Array.isArray(item)) {
            let items = await Promise.all(item);
            if (items.length > 0) {
                const _items = await GATEWAY.visibleOnly(items, params);
                if (_items.length === 0) {
                    throw new Error('Нет доступа.')
                }
                items = _items;
            }
            if (path.includes('~') && items.map(f => f.id).unique().length === 1) {
                item = pickTildeSingle(items);
                // readme.md из ~ читается сборкой (сырой вид, load, script — одна сборка);
                // остальное как раньше: mergeFiles без метода, иначе штатный разбор ниже.
                if (item.constructor === CORE.$file && items[0]?.id === 'readme.md' && isFileBodyMethod(method)) {
                    result = await $server.mergeTextFiles(items);
                }
                else if (!method) {
                    if (item.constructor === CORE.$file) {
                        result = await $server.mergeFiles(items);
                    }
                }
            }
            else {
                result = items.map(async item => {
                    return execItemMethod(item, method || 'info', params, request) || item
                });
                result = await Promise.all(result);
            }
        } else if (item instanceof CORE.$class) {
            const hasAccess = await item.allowAccess(params);
            if (!hasAccess) {
                throw new Error('Нет доступа');
            }
        }
        if(!result){
            if (item instanceof CORE.$folder) {
                if (item.constructor === CORE.$folder && !method && path.slice(-1) === '/') { // redirect folder to index.html
                    response.writeHead(302, { Location: encodeURI(path + 'index.html') });
                    response.end();
                    return;
                }
                let range = item.constructor === CORE.$file && request.method === 'GET' && isFileBodyMethod(method)
                    ? request.headers.range : undefined;
                if(range){
                    // частичная отдача — те же права, что у download
                    await item.assertAccess(params, CORE.$class.ACCESS_LEVEL.READ);
                    const fileSize = Number(item.size) || 0;
                    const parts = String(range).replace(/bytes=/, "").split("-");
                    const start = parseInt(parts[0], 10);
                    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                    end = Math.max(0, Math.min(end, fileSize - 1));
                    if (!Number.isInteger(start) || start < 0 || start >= fileSize || !Number.isInteger(end) || end < start) {
                        response.writeHead(416, { 'Content-Range': `bytes */${fileSize}`, 'X-Content-Type-Options': 'nosniff' });
                        response.end();
                        return;
                    }
                    const chunksize = (end - start) + 1;
                    const file = fs.createReadStream(item.dir, { start, end });

                        // Устанавливаем заголовки для частичного контента
                    response.writeHead(206, {
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': chunksize,
                        'Content-Type': resolveFileContentType(item)
                    });

                    // Стримим файл
                    file.pipe(response);
                    return;
                }
                else{
                    // if(item.constructor === CORE.$file && path.includes('/@'))
                    //     method = 'info'
                    if (request.method === 'POST'){
                        const contentType = (request.headers['content-type'] || '').split(';')[0];
                        if (contentType === 'multipart/form-data') {
                            const promise = new Promise((resolve , reject) => {
                                var form = new multiparty.Form({ maxFilesSize: MAX_UPLOAD_BYTES, maxFieldsSize: 20 * 1024 * 1024 });
                                form.parse(request, (err, fields, files)=>{
                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    if (fields?.metadata?.[0]) {
                                        params.metadata = JSON.parse(fields.metadata[0]);
                                    }
                                    // Текст сообщения: поле формы или (legacy) файл message
                                    if (fields?.message?.[0] != null && params.message == null)
                                        params.message = String(fields.message[0]);

                                    params.post = {};

                                    // помечаем объекты файлов формы: только им save_file доверяет post.path (upload-mark.js)
                                    for (const list of [files?.file, files?.url, files?.message])
                                        if (Array.isArray(list))
                                            for (const f of list)
                                                markUpload(f);

                                    if (files?.file) {
                                        params.post.files = files.file;
                                    }

                                    if (files?.url) {
                                        params.post.urls = files.url;
                                    }

                                    if (files?.message?.[0]) {
                                        params.post.message = files.message[0];
                                    }

                                    request.post = params.post;
                                    resolve(true)
                                });

                            })

                            await promise;
                        }
                        else {
                            const body = request.rawBody ?? await readBody(request, MAX_BODY_BYTES);
                            params.post = parsePostBody(body, contentType);
                            request.post = params.post;
                        }
                    }
                    if(path.includes('~')){
                        let steps = path.split('/');
                        steps.pop();
                        if(steps.last === '~')
                            params.hasTilde = true;
                    }
                    // Собранный выше результат из ~ (readme merge) не пересчитывать:
                    // превью (load) и сырой вид получают одну сборку. Остальное как раньше.
                    const readmeMerged = path.includes('~') && item.id === 'readme.md'
                        && typeof result === 'string' && result !== '';
                    if (!readmeMerged && item.constructor === CORE.$file && request.method !== 'POST' && isFileBodyMethod(method))
                        result = item.download(params);
                    else if (result == null)
                        result = execItemMethod(item, method, params, request)
                }
            }
            else
                result = item;
        }


        if (result?.then)
            result = await result;


        if (Array.isArray(result))
            result = await GATEWAY.visibleOnly(result, params);
        else if (result instanceof CORE.$folder && result !== item && !(await GATEWAY.canRead(result, params)))
            throw new Error('Нет доступа');

        const header = { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" };
        subscribe();
        // if (method === 'load_icon') {
        //     header['Content-Type'] = params.ext === 'png' ? 'image/png' : 'image/svg+xml';
        // }
        // else
        if (item instanceof CORE.$class && method === 'load')
            header["Content-Type"] = 'application/javascript; charset=utf-8';
        else if (item?.constructor === CORE.$file) {
            if (method === 'download') {
                const safeAscii = String(item.id || 'file').replace(/[\r\n"\\;]/g, '_');
                header["Content-Type"] = "application/octet-stream";
                header["Content-Disposition"] = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(String(item.id || 'file'))}`;
                header["Cache-Control"] = 'no-cache';
            }
            else if (isFileBodyMethod(method)) {
                const onError = (err) => {
                    if (err) {
                        response.end(err.toString());
                    }
                };
                let mime_type = resolveFileContentType(item);
                if(mime_type){
                    header["Content-Type"] = mime_type;
                    if (isStaticAssetType(mime_type)) {
                        const isVendorStatic = path.startsWith('/oda/tools/icons/')
                            || path.includes('/lib/mermaid')
                            || path.includes('/lib/mathjax')
                            || path.includes('/lib/highlight')
                            || path.includes('/lib/markdown-wasm');
                        header["Cache-Control"] = (DEV_MODE && !isVendorStatic) ? DEV_CACHE : STATIC_CACHE;
                    }
                }
                else
                    header["Content-Type"] = 'text/plain';
                // пользовательское активное содержимое (html/svg/js из зон) — в песочнице без allow-same-origin:
                // скрипты работают (презентации, отчёты), но в изолированном источнике — без доступа
                // к окну WORK, cookie сессии и API от имени пользователя
                if (ACTIVE_TYPE.test(header["Content-Type"]) && isUserContent(item)) {
                    header['Content-Security-Policy'] = SANDBOX_CSP;
                    header['Cache-Control'] = 'no-cache';
                }

                // ETag/304: повторная загрузка модулей и файлов — без тела
                const etag = request.method === 'GET' ? etagOf(item, result) : null;
                if (etag) {
                    header['ETag'] = etag;
                    header['Cache-Control'] ??= 'no-cache';
                    const inm = String(request.headers['if-none-match'] || '');
                    if (inm && inm.split(/\s*,\s*/).includes(etag)) {
                        result?.destroy?.();
                        delete header['Content-Type'];
                        response.writeHead(304, header);
                        response.end();
                        return;
                    }
                }

                // размер — тела ответа: у сборки слоёв (~) это строка, не файл последнего слоя
                const size = typeof result === 'string' ? Buffer.byteLength(result) : (Number(item.size) || 0);
                const packed = createBodyEncoder(request.headers['accept-encoding'] || '', size);
                if (packed) {
                    header["Content-Encoding"] = packed.encoding;
                    if (!session.ephemeral && cookies.ssid !== session.ssid)
                        header['Set-Cookie'] = sessionCookie(session, request);
                    response.writeHead(200, header);
                    const source = result?.pipe ? result : Readable.from(result);
                    pipeline(source, packed.stream, response, onError);
                    return;
                }
                if (size)
                    header['Content-Length'] = size;
            }
            else if (Buffer.isBuffer(result)) {
                // method вроде ?tts — сырой WAV, не JSON.stringify(Buffer)
                header["Content-Type"] = "audio/wav";
            }
            else {
                result = JSON.stringify(result, null, +params.space || 2);
            }
        }
        else if (Buffer.isBuffer(result)) {
            if (method === 'export_archive' || (result.length >= 4 && result[0] === 0x50 && result[1] === 0x4b)) {
                const rawName = String(params.filename || `${item?.id || 'archive'}.zip`);
                const safeAscii = rawName.replace(/[^\x20-\x7E]|[\r\n"\\;]/g, '_');
                header["Content-Type"] = "application/zip";
                header["Content-Disposition"] = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(rawName)}`;
                header["Cache-Control"] = "no-cache";
            }
            else {
                header["Content-Type"] = "audio/wav";
            }
        }
        else if (typeof result === 'object') {
            result = JSON.stringify(result, null, +params.space || 2);
        }
        else if(typeof result === 'string'){

            header["Content-Type"] = "text/html";
            // result = result?.toString?.();
        }
        else{
            result = result?.toString?.();
        }
        if (!session.ephemeral && cookies.ssid !== session.ssid) {
            header['Set-Cookie'] = sessionCookie(session, request);
        }

        if (result){
            response.writeHead(200, header);
                if(result.pipe){
                    result.pipe(response);
                    result.on('error', (err) => {
                        console.error('File stream error:', err);
                        if (!response.headersSent)
                            response.writeHead(500, { 'Content-Type': 'text/plain' });
                        if (!response.writableEnded)
                            response.end('Server error');
                    });
                }
            else
                response.end(result);
        }
        else {
            // null/undefined → 200 с телом 'null', чтобы клиентский response.json() не падал
            response.writeHead(200, header);
            response.end('null');
        }
    }
    catch (e) {
        sendErrorResponse(response, e);
    }
    };
}