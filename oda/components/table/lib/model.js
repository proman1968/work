/**
 * Слои данных oda-table. Чистые функции: без ODA, Reactor, DOM и WORK — импортируются в node.
 * Цепочка: `wrapTree` → `filterTree` → `flattenTree` (сортировка братьев ленивая, внутри) →
 * `groupItems` → `sliceWindow`. `sortTree` — отдельная утилита (тесты), в боевом пути не участвует.
 * Инварианты: объекты данных не мутируются; пустой результат — `[]`, не `null`/`undefined`.
 */
import { coerceValue } from './coerce.js';

const isArr = v => Array.isArray(v);

/**
 * Сырой объект из-под реактивного прокси (прокси и исходник расходятся в `===`).
 * @param {*} v — любой объект
 * @returns {*} исходный объект или `v` без изменений
 */
export function raw(v) {
    const R = globalThis.R;
    if ((typeof v !== 'object' && typeof v !== 'function') || v === null || R === undefined)
        return v;
    return v[R]?.target ?? v;
}

/** обёртка-копия узла (слой не мутирует вход) */
const copyNode = (node, items) => ({ ...node, items });

/**
 * Данные → дерево обёрток. Дети собираются **лениво**: обёртки потомков строятся при первом
 * обращении к `items`, а линеаризация читает `items` только у раскрытых узлов (`flattenTree`).
 * Поэтому свёрнутые ветви не обходятся, а уже построенные дети переживают сворачивание
 * (повторное раскрытие берёт готовые). Два разных признака: `allowExpand` («дети могут быть»,
 * заглядывание в данные — показывать ли экспандер) и `hasChildren` («дети фактически загружены»,
 * кэш есть — по ним можно идти фильтром, не провоцируя загрузку; важно для асинхронных детей).
 * Состояние (`expanded`/`checked`/`focused`) — поля обёртки: их читает линеаризация (значит,
 * зависит), а строка пишет через прокси — кэш слоёв сбрасывает Reactor.
 * @param {Array} dataSet — строки потребителя (не мутируются)
 * @param {{childrenKey?: string, cache?: WeakMap}} [options] — ключ детей; кэш обёрток по объекту данных
 * @returns {Array} обёртки верхнего уровня (`items: []`, если детей нет)
 */
export function wrapTree(dataSet, { childrenKey = 'items', cache } = {}) {
    const childrenOf = data => (data && typeof data === 'object' && isArr(data[childrenKey])) ? data[childrenKey] : [];

    /** обёртки одного уровня; `hasChildren` у каждого — по его собственным данным (один шаг, без сборки) */
    function buildLevel(rows, level) {
        const out = [];
        for (const data of rows) {
            if (data === null || data === undefined || typeof data !== 'object')
                continue;
            out.push(wrapNode(data, level));
        }
        return out;
    }

    function wrapNode(data, level) {
        const key = raw(data);
        let node = cache?.get(key);
        if (!node) {
            const source = {
                data,
                level,
                expanded: !!data.expanded,
                checked: data.checked ?? 'unchecked',
                focused: false,
                // `allowExpand` — «дети могут быть»: заглядывание в данные, без сборки обёрток.
                // Им решается, показывать ли экспандер (маркеру нужно знать о потомках до сборки).
                allowExpand: childrenOf(data).length > 0,
            };
            // `__items` — кэш детей (замыкание): undefined — ещё не загружали; собираем при первом
            // обращении к `items` и пересобираем, только если массив детей в данных сменился
            let built;
            let builtFrom;
            Object.defineProperty(source, 'items', {
                configurable: true,
                get() {
                    const children = childrenOf(data);
                    if (built === undefined || builtFrom !== children) {
                        builtFrom = children;
                        built = buildLevel(children, level + 1);
                    }
                    return built;
                }
            });
            // `hasChildren` — «дети фактически загружены» (кэш есть): по ним фильтр может идти,
            // не провоцируя загрузку (важно для асинхронных детей)
            Object.defineProperty(source, 'hasChildren', {
                configurable: true,
                enumerable: true,
                get() {
                    return built !== undefined;
                }
            });
            // явная активация: без неё мутация обёртки не вызовет reset_deps,
            // и чтение `expanded` в линеаризации не даст зависимости
            node = globalThis.Reactor?.activate ? globalThis.Reactor.activate(source) : source;
            cache?.set(key, node);
        }
        if (node.level !== level)
            node.level = level;
        return node;
    }

    return buildLevel(isArr(dataSet) ? dataSet : [], 0);
}

