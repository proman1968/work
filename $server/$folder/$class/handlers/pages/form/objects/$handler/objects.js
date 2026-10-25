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
    date: 'Date', datetime: 'DateTime', link: 'Link', table: 'Table', enum: 'Select', file: 'String',
};
const STATUS = { draft: 'черновик', registered: 'проведена', cancelled: 'отменена', deleted: 'удалена' };
const DATE_FIELD = Object.freeze({ id: 'time', label: 'Дата', type: 'Date', required: true });

/** Поле схемы ядра → поле редактора: тип, справочник ссылки, варианты, колонки табличной части. */
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
    if (f.type === 'table')
        out.columns = (f.fields || []).map(formField);
    return out;
}

/** Ключ места записи для выбора и сохранения: «подразделение|место». */
function contextKeyOf(c) {
    return c ? `${c.unit}|${c.place ?? ''}` : '';
}

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
                <select ~if="units.length > 1" title="Подразделение" @change="filterUnit($this.value)">
                    <option value="" :selected="!unitFilter">Все подразделения</option>
                    <option ~for="units" :value="$for.item.cid" :selected="$for.item.cid === unitFilter">{{$for.item.label}}</option>
                </select>
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
    editing: null,
    /** проводки редактируемой операции: действующие или предпросмотр черновика */
    entries: [],
    /** печатные формы открытой операции (db_print_list): [{ name, label }] */
    printForms: [],
    focusedRow: null,
    /** окно редактора открыто: второй клик по таблице не открывает ещё одно */
    editorOpen: false,
    /** идёт сохранение/удаление/проведение: повторные действия и закрытие ждут */
    busy: false,
    /** снимок значений на момент открытия/успешного действия — база для isDirty */
    _snapshot: '',
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
        return this.reload();
    },
    contextTitle(c) {
        return c?.place ? `${c.unit_label} / ${c.place_label}` : c?.unit_label || '';
    },
    get isOperation() {
        return this.schema?.family === 'operation';
    },
    get hasPostings() {
        return this.isOperation && Array.isArray(this.schema?.POSTINGS) && this.schema.POSTINGS.length > 0;
    },
    /** Объекты создаются только в листе справочника или операции (не в виртуальном). */
    get canCreate() {
        const s = this.schema;
        return !!s?.leaf && (s.family === 'catalog' || s.family === 'operation') && s.type !== '$virtual';
    },
    get status() {
        return this.editing?.status || '';
    },
    /** Сохранять можно справочник, новый объект, черновик и проведённую операцию (исправление). */
    get canSave() {
        return !!this.editing && this.status !== 'cancelled' && this.status !== 'deleted';
    },
    get canRemove() {
        return !!this.editing?.id && (!this.isOperation || this.status === 'draft');
    },
    get canRegister() {
        return this.isOperation && !!this.editing && (!this.editing.id || this.status === 'draft');
    },
    get canCancel() {
        return this.isOperation && this.status === 'registered';
    },
    /** Заголовок окна: класс + имя объекта; у нового имени ещё нет. */
    get editorTitle() {
        const title = this.schema?.title || '';
        const field = this.fieldList().find(f => ['name', 'label', 'title'].includes(f.id));
        const name = field ? String(this.editing?.[field.id] ?? '').trim() : '';
        const object = name || (this.editing?.id ? '' : 'новый объект');
        if (!title)
            return object || 'Объект';
        if (!object || title === object)
            return title;
        return title + ' · ' + object;
    },
    /** Колонки таблицы: у операций — дата и статус; ссылки показываются названиями (текстом). */
    get tableMetadata() {
        const cols = (this.columns || []).map(c => (c.type === 'Link' || c.type === 'Table' ? { ...c, type: 'String' } : c));
        return this.isOperation ? [{ id: 'time', label: 'Дата' }, ...cols, { id: 'state', label: 'Статус' }] : cols;
    },
    /** Строки таблицы: названия вместо id ссылок, число строк табличной части, статус текстом; id сохраняется. */
    get tableRows() {
        const cols = this.columns || [];
        return (this.rows || []).map(r => {
            const out = { ...r };
            for (const c of cols) {
                const v = r[c.id];
                if (c.type === 'Link' && v)
                    out[c.id] = this.names?.[v] || v;
                else if (Array.isArray(v))
                    out[c.id] = v.length ? `${v.length} стр.` : '';
            }
            if (this.isOperation)
                out.state = STATUS[r.status] || r.status || '';
            return out;
        });
    },
    /** Поля редактора: у операции первым — дата. */
    fieldList() {
        return (this.schema?.FIELDS || []).filter(f => f?.id);
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
    /** Схема класса с учётом наследования: поля для колонок и редактора, правила проводок, семейство. */
    async loadSchema() {
        const s = (await this.$item?.fetch('db_schema'))?.schema;
        const fields = (Array.isArray(s?.fields) ? s.fields : []).filter(f => f?.id && f.id !== 'time').map(formField);
        this.columns = fields;
        this.schema = {
            title: s?.label || '',
            family: s?.family || '',
            type: s?.type || '',
            leaf: !!s?.leaf,
            POSTINGS: Array.isArray(s?.postings) ? s.postings : [],
            FIELDS: s?.family === 'operation' ? [DATE_FIELD, ...fields] : fields,
        };
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
    /** Объект ядра → строка формы: поля тела, id, статус, версия; у операции — день даты. */
    rowOf(o) {
        const row = { ...(o?.body || {}), id: o.id, status: o.status, version: o.version };
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
            const params = { limit: 200, order: '-time' };
            if (this.isOperation && this.period) {
                params.from = this.period.start;
                params.to = this.period.end;
            }
            if (this.unitFilter)
                params.unit = this.unitFilter;
            const res = await this.$item.fetch('db_query', params);
            this.names = res?.names || {};
            this.rows = (Array.isArray(res?.items) ? res.items : []).map(o => this.rowOf(o));
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
            this.editing = this.rowOf(found || { id: row.id });
            await this.loadEntries();
            await this.loadPrints();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Печатные формы сохранённой операции; без ответа — кнопок печати нет. */
    async loadPrints() {
        this.printForms = [];
        if (!this.isOperation || !this.editing?.id)
            return;
        try {
            const list = await this.$item.fetch('db_print_list', { id: this.editing.id });
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
            const res = await this.$item.fetch('db_print', { id: this.editing.id, name });
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
        const op = this.editing;
        if (!this.hasPostings || !op?.id || op.status === 'cancelled')
            return;
        try {
            if (op.status === 'registered')
                this.entries = await this.$item.fetch('db_entries', { id: op.id }) || [];
            else {
                const p = await this.$item.fetch('db_preview', { id: op.id });
                this.entries = [...(p?.entries || []), ...(p?.errors || []).map(e => ({ error: (e.field ? e.field + ': ' : '') + e.message }))];
            }
        }
        catch (e) {
            this.entries = [{ error: String(e?.message || e) }];
        }
    },
    /** Строка проводки в окне: «Дт 62 — Кт 90: 500», количество — если есть. */
    entryText(e) {
        if (e?.error)
            return e.error;
        const acc = cid => String(cid || '').split('/').pop();
        const qty = e.qty ? ` (${e.doc_qty ?? e.qty}${e.doc_unit ? ' ' + e.doc_unit : ''})` : '';
        return `Дт ${acc(e.debit)} — Кт ${acc(e.credit)}: ${Number(e.amount || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}${qty}`;
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
    /** Новый объект — то же окно с пустыми значениями (у операции — сегодняшняя дата). */
    async create() {
        if (this.editorOpen)
            return;
        this.editorOpen = true;
        this.editing = this.isOperation ? { time: _today() } : {};
        this.entries = [];
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
    /** Только поля схемы (без даты операции — она уходит параметром): служебные на сервер не уходят. */
    postData() {
        // editing — та же data, в которую пишет форма: снимок form.result может отставать
        const ids = new Set(this.fieldList().map(f => f.id).filter(id => id !== DATE_FIELD.id || !this.isOperation));
        return Object.fromEntries(Object.entries(this.editing || {}).filter(([k]) => ids.has(k)));
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
            let res;
            if (!this.editing.id)
                res = await this.$item.fetch('db_create', this.writeParams(), data);
            else if (this.status === 'registered')
                res = await this.$item.fetch('db_correct', this.writeParams({ replace: true }), data);
            else
                res = await this.$item.fetch('db_update', this.writeParams({ replace: true }), data);
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
            await this.$item.fetch('db_delete', this.writeParams());
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
            const res = await this.$item.fetch('db_register', this.writeParams());
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
            const res = await this.$item.fetch('db_cancel', this.writeParams());
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
            unguard();
            this.editing = null;
            this.entries = [];
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
 * item-object-editor — содержимое модального окна: форма, проводки, ошибка и действия.
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
    <oda-editor-form :metadata="owner.schema" :data="owner.editing"></oda-editor-form>
    <div class="entries" ~if="owner.entries?.length">
        <div class="entry" ~for="owner.entries">{{owner.entryText($for.item)}}</div>
    </div>
    <div class="error" ~if="owner.error">{{owner.error}}</div>
    <div class="bar" no-flex>
        <oda-button ~if="owner.canSave" icon="editor:save" :disabled="owner.busy" @tap="save">Сохранить</oda-button>
        <oda-button ~if="owner.canRemove" icon="icons:delete" :disabled="owner.busy"
            @tap="removeObject">Удалить</oda-button>
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
    async save() {
        if (await this.owner.save())
            this.close();
    },
    async removeObject() {
        if (await this.owner.removeObject())
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
    close() {
        this.parentElement?.close?.();
    },
});
