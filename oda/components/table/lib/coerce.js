/**
 * Приведение значения ячейки к типу колонки (чистая функция, без ODA и без DOM).
 * Источник — oda/components/table/lib/coerce.js (этап 3 rewrite, старая таблица заморожена).
 * Возвращает { ok: true, value } или { ok: false } (отказ от записи).
 * Правила: пробелы по краям срезаются; '' → undefined (очистка);
 * ловушки Number(' ') === 0 и Boolean('0') === true явно исключены.
 */
const str = v => typeof v === 'string' ? v.trim() : v;

function coerceNumber(value) {
    const v = str(value);
    if (v === '' || v === undefined)
        return { ok: true, value: undefined };
    if (typeof v === 'number')
        return Number.isNaN(v) ? { ok: false } : { ok: true, value: v };
    if (typeof v !== 'string')
        return { ok: false };
    const n = Number(v);
    return Number.isNaN(n) ? { ok: false } : { ok: true, value: n };
}

function coerceBoolean(value) {
    const v = str(value);
    if (v === '' || v === undefined || v === null)
        return { ok: true, value: undefined };
    if (v === true || v === 1)
        return { ok: true, value: true };
    if (v === false || v === 0)
        return { ok: true, value: false };
    if (typeof v === 'string') {
        const s = v.toLowerCase();
        if (s === 'true')
            return { ok: true, value: true };
        if (s === 'false')
            return { ok: true, value: false };
    }
    return { ok: false };
}

function coerceDate(value) {
    const v = str(value);
    if (v === '' || v === undefined || v === null)
        return { ok: true, value: undefined };
    if (typeof v !== 'string')
        return { ok: false };
    // строка как есть (в данных лежат ISO-строки, объект Date не создаём); проверка — разбором
    return Number.isNaN(Date.parse(v)) ? { ok: false } : { ok: true, value: v };
}

export function coerceValue(value, type) {
    if (value === null)
        return { ok: true, value: undefined };
    switch (String(type ?? '').toLowerCase()) {
        case 'number':
            return coerceNumber(value);
        case 'boolean':
            return coerceBoolean(value);
        case 'date':
        case 'time':
        case 'month':
        case 'week':
        case 'datetime':
        case 'timestamp':
            return coerceDate(value);
        default:
            return { ok: true, value };
    }
}
