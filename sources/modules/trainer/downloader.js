/**
 * Сетевой транспорт и многопоточный Range-загрузчик для моделей ИИ и рантаймов WORK:
 * - настройки источника (официальный Hugging Face, HF-Mirror, свой URL), потоков и прокси в `#system/trainer-network.json`;
 * - встроенная поддержка прокси `http://`, `https://`, `socks5://`, `socks5h://` (без внешних npm-зависимостей);
 * - защита `HF_TOKEN`: токен отправляется только на `huggingface.co` и сбрасывается при редиректах на сторонние CDN/зеркала;
 * - многопоточная `Range`-загрузка с записью напрямую по смещениям в `.part` и бесшовной докачкой старых однопоточных `.part`;
 * - автоматический откат на 1 поток, если сервер не поддерживает `Range` (вернул `200 OK`), и замер скорости (`probeTrainerNetwork`).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

export const DEFAULT_HF_ORIGIN = 'https://huggingface.co';
export const HF_MIRROR_ORIGIN = 'https://hf-mirror.com';
export const NETWORK_SETTINGS_REL = '#system/trainer-network.json';

export const SOURCE_PRESETS = Object.freeze([
    {
        id: 'official',
        label: 'Официальный Hugging Face',
        url: DEFAULT_HF_ORIGIN,
        hint: 'Прямой доступ к huggingface.co (поддерживает HF_TOKEN для закрытых моделей)',
    },
    {
        id: 'hf-mirror',
        label: 'HF-Mirror (зеркало)',
        url: HF_MIRROR_ORIGIN,
        hint: 'Быстрое публичное зеркало при ограничениях или низкой скорости до huggingface.co',
    },
    {
        id: 'custom',
        label: 'Свой URL / зеркало',
        url: '',
        hint: 'Корпоративный кэш-сервер или локальное зеркало (формат http(s)://...)',
    },
]);

export const THREAD_OPTIONS = Object.freeze([1, 4, 8, 12]);
export const DEFAULT_THREADS = 8;
export const DEFAULT_PARALLEL_FILES = 2;
export const DEFAULT_MIN_MULTIPART_BYTES = 4 * 1024 * 1024; // 4 МБ
/** Сколько миллисекунд молчания соединения считаем зависанием (после — переподключение). */
export const DEFAULT_IDLE_TIMEOUT_MS = 45000;

const ALLOWED_ENDPOINT_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);

/**
 * Проверить и нормализовать URL источника моделей (HF / зеркало).
 */
export function normalizeEndpointUrl(rawUrl) {
    const clean = String(rawUrl || '').trim().replace(/\/+$/, '');
    if (!clean)
        return DEFAULT_HF_ORIGIN;
    let parsed;
    try {
        parsed = new URL(clean);
    }
    catch {
        throw new Error(`Некорректный URL источника моделей: ${clean}`);
    }
    if (!ALLOWED_ENDPOINT_PROTOCOLS.has(parsed.protocol))
        throw new Error(`Недопустимый протокол источника (${parsed.protocol}) — разрешены только http:// и https://`);
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`.replace(/\/+$/, '');
}

/**
 * Проверить и нормализовать URL прокси (`http://`, `https://`, `socks5://`, `socks5h://`).
 */
export function normalizeProxyUrl(rawUrl) {
    const clean = String(rawUrl || '').trim();
    if (!clean)
        return '';
    let parsed;
    try {
        parsed = new URL(clean);
    }
    catch {
        throw new Error('Некорректный URL прокси (ожидается http://host:port или socks5://host:port)');
    }
    if (!ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol))
        throw new Error(`Неподдерживаемый протокол прокси (${parsed.protocol}) — используйте http://, https://, socks5:// или socks5h://`);
    if (!parsed.hostname)
        throw new Error('В адресе прокси не указан хост');
    return parsed.toString();
}

/**
 * Маскировать пароль в URL прокси для логов, ошибок и ответов UI.
 */
export function maskProxyUrl(rawUrl) {
    const clean = String(rawUrl || '').trim();
    if (!clean)
        return '';
    try {
        const u = new URL(clean);
        if (u.password)
            u.password = '***';
        else if (u.username)
            u.username = '***';
        return u.toString();
    }
    catch {
        return clean.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
    }
}

/**
 * Определить источник моделей по умолчанию/настройкам.
 */
export function resolveSourcePreset(endpointUrl) {
    const norm = normalizeEndpointUrl(endpointUrl || DEFAULT_HF_ORIGIN);
    if (norm === DEFAULT_HF_ORIGIN)
        return 'official';
    if (norm === HF_MIRROR_ORIGIN)
        return 'hf-mirror';
    return 'custom';
}

/**
 * Проверить, можно ли отправлять заголовок `Authorization: Bearer <HF_TOKEN>` на указанный URL.
 * Токен Hugging Face отправляется строго только на официальный `huggingface.co` (и поддомены),
 * чтобы не утекать на публичные зеркала (hf-mirror.com) и внешние CDN (xethub/S3 при редиректах).
 */
export function canSendAuthToUrl(targetUrl, endpointUrl = DEFAULT_HF_ORIGIN) {
    try {
        const target = new URL(String(targetUrl || ''));
        const ep = new URL(String(endpointUrl || DEFAULT_HF_ORIGIN));
        const th = target.hostname.toLowerCase();
        const eh = ep.hostname.toLowerCase();
        if (th !== eh)
            return false;
        return th === 'huggingface.co' || th.endsWith('.huggingface.co');
    }
    catch {
        return false;
    }
}

/**
 * Человекочитаемое имя источника для карточки загрузки.
 */
export function describeSourceLabel(endpointUrl) {
    const norm = normalizeEndpointUrl(endpointUrl || DEFAULT_HF_ORIGIN);
    if (norm === DEFAULT_HF_ORIGIN)
        return 'huggingface.co';
    if (norm === HF_MIRROR_ORIGIN)
        return 'hf-mirror';
    try {
        return new URL(norm).host;
    }
    catch {
        return norm;
    }
}

/**
 * Прочитать сетевые настройки загрузчика из `#system/trainer-network.json` + переменных окружения.
 */
export function loadTrainerNetworkSettings(rootDir = process.cwd()) {
    const filePath = path.join(path.resolve(rootDir), NETWORK_SETTINGS_REL);
    let saved = {};
    if (fs.existsSync(filePath)) {
        try {
            saved = JSON.parse(fs.readFileSync(filePath, 'utf-8')) || {};
        }
        catch { /* повреждённый JSON — берём дефолты */ }
    }

    const envEndpoint = String(process.env.HF_ENDPOINT || '').trim();
    const envProxy = String(process.env.HF_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '').trim();
    const envToken = String(process.env.HF_TOKEN || '').trim();

    let endpointUrl = DEFAULT_HF_ORIGIN;
    try {
        endpointUrl = normalizeEndpointUrl(saved.endpointUrl || envEndpoint || DEFAULT_HF_ORIGIN);
    }
    catch {
        endpointUrl = DEFAULT_HF_ORIGIN;
    }

    let proxyUrl = '';
    try {
        proxyUrl = normalizeProxyUrl(saved.proxyUrl ?? envProxy ?? '');
    }
    catch {
        proxyUrl = '';
    }

    const rawThreads = Number(saved.threads);
    const threads = Number.isFinite(rawThreads) && rawThreads >= 1
        ? Math.min(16, Math.max(1, Math.round(rawThreads)))
        : DEFAULT_THREADS;

    const rawParallelFiles = Number(saved.parallelFiles);
    const parallelFiles = Number.isFinite(rawParallelFiles) && rawParallelFiles >= 1
        ? Math.min(4, Math.max(1, Math.round(rawParallelFiles)))
        : DEFAULT_PARALLEL_FILES;

    const token = String(saved.token || envToken || '').trim();
    const sourcePreset = saved.sourcePreset && ['official', 'hf-mirror', 'custom'].includes(saved.sourcePreset)
        ? (saved.sourcePreset === 'official' && endpointUrl !== DEFAULT_HF_ORIGIN ? resolveSourcePreset(endpointUrl) : saved.sourcePreset)
        : resolveSourcePreset(endpointUrl);

    return {
        sourcePreset,
        endpointUrl,
        sourceLabel: describeSourceLabel(endpointUrl),
        proxyUrl,
        proxyFromEnv: !saved.proxyUrl && Boolean(envProxy),
        threads,
        parallelFiles,
        token,
        tokenFromEnv: !saved.token && Boolean(envToken),
        updatedAt: saved.updatedAt || null,
    };
}

