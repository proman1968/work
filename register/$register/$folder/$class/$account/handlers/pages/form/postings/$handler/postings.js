/**
 * form/postings — проводки счёта: фильтр периода и аналитик, таблица, итоги.
 * Слоты аналитик — METADATA.FIELDS с analytic: true (выбор через oda-link-input).
 */
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
        .total {
            font-weight: bold;
        }
    </style>
    <div class="bar">
        <input :value="from" placeholder="с 2026-01-01" @change="from = $this.value">
        <input :value="to" placeholder="по 2026-12-31" @change="to = $this.value">
        <oda-button icon="icons:refresh" @tap="reload">Показать</oda-button>
    </div>
    <div class="error" ~if="error">{{error}}</div>
    <div class="bar" ~if="slots?.length">
        <oda-link-input ~for="slots" :meta="$for.item" ::value="filters[$for.item.id]"></oda-link-input>
    </div>
    <div class="bar" ~if="hasOpening">Остаток на начало: {{opening}}</div>
    <div class="grid">
        <div class="head">
            <div class="cell">Дата</div>
            <div class="cell num">Дебет</div>
            <div class="cell num">Кредит</div>
            <div class="cell num">Кол-во</div>
            <div class="cell" ~for="slots">{{$for.item.label}}</div>
            <div class="cell">Корр. счёт</div>
            <div class="cell num">Остаток</div>
        </div>
        <div class="row" ~for="displayRows">
            <div class="cell">{{$for.item.date}}</div>
            <div class="cell num">{{$for.item.debit}}</div>
            <div class="cell num">{{$for.item.credit}}</div>
            <div class="cell num">{{$for.item.qty}}</div>
            <div class="cell" ~for="$for.item.slots">{{$for.$for.item}}</div>
            <div class="cell">{{$for.item.corr}}</div>
            <div class="cell num">{{$for.item.bal}}</div>
        </div>
        <div class="row total">
            <div class="cell">Итого</div>
            <div class="cell num">{{total.debit}}</div>
            <div class="cell num">{{total.credit}}</div>
            <div class="cell num"></div>
            <div class="cell" ~for="slots"></div>
            <div class="cell">Сальдо: {{saldo}}</div>
            <div class="cell num">{{closing}}</div>
        </div>
    </div>
    `,
    from: '',
    to: '',
    filters: {},
    slots: [],
    turnoverId: '',
    rows: [],
    names: {},
    error: '',
    opening: 0,
    hasOpening: false,
    total: { debit: 0, credit: 0 },
    get saldo() {
        return (Number(this.total.debit) || 0) - (Number(this.total.credit) || 0);
    },
    /** Остаток на конец периода: начало + обороты. */
    get closing() {
        return (Number(this.opening) || 0) + this.saldo;
    },
    get displayRows() {
        let bal = Number(this.opening) || 0;
        return (this.rows || []).map(r => {
            bal += (Number(r.debit) || 0) - (Number(r.credit) || 0);
            return {
                date: r.time ? new Date(r.time).toLocaleDateString() : '',
                debit: r.debit || '',
                credit: r.credit || '',
                qty: (r.qty_in || r.qty_out) || '',
                slots: (this.slots || []).map(s => this.names[r[s.id]] || r[s.id] || ''),
                corr: r.corr_account || '',
                bal,
            };
        });
    },
    async attached() {
        await this.loadSlots();
        await this.reload();
    },
    /** Слоты аналитик счёта для фильтров и колонок + оборотный индекс для остатка. */
    async loadSlots() {
        const body = await this.$item?.body;
        const fields = Array.isArray(body?.METADATA?.FIELDS) ? body.METADATA.FIELDS : [];
        this.slots = fields.filter(f => f?.analytic);
        const indexes = Array.isArray(body?.METADATA?.INDEXES) ? body.METADATA.INDEXES : [];
        this.turnoverId = (indexes.find(d => d?.kind === 'turnover') || {}).id || '';
    },
    where() {
        const where = {};
        for (const [k, v] of Object.entries(this.filters || {})) {
            if (v)
                where[k] = v;
        }
        return where;
    },
    async reload() {
        this.rows = [];
        this.names = {};
        this.total = { debit: 0, credit: 0 };
        this.opening = 0;
        this.hasOpening = false;
        this.error = '';
        if (!this.$item)
            return;
        try {
            const params = { order: 'asc', limit: 500 };
            if (String(this.from || '').trim())
                params.from = String(this.from).trim();
            if (String(this.to || '').trim())
                params.to = String(this.to).trim();
            const where = this.where();
            if (Object.keys(where).length)
                params.where = JSON.stringify(where);
            const found = await this.$item.fetch('query', params);
            this.rows = (Array.isArray(found) ? found : []).map(r => r.body || {});
            let debit = 0, credit = 0;
            for (const r of this.rows) {
                debit += Number(r.debit) || 0;
                credit += Number(r.credit) || 0;
            }
            this.total = { debit, credit };
            await this.loadOpening(params);
            await this.resolveNames();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Остаток на начало периода — обороты до дня `from` по тем же фильтрам. */
    async loadOpening(params) {
        if (!this.turnoverId || !params.from)
            return;
        const day = new Date(String(params.from).trim() + 'T00:00:00');
        if (!Number.isFinite(day.getTime()))
            return;
        const to = new Date(day.getTime() - 86400000).toISOString().slice(0, 10);
        try {
            const q = { id: this.turnoverId, to };
            if (params.where)
                q.where = params.where;
            const res = await this.$item.fetch('index', q);
            const t = res?.total || {};
            this.opening = (Number(t.debit) || 0) - (Number(t.credit) || 0);
            this.hasOpening = true;
        }
        catch { /* без начального остатка */ }
    },
    async resolveNames() {
        if (!this.slots?.length)
            return;
        const ids = new Set();
        for (const r of this.rows || [])
            for (const s of this.slots) {
                const v = r[s.id];
                if (v && !this.names[v])
                    ids.add(v);
            }
        const names = {};
        await Promise.all([...ids].map(async (id) => {
            const s = this.slots.find(s => (this.rows || []).some(r => r[s.id] === id));
            try {
                const one = await this.$item.fetch('read_link', { catalog: s.catalog, id });
                names[id] = one?.name || id;
            }
            catch {
                names[id] = id;
            }
        }));
        this.names = { ...this.names, ...names };
    },
};
