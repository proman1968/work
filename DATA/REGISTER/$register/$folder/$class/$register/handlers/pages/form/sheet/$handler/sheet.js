/**
 * form/sheet — оборотно-сальдовая ведомость на учётном ядре (`db_sheet`, sources/data/api.js):
 * сальдо на начало, обороты Дт/Кт, сальдо на конец по дереву счетов журнала.
 * «Разворот» — слоты аналитик (через запятую, например `counterparty`): строки счёта
 * делятся по объектам аналитик, сальдо счёта тогда развёрнутое. Клик по строке открывает форму счёта.
 * Если видно несколько подразделений (`db_scope`) — фильтр по подразделению с вложенными.
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
        }
    </style>
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
        <div class="row" ~class="{group: !$for.item.leaf, detail: $for.item.detail}" ~for="displayRows">
            <div class="cell acc" ~style="{paddingLeft: $for.item.indent + 'px'}" @tap="open($for.item)">{{$for.item.label}}</div>
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
    `,
    from: '',
    to: '',
    account: '',
    /** слоты аналитик для разворота строк счёта, через запятую */
    by: '',
    /** видимые подразделения (db_scope): больше одного — фильтр */
    units: [],
    /** выбранное подразделение (с вложенными), пусто — все видимые */
    unit: '',
    rows: [],
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
        const code = String(r.account || '').split('/').pop();
        const label = r.label || this.names?.classes?.[r.account];
        return label && label !== code ? `${code} ${label}` : code;
    },
    get displayRows() {
        return (this.rows || []).map(r => ({
            account: r.account,
            label: this.rowLabel(r),
            leaf: !!r.leaf,
            detail: !!r.key,
            indent: (Number(r.level) || 0) * 16,
            ...this.cells(r),
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
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Открыть форму счёта (у строки разворота — её счёта). */
    async open(row) {
        const path = this.names?.paths?.[row?.account] || row?.account;
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
