/**
 * Настройки RAG. Версии модели/чанкера/формата входов входят в ключ содержимого:
 * их смена переиндексирует документы без ручной очистки (store.open сбрасывает индекс).
 *
 * Модель по умолчанию — EmbeddingGemma 2 (final 8.8): окно 8K токенов (куски не обрезаются),
 * 100+ языков, поиск по коду; текстовая часть 270M. Служебные префиксы task:/title: —
 * часть контракта модели (см. docInput/queryInput). fp16 запрещён карточкой модели (тихий NaN).
 */
const MODEL = process.env.WORK_RAG_MODEL || 'onnx-community/embeddinggemma-2-ONNX';
const GEMMA = /embeddinggemma/i.test(MODEL);

export const CONFIG = {
    /** Модель эмбеддингов (transformers.js; прежняя — Xenova/paraphrase-multilingual-MiniLM-L12-v2). */
    model: MODEL,
    /** Размерность векторов (у MiniLM — 384, у EmbeddingGemma — 768; WORK_RAG_DIMS — override). */
    dims: Number(process.env.WORK_RAG_DIMS) || (GEMMA ? 768 : 384),
    /** Точность ONNX: q8 (быстро, ~314 МБ) | fp32 (~1 ГБ). fp16 не использовать. */
    dtype: process.env.WORK_RAG_DTYPE || 'q8',
    /** Версия формата входов (префиксы EmbeddingGemma) — в ключе содержимого. */
    inputVersion: GEMMA ? 'p2' : 'p1',
    /** Версия чанкера и карточек: увеличить при изменении нарезки/формата карточек. */
    chunker: 'c3',
    chunk: { max: 700, overlap: 120, min: 30 },
    /** Пакет эмбеддингов за один вызов воркера. */
    batch: 8,
    /** Лимиты документа. */
    maxFileBytes: 20 * 1024 * 1024,
    maxTextChars: 400_000,
    /** Корневые папки и имена, которые не индексируются никогда. */
    excludeRoots: ['node_modules', 'sources', 'oda', 'tests', 'scripts', 'torus'],
    excludeNames: ['node_modules', '#secret', '#system', 'INDEX', '.git', '.svn', '.index', '.RAG', '.cursor', '.vscode'],
    /** Текст, извлекаемый как есть. */
    textExts: ['md', 'markdown', 'txt', 'csv', 'tsv', 'yaml', 'yml', 'skill', 'ai', 'chat', 'rst', 'adoc'],
    /** Документы, извлекаемые Kreuzberg / разбором таблиц. */
    officeExts: ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'xlsm', 'odt', 'ods', 'odp', 'rtf', 'htm', 'html', 'eml'],
    /** Код и конфигурация — выключено по умолчанию (агенту по коду — find/read). */
    codeExts: ['js', 'mjs', 'ts', 'mts', 'css', 'json', 'xml', 'py'],
    indexCode: process.env.WORK_RAG_CODE === '1',
    /** Базовые расширения-точки ($server/$folder/$file/$ext с point: true) — пополняются при обходе. */
    dataExts: ['data', 'eml', 'ics', 'call', 'task', 'logs'],
    /** Поиск. */
    search: {
        k: 8,
        rings: 3,
        maxContexts: 40,
        perDoc: 2,
        ftsLimit: 400,
        rrfK: 60,
        minVectorSim: 0.25,
        weights: { point: 1, pointOther: 0.8, cabinet: 0.85, ringDecay: 0.7, ringOther: 0.8, layerDecay: 0.93, layerMin: 0.6 },
    },
    /** Отложенный старт полной сверки после запуска сервера. */
    reconcileDelayMs: 15_000,
};

/** Ключ версии содержимого (в hash документа). */
export function contentVersion() {
    return CONFIG.model + '|' + CONFIG.chunker + '|' + CONFIG.inputVersion;
}

/** Модель семейства EmbeddingGemma (префиксы входа обязательны). */
const isGemma = m => /embeddinggemma/i.test(m);

/** Вход документа для эмбеддинга: EmbeddingGemma требует префикс «title | text». */
export function docInput(title, text, model = CONFIG.model) {
    const t = String(title || '').slice(0, 300).replace(/\s+/g, ' ').trim();
    if (isGemma(model))
        return 'title: ' + (t || 'none') + ' | text: ' + text;
    return (t ? t + '\n' : '') + text;
}

/** Вход запроса поиска: EmbeddingGemma требует префикс «task: search result | query:». */
export function queryInput(q, model = CONFIG.model) {
    return isGemma(model) ? 'task: search result | query: ' + String(q) : String(q);
}
