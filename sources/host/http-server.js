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
import { verifyWebhook } from './yookassa.js';
import { recordRequest } from './stats-collector.js';

function sendErrorResponse(response, error) {
    if (DEV_MODE) {
        console.error('[WORK]', error);
    }
    response.writeHead(400, {
        'Content-Type': 'text/html',
        mode: 'no-cors',
        'Access-Control-Allow-Origin': '*',
    });
    response.end(error?.toString?.() ?? String(error));
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
        if (method === "tts") console.log("[tryHandlerMethod] handlers:", Object.keys(handlers||{}), "handler:", !!handler, "hasExecute:", !!(handler?.execute));
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
        if (method === "tts") console.log("[execItemMethod] tts called, item:", item?.path, "params.post:", JSON.stringify(params.post)?.slice(0,200));
        const classResult = resolveClassMethod(item, method, params, request);
        if (method === "tts") console.log("[execItemMethod] classResult:", classResult, "type:", typeof classResult);
        if (classResult !== undefined)
            return classResult;

        const handlerResult = await tryHandlerMethod(item, method, params, request);
        if (handlerResult !== undefined)
            return handlerResult;

        throw new Error(`Unknown method "${method}" for:<br>${item.path}`);
    };

    return runMethod();
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        request.on('error', reject);
    });
}

export function createRequestHandler() {
    return async function request_handler(request, response) {

    let item;
    try {
        const cookies = parseCookies(request);
        let user = $server.get_user(cookies.ssid);
        const url = new URL(`https://${request.headers.host || HOST}` + request.url);
        let path = decodeURIComponent(url.pathname);

        recordRequest({ bytesIn: Number(request.headers['content-length'] || 0) });

        if (request.method === 'POST' && path === '/api/billing/yookassa/webhook') {
            const raw = await readRequestBody(request);
            let body;
            try { body = JSON.parse(raw); }
            catch { body = {}; }
            let ykConfig = {};
            try {
                ykConfig = await WORK.read_secret({ name: 'yookassa', user: globalThis.WORK }) || {};
            }
            catch {}
            const check = verifyWebhook(body, request.headers, ykConfig);
            if (!check.ok) {
                response.writeHead(400, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ error: check.reason }));
                return;
            }
            const billing = await WORK.get_item('/SYS/Billing', 0, undefined, { user: globalThis.WORK });
            const methods = await billing?._methods;
            await methods?.creditWallet?.execute({ user: globalThis.WORK, $context: billing }, {
                event: check.event,
                paymentId: check.payment?.id,
                object: check.payment,
            });
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ ok: true }));
            return;
        }

        // console.log(request.url)

        item = await WORK.get_item(path, 0, undefined, { user });

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



        user.sockets[request.headers['x-work-wsid']]?.events?.add(path);
        params.user = user;
        if (item === undefined){
            if(!path.includes('/@')){
                if(path === '/index.html'){
                    response.writeHead(302, {

                        Location: encodeURI(`/~/handlers//${'explorer'}/index.html`),

                        // Location: encodeURI(user?.uid
                        //     ? `/~/handlers//${'explorer'}/index.html`
                        //     : `/paas/~/handlers//landing/`),
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
            if(path.includes('~')  && items.map(f=>f.id).unique().length === 1){
                item = items.last;
                if(!method){
                    if(item.constructor === CORE.$file){
                        result = await $server.mergeFiles(items);
                    }
                }
            }
            else{
                result = items.map(async item => {
                    return execItemMethod(item, method || 'info', params, request) || item
                });
                result = await Promise.all(result);
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
                        'Content-Type': mime.contentType(item.id)
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
                    result = execItemMethod(item, method, params, request)
                }
            }
            else
                result = item;
        }


        if (result?.then)
            result = await result;

        const isFilePayload = item?.constructor === CORE.$file
            && (!method || method === 'load' || method === 'script' || method === 'download');
        // TODO: canSee-фильтрация
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
            else if (!method || method === 'load' || method === 'script') {
                const onError = (err) => {
                    if (err) {
                        // If an error occurs, there's not much we can do because
                        // the server has already sent the 200 response code and
                        // some amount of data has already been sent to the client.
                        // The best we can do is terminate the response immediately
                        // and log the error.
                        response.end(err.toString());
                        // console.error('An error occurred:', err);
                    }
                };
                let mime_type = mime.contentType(item.id);
                if(mime_type){
                    header["Content-Type"] = mime_type;
                    if(mime_type === 'image/svg+xml')
                        header["Cache-Control"] = "must-revalidate, public, max-age=3600";
                }
                else
                    header["Content-Type"] = 'text/plain';
                // header["Cache-Control"] = "max-age=60";

                // header["Cache-Control"] = "must-revalidate, public, max-age=3600";

                let acceptEncoding = request.headers['accept-encoding'];
                if(acceptEncoding){

                    if (acceptEncoding.match(/\bdeflate\b/)) {
                        header["Content-Encoding"] = 'deflate'
                        pipeline(Readable.from(result), zlib.createDeflate(), response, onError);

                    }
                    else if (acceptEncoding?.match(/\bgzip\b/)) {
                        header["Content-Encoding"] = 'gzip'
                        pipeline(Readable.from(result), zlib.createGzip(), response, onError);
                    }
                    else if (acceptEncoding?.match(/\br\b/)) {
                        header["Content-Encoding"] = 'br'
                        pipeline(Readable.from(result), zlib.createBrotliCompress(), response, onError);

                    }

                    response.writeHead(200, header);
                    return;
                }

            }
            else {
                result = JSON.stringify(result, null, +params.space || 2);
            }
        }
        else if (Buffer.isBuffer(result)) {
            header["Content-Type"] = "audio/wav";
        }
        else if (typeof result === 'object') {
            if (result?.constructor.name === 'bound R')
                result = result[ACTIVE].chache.data;
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
            header['Set-Cookie'] = `ssid=${user.ssid}; HttpOnly; Path=/`;
        }

        if (result){
            response.writeHead(200, header);
                if(result.pipe){
                    result.pipe(response);
                    result.on('error', (err) => {
                        console.error('File stream error:', err);
                        response.writeHead(500, { 'Content-Type': 'text/plain' });
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