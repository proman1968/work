/**
 * Поток эмбеддингов: модель грузится один раз, запросы обрабатываются по очереди.
 * Сообщения: {id, texts: string[], model} → {id, vecs: Float32Array[]} | {id, error}.
 */
import { parentPort } from 'node:worker_threads';
import { pipeline } from '@xenova/transformers';

let extractor = null;
let loadedModel = '';

async function getExtractor(model) {
    if (!extractor || loadedModel !== model) {
        extractor = await pipeline('feature-extraction', model, { quantized: true });
        loadedModel = model;
    }
    return extractor;
}

parentPort.on('message', async ({ id, texts, model }) => {
    try {
        const ex = await getExtractor(model);
        const out = await ex(texts, { pooling: 'mean', normalize: true });
        const d = out.dims[out.dims.length - 1];
        const vecs = [];
        for (let i = 0; i < texts.length; i++)
            vecs.push(Float32Array.from(out.data.subarray(i * d, (i + 1) * d)));
        parentPort.postMessage({ id, vecs });
    }
    catch (e) {
        parentPort.postMessage({ id, error: e?.message || String(e) });
    }
});