/**
 * Безопасное представление настроек для клиента/UI (без раскрытия пароля прокси и HF_TOKEN).
 */
export function sanitizeTrainerNetworkForClient(cfg) {
    const s = cfg || loadTrainerNetworkSettings();
    let proxyHasAuth = false;
    try {
        if (s.proxyUrl) {
            const u = new URL(s.proxyUrl);
            proxyHasAuth = Boolean(u.username || u.password);
        }
    }
    catch { /* ignore */ }

    return {
        sourcePreset: s.sourcePreset,
        endpointUrl: s.endpointUrl,
        sourceLabel: s.sourceLabel || describeSourceLabel(s.endpointUrl),
        proxyUrl: maskProxyUrl(s.proxyUrl),
        hasProxy: Boolean(s.proxyUrl),
        proxyHasAuth,
        proxyFromEnv: Boolean(s.proxyFromEnv),
        threads: s.threads,
        parallelFiles: s.parallelFiles,
        hasToken: Boolean(s.token),
        tokenMask: s.token ? `${s.token.slice(0, 4)}…${s.token.slice(-4)}` : '',
        tokenFromEnv: Boolean(s.tokenFromEnv),
        presets: SOURCE_PRESETS,
        threadOptions: THREAD_OPTIONS,
        updatedAt: s.updatedAt || null,
    };
}

/**
 * Сохранить сетевые настройки загрузчика в `#system/trainer-network.json`.
 */
export function saveTrainerNetworkSettings(patch = {}, rootDir = process.cwd()) {
    const filePath = path.join(path.resolve(rootDir), NETWORK_SETTINGS_REL);
    let prevRaw = {};
    if (fs.existsSync(filePath)) {
        try {
            prevRaw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) || {};
        }
        catch { /* ignore */ }
    }

    let sourcePreset = patch.sourcePreset ?? prevRaw.sourcePreset ?? '';
    let endpointInput = patch.endpointUrl !== undefined ? patch.endpointUrl : prevRaw.endpointUrl;
    if (patch.sourcePreset === 'official' && patch.endpointUrl === undefined)
        endpointInput = DEFAULT_HF_ORIGIN;
    else if (patch.sourcePreset === 'hf-mirror' && patch.endpointUrl === undefined)
        endpointInput = HF_MIRROR_ORIGIN;

    const endpointUrl = normalizeEndpointUrl(endpointInput || DEFAULT_HF_ORIGIN);
    if (!['official', 'hf-mirror', 'custom'].includes(sourcePreset))
        sourcePreset = resolveSourcePreset(endpointUrl);

    let proxyUrl = prevRaw.proxyUrl || '';
    if (patch.clearProxy === true || patch.clearProxy === 'true') {
        proxyUrl = '';
    }
    else if (patch.proxyUrl !== undefined) {
        const incoming = String(patch.proxyUrl || '').trim();
        if (!incoming) {
            proxyUrl = '';
        }
        else {
            const normalized = normalizeProxyUrl(incoming);
            // Если пользователь не менял замаскированный пароль (`***`), оставляем прежний секрет
            const prevMasked = maskProxyUrl(prevRaw.proxyUrl || '');
            if (prevRaw.proxyUrl && (incoming === prevMasked || normalized === prevMasked))
                proxyUrl = prevRaw.proxyUrl;
            else
                proxyUrl = normalized;
        }
    }

    let token = prevRaw.token || '';
    if (patch.clearToken === true || patch.clearToken === 'true') {
        token = '';
    }
    else if (patch.token !== undefined) {
        const incomingToken = String(patch.token || '').trim();
        if (incomingToken && !incomingToken.includes('…') && incomingToken !== '***')
            token = incomingToken;
        else if (!incomingToken && patch.token === '')
            token = prevRaw.token || '';
    }

    const rawThreads = patch.threads !== undefined ? Number(patch.threads) : Number(prevRaw.threads || DEFAULT_THREADS);
    const threads = Number.isFinite(rawThreads) && rawThreads >= 1
        ? Math.min(16, Math.max(1, Math.round(rawThreads)))
        : DEFAULT_THREADS;

    const rawParallelFiles = patch.parallelFiles !== undefined ? Number(patch.parallelFiles) : Number(prevRaw.parallelFiles || DEFAULT_PARALLEL_FILES);
    const parallelFiles = Number.isFinite(rawParallelFiles) && rawParallelFiles >= 1
        ? Math.min(4, Math.max(1, Math.round(rawParallelFiles)))
        : DEFAULT_PARALLEL_FILES;

    const next = {
        sourcePreset,
        endpointUrl,
        proxyUrl,
        threads,
        parallelFiles,
        token,
        updatedAt: Date.now(),
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    return loadTrainerNetworkSettings(rootDir);
}

// ── Прокси-транспорт (HTTP CONNECT + SOCKS5/SOCKS5h без внешних пакетов) ────

const NOOP = () => {};
const _guardedBodies = new WeakSet();

/**
 * Повесить страхующий обработчик `'error'` на поток тела ответа (`Readable` или
 * web `ReadableStream`), чтобы фоновый обрыв соединения (например `UND_ERR_RES_CONTENT_LENGTH_MISMATCH`)
 * никогда не превращался в неперехваченный `uncaughtException` EventEmitter'а.
 */
export function guardBody(body) {
    if (!body || typeof body !== 'object')
        return body;
    if (_guardedBodies.has(body))
        return body;
    _guardedBodies.add(body);
    try { body.on?.('error', NOOP); } catch { /* ignore */ }
    try { body.addEventListener?.('error', NOOP); } catch { /* ignore */ }
    return body;
}

/**
 * Безопасно закрыть и отменить неиспользованное/прерванное тело ответа,
 * гарантированно подавляя асинхронные отказы `cancel()`/`return()` на уже упавшем потоке.
 */
export async function discardBody(res) {
    const body = res?.body ?? res;
    if (!body || typeof body !== 'object')
        return;
    guardBody(body);
    try {
        const p = body.cancel?.();
        if (p && typeof p.then === 'function')
            await p.catch(NOOP);
    }
    catch { /* ignore */ }
    try { body.destroy?.(); } catch { /* ignore */ }
}

function makeAbortError(msg = 'Запрос отменён') {
    const err = new Error(msg);
    err.name = 'AbortError';
    return err;
}

/**
 * Ошибка «источник молчит»: соединение открыто, но данные не приходят.
 * Помечается retryable, чтобы сегмент переподключился вместо бесконечного ожидания.
 */
function makeStallError(idleTimeoutMs) {
    const seconds = Math.max(1, Math.round((Number(idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS) / 1000));
    const err = new Error(`Источник не передаёт данные дольше ${seconds} с — переподключаюсь`);
    err.retryable = true;
    err.stalled = true;
    return err;
}

/**
 * `fetch` с таймаутом ожидания заголовков ответа: зависшее соединение обрывается
 * и уходит в штатный авто-повтор, а не висит до перезапуска сервера.
 */
async function fetchWithIdleTimeout(netFetch, url, options = {}, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS) {
    const parentSignal = options.signal;
    if (parentSignal?.aborted)
        throw makeAbortError('Загрузка приостановлена пользователем');
    const local = new AbortController();
    let stalled = false;
    const onAbort = () => {
        try { local.abort(); } catch { /* ignore */ }
    };
    parentSignal?.addEventListener?.('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
        stalled = true;
        onAbort();
    }, idleTimeoutMs);
    try {
        return await netFetch(url, { ...options, signal: local.signal });
    }
    catch (err) {
        if (stalled)
            throw makeStallError(idleTimeoutMs);
        throw err;
    }
    finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener?.('abort', onAbort);
    }
}

