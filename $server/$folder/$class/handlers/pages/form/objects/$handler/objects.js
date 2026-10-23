/**
 * form/objects — список объектов класса и редактор.
 * Сверху `oda-packets` — выбор периода, ниже таблица (`index table`).
 * Редактор открывается модальным окном `item-object-editor` по `METADATA.FIELDS`;
 * закрытие с несохранёнными изменениями спрашивает «Сохранить перед закрытием?».
 * У операций с POSTINGS — колонка «Проведено», кнопки «Провести» / «Отменить».
 *
 * Период хранится здесь, а не в пакете: пакет stateless, состояние — per-point ($save).
 * `packetsKey` хранит КЛЮЧ выбора, а не границы: у пункта «Сейчас» ключ 'now'
 * относителен, поэтому нетронутый дефолт остаётся «сегодня», а не вчерашним днём.
 */

// Дата по местному времени. 'YYYY-MM-DD' на сервере разбирается как UTC и в America/*
// уезжает на предыдущий день — поэтому и здесь, и в границах периода время явное.
function _day(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const _today = () => _day(new Date());

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
    </style>
    <oda-packets no-flex mode="day" ~if="packetsStart"
        :start="packetsStart" :end="packetsEnd"
        ::value="packetsKey" @selection-changed="onPackets($event)"></oda-packets>
    <div class="body">
        <div class="list">
            <div class="bar">
                <oda-button icon="icons:plus" @tap="create">Создать</oda-button>
                <oda-button icon="icons:refresh" @tap="reload">Обновить</oda-button>
            </div>
            <oda-table allow-focus readonly ::focused-row="focusedRow" :metadata="tableMetadata" :data-set="tableRows"
                :$save-key="$item?.short"></oda-table>
        </div>
    </div>
    `,
    rows: [],
    columns: [],
    schema: null,
    editing: null,
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
    names: {},
    error: '',
    /** Ключ выбранного пакета: 'now' | '*' | маска единицы | 'period:start:end'. */
    packetsKey: { $def: 'now', $type: String, $save: true },
    packetsStart: '',
    packetsEnd: '',
    /** Период, который показал пакет, — единственный источник границ для выборки. */
    period: null,
    get hasPostings() {
        return Array.isArray(this.schema?.POSTINGS) && this.schema.POSTINGS.length > 0;
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
    /** Колонки таблицы: поля схемы, а при POSTINGS — синтетическая «Проведено». */
    get tableMetadata() {
        const cols = this.columns || [];
        return this.hasPostings ? [...cols, { id: 'posted', label: 'Проведено' }] : cols;
    },
    /** Строки таблицы: копии с текстом «да» для «Проведено»; id сохраняется для выбора. */
    get tableRows() {
        return (this.rows || []).map(r => this.hasPostings ? { ...r, posted: r.posted ? 'да' : '' } : r);
    },
    /** Поля схемы (без системного time) — для колонок, редактора и отправки. */
    fieldList() {
        return (this.schema?.FIELDS || []).filter(f => f?.id && f.id !== 'time');
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
    /** Отпечаток только полей схемы: служебные id/posted/deleted в dirty не входят. */
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
    /** Поля класса: FIELDS для колонок и редактора, POSTINGS для кнопок. */
    async loadSchema() {
        const body = await this.$item?.body;
        const fields = Array.isArray(body?.METADATA?.FIELDS) ? body.METADATA.FIELDS : [];
        this.columns = fields.filter(f => f?.id && f.id !== 'time');
        this.schema = { title: body?.label || '', FIELDS: this.columns, POSTINGS: body?.METADATA?.POSTINGS };
    },
    async attached() {
        await this.loadSchema();
        await this.loadRange();
    },
    /**
     * Границы полосы — дни журнала точки (по убыванию, сегодня — первым).
     * Даты журнала — надмножество дат объектов: создание объекта пишет запись в журнал,
     * поэтому пакет может покрыть дни без объектов (таблица на них пустая).
     * При недоступном журнале — сегодня, чтобы пакет смонтировался и отдал период.
     */
    async loadRange() {
        if (!this.$item)
            return;
        const days = await this.$item.logs({ mode: 'dates' }).catch(() => []);
        this.packetsEnd = days?.[0] || _today();
        this.packetsStart = days?.[days.length - 1] || this.packetsEnd;
    },
    /**
     * Смена периода в пакете — единственный повод грузить строки заново.
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
    async reload() {
        this.rows = [];
        this.names = {};
        this.error = '';
        if (!this.$item)
            return;
        try {
            const params = { id: 'table', limit: 200 };
            if (this.period) {
                // Время явное: сервер разбирает границу через new Date(), а голая
                // 'YYYY-MM-DD' — это UTC и в America/* 'to' отсёк бы последний день.
                params.from = this.period.start + 'T00:00:00';
                params.to = this.period.end + 'T00:00:00';
            }
            const res = await this.$item.fetch('index', params);
            this.rows = Array.isArray(res?.rows) ? res.rows : [];
            // строки пересозданы: выделение возвращаем на открытый объект по id
            this.focusedRow = this.tableRows.find(r => r.id === this.editing?.id) ?? null;
            await this.resolveNames();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** id ссылок → имена (по одному запросу на значение). */
    async resolveNames() {
        const linkFields = (this.columns || []).filter(f => f.type === 'Link' && f.catalog);
        if (!linkFields.length)
            return;
        const ids = new Set();
        for (const r of this.rows || [])
            for (const f of linkFields) {
                const v = r[f.id];
                if (v && !this.names[v])
                    ids.add(v);
            }
        const names = {};
        await Promise.all([...ids].map(async (id) => {
            const f = linkFields.find(f => (this.rows || []).some(r => r[f.id] === id));
            try {
                const one = await this.$item.fetch('read_link', { catalog: f.catalog, id });
                names[id] = one?.DATA?.name ?? one?.name ?? id;
            }
            catch {
                names[id] = id;
            }
        }));
        this.names = { ...this.names, ...names };
    },
    cellText(row, col) {
        const v = row?.[col?.id];
        if (col?.type === 'Link' && v)
            return this.names[v] || v;
        return v ?? '';
    },
    async select(row) {
        if (!row?.id)
            return;
        this.error = '';
        try {
            const found = await this.$item.fetch('read_object', { id: row.id });
            this.editing = { ...(found?.body || {}), id: row.id };
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
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
    /** Новый объект — то же окно с пустыми значениями. */
    async create() {
        if (this.editorOpen)
            return;
        this.editorOpen = true;
        this.editing = {};
        this.error = '';
        try {
            await this.showEditor();
        }
        finally {
            this.focusedRow = null;
            this.editorOpen = false;
        }
    },
    /** Только поля схемы: служебные id/posted/deleted на сервер не уходят. */
    postData() {
        // editing — та же data, в которую пишет форма: снимок form.result может отставать
        const ids = new Set(this.fieldList().map(f => f.id));
        return Object.fromEntries(Object.entries(this.editing || {}).filter(([k]) => ids.has(k)));
    },
    async save() {
        if (this.busy || !this.editing)
            return false;
        this.busy = true;
        this.error = '';
        try {
            const data = this.postData();
            // снимок отправленного, а не текущего: ввод во время запроса остаётся dirty
            const saved = this.fingerprint(data);
            if (this.editing.id)
                await this.$item.fetch('update_object', { id: this.editing.id }, data);
            else
                await this.$item.fetch('create_object', {}, data);
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
    /** Удалить редактируемый объект (имя не remove — не затенять Element.remove). */
    async removeObject() {
        if (this.busy || !this.editing?.id)
            return false;
        // подтверждение — часть операции: пока оно открыто, окно не закрыть
        this.busy = true;
        try {
            try {
                await WORK.showConfirm('Удалить объект?', {
                    TITLE: { label: 'Удаление' },
                    OK: { label: 'Удалить', icon: 'icons:delete', colorMode: 'error' },
                    CANCEL: { label: 'Отмена', icon: 'icons:close', colorMode: 'info' },
                });
            }
            catch {
                return false;
            }
            this.error = '';
            await this.$item.fetch('delete_object', { id: this.editing.id });
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
    async post() {
        if (this.busy || !this.editing?.id)
            return false;
        this.busy = true;
        this.error = '';
        try {
            await this.$item.fetch('post', { id: this.editing.id });
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
    async unpost() {
        if (this.busy || !this.editing?.id)
            return false;
        this.busy = true;
        this.error = '';
        try {
            await this.$item.fetch('unpost', { id: this.editing.id });
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
 * item-object-editor — содержимое модального окна: форма, ошибка и действия.
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
        .bar {
            @apply --horizontal;
            flex-wrap: wrap;
            gap: var(--space-s);
            padding: var(--space-m);
        }
    </style>
    <oda-editor-form :metadata="owner.schema" :data="owner.editing"></oda-editor-form>
    <div class="error" ~if="owner.error">{{owner.error}}</div>
    <div class="bar" no-flex>
        <oda-button icon="editor:save" :disabled="owner.busy" @tap="save">Сохранить</oda-button>
        <oda-button ~if="owner.editing?.id" icon="icons:delete" :disabled="owner.busy"
            @tap="removeObject">Удалить</oda-button>
        <oda-button ~if="owner.editing?.id && owner.hasPostings" :disabled="owner.busy"
            @tap="post">Провести</oda-button>
        <oda-button ~if="owner.editing?.id && owner.hasPostings && owner.editing?.posted" :disabled="owner.busy"
            @tap="unpost">Отменить</oda-button>
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
    async unpost() {
        await this.owner.unpost();
    },
    close() {
        this.parentElement?.close?.();
    },
});
