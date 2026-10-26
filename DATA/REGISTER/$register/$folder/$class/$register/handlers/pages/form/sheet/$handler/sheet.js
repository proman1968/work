/**
 * form/sheet — Экран 1 ODANT: Общая оборотно-сальдовая ведомость Журнала (`db_sheet`, sources/data/api.js).
 * Сверху — единая полоса периодов `oda-packets` и панель быстрого отбора.
 * В центре — дерево всех счетов и субсчетов: На начало (Дт / Кт) | За период (Дт / Кт) | На конец (Дт / Кт) и строка Итого.
 * Внизу — панель переходов от выбранного счёта: Обороты | Анализ | Проводки.
 */

function _day(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const _today = () => _day(new Date());
const _yearStart = () => `${new Date().getFullYear()}-01-01`;

const money = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

export default {
    imports: 'oda//button, oda//packets',
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
            padding: 4px 6px;
            font-size: 100%;
            border: 1px solid var(--border-color, #ccc);
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
            border: 1px solid var(--border-color, #ddd);
            border-radius: 4px;
        }
        .head, .row {
            @apply --horizontal;
            gap: 8px;
            padding: 4px 8px;
            border-bottom: 1px solid var(--border-color, #eee);
        }
        .head {
            font-weight: bold;
            background: var(--section-background, #f5f5f5);
            position: sticky;
            top: 0;
        }
        .row.selected {
            background: var(--selected-background, #e8f0fe);
        }
        .cell {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .cell.num {
            text-align: right;
            font-variant-numeric: tabular-nums;
        }
        .cell.acc {
            flex: 3;
            cursor: pointer;
            text-decoration: underline;
        }
        .detail .cell.acc {
            text-decoration: none;
            font-style: italic;
        }
        .group {
            font-weight: bold;
        }
        .total {
            font-weight: bold;
            background: var(--section-background, #f5f5f5);
        }
        .footer-nav {
            @apply --horizontal;
            gap: 8px;
            align-items: center;
            padding-top: 4px;
            border-top: 1px solid var(--border-color, #ddd);
        }
        .footer-target {
            margin-left: auto;
            font-size: small;
            opacity: 0.8;
        }
    </style>
    <oda-packets no-flex mode="month" ~if="packetsStart"
        :start="packetsStart" :end="packetsEnd"
        ::value="packetsKey" @selection-changed="onPackets($event)"></oda-packets>
    <div class="bar">
        <input :value="from" placeholder="с 2026-01-01" @change="from = $this.value">
        <input :value="to" placeholder="по 2026-12-31" @change="to = $this.value">
        <input :value="account" placeholder="счёт /DATA/REGISTER/…" @change="account = $this.value">
        <input :value="by" placeholder="разворот: слот аналитики" @change="by = $this.value">
        <select ~if="units.length > 1" title="Подразделение" @change="unit = $this.value">
            <option value="" :selected="!unit">Все подразделения</option>
            <option ~for="units" :value="$for.item.cid" :selected="$for.item.cid === unit">{{$for.item.label}}</option>
        </select>
        <oda-button icon="icons:refresh" @tap="reload">Показать</oda-button>
    </div>
    <div class="error" ~if="error">{{error}}</div>
    <div class="grid">
        <div class="head">
            <div class="cell acc">Счёт</div>
            <div class="cell num">Нач. Дт</div>
            <div class="cell num">Нач. Кт</div>
            <div class="cell num">Оборот Дт</div>
            <div class="cell num">Оборот Кт</div>
            <div class="cell num">Кон. Дт</div>
            <div class="cell num">Кон. Кт</div>
        </div>
        <div class="row" ~class="{group: !$for.item.leaf, detail: $for.item.detail, selected: selectedRow?.account === $for.item.account && selectedRow?.label === $for.item.label}"
            ~for="displayRows" @tap="selectRow($for.item)" @dblclick="open($for.item)">
            <div class="cell acc" ~style="{paddingLeft: $for.item.indent + 'px'}" @tap.stop="open($for.item)">{{$for.item.label}}</div>
            <div class="cell num">{{$for.item.open_debit}}</div>
            <div class="cell num">{{$for.item.open_credit}}</div>
            <div class="cell num">{{$for.item.debit}}</div>
            <div class="cell num">{{$for.item.credit}}</div>
            <div class="cell num">{{$for.item.close_debit}}</div>
            <div class="cell num">{{$for.item.close_credit}}</div>
        </div>
        <div class="row total">
            <div class="cell acc" style="cursor: default; text-decoration: none;">Итого</div>
            <div class="cell num">{{totals.open_debit}}</div>
            <div class="cell num">{{totals.open_credit}}</div>
            <div class="cell num">{{totals.debit}}</div>
            <div class="cell num">{{totals.credit}}</div>
            <div class="cell num">{{totals.close_debit}}</div>
            <div class="cell num">{{totals.close_credit}}</div>
        </div>
    </div>
    <div class="footer-nav">
        <oda-button icon="odant:calendar" @tap="openTurnovers()">Обороты</oda-button>
        <oda-button icon="odant:grid" @tap="openAnalysis()">Анализ</oda-button>
        <oda-button icon="icons:list" @tap="openPostings()">Проводки</oda-button>
        <span class="footer-target">{{selectedRow ? 'Счёт: ' + selectedRow.label : 'Выберите счёт в таблице'}}</span>
    </div>
    `,
    packetsKey: { $def: '*', $type: String, $save: true },
    packetsStart: _yearStart(),
    packetsEnd: _today(),
    _packetFiltered: false,
    from: '',
    to: '',
    account: '',
    /** слоты аналитик для разворота строк счёта, через запятую */
    by: '',
    slots: [],
    /** видимые подразделения (db_scope): больше одного — фильтр */
    units: [],
    /** выбранное подразделение (с вложенными), пусто — все видимые */
    unit: '',
    rows: [],
    selectedRow: null,
    total: null,
    names: { objects: {}, classes: {}, paths: {} },
    error: '',
    /** Суммы строки ведомости ядра → текст колонок. */
    cells(r) {
        return {
            open_debit: money(r?.opening?.debit), open_credit: money(r?.opening?.credit),
            debit: money(r?.turnover?.debit), credit: money(r?.turnover?.credit),
            close_debit: money(r?.closing?.debit), close_credit: money(r?.closing?.credit),
        };
    },
    get totals() {
        return this.cells(this.total);
    },
    /** Подпись строки: счёт — код и название, строка разворота — объекты аналитик. */
    rowLabel(r) {
        if (r.key)
            return Object.values(r.key).map(id => (id === null ? '—' : this.names?.objects?.[id] || id)).join(' / ');
        const code = String(r.account || '').split('/').pop().replace(/^acc\./, '');
        const label = r.label || this.names?.classes?.[r.account];
        return label && label !== code ? `${code} ${label}` : code;
    },
    get displayRows() {
        return (this.rows || []).map(r => ({
            account: r.account,
            key: r.key || null,
            label: this.rowLabel(r),
            leaf: !!r.leaf,
            detail: !!r.key,
            indent: (Number(r.level) || 0) * 16,
            ...this.cells(r),
        }));
    },
    selectRow(row) {
        this.selectedRow = row || null;
    },
    async onPackets(e) {
        const d = e?.detail?.value ?? e?.detail ?? {};
        if (Array.isArray(d))
            return;
        if (d.selected?.name === '*') {
            if (this._packetFiltered) {
                this._packetFiltered = false;
                this.from = '';
                this.to = '';
                await this.reload();
            }
            return;
        }
        if (d.period?.start && d.period?.end) {
            this._packetFiltered = true;
            this.from = d.period.start;
            this.to = d.period.end;
            await this.reload();
        }
    },
    async attached() {
        await this.loadSlots();
        await this.loadScope();
        await this.reload();
    },
    async loadSlots() {
        try {
            const s = await this.$item?.fetch('db_schema');
            this.slots = Array.isArray(s?.slots) ? s.slots : [];
        }
        catch {
            this.slots = [];
        }
    },
    async setBy(val) {
        this.by = String(val || '');
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
        const p = {};
        for (const key of ['from', 'to', 'account', 'unit']) {
            const s = String(this[key] ?? '').trim();
            if (s)
                p[key] = s;
        }
        const by = String(this.by ?? '').split(',').map(s => s.trim()).filter(Boolean);
        if (by.length)
            p.by = JSON.stringify(by);
        return p;
    },
    async reload() {
        this.rows = [];
        this.total = null;
        this.error = '';
        if (!this.$item)
            return;
        try {
            const res = await this.$item.fetch('db_sheet', this.params());
            this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
            this.rows = Array.isArray(res?.rows) ? res.rows : [];
            this.total = res?.total || null;
            if (!this.selectedRow && this.displayRows.length)
                this.selectedRow = this.displayRows[0];
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Открыть форму счёта (у строки разворота — её счёта) в заданном режиме (по умолчанию — карточка/проводки). */
    async open(row, mode = '') {
        const target = row || this.selectedRow || this.displayRows?.[0];
        const path = this.names?.paths?.[target?.account] || target?.account;
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (!t || !window.execute)
                return;
            const nav = { view: 'postings', from: this.from, to: this.to, unit: this.unit };
            if (mode)
                nav.mode = mode;
            if (target?.key && typeof target.key === 'object') {
                const filters = Object.fromEntries(Object.entries(target.key).filter(([, v]) => v));
                if (Object.keys(filters).length)
                    nav.filters = filters;
            }
            window.execute(t, nav);
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    openTurnovers(row) {
        return this.open(row || this.selectedRow, 'turnovers');
    },
    openAnalysis(row) {
        return this.open(row || this.selectedRow, 'analysis');
    },
    openPostings(row) {
        return this.open(row || this.selectedRow, 'card');
    },
};
