/**
 * Поток эмбеддингов: модель грузится один раз, запросы обрабатываются по очереди.
 * Сообщения: {id, texts, model, dtype} → {id, vecs, rss} | {id, error}.
 */
import { parentPort } from 'node:worker_threads';
import { pipeline, env } from '@huggingface/transformers';

// модели — вне дерева индексации и вне git; WORK_RAG_CACHE — общее хранилище (прогоны eval)
env.cacheDir = process.env.WORK_RAG_CACHE || './.index/hf';

let extractor = null;
let loadedKey = '';

async function getExtractor(model, dtype) {
    const key = model + '|' + dtype;
    if (!extractor || loadedKey !== key) {
        extractor = await pipeline('feature-extraction', model, { dtype });
        loadedKey = key;
    }
    return extractor;
}

parentPort.on('message', async ({ id, texts, model, dtype }) => {
    try {
        const ex = await getExtractor(model, dtype);
        const out = await ex(texts, { pooling: 'mean', normalize: true });
        const d = out.dims[out.dims.length - 1];
        const vecs = [];
        for (let i = 0; i < texts.length; i++)
            vecs.push(Float32Array.from(out.data.subarray(i * d, (i + 1) * d)));
        parentPort.postMessage({ id, vecs, rss: process.memoryUsage().rss });
    }
    catch (e) {
        parentPort.postMessage({ id, error: e?.message || String(e) });
    }
});
