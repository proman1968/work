/**
 * Глобальная страховка Node-процесса WORK от падения из-за фоновых сетевых
 * отказов (например `TypeError: terminated` / `UND_ERR_RES_CONTENT_LENGTH_MISMATCH`
 * при обрыве стримов Hugging Face) и непредвиденных асинхронных исключений.
 */
import fs from 'node:fs';
import path from 'node:path';

const GUARD_SYMBOL = Symbol.for('odant.work.processGuard');
const MAX_LOG_BYTES = 2 * 1024 * 1024;

const TRANSIENT_NET_RE = /ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|UND_ERR_|ERR_HTTP2_|ResponseContentLengthMismatch|content[- ]length|length does not match|terminated|socket hang up|Premature close|fetch failed|aborted/i;

/**
 * Проверить ошибку (включая цепочку `err.cause`), является ли она
 * временным сетевым / HTTP/2 / потоковым сбоем.
 */
export function isTransientNetworkError(err) {
    let cur = err;
    for (let depth = 0; cur && depth < 5; depth++) {
        if (typeof cur === 'string') {
            if (TRANSIENT_NET_RE.test(cur))
                return true;
            break;
        }
        const hay = [
            cur.code,
            cur.name,
            cur.message,
            cur.http2ErrorCode != null ? `http2ErrorCode=${cur.http2ErrorCode}` : '',
        ].filter(Boolean).join(' ');
        if (TRANSIENT_NET_RE.test(hay))
            return true;
        cur = cur.cause;
    }
    return false;
}

function formatErrorEntry(kind, err) {
    const ts = new Date().toISOString();
    const parts = [`[${ts}] [${kind}]`];
    if (err instanceof Error) {
        const meta = err.code ? ` [code=${err.code}]` : '';
        parts.push((err.stack || `${err.name}: ${err.message}`) + meta);
        let cause = err.cause;
        for (let i = 1; cause && i <= 3; i++) {
            const cMeta = cause.code ? ` [code=${cause.code}]` : '';
            parts.push(`  cause(${i}): ${cause.stack || cause.message || String(cause)}${cMeta}`);
            cause = cause.cause;
        }
    }
    else {
        parts.push(String(err));
    }
    return parts.join('\n') + '\n';
}

function appendLogSafe(logFile, entry) {
    if (!logFile)
        return;
    try {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        try {
            const st = fs.statSync(logFile);
            if (st.size > MAX_LOG_BYTES) {
                const bak = `${logFile}.1`;
                try { fs.rmSync(bak, { force: true }); } catch { /* ignore */ }
                fs.renameSync(logFile, bak);
            }
        }
        catch { /* файла ещё нет */ }
        fs.appendFileSync(logFile, entry, 'utf-8');
    }
    catch { /* не падаем из-за логгера */ }
}

/**
 * Установить глобальные обработчики `unhandledRejection` и `uncaughtException`.
 * Идемпотентно для переданного `target` (по умолчанию `process`).
 */
export function installProcessGuards({
    rootDir = process.cwd(),
    logFile = path.join(rootDir, '.data', 'server-errors.log'),
    target = process,
    onError = null,
} = {}) {
    if (target[GUARD_SYMBOL])
        return target[GUARD_SYMBOL];

    const handle = (kind, err) => {
        const transient = isTransientNetworkError(err);
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        if (transient) {
            console.warn(`[process-guard] ${kind}: временный сетевой сбой (сервер продолжает работу): ${msg}`);
        }
        else {
            console.error(`[process-guard] ${kind}: неперехваченная ошибка (сервер продолжает работу):`, err);
        }
        appendLogSafe(logFile, formatErrorEntry(transient ? `${kind}:net` : kind, err));
        try { onError?.({ kind, transient, error: err }); } catch { /* ignore */ }
    };

    const onRejection = (reason) => handle('unhandledRejection', reason);
    const onException = (err) => handle('uncaughtException', err);

    target.on('unhandledRejection', onRejection);
    target.on('uncaughtException', onException);

    const uninstall = () => {
        target.off?.('unhandledRejection', onRejection);
        target.off?.('uncaughtException', onException);
        delete target[GUARD_SYMBOL];
    };
    target[GUARD_SYMBOL] = uninstall;
    return uninstall;
}
