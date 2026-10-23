/**
 * oda-table — таблица (переписана рядом как datagrid, фаза 01; с 2026-10-13 — основная).
 * Этап 8-a: колонки — обёртки над деревом полей WORK. Каскад: `metadata` → `wrappers` → `treeColumn`
 * → `layout` (`leaves` + строки шапки со спанами) → шапка и строки. Метаданные не мутируются.
 * Этап 8-b: состояние колонок (раскрытие, скрытие, порядок, сортировка, размеры) — в двух сохраняемых
 * свойствах таблицы (`columnView`, `columnSizing`), обёртки его только читают; сетка шапки и строк —
 * одна проекция `layout.tracks` в CSS-переменной `--table-tracks` на прокручиваемом контейнере.
 * Этап 8-c: цикл сортировки и мультисортировка (`sortBy`), фильтры колонок — третье сохраняемое
 * свойство `columnFilter` (читают только строки), `groupOrder` — из состояния.
 * Данные: `dataSet` → `treeRows` → `items` → `groupedItems` → `filteredItems`/`sortedItems` → `rows`.
 * Контракт точек входа — readme.md §7.
 */
import {
    wrapTree, searchPredicate, columnFilterPredicate, allPredicates, filterTree, sortCompare, flattenTree,
    groupItems, sliceWindow, sortsFrom, groupsFrom, raw,
} from '/oda/components/table/lib/model.js';
import {
    wrapColumns, columnLayout, flatColumns, nextColumnState, nextColumnFilter, nextSortOrders, num, int,
} from '/oda/components/table/lib/column.js';
import { normalizeFields } from '/oda/components/structure/fields.js';

/** поля состояния колонки по свойствам таблицы: размеры отдельно от вида (гранулярность пересчёта) */
const SIZING_FIELDS = ['width', 'minWidth'];
const VIEW_FIELDS = ['expanded', 'hidden', 'order', 'sortOrder', 'groupOrder'];

/** нормализация значения состояния перед записью; `undefined` — удалить поле записи.
    Ширины нормализуются тем же `num`, что читаются из полей, — правило одно */
const NORMALIZE = {
    width: num,
    minWidth: num,
    expanded: v => v === undefined || v === null ? undefined : !!v,
    hidden: v => v === undefined || v === null ? undefined : !!v,
    order: v => v === undefined || v === null ? undefined : (Number(v) || 0),
    // 0 — «без сортировки» явно: перекрывает sortOrder из метаданных, поэтому не удаляется
    sortOrder: v => v === undefined || v === null ? undefined : (Number(v) || 0),
    // целое; -1 — явное «не группирует» (перекрывает поле), поэтому не удаляется; мусор — удалить
    groupOrder: int,
};

/** есть ли хоть один непустой фильтр колонки (мусор из хранилища — нет) */
function hasFilterText(filters) {
    if (!filters || typeof filters !== 'object')
        return false;
    return Object.values(filters).some(text => text !== undefined && text !== null && String(text).trim() !== '');
}

/**
 * Часть patch по своему набору полей (нормализованная) или undefined, если ни одно поле не задано
 * либо ничего не меняется относительно текущей записи (`null` и отсутствие — одно и то же, §24).
 */
function patchPart(patch, fields, current) {
    let part;
    let changed = false;
    for (const field of fields) {
        if (!(field in patch))
            continue;
        const value = NORMALIZE[field](patch[field]);
        (part ??= {})[field] = value;
        if ((current?.[field] ?? undefined) !== value)
            changed = true;
    }
    return changed ? part : undefined;
}

