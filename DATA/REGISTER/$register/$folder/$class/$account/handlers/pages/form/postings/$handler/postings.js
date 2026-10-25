/**
 * form/postings — карточка счёта на учётном ядре (`db_card`, sources/data/api.js):
 * сальдо на начало, проводки периода по счёту и субсчетам со стороной, аналитиками,
 * корр. счётом и сальдо после каждой, обороты и сальдо на конец.
 * Слоты аналитик — из `db_schema` (поля-ссылки с analytic: true); фильтр по ним —
 * `oda-link-input` (выбор через `db_choices` справочника слота). Названия — в `names`.
 * Если видно несколько подразделений (`db_scope`) — фильтр по подразделению с вложенными.
 */

const money = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
/** Сальдо со знаком (Дт − Кт) текстом: «1 200,00 Дт», «300,00 Кт». */
const saldo = v => (Number(v) > 0 ? money(v) + ' Дт' : Number(v) < 0 ? money(-v) + ' Кт' : '0');

export default {
    imports: 'oda//button, ~/lib//editor-form',
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
            width: 120px;
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
        .storno {
            color: var(--error-color, red);
        }
        .total {
            font-weight: bold;
        }
    </style>
    <div class="bar">
        <input :value="from" placeholder="с 2026-01-01" @change="from = $this.value">
        <input :value="to" placeholder="по 2026-12-31" @change="to = $this.value">
        <select ~if="units.length > 1" title="Подразделение" @change="unit = $this.value">
            <option value="" :selected="!unit">Все подразделения</option>
            <option ~for="units" :value="$for.item.cid" :selected="$for.item.cid === unit">{{$for.item.label}}</option>
        </select>
        <oda-button icon="icons:refresh" @tap="reload">Показать</oda-button>
    </div>
    <div class="error" ~if="error">{{error}}</div>
    <div class="bar" ~if="slots?.length">
        <oda-link-input ~for="slots" :meta="$for.item" ::value="filters[$for.item.id]"></oda-link-input>
    </div>
    <div class="bar opening">Сальдо на начало: {{openingText}}</div>
    <div class="grid">
        <div class="head">
            <div class="cell">Дата</div>
            <div class="cell">Операция</div>
            <div class="cell num">Дебет</div>
            <div class="cell num">Кредит</div>
            <div class="cell num">Кол-во</div>
            <div class="cell" ~for="slots">{{$for.item.label}}</div>
            <div class="cell">Корр. счёт</div>
            <div class="cell num">Сальдо</div>
        </div>
        <div class="row" ~for="displayRows" ~class="{storno: $for.item.storno}">
            <div class="cell">{{$for.item.date}}</div>
            <div class="cell">{{$for.item.op}}</div>
            <div class="cell num">{{$for.item.debit}}</div>
            <div class="cell num">{{$for.item.credit}}</div>
            <div class="cell num">{{$for.item.qty}}</div>
            <div class="cell" ~for="$for.item.slots">{{$for.$for.item}}</div>
            <div class="cell">{{$for.item.corr}}</div>
            <div class="cell num">{{$for.item.bal}}</div>
        </div>
        <div class="row total">
            <div class="cell">Обороты</div>
            <div class="cell">{{countText}}</div>
            <div class="cell num">{{money(turnover.debit)}}</div>
            <div class="cell num">{{money(turnover.credit)}}</div>
            <div class="cell num"></div>
            <div class="cell" ~for="slots"></div>
            <div class="cell">Сальдо на конец</div>
            <div class="cell num">{{closingText}}</div>
        </div>
    </div>
    `,
    from: '',
    to: '',
    /** отбор по аналитикам стороны счёта: { слот: id } */
    filters: {},
    /** слоты аналитик счёта: { id, label, catalog } — для фильтров и колонок */
    slots: [],
    /** видимые подразделения (db_scope): больше одного — фильтр */
    units: [],
    /** выбранное подразделение (с вложенными), пусто — все видимые */
    unit: '',
    items: [],
    count: 0,
    opening: { debit: 0, credit: 0 },
    turnover: { debit: 0, credit: 0 },
    closing: { debit: 0, credit: 0 },
    names: { objects: {}, classes: {}, paths: {} },
    error: '',
    money,
    get openingText() {
        return saldo((Number(this.opening?.debit) || 0) - (Number(this.opening?.credit) || 0));
    },
    get closingText() {
        return saldo((Number(this.closing?.debit) || 0) - (Number(this.closing?.credit) || 0));
    },
    get countText() {
        const n = (this.items || []).length;
        return n < this.count ? `${n} из ${this.count}` : '';
    },
    accountText(cid) {
        const code = String(cid || '').split('/').pop();
        const label = this.names?.classes?.[cid];
        return label && label !== code ? `${code} ${label}` : code;
    },
    /** Операция: её название, без названия (ядро отдаёт id) — класс операции. */
    opText(i) {
        const title = this.names?.objects?.[i.op_id];
        return (title && title !== i.op_id ? title : '') || this.names?.classes?.[i.op_cid] || i.op_id || '';
    },
    get displayRows() {
        return (this.items || []).map(i => ({
            date: i.time ? new Date(i.time).toLocaleDateString() : '',
            op: this.opText(i),
            debit: money(i.debit),
            credit: money(i.credit),
            qty: i.qty ? String(i.qty) : '',
            slots: (this.slots || []).map(s => {
                const id = i.analytics?.[s.id];
                return id ? this.names?.objects?.[id] || id : '';
            }),
            corr: this.accountText(i.corr),
            bal: saldo(i.balance),
            storno: !!i.storno,
        }));
    },
    async attached() {
        await this.loadSlots();
        await this.loadScope();
        await this.reload();
    },
    /** Видимые подразделения для фильтра; без ответа — без фильтра. */
    async loadScope() {
        try {
            const s = await this.$item?.fetch('db_scope');
            this.units = Array.isArray(s?.units) && !s.all ? s.units : [];
        }
        catch {
            this.units = [];
        }
    },
    /** Слоты аналитик счёта из схемы ядра (с учётом наследования). */
    async loadSlots() {
        try {
            const s = (await this.$item?.fetch('db_schema'))?.schema;
            const fields = Array.isArray(s?.fields) ? s.fields : [];
            this.slots = fields.filter(f => f?.analytic && f.type === 'link')
                .map(f => ({ id: f.id, label: f.label || f.id, type: 'Link', catalog: f.target, placeholder: f.label || f.id }));
        }
        catch (e) {
            this.slots = [];
            this.error = String(e?.message || e);
        }
    },
    /** Заданные фильтры аналитик. */
    analytics() {
        const out = {};
        for (const [k, v] of Object.entries(this.filters || {})) {
            if (v)
                out[k] = v;
        }
        return out;
    },
    params() {
        const p = { limit: 500 };
        for (const key of ['from', 'to', 'unit']) {
            const s = String(this[key] ?? '').trim();
            if (s)
                p[key] = s;
        }
        const a = this.analytics();
        if (Object.keys(a).length)
            p.analytics = JSON.stringify(a);
        return p;
    },
    async reload() {
        this.items = [];
        this.count = 0;
        this.opening = this.turnover = this.closing = { debit: 0, credit: 0 };
        this.error = '';
        if (!this.$item)
            return;
        try {
            const res = await this.$item.fetch('db_card', this.params());
            this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
            this.items = Array.isArray(res?.items) ? res.items : [];
            this.count = Number(res?.total) || this.items.length;
            this.opening = res?.opening || { debit: 0, credit: 0 };
            this.turnover = res?.turnover || { debit: 0, credit: 0 };
            this.closing = res?.closing || { debit: 0, credit: 0 };
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
};
