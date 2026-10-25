/**
 * form/journal — журнал проводок на учётном ядре (`db_journal`, sources/data/api.js):
 * проводки периода по счетам журнала, новые сверху. Фильтры — период, счёт (с субсчетами),
 * класс операций, подразделение (если видно несколько — `db_scope`), «только действующие»
 * (без сторно и прежних версий проведения).
 * Названия операций, аналитик и счетов приходят в `names`; клик по счёту или операции
 * открывает форму счёта или класса операций.
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
        .bar input:not([type]) {
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
        <input :value="account" placeholder="счёт /DATA/REGISTER/…" @change="account = $this.value">
        <input :value="opClass" placeholder="операции /DATA/OPERATIONS/…" @change="opClass = $this.value">
        <select ~if="units.length > 1" title="Подразделение" @change="unit = $this.value">
            <option value="" :selected="!unit">Все подразделения</option>
            <option ~for="units" :value="$for.item.cid" :selected="$for.item.cid === unit">{{$for.item.label}}</option>
        </select>
        <label><input type="checkbox" :checked="effective" @change="effective = $this.checked"> только действующие</label>
        <oda-button icon="icons:refresh" @tap="reload">Показать</oda-button>
    </div>
    <div class="error" ~if="error">{{error}}</div>
    <div class="grid">
        <div class="head">
            <div class="cell">Дата</div>
            <div class="cell">Операция</div>
            <div class="cell">Дебет</div>
            <div class="cell">Аналитика Дт</div>
            <div class="cell">Кредит</div>
            <div class="cell">Аналитика Кт</div>
            <div class="cell num">Сумма</div>
            <div class="cell num">Кол-во</div>
            <div class="cell">Статус</div>
        </div>
        <div class="row" ~for="displayRows" ~class="{storno: $for.item.storno}">
            <div class="cell">{{$for.item.date}}</div>
            <div class="cell link" @tap="openOperation($for.item)">{{$for.item.op}}</div>
            <div class="cell link" @tap="openAccount($for.item, 'debit')">{{$for.item.debit}}</div>
            <div class="cell">{{$for.item.debitAnalytics}}</div>
            <div class="cell link" @tap="openAccount($for.item, 'credit')">{{$for.item.credit}}</div>
            <div class="cell">{{$for.item.creditAnalytics}}</div>
            <div class="cell num">{{$for.item.amount}}</div>
            <div class="cell num">{{$for.item.qty}}</div>
            <div class="cell">{{$for.item.status}}</div>
        </div>
        <div class="row total">
            <div class="cell">{{countText}}</div>
            <div class="cell"></div>
            <div class="cell"></div>
            <div class="cell"></div>
            <div class="cell"></div>
            <div class="cell"></div>
            <div class="cell num">{{money(sum.amount)}}</div>
            <div class="cell num"></div>
            <div class="cell"></div>
        </div>
    </div>
    `,
    from: '',
    to: '',
    account: '',
    /** класс операций (путь) — проводки только его операций и потомков */
    opClass: '',
    /** только действующие проводки: без сторно и прежних версий проведения */
    effective: false,
    /** видимые подразделения (db_scope): больше одного — фильтр */
    units: [],
    /** выбранное подразделение (с вложенными), пусто — все видимые */
    unit: '',
    items: [],
    /** всего проводок по фильтру (строк может быть меньше — первая страница) */
    count: 0,
    sum: { amount: 0, qty: 0 },
    names: { objects: {}, classes: {}, paths: {} },
    error: '',
    money,
    get countText() {
        const n = (this.items || []).length;
        return n < this.count ? `Записей: ${n} из ${this.count}` : `Записей: ${n}`;
    },
    /** Счёт для показа: код (последний сегмент пути) и название. */
    accountText(cid) {
        const code = String(cid || '').split('/').pop();
        const label = this.names?.classes?.[cid];
        return label && label !== code ? `${code} ${label}` : code;
    },
    /** Аналитики стороны: названия объектов через « / ». */
    analyticsText(side) {
        return Object.values(side || {}).map(id => this.names?.objects?.[id] || id).join(' / ');
    },
    /** Операция: её название, без названия (ядро отдаёт id) — класс операции. */
    opText(e) {
        const title = this.names?.objects?.[e.op_id];
        return (title && title !== e.op_id ? title : '') || this.names?.classes?.[e.op_cid] || e.op_id || '';
    },
    get displayRows() {
        return (this.items || []).map(e => ({
            date: e.time ? new Date(e.time).toLocaleDateString() : '',
            op: this.opText(e),
            debit: this.accountText(e.debit),
            debitAnalytics: this.analyticsText(e.debit_analytics),
            credit: this.accountText(e.credit),
            creditAnalytics: this.analyticsText(e.credit_analytics),
            amount: money(e.amount),
            qty: e.qty ? `${e.doc_qty ?? e.qty}${e.doc_unit ? ' ' + e.doc_unit : ''}` : '',
            status: e.storno ? 'сторно' : '',
            storno: !!e.storno,
            op_cid: e.op_cid || '',
            debit_cid: e.debit || '',
            credit_cid: e.credit || '',
        }));
    },
    async attached() {
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
    params() {
        const p = { limit: 500, desc: true };
        const put = (key, v) => {
            const s = String(v ?? '').trim();
            if (s)
                p[key] = s;
        };
        put('from', this.from);
        put('to', this.to);
        put('account', this.account);
        put('op_cid', this.opClass);
        put('unit', this.unit);
        if (this.effective)
            p.effective = true;
        return p;
    },
    async reload() {
        this.items = [];
        this.count = 0;
        this.sum = { amount: 0, qty: 0 };
        this.error = '';
        if (!this.$item)
            return;
        try {
            const res = await this.$item.fetch('db_journal', this.params());
            this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
            this.items = Array.isArray(res?.items) ? res.items : [];
            this.count = Number(res?.total) || this.items.length;
            this.sum = res?.sum || { amount: 0, qty: 0 };
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Открыть форму класса в новом окне. */
    async openPath(path) {
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
    /** Класс операции (её форма — список операций с окном редактора). */
    openOperation(row) {
        return this.openPath(this.names?.paths?.[row.op_cid] || row.op_cid);
    },
    openAccount(row, side) {
        const cid = side === 'debit' ? row.debit_cid : row.credit_cid;
        return this.openPath(this.names?.paths?.[cid] || cid);
    },
};
