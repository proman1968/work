/**
 * Серверный метод tts для $ai — синтез речи через Silero ONNX (локально).
 * this = модель $ai (передаётся через tryHandlerMethod → execute.call(item))
 *
 * POST body: { text: string }
 * Возвращает: Buffer (WAV audio)
 */
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const ROOT = process.cwd();

export default {
    async execute(params = {}, post) {
                console.log("[tts] params.post:", JSON.stringify(params.post), "params keys:", Object.keys(params));
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

        const ttsModule = await import(pathToFileURL(path.join(ROOT, 'sources/modules/tts/tts.js')).href);
        const wavBuffer = await ttsModule.synthesize(text);
        return wavBuffer;
    },
};