/**
 * Чтение тела ответа с таймаутом простоя: если очередной чанк не пришёл за
 * `idleTimeoutMs`, чтение прерывается ошибкой `makeStallError`.
 */
export function makeIdleChunkReader(body, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS) {
    guardBody(body);
    const iterator = body[Symbol.asyncIterator]();
    let closed = false;
    const next = async () => {
        let timer = null;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(makeStallError(idleTimeoutMs)), idleTimeoutMs);
        });
        const chunkPromise = iterator.next();
        chunkPromise.catch(NOOP);
        try {
            return await Promise.race([chunkPromise, timeoutPromise]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    };
    const close = () => {
        if (closed)
            return;
        closed = true;
        // На уже упавшем потоке iterator.return() и body.cancel() возвращают отклонённый
        // промис (например TypeError: terminated) — обязаны гасить их через .catch(),
        // иначе Node завершает процесс по unhandledRejection.
        try {
            const ret = iterator.return?.();
            if (ret && typeof ret.then === 'function')
                ret.catch(NOOP);
        }
        catch { /* ignore */ }
        try {
            const can = body.cancel?.();
            if (can && typeof can.then === 'function')
                can.catch(NOOP);
        }
        catch { /* ignore */ }
        try { body.destroy?.(); } catch { /* ignore */ }
    };
    return { next, close };
}

function readExactBytes(socket, count, { signal, buffered = [] } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(makeAbortError());
        const chunks = [];
        let total = 0;

        const drainBuffered = () => {
            while (buffered.length && total < count) {
                const head = buffered[0];
                const need = count - total;
                if (head.length <= need) {
                    chunks.push(buffered.shift());
                    total += head.length;
                }
                else {
                    chunks.push(head.subarray(0, need));
                    buffered[0] = head.subarray(need);
                    total += need;
                }
            }
        };

        drainBuffered();
        if (total >= count)
            return resolve(Buffer.concat(chunks, count));

        const cleanup = () => {
            socket.off('data', onData);
            socket.off('error', onError);
            socket.off('close', onClose);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(makeAbortError());
        };
        const onError = (err) => {
            cleanup();
            reject(err);
        };
        const onClose = () => {
            cleanup();
            reject(new Error('Прокси-соединение закрыто до завершения рукопожатия'));
        };
        const onData = (chunk) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            buffered.push(buf);
            drainBuffered();
            if (total >= count) {
                cleanup();
                resolve(Buffer.concat(chunks, count));
            }
        };

        socket.on('data', onData);
        socket.once('error', onError);
        socket.once('close', onClose);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function openTcpOrTls(host, port, useTls, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(makeAbortError());
        const sock = useTls
            ? tls.connect({ host, port, servername: host })
            : net.connect({ host, port });

        const ev = useTls ? 'secureConnect' : 'connect';
        const cleanup = () => {
            sock.off(ev, onConnect);
            sock.off('error', onError);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            sock.destroy();
            reject(makeAbortError());
        };
        const onConnect = () => {
            cleanup();
            resolve(sock);
        };
        const onError = (err) => {
            cleanup();
            sock.destroy();
            reject(err);
        };
        sock.once(ev, onConnect);
        sock.once('error', onError);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

async function openHttpProxyTunnel(proxyParsed, targetHost, targetPort, signal) {
    const proxyHost = proxyParsed.hostname;
    const proxyPort = Number(proxyParsed.port) || (proxyParsed.protocol === 'https:' ? 443 : 8080);
    const sock = await openTcpOrTls(proxyHost, proxyPort, proxyParsed.protocol === 'https:', signal);

    const lines = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
        'Connection: keep-alive',
    ];
    if (proxyParsed.username || proxyParsed.password) {
        const creds = `${decodeURIComponent(proxyParsed.username)}:${decodeURIComponent(proxyParsed.password)}`;
        lines.push(`Proxy-Authorization: Basic ${Buffer.from(creds).toString('base64')}`);
    }
    const reqText = lines.join('\r\n') + '\r\n\r\n';

    const leftover = await new Promise((resolve, reject) => {
        if (signal?.aborted) {
            sock.destroy();
            return reject(makeAbortError());
        }
        let acc = Buffer.alloc(0);
        const cleanup = () => {
            sock.off('data', onData);
            sock.off('error', onError);
            sock.off('close', onClose);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            sock.destroy();
            reject(makeAbortError());
        };
        const onError = (err) => {
            cleanup();
            sock.destroy();
            reject(err);
        };
        const onClose = () => {
            cleanup();
            reject(new Error('HTTP-прокси закрыл соединение во время CONNECT'));
        };
        const onData = (chunk) => {
            acc = Buffer.concat([acc, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            const idx = acc.indexOf('\r\n\r\n');
            if (idx < 0) {
                if (acc.length > 16384) {
                    cleanup();
                    sock.destroy();
                    reject(new Error('Слишком длинный ответ HTTP-прокси'));
                }
                return;
            }
            cleanup();
            const headText = acc.subarray(0, idx).toString('ascii');
            const firstLine = headText.split('\r\n')[0] || '';
            const m = firstLine.match(/^HTTP\/\d\.\d\s+(\d{3})/i);
            const code = m ? Number(m[1]) : 0;
            if (code !== 200) {
                sock.destroy();
                return reject(new Error(`HTTP-прокси отклонил CONNECT к ${targetHost}:${targetPort} (HTTP ${code || firstLine})`));
            }
            const rest = acc.subarray(idx + 4);
            resolve(rest);
        };
        sock.on('data', onData);
        sock.once('error', onError);
        sock.once('close', onClose);
        signal?.addEventListener('abort', onAbort, { once: true });
        sock.write(reqText);
    });

    if (leftover?.length)
        sock.unshift(leftover);
    return sock;
}

const SOCKS5_ERRORS = {
    1: 'общая ошибка SOCKS5-сервера',
    2: 'соединение запрещено правилами прокси',
    3: 'сеть недоступна',
    4: 'хост недоступен',
    5: 'соединение отклонено целевым сервером',
    6: 'истёк TTL',
    7: 'команда не поддерживается',
    8: 'тип адреса не поддерживается',
};

async function openSocks5Tunnel(proxyParsed, targetHost, targetPort, signal) {
    const proxyHost = proxyParsed.hostname;
    const proxyPort = Number(proxyParsed.port) || 1080;
    const sock = await openTcpOrTls(proxyHost, proxyPort, false, signal);
    const buffered = [];
    const hasAuth = Boolean(proxyParsed.username || proxyParsed.password);

    try {
        const methods = hasAuth ? [0x00, 0x02] : [0x00];
        sock.write(Buffer.from([0x05, methods.length, ...methods]));

        const choice = await readExactBytes(sock, 2, { signal, buffered });
        if (choice[0] !== 0x05)
            throw new Error(`Некорректный ответ SOCKS5-прокси (версия ${choice[0]})`);
        if (choice[1] === 0xff)
            throw new Error('SOCKS5-прокси не принял ни один из предложенных способов авторизации');

        if (choice[1] === 0x02) {
            if (!hasAuth)
                throw new Error('SOCKS5-прокси требует логин и пароль');
            const uBuf = Buffer.from(decodeURIComponent(proxyParsed.username), 'utf-8');
            const pBuf = Buffer.from(decodeURIComponent(proxyParsed.password), 'utf-8');
            if (uBuf.length > 255 || pBuf.length > 255)
                throw new Error('Логин/пароль для SOCKS5 слишком длинные');
            sock.write(Buffer.concat([
                Buffer.from([0x01, uBuf.length]),
                uBuf,
                Buffer.from([pBuf.length]),
                pBuf,
            ]));
            const authResp = await readExactBytes(sock, 2, { signal, buffered });
            if (authResp[1] !== 0x00)
                throw new Error('SOCKS5-прокси отклонил логин или пароль');
        }

        // Формируем CONNECT (0x01): для доменов всегда передаём ATYP=0x03 (резолвинг на стороне прокси)
        let addrPart;
        if (net.isIPv4(targetHost)) {
            addrPart = Buffer.from([0x01, ...targetHost.split('.').map(n => Number(n) & 0xff)]);
        }
        else if (net.isIPv6(targetHost)) {
            const expanded = expandIpv6Bytes(targetHost);
            addrPart = Buffer.concat([Buffer.from([0x04]), expanded]);
        }
        else {
            const hostBuf = Buffer.from(targetHost, 'utf-8');
            if (hostBuf.length > 255)
                throw new Error(`Имя хоста слишком длинное для SOCKS5: ${targetHost}`);
            addrPart = Buffer.concat([Buffer.from([0x03, hostBuf.length]), hostBuf]);
        }

        const portBuf = Buffer.allocUnsafe(2);
        portBuf.writeUInt16BE(targetPort, 0);
        sock.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), addrPart, portBuf]));

        const head = await readExactBytes(sock, 4, { signal, buffered });
        if (head[0] !== 0x05)
            throw new Error('Некорректный заголовок ответа SOCKS5 CONNECT');
        const atyp = head[3];
        if (atyp === 0x01)
            await readExactBytes(sock, 4 + 2, { signal, buffered });
        else if (atyp === 0x04)
            await readExactBytes(sock, 16 + 2, { signal, buffered });
        else if (atyp === 0x03) {
            const lenBuf = await readExactBytes(sock, 1, { signal, buffered });
            await readExactBytes(sock, lenBuf[0] + 2, { signal, buffered });
        }
        else
            throw new Error(`Неизвестный тип адреса SOCKS5: ${atyp}`);

        if (head[1] !== 0x00) {
            const reason = SOCKS5_ERRORS[head[1]] || `код ${head[1]}`;
            throw new Error(`SOCKS5 CONNECT к ${targetHost}:${targetPort} не удался: ${reason}`);
        }

        if (buffered.length)
            sock.unshift(Buffer.concat(buffered));
        return sock;
    }
    catch (err) {
        sock.destroy();
        throw err;
    }
}

