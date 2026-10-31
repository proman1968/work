/**
 * form/objects — список объектов класса и редактор на учётном ядре (методы `db_*`, sources/data/api.js).
 * Схема — `db_schema` (поля с учётом наследования), список — `db_query` (класс с потомками,
 * названия ссылок приходят в `names`), редактор — модальное окно `item-object-editor`;
 * закрытие с несохранёнными изменениями спрашивает «Сохранить перед закрытием?».
 *
 * Операции: полоса периодов сверху (дата операции), колонки «Дата» и «Статус», в окне — дата,
 * проводки (действующие или предпросмотр черновика) и действия по статусу:
 * черновик — сохранить, удалить, провести (несохранённое сначала сохраняется);
 * проведённая — сохранить (= исправление: сторно и новые проводки), отменить; отменённая — только просмотр.
 * Справочники — весь список без полосы периодов.
 *
 * Период хранится здесь, а не в пакете: пакет stateless, состояние — per-point ($save).
 * `packetsKey` хранит КЛЮЧ выбора, а не границы: у пункта «Сейчас» ключ 'now'
 * относителен, поэтому нетронутый дефолт остаётся «сегодня», а не вчерашним днём.
 */

// Дата по местному времени: ядро понимает 'YYYY-MM-DD' как местный день.
function _day(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const _today = () => _day(new Date());

/** Тип поля ядра → тип редактора (editor-form). */
const TYPES = {
    string: 'String', text: 'Text', number: 'Number', money: 'Number', integer: 'Number', boolean: 'Boolean',
    date: 'Date', datetime: 'DateTime', link: 'Link', struct: 'Struct', table: 'Table', enum: 'Select', file: 'File',
};
const STATUS = { draft: 'черновик', registered: 'проведена', cancelled: 'отменена', deleted: 'удалена' };
const DATE_FIELD = Object.freeze({ id: 'time', label: 'Дата', type: 'Date', required: true });

/** Поле схемы ядра → поле редактора: тип, справочник ссылки, варианты, вложенные поля структуры и колонки табличной части. */
function formField(f) {
    const rawType = String(f.type || '').toLowerCase();
    const out = { id: f.id, label: f.label || f.id, type: TYPES[rawType] || TYPES[f.type] || 'String' };
    if (rawType === 'money')
        out.formatMoney = true;
    if (f.required)
        out.required = true;
    if (rawType === 'link')
        out.catalog = f.targetPath || f.target;
    if (rawType === 'enum')
        out.options = (f.values || f.options || []).map(v => (v && typeof v === 'object'
            ? { value: String(v.id ?? v.value), label: String(v.label ?? v.id ?? v.value) }
            : { value: String(v), label: String(v) }));
    if (rawType === 'struct')
        out.children = (f.fields || []).map(formField);
    if (rawType === 'table')
        out.columns = (f.fields || []).map(formField);
    return out;
}

/** Ключ места записи для выбора и сохранения: «подразделение|место». */
function contextKeyOf(c) {
    return c ? `${c.unit}|${c.place ?? ''}` : '';
}

const money = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const saldo = (d, c) => {
    const net = (Number(d) || 0) - (Number(c) || 0);
    return net > 0 ? money(net) + ' Дт' : net < 0 ? money(-net) + ' Кт' : '0';
};

/** Строка табличной части не пуста: есть хотя бы одно заполненное поле. */
function isNonEmptyRow(row) {
    if (!row || typeof row !== 'object')
        return false;
    return Object.values(row).some(v => v !== undefined && v !== null && String(v).trim() !== '');
}

const OP_STATUSES = [
    { id: '', label: 'Все статусы' },
    { id: 'draft', label: 'Черновики' },
    { id: 'registered', label: 'Проведённые' },
    { id: 'cancelled', label: 'Отменённые' },
];
const CAT_STATUSES = [
    { id: '', label: 'Действующие' },
    { id: 'deleted', label: 'Удалённые' },
];

export default {
    imports: 'oda//button, oda//packets, oda//table, ~/lib//editor-form, ~/lib//menu, ~/lib//popover',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            @apply --content;
            gap: 0;
            padding: 0;
            overflow: hidden;
            font-size: 13px;
        }
        .body {
            @apply --horizontal;
            flex: 1;
            gap: 0;
            overflow: hidden;
        }
        .list {
            @apply --vertical;
            flex: 1;
            overflow: hidden;
        }
        oda-table {
            flex: 1;
        }
        .bar {
            @apply --horizontal;
            @apply --header;
            flex-shrink: 0;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            padding: 3px 8px;
            min-height: 28px;
            border-bottom: 1px solid var(--border-color);
            font-size: 12px;
        }
        .bar input.search,
        .bar select {
            @apply --content;
            min-width: 0;
            padding: 2px 6px;
            font-size: 12px;
            border: 1px solid var(--border-color);
            border-radius: 3px;
        }
        .bar input.search {
            width: 170px;
        }
        .pager {
            @apply --horizontal;
            gap: 4px;
            align-items: center;
            margin-left: auto;
            font-size: 12px;
        }
        .error {
            padding: 6px 10px;
            color: var(--error-color);
            background: var(--error-soft);
            border-bottom: 1px solid var(--error-color);
            white-space: break-spaces;
        }
        .grid-footer {
            @apply --horizontal;
            @apply --light;
            color: var(--content-color);
            flex-shrink: 0;
            align-items: center;
            justify-content: space-between;
            min-height: 24px;
            padding: 2px 10px;
            border-top: 1px solid var(--border-color);
            font-size: 11.5px;
            font-weight: 600;
            user-select: none;
        }
    </style>
    <oda-packets no-flex mode="day" ~if="packetsStart && isOperation"
        :start="packetsStart" :end="packetsEnd" :days="packetsDays"
        ::value="packetsKey" @selection-changed="onPackets($event)"></oda-packets>
    <div class="body">
        <div class="list">
            <div class="bar" ~if="!inWorkForm">
                <oda-button ~if="canCreate && !inWorkForm" icon="icons:plus" @tap="create">Создать</oda-button>
                <oda-button icon="icons:refresh" @tap="reload">Обновить</oda-button>
                <input class="search" type="search" :value="searchQuery" placeholder="Поиск…" @change="onSearch($this.value)">
                <select title="Статус" @change="filterStatus($this.value)">
                    <option ~for="statusOptions" :value="$for.item.id" :selected="$for.item.id === statusFilter">{{$for.item.label}}</option>
                </select>
                <select ~for="filterableFields" :title="$for.item.label" @change="setFieldFilter($for.item.id, $this.value)">
                    <option value="" :selected="!fieldFilters[$for.item.id]">{{$for.item.label}}: все</option>
                    <option ~for="$for.item.filterOptions" :value="$for.$for.item.value" :selected="$for.$for.item.value === fieldFilters[$for.item.id]">{{$for.$for.item.label}}</option>
                </select>
                <select ~if="units.length > 1" title="Подразделение" @change="filterUnit($this.value)">
                    <option value="" :selected="!unitFilter">Все подразделения</option>
                    <option ~for="units" :value="$for.item.cid" :selected="$for.item.cid === unitFilter">{{$for.item.label}}</option>
                </select>
            </div>
            <div class="error" ~if="error && !editorOpen">{{error}}</div>
            <oda-table id="objectsTable" allow-focus allow-selection col-lines row-lines readonly ::focused-row="focusedRow" ::selected-rows="selectedRows"
                :metadata="tableMetadata" :data-set="tableRows"
                :$save-key="$item?.short || $item?.path" @click="onTableClick($event)" @dblclick="onTableDblClick($event)" @cell-link-click="onCellLinkClick($event)" @row-contextmenu="onRowContextMenu($event)"></oda-table>
            <div class="grid-footer">
                <span>{{total || rows.length}}</span>
                <span ~if="selectedRows?.length > 1">Выбрано: {{selectedRows.length}}</span>
                <div class="pager" ~if="total > pageSize || page > 1">
                    <span>{{pageText}}</span>
                    <oda-button ~if="page > 1" icon="icons:chevron-left" icon-size="16" title="Предыдущая страница" @tap="setPage(page - 1)"></oda-button>
                    <oda-button ~if="page * pageSize < total" icon="icons:chevron-right" icon-size="16" title="Следующая страница" @tap="setPage(page + 1)"></oda-button>
                </div>
            </div>
        </div>
    </div>
    `,
    rows: [],
    columns: [],
    schema: null,
    /** листья поддерева для создания объектов в группе (db_schema.leaves): [{ cid, path, label, count }] */
    leaves: [],
    /** описание классов поддерева (db_schema.classes): cid → { cid, path, parent, label, icon, leaf, count, group } */
    classes: {},
    /** выбранный лист при создании/редактировании в группе и его схема */
    leafCid: '',
    leafSchema: null,
    editing: null,
    /** проводки редактируемой операции: действующие или предпросмотр черновика */
    entries: [],
    /** названия счетов и аналитик для предпросмотра проводок (db_preview.names) */
    entryNames: { objects: {}, classes: {} },
    /** текущие сальдо объекта справочника по счетам (db_trajectory.closing) */
    objectBalances: [],
    /** движения объекта справочника по журналу (db_trajectory.items) */
    trajectory: [],
    trajectoryNames: { objects: {}, classes: {}, paths: {} },
    /** печатные формы открытой операции (db_print_list): [{ name, label }] */
    printForms: [],
    focusedRow: null,
    selectedRows: [],
    focusedItem: null,
    /** окно редактора открыто: второй клик по таблице не открывает ещё одно */
    editorOpen: false,
    /** идёт сохранение/удаление/проведение: повторные действия и закрытие ждут */
    busy: false,
    /** снимок значений на момент открытия/успешного действия — база для isDirty */
    _snapshot: '',
    /** поиск, фильтр статуса, фильтры по полям и постраничность списка */
    searchQuery: '',
    statusFilter: '',
    fieldFilters: {},
    total: 0,
    page: 1,
    pageSize: 200,
    _findFormHost() {
        if (this.$form && ('focusedItem' in this.$form || typeof this.$form.syncFromView === 'function' || typeof this.$form.openInForm === 'function'))
            return this.$form;
        for (let p = this.parentElement || this.domHost; p; p = p.parentElement || p.domHost) {
            if (p.localName === 'work-form' || typeof p.syncFromView === 'function' || 'focusedItem' in p)
                return p;
        }
        return null;
    },
    get inWorkForm() {
        return Boolean(this._findFormHost());
    },
    _notifyForm() {
        const host = this._findFormHost();
        if (!host)
            return;
        if (host.view_control && host.view_control !== this)
            return;
        if (typeof host.syncFromView === 'function')
            host.syncFromView(this);
        else
            host.focusedItem = this.focusedItem;
    },
    /** Вынести поле поиска в правую зону тулбара work-form (.toolbar-zone.right). */
    mountToolbarSlots(formHost = this._findFormHost()) {
        if (!formHost || typeof document === 'undefined')
            return;
        const container = formHost.$?.('.toolbar-zone.right') || formHost;
        let searchWrap = container.querySelector?.('[data-objects-search-wrap]');
        let searchInput = container.querySelector?.('input[data-objects-search]');
        if (!searchWrap) {
            searchWrap = document.createElement('div');
            searchWrap.setAttribute('slot', 'tool-right');
            searchWrap.setAttribute('data-toolbar-widget', '1');
            searchWrap.setAttribute('data-objects-search-wrap', '1');
            searchWrap.style.cssText = 'display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--border-color); border-radius: 3px; background: var(--content-background); padding: 0 2px 0 6px; min-height: 24px; box-sizing: border-box;';

            searchInput = document.createElement('input');
            searchInput.setAttribute('data-objects-search', '1');
            searchInput.type = 'search';
            searchInput.placeholder = 'Поиск по объектам…';
            searchInput.title = 'Серверный поиск по всему содержимому объектов (Enter или кнопка поиска)';
            searchInput.style.cssText = 'width: 195px; min-height: 22px; padding: 1px 4px; font-size: 12.5px; border: none; background: transparent; color: var(--content-color); outline: none;';

            const searchBtn = document.createElement('button');
            searchBtn.type = 'button';
            searchBtn.title = 'Найти на сервере во всём содержимом объектов';
            searchBtn.textContent = '🔍';
            searchBtn.style.cssText = 'border: none; background: transparent; color: var(--accent-color); cursor: pointer; font-size: 12px; padding: 1px 5px; border-radius: 2px; line-height: 1;';

            let searchTimer = null;
            const runNow = (force = false) => {
                if (searchTimer) {
                    clearTimeout(searchTimer);
                    searchTimer = null;
                }
                const owner = searchWrap._ownerView || this;
                const val = String(searchInput.value ?? '').trim();
                if (force || val !== String(owner.searchQuery ?? '').trim())
                    owner.onSearch(val);
            };
            searchInput.addEventListener('input', () => {
                if (searchTimer)
                    clearTimeout(searchTimer);
                searchTimer = setTimeout(() => runNow(false), 260);
            });
            searchInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    runNow(true);
                }
                else if (ev.key === 'Escape' && searchInput.value) {
                    ev.preventDefault();
                    searchInput.value = '';
                    runNow(true);
                }
            });
            searchInput.addEventListener('change', () => runNow(false));
            searchInput.addEventListener('search', () => runNow(true));
            searchBtn.addEventListener('click', () => runNow(true));

            searchWrap.appendChild(searchInput);
            searchWrap.appendChild(searchBtn);
            container.appendChild(searchWrap);
        }
        searchWrap._ownerView = this;
        if (searchInput) {
            searchInput._ownerView = this;
            searchInput.value = this.searchQuery || '';
        }
        formHost._checkToolbarSlots?.();
    },
    getItemButtons() {
        return [
            {
                id: 'create',
                label: 'Новый',
                icon: 'icons:add',
                isButton: true,
                order: 1,
                disabled: !this.canCreate,
                execute: () => this.create(),
            },
        ];
    },
    get itemButtons() {
        return this.getItemButtons();
    },
    getActiveSelection() {
        const tblSel = this.$?.('#objectsTable')?.selectedRows;
        const rawSel = Array.isArray(tblSel) && tblSel.length ? tblSel : this.selectedRows;
        const sel = Array.isArray(rawSel) ? rawSel.filter(r => r?.id) : [];
        if (sel.length > 0)
            return sel;
        return this.focusedRow?.id ? [this.focusedRow] : [];
    },
    get activeSelection() {
        return this.getActiveSelection();
    },
    canDeleteRow(row = this.focusedRow) {
        if (!row?.id || !this.canCreate)
            return false;
        if (this.isOperation)
            return row.status === 'draft';
        return row.status !== 'deleted';
    },
    canDeleteSelection(rows = this.getActiveSelection()) {
        const list = Array.isArray(rows) ? rows : (rows?.id ? [rows] : []);
        return list.length > 0 && list.every(r => this.canDeleteRow(r));
    },
    getFocusedButtons() {
        const sel = this.getActiveSelection();
        const isMulti = sel.length > 1;
        const row = sel[0] || this.focusedRow;
        return [
            {
                id: 'copy',
                label: 'Копия',
                icon: 'icons:content-copy',
                isButton: true,
                order: 2,
                disabled: isMulti || !row?.id || !this.canCreate,
                execute: () => this.copyRow(row),
            },
            {
                id: 'open',
                label: 'Открыть',
                icon: 'icons:launch',
                isButton: true,
                order: 3,
                disabled: isMulti || !row?.id,
                execute: () => this.openEditor(row),
            },
            {
                id: 'delete',
                label: 'Удалить',
                icon: 'icons:delete',
                isButton: true,
                allowList: true,
                order: 4,
                disabled: !this.canDeleteSelection(sel),
                execute: () => this.deleteRow(sel),
            },
        ];
    },
    get focusedButtons() {
        return this.getFocusedButtons();
    },
    getFocusedServices() {
        return [];
    },
    get focusedServices() {
        return this.getFocusedServices();
    },
    async onCellLinkClick(e) {
        const d = e?.detail?.value || e?.detail || {};
        const row = d.row;
        const col = d.column;
        const field = col?.field || col;
        if (!row || !field)
            return;
        if (field.isGroupCol) {
            const path = row._groupPath || (row.cid && this.classes?.[row.cid]?.path) || row.cid || '';
            if (!path)
                return;
            try {
                const target = await WORK.get_item(path);
                if (!target)
                    return;
                const formHost = this._findFormHost();
                if (formHost && typeof formHost.openInForm === 'function')
                    await formHost.openInForm(target, { view: 'objects' });
                else if (window.execute)
                    window.execute(target, { view: 'objects' });
            }
            catch (err) {
                this.setError(err);
            }
            return;
        }
        const linkInfo = d.link || row._links?.[field.id];
        const objId = linkInfo?.id;
        let targetPath = linkInfo?.target || field.linkTarget || field.catalog || '';
        if (!objId || !targetPath)
            return;
        if (!targetPath.startsWith('/')) {
            const curPath = this.$item?.short || this.$item?.path || '';
            const m = curPath.match(/^(\/ORGANIZATIONS\/[^/]+\/MODULES\/[^/]+)/);
            if (m)
                targetPath = `${m[1]}/${targetPath.replace(/^\/+/, '')}`;
        }
        try {
            const target = await WORK.get_item(targetPath);
            if (!target)
                return;
            const nav = { view: 'object', id: String(objId), label: String(row[field.id] || objId) };
            const formHost = this._findFormHost();
            if (formHost && typeof formHost.openInForm === 'function')
                await formHost.openInForm(target, nav);
            else if (window.execute)
                window.execute(target, nav);
        }
        catch (err) {
            this.setError(err);
        }
    },
    onTableClick() {
        const tbl = this.$?.('#objectsTable');
        if (tbl) {
            if (tbl.focusedRow !== undefined)
                this.focusedRow = tbl.focusedRow;
            if (Array.isArray(tbl.selectedRows))
                this.selectedRows = tbl.selectedRows;
        }
        this._syncFocusedItem();
    },
    onTableDblClick() {
        if (this.focusedRow?.id && !this.editorOpen)
            this.openEditor(this.focusedRow);
    },
    async onRowContextMenu(e) {
        const d = e?.detail?.value || e?.detail || {};
        const row = d.row || this.focusedRow;
        const origEvent = d.originalEvent || e;
        const tbl = this.$?.('#objectsTable');
        if (tbl) {
            if (tbl.focusedRow !== undefined)
                this.focusedRow = tbl.focusedRow;
            if (Array.isArray(tbl.selectedRows))
                this.selectedRows = tbl.selectedRows;
        }
        else if (row) {
            this.focusedRow = row;
        }
        this._syncFocusedItem();
        if (!row?.id || typeof WORK?.showMenu !== 'function')
            return;
        const sel = this.getActiveSelection();
        const isMulti = sel.length > 1;
        const objTitle = row.name || row.id;
        const tools = [
            {
                id: 'create',
                label: 'Создать объект',
                shortcut: 'CTRL+INSERT',
                icon: 'icons:add',
                disabled: !this.canCreate,
                execute: () => this.create(),
            },
            {
                id: 'copy',
                label: 'Создать объект (копия)',
                shortcut: 'CTRL+SHIFT+C',
                icon: 'icons:content-copy',
                disabled: isMulti || !row?.id || !this.canCreate,
                execute: () => this.copyRow(row),
            },
            {
                id: 'open',
                label: `Открыть объект '${objTitle}'`,
                icon: 'icons:launch',
                disabled: isMulti || !row?.id,
                execute: () => this.openEditor(row),
            },
            {
                id: 'delete',
                label: isMulti ? `Удалить объекты (${sel.length})` : 'Удалить объект',
                shortcut: 'DELETE',
                icon: 'icons:delete',
                disabled: !this.canDeleteSelection(sel),
                execute: () => this.deleteRow(sel),
            },
        ];
        try {
            await WORK.showMenu({
                TITLE: { label: isMulti ? `объекты (${sel.length})` : `объект: ${objTitle}` },
                mode: 'tools',
                customTools: tools,
            }, origEvent);
        }
        catch (err) {
            if (!(WORK.CancelError && err instanceof WORK.CancelError))
                console.warn(err);
        }
    },
    _syncFocusedItem() {
        const sel = this.getActiveSelection();
        if (sel.length > 1)
            this.focusedItem = sel;
        else if (sel.length === 1)
            this.focusedItem = sel[0];
        else
            this.focusedItem = null;
        this._notifyForm();
    },
    $observers: {
        /** внутри work-form одиночный клик фокусирует строку ($focusedItem), множественный — массив ($focusedItem), автономно — открывает редактор */
        select(focusedRow) {
            this._syncFocusedItem();
            if (!this.inWorkForm && focusedRow?.id && !this.editorOpen)
                this.openEditor(focusedRow);
        },
        onSelectedRowsChanged(selectedRows) {
            this._syncFocusedItem();
        }
    },
    /** id объекта → название (ссылки в строках списка) */
    names: {},
    error: '',
    /** Ошибки полей из ответа сервера (DataError.errors): { [field]: message } */
    fieldErrors: {},
    setError(e) {
        this.error = String(e?.message || e || '');
        const map = {};
        if (Array.isArray(e?.errors)) {
            for (const item of e.errors) {
                if (item?.field && item?.message)
                    map[item.field] = map[item.field] ? `${map[item.field]}; ${item.message}` : item.message;
            }
        }
        else if (this.error.includes('\n')) {
            for (const line of this.error.split('\n')) {
                const m = /^\s*[—-]\s*([a-zA-Z0-9_.\[\]]+)\s*:\s*(.+)$/.exec(line);
                if (m)
                    map[m[1]] = map[m[1]] ? `${map[m[1]]}; ${m[2].trim()}` : m[2].trim();
            }
        }
        this.fieldErrors = map;
    },
    clearError() {
        this.error = '';
        this.fieldErrors = {};
    },
    /** Ключ выбранного пакета: 'now' | '*' | маска единицы | 'period:start:end'. */
    packetsKey: { $def: 'now', $type: String, $save: true },
    /** Режим гранулярности пакета: 'day' | 'week' | 'month' | 'quarter' | 'year'. */
    packetsMode: { $def: 'day', $type: String, $save: true },
    packetsStart: '',
    packetsEnd: '',
    packetsDays: [],
    /** Период, который показал пакет, — единственный источник границ для выборки операций. */
    period: null,
    /** Подразделения, данные которых видны (db_scope): больше одного — фильтр списка. */
    units: [],
    /** Выбранное подразделение фильтра (cid), пусто — все. */
    unitFilter: '',
    /** Подразделения и места, от которых пользователь создаёт объекты (db_scope). */
    contexts: [],
    /** Последнее выбранное место записи: «подразделение|место». */
    contextKey: { $def: '', $type: String, $save: true },
    /** Место записи нового объекта: выбранное или первое из доступных. */
    get context() {
        const list = this.contexts || [];
        return list.find(c => contextKeyOf(c) === this.contextKey) ?? list[0] ?? null;
    },
    /** Выбор места записи нужен, если их несколько (иначе сервер возьмёт единственное). */
    get showContext() {
        return (this.contexts || []).length > 1;
    },
    contextKeyOf,
    /** Сменить фильтр подразделения списка и перечитать. */
    filterUnit(cid) {
        this.unitFilter = cid || '';
        this.page = 1;
        return this.reload();
    },
    onSearch(q) {
        this.searchQuery = String(q ?? '').trim();
        this.page = 1;
        return this.reload();
    },
    filterStatus(status) {
        this.statusFilter = status || '';
        this.page = 1;
        return this.reload();
    },
    setFieldFilter(fieldId, value) {
        const next = { ...(this.fieldFilters || {}) };
        if (value === '' || value === undefined || value === null)
            delete next[fieldId];
        else
            next[fieldId] = String(value);
        this.fieldFilters = next;
        this.page = 1;
        return this.reload();
    },
    setPage(p) {
        const n = Math.max(1, Number(p) || 1);
        if (n === this.page)
            return;
        this.page = n;
        return this.reload();
    },
    get statusOptions() {
        return this.schema?.family === 'operation' ? OP_STATUSES : CAT_STATUSES;
    },
    /** Поля списка и флагов для быстрого отбора в шапке. */
    get filterableFields() {
        return (this.columns || []).filter(c => c.type === 'Select' || c.type === 'Boolean').map(c => ({
            id: c.id,
            label: c.label || c.id,
            filterOptions: c.type === 'Boolean'
                ? [{ value: '1', label: 'Да' }, { value: '0', label: 'Нет' }]
                : (c.options || []),
        }));
    },
    get pageText() {
        const from = (this.page - 1) * this.pageSize + 1;
        const to = Math.min(this.page * this.pageSize, this.total || this.rows.length);
        return `${from}–${to} из ${this.total}`;
    },
    contextTitle(c) {
        return c?.place ? `${c.unit_label} / ${c.place_label}` : c?.unit_label || '';
    },
    /** Действующая схема редактора: у выбранного в группе листа — его схема, иначе схема класса. */
    get activeSchema() {
        return this.leafSchema || this.schema;
    },
    get isOperation() {
        return this.schema?.family === 'operation';
    },
    get hasPostings() {
        const s = this.activeSchema;
        return this.isOperation && Array.isArray(s?.POSTINGS) && s.POSTINGS.length > 0;
    },
    /** Объекты создаются в листе справочника или операции (либо в группе, где есть листья). */
    get canCreate() {
        const s = this.schema;
        return !!s && (!!s.leaf || (this.leaves?.length > 0)) && (s.family === 'catalog' || s.family === 'operation') && s.type !== '$virtual';
    },
    /** Выбор листа в окне нового объекта нужен в группе с несколькими листьями. */
    get showLeafSelect() {
        return !!this.schema && !this.schema.leaf && (this.leaves?.length || 0) > 1;
    },
    /** Колонка «Операция» / «Вид» показывается у группы классов с поддеревом. */
    get showClassCol() {
        return !!this.schema && !this.schema.leaf && Object.keys(this.classes || {}).length > 1;
    },
    get status() {
        return this.editing?.status || '';
    },
    /** Сохранять можно справочник, новый объект, черновик и проведённую операцию (исправление). */
    get canSave() {
        return !!this.editing && this.status !== 'cancelled' && this.status !== 'deleted';
    },
    get canRemove() {
        return !!this.editing?.id && (!this.isOperation || this.status === 'draft') && this.status !== 'deleted';
    },
    get canRestore() {
        return !!this.editing?.id && !this.isOperation && this.status === 'deleted';
    },
    get canRegister() {
        return this.isOperation && !!this.editing && (!this.editing.id || this.status === 'draft');
    },
    get canCancel() {
        return this.isOperation && this.status === 'registered';
    },
    /** Заголовок окна: класс + имя объекта; у нового имени ещё нет. */
    get editorTitle() {
        const title = this.activeSchema?.title || this.schema?.title || '';
        const field = this.fieldList().find(f => ['name', 'label', 'title'].includes(f.id));
        const name = field ? String(this.editing?.[field.id] ?? '').trim() : '';
        const object = name || (this.editing?.id ? '' : 'новый объект');
        if (!title)
            return object || 'Объект';
        if (!object || title === object)
            return title;
        return title + ' · ' + object;
    },
    /** Относительный путь места хранения объекта внутри промежуточного класса (для колонки «Группа»). */
    groupLabelOf(cid) {
        if (!cid)
            return '';
        const entry = this.classes?.[cid];
        if (!entry)
            return String(cid);
        if (typeof entry.group === 'string' && entry.group)
            return entry.group;
        const rootCid = this.schema?.cid || '';
        const rootPath = this.schema?.path || this.$item?.path || this.$item?.short || '';
        if (entry.parent) {
            const parts = [];
            let cur = entry;
            const seen = new Set();
            while (cur && cur.cid !== rootCid && cur.path !== rootPath && !seen.has(cur.cid)) {
                seen.add(cur.cid);
                parts.unshift(cur.label || cur.cid.split('/').pop());
                cur = cur.parent ? this.classes?.[cur.parent] : null;
            }
            if (parts.length)
                return parts.join('/');
        }
        let basePath = rootPath;
        if (!basePath) {
            const rootEntry = Object.values(this.classes || {}).find(c => !c.leaf);
            basePath = rootEntry?.path || '';
        }
        if (basePath && entry.path && entry.path.startsWith(basePath + '/')) {
            const rel = entry.path.slice(basePath.length + 1).split('/').filter(Boolean);
            const byPath = new Map(Object.values(this.classes || {}).filter(c => c?.path).map(c => [c.path, c.label]));
            let acc = basePath;
            const labels = rel.map(seg => {
                acc += '/' + seg;
                return byPath.get(acc) || seg;
            });
            if (labels.length)
                return labels.join('/');
        }
        return entry.label || String(cid);
    },
    /** Колонки таблицы: первым всегда «Наименование» (прилипает слева), у операций — дата и статус, у промежуточного класса — колонка «Группа» справа (прилипает справа). */
    get tableMetadata() {
        const rawCols = (this.columns || []).map(c => {
            if (c.type === 'Link')
                return { ...c, type: 'String', isLinkCol: true, linkTarget: c.catalog || '' };
            if (c.type === 'Table' || c.type === 'Struct')
                return { ...c, type: 'String' };
            return c;
        });
        const existingName = rawCols.find(c => c.id === 'name');
        const nameCol = {
            ...(existingName || { id: 'name', type: 'String' }),
            id: 'name',
            label: (!existingName?.label || existingName.label === 'name') ? 'Наименование' : existingName.label,
            stickyLeft: true,
            minWidth: 200,
        };
        const restCols = rawCols.filter(c => c.id !== 'name');
        const orderedCols = this.isOperation && restCols.length > 1
            ? [...rawCols.filter(c => c.id !== 'name' && c.id !== 'comment'), ...rawCols.filter(c => c.id === 'comment')]
            : restCols;
        const clsCol = this.showClassCol ? [{ id: 'cls', label: 'Группа', type: 'String', isGroupCol: true, stickyRight: true, minWidth: 170 }] : [];
        return this.isOperation
            ? [nameCol, { id: 'time', label: 'Дата', type: 'String', isDateCol: true, system: false, minWidth: 96 }, ...orderedCols, { id: 'state', label: 'Статус', type: 'String', minWidth: 96 }, ...clsCol]
            : [nameCol, ...orderedCols, ...clsCol];
    },
    /** Строки таблицы: названия вместо id ссылок, число строк табличной части, выжимка структуры, статус текстом; id сохраняется. */
    get tableRows() {
        const cols = this.columns || [];
        return (this.rows || []).map(r => {
            const out = { ...r };
            if (this.showClassCol) {
                const grp = this.groupLabelOf(r.cid);
                out.cls = grp;
                out.group = grp;
                const grpPath = (r.cid && this.classes?.[r.cid]?.path) || r.cid || '';
                if (grpPath)
                    Object.defineProperty(out, '_groupPath', { value: grpPath, enumerable: false, configurable: true });
            }
            let links = null;
            for (const c of cols) {
                const v = r[c.id];
                if (c.type === 'Link' && v) {
                    out[c.id] = this.names?.[v] || v;
                    (links ??= {})[c.id] = { id: v, target: c.catalog || '' };
                }
                else if (Array.isArray(v))
                    out[c.id] = v.length ? `${v.length} стр.` : '';
                else if (c.type === 'Struct' && v && typeof v === 'object')
                    out[c.id] = Object.values(v).filter(x => x !== undefined && x !== null && typeof x !== 'object' && String(x).trim() !== '').join(' ');
            }
            if (links)
                Object.defineProperty(out, '_links', { value: links, enumerable: false, configurable: true });
            if (this.isOperation)
                out.state = STATUS[r.status] || r.status || '';
            return out;
        });
    },
    /** Поля редактора: у операции первым — дата. */
    fieldList() {
        return (this.activeSchema?.FIELDS || this.schema?.FIELDS || []).filter(f => f?.id);
    },
    /** Значение для снимка: пустые null/undefined/'' эквивалентны. */
    _value(v) {
        if (v === undefined || v === null || v === '')
            return '';
        if (Array.isArray(v))
            return v.map(x => this._value(x));
        if (typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v).sort())
                out[k] = this._value(v[k]);
            return out;
        }
        return v;
    },
    /** Отпечаток только полей редактора: служебные id/status/version в dirty не входят. */
    fingerprint(data) {
        const out = {};
        for (const f of this.fieldList())
            out[f.id] = this._value(data?.[f.id]);
        return JSON.stringify(out);
    },
    /** Запомнить текущее состояние как чистое (открытие, сохранение, проведение). */
    snapshot() {
        this._snapshot = this.fingerprint(this.editing);
    },
    /** Есть ли несохранённые изменения относительно снимка. */
    isDirty() {
        return !!this.editing && this.fingerprint(this.editing) !== this._snapshot;
    },
    /** Собрать описание схемы для формы и колонок из ответа db_schema.schema. */
    _buildSchema(s) {
        const fields = (Array.isArray(s?.fields) ? s.fields : []).filter(f => f?.id && f.id !== 'time').map(formField);
        return {
            cid: s?.cid || '',
            path: s?.path || '',
            title: s?.label || '',
            family: s?.family || '',
            type: s?.type || '',
            leaf: !!s?.leaf,
            autoRegister: !!s?.autoRegister,
            POSTINGS: Array.isArray(s?.postings) ? s.postings : [],
            FIELDS: s?.family === 'operation' ? [DATE_FIELD, ...fields] : fields,
            columns: fields,
        };
    },
    /** Схема класса с учётом наследования: поля для колонок и редактора, правила проводок, семейство, поддерево. */
    async loadSchema() {
        const res = await this.$item?.fetch('db_schema');
        const built = this._buildSchema(res?.schema);
        this.columns = built.columns;
        this.leaves = Array.isArray(res?.leaves) ? res.leaves : [];
        this.classes = res?.classes && typeof res.classes === 'object' ? res.classes : {};
        this._hasServerDays = Array.isArray(res?.days);
        this.packetsDays = this._hasServerDays ? res.days : [];
        this.schema = {
            cid: built.cid,
            path: built.path,
            title: built.title,
            family: built.family,
            type: built.type,
            leaf: built.leaf,
            autoRegister: built.autoRegister,
            POSTINGS: built.POSTINGS,
            FIELDS: built.FIELDS,
        };
    },
    /** Элемент целевого класса-листа (при работе из группы); на самом листе или без WORK.get_item — $item. */
    async targetItem(cid = this.leafCid) {
        if (!cid || this.schema?.leaf || typeof WORK?.get_item !== 'function')
            return this.$item;
        const path = this.classes?.[cid]?.path || this.leaves?.find(l => l.cid === cid)?.path;
        if (!path)
            return this.$item;
        try {
            return (await WORK.get_item(path)) || this.$item;
        }
        catch {
            return this.$item;
        }
    },
    /** Загрузить схему выбранного листа в группе классов. */
    async loadLeafSchema(cid) {
        this.leafCid = cid || '';
        this.leafSchema = null;
        if (!cid || this.schema?.leaf)
            return;
        try {
            const target = await this.targetItem(cid);
            if (!target || target === this.$item)
                return;
            const res = await target.fetch('db_schema');
            if (res?.schema) {
                const b = this._buildSchema(res.schema);
                this.leafSchema = {
                    title: b.title,
                    family: b.family,
                    type: b.type,
                    leaf: b.leaf,
                    autoRegister: b.autoRegister,
                    POSTINGS: b.POSTINGS,
                    FIELDS: b.FIELDS,
                };
            }
        }
        catch {
            this.leafSchema = null;
        }
    },
    /** Сменить лист при создании объекта в группе классов. */
    async selectLeaf(cid) {
        await this.loadLeafSchema(cid);
        this.snapshot();
        if (this.isOperation)
            this.schedulePreview();
    },
    async attached() {
        if (this._attachedDone && !this._initialNav && !this._pendingNavId) {
            this.mountToolbarSlots();
            return;
        }
        const initNav = this._initialNav;
        this._initialNav = null;
        if (initNav?.id)
            this._pendingNavId = String(initNav.id);
        const savedLocalKey = typeof this.loadFromLocalStorage === 'function' ? this.loadFromLocalStorage('packetsKey') : undefined;
        if (typeof savedLocalKey === 'string' && savedLocalKey)
            this.packetsKey = savedLocalKey;
        this.mountToolbarSlots();
        try {
            await Promise.all([this.loadSchema(), this.loadScope()]);
        }
        catch (e) {
            this.error = String(e?.message || e);
            return;
        }
        // у операций строки грузит пакет (событие выбора периода), справочник — весь список сразу
        if (this.isOperation)
            await this.loadRange();
        else
            await this.reload();
        if (this._pendingNavId) {
            const id = this._pendingNavId;
            this._pendingNavId = '';
            await this.openEditor({ id });
        }
        this._attachedDone = true;
    },
    /** Переход из отчёта (журнал, карточка счёта, состав, траектория) сразу к объекту по id. */
    async applyNav(nav = {}) {
        if (!nav?.id)
            return;
        if (!this.schema) {
            this._pendingNavId = String(nav.id);
            return;
        }
        await this.openEditor({ id: String(nav.id) });
    },
    /** Видимые подразделения и места записи; без ответа — форма работает без выбора (сервер решит сам). */
    async loadScope() {
        try {
            const s = await this.$item?.fetch('db_scope');
            this.units = Array.isArray(s?.units) && !s.all ? s.units : [];
            this.contexts = Array.isArray(s?.contexts) ? s.contexts : [];
        }
        catch {
            this.units = [];
            this.contexts = [];
        }
    },
    /** Границы полосы: по реально существующим дням операций (db_schema.days) либо от первой до последней операции. */
    async loadRange() {
        if (!this.$item)
            return;
        if (Array.isArray(this.packetsDays) && this.packetsDays.length > 0) {
            const firstDay = this.packetsDays[0];
            const lastDay = this.packetsDays[this.packetsDays.length - 1];
            const today = _today();
            if (this.packetsKey === 'now' && !this.packetsDays.includes(today))
                this.packetsKey = '*';
            this.packetsStart = firstDay;
            this.packetsEnd = lastDay;
            return;
        }
        if (this._hasServerDays) {
            const today = _today();
            this.packetsStart = today;
            this.packetsEnd = today;
            return;
        }
        const edge = order => this.$item.fetch('db_query', { order, limit: 1 })
            .then(r => r?.items?.[0]?.time).catch(() => undefined);
        const [first, last] = await Promise.all([edge('time'), edge('-time')]);
        const today = _today();
        const lastDay = last ? _day(new Date(last)) : today;
        this.packetsEnd = lastDay > today ? lastDay : today;
        this.packetsStart = first ? _day(new Date(first)) : this.packetsEnd;
    },
    /**
     * Смена периода в пакете — единственный повод грузить строки операций заново.
     * Пакет шлёт selection-changed дважды: авто-событие пропа `selection`
     * (detail — массив выбранных единиц) и явное при смене выбора (detail — объект).
     * Учитываем только явное, иначе первая выборка ушла бы без границ.
     */
    async onPackets(e) {
        const d = e?.detail?.value ?? e?.detail ?? {};
        if (Array.isArray(d)) return;
        this.period = d.period || null;
        await this.reload();
    },
    /** Объект ядра → строка формы: поля тела, id, статус, версия; у операции — день даты; у группы — cid. */
    rowOf(o) {
        const b = o?.body || {};
        const row = { ...b, id: o.id, status: o.status, version: o.version };
        if (o?.cid)
            row.cid = o.cid;
        if (this.isOperation) {
            row.time = o.time ? _day(new Date(o.time)) : '';
            if (row.sum === undefined) {
                const fallbackSum = b.total ?? b.credited ?? b.saldo_26;
                if (fallbackSum !== undefined)
                    row.sum = fallbackSum;
            }
            if (!row.comment)
                row.comment = b.descript || b.base || b.reason || b.theme || b.subject || b.content || '';
        }
        if (!row.name) {
            const clsTitle = (o?.cid && this.classes?.[o.cid]?.label) || this.schema?.title || '';
            const numPart = b.num ? ` № ${b.num}` : '';
            const datePart = row.time ? ` от ${row.time}` : '';
            row.name = (clsTitle || b.num) ? `${clsTitle}${numPart}${datePart}`.trim() : (o?.id || '');
        }
        return row;
    },
    _reloadSeq: 0,
    async reload() {
        const seq = ++this._reloadSeq;
        this.rows = [];
        this.names = {};
        this.error = '';
        if (!this.$item)
            return;
        try {
            const params = { limit: this.pageSize || 200, order: '-time' };
            if (this.page > 1)
                params.offset = (this.page - 1) * (this.pageSize || 200);
            if (this.isOperation && this.period) {
                params.from = this.period.start;
                params.to = this.period.end;
            }
            if (this.unitFilter)
                params.unit = this.unitFilter;
            if (this.searchQuery)
                params.search = this.searchQuery;
            if (this.statusFilter)
                params.status = this.statusFilter;
            const where = {};
            for (const [k, v] of Object.entries(this.fieldFilters || {})) {
                if (v !== '' && v !== undefined && v !== null) {
                    const col = (this.columns || []).find(c => c.id === k);
                    where[k] = col?.type === 'Boolean' ? (v === '1' || v === 'true' ? 1 : 0) : v;
                }
            }
            if (Object.keys(where).length)
                params.where = JSON.stringify(where);
            const res = await this.$item.fetch('db_query', params);
            if (seq !== this._reloadSeq)
                return;
            this.names = res?.names || {};
            this.rows = (Array.isArray(res?.items) ? res.items : []).map(o => this.rowOf(o));
            this.total = Number(res?.total) || this.rows.length;
            // строки пересозданы: выделение возвращаем на открытый объект по id
            this.selectedRows = [];
            this.$?.('#objectsTable')?.clearSelection?.();
            this.focusedRow = this.tableRows.find(r => r.id === (this.editing?.id || this.focusedRow?.id)) ?? null;
            this.focusedItem = this.focusedRow?.id ? this.focusedRow : null;
            this._notifyForm();
        }
        catch (e) {
            if (seq !== this._reloadSeq)
                return;
            this.error = String(e?.message || e);
            this._notifyForm();
        }
    },
    async select(row) {
        if (!row?.id)
            return;
        this.error = '';
        try {
            const found = await this.$item.fetch('db_read', { id: row.id });
            if (found?.names && typeof found.names === 'object')
                this.names = { ...(this.names || {}), ...found.names };
            await this.loadLeafSchema(found?.cid || row.cid || '');
            this.editing = this.rowOf(found || { id: row.id });
            await this.loadEntries();
            await this.loadPrints();
            await this.loadTrajectory();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Состояние (остатки по счетам) и траектория движений объекта справочника (db_trajectory). */
    async loadTrajectory() {
        this.objectBalances = [];
        this.trajectory = [];
        this.trajectoryNames = { objects: {}, classes: {}, paths: {} };
        if (this.isOperation || !this.editing?.id || !this.$item)
            return;
        try {
            const res = await this.$item.fetch('db_trajectory', { id: this.editing.id, limit: 50 });
            if (!res)
                return;
            const names = { objects: {}, classes: {}, paths: {}, ...(res.names || {}) };
            this.trajectoryNames = names;
            const accText = cid => {
                const code = String(cid || '').split('/').pop().replace(/^acc\./, '');
                const label = names.classes?.[cid];
                return label && label !== code && !label.startsWith(code + ' ') ? `${code} ${label}` : (label || code);
            };
            this.objectBalances = (Array.isArray(res.closing) ? res.closing : []).map(b => ({
                account: b.account,
                slot: b.slot || '',
                label: accText(b.account),
                balance: saldo(b.debit, b.credit),
                qty: b.qty ? String(b.qty) : '',
            }));
            this.trajectory = (Array.isArray(res.items) ? res.items : []).map(i => {
                const title = names.objects?.[i.op_id];
                const op = (title && title !== i.op_id ? title : '') || names.classes?.[i.op_cid] || i.op_id || '';
                return {
                    date: i.time ? new Date(i.time).toLocaleDateString() : '',
                    op,
                    op_id: i.op_id || '',
                    op_cid: i.op_cid || '',
                    account: accText(i.account),
                    account_cid: i.account || '',
                    debit: money(i.debit),
                    credit: money(i.credit),
                    qty: i.qty ? String(i.qty) : '',
                    balance: saldo(i.balance > 0 ? i.balance : 0, i.balance < 0 ? -i.balance : 0),
                    storno: !!i.storno,
                };
            });
        }
        catch {
            this.objectBalances = [];
            this.trajectory = [];
        }
    },
    /** Печатные формы сохранённой операции; без ответа — кнопок печати нет. */
    async loadPrints() {
        this.printForms = [];
        if (!this.isOperation || !this.editing?.id)
            return;
        try {
            const target = await this.targetItem();
            const list = await target.fetch('db_print_list', { id: this.editing.id });
            this.printForms = Array.isArray(list) ? list : [];
        }
        catch {
            this.printForms = [];
        }
    },
    /** Открыть печатную форму в новом окне: окно создаётся сразу по клику, иначе браузер заблокирует его. */
    async printForm(name) {
        const win = window.open('', '_blank');
        if (!win)
            return this.error = 'Браузер заблокировал окно печати';
        try {
            const target = await this.targetItem();
            const res = await target.fetch('db_print', { id: this.editing.id, name });
            win.document.open();
            win.document.write(res?.html || '');
            win.document.close();
            win.focus();
        }
        catch (e) {
            win.close();
            this.error = String(e?.message || e);
        }
    },
    /** Проводки операции: проведённой — действующие, черновика — предпросмотр (ошибки правил — текстом). */
    async loadEntries() {
        this.entries = [];
        this.entryNames = { objects: {}, classes: {} };
        const op = this.editing;
        if (!this.hasPostings || !op?.id || op.status === 'cancelled')
            return;
        try {
            const target = await this.targetItem();
            if (op.status === 'registered')
                this.entries = await target.fetch('db_entries', { id: op.id }) || [];
            else {
                const p = await target.fetch('db_preview', { id: op.id });
                this.entryNames = p?.names || { objects: {}, classes: {} };
                this.entries = [...(p?.entries || []), ...(p?.errors || []).map(e => ({ error: (e.field ? e.field + ': ' : '') + e.message }))];
            }
        }
        catch (e) {
            this.entries = [{ error: String(e?.message || e) }];
        }
    },
    /** Предпросмотр проводок по несохранённому телу операции при вводе в форме. */
    async previewDraft() {
        const op = this.editing;
        if (!this.isOperation || !this.hasPostings || !op || op.status === 'registered' || op.status === 'cancelled')
            return;
        try {
            const target = await this.targetItem();
            const params = op.time ? { time: op.time } : {};
            const p = await target.fetch('db_preview', params, this.postData());
            this.entryNames = p?.names || { objects: {}, classes: {} };
            this.entries = [...(p?.entries || []), ...(p?.errors || []).map(e => ({ error: (e.field ? e.field + ': ' : '') + e.message }))];
        }
        catch (e) {
            this.entries = [{ error: String(e?.message || e) }];
        }
    },
    schedulePreview() {
        if (!this.isOperation || !this.hasPostings)
            return;
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => {
            if (this.editing && (!this.editing.id || this.status === 'draft'))
                this.previewDraft();
        }, 250);
    },
    /** Строка проводки в окне: «Дт 62 — Кт 90: 500», с названиями счетов и аналитик (если есть) и количеством. */
    entryText(e) {
        if (e?.error)
            return e.error;
        const side = (cid, an) => {
            const code = String(cid || '').split('/').pop().replace(/^acc\./, '');
            const label = this.entryNames?.classes?.[cid];
            const base = label && label !== code && !label.startsWith(code + ' ') ? `${code} ${label}` : (label || code);
            const objs = Object.values(an || {}).map(id => this.entryNames?.objects?.[id] || this.names?.[id] || id).filter(Boolean).join(', ');
            return objs ? `${base} (${objs})` : base;
        };
        const qty = e.qty ? ` (${e.doc_qty ?? e.qty}${e.doc_unit ? ' ' + e.doc_unit : ''})` : '';
        return `Дт ${side(e.debit, e.debit_analytics)} — Кт ${side(e.credit, e.credit_analytics)}: ${Number(e.amount || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}${qty}`;
    },
    /** Загрузить объект и открыть вьюху редактора (внутри work-form — на вкладке form/object, автономно — модально). */
    async openEditor(row) {
        if (!row?.id || this.editorOpen)
            return;
        const formHost = this._findFormHost();
        if (formHost && typeof formHost.openInForm === 'function') {
            const target = await this.targetItem(row.cid || '');
            await formHost.openInForm(target || this.$item, {
                view: 'object',
                id: row.id,
                leafCid: row.cid || '',
                label: row.name || row.title || row.id,
            });
            return;
        }
        this.editorOpen = true;
        this.editing = null;
        try {
            await this.select(row);
            if (this.editing)
                await this.showEditor();
        }
        finally {
            this.focusedRow = null;
            this.editorOpen = false;
        }
    },
    /**
     * Построить дерево подклассов промежуточного класса для диалога выбора конечной точки хранения.
     * В промежуточных классах объекты храниться не могут — они отображаются как серые узлы группировки,
     * а выбрать можно только конечный класс-лист (`leaf: true`).
     */
    buildClassTree() {
        const rawMap = new Map();
        const rootCid = this.schema?.cid || '';
        const rootPath = this.schema?.path || this.$item?.path || this.$item?.short || '';
        const defaultIcon = this.isOperation ? 'carbon:task-complete' : 'carbon:catalog';

        const rowCounts = new Map();
        for (const r of this.rows || []) {
            if (r?.cid)
                rowCounts.set(r.cid, (rowCounts.get(r.cid) || 0) + 1);
        }

        for (const c of Object.values(this.classes || {})) {
            if (!c?.cid)
                continue;
            rawMap.set(c.cid, {
                cid: c.cid,
                path: c.path || c.cid,
                parent: c.parent || '',
                label: c.label || c.cid.split('/').pop(),
                type: c.type || '',
                icon: c.icon || defaultIcon,
                leaf: !!c.leaf,
                count: Number(c.count) || rowCounts.get(c.cid) || 0,
                children: [],
                expanded: true,
            });
        }
        for (const l of this.leaves || []) {
            if (!l?.cid || rawMap.has(l.cid))
                continue;
            rawMap.set(l.cid, {
                cid: l.cid,
                path: l.path || l.cid,
                parent: l.parent || '',
                label: l.label || l.cid.split('/').pop(),
                type: this.schema?.type || '$catalog',
                icon: l.icon || defaultIcon,
                leaf: true,
                count: Number(l.count) || 0,
                children: [],
                expanded: true,
            });
        }

        // Определим корневой узел открытого промежуточного класса
        let rootNode = (rootCid && rawMap.get(rootCid))
            || (rootPath && [...rawMap.values()].find(n => n.path === rootPath))
            || [...rawMap.values()].find(n => !n.leaf && (!n.parent || !rawMap.has(n.parent)))
            || null;
        const effectiveRootCid = rootNode?.cid || rootCid;
        const effectiveRootPath = rootNode?.path || rootPath;

        const byPath = new Map();
        for (const n of rawMap.values()) {
            if (n.path)
                byPath.set(n.path, n);
        }

        // Привяжем каждого потомка к ближайшему родителю (или синтезируем промежуточные папки по пути)
        const roots = [];
        for (const node of [...rawMap.values()]) {
            if (node.cid === effectiveRootCid || (effectiveRootPath && node.path === effectiveRootPath))
                continue;
            if (node.type === '$virtual')
                continue;
            let parentNode = node.parent && node.parent !== effectiveRootCid ? rawMap.get(node.parent) : null;
            if (!parentNode && effectiveRootPath && node.path && node.path.startsWith(effectiveRootPath + '/')) {
                const rel = node.path.slice(effectiveRootPath.length + 1).split('/').filter(Boolean);
                let curPath = effectiveRootPath;
                let curParent = null;
                for (let i = 0; i < rel.length - 1; i++) {
                    curPath += '/' + rel[i];
                    let mid = byPath.get(curPath);
                    if (!mid) {
                        mid = {
                            cid: curPath,
                            path: curPath,
                            parent: curParent?.cid || effectiveRootCid,
                            label: rel[i],
                            type: this.schema?.type || '$catalog',
                            icon: defaultIcon,
                            leaf: false,
                            count: 0,
                            children: [],
                            expanded: true,
                        };
                        rawMap.set(mid.cid, mid);
                        byPath.set(curPath, mid);
                        if (curParent)
                            curParent.children.push(mid);
                        else
                            roots.push(mid);
                    }
                    curParent = mid;
                }
                parentNode = curParent;
            }
            if (parentNode && parentNode !== node) {
                if (!parentNode.children.includes(node))
                    parentNode.children.push(node);
            }
            else if (!roots.includes(node)) {
                roots.push(node);
            }
        }

        // Оставляем только ветки, ведущие хотя бы к одному конечному листу хранения, и сортируем
        const pruneAndSort = (list) => {
            const kept = [];
            for (const n of list) {
                n.children = pruneAndSort(n.children || []);
                if (n.leaf || n.children.length > 0)
                    kept.push(n);
            }
            kept.sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'ru', { numeric: true }));
            return kept;
        };
        return pruneAndSort(roots);
    },
    /** Открыть модальное окно выбора конечного класса хранения перед созданием объекта из промежуточного класса. */
    async pickTargetLeafClass() {
        const tree = this.buildClassTree();
        if (!tree.length)
            return '';
        const classTitle = this.schema?.title || this.$item?.DATA?.label || this.$item?.label || this.$item?.id || '';
        const dialogTitle = `Выберите класс для создания объекта '${classTitle}'`;
        const picker = ODA.createComponent('item-class-picker', {
            treeNodes: tree,
            selectedCid: '',
        });
        try {
            await WORK.showModal(picker, {
                TITLE: { label: dialogTitle },
                allowClose: true,
                width: Math.min(580, (window.innerWidth || 640) - 32),
            });
            return picker.confirmedCid || '';
        }
        catch {
            return '';
        }
    },
    /** Новый объект — если вызван на промежуточном классе, сначала предлагаем выбрать конечный класс-лист хранения. */
    async create() {
        if (this.editorOpen)
            return;
        if (!this.schema)
            await this.loadSchema().catch(() => {});
        let chosenCid = '';
        if (!this.schema?.leaf) {
            if (!this.leaves?.length)
                return;
            if (typeof WORK?.showModal === 'function' && typeof document !== 'undefined') {
                chosenCid = await this.pickTargetLeafClass();
                if (!chosenCid)
                    return;
            }
            else {
                chosenCid = this.leafCid || this.leaves[0].cid;
            }
        }
        const formHost = this._findFormHost();
        if (formHost && typeof formHost.openInForm === 'function') {
            const target = chosenCid ? await this.targetItem(chosenCid) : this.$item;
            const leafLabel = chosenCid ? (this.classes?.[chosenCid]?.label || this.leaves?.find(l => l.cid === chosenCid)?.label || '') : '';
            const title = leafLabel || this.schema?.title || 'Объект';
            await formHost.openInForm(target || this.$item, {
                view: 'object',
                create: true,
                leafCid: chosenCid || '',
                label: `${title} · новый объект`,
            });
            return;
        }
        if (chosenCid) {
            this.editorOpen = true;
            await this.loadLeafSchema(chosenCid);
        }
        else {
            this.editorOpen = true;
            this.leafCid = '';
            this.leafSchema = null;
        }
        this.editing = this.isOperation ? { time: _today() } : {};
        this.entries = [];
        this.entryNames = { objects: {}, classes: {} };
        this.objectBalances = [];
        this.trajectory = [];
        this.printForms = [];
        this.clearError();
        try {
            await this.showEditor();
        }
        finally {
            this.focusedRow = null;
            this.editorOpen = false;
        }
    },
    /** Клонирование выбранного объекта: открывает окно создания нового объекта с заполненными полями оригинала. */
    async copyRow(row = this.focusedRow) {
        if (!row?.id || this.editorOpen || !this.canCreate)
            return;
        const formHost = this._findFormHost();
        if (formHost && typeof formHost.openInForm === 'function') {
            const target = await this.targetItem(row.cid || '');
            await formHost.openInForm(target || this.$item, {
                view: 'object',
                copyFrom: row.id,
                leafCid: row.cid || '',
                label: `${row.name || 'Объект'} (копия)`,
            });
            return;
        }
        this.editorOpen = true;
        this.clearError();
        try {
            const found = await this.$item.fetch('db_read', { id: row.id });
            if (found?.names && typeof found.names === 'object')
                this.names = { ...(this.names || {}), ...found.names };
            await this.loadLeafSchema(found?.cid || row.cid || '');
            const baseBody = { ...(found?.body || {}) };
            delete baseBody.id;
            delete baseBody.version;
            delete baseBody.status;
            this.editing = this.isOperation ? { ...baseBody, time: _today() } : baseBody;
            this.entries = [];
            this.entryNames = { objects: {}, classes: {} };
            this.objectBalances = [];
            this.trajectory = [];
            this.printForms = [];
            await this.showEditor();
        }
        catch (e) {
            this.setError(e);
        }
        finally {
            this.editorOpen = false;
        }
    },
    /** Удаление выбранного объекта или списка объектов (при множественном выборе с allowList) из тулбара. */
    async deleteRow(target = this.activeSelection) {
        const list = (Array.isArray(target) ? target : (target?.id ? [target] : this.activeSelection))
            .filter(r => this.canDeleteRow(r));
        if (!list.length || this.busy)
            return;
        this.busy = true;
        this.clearError();
        try {
            for (const row of list) {
                const item = await this.targetItem(row.cid || '');
                await item.fetch('db_delete', { id: row.id });
            }
            this.selectedRows = [];
            this.focusedRow = null;
            this.focusedItem = null;
            this.$?.('#objectsTable')?.clearSelection?.();
            await this.reload();
        }
        catch (e) {
            this.setError(e);
        }
        finally {
            this.busy = false;
        }
    },
    /** Только поля схемы (без даты операции — она уходит параметром); пустые строки таблиц отбрасываются. */
    postData() {
        // editing — та же data, в которую пишет форма: снимок form.result может отставать
        const fields = this.fieldList().filter(f => f.id !== DATE_FIELD.id || !this.isOperation);
        const byId = new Map(fields.map(f => [f.id, f]));
        const out = {};
        for (const [k, v] of Object.entries(this.editing || {})) {
            const f = byId.get(k);
            if (!f)
                continue;
            if (f.type === 'Table' && Array.isArray(v))
                out[k] = v.filter(isNonEmptyRow);
            else if (f.type === 'File' && v && typeof v === 'object')
                out[k] = v.path || v.name || String(v);
            else
                out[k] = v;
        }
        return out;
    },
    /** Загрузить выбранные в контролах File файлы на сервер перед сохранением объекта. */
    async uploadFiles(target) {
        if (!this.editing || typeof this.editing !== 'object')
            return;
        for (const f of this.fieldList()) {
            if (f.type !== 'File')
                continue;
            const val = this.editing[f.id];
            if (!val || typeof val === 'string')
                continue;
            const fileObj = Array.isArray(val) ? val[0] : val;
            if (!fileObj)
                continue;
            if (typeof target?.save_file === 'function' && typeof File !== 'undefined' && fileObj instanceof File) {
                const saved = await target.save_file(fileObj);
                this.editing[f.id] = saved?.path || saved?.id || fileObj.name;
            }
            else {
                this.editing[f.id] = fileObj.path || fileObj.name || String(fileObj);
            }
        }
    },
    /** Параметры записи: id и версия (защита от чужой правки), дата операции; у нового — место записи. */
    writeParams(extra = {}) {
        const p = { ...extra };
        if (this.editing?.id) {
            p.id = this.editing.id;
            if (this.editing.version)
                p.version = this.editing.version;
        }
        else if (this.showContext && this.context) {
            p.unit = this.context.unit;
            if (this.context.place)
                p.place = this.context.place;
        }
        if (this.isOperation && this.editing?.time)
            p.time = this.editing.time;
        return p;
    },
    /** Ответ записи: id, статус и версия — для следующего действия в том же окне. */
    accept(res) {
        if (res?.id && this.editing)
            Object.assign(this.editing, { id: res.id, status: res.status, version: res.version });
    },
    hasPendingUploads() {
        if (!this.editing || typeof this.editing !== 'object' || typeof File === 'undefined')
            return false;
        for (const f of this.fieldList()) {
            if (f.type !== 'File')
                continue;
            const val = this.editing[f.id];
            const fileObj = Array.isArray(val) ? val[0] : val;
            if (fileObj instanceof File)
                return true;
        }
        return false;
    },
    async save() {
        if (this.busy || !this.canSave)
            return false;
        this.busy = true;
        this.clearError();
        try {
            if (this.hasPendingUploads()) {
                const t = await this.targetItem();
                await this.uploadFiles(t);
            }
            const data = this.postData();
            // снимок отправленного, а не текущего: ввод во время запроса остаётся dirty
            const saved = this.fingerprint({ ...data, time: this.editing.time });
            const target = await this.targetItem();
            let res;
            if (!this.editing.id)
                res = await target.fetch('db_create', this.writeParams(), data);
            else if (this.status === 'registered')
                res = await target.fetch('db_correct', this.writeParams({ replace: true }), data);
            else
                res = await target.fetch('db_update', this.writeParams({ replace: true }), data);
            this.accept(res);
            this._snapshot = saved;
            // внутри окна список обновит его закрытие; внешняя кнопка — сразу
            if (!this.editorOpen && !this.isObjectView)
                await this.reload();
            return true;
        }
        catch (e) {
            this.setError(e);
            return false;
        }
        finally {
            this.busy = false;
        }
    },
    /** Подтверждение действия; отмена диалога — false. */
    async confirm(text, title, ok) {
        try {
            await WORK.showConfirm(text, {
                TITLE: { label: title },
                OK: ok,
                CANCEL: { label: 'Отмена', icon: 'icons:close', colorMode: 'info' },
            });
            return true;
        }
        catch {
            return false;
        }
    },
    /** Удалить редактируемый объект (имя не remove — не затенять Element.remove). */
    async removeObject() {
        if (this.busy || !this.canRemove)
            return false;
        // подтверждение — часть операции: пока оно открыто, окно не закрыть
        this.busy = true;
        try {
            if (!await this.confirm('Удалить объект?', 'Удаление', { label: 'Удалить', icon: 'icons:delete', colorMode: 'error' }))
                return false;
            this.error = '';
            const target = await this.targetItem();
            await target.fetch('db_delete', this.writeParams());
            this.snapshot();
            if (!this.editorOpen && !this.isObjectView)
                await this.reload();
            return true;
        }
        catch (e) {
            this.error = String(e?.message || e);
            return false;
        }
        finally {
            this.busy = false;
        }
    },
    /** Восстановить удалённый объект справочника (db_restore). */
    async restoreObject() {
        if (this.busy || !this.canRestore)
            return false;
        this.busy = true;
        this.error = '';
        try {
            const target = await this.targetItem();
            const res = await target.fetch('db_restore', { id: this.editing.id });
            this.accept(res || { id: this.editing.id, status: 'active', version: this.editing.version });
            this.snapshot();
            if (!this.editorOpen && !this.isObjectView)
                await this.reload();
            else if (this.isObjectView)
                await this._findFormHost()?.reloadSiblingLists?.();
            return true;
        }
        catch (e) {
            this.error = String(e?.message || e);
            return false;
        }
        finally {
            this.busy = false;
        }
    },
    /** Провести: несохранённое (и новый объект) сначала сохраняется. */
    async post() {
        if (this.busy || !this.canRegister)
            return false;
        if ((!this.editing.id || this.isDirty()) && !await this.save())
            return false;
        this.busy = true;
        this.clearError();
        try {
            const target = await this.targetItem();
            const res = await target.fetch('db_register', this.writeParams());
            this.accept(res);
            await this.select({ id: this.editing.id });
            this.focusedItem = this.editing || this.focusedItem;
            this.snapshot();
            if (!this.isObjectView)
                await this.reload();
            else
                await this._findFormHost()?.reloadSiblingLists?.();
            return true;
        }
        catch (e) {
            this.setError(e);
            return false;
        }
        finally {
            this.busy = false;
        }
    },
    /** Отменить проведённую операцию: сторно всех проводок. */
    async cancelOperation() {
        if (this.busy || !this.canCancel)
            return false;
        this.busy = true;
        this.error = '';
        try {
            if (!await this.confirm('Отменить операцию? Её проводки будут сторнированы.', 'Отмена операции',
                { label: 'Отменить операцию', icon: 'icons:block', colorMode: 'error' }))
                return false;
            const target = await this.targetItem();
            const res = await target.fetch('db_cancel', this.writeParams());
            this.accept(res);
            await this.select({ id: this.editing.id });
            this.focusedItem = this.editing || this.focusedItem;
            this.snapshot();
            if (!this.isObjectView)
                await this.reload();
            else
                await this._findFormHost()?.reloadSiblingLists?.();
            return true;
        }
        catch (e) {
            this.error = String(e?.message || e);
            return false;
        }
        finally {
            this.busy = false;
        }
    },
    /** Открыть карточку счёта по строке остатка объекта справочника. */
    async openBalanceAccount(b) {
        const path = this.trajectoryNames?.paths?.[b?.account] || b?.account;
        if (!path)
            return;
        const nav = { view: 'postings' };
        if (b.slot && this.editing?.id)
            nav.filters = { [b.slot]: this.editing.id };
        try {
            const t = await WORK.get_item(path);
            if (t && window.execute)
                window.execute(t, nav);
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Открыть операцию из траектории объекта справочника. */
    async openTrajectoryOp(item) {
        const path = this.trajectoryNames?.paths?.[item?.op_cid] || item?.op_cid;
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (t && window.execute)
                window.execute(t, item?.op_id ? { view: 'objects', id: item.op_id } : undefined);
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Окно редактора и единый guard закрытия: dirty/busy не пропускают close дальше. */
    async showEditor() {
        // «Создать» доступна до ответа схемы: иначе окно откроется с пустой формой и без имени класса
        if (!this.schema)
            await this.loadSchema().catch(() => {});
        this.snapshot();
        let unguard = () => {};
        try {
            const el = ODA.createComponent('item-object-editor', { owner: this });
            unguard = this.guardClose(el);
            await WORK.showModal(el, {
                TITLE: { label: this.editorTitle },
                allowClose: true,
                width: Math.min(720, window.innerWidth || 720),
            });
        }
        catch (e) {
            if (!(WORK.CancelError && e instanceof WORK.CancelError))
                this.error = String(e?.message || e);
        }
        finally {
            clearTimeout(this._previewTimer);
            unguard();
            this.editing = null;
            this.entries = [];
            this.objectBalances = [];
            this.trajectory = [];
            this.leafCid = '';
            this.leafSchema = null;
            await this.reload();
        }
    },
    /**
     * Capture-слушатель close: событие всплывает и composed, поэтому документ видит его
     * раньше платформенного слушателя на popover. Dirty/busy останавливаем и решаем судьбу окна.
     */
    guardClose(el) {
        let pop = null;
        let bypass = false;
        let checking = false;
        const onClose = (e) => {
            const target = e.target;
            if (!target?.contains?.(el))
                return;
            pop = target;
            if (bypass)
                return;
            if (this.busy) {
                e.stopImmediatePropagation();
                return;
            }
            if (!this.isDirty())
                return;
            e.stopImmediatePropagation();
            if (checking)
                return;
            checking = true;
            // крестик закрывает по pointerdown: промпт открываем после текущего события
            setTimeout(async () => {
                try {
                    if (!await this.confirmClose())
                        return;
                    if (!pop?.isConnected)
                        return;
                    bypass = true;
                    pop.close('');
                }
                catch { /* не закрываем: окно остаётся открытым */ }
                finally {
                    checking = false;
                }
            }, 0);
        };
        document.addEventListener('close', onClose, true);
        return () => document.removeEventListener('close', onClose, true);
    },
    /** Да — сохранить и закрыть; Нет — не сохранять и закрыть; Отмена/X/Esc/Enter — остаться. */
    async confirmClose() {
        const text = ODA.createElement('p', {
            textContent: 'Сохранить перед закрытием?',
            style: 'margin: var(--space-l);',
        });
        let result;
        try {
            result = await WORK.showDialog(text, {
                TITLE: { label: 'Закрытие' },
                allowClose: true,
                OK: null,
                BUTTONS: [
                    { label: 'Да', icon: 'icons:check', colorMode: 'success' },
                    { label: 'Нет', icon: 'icons:close', colorMode: 'error' },
                ],
                CANCEL: { label: 'Отмена', icon: 'icons:close', colorMode: 'info' },
            });
        }
        catch {
            return false;
        }
        if (result === 1)
            return await this.save();
        return result === 2;
    },
};

/**
 * item-object-editor — содержимое модального окна: форма, проводки, состояние/траектория, ошибка и действия.
 * Бизнес-методы остаются на handler'е; компонент только связывает их с разметкой.
 */
ODA({
    is: 'item-object-editor',
    imports: '/oda/components/button/button.js, /oda/components/layouts/editor-form/editor-form.js',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            overflow: hidden;
        }
        oda-editor-form {
            flex: 1;
        }
        .error {
            color: var(--error-color);
            white-space: break-spaces;
            padding: 0 var(--space-m);
        }
        .entries {
            @apply --vertical;
            gap: 2px;
            padding: 0 var(--space-m);
            font-size: smaller;
            opacity: .8;
        }
        .trajectory {
            @apply --vertical;
            gap: 4px;
            padding: var(--space-s) var(--space-m);
            max-height: 180px;
            overflow-y: auto;
            font-size: smaller;
            border-top: 1px solid var(--border-color, #ddd);
        }
        .trajectory-title {
            font-weight: bold;
            opacity: .85;
        }
        .traj-row {
            @apply --horizontal;
            gap: 8px;
            align-items: center;
        }
        .traj-link {
            cursor: pointer;
            text-decoration: underline;
        }
        .traj-num {
            margin-left: auto;
            text-align: right;
        }
        .bar {
            @apply --horizontal;
            flex-wrap: wrap;
            gap: var(--space-s);
            padding: var(--space-m);
        }
        .context {
            @apply --horizontal;
            align-items: center;
            gap: var(--space-s);
            padding: var(--space-m) var(--space-m) 0;
        }
    </style>
    <label class="context" ~if="owner.showContext && !owner.editing?.id">От места
        <select @change="owner.contextKey = $this.value">
            <option ~for="owner.contexts" :value="owner.contextKeyOf($for.item)"
                :selected="owner.contextKeyOf($for.item) === owner.contextKeyOf(owner.context)">{{owner.contextTitle($for.item)}}</option>
        </select>
    </label>
    <oda-editor-form :metadata="owner.activeSchema" :data="owner.editing" :field-errors="owner.fieldErrors" @input="onFormInput" @change="onFormInput" @cell-changed="onFormInput"></oda-editor-form>
    <div class="entries" ~if="owner.entries?.length">
        <div class="entry" ~for="owner.entries">{{owner.entryText($for.item)}}</div>
    </div>
    <div class="trajectory" ~if="owner.objectBalances?.length || owner.trajectory?.length">
        <div class="trajectory-title" ~if="owner.objectBalances?.length">Остатки по счетам</div>
        <div class="traj-row" ~for="owner.objectBalances">
            <span class="traj-link" @tap="openBalance($for.item)">{{$for.item.label}}</span>
            <span class="traj-num">{{$for.item.balance}}{{$for.item.qty ? ' (' + $for.item.qty + ')' : ''}}</span>
        </div>
        <div class="trajectory-title" ~if="owner.trajectory?.length">Движения ({{owner.trajectory.length}})</div>
        <div class="traj-row" ~for="owner.trajectory">
            <span>{{$for.item.date}}</span>
            <span class="traj-link" @tap="openTrajOp($for.item)">{{$for.item.op}}</span>
            <span>{{$for.item.account}}</span>
            <span class="traj-num">{{$for.item.debit ? '+' + $for.item.debit : ($for.item.credit ? '−' + $for.item.credit : $for.item.qty)}} → {{$for.item.balance}}</span>
        </div>
    </div>
    <div class="error" ~if="owner.error">{{owner.error}}</div>
    <div class="bar" no-flex>
        <oda-button ~if="owner.canSave" icon="editor:save" :disabled="owner.busy" @tap="save">Сохранить</oda-button>
        <oda-button ~if="owner.canRemove" icon="icons:delete" :disabled="owner.busy"
            @tap="removeObject">Удалить</oda-button>
        <oda-button ~if="owner.canRestore" icon="icons:restore" :disabled="owner.busy"
            @tap="restoreObject">Восстановить</oda-button>
        <oda-button ~if="owner.canRegister" :disabled="owner.busy" @tap="post">Провести</oda-button>
        <oda-button ~if="owner.canCancel" :disabled="owner.busy" @tap="cancelOperation">Отменить</oda-button>
        <oda-button ~for="owner.printForms" icon="icons:print" :title="$for.item.label" @tap="printForm($for.item.name)">{{$for.item.label}}</oda-button>
        <oda-button icon="icons:close" :disabled="owner.busy" @tap="close">Закрыть</oda-button>
    </div>
    `,
    owner: null,
    attached() {
        // после первого рендера формы: контролы могли нормализовать значения
        this.async(() => {
            if (this.isConnected)
                this.owner?.snapshot?.();
        });
    },
    onFormInput() {
        if (this.owner && this.owner.fieldErrors && Object.keys(this.owner.fieldErrors).length)
            this.owner.fieldErrors = {};
        this.owner?.schedulePreview?.();
    },
    async save() {
        if (await this.owner.save())
            this.close();
    },
    async removeObject() {
        if (await this.owner.removeObject())
            this.close();
    },
    async restoreObject() {
        if (await this.owner.restoreObject())
            this.close();
    },
    async post() {
        await this.owner.post();
    },
    async cancelOperation() {
        await this.owner.cancelOperation();
    },
    async printForm(name) {
        await this.owner.printForm(name);
    },
    async openBalance(b) {
        const owner = this.owner;
        this.close();
        await owner?.openBalanceAccount?.(b);
    },
    async openTrajOp(item) {
        const owner = this.owner;
        this.close();
        await owner?.openTrajectoryOp?.(item);
    },
    close() {
        this.parentElement?.close?.();
    },
});

