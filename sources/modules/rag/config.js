/**
 * Настройки RAG. Версии модели/чанкера входят в ключ содержимого:
 * их смена переиндексирует документы без ручной очистки.
 */
export const CONFIG = {
    /** Модель эмбеддингов (transformers.js). Макс. длина входа — 128 токенов: чанки короткие. */
    model: process.env.WORK_RAG_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    dims: 384,
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
    /** Базовые типы файлов данных ($server/$folder/$file/$data/$…) — пополняются при обходе. */
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
    return CONFIG.model + '|' + CONFIG.chunker;
}
