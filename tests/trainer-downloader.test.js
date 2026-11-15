/**
 * Тесты многопоточного Range-загрузчика, прокси-транспорта (HTTP + SOCKS5),
 * зеркал, защиты HF_TOKEN и совместимости со старыми .part-файлами.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

import {
    DEFAULT_HF_ORIGIN,
    HF_MIRROR_ORIGIN,
    canSendAuthToUrl,
    maskProxyUrl,
    mergeRanges,
    subtractRanges,
    sumRangesBytes,
    loadTrainerNetworkSettings,
    saveTrainerNetworkSettings,
    sanitizeTrainerNetworkForClient,
    createNetworkFetch,
    downloadFileMultipart,
    probeTrainerNetwork,
} from '../sources/modules/trainer/downloader.js';
import {
    startHuggingFaceDownload,
    computeDownloadEta,
    listHuggingFaceDownloads,
    pauseHuggingFaceDownload,
    restartActiveHuggingFaceDownloads,
    TRAINER_METHODS,
} from '../sources/modules/trainer/index.js';

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function makeTempDir(prefix = 'work-dl-test-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function startRangeServer(payloadBuf, opts = {}) {
    const requests = [];
    let fail429Once = Boolean(opts.fail429Once);
    let truncateOnce = Boolean(opts.truncateOnce);
    const server = http.createServer((req, res) => {
        requests.push({ method: req.method, url: req.url, range: req.headers.range || '', auth: req.headers.authorization || '' });

        if (req.url === '/api/models?limit=1') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([{ id: 'Qwen/Qwen3-0.6B' }]));
            return;
        }
        if (req.url.startsWith('/api/models/')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'Test/Model',
                siblings: [{ rfilename: 'weights.gguf', size: payloadBuf.length }],
            }));
            return;
        }
        if (req.url === '/redirect-to-cdn') {
            const target = opts.cdnBaseUrl ? `${opts.cdnBaseUrl}/cdn-file` : '/cdn-file';
            res.writeHead(302, { Location: target });
            res.end();
            return;
        }
        if (req.url === '/cdn-file') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authSeen: req.headers.authorization || '' }));
            return;
        }

        if (fail429Once && req.headers.range) {
            fail429Once = false;
            res.writeHead(429);
            res.end('Too Many Requests');
            return;
        }

        if (opts.noRange || !req.headers.range) {
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(payloadBuf.length),
            });
            res.end(payloadBuf);
            return;
        }

        const m = String(req.headers.range).match(/^bytes=(\d+)-(\d*)$/);
        if (!m) {
            res.writeHead(416);
            res.end();
            return;
        }
        const start = Number(m[1]);
        const end = m[2] ? Math.min(payloadBuf.length - 1, Number(m[2])) : payloadBuf.length - 1;
        if (start >= payloadBuf.length || end < start) {
            res.writeHead(416, { 'Content-Range': `bytes */${payloadBuf.length}` });
            res.end();
            return;
        }
        const slice = payloadBuf.subarray(start, end + 1);
        if (truncateOnce && slice.length > 64 * 1024 && start > 0) {
            truncateOnce = false;
            res.writeHead(206, {
                'Content-Type': 'application/octet-stream',
                'Content-Range': `bytes ${start}-${end}/${payloadBuf.length}`,
                'Content-Length': String(slice.length),
            });
            res.write(slice.subarray(0, 32 * 1024));
            res.socket?.destroy();
            return;
        }

        const resBody = slice;
        if (opts.chunkDelayMs) {
            res.writeHead(206, {
                'Content-Type': 'application/octet-stream',
                'Content-Range': `bytes ${start}-${end}/${payloadBuf.length}`,
                'Content-Length': String(resBody.length),
            });
            setTimeout(() => {
                if (!res.destroyed)
                    res.end(resBody);
            }, opts.chunkDelayMs);
            return;
        }

        res.writeHead(206, {
            'Content-Type': 'application/octet-stream',
            'Content-Range': `bytes ${start}-${end}/${payloadBuf.length}`,
            'Content-Length': String(slice.length),
        });
        res.end(slice);
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}`,
                requests,
                close: () => new Promise(r => server.close(r)),
            });
        });
    });
}

