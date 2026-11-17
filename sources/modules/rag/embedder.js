/**
 * Эмбеддер: фасад над потоком embed-worker.js. Тяжёлые вычисления не блокируют
 * цикл событий сервера. Запрос поиска ждёт не больше одного пакета индексации.
 */
import { Worker } from 'node:worker_threads';
import { CONFIG } from './config.js';

let worker = null;
let idleTimer = null;
let seq = 0;
const pending = new Map();
/** Время простоя до выгрузки ONNX-воркера (~600–800 МБ ОЗУ и фоновые потоки ONNX Runtime). */
const WORKER_IDLE_MS = 60_000;

function armIdle() {
    clearTimeout(idleTimer);
    if (pending.size || !worker)
        return;
    idleTimer = setTimeout(() => {
        if (!pending.size && worker)
            stopEmbedder();
    }, WORKER_IDLE_MS);
    idleTimer.unref?.();
}

function spawn() {
    worker = new Worker(new URL('./embed-worker.js', import.meta.url));
    worker.unref();
    worker.on('message', ({ id, vecs, error }) => {
        const p = pending.get(id);
        if (!p)
            return;
        pending.delete(id);
        armIdle();
        error ? p.reject(new Error(error)) : p.resolve(vecs);
    });
    const fail = e => {
        clearTimeout(idleTimer);
        for (const p of pending.values())
            p.reject(e instanceof Error ? e : new Error('embed worker: ' + e));
        pending.clear();
        worker = null;
    };
    worker.on('error', fail);
    worker.on('exit', code => code && fail('exit ' + code));
}

/** Найти активную локальную модель в /MODELS/Local по capability (`embeddings` | `rerank`). */
export async function resolveLocalRagModel(cap = 'embeddings') {
    try {
        const local = await globalThis.WORK?.get_item?.('/MODELS/Local').catch(() => null);
        for (const m of (await local?.items) || []) {
            if (!m || Array.isArray(m))
                continue;
            await m.init?.catch?.(() => {});
            if ((m.aiActive ?? m.DATA?.aiActive) === false || m.DATA?.enabled === false)
                continue;
            const c = m.capabilities ?? m.DATA?.capabilities;
            const list = Array.isArray(c) ? c.map(s => String(s).toLowerCase()) : String(c || '').split(/[\s,]+/).map(s => s.toLowerCase());
            if (list.includes(cap))
                return m;
        }
    }
    catch { /* ignore */ }
    return null;
}

export async function activeEmbedModelKey() {
    const local = await resolveLocalRagModel('embeddings');
    return local ? String(local.model || local.id || 'local-embed') : CONFIG.model;
}

/**
 * Эмбеддинги текстов (нормализованные, mean pooling).
 * Если в /MODELS/Local активна модель эмбеддингов (напр. BGE-M3), используем её,
 * иначе встроенный ONNX-воркер (EmbeddingGemma 2).
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]>}
 */
export async function embed(texts) {
    if (!texts?.length)
        return [];
    const localModel = await resolveLocalRagModel('embeddings');
    if (localModel && typeof localModel.embed === 'function') {
        try {
            const res = await localModel.embed({ input: texts });
            const list = (res?.data || []).map(d => new Float32Array(d.embedding || []));
            if (list.length === texts.length && list[0]?.length > 0)
                return list;
        }
        catch { /* fallback к ONNX-воркеру */ }
    }
    clearTimeout(idleTimer);
    if (!worker)
        spawn();
    const id = ++seq;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, texts, model: CONFIG.model, dtype: CONFIG.dtype });
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
    clearTimeout(idleTimer);
    const w = worker;
    worker = null;
    if (w)
        await w.terminate().catch(() => {});
}