/** у колонки собственный `valueOf(data)` обёртки (не унаследованный `Object.prototype.valueOf`) */
const hasValueOf = col => typeof col?.valueOf === 'function' && col.valueOf !== Object.prototype.valueOf;

/**
 * Совпадение текста с колонкой в строке: вхождение подстроки без учёта регистра (`needle` — уже
 * в нижнем регистре). Обёртка колонки читается по `valueOf` (учитывает `valueKey` и путь по `id`);
 * `deep` — проверять и вложенные поля (рекурсивно, в том числе у свёрнутой колонки: значение
 * берётся по пути в данных). Описание без `valueOf` — по `data[name ?? id]`.
 */
function columnMatches(col, data, needle, deep) {
    if (hasValueOf(col)) {
        const v = col.valueOf(data);
        if (v !== undefined && v !== null && String(v).toLowerCase().includes(needle))
            return true;
        if (deep)
            for (const child of col.children ?? [])
                if (columnMatches(child, data, needle, deep))
                    return true;
        return false;
    }
    const name = col?.name ?? col?.id;
    return name ? String(data?.[name] ?? '').toLowerCase().includes(needle) : false;
}

/** предикат поиска по колонкам (как глобальный `filter` старой таблицы: вхождение подстроки, регистр не важен) */
export function searchPredicate(search, columns) {
    const s = String(search ?? '').toLowerCase();
    if (!s)
        return undefined;
    const list = (columns ?? []).filter(Boolean);
    if (!list.length)
        return undefined;
    return data => list.some(col => columnMatches(col, data, s, true));
}

/**
 * Предикат фильтров колонок (Р4): строка проходит, если совпала с **каждым** заданным фильтром (И).
 * Совпадение — как у глобального поиска: подстрока без учёта регистра.
 * - колонка, показанная листом (свёрнутая или без детей), — по своему `valueOf` **и** вложенным
 *   полям (как `searchPredicate`): свёрнутый родитель в ячейке показывает своё значение, а ищется
 *   и по скрытым под ним полям;
 * - раскрытый родитель — не лист фронта: его собственный фильтр не действует, действуют фильтры
 *   детей (у каждого своя колонка); свернуть — и снова действует собственный (глубокий).
 * Текст нормализуется (`trim`); пустой — отсутствие фильтра. Ключ без колонки в `columns`
 * (колонку убрали из метаданных) — пропускается. Нет ни одного действующего фильтра → `undefined`
 * (слой фильтра не включается).
 * @param {object} filters — `{ [key]: текст }` (`columnFilter` таблицы; не мутируется)
 * @param {Array} columns — фронт видимых колонок (`layout.leaves` таблицы): ключ вне фронта
 *   (скрытая колонка, дитя свёрнутого родителя, удалённая колонка) — фильтр по нему не действует
 * @returns {((data: object) => boolean)|undefined}
 */
function normalizeDateCell(v) {
    if (v === undefined || v === null || v === '')
        return '';
    const s = String(v).trim();
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (iso)
        return iso[1];
    const ru = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
    if (ru)
        return `${ru[3]}-${ru[2]}-${ru[1]}`;
    return s;
}

