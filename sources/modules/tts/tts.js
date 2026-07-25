/**
 * TTS — локальный HTTP (Piper :8003 по умолчанию; Qwen3 :8002 опционально).
 *
 * Готовность: GET /health → { status, model_loaded }
 * Запуск: *.bat (detached)
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_TTS_URL = 'http://127.0.0.1:8003';
export const DEFAULT_BAT = path.join('sources', 'modules', 'tts', 'piper_start.bat');
export const DEFAULT_READY_TIMEOUT_MS = 60_000;
export const DEFAULT_READY_INTERVAL_MS = 2_000;
export const PIPER_TTS_PATH = '/MODELS/Local/Piper';
export const QWEN3_TTS_PATH = '/MODELS/Local/Qwen3-TTS';

export function resolveBaseUrl(base) {
    return String(base || process.env.WORK_TTS_URL || DEFAULT_TTS_URL).replace(/\/$/, '');
}

/**
 * @param {string} [base]
 * @returns {Promise<{ ok: boolean, ready: boolean, model_loaded?: boolean, status?: string, error?: string }>}
 */
export async function checkHealth(base) {
    const url = resolveBaseUrl(base) + '/health';
    try {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok)
            return { ok: false, ready: false, error: 'HTTP ' + res.status };
        const data = await res.json().catch(() => ({}));
        const model_loaded = !!data.model_loaded;
        return {
            ok: true,
            ready: model_loaded,
            model_loaded,
            status: data.status,
        };
    } catch (e) {
        return { ok: false, ready: false, error: e.message || String(e) };
    }
}

/**
 * Poll until model_loaded or timeout.
 * @param {string} [base]
 * @param {{ timeoutMs?: number, intervalMs?: number }} [opts]
 */
export async function waitReady(base, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const intervalMs = opts.intervalMs ?? DEFAULT_READY_INTERVAL_MS;
    const t0 = Date.now();
    let last = await checkHealth(base);
    if (last.ready) return last;
    while (Date.now() - t0 < timeoutMs) {
        await new Promise(r => setTimeout(r, intervalMs));
        last = await checkHealth(base);
        if (last.ready) return last;
    }
    throw new Error(
        'Qwen3 TTS ещё не готов (ждали ' + Math.round(timeoutMs / 1000) + 's): '
        + (last.error || 'model_loaded=false')
    );
}

/**
 * Detached spawn qwen3_start.bat (Windows) / shell script path.
 * @param {string} [batPath] relative to cwd or absolute
 */
export function spawnBat(batPath) {
    const root = process.cwd();
    const bat = path.isAbsolute(batPath || '')
        ? batPath
        : path.join(root, batPath || DEFAULT_BAT);
    if (!fs.existsSync(bat))
        throw new Error('Bat не найден: ' + bat);
    const cwd = path.dirname(bat);
    if (process.platform === 'win32') {
        const child = spawn('cmd.exe', ['/c', 'start', '""', `/D`, cwd, bat], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        child.unref();
    } else {
        const child = spawn(bat, [], {
            cwd,
            detached: true,
            stdio: 'ignore',
            shell: true,
        });
        child.unref();
    }
    return { bat, cwd };
}

/**
 * Ensure server ready: health → else spawn + waitReady.
 * @param {{ baseUrl?: string, batPath?: string, wait?: boolean, timeoutMs?: number }} [opts]
 */
export async function ensureReady(opts = {}) {
    const base = resolveBaseUrl(opts.baseUrl);
    const health = await checkHealth(base);
    if (health.ready)
        return { ok: true, already: true, ready: true, baseUrl: base };

    const spawned = spawnBat(opts.batPath);
    const wait = opts.wait !== false;
    if (!wait)
        return { ok: true, starting: true, ready: false, baseUrl: base, ...spawned };

    await waitReady(base, { timeoutMs: opts.timeoutMs });
    return { ok: true, starting: true, ready: true, baseUrl: base, ...spawned };
}

/**
 * Синтез речи через POST /tts.
 * @param {string} text
 * @param {{ baseUrl?: string, ensure?: boolean, batPath?: string, timeoutMs?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export async function synthesize(text, options = {}) {
    const trimmed = String(text || '').trim();
    if (!trimmed)
        throw new Error('Текст для озвучки пуст');

    const base = resolveBaseUrl(options.baseUrl);
    if (options.ensure !== false)
        await ensureReady({
            baseUrl: base,
            batPath: options.batPath,
            wait: true,
            timeoutMs: options.timeoutMs,
        });

    const url = base + '/tts';
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: trimmed.slice(0, 2000) }),
        });
    } catch (e) {
        throw new Error('TTS недоступен (' + url + '): ' + (e.message || e));
    }
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error('TTS HTTP ' + res.status + (errText ? ': ' + errText.slice(0, 200) : ''));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 44)
        throw new Error('TTS вернул пустой WAV');
    return buf;
}
