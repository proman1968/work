import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as fs from 'node:fs';
import process from 'node:process';
import * as mime from 'mime-types';
import * as zlib from 'node:zlib';
import { pipeline, Readable } from 'node:stream';
import multiparty from 'multiparty';
import { PORT, TLSPORT, TLSHOST, LOCAL_ORIGIN, HOST, DEV_MODE } from './config.js';
import * as CORE from '../server/index.js';
import { $server } from '../server/server.js';

const COMPRESS_MAX = 256 * 1024;
const STATIC_CACHE = 'must-revalidate, public, max-age=3600';

function resolveFileContentType(item) {
    // Типизатор `$ext` главнее системного mime (кастомные расширения / JSON-типы)
    const fromType = item?.contentType || item?.DATA?.contentType;
    if (fromType)
        return fromType;
    return mime.contentType(item?.id) || 'text/plain';
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
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size,
                },
            }),
        };
    }
    if (/\bgzip\b/.test(acceptEncoding))
        return { encoding: 'gzip', stream: zlib.createGzip({ level: 4 }) };
    if (/\bdeflate\b/.test(acceptEncoding))
        return { encoding: 'deflate', stream: zlib.createDeflate({ level: 4 }) };
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
        response.writeHead(400, {
            'Content-Type': 'text/html',
            mode: 'no-cors',
            'Access-Control-Allow-Origin': '*',
        });
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
        list[name] = decodeURIComponent(value);
    });
    return list;
}

function requestBody(params, request) {
    return params.post ?? request?.post;
}

async function tryHandlerMethod(item, method, params, request) {
    try {
        const handlers = await item._methods;
        const handler = handlers?.[method];
        if (handler && typeof handler.execute === 'function') {
            params.$context = item;
            return handler.execute(params);
        }
    }
    catch {
        // handler not found or not executable on server
    }
    return undefined;
}

function resolveClassMethod(item, method, params, request) {
    const post = requestBody(params, request);
    // Обход цепочки прототипов через Object.getPrototypeOf (не __proto__,
    // который может перехватываться Reactor-прокси)
    let prop;
    let t = item;
    while (t && !prop) {
        prop = Object.getOwnPropertyDescriptor(t, method);
        t = Object.getPrototypeOf(t);
    }
    if (prop) {
        if (prop.value) {
            if (typeof prop.value === 'function')
                return prop.value.call(item, params, post);
            return prop.value;
        }
        else if (prop.get)
            return prop.get.call(item);
        else if (prop.set && post)
            return prop.set.call(item, post);
    }
    // Fallback: попытка прямого доступа (для Reactor-прокси)
    try {
        const handler = item[method];
        if (handler !== undefined) {
            if (typeof handler === 'function')
                return handler.call(item, params, post);
            return handler;
        }
    } catch {}
}

export function execItemMethod(item, method, params, request) {
    if (!(item instanceof CORE.$folder))
        return item;

    method ||= item[request.method];
    if (!method)
        return item;

    const runMethod = async () => {
        const classResult = resolveClassMethod(item, method, params, request);
        if (classResult !== undefined)
            return classResult;

        const handlerResult = await tryHandlerMethod(item, method, params, request);
        if (handlerResult !== undefined)
            return handlerResult;

        throw new Error(`Unknown method "${method}" for:<br>${item.path}`);
    };

    return runMethod();
}

export function createRequestHandler() {
    return async function request_handler(request, response) {

    let item;
    try {
        const cookies = parseCookies(request);
        let session = $server.get_session(cookies.ssid);
        const url = new URL(`https://${request.headers.host || HOST}` + request.url);
        let path = decodeURIComponent(url.pathname);

        // console.log(request.url)

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



        session.sockets[request.headers['x-work-wsid']]?.events?.add(path);
        params.session = session;
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
                let _items = [];
                for (const i of items) {
                    const hasAccess = i.allowAccess ? await i.allowAccess(params) : true;
                    if (hasAccess) {
                        _items.push(i);
                    }
                }
                if (_items.length === 0) {
                    throw new Error('Нет доступа.')
                }
                items = _items;
            }
            if (path.includes('~') && items.map(f => f.id).unique().length === 1) {
                item = items.last;
                if (!method) {
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
                let range = request.headers.range;
                if(range){
                    const fileSize = item.size;
                    const parts = range.replace(/bytes=/, "").split("-");
                    const start = parseInt(parts[0], 10);
                    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                    const chunksize = (end - start) + 1;
                    if(end<0)
                        end = 0;
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
                                var form = new multiparty.Form();
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
                        else if (contentType === 'video/webm') {
                            let chunks = [];
                            for await (let chunk of request) {
                                chunks.push(chunk);
                            }
                            const buffer = Buffer.concat(chunks);
                            params.post = buffer;
                            request.post = params.post;
                        }
                        else {
                            let chunks = [];
                            try{
                                for await (let chunk of request) {
                                    chunks.push(chunk);
                                }
                            }
                            catch(e){
                                console.error(e)
                            }

                            const buffer = Buffer.concat(chunks);
                            params.post = buffer.toString('utf-8');
                            if (contentType === 'application/json')
                                params.post = JSON.parse(params.post);
                            request.post = params.post;
                        }
                    }
                    if(path.includes('~')){
                        let steps = path.split('/');
                        steps.pop();
                        if(steps.last === '~')
                            params.hasTilde = true;
                    }
                    if (item.constructor === CORE.$file && request.method !== 'POST' && isFileBodyMethod(method))
                        result = item.download(params);
                    else
                        result = execItemMethod(item, method, params, request)
                }
            }
            else
                result = item;
        }


        if (result?.then)
            result = await result;


        if (Array.isArray(result)) {
            const res = []
            for (const i of result) {
                if (i instanceof CORE.$class) {
                    const hasAccess = await i.allowAccess(params);
                    if (!hasAccess) {
                        continue;
                    }
                }
                res.push(i);
            }
            result = res;
        }

        const isFilePayload = item?.constructor === CORE.$file && (!method || method === 'load' || method === 'script' || method === 'download');
        const header = { "Access-Control-Allow-Origin": "*", "mode": 'no-cors', "Content-Type": "application/json" };
        // if (method === 'load_icon') {
        //     header['Content-Type'] = params.ext === 'png' ? 'image/png' : 'image/svg+xml';
        // }
        // else
        if (item?.constructor === CORE.$class && method === 'load')
            header["Content-Type"] = 'application/javascript; charset=utf-8';
        else if (item?.constructor === CORE.$file) {
            if (method === 'download') {
                header["Content-Type"] = "application/octet-stream";
                header["Content-Disposition"] = "attachment; filename=" + item.id;
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
                    if (isStaticAssetType(mime_type))
                        header["Cache-Control"] = STATIC_CACHE;
                }
                else
                    header["Content-Type"] = 'text/plain';

                const size = Number(item.size) || (typeof result === 'string' ? Buffer.byteLength(result) : 0);
                const packed = createBodyEncoder(request.headers['accept-encoding'] || '', size);
                if (packed) {
                    header["Content-Encoding"] = packed.encoding;
                    if (!cookies.ssid)
                        header['Set-Cookie'] = `ssid=${session.ssid}; HttpOnly; Path=/`;
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
            header["Content-Type"] = "audio/wav";
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
        if (!cookies.ssid) {
            header['Set-Cookie'] = `ssid=${session.ssid}; HttpOnly; Path=/`;
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