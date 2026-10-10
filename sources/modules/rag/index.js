/**
 * RAG WORK — фасад модуля (см. readme.md).
 * Ядро вызывает только его: $folder.semantic_search / query_objects / clear_rag / rag_status,
 * а сохранение и удаление файлов уведомляют через globalThis.WORK_RAG.invalidate(path).
 */
import { CONFIG } from './config.js';
import * as store from './store.js';
import * as indexer from './indexer.js';
import { search, queryObjects } from './search.js';
import { workPathOf } from './extract.js';
import { invalidateLayers } from './scope.js';
import { stopEmbedder } from './embedder.js';

export const RAG = {
    CONFIG,

    /**
     * Запустить фоновую индексацию: наблюдение за диском + отложенная сверка.
     * Без start() поиск работает по уже построенному индексу, события игнорируются.
     */
    start(options = {}) {
        indexer.start(options);
        globalThis.WORK_RAG = RAG;
        return RAG;
    },

    async stop() {
        indexer.stop();
        await stopEmbedder();
        if (globalThis.WORK_RAG === RAG)
            delete globalThis.WORK_RAG;
    },

    /** Путь изменился (сохранён/удалён) — переиндексировать. */
    invalidate(path, opts) {
        indexer.invalidate(path, opts);
    },

    /** Изменилась структура (class.js, ROLES, #security) — сбросить проекции. */
    invalidateStructure() {
        invalidateLayers();
    },

    search,
    queryObjects,

    /** Удалить индекс поддерева точки и поставить его на переиндексацию. */
    async clear(point) {
        await store.open();
        const dir = workPathOf(point.real_dir ?? point.dir ?? point);
        const removed = store.removeDocs(dir);
        invalidateLayers();
        indexer.invalidate(dir || '.');
        return { removed, queued: indexer.isStarted() };
    },

    /** Полная сверка индекса с диском. */
    reconcile() {
        return indexer.reconcile();
    },

    async status() {
        const db = await store.open();
        return {
            model: CONFIG.model,
            chunker: CONFIG.chunker,
            indexCode: CONFIG.indexCode,
            ...indexer.status(),
            ...(db ? store.stats() : { error: 'индекс недоступен' }),
        };
    },
};
