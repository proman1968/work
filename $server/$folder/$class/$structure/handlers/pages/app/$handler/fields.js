/**
 * Поля объектов для интерфейса (чистые функции, без DOM): виды ввода по типу из схемы, значения формы
 * («черновик») ↔ тело объекта, проверка обязательных полей, подписи значений в списках.
 *
 * Дата поля `date` пишется строкой 'ГГГГ-ММ-ДД' (день считает сервер по своим часам), `datetime` и дата
 * операции — моментом в мс из местного времени браузера. Числа уходят строками как введены:
 * приведение и ошибки «не число» — на сервере (`DataError.errors` по полям).
 */

export const TYPE_LABELS = Object.freeze({
    string: 'Строка', text: 'Текст', number: 'Число', money: 'Деньги', integer: 'Целое', boolean: 'Да/нет',
    date: 'Дата', datetime: 'Дата и время', link: 'Ссылка', table: 'Таблица', enum: 'Список', file: 'Файл',
});

const pad = n => String(n).padStart(2, '0');

export const isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/** Подпись поля. */
export const fieldLabel = f => String(f?.label || f?.id || '');

/** Вид ввода по типу поля. */
export function inputKind(f) {
    switch (f?.type) {
        case 'text': return 'textarea';
        case 'number': case 'money': case 'integer': return 'number';
        case 'boolean': return 'boolean';
        case 'date': return 'date';
        case 'datetime': return 'datetime';
        case 'enum': return 'enum';
        case 'link': return 'link';
        case 'table': return 'table';
        default: return 'text';
    }
}

/** Варианты списка: `values`/`options` — строки или `{ id, label }`. */
export function enumOptions(f) {
    return (f?.values || f?.options || []).map(v => (v !== null && typeof v === 'object'
        ? { value: String(v.id ?? v.value), label: String(v.label ?? v.title ?? v.id ?? v.value) }
        : { value: String(v), label: String(v) }));
}

/* ---------- время ---------- */

