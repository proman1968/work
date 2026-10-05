/**
 * form/objects — список объектов класса и редактор.
 * Слева таблица (`index table`), справа `oda-editor-form` по METADATA.FIELDS.
 * У операций с POSTINGS — колонка «Проведено», кнопки «Провести» / «Отменить».
 */
export default {
    imports: 'oda//button, ~/lib//editor-form',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            @apply --flex;
            gap: 8px;
            padding: 8px;
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
        .row {
            @apply --horizontal;
            gap: 8px;
            padding: 4px 8px;
            cursor: pointer;
            align-items: center;
        }
        .row:hover {
            background-color: var(--active-background, #e8e8e8);
        }
        .row.selected {
            background-color: var(--active-background, #d8d8d8);
        }
        .head {
            font-weight: bold;
        }
        .cell {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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
    <div class="list">
        <div class="bar">
            <oda-button icon="icons:plus" @tap="create">Создать</oda-button>
            <oda-button icon="icons:refresh" @tap="reload">Обновить</oda-button>
        </div>
        <div class="row head">
            <div class="cell" ~for="columns">{{$for.item.label}}</div>
            <div class="cell" ~if="hasPostings">Проведено</div>
        </div>
        <div ~for="displayRows" class="row" ~class="{selected: $for.item.id === editing?.id}" @tap="select($for.item)">
            <div class="cell" ~for="$for.item.cells">{{$for.$for.item}}</div>
            <div class="cell" ~if="hasPostings">{{$for.item.posted ? 'да' : ''}}</div>
        </div>
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
    `,
    rows: [],
    columns: [],
    schema: null,
    editing: null,
    names: {},
    error: '',
    get hasPostings() {
        return Array.isArray(this.schema?.POSTINGS) && this.schema.POSTINGS.length > 0;
    },
    get displayRows() {
        return (this.rows || []).map(r => ({
            id: r.id,
            posted: r.posted,
            cells: (this.columns || []).map(c => this.cellText(r, c)),
        }));
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
        await this.reload();
    },
    async reload() {
        this.rows = [];
        this.names = {};
        this.error = '';
        if (!this.$item)
            return;
        try {
            const res = await this.$item.fetch('index', { id: 'table', limit: 200 });
            this.rows = Array.isArray(res?.rows) ? res.rows : [];
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
                names[id] = one?.name || id;
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
