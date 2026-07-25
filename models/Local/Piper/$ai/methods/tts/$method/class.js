/**
 * tts — синтез речи через Piper (ensureReady + POST /tts).
 * POST body: { text: string }
 * @returns {Buffer} WAV
 */
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const ROOT = process.cwd();

export default {
    async execute(params = {}) {
        const ai = params.$context || this;
        let text = '';
        const raw = params.post ?? params.body ?? params;
        if (typeof raw === 'string') {
            try { text = JSON.parse(raw).text || ''; } catch { text = raw; }
        } else if (raw && typeof raw === 'object') {
            text = String(raw.text || '');
        }
        text = text.trim();
        if (!text)
            throw new Error('Текст для озвучки пуст');

        const tts = await import(pathToFileURL(path.join(ROOT, 'sources/modules/tts/tts.js')).href);
        return tts.synthesize(text, {
            baseUrl: ai?.baseUrl,
            batPath: ai?.batPath,
            ensure: true,
            timeoutMs: 60_000,
        });
    },
};