ODA({
    is: 'oda-table',
    imports: '/oda/components/table/column-header.js, /oda/components/table/row.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                @apply --light;
                /* Скругление как у кнопок — системным радиусом. */
                border-radius: var(--radius-s);
                overflow: hidden;
                /* Минимум гибкой колонки по умолчанию (Р6): ≈ иконка. Модель чисел не знает —
                   берёт этот токен в треки и в минимум сетки. */
                --table-min-col: var(--space-xl);
            }
            /* Прокручивается этот контейнер (и вниз, и вбок): шапка и строки — его дети с одной
               сеткой и одним минимумом ширины, поэтому при переполнении едут вместе. */
            .scroller {
                overflow: auto;
            }
        </style>
        <!-- Сетка колонок — CSS-переменные на элементе шаблона (на кастомный хост ~style не ставится, §31);
             шапка и строки читают их статическим CSS -->
        <div class="scroller" vertical flex ~style="gridVars">
            <oda-table-header :layout="layout" :col-lines :row-lines></oda-table-header>
            <oda-table-row ~for="rows" :row="$for.item" :index="$for.index"></oda-table-row>
        </div>
    `,
    $public: {
        /** строки; таблица их не меняет */
        dataSet: {
            $type: Array
        },
        /** метаданные полей WORK (`METADATA.FIELDS`, дерево `fields`) — нормализуются в `structure/fields.js`; только чтение */
        metadata: {
            $type: Array
        },
        /** ключ значения узла (контракт DataAccessNode): объект-узел отдаёт значение под ним */
        valueKey: {
            $def: '@'
        },
        /**
         * Редактор ячеек по умолчанию (тег): ячейка подбирает редактор по четырём
         * источникам — ячейка → строка → колонка → таблица (`cell.js: editorTag`).
         * Не задан — ячейки текстовые (полное правило `type` → контрол — этап 10).
         */
        defaultEditor: undefined,
        /** глобальный поиск по колонкам — вход как у oda-table */
        filter: {
            $type: String
        },
        /**
         * При активном фильтре раскрывать всё дерево на полную глубину и фильтровать целиком.
         * Раскрытие — виртуальное (`open` в линеаризации), `expanded` в обёртках не меняется;
         * при снятии фильтра состояние возвращается само. Выключить (для асинхронных детей).
         */
        filterForceExpanding: {
            $def: true,
            $type: Boolean,
            $attr: true
        },
        /** ключ хранилища состояния колонок (`_savePath/oda-table[$saveKey]`): задаёт потребитель до первого чтения */
        $saveKey: undefined,
        /** разрешить фокус строки: клик делает строку текущей (как у oda-table, по умолчанию выключено) */
        allowFocus: {
            $def: false,
            $type: Boolean,
            $attr: true
        },
        /** зебра: соседние строки чередуются по фону */
        evenOdd: {
            $def: false,
            $type: Boolean,
            $attr: true
        },
        /** линии между колонками (имя и смысл как у oda-table) */
        colLines: {
            $def: false,
            $type: Boolean,
            $attr: true
        },
        /** линии между строками */
        rowLines: {
            $def: false,
            $type: Boolean,
            $attr: true
        },
        /** вся таблица только для чтения: все ячейки получают readonly (контроллы прячут кнопки правки) */
        readonly: {
            $def: false,
            $type: Boolean,
            $attr: true
        },
        /** индекс верхней строки окна; скролл подключит этап 14 */
        screenTopRowIndex: {
            $def: 0
        },
        /** текущая строка (сырой объект данных); пишется строкой при клике */
        focusedRow: {
            $def: null
        },
        /**
         * Размеры колонок: ключ-путь колонки (`fio/last`) → `{width?, minWidth?}`. Перекрывают метаданные.
         * Сохраняется (`$save`) по пути `_savePath/oda-table[$saveKey]`: `$saveKey` задаёт потребитель
         * по месту использования; **без него все таблицы страницы делят одно хранилище**.
         * Пишется только заменой объекта (`setColumnState`): `$save` сохраняет лишь при присваивании.
         * Отдельно от `columnView`, чтобы правка ширины пересчитывала треки, а не раскладку.
         */
        columnSizing: {
            $def: {},
            $save: true
        },
        /**
         * Вид колонок: ключ-путь → `{expanded?, hidden?, order?, sortOrder?}`. Перекрывает метаданные;
         * хранение и правила записи — как у `columnSizing`.
         */
        columnView: {
            $def: {},
            $save: true
        },
        /**
         * Фильтры колонок: ключ-путь → текст (`{'fio/last': 'ив'}`); применяются вместе с глобальным
         * `filter` через И (строка проходит, если совпала со всеми). Пустой текст — отсутствие (ключа
         * нет). Хранение и правила записи — как у `columnSizing` (только заменой, `setColumnState`).
         * Отдельно от `columnView`: Reactor сбрасывает зависимости по факту замены свойства, а это
         * свойство читают только строки (`items`) — ввод фильтра по буквам не трогает раскладку и треки.
         */
        columnFilter: {
            $def: {},
            $save: true
        }
    },
    /** обёртки строк по объектам данных: состояние живёт на обёртке и должно переживать пересчёт */
    rowWrappers: null,
    /** обёртки колонок по ключу поля: переживают пересборку метаданных (объекты полей меняются, ключ — нет) */
    columnWrappers: null,
    /** раскрытие групп: ключ группы → bool */
    groupStates: null,
    attached() {
        this.groupStates ??= new Map();
    },
    /**
     * Развернуть/свернуть ветку. Состояние живёт на самой обёртке (`row.expanded`), поэтому запись
     * идёт через прокси: линеаризация читает это поле, значит зависит от него, и Reactor сам
     * сбрасывает кэш слоёв. Никаких side-карт и ручных инвалидаций.
     */
    setExpanded(row, value) {
        if (row && 'expanded' in row)
            row.expanded = !!value;
    },
    toggleExpanded(row) {
        if (row && 'expanded' in row)
            row.expanded = !row.expanded;
    },
    expandedOf(row) {
        return !!row?.expanded;
    },
    /** отметка строки: `'checked'` | `'unchecked'` (событие и каскад по дереву — этап 12) */
    setChecked(row, state) {
        if (row && 'checked' in row)
            row.checked = state;
    },
    checkedOf(row) {
        return row?.checked ?? 'unchecked';
    },
    /** текущая ли строка: сравнение по сырым данным (обёртки пересоздаются) */
    isFocused(row) {
        return !!this.allowFocus && !row?.isGroup && this.focusedRow === raw(row?.data);
    },
    setFocused(row) {
        const data = raw(row?.data);
        if (!data || this.focusedRow === data)
            return;
        this.focusedRow = data;
    },

    // --- состояние колонок: только через API, только заменой ---
    /**
     * Изменить состояние колонки. `patch` раскладывается по свойствам: `width`/`minWidth` →
     * `columnSizing`, `expanded`/`hidden`/`order`/`sortOrder`/`groupOrder` → `columnView`,
     * `filter` (текст фильтра колонки) → `columnFilter`; прочие поля игнорируются.
     * Заменяется только то свойство, чья часть реально изменилась (иначе лишний пересчёт и запись
     * в LocalStorage). `undefined`/`null` в patch — удалить значение (вернуть значение из метаданных);
     * у `filter` отсутствием считается и пустой/пробельный текст.
     * @param {string} key — ключ-путь колонки (`wrapper.key`)
     * @param {object} patch
     */
    setColumnState(key, patch) {
        if (!key || !patch || typeof patch !== 'object')
            return;
        const sizing = patchPart(patch, SIZING_FIELDS, this.columnSizing?.[key]);
        if (sizing)
            this.columnSizing = nextColumnState(this.columnSizing, key, sizing);
        const view = patchPart(patch, VIEW_FIELDS, this.columnView?.[key]);
        if (view)
            this.columnView = nextColumnState(this.columnView, key, view);
        if ('filter' in patch) {
            // та же ссылка — изменений нет: свойство не заменяем (ни пересчёта строк, ни записи)
            const filters = nextColumnFilter(this.columnFilter, key, patch.filter);
            if (filters !== this.columnFilter)
                this.columnFilter = filters;
        }
    },
    /** сбросить состояние всех колонок (вид, размеры, фильтры): всё снова как в метаданных */
    resetColumnStates() {
        this.columnSizing = {};
        this.columnView = {};
        this.columnFilter = {};
    },
    /**
     * Клик по колонке для сортировки (Р1): цикл `+N → −N → без сортировки`. Простой клик (`add`
     * ложно) — одиночная сортировка, остальные колонки сбрасываются в `0`; `add` (Ctrl/Cmd) —
     * добавить/переключить в мультисортировке, новая колонка — в конец набора, после снятия номера
     * остальных перенумеровываются без дыр. Правила — чистая `nextSortOrders`; здесь только запись:
     * каждое изменение — своя замена `columnView` через `setColumnState` (Reactor пересчитает слои
     * один раз после синхронного кода). `sortOrder: 0` пишется явно — перекрывает метаданные.
     * Номера берутся действующие (состояние ?? поле) у **всех** колонок, включая детей свёрнутых.
     * @param {string} key — ключ-путь колонки (`wrapper.key`); неизвестный ключ — ничего не делает
     * @param {{add?: boolean}} [options]
     */
    sortBy(key, options) {
        const entries = flatColumns(this.wrappers).map(col => ({ key: col.key, sortOrder: col.sortOrder }));
        for (const change of nextSortOrders(entries, key, { add: !!options?.add }))
            this.setColumnState(change.key, { sortOrder: change.sortOrder });
    },

    // --- настройки таблицы (8-c, Р6): временный property-grid ---
    /**
     * Открыть настройки таблицы — временный property-grid (`settings.js`, `oda-table-settings`).
     * Идеал — `property-grid` таблицы, но его нет до фазы 04; замена — этап 15 или позже.
     * Окно — обычный попап `showDropdown`: при изменениях **не прячется** (в отличие от
     * `oda-menu-list`, который закрывается выбором пункта). Модуль настроек грузится лениво —
     * таблице он нужен только по правому клику.
     * @param {Event|Element} anchor — событие правого клика (координаты) или элемент
     */
    async showSettings(anchor) {
        await import('/oda/components/table/settings.js');
        // первое открытие бывало пустым: upgraded-элемент с данными, но тень пуста —
        // первый штамп шаблона теряется, когда холодно (второе открытие всегда целое).
        // Ждём цепочку определений, а после показа сторожем проверяем высоту попапа
        // (он — светлый потомок body и меряется снаружи) и при пустом дёргаем рендер+раскладку.
        await Promise.all([
            'oda-table-settings', 'oda-table', 'oda-table-header', 'oda-table-row',
            'oda-table-cell', 'oda-table-cell-tree', 'oda-table-router',
            'oda-checkbox', 'oda-text-input', 'oda-button',
        ].map(tag => customElements.whenDefined(tag)));
        const element = ODA.createElement('oda-table-settings');
        // обычным полем мимо прокси: через $public ссылка флапает (см. settings.js, pitfalls §40)
        Object.defineProperty(element, 'table', { value: this, configurable: true, writable: true });
        const shown = ODA.showDropdown(element, { TITLE: { label: 'Настройки таблицы' } }, anchor);
        setTimeout(() => {
            const pop = ODA.popovers[ODA.popovers.length - 1];
            if (pop?.control === element && (pop.offsetHeight ?? 0) < 60) {
                element.render?.();
                pop.layout?.();
            }
        }, 400);
        return shown.catch(err => {
            // закрытие без результата (Esc, щелчок вне) — отмена, не ошибка
            if (!(err instanceof ODA.CancelError))
                throw err;
        });
    },

    // --- колонки: каскад над деревом полей ---
    /**
     * Поля WORK → обёртки колонок (кэш на инстанс: обёртки не текут между таблицами).
     * `stateOf` отдаёт запись **с геттерами**: каждый геттер обёртки (`width`, `expanded`, ...) читает
     * только своё свойство таблицы, поэтому Reactor связывает его ровно с ним — правка ширины не
     * сбрасывает `expanded`/`hidden`/`order` и не пересобирает раскладку. Сам `wrappers` состояние
     * не читает: `stateOf` вызывается лениво, внутри геттеров обёрток.
     */
    get wrappers() {
        const host = this;
        return wrapColumns(normalizeFields(this.metadata), {
            childrenKey: 'children',
            valueKey: this.valueKey,
            cache: this.columnWrappers ??= new Map(),
            stateOf: key => ({
                get width() { return host.columnSizing?.[key]?.width; },
                get minWidth() { return host.columnSizing?.[key]?.minWidth; },
                get expanded() { return host.columnView?.[key]?.expanded; },
                get hidden() { return host.columnView?.[key]?.hidden; },
                get order() { return host.columnView?.[key]?.order; },
                get sortOrder() { return host.columnView?.[key]?.sortOrder; },
                get groupOrder() { return host.columnView?.[key]?.groupOrder; },
                // фильтра (`columnFilter`) здесь нет намеренно: его читают только строки, иначе
                // ввод фильтра пересобирал бы раскладку
            }),
        });
    },
    /** главная колонка: помеченная `treeMode` в поле, иначе первая */
    get treeColumn() {
        return this.wrappers.find(w => w.field?.treeMode) ?? this.wrappers[0];
    },
    /** раскладка: плоские листья (ячейки) + строки шапки со спанами; главная колонка не скрывается */
    get layout() {
        return columnLayout(this.wrappers, { mustKeep: this.treeColumn?.key });
    },
    /** видимые листья — источник ячеек строк */
    get visibleColumns() {
        return this.layout.leaves;
    },
    /**
     * Есть ли хвостовой трек `@filler` (все видимые листья фиксированы) — признак из модели
     * (`layout.filler`), чтобы правило «где кончается сетка» жило в одном месте. Тогда последний
     * лист — не край сетки и его правая линия рисуется.
     */
    get hasFiller() {
        return !!this.layout.filler;
    },
    /** CSS-переменные сетки для прокручиваемого контейнера (имена строчными — `toKebab` их не трогает) */
    get gridVars() {
        return {
            '--table-tracks': this.layout.tracks,
            '--table-min-total': this.layout.minTotal,
        };
    },

    // --- сортировки/группировки читают обёртки: их `name`/`label`/порядки уже приведены к WORK-ключам ---
    /** сортировки всех колонок (включая вложенные) в порядке номеров `|sortOrder|`; значение — `valueOf` обёртки */
    get sortsSpec() {
        return sortsFrom(flatColumns(this.wrappers));
    },
    get groupsSpec() {
        return groupsFrom(this.wrappers);
    },

    // --- данные ---
    /** входные данные → дерево обёрток {data, level, expanded, items} */
    get treeRows() {
        // состояние (раскрытие/отметка) — на самих обёртках; кэш держит одну обёртку на объект
        // данных, иначе состояние терялось бы на каждом пересчёте слоёв
        return wrapTree(this.dataSet, { cache: this.rowWrappers ??= new WeakMap() });
    },
    /**
     * При активном фильтре раскрываем всё на полную глубину (не меняя `expanded` в обёртках) —
     * иначе `filterForceExpanding` разрешает искать только по собранным ветвям.
     */
    get forceExpand() {
        return !!(this.filter || this.hasColumnFilter) && this.filterForceExpanding;
    },
    /**
     * Действует ли хоть один фильтр колонки: непустой текст у колонки фронта (скрытые колонки,
     * дети свёрнутых и ключи удалённых в хранилище не считаются — иначе дерево раскрывалось бы
     * без фильтрации, а снять такой фильтр было бы нечем). Булево, не предикат: «нет» — `false`,
     * а не `undefined` (§32).
     */
    get hasColumnFilter() {
        return hasFilterText(this.columnFilter) && !!columnFilterPredicate(this.columnFilter, this.visibleColumns);
    },
    /**
     * Плоский список видимых строк: фильтр (глобальный И фильтры колонок; только при значении) →
     * линеаризация с ленивой сортировкой братьев на посещаемых уровнях. Без фильтров `filterTree`
     * не вызывается вовсе. Предикаты собираются здесь, без промежуточных геттеров: геттер, отдающий
     * `undefined` («фильтра нет»), Reactor не кэширует и рвёт сброс зависимостей (§32).
     */
    get items() {
        const search = this.filter ? searchPredicate(this.filter, this.wrappers) : undefined;
        const byColumn = this.hasColumnFilter
            ? columnFilterPredicate(this.columnFilter, this.visibleColumns)
            : undefined;
        const predicate = allPredicates(search, byColumn);
        const filtered = predicate ? filterTree(this.treeRows, predicate, { deep: this.forceExpand }) : this.treeRows;
        return flattenTree(filtered, { open: this.forceExpand, compare: sortCompare(this.sortsSpec) });
    },
    /** плоский список с группами (без групп — тот же список) */
    get groupedItems() {
        return groupItems(this.items, {
            groups: this.groupsSpec,
            expandedOf: key => this.groupStates?.get(key) === true,
        });
    },
    /** имена как у oda-table: отфильтрованное = сгруппированное = отсортированное */
    get filteredItems() {
        return this.groupedItems;
    },
    get sortedItems() {
        return this.filteredItems;
    },
    /** полная длина списка — от неё считается виртуальная высота, не от окна */
    get rowCount() {
        return this.sortedItems.length;
    },
    /** окно отрисовки: пока без скролла — весь список (этап 14 добавит count и запас) */
    get rows() {
        return sliceWindow(this.sortedItems, { top: this.screenTopRowIndex });
    }
});
