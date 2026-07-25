/**
 * health — готовность Qwen3-TTS (GET baseUrl/health).
 * this / $context = модель Local/Qwen3-TTS
 */
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const ROOT = process.cwd();

export default {
    async execute(params = {}) {
        const ai = params.$context || this;
        const tts = await import(pathToFileURL(path.join(ROOT, 'sources/modules/tts/tts.js')).href);
        return tts.checkHealth(ai?.baseUrl);
    },
};
