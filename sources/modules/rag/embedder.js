/**
 * Эмбеддер: фасад над потоком embed-worker.js. Тяжёлые вычисления не блокируют
 * цикл событий сервера. Запрос поиска ждёт не больше одного пакета индексации.
 */
import { Worker } from 'node:worker_threads';
import { CONFIG } from './config.js';

let worker = null;
let seq = 0;
const pending = new Map();

function spawn() {
    worker = new Worker(new URL('./embed-worker.js', import.meta.url));
    worker.unref();
    worker.on('message', ({ id, vecs, error }) => {
        const p = pending.get(id);
        if (!p)
            return;
        pending.delete(id);
        error ? p.reject(new Error(error)) : p.resolve(vecs);
    });
    const fail = e => {
        for (const p of pending.values())
            p.reject(e instanceof Error ? e : new Error('embed worker: ' + e));
        pending.clear();
        worker = null;
    };
    worker.on('error', fail);
    worker.on('exit', code => code && fail('exit ' + code));
}

/**
 * Эмбеддинги текстов (нормализованные, mean pooling).
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]>}
 */
export function embed(texts) {
    if (!texts?.length)
        return Promise.resolve([]);
    if (!worker)
        spawn();
    const id = ++seq;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, texts, model: CONFIG.model });
    });
}

/** Эмбеддинги большими списками — пакетами CONFIG.batch. */
export async function embedAll(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += CONFIG.batch)
        out.push(...await embed(texts.slice(i, i + CONFIG.batch)));
    return out;
}

/** Остановить поток (тесты, остановка сервера). */
export async function stopEmbedder() {
    const w = worker;
    worker = null;
    if (w)
        await w.terminate().catch(() => {});
}
