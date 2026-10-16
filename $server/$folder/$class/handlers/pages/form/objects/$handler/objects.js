/**
 * form/objects — список объектов класса и редактор.
 * Сверху `oda-packets` — выбор периода, ниже слева таблица (`index table`),
 * справа `oda-editor-form` по METADATA.FIELDS.
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
        .side {
            @apply --vertical;
            flex: 1;
            overflow: hidden;
            gap: 8px;
        }
        oda-table {
            flex: 1;
        }
        .bar {
            @apply --horizontal;
            gap: 8px;
        }
        .error {
            color: red;
            white-space: break-spaces;
        }
        oda-editor-form {
            flex: 1;
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
            <oda-table allow-focus ::focused-row="focusedRow" :metadata="tableMetadata" :data-set="tableRows"
                :$save-key="$item?.short"></oda-table>
        </div>
        <div class="side" ~if="editing">
            <oda-editor-form :metadata="schema" :data="editing"></oda-editor-form>
            <div class="error" ~if="error">{{error}}</div>
            <div class="bar">
                <oda-button icon="editor:save" @tap="save">Сохранить</oda-button>
                <oda-button icon="icons:delete" @tap="removeObject">Удалить</oda-button>
                <oda-button ~if="hasPostings" @tap="post">Провести</oda-button>
                <oda-button ~if="hasPostings && editing?.posted" @tap="unpost">Отменить</oda-button>
            </div>
        </div>
    </div>
    `,
    rows: [],
    columns: [],
    schema: null,
    editing: null,
    focusedRow: null,
    $observers: {
        /** клик по строке таблицы открывает объект; повтор уже открытого не грузим */
        select(focusedRow) {
            if (focusedRow?.id && focusedRow.id !== this.editing?.id)
                this.select(focusedRow);
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
    create() {
        this.editing = {};
        this.error = '';
    },
    form() {
        return this.$('oda-editor-form');
    },
    /** Только поля схемы: служебные id/posted/deleted на сервер не уходят. */
    postData() {
        const data = this.form()?.result || this.editing || {};
        const ids = new Set(this.fieldList().map(f => f.id));
        return Object.fromEntries(Object.entries(data).filter(([k]) => ids.has(k)));
    },
    async save() {
        this.error = '';
        try {
            const data = this.postData();
            if (this.editing?.id)
                await this.$item.fetch('update_object', { id: this.editing.id }, data);
            else
                await this.$item.fetch('create_object', {}, data);
            this.editing = null;
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Удалить редактируемый объект (имя не remove — не затенять Element.remove). */
    async removeObject() {
        if (!this.editing?.id)
            return;
        this.error = '';
        try {
            await this.$item.fetch('delete_object', { id: this.editing.id });
            this.editing = null;
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async post() {
        if (!this.editing?.id)
            return;
        this.error = '';
        try {
            await this.$item.fetch('post', { id: this.editing.id });
            await this.select({ id: this.editing.id });
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async unpost() {
        if (!this.editing?.id)
            return;
        this.error = '';
        try {
            await this.$item.fetch('unpost', { id: this.editing.id });
            await this.select({ id: this.editing.id });
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
};
