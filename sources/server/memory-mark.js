/**
 * Файл памяти агента (ai/memory.md) правится только инструментом memory (R2, final 8.30).
 * Ядро (save_file/delete) отказывает без этой пометки: обход через call, агентские
 * инструменты записи (write_table/writeBinary), загрузки и restore_from_history
 * не проходят мимо гарантий memory (пометки outbound, фильтра секретов, лимитов).
 * Пометка — Symbol: JSON.parse (HTTP, узел сети, агент) не может её подделать (как upload-mark.js).
 */
export const MEMORY = Symbol('work.memory-write');

/** Пометить параметры как легитимную запись файла памяти (инструмент memory). */
export function markMemoryWrite(params) {
    try {
        if (params && typeof params === 'object')
            params[MEMORY] = true;
    }
    catch { /* замороженный объект — останется без пометки и будет отклонён */ }
    return params;
}

/** Параметры — легитимная запись файла памяти? */
export function isMemoryWrite(params) {
    return !!(params && typeof params === 'object' && params[MEMORY] === true);
}

/** Путь — файл памяти ai/memory.md? (маскировка слэшей; регистр — Windows) */
export function isMemoryPath(p) {
    return /(^|\/)ai\/memory\.md$/i.test(String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/'));
}

/** Путь — файл памяти, а пометки легитимного писателя нет — отказ (fail-closed). */
export function assertNotMemory(path, params) {
    if (isMemoryPath(path) && !isMemoryWrite(params))
        throw new Error('файл памяти ai/memory.md правится только инструментом memory (remember/forget) — с подтверждением после чужого текста');
}
