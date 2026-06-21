import * as fs from 'node:fs';
import * as mime from 'mime-types';
import * as zlib from 'node:zlib';
import { pipeline, Readable } from 'node:stream';
import multiparty from 'multiparty';
import { HOST } from '../config.js';
import { sendErrorResponse } from './errors.js';
import { parseCookies } from './http-utils.js';
import { execItemMethod } from './exec-item-method.js';
import * as CORE from '../server.js';
import { WorkServer } from './work-server.js';

export function createRequestHandler() {
    return async function request_handler(request, response) {

    let item;
    try {
        const cookies = parseCookies(request);
        let user = WorkServer.get_user(cookies.ssid);
        const url = new URL(`https://${request.headers.host || HOST}` + request.url);
        let path = decodeURIComponent(url.pathname);

        // console.log(request.url)

        item = await WORK.get_item(path);

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
                    response.writeHead(302, { Location: encodeURI(`/~/handlers//${'explorer'}/index.html`) });
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
                        result = await WorkServer.mergeFiles(items);
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
        const header = { "Access-Control-Allow-Origin": "*", "mode": 'no-cors', "Content-Type": "application/json" };
        // if (method === 'load_icon') {
        //     header['Content-Type'] = params.ext === 'png' ? 'image/png' : 'image/svg+xml';
        // }
        // else
        if (item?.constructor === CORE.$storage && method === 'load')
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
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Server error');
                });
            }
            else
                response.end(result);
        }
        else{
            response.writeHead(204, header);
            response.end(result);
        }
    }
    catch (e) {
        sendErrorResponse(response, e);
    }
    };
}