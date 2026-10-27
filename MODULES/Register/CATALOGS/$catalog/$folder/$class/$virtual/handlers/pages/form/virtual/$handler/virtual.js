/**
 * form/virtual — состав виртуального справочника на дату на учётном ядре (`db_members`,
 * sources/data/api.js): объекты реестра-источника с ненулевым сальдо счёта-источника
 * по слоту аналитики, сальдо, поля записей-расширений (OVERLAY из `db_schema`) колонками.
 * Клик по названию открывает форму реестра-источника.
 *
 * Правка расширения («Изменить» в строке; только текущий состав — без даты): окно с полями
 * OVERLAY; нет записи — `db_create` с `ext_of`, есть — `db_update` (замена тела, версия — защита
 * от чужой правки). Новая версия действует с момента сохранения.
 */

const money = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

/** Тип поля ядра → тип редактора (editor-form). */
const TYPES = {
    string: 'String', text: 'Text', number: 'Number', money: 'Number', integer: 'Number', boolean: 'Boolean',
    date: 'Date', datetime: 'DateTime', link: 'Link', enum: 'Select', file: 'String',
};

/** Поле OVERLAY ядра → поле редактора. */
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
    return out;
}

export default {
    imports: 'oda//button',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            gap: 0;
            padding: 0;
            overflow: hidden;
            background: var(--content-background, #fff);
            color: var(--content-color, #222);
            font-size: 13px;
        }
        .bar {
            @apply --horizontal;
            flex-shrink: 0;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            padding: 4px 8px;
            background: light-dark(#efeee4, #24252b);
            border-bottom: 1px solid light-dark(#b5b4ac, #3e4049);
            font-size: 12px;
        }
        .bar input {
            min-width: 0;
            width: 145px;
            box-sizing: border-box;
            padding: 2px 6px;
            font-size: 12px;
            border: 1px solid light-dark(#b8b7ae, #3e4049);
            border-radius: 3px;
            background: light-dark(#ffffff, #1b1c20);
            color: inherit;
        }
        .error {
            padding: 6px 10px;
            color: var(--error-color, #c53030);
            background: light-dark(#fff5f5, rgba(229, 62, 62, 0.15));
            border-bottom: 1px solid var(--error-color, #feb2b2);
            white-space: break-spaces;
        }
        .grid {
            @apply --vertical;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }
        div.head, div.row {
            display: grid !important;
            align-items: stretch;
        }
        .head-wrap {
            @apply --vertical;
            flex-shrink: 0;
            background: light-dark(#e3e1d3, #2a2b32);
            color: light-dark(#1f1f1f, #e2e8f0);
            border-bottom: 1px solid light-dark(#9a9990, #4a4c56);
            user-select: none;
            scrollbar-gutter: stable;
            overflow-y: hidden;
        }
        .head {
            font-weight: 600;
            font-size: 12px;
        }
        .grid-body {
            @apply --vertical;
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-gutter: stable;
            background: light-dark(#ffffff, #1b1c20);
        }
        div.row {
            flex-shrink: 0;
            min-height: 25px;
            border-bottom: 1px solid light-dark(#ecece8, #2c2d34);
        }
        div.row:hover:not(.total) {
            background: light-dark(#f2f5fb, rgba(255, 255, 255, 0.05));
        }
        .cell {
            min-width: 0;
            padding: 4px 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            border-right: 1px solid light-dark(#e2e2dc, #2f3038);
        }
        .cell:last-child {
            border-right: none;
        }
        .head-wrap .cell {
            border-right: 1px solid light-dark(#b8b7ae, #3e4049);
            padding: 4px 8px;
        }
        .head-wrap .cell:last-child {
            border-right: none;
        }
        .cell.num {
            justify-content: flex-end;
            text-align: right;
            font-variant-numeric: tabular-nums;
        }
        .head .cell.num {
            justify-content: center;
            text-align: center;
        }
        .cell.link, .cell.edit {
            cursor: pointer;
            text-decoration: underline;
        }
        .cell.edit {
            justify-content: center;
        }
        div.row.total {
            flex-shrink: 0;
            font-weight: 700;
            min-height: 27px;
            background: light-dark(#e3e1d3, #2a2b32);
            color: light-dark(#111, #f1f5f9);
            border-top: 2px solid light-dark(#8c8b82, #52545f);
            border-bottom: none;
            scrollbar-gutter: stable;
            overflow-y: hidden;
            cursor: default;
        }
    </style>
    <div class="bar">
        <span>На дату:</span>
        <input :value="at" placeholder="сегодня (ГГГГ-ММ-ДД)" @change="setAt($this.value)">
    </div>
    <div class="error" ~if="error && !editing">{{error}}</div>
    <div class="grid">
        <div class="head-wrap">
            <div class="head" ~style="{gridTemplateColumns: gridCols}">
                <div class="cell">Название</div>
                <div class="cell num">Сальдо</div>
                <div class="cell num">Кол-во</div>
                <div class="cell" ~for="slots">{{$for.item.label}}</div>
                <div class="cell edit" ~if="canEdit"></div>
            </div>
        </div>
        <div class="grid-body">
            <div class="row" ~for="displayRows" ~style="{gridTemplateColumns: gridCols}">
                <div class="cell link" @tap="open($for.item)">{{$for.item.name}}</div>
                <div class="cell num">{{$for.item.balance}}</div>
                <div class="cell num">{{$for.item.qty}}</div>
                <div class="cell" ~for="$for.item.slots">{{$for.$for.item}}</div>
                <div class="cell edit" ~if="canEdit" @tap="editExt($for.item)">Изменить</div>
            </div>
        </div>
        <div class="row total" ~style="{gridTemplateColumns: gridCols}">
            <div class="cell">Записей: {{rows.length}}</div>
        </div>
    </div>
    `,
    at: '',
    rows: [],
    /** поля записей-расширений (OVERLAY) — колонки */
    slots: [],
    /** поля OVERLAY для редактора расширения */
    fields: [],
    /** реестр-источник: { cid, path, label } */
    registry: null,
    /** правка расширения: { id (объект реестра), title, ext: { id, version } | null, data } */
    editing: null,
    busy: false,
    error: '',
    get gridCols() {
        const slotCols = (this.slots || []).map(() => 'minmax(110px, 1fr)').join(' ');
        const editCol = this.canEdit ? ' 86px' : '';
        return `minmax(180px, 1.8fr) minmax(110px, 0.9fr) minmax(80px, 0.7fr)${slotCols ? ' ' + slotCols : ''}${editCol}`;
    },
    async setAt(val) {
        this.at = String(val || '');
        await this.reload();
    },
    /** Править можно текущий состав (без даты) справочника с полями OVERLAY. */
    get canEdit() {
        return this.fields.length > 0 && !String(this.at || '').trim();
    },
    /** Схема окна правки (editor-form). */
    get extSchema() {
        return { FIELDS: this.fields };
    },
    /** Значение поля расширения текстом. */
    slotText(v) {
        if (v === undefined || v === null)
            return '';
        if (typeof v === 'boolean')
            return v ? 'да' : 'нет';
        if (Array.isArray(v))
            return v.length ? `${v.length} стр.` : '';
        return typeof v === 'object' ? '' : String(v);
    },
    get displayRows() {
        return (this.rows || []).map(r => {
            const b = r.balance || {};
            const net = (Number(b.debit) || 0) - (Number(b.credit) || 0);
            return {
                id: r.id || '',
                name: r.title || r.id || '',
                balance: net > 0 ? money(net) + ' Дт' : net < 0 ? money(-net) + ' Кт' : '',
                qty: b.qty ? String(b.qty) : '',
                slots: (this.slots || []).map(s => this.slotText(r.ext?.body?.[s.id])),
            };
        });
    },
    async attached() {
        await this.loadSlots();
        await this.reload();
    },
    /** Поля расширений из схемы ядра (с учётом наследования). */
    async loadSlots() {
        try {
            const s = (await this.$item?.fetch('db_schema'))?.schema;
            const overlay = (Array.isArray(s?.overlay) ? s.overlay : []).filter(f => f?.id);
            this.slots = overlay.map(f => ({ id: f.id, label: f.label || f.id }));
            this.fields = overlay.map(formField);
        }
        catch {
            this.slots = [];
            this.fields = [];
        }
    },
    async reload() {
        this.rows = [];
        this.error = '';
        if (!this.$item)
            return;
        try {
            const params = {};
            if (String(this.at || '').trim())
                params.at = String(this.at).trim();
            const res = await this.$item.fetch('db_members', params);
            this.registry = res?.registry || null;
            this.rows = Array.isArray(res?.items) ? res.items : [];
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Открыть форму реестра-источника. */
    async open(row) {
        const path = this.registry?.path || this.registry?.cid;
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (t && window.execute)
                window.execute(t, row?.id ? { view: 'objects', id: row.id } : undefined);
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Начать правку расширения участника: значения — текущее тело записи (или пусто). */
    startEdit(row) {
        const member = (this.rows || []).find(r => r.id === row?.id);
        if (!member || !this.canEdit)
            return false;
        this.error = '';
        this.editing = {
            id: member.id,
            title: member.title || member.id,
            ext: member.ext?.id ? { id: member.ext.id, version: member.ext.version } : null,
            data: { ...(member.ext?.body || {}) },
        };
        return true;
    },
    /** Сохранить расширение: только поля OVERLAY; нет записи — создать, есть — заменить тело. */
    async saveExt() {
        const e = this.editing;
        if (!e || this.busy)
            return false;
        this.busy = true;
        this.error = '';
        try {
            const ids = new Set(this.fields.map(f => f.id));
            const data = Object.fromEntries(Object.entries(e.data || {}).filter(([k, v]) => ids.has(k) && v !== '' && v !== null && v !== undefined));
            if (e.ext)
                await this.$item.fetch('db_update', { id: e.ext.id, replace: true, ...(e.ext.version ? { version: e.ext.version } : {}) }, data);
            else
                await this.$item.fetch('db_create', { ext_of: e.id }, data);
            return true;
        }
        catch (err) {
            this.error = String(err?.message || err);
            return false;
        }
        finally {
            this.busy = false;
        }
    },
    /** Окно правки расширения; после закрытия — состав заново. */
    async editExt(row) {
        if (this.editing || !this.startEdit(row))
            return;
        try {
            const el = ODA.createComponent('virtual-ext-editor', { owner: this });
            await WORK.showModal(el, {
                TITLE: { label: this.editing.title },
                allowClose: true,
                width: Math.min(560, window.innerWidth || 560),
            });
        }
        catch (e) {
            if (!(WORK.CancelError && e instanceof WORK.CancelError))
                this.error = String(e?.message || e);
        }
        finally {
            this.editing = null;
            await this.reload();
        }
    },
};

/** virtual-ext-editor — окно правки записи-расширения: поля OVERLAY, ошибка, «Сохранить»/«Закрыть». */
ODA({
    is: 'virtual-ext-editor',
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
            gap: var(--space-s);
            padding: var(--space-m);
        }
    </style>
    <oda-editor-form :metadata="owner.extSchema" :data="owner.editing?.data"></oda-editor-form>
    <div class="error" ~if="owner.error">{{owner.error}}</div>
    <div class="bar" no-flex>
        <oda-button icon="editor:save" :disabled="owner.busy" @tap="save">Сохранить</oda-button>
        <oda-button icon="icons:close" :disabled="owner.busy" @tap="close">Закрыть</oda-button>
    </div>
    `,
    owner: null,
    async save() {
        if (await this.owner.saveExt())
            this.close();
    },
    close() {
        this.parentElement?.close?.();
    },
});
