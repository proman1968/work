/**
 * start — поднять Piper через piper_start.bat.
 * POST/params: { wait?: boolean } — ждать ready (default true, timeout 60s).
 */
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const ROOT = process.cwd();

function readOpts(params) {
    const raw = params.post ?? params.body ?? params;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return {}; }
    }
    return raw && typeof raw === 'object' ? raw : {};
}

export default {
    async execute(params = {}) {
        const ai = params.$context || this;
        const opts = readOpts(params);
        const tts = await import(pathToFileURL(path.join(ROOT, 'sources/modules/tts/tts.js')).href);
        return tts.ensureReady({
            baseUrl: ai?.baseUrl,
            batPath: ai?.batPath,
            wait: opts.wait !== false && opts.wait !== 'false',
            timeoutMs: opts.timeoutMs ? Number(opts.timeoutMs) : 60_000,
        });
    },
};
