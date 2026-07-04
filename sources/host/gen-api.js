import * as https from 'node:https';
import * as http from 'node:http';
import * as mime from 'mime-types';
import { GEN_API_TOKEN } from './config.js';

const API_BASE = 'https://api.gen-api.ru/api/v1';

function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === 'https:' ? https : http;
        const opts = {
            method,
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            headers: {
                Accept: 'application/json',
                ...headers,
            },
        };
        const req = client.request(opts, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const type = res.headers['content-type'] || '';
                if (type.includes('application/json')) {
                    try {
                        resolve(JSON.parse(buffer.toString('utf-8')));
                    }
                    catch (e) {
                        reject(e);
                    }
                    return;
                }
                resolve({
                    buffer,
                    contentType: type,
                    contentLength: res.headers['content-length'],
                });
            });
        });
        req.on('error', reject);
        if (body != null) {
            const payload = typeof body === 'string' ? body : JSON.stringify(body);
            opts.headers['Content-Type'] ??= 'application/json';
            req.write(payload);
        }
        req.end();
    });
}

export function buildGenApiPayload(metadata = {}, data = {}) {
    const payload = {};
    for (const [key, spec] of Object.entries(metadata)) {
        if (key === 'service')
            continue;
        if (data[key] != null && data[key] !== '') {
            payload[key] = data[key];
            continue;
        }
        if (spec?.value != null)
            payload[key] = spec.value;
    }
    return payload;
}

export function collectGenApiResultUrls(result) {
    const urls = [];
    if (Array.isArray(result?.result)) {
        for (const item of result.result) {
            if (typeof item === 'string' && /^https?:\/\//.test(item))
                urls.push(item);
            else if (item?.url)
                urls.push(item.url);
        }
    }
    if (Array.isArray(result?.full_response)) {
        for (const item of result.full_response) {
            if (item?.url)
                urls.push(item.url);
        }
    }
    if (Array.isArray(result?.output)) {
        for (const item of result.output) {
            if (typeof item === 'string' && /^https?:\/\//.test(item))
                urls.push(item);
            else if (item?.url)
                urls.push(item.url);
        }
    }
    return urls.filter(Boolean);
}

export class GenApiClient {
    token = '';

    setAuthToken(token) {
        this.token = token || '';
    }

    getToken() {
        return this.token || GEN_API_TOKEN || '';
    }

    authHeaders() {
        const token = this.getToken();
        if (!token)
            throw new Error('WORK_GEN_API_TOKEN не задан');
        return { Authorization: 'Bearer ' + token };
    }

    async createNetworkTask(networkId, input) {
        const url = `${API_BASE}/networks/${networkId}`;
        return httpRequest(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: input,
        });
    }

    async getRequest(requestId) {
        const url = `${API_BASE}/request/get/${requestId}`;
        return httpRequest(url, { headers: this.authHeaders() });
    }

    async waitForCompletion(requestId, { intervalMs = 5000, timeoutMs = 300000 } = {}) {
        const started = Date.now();
        for (;;) {
            const taskInfo = await this.getRequest(requestId);
            const status = taskInfo?.status;
            if (status === 'success')
                return taskInfo;
            if (status === 'failed')
                throw new Error(taskInfo?.message || taskInfo?.error || JSON.stringify(taskInfo));
            if (Date.now() - started > timeoutMs)
                throw new Error('GenAPI: превышено время ожидания');
            await new Promise(r => setTimeout(r, intervalMs));
        }
    }

    async downloadAsset(url) {
        return httpRequest(url);
    }

    async executeImageNetwork(networkId, input, { save_file, metadata } = {}) {
        if (!save_file)
            throw new Error('save_file обязателен');
        const payload = metadata ? buildGenApiPayload(metadata, input) : input;
        const created = await this.createNetworkTask(networkId, payload);
        const requestId = created?.request_id ?? created?.id;
        if (!requestId)
            throw new Error('GenAPI: нет request_id в ответе');
        const result = await this.waitForCompletion(requestId);
        const urls = collectGenApiResultUrls(result);
        if (!urls.length)
            throw new Error('GenAPI: пустой результат генерации');

        const saved = [];
        for (let i = 0; i < urls.length; i++) {
            const asset = await this.downloadAsset(urls[i]);
            if (!asset?.buffer)
                continue;
            const ext = mime.extension(asset.contentType) || payload.output_format || 'jpeg';
            const filename = urls.length > 1 ? `image-${i + 1}.${ext}` : `image.${ext}`;
            const log = await save_file({
                filename,
                post: asset.buffer,
            });
            if (log?.logFullPath || log?.path)
                saved.push(log.logFullPath || log.path);
        }
        if (!saved.length)
            throw new Error('GenAPI: не удалось сохранить изображения');
        return { result, saved };
    }
}

export const genApi = new GenApiClient();