describe('trainer-downloader: многопоточная загрузка, прокси, зеркала и защита токенов', () => {

    it('mergeRanges / subtractRanges / sumRangesBytes корректно объединяют и вычитают интервалы', () => {
        assert.deepEqual(mergeRanges([[10, 20], [0, 10], [15, 25], [30, 40]]), [[0, 25], [30, 40]]);
        assert.deepEqual(subtractRanges(50, [[0, 10], [20, 35]]), [[10, 20], [35, 50]]);
        assert.equal(sumRangesBytes([[0, 10], [10, 25]]), 25);
    });

    it('downloadFileMultipart качает файл в несколько Range-потоков, выдерживает 429 и обрыв потока', async () => {
        const tmp = makeTempDir();
        // 10 МБ псевдослучайных данных (больше порога minMultipartBytes = 4 МБ)
        const payload = crypto.randomBytes(10 * 1024 * 1024);
        const srv = await startRangeServer(payload, { fail429Once: true, truncateOnce: true });
        try {
            const staged = path.join(tmp, 'model.gguf');
            const part = staged + '.part';
            const res = await downloadFileMultipart({
                url: `${srv.url}/model.gguf`,
                stagedFile: staged,
                partFile: part,
                expectedSize: payload.length,
                threads: 4,
                minMultipartBytes: 1024 * 1024,
                retryBaseDelayMs: 20,
            });
            assert.equal(res.multipart, true);
            assert.equal(res.rangeSupported, true);
            assert.equal(res.size, payload.length);

            const got = await fsp.readFile(staged);
            assert.equal(sha256(got), sha256(payload));
            assert.equal(fs.existsSync(part), false);

            const rangeReqs = srv.requests.filter(r => r.range);
            assert.ok(rangeReqs.length >= 4, `ожидалось >= 4 Range-запросов, получено ${rangeReqs.length}`);
        }
        finally {
            await srv.close();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('downloadFileMultipart бесшовно докачивает старый однопоточный .part (без потери готовых байт)', async () => {
        const tmp = makeTempDir();
        const payload = crypto.randomBytes(8 * 1024 * 1024);
        const already = 3 * 1024 * 1024 + 12345;
        const srv = await startRangeServer(payload);
        try {
            const staged = path.join(tmp, 'legacy.gguf');
            const part = staged + '.part';
            await fsp.writeFile(part, payload.subarray(0, already));

            const res = await downloadFileMultipart({
                url: `${srv.url}/legacy.gguf`,
                stagedFile: staged,
                partFile: part,
                expectedSize: payload.length,
                threads: 4,
                minMultipartBytes: 1024 * 1024,
            });
            assert.equal(res.size, payload.length);
            const got = await fsp.readFile(staged);
            assert.equal(sha256(got), sha256(payload));

            // Ни один запрос не должен запрашивать диапазон до `already`
            for (const req of srv.requests) {
                const m = req.range.match(/^bytes=(\d+)-/);
                if (m)
                    assert.ok(Number(m[1]) >= already, `повторно запрошены уже скачанные байты: ${req.range}`);
            }
        }
        finally {
            await srv.close();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('downloadFileMultipart откатывается на 1 поток, если сервер вернул 200 OK без Range', async () => {
        const tmp = makeTempDir();
        const payload = crypto.randomBytes(5 * 1024 * 1024);
        const srv = await startRangeServer(payload, { noRange: true });
        try {
            const staged = path.join(tmp, 'norange.gguf');
            const res = await downloadFileMultipart({
                url: `${srv.url}/norange.gguf`,
                stagedFile: staged,
                expectedSize: payload.length,
                threads: 6,
                minMultipartBytes: 1024 * 1024,
            });
            assert.equal(res.rangeSupported, false);
            assert.equal(res.multipart, false);
            assert.equal(srv.requests.length, 1, 'при 200 OK файл должен скачаться за 1 запрос без дублирования');
            const got = await fsp.readFile(staged);
            assert.equal(sha256(got), sha256(payload));
        }
        finally {
            await srv.close();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('createNetworkFetch сбрасывает Authorization при редиректе на сторонний origin и работает через HTTP-прокси', async () => {
        const payload = Buffer.from('hello');
        const cdnSrv = await startRangeServer(payload);
        const mainSrv = await startRangeServer(payload, { cdnBaseUrl: cdnSrv.url });

        let proxyAuthSeen = '';
        let proxyReqCount = 0;
        const proxySrv = http.createServer((req, res) => {
            proxyReqCount++;
            proxyAuthSeen = req.headers['proxy-authorization'] || '';
            const target = new URL(req.url);
            const fwd = http.request({
                hostname: target.hostname,
                port: target.port,
                path: target.pathname + target.search,
                method: req.method,
                headers: { ...req.headers, host: target.host },
            }, (up) => {
                res.writeHead(up.statusCode, up.headers);
                up.pipe(res);
            });
            req.pipe(fwd);
        });
        await new Promise(r => proxySrv.listen(0, '127.0.0.1', r));
        const proxyPort = proxySrv.address().port;

        try {
            const netFetch = createNetworkFetch({
                proxyUrl: `http://alice:s3cr3t@127.0.0.1:${proxyPort}`,
            });
            const res = await netFetch(`${mainSrv.url}/redirect-to-cdn`, {
                headers: { Authorization: 'Bearer hf_secret_token' },
            });
            assert.equal(res.ok, true);
            const json = await res.json();
            assert.equal(json.authSeen, '', 'Authorization не должен утекать при редиректе на другой origin');
            assert.equal(proxyReqCount, 2, 'оба хопа (источник и редирект CDN) должны пройти через прокси');
            assert.equal(proxyAuthSeen, `Basic ${Buffer.from('alice:s3cr3t').toString('base64')}`);
        }
        finally {
            await new Promise(r => proxySrv.close(r));
            await mainSrv.close();
            await cdnSrv.close();
        }
    });

    it('createNetworkFetch поддерживает SOCKS5-прокси с логином и паролем (RFC 1928 / RFC 1929)', async () => {
        const targetSrv = await startRangeServer(Buffer.from('ok'));
        let socksAuthOk = false;
        let socksTargetPort = 0;

        const socksSrv = net.createServer((client) => {
            let step = 'greet';
            let upstream = null;
            let buf = Buffer.alloc(0);

            client.on('data', (chunk) => {
                if (upstream) {
                    upstream.write(chunk);
                    return;
                }
                buf = Buffer.concat([buf, chunk]);
                if (step === 'greet') {
                    if (buf.length < 2)
                        return;
                    const nMethods = buf[1];
                    if (buf.length < 2 + nMethods)
                        return;
                    buf = buf.subarray(2 + nMethods);
                    step = 'auth';
                    client.write(Buffer.from([0x05, 0x02])); // выбрать username/password
                }
                if (step === 'auth') {
                    if (buf.length < 2)
                        return;
                    const uLen = buf[1];
                    if (buf.length < 2 + uLen + 1)
                        return;
                    const pLen = buf[2 + uLen];
                    if (buf.length < 3 + uLen + pLen)
                        return;
                    const user = buf.subarray(2, 2 + uLen).toString();
                    const pass = buf.subarray(3 + uLen, 3 + uLen + pLen).toString();
                    buf = buf.subarray(3 + uLen + pLen);
                    socksAuthOk = (user === 'bob' && pass === 'pass123');
                    step = 'connect';
                    client.write(Buffer.from([0x01, socksAuthOk ? 0x00 : 0x01]));
                }
                if (step === 'connect') {
                    if (buf.length < 4)
                        return;
                    const atyp = buf[3];
                    let addrLen = 0;
                    let host = '';
                    let offset = 4;
                    if (atyp === 0x01) {
                        addrLen = 4;
                        if (buf.length < offset + addrLen + 2)
                            return;
                        host = [...buf.subarray(offset, offset + 4)].join('.');
                    }
                    else if (atyp === 0x03) {
                        if (buf.length < offset + 1)
                            return;
                        addrLen = buf[offset];
                        offset += 1;
                        if (buf.length < offset + addrLen + 2)
                            return;
                        host = buf.subarray(offset, offset + addrLen).toString();
                    }
                    const port = buf.readUInt16BE(offset + addrLen);
                    socksTargetPort = port;
                    const rest = buf.subarray(offset + addrLen + 2);
                    buf = Buffer.alloc(0);
                    step = 'relay';
                    upstream = net.connect(port, host, () => {
                        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
                        if (rest.length)
                            upstream.write(rest);
                        upstream.on('data', d => client.write(d));
                        upstream.on('close', () => client.destroy());
                        upstream.on('error', () => client.destroy());
                    });
                }
            });
            client.on('close', () => upstream?.destroy());
            client.on('error', () => upstream?.destroy());
        });
        await new Promise(r => socksSrv.listen(0, '127.0.0.1', r));
        const socksPort = socksSrv.address().port;

        try {
            const netFetch = createNetworkFetch({
                proxyUrl: `socks5h://bob:pass123@127.0.0.1:${socksPort}`,
            });
            const res = await netFetch(`${targetSrv.url}/api/models?limit=1`);
            assert.equal(res.ok, true);
            const data = await res.json();
            assert.equal(data[0].id, 'Qwen/Qwen3-0.6B');
            assert.equal(socksAuthOk, true);
            assert.equal(socksTargetPort, Number(new URL(targetSrv.url).port));
        }
        finally {
            await new Promise(r => socksSrv.close(r));
            await targetSrv.close();
        }
    });

    it('HF_TOKEN защищён (только huggingface.co), настройки сети сохраняются в #system/trainer-network.json с маскированием секретов', async () => {
        assert.equal(canSendAuthToUrl('https://huggingface.co/api/models', DEFAULT_HF_ORIGIN), true);
        assert.equal(canSendAuthToUrl('https://hf-mirror.com/api/models', HF_MIRROR_ORIGIN), false);
        assert.equal(canSendAuthToUrl('https://cas-bridge.xethub.hf.co/blob', DEFAULT_HF_ORIGIN), false);
        assert.equal(maskProxyUrl('socks5://user:topsecret@10.0.0.1:1080'), 'socks5://user:***@10.0.0.1:1080');

        assert.equal(TRAINER_METHODS.trainer_network_get.level, 'admin');
        assert.equal(TRAINER_METHODS.trainer_network_set.level, 'admin');
        assert.equal(TRAINER_METHODS.trainer_network_probe.level, 'admin');

        const tmp = makeTempDir();
        try {
            const fakeToken = ['hf', '1234567890', 'abcdef'].join('_');
            saveTrainerNetworkSettings({
                sourcePreset: 'hf-mirror',
                proxyUrl: 'socks5://alice:pwd123@127.0.0.1:1080',
                threads: 12,
                token: fakeToken,
            }, tmp);

            // Повторное сохранение с замаскированным proxyUrl не должно затирать пароль и токен
            const masked = sanitizeTrainerNetworkForClient(loadTrainerNetworkSettings(tmp));
            assert.equal(masked.sourcePreset, 'hf-mirror');
            assert.equal(masked.endpointUrl, HF_MIRROR_ORIGIN);
            assert.equal(masked.proxyUrl, 'socks5://alice:***@127.0.0.1:1080');
            assert.equal(masked.hasToken, true);
            assert.ok(!masked.tokenMask.includes('1234567890'));

            const afterReSave = saveTrainerNetworkSettings({
                sourcePreset: 'hf-mirror',
                proxyUrl: masked.proxyUrl,
                threads: 8,
            }, tmp);
            assert.equal(afterReSave.proxyUrl, 'socks5://alice:pwd123@127.0.0.1:1080');
            assert.equal(afterReSave.token, fakeToken);
            assert.equal(afterReSave.threads, 8);
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('startHuggingFaceDownload использует выбранный endpoint + probeTrainerNetwork замеряет скорость', async () => {
        const tmp = makeTempDir();
        const payload = crypto.randomBytes(3 * 1024 * 1024);
        const srv = await startRangeServer(payload);
        try {
            saveTrainerNetworkSettings({
                sourcePreset: 'custom',
                endpointUrl: srv.url,
                threads: 4,
            }, tmp);

            const probe = await probeTrainerNetwork({
                rootDir: tmp,
                probeBytes: 512 * 1024,
            });
            assert.equal(probe.ok, true);
            assert.equal(probe.rangeSupported, true);
            assert.ok(probe.speedMBs > 0);

            const job = await startHuggingFaceDownload({
                repoId: 'Test/Model',
                quant: '',
                rootDir: tmp,
                registerInWork: false,
                waitForCompletion: true,
            });
            assert.equal(job.status, 'completed');
            assert.equal(job.endpointUrl, srv.url);
            assert.equal(job.threads, 4);

            const outFile = path.join(job.weightsDir, 'weights.gguf');
            const got = await fsp.readFile(outFile);
            assert.equal(sha256(got), sha256(payload));
            assert.equal(listHuggingFaceDownloads(tmp).filter(d => d.repoId === 'Test/Model' && d.status === 'downloading').length, 0);
        }
        finally {
            await srv.close();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('restartActiveHuggingFaceDownloads бесшовно переключает активную загрузку на новый источник и потоки', async () => {
        const tmp = makeTempDir();
        const payload = crypto.randomBytes(6 * 1024 * 1024);
        const srv1 = await startRangeServer(payload, { chunkDelayMs: 400 });
        const srv2 = await startRangeServer(payload);
        try {
            saveTrainerNetworkSettings({
                sourcePreset: 'custom',
                endpointUrl: srv1.url,
                threads: 2,
            }, tmp);

            const job1 = await startHuggingFaceDownload({
                repoId: 'Test/SwitchModel',
                quant: '',
                rootDir: tmp,
                registerInWork: false,
                waitForCompletion: false,
            });
            assert.equal(job1.endpointUrl, srv1.url);
            assert.equal(job1.threads, 2);

            await new Promise(r => setTimeout(r, 40));

            saveTrainerNetworkSettings({
                sourcePreset: 'custom',
                endpointUrl: srv2.url,
                threads: 4,
            }, tmp);

            const restarted = await restartActiveHuggingFaceDownloads({ rootDir: tmp });
            assert.equal(restarted.length, 1);
            assert.equal(restarted[0].endpointUrl, srv2.url);
            assert.equal(restarted[0].threads, 4);

            // Дожидаемся завершения новой задачи
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                const active = listHuggingFaceDownloads(tmp).find(d => d.repoId === 'Test/SwitchModel');
                if (!active || active.status === 'completed')
                    break;
                if (active.status === 'failed')
                    assert.fail(`Загрузка упала после рестарта: ${active.error}`);
                await new Promise(r => setTimeout(r, 50));
            }

            const outFile = path.join(restarted[0].weightsDir, 'weights.gguf');
            const got = await fsp.readFile(outFile);
            assert.equal(sha256(got), sha256(payload));
            assert.ok(srv2.requests.length >= 1, 'новая загрузка должна идти со второго сервера');
        }
        finally {
            await srv1.close();
            await srv2.close();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('computeDownloadEta считает по устойчивой средней скорости, а не по 5-секундной просадке', () => {
        // Реальные числа незавершённой загрузки Qwen3.8-Flash-Next: 50,9 ГБ из 307 ГБ за ~3 часа,
        // текущая мгновенная скорость просела до 0,22 МБ/с, средняя — 4,5 МБ/с.
        const remaining = 307069219876 - 50931797771;
        const shortBytesPerSec = 0.22 * 1024 * 1024;
        const avgBytesPerSec = 4.5 * 1024 * 1024;

        const eta = computeDownloadEta({ remainingBytes: remaining, avgBytesPerSec, shortBytesPerSec });
        assert.ok(eta > 50000 && eta < 80000, `ETA должно быть ~15–16 ч, получено ${Math.round(eta / 3600)} ч`);
        assert.equal(eta, Math.round(remaining / avgBytesPerSec), 'приоритет у средней скорости');

        // Без накопленной средней — запасной расчёт по мгновенной (старое поведение)
        assert.equal(
            computeDownloadEta({ remainingBytes: remaining, avgBytesPerSec: 0, shortBytesPerSec }),
            Math.round(remaining / shortBytesPerSec)
        );
        assert.equal(computeDownloadEta({ remainingBytes: 0, avgBytesPerSec }), 0);
        assert.equal(computeDownloadEta({ remainingBytes: 1024 * 1024, avgBytesPerSec: 100, shortBytesPerSec: 100 }), null);
    });

    it('зависшее соединение обрывается по таймауту простоя и уходит в переподключение', async () => {
        const tmp = makeTempDir();
        const payload = crypto.randomBytes(256 * 1024);
        let requests = 0;

        const stalledBody = (firstChunk) => ({
            [Symbol.asyncIterator]() {
                let step = 0;
                return {
                    next() {
                        if (step === 0) {
                            step = 1;
                            return Promise.resolve({ done: false, value: firstChunk });
                        }
                        // «Соединение открыто, но данные не приходят»
                        return new Promise(() => {});
                    },
                    return() {
                        return Promise.resolve({ done: true, value: undefined });
                    },
                };
            },
            cancel() { /* ignore */ },
        });

        const fetchImpl = async (url, opts = {}) => {
            requests++;
            const m = String(opts.headers?.Range || '').match(/^bytes=(\d+)-(\d*)$/);
            const start = m ? Number(m[1]) : 0;
            const end = m && m[2] ? Math.min(payload.length - 1, Number(m[2])) : payload.length - 1;
            const slice = payload.subarray(start, end + 1);
            const headers = new Map([
                ['content-range', `bytes ${start}-${end}/${payload.length}`],
                ['content-length', String(slice.length)],
            ]);
            if (requests === 1)
                return { ok: true, status: 206, headers, body: stalledBody(slice.subarray(0, 1024)) };
            return {
                ok: true,
                status: 206,
                headers,
                body: (async function* () { yield slice; })(),
            };
        };

        try {
            const staged = path.join(tmp, 'stall.bin');
            const part = staged + '.part';
            const res = await downloadFileMultipart({
                url: 'https://example.test/stall.bin',
                stagedFile: staged,
                partFile: part,
                expectedSize: payload.length,
                threads: 1,
                fetchImpl,
                idleTimeoutMs: 150,
                retryBaseDelayMs: 10,
                maxRetries: 5,
            });

            assert.equal(res.size, payload.length);
            assert.ok(requests >= 2, 'после зависания должен пройти повторный запрос');
            assert.equal(sha256(await fsp.readFile(staged)), sha256(payload));
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('живая загрузка накапливает устойчивую среднюю скорость и сохраняет статистику для ETA', async () => {
        const tmp = makeTempDir();
        const payload = crypto.randomBytes(2 * 1024 * 1024);
        const chunkBytes = 32 * 1024;

        // Медленный поток: 64 чанка по 50 мс — чтобы накопилось ~3 с активной передачи
        const fetchImpl = async (url, opts = {}) => {
            const u = String(url);
            if (u.includes('/api/models/')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: 'Test/Model',
                        siblings: [{ rfilename: 'weights.gguf', size: payload.length }],
                    }),
                };
            }
            const m = String(opts.headers?.Range || '').match(/^bytes=(\d+)-(\d*)$/);
            const start = m ? Number(m[1]) : 0;
            const end = m && m[2] ? Math.min(payload.length - 1, Number(m[2])) : payload.length - 1;
            const body = (async function* () {
                for (let off = start; off <= end; off += chunkBytes) {
                    yield payload.subarray(off, Math.min(end + 1, off + chunkBytes));
                    await new Promise(r => setTimeout(r, 50));
                }
            })();
            return {
                ok: true,
                status: start > 0 ? 206 : 200,
                headers: new Map([
                    ['content-range', `bytes ${start}-${end}/${payload.length}`],
                    ['content-length', String(end - start + 1)],
                ]),
                body,
            };
        };

        let job = null;
        try {
            job = await startHuggingFaceDownload({
                repoId: 'Test/Model',
                quant: '',
                rootDir: tmp,
                registerInWork: false,
                threads: 1,
                waitForCompletion: false,
                fetchImpl,
            });

            let snap = null;
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                snap = listHuggingFaceDownloads(tmp).find(d => d.folderName === job.folderName);
                if (snap?.avgSpeedMBs > 0)
                    break;
                await new Promise(r => setTimeout(r, 50));
            }
            assert.ok(snap, 'загрузка должна быть видна в списке');
            assert.ok(snap.avgSpeedMBs > 0, 'средняя скорость должна считаться по накопленному времени');
            assert.ok(snap.etaSeconds > 0, 'ETA должно считаться по средней скорости');
            assert.equal(snap.stalled, false, 'данные идут — простоя нет');

            const state = JSON.parse(await fsp.readFile(path.join(job.weightsDir, 'download-state.json'), 'utf-8'));
            assert.equal(state.stats.baseBytes, 0);
            assert.ok(state.stats.activeMs > 0, 'активное время передачи должно сохраняться в состояние');
        }
        finally {
            if (job)
                pauseHuggingFaceDownload(job.id);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