export function columnFilterPredicate(filters, columns) {
    if (!filters || typeof filters !== 'object')
        return undefined;
    const byKey = new Map();
    for (const col of isArr(columns) ? columns : [])
        if (col?.key !== undefined && col?.key !== null && !byKey.has(String(col.key)))
            byKey.set(String(col.key), col);
    const tests = [];
    for (const [key, text] of Object.entries(filters)) {
        const rawText = text === undefined || text === null ? '' : String(text).trim();
        const col = byKey.get(key);
        if (!rawText || !col)
            continue;
        if (rawText.startsWith('@in:')) {
            let list = null;
            try {
                list = JSON.parse(rawText.slice(4));
            }
            catch { list = null; }
            if (Array.isArray(list)) {
                const allowed = new Set(list.map(x => x === null || x === undefined ? '' : String(x)));
                tests.push(data => {
                    const v = hasValueOf(col) ? col.valueOf(data) : data?.[col?.name ?? col?.id];
                    const str = (v === undefined || v === null || v === '') ? '' : String(v);
                    if (allowed.has(str))
                        return true;
                    if (col?.field?.formatMoney && str !== '' && Number.isFinite(Number(v))) {
                        const fmt = Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        if (allowed.has(fmt))
                            return true;
                    }
                    return false;
                });
                continue;
            }
        }
        if (rawText.startsWith('@date:')) {
            const spec = rawText.slice(6).trim();
            if (!spec)
                continue;
            const [from, to] = spec.includes('..') ? spec.split('..') : [spec, spec];
            tests.push(data => {
                const v = hasValueOf(col) ? col.valueOf(data) : data?.[col?.name ?? col?.id];
                const d = normalizeDateCell(v);
                if (!d)
                    return false;
                return d >= from && d <= (to || from);
            });
            continue;
        }
        const needle = rawText.toLowerCase();
        const deep = !col.expanded;
        tests.push(data => columnMatches(col, data, needle, deep));
    }
    return allPredicates(...tests);
}

/**
 * Комбинация предикатов через И: не-функции отбрасываются; ни одного → `undefined` (фильтра нет),
 * один → он же, иначе — строка проходит, если прошла все.
 * @param {...Function} predicates
 * @returns {Function|undefined}
 */
export function allPredicates(...predicates) {
    const list = predicates.filter(p => typeof p === 'function');
    if (list.length <= 1)
        return list[0];
    return data => list.every(p => p(data));
}

/**
 * Фильтр по дереву: узел проходит, если совпал сам или любой его потомок;
 * ветка без совпадений отсекается. Дети — только совпавшие (как в старой таблице).
 * `deep: false` — не провоцировать загрузку: спускаемся только в узлы с уже загруженными детьми
 * (`hasChildren`, читаем у сырой обёртки — так значение не кэширует Reactor). Нужно, когда дети
 * приходят асинхронно и рекурсивный обход незагруженных узлов недопустим.
 */
export function filterTree(tree, predicate, { keepAncestors = true, deep = true } = {}) {
    if (typeof predicate !== 'function')
        return tree;
    const walk = nodes => {
        const out = [];
        for (const node of nodes) {
            const loaded = raw(node)?.hasChildren;
            const items = (deep || loaded) ? walk(node.items) : [];
            if ((keepAncestors && (predicate(node.data) || items.length)) || (!keepAncestors && predicate(node.data)))
                out.push(copyNode(node, items));
        }
        return out;
    };
    return walk(tree);
}

/**
 * Компаратор по описаниям сортировок `{name, dir, type, value?}` (семантика старой таблицы:
 * числа — вычитанием, прочее — `localeCompare` с `numeric`, пустые значения в конец).
 * Приоритет — порядок описаний в списке (`sortsFrom` отдаёт их по номеру сортировки).
 * Значение строки — `value(data)`, если задан (обёртка колонки: путь по `id` предков и `valueKey`;
 * родитель сортируется своим значением, Р3), иначе `data[name]`.
 * Тип колонки применяется через `coerceValue` — строки числовых колонок сравниваются как числа.
 */
