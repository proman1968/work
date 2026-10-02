/**
 * form/journal — журнал проводок журнала: строки по парам (entry, rule),
 * фильтры периода, счёта и операции. Клик по счёту/операции открывает их формы.
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
        .cell.link {
            cursor: pointer;
            text-decoration: underline;
        }
        .storno {
            color: red;
        }
        .total {
            font-weight: bold;
        }
    </style>
    <div class="bar">
        <input :value="from" placeholder="с 2026-01-01" @change="from = $this.value">
        <input :value="to" placeholder="по 2026-12-31" @change="to = $this.value">
        <input :value="account" placeholder="счёт /REGISTER/…" @change="account = $this.value">
        <input :value="source" placeholder="операция …" @change="source = $this.value">
        <oda-button icon="icons:refresh" @tap="reload">Показать</oda-button>
    </div>
    <div class="error" ~if="error">{{error}}</div>
    <div class="grid">
        <div class="head">
            <div class="cell">Дата</div>
            <div class="cell">Операция</div>
            <div class="cell">Дебет</div>
            <div class="cell">Кредит</div>
            <div class="cell num">Сумма</div>
            <div class="cell">Статус</div>
        </div>
        <div class="row" ~for="displayRows">
            <div class="cell">{{$for.item.date}}</div>
            <div class="cell link" @tap="openSource($for.item)">{{$for.item.op}}</div>
            <div class="cell link" @tap="openAccount($for.item, 'debit')">{{$for.item.debit}}</div>
            <div class="cell link" @tap="openAccount($for.item, 'credit')">{{$for.item.credit}}</div>
            <div class="cell num">{{$for.item.sum}}</div>
            <div class="cell" ~class="{storno: $for.item.storno}">{{$for.item.status}}</div>
        </div>
        <div class="row total">
            <div class="cell">Записей: {{rows.length}}</div>
            <div class="cell"></div>
            <div class="cell"></div>
            <div class="cell"></div>
            <div class="cell num">{{total}}</div>
            <div class="cell"></div>
        </div>
    </div>
    `,
    from: '',
    to: '',
    account: '',
    source: '',
    rows: [],
    error: '',
    get total() {
        return (this.rows || []).reduce((s, r) => s + (Number(r.sum) || 0), 0);
    },
    get displayRows() {
        return (this.rows || []).map(r => ({
            date: r.time ? new Date(r.time).toLocaleDateString() : '',
            op: r.op || r.source || '',
            debit: r.debit_label || r.debit_account || '',
            credit: r.credit_label || r.credit_account || '',
            sum: r.sum || '',
            status: r.storno ? 'сторно' : '',
            storno: !!r.storno,
            source: r.source || '',
            debit_account: r.debit_account || '',
            credit_account: r.credit_account || '',
        }));
    },
    async attached() {
        await this.reload();
    },
    async reload() {
        this.rows = [];
        this.error = '';
        if (!this.$item)
            return;
        try {
            const params = { limit: 500 };
            if (String(this.from || '').trim())
                params.from = String(this.from).trim();
            if (String(this.to || '').trim())
                params.to = String(this.to).trim();
            if (String(this.account || '').trim())
                params.account = String(this.account).trim();
            if (String(this.source || '').trim())
                params.source = String(this.source).trim();
            const found = await this.$item.fetch('journal', params);
            this.rows = Array.isArray(found) ? found : [];
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Открыть форму операции или счёта в новом окне. */
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
    openSource(row) {
        return this.openPath(row.source);
    },
    openAccount(row, side) {
        return this.openPath(side === 'debit' ? row.debit_account : row.credit_account);
    },
};