function expandIpv6Bytes(ip) {
    const parts = ip.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const fill = 8 - (left.length + right.length);
    const full = [...left, ...Array(Math.max(0, fill)).fill('0'), ...right];
    const buf = Buffer.alloc(16);
    for (let i = 0; i < 8; i++)
        buf.writeUInt16BE(parseInt(full[i] || '0', 16), i * 2);
    return buf;
}

function wrapTlsOverSocket(socket, servername, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            socket.destroy();
            return reject(makeAbortError());
        }
        const tlsSock = tls.connect({ socket, servername });
        const cleanup = () => {
            tlsSock.off('secureConnect', onOk);
            tlsSock.off('error', onErr);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            tlsSock.destroy();
            reject(makeAbortError());
        };
        const onOk = () => {
            cleanup();
            resolve(tlsSock);
        };
        const onErr = (err) => {
            cleanup();
            tlsSock.destroy();
            reject(err);
        };
        tlsSock.once('secureConnect', onOk);
        tlsSock.once('error', onErr);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

async function singleProxiedRequest(targetUrl, options, proxyParsed) {
    const u = new URL(targetUrl);
    const method = String(options?.method || 'GET').toUpperCase();
    const headersObj = { ...(options?.headers || {}) };
    const signal = options?.signal;
    const isHttpsTarget = u.protocol === 'https:';
    const targetPort = Number(u.port) || (isHttpsTarget ? 443 : 80);

    // HTTP -> HTTP прокси: шлём прямой GET с полным URL без CONNECT
    if (!isHttpsTarget && (proxyParsed.protocol === 'http:' || proxyParsed.protocol === 'https:')) {
        const proxyPort = Number(proxyParsed.port) || (proxyParsed.protocol === 'https:' ? 443 : 8080);
        const mod = proxyParsed.protocol === 'https:' ? https : http;
        if (proxyParsed.username || proxyParsed.password) {
            const creds = `${decodeURIComponent(proxyParsed.username)}:${decodeURIComponent(proxyParsed.password)}`;
            headersObj['Proxy-Authorization'] = `Basic ${Buffer.from(creds).toString('base64')}`;
        }
        if (!headersObj.Host && !headersObj.host)
            headersObj.Host = u.host;

        return new Promise((resolve, reject) => {
            if (signal?.aborted)
                return reject(makeAbortError());
            const req = mod.request({
                host: proxyParsed.hostname,
                port: proxyPort,
                path: u.toString(),
                method,
                headers: headersObj,
            }, (res) => resolve(wrapNodeResponse(res, targetUrl, signal)));
            const onAbort = () => {
                req.destroy(makeAbortError());
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            req.once('error', (err) => {
                signal?.removeEventListener('abort', onAbort);
                reject(err);
            });
            req.once('close', () => signal?.removeEventListener('abort', onAbort));
            req.end();
        });
    }

    // HTTPS или SOCKS5: туннель к целевому хосту
    const rawSock = (proxyParsed.protocol === 'socks5:' || proxyParsed.protocol === 'socks5h:')
        ? await openSocks5Tunnel(proxyParsed, u.hostname, targetPort, signal)
        : await openHttpProxyTunnel(proxyParsed, u.hostname, targetPort, signal);

    const streamSock = isHttpsTarget
        ? await wrapTlsOverSocket(rawSock, u.hostname, signal)
        : rawSock;

    const mod = isHttpsTarget ? https : http;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            streamSock.destroy();
            return reject(makeAbortError());
        }
        // Туннельный сокет одноразовый (agent: false) — просим сервер закрыть соединение после ответа
        if (!headersObj.Connection && !headersObj.connection)
            headersObj.Connection = 'close';
        const req = mod.request({
            hostname: u.hostname,
            port: targetPort,
            path: u.pathname + u.search,
            method,
            headers: headersObj,
            agent: false,
            createConnection: () => streamSock,
        }, (res) => {
            res.once('end', () => {
                try { streamSock.end(); } catch { /* ignore */ }
            });
            resolve(wrapNodeResponse(res, targetUrl, signal));
        });

        const onAbort = () => {
            req.destroy(makeAbortError());
            streamSock.destroy();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        req.once('error', (err) => {
            signal?.removeEventListener('abort', onAbort);
            reject(err);
        });
        req.once('close', () => signal?.removeEventListener('abort', onAbort));
        req.end();
    });
}

function wrapNodeResponse(res, url, signal) {
    const hdrs = new Headers();
    for (const [k, v] of Object.entries(res.headers || {})) {
        if (Array.isArray(v))
            v.forEach(item => hdrs.append(k, String(item)));
        else if (v !== undefined)
            hdrs.set(k, String(v));
    }
    const status = Number(res.statusCode || 0);
    const ok = status >= 200 && status < 300;
    const cancelBody = () => {
        try { res.destroy(); } catch { /* ignore */ }
    };
    if (signal)
        signal.addEventListener('abort', cancelBody, { once: true });
    res.body = res;
    res.cancel = cancelBody;
    guardBody(res);

    const readAll = async () => {
        const chunks = [];
        for await (const chunk of res)
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return Buffer.concat(chunks);
    };

    return {
        ok,
        status,
        statusText: res.statusMessage || '',
        url,
        headers: hdrs,
        body: res,
        async arrayBuffer() {
            const b = await readAll();
            return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        },
        async text() {
            return (await readAll()).toString('utf-8');
        },
        async json() {
            return JSON.parse((await readAll()).toString('utf-8'));
        },
    };
}

