/**
 * form/sheet — оборотно-сальдовая ведомость журнала: сальдо на начало,
 * обороты Дт/Кт, сальдо на конец по счетам и субсчетам. Клик по счёту открывает его форму.
 */
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
            color: red;
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
        <input :value="account" placeholder="счёт /REGISTER/…" @change="account = $this.value">
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
        <div class="row" ~class="{group: !$for.item.leaf}" ~for="displayRows">
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
    rows: [],
    totals: {},
    error: '',
    get displayRows() {
        const show = (v) => v ? v : '';
        return (this.rows || []).map(r => ({
            path: r.path,
            label: r.label || r.path,
            leaf: !!r.leaf,
            indent: (Number(r.level) || 0) * 16,
            open_debit: show(r.open_debit), open_credit: show(r.open_credit),
            debit: show(r.debit), credit: show(r.credit),
            close_debit: show(r.close_debit), close_credit: show(r.close_credit),
        }));
    },
    async attached() {
        await this.reload();
    },
    async reload() {
        this.rows = [];
        this.totals = {};
        this.error = '';
        if (!this.$item)
            return;
        try {
            const params = {};
            if (String(this.from || '').trim())
                params.from = String(this.from).trim();
            if (String(this.to || '').trim())
                params.to = String(this.to).trim();
            if (String(this.account || '').trim())
                params.account = String(this.account).trim();
            const res = await this.$item.fetch('sheet', params);
            this.rows = Array.isArray(res?.rows) ? res.rows : [];
            const t = res?.total || {};
            const show = (v) => v ? v : '';
            this.totals = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, show(v)]));
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Открыть форму счёта. */
    async open(row) {
        if (!row?.path)
            return;
        try {
            const t = await WORK.get_item(row.path);
            if (t && window.execute)
                window.execute(t);
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
};
