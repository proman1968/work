/**
 * form/virtual — состав виртуального справочника на дату на учётном ядре (`db_members`,
 * sources/data/api.js): объекты реестра-источника с ненулевым сальдо счёта-источника
 * по слоту аналитики, сальдо, поля записей-расширений (OVERLAY из `db_schema`) колонками.
 * Клик по названию открывает форму реестра-источника.
 */

const money = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

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
        .cell.link {
            cursor: pointer;
            text-decoration: underline;
        }
        .total {
            font-weight: bold;
        }
    </style>
    <div class="bar">
        <input :value="at" placeholder="на дату 2026-01-01" @change="at = $this.value">
        <oda-button icon="icons:refresh" @tap="reload">Показать</oda-button>
    </div>
    <div class="error" ~if="error">{{error}}</div>
    <div class="grid">
        <div class="head">
            <div class="cell">Название</div>
            <div class="cell num">Сальдо</div>
            <div class="cell num">Кол-во</div>
            <div class="cell" ~for="slots">{{$for.item.label}}</div>
        </div>
        <div class="row" ~for="displayRows">
            <div class="cell link" @tap="open($for.item)">{{$for.item.name}}</div>
            <div class="cell num">{{$for.item.balance}}</div>
            <div class="cell num">{{$for.item.qty}}</div>
            <div class="cell" ~for="$for.item.slots">{{$for.$for.item}}</div>
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
    /** реестр-источник: { cid, path, label } */
    registry: null,
    error: '',
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
            this.slots = (Array.isArray(s?.overlay) ? s.overlay : []).filter(f => f?.id).map(f => ({ id: f.id, label: f.label || f.id }));
        }
        catch {
            this.slots = [];
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
};