export function sortCompare(sorts) {
    const list = (sorts ?? []).filter(s => s?.name);
    if (!list.length)
        return undefined;
    return (a, b) => {
        for (const { name, dir = 1, type, value } of list) {
            let x = typeof value === 'function' ? value(a) : a?.[name];
            let y = typeof value === 'function' ? value(b) : b?.[name];
            if (type !== undefined) {
                const cx = coerceValue(x, type), cy = coerceValue(y, type);
                if (cx.ok) x = cx.value;
                if (cy.ok) y = cy.value;
            }
            if (x === y)
                continue;
            if (x === undefined || x === null)
                return 1;
            if (y === undefined || y === null)
                return -1;
            const both = typeof x === 'number' && typeof y === 'number';
            return (both ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
        }
        return 0;
    };
}

/** Сортировка дерева: стабильно сортируются братья на каждом уровне, рекурсивно. */
export function sortTree(tree, compare) {
    if (typeof compare !== 'function')
        return tree;
    const walk = nodes => [...nodes]
        .sort((a, b) => compare(a.data, b.data))
        .map(node => copyNode(node, walk(node.items)));
    return walk(tree);
}

/**
 * Дерево → плоский список (pre-order). Потомки попадают в список только у раскрытых узлов;
 * `open` — раскрыть всё (при активном фильтре, не меняя `expanded`).
 * `compare` — сортировка братьев **на посещаемых уровнях**: свёрнутые ветви не обходятся, значит
 * их дети не сортируются (и не собираются) — сортировка видимого, а не всего дерева. Отсортированные
 * дети сортируются в момент раскрытия при очередной линеаризации.
 */
export function flattenTree(tree, { open = false, compare } = {}) {
    const out = [];
    const walk = nodes => {
        const list = compare ? [...nodes].sort((a, b) => compare(a.data, b.data)) : nodes;
        for (const node of list) {
            out.push(node);
            if (open || node.expanded)
                walk(node.items);
        }
    };
    walk(tree);
    return out;
}

/** значение порядка из описания колонки; новое место — сама колонка, старое — её элемент (как в oda-table) */
const orderOf = (column, key) => column?.[key] ?? column?.$element?.[key];

/**
 * Сортировки из описаний колонок: `{name, dir, type}` (+ `value` — у обёртки колонки с собственным
 * `valueOf`: значение читается по пути, а не `data[name]`).
 * Приоритет — **номер** `|sortOrder|` (1 — главная, как в мультисортировке шапки); при равных
 * номерах — порядок колонок в массиве (сортировка стабильна). Направление — знак `sortOrder`;
 * `0`/отсутствие — колонка не сортирует.
 */
export function sortsFrom(columns) {
    return (columns ?? [])
        .filter(c => (c?.name ?? c?.id) && Number(orderOf(c, 'sortOrder')))
        .map(c => {
            const order = Number(orderOf(c, 'sortOrder'));
            const spec = { name: c.name ?? c.id, dir: Math.sign(order), type: c.type };
            if (hasValueOf(c))
                spec.value = data => c.valueOf(data);
            return [Math.abs(order), spec];
        })
        .sort((a, b) => a[0] - b[0])
        .map(([, spec]) => spec);
}

/**
 * Группировки из описаний колонок: `{name, label, dir}`.
 * Колонка группирует, если `groupOrder > -1` (как в старой таблице).
 */
export function groupsFrom(columns) {
    return (columns ?? [])
        .filter(c => (c?.name ?? c?.id) && orderOf(c, 'groupOrder') > -1)
        .map((c, idx) => {
            const rawOrd = Number(orderOf(c, 'groupOrder'));
            const dir = c?.field?.groupDir ?? (rawOrd < 0 ? -1 : 1);
            return [rawOrd, idx, { name: c.name ?? c.id, key: c.key ?? c.name ?? c.id, label: c.$element?.label ?? c.label, dir }];
        })
        .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
        .map(([, , g]) => ({ name: g.name, label: g.label, dir: g.dir }));
}

/** сравнение значений групп (значения-пустышки в конец; направление `dir`) */
function compareGroupValues(a, b, dir = 1) {
    if (a === b)
        return 0;
    if (a === undefined || a === null)
        return 1;
    if (b === undefined || b === null)
        return -1;
    const both = typeof a === 'number' && typeof b === 'number';
    return (both ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })) * dir;
}