/**
 * item-class-picker — диалог выбора конечного класса хранения при вызове «Новый» на промежуточном классе.
 * Промежуточные классы в дереве отображаются приглушёнными (в них объекты храниться не могут),
 * а выбрать и подтвердить кнопкой «OK» (или двойным кликом) можно только конечный класс-лист.
 */
ODA({
    is: 'item-class-picker',
    imports: '/oda/components/button/button.js, /oda/components/icon/icon.js',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            padding: 12px 14px;
            gap: 12px;
            box-sizing: border-box;
            background: light-dark(#ffffff, #1e1f24);
            color: light-dark(#1f2937, #e5e7eb);
        }
        .tree-box {
            @apply --vertical;
            min-height: 320px;
            max-height: 62vh;
            overflow: auto;
            border: 1px solid light-dark(#cbd5e1, #3a3b42);
            background: light-dark(#ffffff, #18191d);
            padding: 8px 10px;
            box-sizing: border-box;
        }
        .tree-row {
            @apply --horizontal;
            align-items: center;
            min-height: 28px;
            padding: 2px 6px;
            border-radius: 3px;
            user-select: none;
            gap: 6px;
            white-space: nowrap;
        }
        .tree-row.leaf {
            cursor: pointer;
        }
        .tree-row.leaf:hover:not([selected]) {
            background: light-dark(#f1f5f9, #272930);
        }
        .tree-row[selected] {
            background: var(--selected-background, #3b82f6);
            color: var(--selected-color, #ffffff);
        }
        .indent-guide {
            display: inline-block;
            width: 18px;
            height: 26px;
            border-left: 1px dotted light-dark(#94a3b8, #4b5563);
            flex-shrink: 0;
        }
        .expander {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 13px;
            height: 13px;
            border: 1px solid light-dark(#94a3b8, #64748b);
            background: light-dark(#f8fafc, #272930);
            color: light-dark(#334155, #cbd5e1);
            font-size: 11px;
            line-height: 1;
            cursor: pointer;
            flex-shrink: 0;
            margin-right: 2px;
        }
        .expander-spacer {
            display: inline-block;
            width: 15px;
            flex-shrink: 0;
        }
        .node-icon {
            flex-shrink: 0;
            color: light-dark(#d97706, #fbbf24);
        }
        .tree-row[selected] .node-icon {
            color: inherit;
        }
        .node-label {
            font-size: 13px;
        }
        .tree-row.group .node-label {
            color: light-dark(#8a8a8a, #787c88);
        }
        .node-count {
            font-size: 12.5px;
            color: light-dark(#8a8a8a, #94a3b8);
            margin-left: 4px;
        }
        .tree-row[selected] .node-count {
            color: inherit;
            opacity: 0.9;
        }
        .footer-bar {
            @apply --horizontal;
            justify-content: flex-end;
            align-items: center;
            gap: 8px;
        }
        button.dlg-btn {
            @apply --content;
            @apply --border;
            @apply --hoverable;
            min-width: 78px;
            padding: 3px 12px;
            font-size: small;
            font-family: inherit;
            border-radius: 0;
            cursor: pointer;
        }
        button.dlg-btn:disabled {
            opacity: 0.45;
            cursor: default;
        }
    </style>
    <div class="tree-box">
        <div ~for="flatRows"
            :class="'tree-row ' + ($for.item.node.leaf ? 'leaf' : 'group')"
            :selected="$for.item.node.leaf && selectedCid === $for.item.node.cid"
            @tap="onRowTap($for.item.node, $event)"
            @dblclick="onRowDblClick($for.item.node, $event)">
            <span class="indent-guide" ~for="$for.item.guides"></span>
            <span class="expander" ~if="$for.item.node.children?.length" @tap.stop="toggleNode($for.item.node)">{{$for.item.node.expanded ? '−' : '+'}}</span>
            <span class="expander-spacer" ~if="!$for.item.node.children?.length"></span>
            <oda-icon class="node-icon" :icon="$for.item.node.icon || 'carbon:catalog'" icon-size="20"></oda-icon>
            <span class="node-label">{{$for.item.node.label}}</span>
            <span class="node-count" ~if="$for.item.node.leaf && $for.item.node.count > 0">({{$for.item.node.count}})</span>
        </div>
    </div>
    <div class="footer-bar">
        <button type="button" class="dlg-btn" :disabled="!selectedCid" @tap="confirmPick">OK</button>
        <button type="button" class="dlg-btn" @tap="cancelPick">Отмена</button>
    </div>
    `,
    treeNodes: [],
    selectedCid: '',
    confirmedCid: '',
    treeVersion: 0,
    get flatRows() {
        void this.treeVersion;
        const out = [];
        const walk = (list, level) => {
            for (const node of list || []) {
                const guides = Array.from({ length: level }, (_, i) => i);
                out.push({ node, level, guides });
                if (node.expanded && node.children?.length)
                    walk(node.children, level + 1);
            }
        };
        walk(this.treeNodes, 0);
        return out;
    },
    toggleNode(node) {
        if (!node)
            return;
        node.expanded = !node.expanded;
        this.treeVersion++;
        this.render?.(true);
    },
    onRowTap(node) {
        if (!node)
            return;
        if (node.leaf) {
            this.selectedCid = node.cid;
        }
        else {
            this.selectedCid = '';
        }
        this.render?.(true);
    },
    onRowDblClick(node) {
        if (!node)
            return;
        if (node.leaf) {
            this.selectedCid = node.cid;
            this.confirmPick();
        }
        else if (node.children?.length) {
            this.toggleNode(node);
        }
    },
    confirmPick() {
        if (!this.selectedCid)
            return;
        this.confirmedCid = this.selectedCid;
        this.parentElement?.close?.('ok');
    },
    cancelPick() {
        this.confirmedCid = '';
        this.parentElement?.close?.('');
    },
});
