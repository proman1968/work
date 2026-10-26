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
    date: 'Date', datetime: 'DateTime', link: 'Link', struct: 'Struct', table: 'Table', enum: 'Select', file: 'String',
};
const STATUS = { draft: 'черновик', registered: 'проведена', cancelled: 'отменена', deleted: 'удалена' };
const DATE_FIELD = Object.freeze({ id: 'time', label: 'Дата', type: 'Date', required: true });

/** Поле схемы ядра → поле редактора: тип, справочник ссылки, варианты, вложенные поля структуры и колонки табличной части. */
function formField(f) {
    const out = { id: f.id, label: f.label || f.id, type: TYPES[f.type] || 'String' };
    if (f.required)
        out.required = true;
    if (f.type === 'link')
        out.catalog = f.targetPath || f.target;
    if (f.type === 'enum')
        out.options = (f.values || f.options || []).map(v => (v && typeof v === 'object'
            ? { value: String(v.id ?? v.value), label: String(v.label ?? v.id ?? v.value) }
            : { value: String(v), label: String(v) }));
    if (f.type === 'struct')
        out.children = (f.fields || []).map(formField);
    if (f.type === 'table')
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
    imports: 'oda//button, oda//packets, oda//table, ~/lib//editor-form',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            gap: 8px;
            padding: 8px;
            overflow: hidden;
        }
        .body {
            @apply --horizontal;
            flex: 1;
            gap: 8px;
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
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .bar input.search {
            min-width: 140px;
            padding: 4px 8px;
            border: 1px solid var(--border-color, #ccc);
            border-radius: 4px;
        }
        .pager {
            @apply --horizontal;
            gap: 4px;
            align-items: center;
            margin-left: auto;
            font-size: small;
        }
        .error {
            color: var(--error-color);
            white-space: break-spaces;
        }
    </style>
    <oda-packets no-flex mode="day" ~if="packetsStart && isOperation"
        :start="packetsStart" :end="packetsEnd"
        ::value="packetsKey" @selection-changed="onPackets($event)"></oda-packets>
    <div class="body">
        <div class="list">
            <div class="bar">
                <oda-button ~if="canCreate" icon="icons:plus" @tap="create">Создать</oda-button>
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
                <div class="pager" ~if="total > pageSize || page > 1">
                    <span>{{pageText}}</span>
                    <oda-button ~if="page > 1" icon="icons:chevron-left" title="Предыдущая страница" @tap="setPage(page - 1)"></oda-button>
                    <oda-button ~if="page * pageSize < total" icon="icons:chevron-right" title="Следующая страница" @tap="setPage(page + 1)"></oda-button>
                </div>
            </div>
            <div class="error" ~if="error && !editorOpen">{{error}}</div>
            <oda-table allow-focus readonly ::focused-row="focusedRow" :metadata="tableMetadata" :data-set="tableRows"
                :$save-key="$item?.short"></oda-table>
        </div>
    </div>
    `,
    rows: [],
    columns: [],
    schema: null,
    /** листья поддерева для создания объектов в группе (db_schema.leaves): [{ cid, path, label }] */
    leaves: [],
    /** описание классов поддерева (db_schema.classes): cid → { cid, path, label, leaf } */
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
    $observers: {
        /** клик по строке таблицы открывает объект; пока окно открыто — второй не нужен */
        select(focusedRow) {
            if (focusedRow?.id && !this.editorOpen)
                this.openEditor(focusedRow);
        }
    },
    /** id объекта → название (ссылки в строках списка) */
    names: {},
    error: '',
    /** Ключ выбранного пакета: 'now' | '*' | маска единицы | 'period:start:end'. */
    packetsKey: { $def: 'now', $type: String, $save: true },
    packetsStart: '',
    packetsEnd: '',
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
    /** Колонки таблицы: у операций — дата и статус, у группы — вид/операция; ссылки показываются названиями (текстом). */
    get tableMetadata() {
        const cols = (this.columns || []).map(c => (c.type === 'Link' || c.type === 'Table' || c.type === 'Struct' ? { ...c, type: 'String' } : c));
        const clsCol = this.showClassCol ? [{ id: 'cls', label: this.isOperation ? 'Операция' : 'Вид', type: 'String' }] : [];
        return this.isOperation
            ? [{ id: 'time', label: 'Дата' }, ...clsCol, ...cols, { id: 'state', label: 'Статус' }]
            : [...clsCol, ...cols];
    },
    /** Строки таблицы: названия вместо id ссылок, число строк табличной части, выжимка структуры, статус текстом; id сохраняется. */
    get tableRows() {
        const cols = this.columns || [];
        return (this.rows || []).map(r => {
            const out = { ...r };
            if (this.showClassCol)
                out.cls = this.classes?.[r.cid]?.label || r.cid || '';
            for (const c of cols) {
                const v = r[c.id];
                if (c.type === 'Link' && v)
                    out[c.id] = this.names?.[v] || v;
                else if (Array.isArray(v))
                    out[c.id] = v.length ? `${v.length} стр.` : '';
                else if (c.type === 'Struct' && v && typeof v === 'object')
                    out[c.id] = Object.values(v).filter(x => x !== undefined && x !== null && typeof x !== 'object' && String(x).trim() !== '').join(' ');
            }
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
        this.schema = {
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
        try {
            await this.loadSchema();
        }
        catch (e) {
            this.error = String(e?.message || e);
            return;
        }
        await this.loadScope();
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
    /** Границы полосы: от самой ранней операции до самой поздней, но не раньше сегодня. */
    async loadRange() {
        if (!this.$item)
            return;
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
        const row = { ...(o?.body || {}), id: o.id, status: o.status, version: o.version };
        if (o?.cid)
            row.cid = o.cid;
        if (this.isOperation)
            row.time = o.time ? _day(new Date(o.time)) : '';
        return row;
    },
    async reload() {
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
            this.names = res?.names || {};
            this.rows = (Array.isArray(res?.items) ? res.items : []).map(o => this.rowOf(o));
            this.total = Number(res?.total) || this.rows.length;
            // строки пересозданы: выделение возвращаем на открытый объект по id
            this.focusedRow = this.tableRows.find(r => r.id === this.editing?.id) ?? null;
        }
        catch (e) {
            this.error = String(e?.message || e);
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
    /** Загрузить объект и открыть окно редактора. */
    async openEditor(row) {
        if (!row?.id || this.editorOpen)
            return;
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
    /** Новый объект — то же окно с пустыми значениями (у операции — сегодняшняя дата; в группе — первый лист). */
    async create() {
        if (this.editorOpen)
            return;
        this.editorOpen = true;
        if (!this.schema?.leaf && this.leaves?.length)
            await this.loadLeafSchema(this.leaves[0].cid);
        else {
            this.leafCid = '';
            this.leafSchema = null;
        }
        this.editing = this.isOperation ? { time: _today() } : {};
        this.entries = [];
        this.entryNames = { objects: {}, classes: {} };
        this.objectBalances = [];
        this.trajectory = [];
        this.printForms = [];
        this.error = '';
        try {
            await this.showEditor();
        }
        finally {
            this.focusedRow = null;
            this.editorOpen = false;
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
            else
                out[k] = v;
        }
        return out;
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
    async save() {
        if (this.busy || !this.canSave)
            return false;
        this.busy = true;
        this.error = '';
        try {
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
            if (!this.editorOpen)
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
            if (!this.editorOpen)
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
            if (!this.editorOpen)
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
    /** Провести: несохранённое (и новый объект) сначала сохраняется. */
    async post() {
        if (this.busy || !this.canRegister)
            return false;
        if ((!this.editing.id || this.isDirty()) && !await this.save())
            return false;
        this.busy = true;
        this.error = '';
        try {
            const target = await this.targetItem();
            const res = await target.fetch('db_register', this.writeParams());
            this.accept(res);
            await this.select({ id: this.editing.id });
            this.snapshot();
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
            this.snapshot();
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
    <label class="context" ~if="owner.showLeafSelect && !owner.editing?.id">Вид
        <select @change="owner.selectLeaf($this.value)">
            <option ~for="owner.leaves" :value="$for.item.cid"
                :selected="$for.item.cid === owner.leafCid">{{$for.item.label}}</option>
        </select>
    </label>
    <label class="context" ~if="owner.showContext && !owner.editing?.id">От места
        <select @change="owner.contextKey = $this.value">
            <option ~for="owner.contexts" :value="owner.contextKeyOf($for.item)"
                :selected="owner.contextKeyOf($for.item) === owner.contextKeyOf(owner.context)">{{owner.contextTitle($for.item)}}</option>
        </select>
    </label>
    <oda-editor-form :metadata="owner.activeSchema" :data="owner.editing" @input="onFormInput" @change="onFormInput" @cell-changed="onFormInput"></oda-editor-form>
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