/**
 * Группировка плоского списка: группируются строки верхнего уровня, их раскрытые потомки остаются
 * при своей строке; свёрнутая группа `items` не отдаёт.
 * @param {Array} items — плоский список обёрток (`flattenTree`)
 * @param {{groups?: Array, expandedOf?: (key: string) => boolean}} [options]
 * @returns {Array} строки и группы формы `{name, value, level, isGroup, key, expanded, items}`
 */
export function groupItems(items, { groups = [], expandedOf } = {}) {
    const list = isArr(items) ? items : [];
    const specs = (groups ?? []).filter(g => g?.name);
    if (!list.length || !specs.length)
        return list;

    // плоский pre-order → блоки «строка верхнего уровня + её раскрытые потомки»
    const blocks = [];
    for (const item of list) {
        if (item.level === 0 || !blocks.length)
            blocks.push({ row: item, rest: [] });
        else
            blocks[blocks.length - 1].rest.push(item);
    }

    const emit = (groupBlocks, level, path) => {
        if (level >= specs.length)
            return groupBlocks.flatMap(b => [b.row, ...b.rest]);
        const spec = specs[level];
        const buckets = new Map();
        for (const block of groupBlocks) {
            const value = block.row.data?.[spec.name];
            const key = `${path}/${value}`;
            let bucket = buckets.get(key);
            if (!bucket)
                buckets.set(key, bucket = { value, key, blocks: [] });
            bucket.blocks.push(block);
        }
        const sorted = [...buckets.values()].sort((a, b) => compareGroupValues(a.value, b.value, spec.dir));
        const out = [];
        for (const bucket of sorted) {
            const node = {
                name: `${spec.label ?? spec.name}: ${bucket.value ?? ' '}`,
                value: bucket.value,
                level,
                isGroup: true,
                key: bucket.key,
                expanded: !!expandedOf?.(bucket.key),
                items: [],
            };
            Object.defineProperty(node, '_count', { value: bucket.blocks.length, enumerable: false });
            Object.defineProperty(node, '_label', { value: spec.label ?? spec.name, enumerable: false });
            Object.defineProperty(node, '_rows', { value: bucket.blocks.map(b => b.row?.data).filter(Boolean), enumerable: false });
            if (node.expanded)
                node.items = emit(bucket.blocks, level + 1, bucket.key);
            out.push(node);
        }
        return out;
    };

    return emit(blocks, 0, '');
}

/**
 * Окно: видимые строки + запас вниз (половина окна, минимум 5 — как в старой таблице),
 * границы обрезаются. Пустой список или выход за пределы — `[]`.
 */
export function sliceWindow(list, { top = 0, count, overscan } = {}) {
    const rows = isArr(list) ? list : [];
    if (!rows.length)
        return [];
    const start = Math.min(Math.max(Math.trunc(top) || 0, 0), rows.length);
    const visible = count === undefined ? rows.length - start : Math.max(Math.trunc(count) || 0, 0);
    const over = overscan === undefined ? Math.max(5, Math.ceil(visible / 2)) : Math.max(Math.trunc(overscan) || 0, 0);
    return rows.slice(start, start + visible + over);
}

/**
 * Чётность строки для зебры: считается от **позиции в окне** (`screenTopRowIndex + index`),
 * как в старой таблице, а не от индекса в исходном списке — иначе полосы «поедут» при
 * сортировке, фильтре и раскрытии дерева.
 */
export function oddAt(top, index) {
    return Math.abs((Math.trunc(top) || 0) + (Math.trunc(index) || 0)) % 2;
}
