/**
 * Нормализация полей WORK в каноническое дерево (общая модель для oda-table и oda-form).
 * Чистая функция: без ODA, DOM и WORK, проверяется в node.
 *
 * Вход: список полей WORK (`METADATA.FIELDS` / `METADATA.STATIC`), вложенные поля — в `fields`
 * (или уже в `children`: повторная нормализация безопасна).
 * Выход: узлы `{ id, label, type, required, readonly, children, ...прочее }`:
 * - `children` — только описания полей (у `Table` это колонки);
 * - `type` — канонический PascalCase из словаря, иное (путь класса, имя контрола) — как есть;
 * - `required`, `readonly` — булевы; `require` и `fields` в узле не сохраняются;
 * - служебные поля верхнего уровня (`SYSTEM_IDS` или `system: true`) по умолчанию не попадают в список.
 * Прочие ключи (`width`, `order`, `hidden`, `placeholder`, `icon`, `items`, `options` и т. п.) переносятся
 * как есть: это начальные значения вида и подсказки контролов, модель их не интерпретирует.
 * Вход не мутируется.
 */

/** канонические типы: ключ — нижний регистр, значение — PascalCase */
const TYPES = { string: 'String', text: 'Text', number: 'Number', date: 'Date', datetime: 'DateTime', boolean: 'Boolean', table: 'Table' };

/** служебные поля объекта WORK (только верхний уровень) */
const SYSTEM_IDS = ['id', 'time', 'posted', 'deleted'];

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * тип: `Link` + `catalog` — путь справочника (ссылка = путь в `type`); из словаря — в PascalCase;
 * прочие строки (путь класса, имя контрола) — как есть
 */
export function canonicalType(type, catalog) {
    if (type === 'Link' && typeof catalog === 'string' && catalog.trim())
        return catalog.trim();
    if (typeof type !== 'string' || !type)
        return undefined;
    return TYPES[type.toLowerCase()] ?? type;
}

/** узлы одного уровня, без фильтрации (вложенные поля служебными не скрываются) */
function nodesOf(list) {
    const out = [];
    for (const field of list) {
        if (!isObj(field))
            continue;
        const { fields, children, require: _require, ...rest } = field;
        const id = field.id === undefined || field.id === null ? '' : String(field.id);
        out.push({
            ...rest,
            id,
            label: field.label ?? field.id,
            type: canonicalType(field.type, field.catalog),
            required: field.required === true,
            readonly: field.readonly === true,
            system: field.system === true || SYSTEM_IDS.includes(id),
            children: nodesOf(Array.isArray(fields) ? fields : Array.isArray(children) ? children : []),
        });
    }
    return out;
}

/**
 * @param {Array|*} list — поля WORK; не массив → []
 * @param {{system?: boolean}} [options] — `system: true` оставляет служебные поля верхнего уровня
 * @returns {Array} узлы дерева полей
 */
export function normalizeFields(list, { system = false } = {}) {
    const nodes = Array.isArray(list) ? nodesOf(list) : [];
    return system ? nodes : nodes.filter(node => !node.system);
}
