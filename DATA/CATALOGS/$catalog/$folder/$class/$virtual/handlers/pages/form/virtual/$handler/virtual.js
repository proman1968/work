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
            gap: 8px;
            padding: 8px;
            overflow: hidden;
        }
        .bar {
            @apply --horizontal;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .bar input {
            min-width: 0;
            width: 140px;
            box-sizing: border-box;
            padding: 4px;
            font-size: 110%;
            border: none;
            border-radius: 4px;
        }
        .error {
            color: var(--error-color, red);
            white-space: break-spaces;
        }
        .grid {
            @apply --vertical;
            flex: 1;
            overflow: auto;
        }
        .head, .row {
            @apply --horizontal;
            gap: 8px;
            padding: 4px 8px;
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
        .cell.num {
            text-align: right;
        }
        .cell.link, .cell.edit {
            cursor: pointer;
            text-decoration: underline;
        }
        .cell.edit {
            flex: 0 0 auto;
        }
        .total {
            font-weight: bold;
        }
    </style>
    <div class="bar">
        <input :value="at" placeholder="на дату 2026-01-01" @change="at = $this.value">
        <oda-button icon="icons:refresh" @tap="reload">Показать</oda-button>
    </div>
    <div class="error" ~if="error && !editing">{{error}}</div>
    <div class="grid">
        <div class="head">
            <div class="cell">Название</div>
            <div class="cell num">Сальдо</div>
            <div class="cell num">Кол-во</div>
            <div class="cell" ~for="slots">{{$for.item.label}}</div>
            <div class="cell edit" ~if="canEdit"></div>
        </div>
        <div class="row" ~for="displayRows">
            <div class="cell link" @tap="open($for.item)">{{$for.item.name}}</div>
            <div class="cell num">{{$for.item.balance}}</div>
            <div class="cell num">{{$for.item.qty}}</div>
            <div class="cell" ~for="$for.item.slots">{{$for.$for.item}}</div>
            <div class="cell edit" ~if="canEdit" @tap="editExt($for.item)">Изменить</div>
        </div>
        <div class="row total">
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
    async open() {
        const path = this.registry?.path || this.registry?.cid;
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (t && window.execute)
                window.execute(t);
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
            ext: member.ext ? { id: member.ext.id, version: member.ext.version } : null,
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
