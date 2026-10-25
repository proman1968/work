/**
 * Модель колонок oda-table. Чистые функции: дерево полей WORK → обёртки `ViewColumn` (как строки)
 * → `columnLayout` (плоские листья + строки шапки со спанами + проекция треков). Шапка и ячейки
 * берут один layout.
 * Инварианты: метаданные полей не мутируются (обёртка читает их); обёртка после создания **не
 * пишется никогда** — производные поля читают состояние через `stateOf`; пусто/мусор → `[]`.
 */
const isArr = v => Array.isArray(v);

/** обычный объект (не null, не массив) */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** положительное число из значения (число или числовая строка); иначе undefined.
    Экспортируется: ширины нормализуются им же и при записи состояния (`table.js`) */
export const num = value => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** целое из значения (число или числовая строка); пусто/мусор → undefined.
    Экспортируется: `groupOrder` нормализуется им же и при записи состояния (`table.js`) */
export const int = value => {
    if (value === undefined || value === null || value === '')
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

/** «нет группировки» у `groupOrder` (как `groupsFrom`: группирует только `> -1`); не undefined — §32 */
const NO_GROUP = -1;

/** уникальный ключ дескриптора: имя, при дубле — имя@N, при пустом имени — @N */
function uniqueKey(seen, name) {
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (!name)
        return `@${n}`;
    return n === 0 ? name : `${name}@${n}`;
}

/** id поля строкой (пусто/мусор → пустая строка): из него строится ключ обёртки */
const idOf = field => (field?.id === undefined || field?.id === null) ? '' : String(field.id);

/**
 * Метаданные полей WORK → лес обёрток `ViewColumn`. Дети собираются **лениво**: обёртки потомков
 * строятся при первом обращении к `children`, поэтому свёрнутые ветви не обходятся. Два признака:
 * `allowExpand` («дети могут быть», по наличию `field[childrenKey]` — им решается маркер раскрытия)
 * и `hasChildren` («дети фактически собраны», кэш есть).
 *
 * **Обёртка не пишется никогда.** Состояние колонки (`expanded`, `hidden`, `order`, `sortOrder`,
 * `groupOrder`, `width`, `minWidth`) — геттеры без сеттера по правилу «состояние ?? поле» (нет значения у
 * `width`/`minWidth`/`sortOrder` — `0`, у `groupOrder` — `-1`: так геттер кэшируется Reactor и сброс
 * доходит до читателей, §32): сначала `stateOf(key)` (сохранённое таблицей через `$save`), при его
 * отсутствии — значение поля.
 * Состояние живёт вне обёртки и вне метаданных, поэтому:
 * - обёртку можно заменить, ничего не потеряв: кэш по **ключу-пути** (`fio/last`) отдаёт старую
 *   обёртку, пока поле то же; новый объект поля (или новый родитель) → **новая** обёртка заменяет
 *   старую в `cache`, старая остаётся как была (её держат уже отрисованные ячейки);
 * - геттер, читающий состояние таблицы через `stateOf`, даёт Reactor зависимость от этого
 *   состояния: замена объекта состояния сбрасывает ровно те геттеры, что его читали.
 * Без `stateOf` геттеры отдают значения полей — поведение этапа 8-a.
 * @param {Array} metadata — корневые поля WORK (не мутируются)
 * @param {{childrenKey?: string, valueKey?: string, cache?: Map,
 *   stateOf?: (key: string) => ({expanded?, hidden?, order?, sortOrder?, groupOrder?, width?, minWidth?}|undefined)}} [options]
 * @returns {Array} обёртки верхнего уровня (`children: []`, если детей нет)
 */
export function wrapColumns(metadata, { childrenKey = 'fields', valueKey = '@', cache, stateOf } = {}) {
    const childrenOf = field => (field && typeof field === 'object' && isArr(field[childrenKey])) ? field[childrenKey] : [];
    /** запись состояния колонки; мусор и отсутствие `stateOf` → undefined (тогда берётся поле) */
    const stateFor = typeof stateOf === 'function'
        ? key => {
            const state = stateOf(key);
            return isObj(state) ? state : undefined;
        }
        : () => undefined;

    /** обёртки одного уровня в исходном порядке; `seen` — локальный для уровня, поэтому ключи-пути
        стабильны при пересборке (иначе счётчики дублей «перегорали» бы между вызовами) */
    function buildLevel(fields, level, parent, parentKey) {
        const seen = new Map();
        const out = [];
        for (const field of fields) {
            if (field === null || field === undefined || typeof field !== 'object')
                continue;
            const sibling = uniqueKey(seen, idOf(field));
            const key = parentKey ? `${parentKey}/${sibling}` : sibling;
            out.push(wrapNode(field, level, parent, parentKey, key));
        }
        return out;
    }

    /** обёртка из кэша, если поле и родитель те же; иначе — новая, заменяющая старую в кэше
        (старая не изменяется). Уровень однозначно задан ключом-путём, поэтому не сверяется. */
    function wrapNode(field, level, parent, parentKey, key) {
        const cached = cache?.get(key);
        if (cached && cached.field === field && cached.parent === parent)
            return cached;
        const node = createNode(field, level, parent, parentKey, key);
        cache?.set(key, node);
        return node;
    }

    /** новая обёртка; всё, что не зависит от состояния, задаётся здесь один раз */
    function createNode(field, level, parent, parentKey, key) {
        const source = {
            // ссылка на поле — только чтение: ни обёртка, ни рендер в него не пишут
            field,
            key,
            label: field.label ?? field.id,
            type: field.type,
            control: field.control,
            // редактор колонки целиком (строка-роутер p-g: ставится на колонку значений,
            // строки называют только ТИП — см. cell.js editorTag, router.js)
            editor: field.editor,
            readonly: !!field.readonly,
            level,
            parent,
            parentKey,
            // контракт слоёв (фильтр/сортировка/группировка читают `name`, «главная» — `treeMode`)
            name: idOf(field),
            treeMode: !!field.treeMode,
            allowExpand: childrenOf(field).length > 0,
        };
        // состояние: геттеры «состояние ?? поле» без сеттера. Значение из состояния нормализуется
        // так же, как из поля (оно приходит из LocalStorage и может быть строкой); `null` — отсутствие (§24).
        // «Нет значения» у `width`/`minWidth`/`sortOrder` — **0, а не undefined**: Reactor не кэширует
        // undefined, и сброс зависимостей на таком геттере обрывается (`reset_deps` пропускает пустой
        // кэш) — первая правка ширины/сортировки не доходила бы до треков и `sortsSpec`. 0 и так
        // означает «нет» для `num()` и `sortsFrom`.
        const derived = {
            expanded: () => {
                const v = stateFor(key)?.expanded;
                return v === undefined || v === null ? !!field.expanded : !!v;
            },
            hidden: () => {
                const v = stateFor(key)?.hidden;
                return v === undefined || v === null ? !!field.hidden : !!v;
            },
            order: () => {
                const v = stateFor(key)?.order;
                return v === undefined || v === null ? (Number(field.order) || 0) : (Number(v) || 0);
            },
            sortOrder: () => stateFor(key)?.sortOrder ?? field.sortOrder ?? 0,
            // группировка (8-c, только чтение — UI нет): `0` — группирует (первая), `-1` — явное
            // «не группирует» из состояния (перекрывает поле); отсутствие/мусор — `-1`
            groupOrder: () => int(stateFor(key)?.groupOrder) ?? int(field.groupOrder) ?? NO_GROUP,
            width: () => num(stateFor(key)?.width) ?? num(field.width) ?? 0,
            minWidth: () => num(stateFor(key)?.minWidth) ?? num(field.minWidth) ?? 0,
        };
        for (const [name, get] of Object.entries(derived))
            Object.defineProperty(source, name, { configurable: true, enumerable: true, get });

        // своя обёртка (после активации — её прокси): родитель потомков и опора `children`
        let node;
        // `children` — ленивый кэш замыкания: undefined — ещё не собирали; пересобираем, если массив
        // детей сменился. Опора — поле **этой** обёртки (`field` замыкания), а не кэш: заменённая
        // обёртка продолжает отдавать своих детей. Потомкам передаём `key` — ключ-путь стабилен,
        // поэтому вложенные обёртки переиспользуются из кэша при пересборке.
        let built;
        let builtFrom;
        Object.defineProperty(source, 'children', {
            configurable: true,
            get() {
                const kids = childrenOf(field);
                if (built === undefined || builtFrom !== kids) {
                    builtFrom = kids;
                    built = buildLevel(kids, level + 1, node, key);
                }
                return built;
            }
        });
        // `hasChildren` — «дети фактически собраны»: по нему фильтр идёт, не провоцируя загрузку
        Object.defineProperty(source, 'hasChildren', {
            configurable: true,
            enumerable: true,
            get() {
                return built !== undefined;
            }
        });
        /**
         * Контейнер своего значения в строке: путь по `id` предков (без своего). Общий для чтения
         * (`valueOf`) и записи (`setValueOf`) — путь один, поэтому они симметричны.
         * Путь не найден (на каком-то шаге не объект) → `undefined`.
         */
        const holderOf = data => {
            const ids = [];
            for (let p = source.parent; p; p = p.parent)
                ids.unshift(p.field?.id);
            let container = data;
            for (const id of ids) {
                if (container === null || typeof container !== 'object')
                    return undefined;
                container = container[id];
            }
            return (container === null || typeof container !== 'object') ? undefined : container;
        };
        /**
         * Значение узла в строке: путь по `id` предков (без своего), затем `container[field.id]`.
         * Скаляр и массив → сами; объект-узел → `valueKey` (для `fio: { '@', last, first }` → `'@'`).
         * Отсутствие → `undefined` (не `null`).
         */
        source.valueOf = data => {
            const own = holderOf(data)?.[source.field?.id];
            if (own === null || own === undefined)
                return undefined;
            return isObj(own) ? own[valueKey] : own;
        };
        /**
         * Запись значения узла в строку — обратная к `valueOf`: тот же путь по `id` предков, затем
         * `container[field.id] = value`; если там объект-узел — пишется его `valueKey` (дети узла и
         * сам узел остаются целы). Массив — значение, а не узел: заменяется целиком. Пишется только
         * целевое поле; промежуточные узлы пути не создаются.
         * @returns {boolean} `true` — записано; `false` — пути нет (писать некуда), данные не тронуты
         */
        source.setValueOf = (data, value) => {
            const container = holderOf(data);
            const id = source.field?.id;
            if (container === undefined || id === undefined || id === null)
                return false;
            const own = container[id];
            if (isObj(own))
                own[valueKey] = value;
            else
                container[id] = value;
            return true;
        };
        // явная активация: геттеры состояния становятся вычисляемыми свойствами Reactor — их кэш
        // сбрасывается, когда меняется прочитанное через `stateOf` состояние таблицы
        node = globalThis.Reactor?.activate ? globalThis.Reactor.activate(source) : source;
        return node;
    }

    return buildLevel(isArr(metadata) ? metadata : [], 0, undefined, undefined);
}

/**
 * Чистое обновление состояния колонок (Р1): `states` — `{ [key]: { expanded?, hidden?, order?,
 * sortOrder?, groupOrder?, width?, minWidth? } }`, как его хранит таблица в свойстве с `$save`.
 * Обновление — только **заменой**: `$save` пишет в LocalStorage лишь при присваивании свойства,
 * а после загрузки клонируется только верхний уровень — поэтому новой создаётся и вложенная запись.
 * Правила:
 * - результат — **новый** объект и **новая** запись `key`; входные объекты не изменяются
 *   (остальные записи переносятся по ссылке — их никто не правит);
 * - `undefined`/`null` в `patch` **удаляют** поле записи (ключ не пишется: `undefined` из хранилища
 *   возвращается как `null`, §24); опустевшая запись удаляет сам ключ;
 * - мусор в `states` (`null`, массив, не-объект) → считается `{}`;
 * - `patch` не-объект, пустой/служебный `key` → изменений нет: возвращается `states` **той же
 *   ссылкой** (мусор — `{}`), чтобы присваивание не породило лишнюю запись в хранилище.
 * @param {object} states — текущее состояние (не мутируется)
 * @param {string} key — ключ-путь колонки (`fio/last`)
 * @param {object} patch — поля записи; `undefined`/`null` — удалить поле
 * @returns {object}
 */
export function nextColumnState(states, key, patch) {
    const base = isObj(states) ? states : {};
    const name = (typeof key === 'string' || typeof key === 'number') ? String(key) : '';
    // `__proto__` как обычный ключ присваиванием не записать — он сменил бы прототип результата
    if (!isObj(patch) || !name || name === '__proto__')
        return base;
    const entry = { ...(isObj(base[name]) ? base[name] : {}) };
    for (const field of Object.keys(patch)) {
        const value = patch[field];
        if (value === undefined || value === null)
            delete entry[field];
        else
            entry[field] = value;
    }
    const next = { ...base };
    if (Object.keys(entry).length)
        next[name] = entry;
    else
        delete next[name];
    return next;
}

/** имя ключа из значения: строка/число → строка, прочее → пустая строка */
const keyName = key => (typeof key === 'string' || typeof key === 'number') ? String(key) : '';

/**
 * Чистое обновление фильтров колонок (Р4): `filters` — `{ [key]: текст }`, как его хранит таблица
 * в `columnFilter` с `$save`. Правила записи те же, что у `nextColumnState`, — только **замена**:
 * - текст нормализуется (`trim`); пустой/пробельный/`null`/`undefined` — **удаляет** ключ
 *   (отсутствие, не пустая строка и не `undefined` в записи — §24);
 * - результат — **новый** объект, входной не изменяется;
 * - если ничего не меняется (тот же текст, удаление отсутствующего, пустой/служебный `key`) —
 *   возвращается `filters` **той же ссылкой** (мусор — `{}`): вызывающий сравнивает ссылки и не
 *   порождает лишнюю замену свойства (а с ней — пересчёт строк и запись в хранилище).
 * @param {object} filters — текущие фильтры (не мутируются)
 * @param {string} key — ключ-путь колонки (`fio/last`)
 * @param {*} text — текст фильтра; пусто — снять фильтр колонки
 * @returns {object}
 */
export function nextColumnFilter(filters, key, text) {
    const base = isObj(filters) ? filters : {};
    const name = keyName(key);
    if (!name || name === '__proto__')
        return base;
    const value = text === undefined || text === null ? '' : String(text).trim();
    const has = Object.prototype.hasOwnProperty.call(base, name);
    if (value ? base[name] === value : !has)
        return base;
    const next = { ...base };
    if (value)
        next[name] = value;
    else
        delete next[name];
    return next;
}

/**
 * Все обёртки леса плоским списком (pre-order), включая детей свёрнутых колонок: сортировка и фильтр
 * ищут колонку по ключу-пути независимо от раскрытия (состояние вложенной колонки живёт и тогда,
 * когда родитель свёрнут). Обращение к `children` собирает обёртки детей — так же, как глобальный
 * поиск (`searchPredicate`); раскладка (`columnLayout`) по-прежнему ленива.
 * @param {Array} roots — обёртки верхнего уровня (`wrapColumns`)
 * @returns {Array}
 */
export function flatColumns(roots) {
    const out = [];
    const walk = nodes => {
        for (const node of isArr(nodes) ? nodes : []) {
            if (!node || typeof node !== 'object')
                continue;
            out.push(node);
            walk(node.children);
        }
    };
    walk(roots);
    return out;
}

/** знаковый номер сортировки: целое, мусор/отсутствие — 0 («без сортировки», §32) */
const signedOrder = value => int(value) ?? 0;

/**
 * Цикл сортировки от клика по колонке (Р1, как у старой таблицы `table/lib/header.js` `setSort`).
 * Номер сортировки — знаковый: `|sortOrder|` — место в мультисортировке (1 — главная), знак —
 * направление (`+` по возрастанию, `−` по убыванию), `0` — колонка не сортирует.
 * Правила:
 * - клик циклит `+N → −N → 0` (место при смене направления сохраняется);
 * - `add = true` (Ctrl/Cmd-клик) — мультисортировка: новая колонка получает `max|sortOrder| + 1`
 *   (в конец набора); снятие (`−N → 0`) **перенумеровывает** оставшиеся `1..n` без дыр с сохранением
 *   их порядка и направлений;
 * - `add = false` (простой клик) — одиночная: все остальные сбрасываются в `0`, а колонка остаётся
 *   единственной, поэтому её номер — `±1` (`0 → +1 → −1 → 0`).
 * Функция чистая: вход не изменяется; результат — **минимальный** набор изменений `[{key, sortOrder}]`
 * (только записи, чей номер реально меняется), чтобы таблица заменяла состояние ровно по ним.
 * `sortOrder: 0` в результате — **явное** «без сортировки»: записанное в состояние, оно перекрывает
 * `sortOrder` из метаданных. Ключ не из `entries` (колонки нет) → `[]`.
 * @param {Array<{key: string, sortOrder?: number}>} entries — текущие номера всех колонок
 *   (действующие: состояние ?? поле); дубли ключей — берётся первый
 * @param {string} key — ключ-путь колонки, по которой кликнули
 * @param {{add?: boolean}} [options]
 * @returns {Array<{key: string, sortOrder: number}>}
 */
export function nextSortOrders(entries, key, { add = false } = {}) {
    const name = keyName(key);
    const list = [];
    const seen = new Set();
    for (const entry of isArr(entries) ? entries : []) {
        const entryKey = isObj(entry) ? keyName(entry.key) : '';
        if (!entryKey || seen.has(entryKey))
            continue;
        seen.add(entryKey);
        list.push({ key: entryKey, sortOrder: signedOrder(entry.sortOrder) });
    }
    if (!name || !seen.has(name))
        return [];

    const own = list.find(entry => entry.key === name).sortOrder;
    const target = new Map(list.map(entry => [entry.key, entry.sortOrder]));
    if (!add) {
        for (const entry of list)
            target.set(entry.key, 0);
        target.set(name, own > 0 ? -1 : own < 0 ? 0 : 1);
    } else if (own > 0) {
        target.set(name, -own);
    } else if (own === 0) {
        const max = list.reduce((m, entry) => Math.max(m, Math.abs(entry.sortOrder)), 0);
        target.set(name, max + 1);
    } else {
        // снятие: остальные активные — по месту (сортировка стабильна), номера 1..n без дыр
        target.set(name, 0);
        list.filter(entry => entry.key !== name && entry.sortOrder)
            .sort((a, b) => Math.abs(a.sortOrder) - Math.abs(b.sortOrder))
            .forEach((entry, index) => target.set(entry.key, Math.sign(entry.sortOrder) * (index + 1)));
    }
    return list
        .filter(entry => target.get(entry.key) !== entry.sortOrder)
        .map(entry => ({ key: entry.key, sortOrder: target.get(entry.key) }));
}

/** CSS-токен минимума по умолчанию (Р6): значение задаёт CSS компонента, модель чисел не знает */
const MIN_COL = 'var(--table-min-col)';
/** хвостовой трек `@filler` (Р7): забирает остаток, если все листья фиксированы */
const FILLER = 'minmax(0, 1fr)';

/**
 * Трек листа (Р5, Р6): числовой `width` → фиксированный `${width}px` (он же минимум);
 * иначе `minmax(<min>, 1fr)`, где `<min>` — числовой `minWidth` в px или токен `--table-min-col`.
 * @param {object} leaf — обёртка-лист (читаются `width`, `minWidth`)
 * @returns {string}
 */
export function trackOf(leaf) {
    const width = num(leaf?.width);
    if (width !== undefined)
        return `${width}px`;
    const min = num(leaf?.minWidth);
    return `minmax(${min !== undefined ? `${min}px` : MIN_COL}, 1fr)`;
}

/** листья-объекты из входа (мусор отбрасывается) */
const leafList = leaves => (isArr(leaves) ? leaves : []).filter(leaf => leaf && typeof leaf === 'object');

/**
 * Единая проекция треков для шапки и строк: ровно по треку на лист и **один** хвостовой
 * `minmax(0, 1fr)` (`@filler`, Р7), если все листья фиксированы. Хвост — трек, а не колонка:
 * в листья, поиск, сортировку и состояние он не входит. Пустой список → только хвост
 * (`minmax(0, 1fr)`): «все листья фиксированы» выполняется пусто, сетка остаётся валидной.
 * Ширина родителя не считается: родитель занимает `colSpan` треков своих листьев.
 * @param {Array} leaves — плоские видимые листья (`columnLayout().leaves`)
 * @returns {string} значение `grid-template-columns`
 */
export function gridTemplate(leaves) {
    const list = leafList(leaves);
    const tracks = list.map(trackOf);
    if (hasFiller(list))
        tracks.push(FILLER);
    return tracks.join(' ');
}

/**
 * Есть ли хвостовой трек `@filler`: все видимые листья фиксированы. Правило одно — здесь,
 * `gridTemplate` и `columnLayout` не считают его каждый по-своему (шапка и строка по нему решают,
 * где кончается сетка и рисуется ли линия последнего листа). Пустой список считается «все
 * фиксированы» — как в `gridTemplate`: без колонок сетка должна остаться валидной.
 * @param {Array} leaves
 * @returns {boolean}
 */
export function hasFiller(leaves) {
    return leafList(leaves).every(leaf => num(leaf.width) !== undefined);
}

/**
 * Минимальная ширина сетки (Р6) — контракт, не пиксели: `px` — сумма фиксированных ширин и
 * числовых минимумов, `flex` — число листьев с минимумом по умолчанию (токен известен только в CSS,
 * поэтому в одно число не складывается). Хвост `@filler` минимума не имеет.
 * @param {Array} leaves
 * @returns {{px: number, flex: number}}
 */
export function minTotal(leaves) {
    let px = 0;
    let flex = 0;
    for (const leaf of leafList(leaves)) {
        const fixed = num(leaf.width) ?? num(leaf.minWidth);
        if (fixed !== undefined)
            px += fixed;
        else
            flex++;
    }
    return { px, flex };
}

/**
 * Проекция `minTotal` в CSS: без гибких листей — `${px}px`, иначе
 * `calc(${px}px + ${flex} * var(--table-min-col))`.
 * @param {{px: number, flex: number}} total
 * @returns {string}
 */
export function minTotalCss({ px = 0, flex = 0 } = {}) {
    return flex === 0 ? `${px}px` : `calc(${px}px + ${flex} * ${MIN_COL})`;
}

/**
 * Видимые/упорядоченные братья: скрытые убираются, порядок по `order` (стабильно). Главная колонка
 * (`mustKeep`) не скрывается — только на верхнем уровне (вложенное поле с тем же `id` скрыть можно).
 */
function visibleSiblings(nodes, mustKeep, isRoot) {
    const list = isArr(nodes) ? nodes : [];
    const kept = [];
    for (const node of list) {
        const main = isRoot && mustKeep !== undefined && (node?.key === mustKeep || node?.field?.id === mustKeep);
        if (!main && node?.hidden)
            continue;
        kept.push(node);
    }
    return kept
        .map((node, index) => [node, index])
        .sort((a, b) => ((a[0].order ?? 0) - (b[0].order ?? 0)) || (a[1] - b[1]))
        .map(([node]) => node);
}

/**
 * Дерево обёрток → раскладка шапки и ячеек. Единственный источник: `leaves` (плоский pre-order
 * видимых листьев — из них строки строят ячейки) и `headers` (строки уровней сверху вниз; ячейка
 * `{key, level, start, colSpan, rowSpan}`, накрытые не включаются — подход TanStack). Свёрнутая
 * колонка — один лист; раскрытая отдаёт детей рекурсивно (лениво: `children` читается только при
 * `expanded`).
 * Проекция размеров — тут же, из тех же `leaves`, чтобы шапка и строки взяли одну строку:
 * `tracks` (`gridTemplate`, значение `--table-tracks`) и `minTotal` (`minTotalCss(minTotal())`,
 * значение `--table-min-total`). Оба — **геттеры** результата: раскладка (листья, спаны) зависит
 * от раскрытия/скрытия/порядка, а треки — ещё и от ширин. Под Reactor результат активируется, геттеры
 * кэшируются и сбрасываются по своим зависимостям — правка ширины пересчитывает `tracks`, но не
 * раскладку. Ширина родителя не считается: он занимает столько треков, сколько листьев под ним.
 * @param {Array} roots — обёртки верхнего уровня (`wrapColumns`)
 * @param {{mustKeep?: string}} [options]
 * @returns {{headers: Array, leaves: Array, maxDepth: number, tracks: string, minTotal: string}}
 */
export function columnLayout(roots, { mustKeep } = {}) {
    const rows = []; // {node, level, start, count} — все видимые узлы, у кого-либо из них есть дети
    const leaves = [];
    let leafIndex = 0;
    let maxDepth = 0;

    function collect(nodes, level) {
        for (const node of visibleSiblings(nodes, mustKeep, level === 0)) {
            // ленивость: к детям свёрнутого узла не обращаемся вовсе; видимость детей — уже здесь,
            // чтобы узел, у которого все дети скрыты, стал листом, а не пустой ветвью
            const kids = node.expanded ? visibleSiblings(node.children, mustKeep, false) : [];
            if (kids.length) {
                const start = leafIndex;
                collect(kids, level + 1);
                rows.push({ node, level, start, count: leafIndex - start, leaf: false });
            } else {
                const start = leafIndex++;
                rows.push({ node, level, start, count: 1, leaf: true });
                leaves.push(node);
                if (level + 1 > maxDepth)
                    maxDepth = level + 1;
            }
        }
    }
    collect(roots, 0);

    const headers = [];
    for (let level = 0; level < maxDepth; level++) {
        headers.push(rows
            .filter(row => row.level === level)
            .sort((a, b) => a.start - b.start)
            .map(row => ({
                node: row.node,
                key: row.node.key,
                level,
                start: row.start,
                colSpan: row.count,
                // родитель занимает свою строку; лист спанит вниз до низа шапки
                rowSpan: row.leaf ? maxDepth - level : 1,
            })));
    }
    const result = { headers, leaves, maxDepth };
    Object.defineProperty(result, 'tracks', {
        configurable: true,
        enumerable: true,
        get: () => gridTemplate(leaves),
    });
    Object.defineProperty(result, 'minTotal', {
        configurable: true,
        enumerable: true,
        get: () => minTotalCss(minTotal(leaves)),
    });
    // признак хвоста — из модели же: шапка и строка по нему решают, где кончается сетка
    Object.defineProperty(result, 'filler', {
        configurable: true,
        enumerable: true,
        get: () => hasFiller(leaves),
    });
    return result;
}