/**
 * Создать `fetch`-совместимую функцию с поддержкой прокси, ручных редиректов и
 * защитой `Authorization` (сброс токена при редиректе на сторонний origin / CDN).
 */
export function createNetworkFetch({
    proxyUrl = '',
    fetchImpl = globalThis.fetch,
    maxRedirects = 10,
} = {}) {
    const cleanProxy = String(proxyUrl || '').trim();
    const proxyParsed = cleanProxy ? new URL(normalizeProxyUrl(cleanProxy)) : null;

    return async function networkFetch(url, options = {}) {
        let currentUrl = String(url);
        let currentHeaders = { ...(options.headers || {}) };
        const method = String(options.method || 'GET').toUpperCase();
        const signal = options.signal;

        for (let hop = 0; hop <= maxRedirects; hop++) {
            const res = proxyParsed
                ? await singleProxiedRequest(currentUrl, { ...options, method, headers: currentHeaders, signal }, proxyParsed)
                : await fetchImpl(currentUrl, { ...options, method, headers: currentHeaders, redirect: 'manual' });

            guardBody(res?.body);

            if (![301, 302, 303, 307, 308].includes(res?.status))
                return res;

            const loc = res.headers?.get?.('location');
            if (!loc)
                return res;

            // Закрываем тело редирект-ответа, чтобы не текли сокеты
            await discardBody(res);

            const prevOrigin = new URL(currentUrl).origin;
            const nextUrl = new URL(loc, currentUrl).toString();
            const nextOrigin = new URL(nextUrl).origin;
            if (nextOrigin !== prevOrigin) {
                for (const k of Object.keys(currentHeaders)) {
                    if (k.toLowerCase() === 'authorization')
                        delete currentHeaders[k];
                }
            }
            currentUrl = nextUrl;
        }
        throw new Error(`Слишком много редиректов при загрузке ${url}`);
    };
}

// ── Математические операции над полуоткрытыми интервалами `[start, end)` ────

/**
 * Объединить пересекающиеся или смежные полуоткрытые интервалы `[start, end)`.
 */
export function mergeRanges(ranges) {
    const clean = [];
    for (const r of Array.isArray(ranges) ? ranges : []) {
        if (!Array.isArray(r) || r.length < 2)
            continue;
        const a = Math.max(0, Math.floor(Number(r[0]) || 0));
        const b = Math.max(0, Math.floor(Number(r[1]) || 0));
        if (b > a)
            clean.push([a, b]);
    }
    if (!clean.length)
        return [];
    clean.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const out = [clean[0]];
    for (let i = 1; i < clean.length; i++) {
        const last = out[out.length - 1];
        const cur = clean[i];
        if (cur[0] <= last[1])
            last[1] = Math.max(last[1], cur[1]);
        else
            out.push(cur);
    }
    return out;
}

/**
 * Вычесть из `[0, totalSize)` уже скачанные интервалы `completed`.
 */
export function subtractRanges(totalSize, completed) {
    const total = Math.max(0, Math.floor(Number(totalSize) || 0));
    if (!total)
        return [];
    const merged = mergeRanges(completed);
    const missing = [];
    let cursor = 0;
    for (const [a, b] of merged) {
        if (a >= total)
            break;
        if (a > cursor)
            missing.push([cursor, Math.min(a, total)]);
        cursor = Math.max(cursor, Math.min(b, total));
    }
    if (cursor < total)
        missing.push([cursor, total]);
    return missing;
}

export function sumRangesBytes(ranges) {
    let total = 0;
    for (const [a, b] of mergeRanges(ranges))
        total += (b - a);
    return total;
}

function splitGapIntoChunks(gaps, chunkBytes) {
    const queue = [];
    for (const [a, b] of gaps) {
        for (let pos = a; pos < b; pos += chunkBytes)
            queue.push({ start: pos, end: Math.min(b, pos + chunkBytes) });
    }
    return queue;
}