/** 'ГГГГ-ММ-ДД' местного дня момента. */
export function toDay(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'ГГГГ-ММ-ДДTЧЧ:ММ' местного времени момента (поле `datetime-local`). */
export function toLocalInput(ms) {
    const d = new Date(ms);
    return `${toDay(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Момент из значения поля `datetime-local` или даты; не разобралось — null. */
export function fromLocalInput(s) {
    if (isEmpty(s))
        return null;
    const t = new Date(String(s)).getTime();
    return Number.isFinite(t) ? t : null;
}

/** 'ДД.ММ.ГГГГ' по моменту. */
export function formatDay(ms) {
    const d = new Date(ms);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** 'ДД.ММ.ГГГГ ЧЧ:ММ' по моменту. */
export function formatDateTime(ms) {
    const d = new Date(ms);
    return `${formatDay(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- числа ---------- */

const moneyFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 });

export const formatMoney = v => moneyFmt.format(Number(v));
export const formatNumber = v => numberFmt.format(Number(v));

/** Число из введённого: пробелы и запятая допускаются; не число — null. */
export function parseNumber(v) {
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
    if (!s)
        return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/* ---------- значения формы ---------- */

/** Значение поля из тела объекта в виде для ввода. */
export function toDraftValue(f, v) {
    if (isEmpty(v))
        return f.type === 'table' ? [] : undefined;
    switch (f.type) {
        case 'date': return toDay(v);
        case 'datetime': return toLocalInput(v);
        case 'table': return v.map(row => toDraft(f.fields, row));
        case 'link': return String(typeof v === 'object' ? v.id : v);
        default: return v;
    }
}

/** Тело объекта → значения формы (даты — строками для ввода, таблица — списком строк). */
export function toDraft(fields, body = {}) {
    const out = {};
    for (const f of fields || []) {
        const v = toDraftValue(f, body?.[f.id]);
        if (v !== undefined)
            out[f.id] = v;
    }
    return out;
}

/** Пустая строка табличной части: `{}`. */
export const emptyRow = () => ({});

/** Значения формы → тело для сервера: пустое не передаётся, строки без значений отбрасываются. */
export function toBody(fields, draft = {}) {
    const out = {};
    for (const f of fields || []) {
        const v = draft?.[f.id];
        if (isEmpty(v) && v !== false)
            continue;
        switch (f.type) {
            case 'table': {
                const rows = v.map(r => toBody(f.fields, r)).filter(r => Object.keys(r).length);
                if (rows.length)
                    out[f.id] = rows;
                break;
            }
            case 'number': case 'money': case 'integer': {
                const n = parseNumber(v);
                out[f.id] = n === null ? String(v) : n;
                break;
            }
            case 'datetime': {
                const t = fromLocalInput(v);
                out[f.id] = t ?? String(v);
                break;
            }
            case 'string': case 'text': case 'file': {
                const s = String(v).trim();
                if (s)
                    out[f.id] = s;
                break;
            }
            case 'boolean':
                out[f.id] = v === true || v === 'true';
                break;
            default:
                out[f.id] = v;
        }
    }
    return out;
}

/**
 * Форма перед отправкой: пустые строки табличных частей убираются, чтобы номера строк в нарушениях
 * сервера (`lines[2].qty`) совпадали со строками на экране.
 */
export function pruneDraft(fields, draft = {}) {
    const out = { ...draft };
    for (const f of fields || [])
        if (f.type === 'table' && Array.isArray(out[f.id]))
            out[f.id] = out[f.id]
                .filter(r => Object.keys(toBody(f.fields, r)).length)
                .map(r => pruneDraft(f.fields, r));
    return out;
}

/** Путь поля в строке табличной части: `lines[2].qty` (так же пишет сервер в `DataError.errors`). */
export const rowPath = (table, index, field) => `${table}[${index + 1}].${field}`;

/**
 * Проверка обязательных полей до отправки. Табличная часть обязательна — нужна хоть одна строка с
 * значениями; в заполненных строках обязательные поля колонок проверяются у каждой.
 * @returns {Record<string, string>} путь поля → сообщение
 */
export function validateDraft(fields, draft = {}, prefix = '') {
    const errors = {};
    for (const f of fields || []) {
        const v = draft?.[f.id];
        if (f.type === 'table') {
            const rows = (Array.isArray(v) ? v : []).map((r, i) => ({ r, i })).filter(({ r }) => Object.keys(toBody(f.fields, r)).length);
            if (!rows.length && f.required)
                errors[prefix + f.id] = 'добавьте хотя бы одну строку';
            for (const { r, i } of rows)
                Object.assign(errors, validateDraft(f.fields, r, `${prefix}${f.id}[${i + 1}].`));
        }
        else if (f.required && isEmpty(v) && v !== false)
            errors[prefix + f.id] = 'обязательное поле';
    }
    return errors;
}

/** Нарушения сервера `[{ field?, message }]` → путь поля → сообщение; без поля — под ключом ''. */
export function errorMap(list = []) {
    const out = {};
    for (const e of list) {
        const key = e.field || '';
        out[key] = out[key] ? `${out[key]}; ${e.message}` : e.message;
    }
    return out;
}

/* ---------- показ значений ---------- */

/**
 * Значение для ячейки списка или строки: деньги и числа по-русски, даты, да/нет, ссылки — названием.
 * @param {object} f Поле схемы
 * @param {*} v Значение из тела
 * @param {Record<string, string>} [names] Названия объектов по id
 */
export function formatValue(f, v, names = {}) {
    if (isEmpty(v) && v !== false)
        return '';
    switch (f?.type) {
        case 'money': return formatMoney(v);
        case 'number': case 'integer': return formatNumber(v);
        case 'boolean': return v ? 'Да' : 'Нет';
        case 'date': return formatDay(v);
        case 'datetime': return formatDateTime(v);
        case 'link': return names[String(typeof v === 'object' ? v.id : v)] ?? String(v);
        case 'table': return `${v.length} ${plural(v.length, 'строка', 'строки', 'строк')}`;
        default: return String(v);
    }
}

/** Склонение по числу: 1 строка, 2 строки, 5 строк. */
export function plural(n, one, few, many) {
    const m10 = Math.abs(n) % 10, m100 = Math.abs(n) % 100;
    if (m10 === 1 && m100 !== 11)
        return one;
    return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

/** Итоги по числовым колонкам табличной части: `{ поле: сумма }` (только деньги, количества и числа). */
export function columnTotals(fields, rows = []) {
    const out = {};
    for (const f of fields || []) {
        if (!['money', 'number', 'integer'].includes(f.type))
            continue;
        let sum = 0, any = false;
        for (const r of rows) {
            const n = parseNumber(r?.[f.id]);
            if (n !== null) {
                sum += n;
                any = true;
            }
        }
        if (any)
            out[f.id] = Math.round(sum * 1e6) / 1e6;
    }
    return out;
}

/** Колонки списка по схеме: поля без текстов, таблиц и файлов, не больше `max`. */
export function listFields(schema, max = 5) {
    return (schema?.fields || []).filter(f => !['text', 'table', 'file'].includes(f.type)).slice(0, max);
}

/** Заголовок объекта для шапки формы: название, иначе класс. */
export const objectTitle = (obj, schema) => obj?.title || schema?.label || '';
