/**
 * Модель списка объектов (чистые функции, без DOM): состояние списка (поиск, статус, период, фильтры
 * по полям, сортировка, страница) живёт в адресе (`q`, `status`, `from`, `to`, `order`, `page`,
 * `f.<поле>`) и превращается в параметры `db_query` — отбор, поиск и страницы считает сервер.
 */
import { listFields } from './fields.js';

export const PAGE_SIZE = 25;

/** Статусы для фильтра: у операций — жизненный цикл, у справочников — действующие и удалённые. */
export const STATUS_FILTERS = Object.freeze({
    operation: [
        { id: '', label: 'Все' }, { id: 'draft', label: 'Черновики' },
        { id: 'registered', label: 'Зарегистрированные' }, { id: 'cancelled', label: 'Отменённые' },
    ],
    catalog: [{ id: '', label: 'Действующие' }, { id: 'deleted', label: 'Удалённые' }],
});

const FILTER_PREFIX = 'f.';
const FILTER_TYPES = ['enum', 'boolean', 'link'];
const SORT_TYPES = ['string', 'number', 'money', 'integer', 'date', 'datetime', 'enum', 'boolean'];

/** Состояние списка из параметров маршрута. */
export function readListState(params = {}) {
    const filters = {};
    for (const [k, v] of Object.entries(params))
        if (k.startsWith(FILTER_PREFIX) && v !== '')
            filters[k.slice(FILTER_PREFIX.length)] = v;
    const page = Number.parseInt(params.page, 10);
    return {
        q: params.q || '',
        status: params.status || '',
        from: params.from || '',
        to: params.to || '',
        order: params.order || '',
        page: Number.isFinite(page) && page > 0 ? page : 1,
        filters,
    };
}

/** Состояние списка → параметры маршрута (значения по умолчанию не пишутся). */
export function listRouteParams(state = {}) {
    const out = {};
    for (const k of ['q', 'status', 'from', 'to', 'order'])
        if (state[k])
            out[k] = state[k];
    if (state.page > 1)
        out.page = String(state.page);
    for (const [k, v] of Object.entries(state.filters ?? {}))
        if (v !== '' && v != null)
            out[FILTER_PREFIX + k] = String(v);
    return out;
}

/** Изменить состояние: любой отбор возвращает на первую страницу, смена страницы — нет. */
export function patchListState(state, patch) {
    const next = { ...state, ...patch, filters: { ...state.filters, ...(patch.filters ?? {}) } };
    if (!('page' in patch))
        next.page = 1;
    for (const [k, v] of Object.entries(next.filters))
        if (v === '' || v == null)
            delete next.filters[k];
    return next;
}

/** Сортировка по умолчанию: операции — новые сверху, справочники — по первому текстовому полю. */
export function defaultOrder(schema) {
    if (schema?.family === 'catalog') {
        const f = (schema.fields || []).find(x => x.type === 'string');
        if (f)
            return f.id;
    }
    return '-time';
}

/** Следующая сортировка по клику на колонку: по возрастанию → по убыванию → по возрастанию. */
export function nextOrder(current, key) {
    return current === key ? '-' + key : key;
}

/** Колонка можно сортировать (дата, статус, числа, строки, списки; ссылки и таблицы — нет). */
export function sortable(column) {
    return column.key === 'time' || column.key === 'status' || (!!column.field && SORT_TYPES.includes(column.field.type));
}

/** Поля, по которым есть отбор: список, да/нет и ссылка (значение — один вариант). */
export function filterFields(schema) {
    return (schema?.fields || []).filter(f => FILTER_TYPES.includes(f.type) && (f.type !== 'link' || f.targetPath));
}

/** Условия `where` из значений фильтров: да/нет — 1/0 (так хранит json_extract). */
export function whereOf(schema, filters = {}) {
    const where = {};
    for (const f of schema?.fields || []) {
        const v = filters[f.id];
        if (v === undefined || v === '')
            continue;
        where[f.id] = f.type === 'boolean' ? (v === 'true' || v === '1' ? 1 : 0) : v;
    }
    return where;
}

/**
 * Параметры `db_query` для списка.
 * @param {object} state `readListState`
 * @param {object} schema Схема класса (`db_schema`)
 * @param {object} [opts] `{ unit }` — подразделение контекста (только для операций: данные справочников общие)
 */
export function listQuery(state, schema, { unit = '' } = {}) {
    const where = whereOf(schema, state.filters);
    const op = schema?.family === 'operation';
    return {
        deep: true,
        limit: PAGE_SIZE,
        offset: (state.page - 1) * PAGE_SIZE,
        order: state.order || defaultOrder(schema),
        search: state.q.trim(),
        status: state.status,
        from: op ? state.from : '',
        to: op ? state.to : '',
        unit: op ? unit : '',
        where: Object.keys(where).length ? where : '',
    };
}

/**
 * Колонки списка: у операций — дата, статус и (для группы) вид операции, затем поля схемы; у
 * справочников — поля схемы, а без полей — название. `key` — сортировка и подпись.
 */
export function listColumns(schema) {
    const cols = [];
    const op = schema?.family === 'operation';
    if (op) {
        cols.push({ key: 'time', label: 'Дата', kind: 'time' }, { key: 'status', label: 'Статус', kind: 'status' });
        if (!schema.leaf)
            cols.push({ key: 'cls', label: 'Операция', kind: 'class' });
    }
    const fields = listFields(schema, op ? 4 : 6);
    for (const f of fields)
        cols.push({ key: f.id, label: f.label || f.id, kind: 'field', field: f });
    if (!fields.length && !(op && !schema.leaf))
        cols.push({ key: 'title', label: 'Название', kind: 'title' });
    return cols;
}