function waitAbortable(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(makeAbortError('Загрузка приостановлена пользователем'));
        const t = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(t);
            reject(makeAbortError('Загрузка приостановлена пользователем'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function isRetryableNetError(err) {
    if (!err)
        return false;
    if (err.name === 'AbortError' || /приостановлен|отменен/i.test(String(err.message || '')))
        return false;
    if (err.retryable)
        return true;
    const status = Number(err.httpStatus || 0);
    if (status === 429 || status === 408 || (status >= 500 && status <= 599))
        return true;
    if (status >= 400 && status < 500)
        return false;
    return true;
}

/**
 * Разобрать заголовок `Content-Range: bytes start-end/total` или `bytes start-end/*`.
 */
export function parseContentRange(headerValue) {
    const m = String(headerValue || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
    if (!m)
        return null;
    return {
        start: Number(m[1]),
        end: Number(m[2]),
        total: m[3] === '*' ? 0 : Number(m[3]),
    };
}

/**
 * Скачать один файл в многопоточном `Range`-режиме с прямой записью по смещениям в `partFile`.
 * Поддерживает:
 * - бесшовную докачку старых однопоточных `.part` (`[0, existingSize)` без карты диапазонов);
 * - динамическую очередь сегментов (быстрые воркеры подбирают оставшиеся куски);
 * - авто-откат на 1 поток, если сервер не поддерживает `Range` (вернул `200 OK`);
 * - устойчивые авто-повторы с backoff и снижение параллельности при `429`.
 */
export async function downloadFileMultipart({
    url,
    stagedFile,
    partFile = `${stagedFile}.part`,
    expectedSize = 0,
    headers = {},
    threads = DEFAULT_THREADS,
    minMultipartBytes = DEFAULT_MIN_MULTIPART_BYTES,
    initialRanges = null,
    signal,
    maxRetries = 20,
    retryBaseDelayMs = 3000,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    fetchImpl,
    onProgress,
    onRetry,
} = {}) {
    if (!url)
        throw new Error('Не указан URL для загрузки файла');
    if (!stagedFile)
        throw new Error('Не указан целевой путь файла');

    const netFetchRaw = fetchImpl || createNetworkFetch();
    const effIdleTimeoutMs = Math.max(100, Number(idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS);
    const netFetch = (u, opts = {}) => fetchWithIdleTimeout(netFetchRaw, u, opts, effIdleTimeoutMs);
    const targetThreads = Math.min(16, Math.max(1, Math.round(Number(threads) || 1)));

    // 1. Проверяем состояние на диске (готовый файл или старый/текущий `.part`)
    try {
        const stDone = await fsp.stat(stagedFile);
        if (stDone.isFile() && stDone.size > 0 && (!expectedSize || stDone.size === expectedSize)) {
            const full = [[0, stDone.size]];
            onProgress?.({ downloadedBytes: stDone.size, totalBytes: stDone.size, deltaBytes: 0, activeThreads: 0, rangeSupported: true, ranges: full });
            return { size: stDone.size, ranges: full, rangeSupported: true, multipart: false };
        }
    }
    catch { /* staged ещё нет */ }

    await fsp.mkdir(path.dirname(partFile), { recursive: true });

    let existingSize = 0;
    try {
        const stPart = await fsp.stat(partFile);
        if (stPart.isFile())
            existingSize = stPart.size;
    }
    catch { /* .part ещё нет */ }

    let completed = Array.isArray(initialRanges) && initialRanges.length
        ? mergeRanges(initialRanges)
        : (existingSize > 0 ? [[0, existingSize]] : []);

    // Если файл уже полностью на диске в `.part` — просто переименовываем
    let totalSize = Number(expectedSize) || 0;
    if (totalSize > 0 && completed.length === 1 && completed[0][0] === 0 && completed[0][1] >= totalSize) {
        await fsp.rename(partFile, stagedFile);
        return { size: totalSize, ranges: [[0, totalSize]], rangeSupported: true, multipart: false };
    }

    // При 1 потоке или мелком файле (< 4 МБ) — лёгкая однопоточная докачка
    if (targetThreads <= 1 || (totalSize > 0 && totalSize <= minMultipartBytes)) {
        return downloadSingleStream({
            url,
            stagedFile,
            partFile,
            totalSize,
            existingSize: completed.length === 1 && completed[0][0] === 0 ? completed[0][1] : 0,
            headers,
            signal,
            maxRetries,
            retryBaseDelayMs,
            idleTimeoutMs: effIdleTimeoutMs,
            netFetch,
            onProgress,
            onRetry,
        });
    }

    // 2. Многопоточный режим: сначала запускаем первый сегмент и по его ответу узнаём поддержку Range
    const gapsInit = totalSize > 0
        ? subtractRanges(totalSize, completed)
        : [[completed[0]?.[1] || 0, (completed[0]?.[1] || 0) + 16 * 1024 * 1024]];

    if (!gapsInit.length && totalSize > 0) {
        await fsp.rename(partFile, stagedFile);
        return { size: totalSize, ranges: [[0, totalSize]], rangeSupported: true, multipart: true };
    }

    const remainingInit = totalSize > 0 ? sumRangesBytes(gapsInit) : 64 * 1024 * 1024;
    const chunkSize = Math.min(16 * 1024 * 1024, Math.max(minMultipartBytes, Math.ceil(remainingInit / (targetThreads * 3))));
    const firstProbeEnd = Math.min(gapsInit[0][1], gapsInit[0][0] + chunkSize);
    const probeRange = { start: gapsInit[0][0], end: firstProbeEnd };

    let probeRes = null;
    let probeAttempt = 0;
    while (true) {
        if (signal?.aborted)
            throw makeAbortError('Загрузка приостановлена пользователем');
        try {
            const reqHeaders = { ...headers, Range: `bytes=${probeRange.start}-${probeRange.end - 1}` };
            probeRes = await netFetch(url, { headers: reqHeaders, signal });
            guardBody(probeRes?.body);

            if (probeRes.status === 416) {
                await discardBody(probeRes);
                if (totalSize > 0 && sumRangesBytes(completed) >= totalSize) {
                    await fsp.rename(partFile, stagedFile);
                    return { size: totalSize, ranges: [[0, totalSize]], rangeSupported: true, multipart: true };
                }
                // Если смещение не бьётся — сбрасываем .part и начинаем с 0
                await fsp.rm(partFile, { force: true }).catch(() => {});
                completed = [];
                probeRange.start = 0;
                probeRange.end = totalSize > 0 ? Math.min(totalSize, chunkSize) : chunkSize;
                const e416 = new Error(`Сбой Range (HTTP 416), повтор с начала`);
                e416.retryable = true;
                throw e416;
            }
            if (!probeRes.ok && probeRes.status !== 206) {
                await discardBody(probeRes);
                const errHttp = new Error(`Ошибка загрузки ${path.basename(stagedFile)}: HTTP ${probeRes.status}`);
                errHttp.httpStatus = probeRes.status;
                throw errHttp;
            }
            break;
        }
        catch (err) {
            if (signal?.aborted || !isRetryableNetError(err) || probeAttempt >= maxRetries)
                throw err;
            probeAttempt++;
            onRetry?.({ attempt: probeAttempt, error: String(err?.message || err) });
            await waitAbortable(Math.min(30000, retryBaseDelayMs * probeAttempt), signal);
        }
    }

    // Если сервер вернул 200 OK (не поддержал Range) — откатываемся в 1 поток на этом же ответе!
    if (probeRes.status === 200) {
        const contentLen = Number(probeRes.headers?.get?.('content-length') || 0);
        if (contentLen > 0)
            totalSize = contentLen;
        return consumeSingleResponseToFile({
            res: probeRes,
            url,
            stagedFile,
            partFile,
            totalSize,
            existingSize: 0,
            isPartial: false,
            headers,
            signal,
            maxRetries,
            retryBaseDelayMs,
            idleTimeoutMs: effIdleTimeoutMs,
            netFetch,
            onProgress,
            onRetry,
        });
    }

    // 206 Partial Content! Определяем точный размер файла из Content-Range
    const cr = parseContentRange(probeRes.headers?.get?.('content-range'));
    if (cr?.total && (!totalSize || cr.total !== totalSize))
        totalSize = cr.total;
    if (!totalSize) {
        // Неизвестный totalSize с 206 — безопасно докачать в 1 поток
        await discardBody(probeRes);
        return downloadSingleStream({
            url,
            stagedFile,
            partFile,
            totalSize: 0,
            existingSize: completed.length === 1 && completed[0][0] === 0 ? completed[0][1] : 0,
            headers,
            signal,
            maxRetries,
            retryBaseDelayMs,
            idleTimeoutMs: effIdleTimeoutMs,
            netFetch,
            onProgress,
            onRetry,
        });
    }

    // Если после учёта totalSize остался маленький хвост — докачаем из probeRes (оставшаяся очередь пуста)
    if (!fs.existsSync(partFile))
        fs.closeSync(fs.openSync(partFile, 'w'));

    const fh = await fsp.open(partFile, 'r+');
    // Сегмент из probeRes фиксируем с реальными границами
    const probeActualStart = cr ? cr.start : probeRange.start;
    const probeActualEnd = cr ? Math.min(totalSize, cr.end + 1) : Math.min(totalSize, probeRange.end);

    // Очередь всех остальных сегментов кроме того, который уже открыт в probeRes
    const remainingAfterProbe = subtractRanges(totalSize, mergeRanges([...completed, [probeActualStart, probeActualEnd]]));
    const remainingBytes = sumRangesBytes(remainingAfterProbe);
    const segChunkBytes = Math.min(16 * 1024 * 1024, Math.max(minMultipartBytes, Math.ceil((remainingBytes || minMultipartBytes) / (targetThreads * 3))));
    const queue = splitGapIntoChunks(remainingAfterProbe, segChunkBytes);

    let concurrencyLimit = Math.min(targetThreads, 1 + queue.length);
    const activeCursors = new Map(); // workerId -> [start, cursor]
    let activeWorkers = 0;
    let firstFatalErr = null;
    let lastEmit = 0;

    const snapshotCompleted = () => {
        const list = [...completed];
        for (const [s, c] of activeCursors.values()) {
            if (c > s)
                list.push([s, c]);
        }
        return mergeRanges(list);
    };

    const emitProgress = (deltaBytes = 0, force = false) => {
        const now = Date.now();
        if (!force && deltaBytes > 0 && now - lastEmit < 120)
            return;
        lastEmit = now;
        const ranges = snapshotCompleted();
        const downloadedBytes = sumRangesBytes(ranges);
        onProgress?.({
            downloadedBytes,
            totalBytes: totalSize,
            deltaBytes,
            activeThreads: activeWorkers,
            rangeSupported: true,
            ranges,
        });
    };

    const writeStreamChunked = async (workerId, res, segStart, segEnd) => {
        let pos = segStart;
        activeCursors.set(workerId, [segStart, segStart]);
        if (res.body) {
            const reader = makeIdleChunkReader(res.body, effIdleTimeoutMs);
            try {
                while (true) {
                    if (signal?.aborted)
                        throw makeAbortError('Загрузка приостановлена пользователем');
                    const step = await reader.next();
                    if (step.done)
                        break;
                    let buf = Buffer.isBuffer(step.value) ? step.value : Buffer.from(step.value);
                    const maxAllowed = segEnd - pos;
                    if (maxAllowed <= 0)
                        break;
                    if (buf.length > maxAllowed)
                        buf = buf.subarray(0, maxAllowed);
                    await fh.write(buf, 0, buf.length, pos);
                    pos += buf.length;
                    activeCursors.set(workerId, [segStart, pos]);
                    emitProgress(buf.length);
                    if (pos >= segEnd)
                        break;
                }
            }
            finally {
                reader.close();
            }
        }
        activeCursors.delete(workerId);
        if (pos > segStart)
            completed = mergeRanges([...completed, [segStart, pos]]);
        return pos;
    };

    const runSegment = async (workerId, seg, initialRes = null) => {
        let cur = seg.start;
        const end = seg.end;
        let attempt = 0;
        let pendingRes = initialRes;

        while (cur < end) {
            if (signal?.aborted) {
                if (pendingRes) {
                    await discardBody(pendingRes);
                    pendingRes = null;
                }
                throw makeAbortError('Загрузка приостановлена пользователем');
            }
            if (firstFatalErr) {
                if (pendingRes) {
                    await discardBody(pendingRes);
                    pendingRes = null;
                }
                return;
            }

            try {
                const res = pendingRes || await netFetch(url, {
                    headers: { ...headers, Range: `bytes=${cur}-${end - 1}` },
                    signal,
                });
                pendingRes = null;
                guardBody(res?.body);

                if (res.status === 429) {
                    const err429 = new Error(`Слишком много запросов (HTTP 429), уменьшаем потоки`);
                    err429.httpStatus = 429;
                    err429.retryable = true;
                    concurrencyLimit = Math.max(1, Math.floor(concurrencyLimit / 2));
                    await discardBody(res);
                    throw err429;
                }

                if (res.status !== 206 && res.status !== 200) {
                    const errHttp = new Error(`Ошибка сегмента ${path.basename(stagedFile)}: HTTP ${res.status}`);
                    errHttp.httpStatus = res.status;
                    await discardBody(res);
                    throw errHttp;
                }

                // Если внезапно сервер отдал 200 (редко на CDN): читаем с 0 лишь до end, либо прерываем на ошибку
                const actualStart = res.status === 200 ? 0 : cur;
                const posAfter = await writeStreamChunked(workerId, res, actualStart, end);
                if (posAfter < end) {
                    cur = posAfter;
                    const eTrunc = new Error(`Поток сегмента оборвался на ${posAfter}/${end}`);
                    eTrunc.retryable = true;
                    throw eTrunc;
                }
                attempt = 0;
                break;
            }
            catch (err) {
                activeCursors.delete(workerId);
                if (signal?.aborted)
                    throw err;
                if (!isRetryableNetError(err) || attempt >= maxRetries)
                    throw err;
                attempt++;
                onRetry?.({ attempt, error: String(err?.message || err) });
                await waitAbortable(Math.min(30000, retryBaseDelayMs * attempt), signal);
            }
        }
    };

    try {
        const workerTasks = [];
        for (let w = 0; w < concurrencyLimit; w++) {
            workerTasks.push((async () => {
                activeWorkers++;
                try {
                    if (w === 0) {
                        await runSegment(w, { start: probeActualStart, end: probeActualEnd }, probeRes);
                    }
                    while (!firstFatalErr && !signal?.aborted) {
                        if (w >= concurrencyLimit)
                            break;
                        const nextSeg = queue.shift();
                        if (!nextSeg)
                            break;
                        await runSegment(w, nextSeg);
                    }
                }
                catch (err) {
                    if (!firstFatalErr)
                        firstFatalErr = err;
                }
                finally {
                    activeWorkers--;
                    emitProgress(0, true);
                }
            })());
        }
        await Promise.all(workerTasks);
        if (firstFatalErr)
            throw firstFatalErr;
        if (signal?.aborted)
            throw makeAbortError('Загрузка приостановлена пользователем');

        const finalRanges = mergeRanges(completed);
        if (finalRanges.length !== 1 || finalRanges[0][0] !== 0 || finalRanges[0][1] < totalSize) {
            throw new Error(`Неполная сборка файла ${path.basename(stagedFile)}: скачано ${sumRangesBytes(finalRanges)} из ${totalSize}`);
        }
    }
    finally {
        await fh.close().catch(() => {});
    }

    await fsp.rename(partFile, stagedFile);
    const doneRanges = [[0, totalSize]];
    onProgress?.({
        downloadedBytes: totalSize,
        totalBytes: totalSize,
        deltaBytes: 0,
        activeThreads: 0,
        rangeSupported: true,
        ranges: doneRanges,
    });
    return { size: totalSize, ranges: doneRanges, rangeSupported: true, multipart: true };
}

async function downloadSingleStream({
    url,
    stagedFile,
    partFile,
    totalSize,
    existingSize = 0,
    headers = {},
    signal,
    maxRetries = 20,
    retryBaseDelayMs = 3000,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    netFetch,
    onProgress,
    onRetry,
}) {
    let curSize = existingSize;
    let attempt = 0;

    while (true) {
        if (signal?.aborted)
            throw makeAbortError('Загрузка приостановлена пользователем');
        if (totalSize > 0 && curSize >= totalSize) {
            await fsp.rename(partFile, stagedFile);
            const r = [[0, totalSize]];
            onProgress?.({ downloadedBytes: totalSize, totalBytes: totalSize, deltaBytes: 0, activeThreads: 0, rangeSupported: true, ranges: r });
            return { size: totalSize, ranges: r, rangeSupported: true, multipart: false };
        }

        try {
            const reqHeaders = { ...headers };
            if (curSize > 0)
                reqHeaders.Range = `bytes=${curSize}-`;

            const res = await netFetch(url, { headers: reqHeaders, signal });
            guardBody(res?.body);
            if (res.status === 416) {
                await discardBody(res);
                if (curSize > 0 && (!totalSize || curSize >= totalSize)) {
                    await fsp.rename(partFile, stagedFile);
                    const sz = totalSize || curSize;
                    const r = [[0, sz]];
                    onProgress?.({ downloadedBytes: sz, totalBytes: sz, deltaBytes: 0, activeThreads: 0, rangeSupported: true, ranges: r });
                    return { size: sz, ranges: r, rangeSupported: true, multipart: false };
                }
                await fsp.rm(partFile, { force: true }).catch(() => {});
                curSize = 0;
                const e416 = new Error(`Сбой Range для ${path.basename(stagedFile)}: HTTP 416`);
                e416.retryable = true;
                throw e416;
            }
            if (!res.ok && res.status !== 206) {
                await discardBody(res);
                const errHttp = new Error(`Ошибка загрузки ${path.basename(stagedFile)}: HTTP ${res.status}`);
                errHttp.httpStatus = res.status;
                throw errHttp;
            }

            const isPartial = res.status === 206;
            return await consumeSingleResponseToFile({
                res,
                url,
                stagedFile,
                partFile,
                totalSize,
                existingSize: isPartial ? curSize : 0,
                isPartial,
                headers,
                signal,
                maxRetries,
                retryBaseDelayMs,
                idleTimeoutMs,
                netFetch,
                onProgress,
                onRetry,
                initialAttempt: attempt,
            });
        }
        catch (err) {
            if (signal?.aborted || !isRetryableNetError(err) || attempt >= maxRetries)
                throw err;
            attempt++;
            try {
                const st = await fsp.stat(partFile);
                if (st.isFile())
                    curSize = st.size;
            }
            catch { /* ignore */ }
            onRetry?.({ attempt, error: String(err?.message || err) });
            await waitAbortable(Math.min(30000, retryBaseDelayMs * attempt), signal);
        }
    }
}

async function consumeSingleResponseToFile({
    res,
    url,
    stagedFile,
    partFile,
    totalSize = 0,
    existingSize = 0,
    isPartial = false,
    headers = {},
    signal,
    maxRetries = 20,
    retryBaseDelayMs = 3000,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    netFetch,
    onProgress,
    onRetry,
    initialAttempt = 0,
}) {
    let curSize = isPartial ? existingSize : 0;
    const contentLen = Number(res.headers?.get?.('content-length') || 0);
    if (!totalSize && contentLen > 0)
        totalSize = curSize + contentLen;

    let lastEmit = 0;
    const emit = (delta = 0, force = false) => {
        const now = Date.now();
        if (!force && delta > 0 && now - lastEmit < 120)
            return;
        lastEmit = now;
        onProgress?.({
            downloadedBytes: curSize,
            totalBytes: totalSize,
            deltaBytes: delta,
            activeThreads: 1,
            rangeSupported: isPartial,
            ranges: curSize > 0 ? [[0, curSize]] : [],
        });
    };

    emit(0, true);

    if (res.body) {
        const out = fs.createWriteStream(partFile, { flags: isPartial ? 'a' : 'w' });
        try {
            const reader = makeIdleChunkReader(res.body, idleTimeoutMs);
            try {
                while (true) {
                    if (signal?.aborted)
                        throw makeAbortError('Загрузка приостановлена пользователем');
                    const step = await reader.next();
                    if (step.done)
                        break;
                    const buf = Buffer.isBuffer(step.value) ? step.value : Buffer.from(step.value);
                    if (!out.write(buf))
                        await new Promise(r => out.once('drain', r));
                    curSize += buf.length;
                    emit(buf.length);
                }
            }
            finally {
                reader.close();
            }
            await new Promise((resolve, reject) => {
                out.end();
                out.once('finish', resolve);
                out.once('error', reject);
            });
        }
        catch (streamErr) {
            await new Promise(resolve => {
                out.once('finish', resolve);
                out.once('error', resolve);
                out.once('close', resolve);
                try { out.end(); } catch { resolve(); }
            });
            if (signal?.aborted)
                throw streamErr;
            if (!isRetryableNetError(streamErr) || initialAttempt >= maxRetries)
                throw streamErr;
            // При обрыве или простое на лету — переходим в докачку (если сервер поддерживает Range, дальше пойдёт с curSize)
            onRetry?.({ attempt: initialAttempt + 1, error: String(streamErr?.message || streamErr) });
            await waitAbortable(Math.min(30000, retryBaseDelayMs * (initialAttempt + 1)), signal);
            return downloadSingleStream({
                url,
                stagedFile,
                partFile,
                totalSize,
                existingSize: curSize,
                headers,
                signal,
                maxRetries: Math.max(0, maxRetries - initialAttempt - 1),
                retryBaseDelayMs,
                idleTimeoutMs,
                netFetch,
                onProgress,
                onRetry,
            });
        }
    }
    else if (typeof res.arrayBuffer === 'function') {
        const buf = Buffer.from(await res.arrayBuffer());
        await fsp.writeFile(partFile, buf, { flag: isPartial ? 'a' : 'w' });
        curSize += buf.length;
        emit(buf.length, true);
    }

    await fsp.rename(partFile, stagedFile);
    const finalSize = totalSize || curSize;
    const r = finalSize > 0 ? [[0, finalSize]] : [];
    onProgress?.({ downloadedBytes: finalSize, totalBytes: finalSize, deltaBytes: 0, activeThreads: 0, rangeSupported: isPartial, ranges: r });
    return { size: finalSize, ranges: r, rangeSupported: isPartial, multipart: false };
}

/**
 * Проверить доступность источника и замерить реальную скорость скачивания (1–2 МБ Range-проба).
 */
export async function probeTrainerNetwork({
    rootDir = process.cwd(),
    endpointUrl,
    proxyUrl,
    threads,
    token,
    probeRepoId = 'Qwen/Qwen3-0.6B',
    probeFile = 'model.safetensors',
    probeBytes = 2 * 1024 * 1024,
    fetchImpl,
} = {}) {
    const saved = loadTrainerNetworkSettings(rootDir);
    const effEndpoint = normalizeEndpointUrl(endpointUrl || saved.endpointUrl || DEFAULT_HF_ORIGIN);
    const effProxy = proxyUrl !== undefined ? normalizeProxyUrl(proxyUrl) : saved.proxyUrl;
    const effThreads = threads !== undefined ? Math.min(16, Math.max(1, Math.round(Number(threads) || DEFAULT_THREADS))) : saved.threads;
    const effToken = token !== undefined ? String(token || '').trim() : saved.token;

    const netFetch = createNetworkFetch({
        proxyUrl: effProxy,
        fetchImpl: fetchImpl || globalThis.fetch,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const t0 = Date.now();

    try {
        const headers = { 'User-Agent': 'WORK-AI-Trainer/2.0' };
        const apiUrl = `${effEndpoint}/api/models?limit=1`;
        if (effToken && canSendAuthToUrl(apiUrl, effEndpoint))
            headers.Authorization = `Bearer ${effToken}`;

        let apiOk = false;
        let apiStatus = 0;
        let discoveredRepo = probeRepoId;
        let discoveredFile = probeFile;

        try {
            const apiRes = await netFetch(apiUrl, { headers: { ...headers, Accept: 'application/json' }, signal: controller.signal });
            apiStatus = apiRes.status;
            apiOk = apiRes.ok;
            if (apiRes.ok) {
                const list = await apiRes.json().catch(() => null);
                const firstId = Array.isArray(list) && list[0]?.id ? String(list[0].id) : '';
                if (firstId) {
                    // На всякий случай оставляем проверенный лёгкий repo если доступен, но знаем что API живой
                    discoveredRepo = probeRepoId;
                }
            }
            else {
                await discardBody(apiRes);
            }
        }
        catch { /* для кастомного зеркала без /api/models попробуем прямую пробу файла */ }

        const fileUrl = `${effEndpoint}/${discoveredRepo}/resolve/main/${discoveredFile}`;
        const dlHeaders = {
            'User-Agent': 'WORK-AI-Trainer/2.0',
            Range: `bytes=0-${Math.max(65536, Number(probeBytes) || 2 * 1024 * 1024) - 1}`,
        };
        if (effToken && canSendAuthToUrl(fileUrl, effEndpoint))
            dlHeaders.Authorization = `Bearer ${effToken}`;

        const tDl0 = Date.now();
        const res = await netFetch(fileUrl, { headers: dlHeaders, signal: controller.signal });
        if (!res.ok && res.status !== 206) {
            await discardBody(res);
            throw new Error(`Источник вернул HTTP ${res.status}${apiStatus ? ` (API: ${apiStatus})` : ''}`);
        }

        const rangeSupported = res.status === 206;
        let bytes = 0;
        const limitBytes = Math.max(65536, Number(probeBytes) || 2 * 1024 * 1024);
        if (res.body) {
            guardBody(res.body);
            try {
                for await (const raw of res.body) {
                    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
                    bytes += buf.length;
                    if (bytes >= limitBytes) {
                        await discardBody(res);
                        break;
                    }
                }
            }
            finally {
                await discardBody(res);
            }
        }
        else if (typeof res.arrayBuffer === 'function') {
            bytes = (await res.arrayBuffer()).byteLength;
        }

        const dlElapsedSec = Math.max(0.05, (Date.now() - tDl0) / 1000);
        const speedMBs = +((bytes / dlElapsedSec) / (1024 * 1024)).toFixed(2);
        const latencyMs = Date.now() - t0;

        return {
            ok: true,
            endpointUrl: effEndpoint,
            sourceLabel: describeSourceLabel(effEndpoint),
            proxyUrl: maskProxyUrl(effProxy),
            usingProxy: Boolean(effProxy),
            threads: effThreads,
            apiOk,
            rangeSupported,
            bytes,
            speedMBs,
            latencyMs,
            message: `Доступен · ~${speedMBs} МБ/с · ${rangeSupported ? `Range OK (${effThreads} потоков)` : 'только 1 поток (без Range)'}`,
        };
    }
    catch (err) {
        return {
            ok: false,
            endpointUrl: effEndpoint,
            sourceLabel: describeSourceLabel(effEndpoint),
            proxyUrl: maskProxyUrl(effProxy),
            usingProxy: Boolean(effProxy),
            threads: effThreads,
            error: String(err?.message || err),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
