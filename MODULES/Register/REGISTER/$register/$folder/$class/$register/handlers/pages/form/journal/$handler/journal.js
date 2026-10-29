/**
 * form/journal — журнал проводок на учётном ядре (`db_journal`, sources/data/api.js):
 * сверху полоса периодов `oda-packets`, компактная панель фильтров и таблица проводок на CSS Grid
 * с прижатым к низу футером итогов.
 * Клик по дате открывает сборную карточку проводки (`db_entry`, Экран 4 ODANT);
 * клик по счёту или операции открывает форму счёта или документ операции.
 */

const PERIOD_STORAGE_KEY = 'work.accounting.period';

function _day(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const _today = () => _day(new Date());
const _yearStart = () => `${new Date().getFullYear()}-01-01`;
const _yearEnd = () => _today();

function _readSavedPeriod() {
    try {
        const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(PERIOD_STORAGE_KEY) : null;
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}

function _writeSavedPeriod(packetsKey, from, to) {
    try {
        if (typeof sessionStorage !== 'undefined')
            sessionStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ packetsKey: packetsKey || '*', from: from || '', to: to || '' }));
    }
    catch { /* ignore */ }
}

function _derivePacketsKey(from, to, fallback = '*') {
    if (!from && !to)
        return '*';
    if (fallback && fallback !== '*')
        return fallback;
    if (from && to) {
        const ym1 = /^(\d{4})-01-01$/.exec(from);
        const ym2 = /^(\d{4})-12-31$/.exec(to);
        if (ym1 && ym2 && ym1[1] === ym2[1])
            return `${ym1[1]}*`;
        return `period:${from}:${to}`;
    }
    return fallback || '*';
}

function _daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
}

function _weekBounds(dt) {
    const dow = dt.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + diffToMon);
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return { from: _day(mon), to: _day(sun) };
}

function _boundsFromPacketsKey(key, defaultMode = 'month') {
    const k = String(key || '').trim();
    if (!k || k === '*')
        return { from: '', to: '' };
    if (k.startsWith('period:')) {
        const [, s = '', e = ''] = k.split(':');
        return { from: s, to: e };
    }
    if (k === 'now' || k.startsWith('now:')) {
        const gran = k.startsWith('now:') ? k.slice(4) : defaultMode;
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth() + 1;
        if (gran === 'day') {
            const d = _day(now);
            return { from: d, to: d };
        }
        if (gran === 'week')
            return _weekBounds(now);
        if (gran === 'quarter') {
            const q = Math.floor((m - 1) / 3) + 1;
            const m1 = String((q - 1) * 3 + 1).padStart(2, '0');
            const m2 = (q - 1) * 3 + 3;
            return { from: `${y}-${m1}-01`, to: `${y}-${String(m2).padStart(2, '0')}-${String(_daysInMonth(y, m2)).padStart(2, '0')}` };
        }
        if (gran === 'year')
            return { from: `${y}-01-01`, to: `${y}-12-31` };
        const ms = String(m).padStart(2, '0');
        return { from: `${y}-${ms}-01`, to: `${y}-${ms}-${String(_daysInMonth(y, m)).padStart(2, '0')}` };
    }
    const clean = k.replace(/\*+$/, '');
    if (/^\d{4}$/.test(clean))
        return { from: `${clean}-01-01`, to: `${clean}-12-31` };
    const qm = /^(\d{4})-q([1-4])$/i.exec(clean);
    if (qm) {
        const y = +qm[1], q = +qm[2];
        const m1 = String((q - 1) * 3 + 1).padStart(2, '0');
        const m2 = (q - 1) * 3 + 3;
        return { from: `${y}-${m1}-01`, to: `${y}-${String(m2).padStart(2, '0')}-${String(_daysInMonth(y, m2)).padStart(2, '0')}` };
    }
    const mm = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(clean);
    if (mm) {
        const y = +mm[1], m = +mm[2];
        return { from: `${clean}-01`, to: `${clean}-${String(_daysInMonth(y, m)).padStart(2, '0')}` };
    }
    if (clean.startsWith('week:')) {
        const monIso = clean.slice(5);
        if (/^\d{4}-\d{2}-\d{2}$/.test(monIso)) {
            const [y, m, d] = monIso.split('-').map(Number);
            return _weekBounds(new Date(y, m - 1, d));
        }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean))
        return { from: clean, to: clean };
    return { from: '', to: '' };
}

const money = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

export default {
    imports: 'oda//button, oda//packets',
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
        .filter-strip {
            @apply --horizontal;
            flex-shrink: 0;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            padding: 3px 8px;
            min-height: 28px;
            background: light-dark(#efeee4, #24252b);
            border-bottom: 1px solid light-dark(#b5b4ac, #3e4049);
            font-size: 12px;
        }
        .filter-strip input:not([type]),
        .filter-strip select {
            min-width: 0;
            padding: 2px 6px;
            font-size: 12px;
            border: 1px solid light-dark(#b8b7ae, #3e4049);
            border-radius: 3px;
            background: light-dark(#ffffff, #1b1c20);
            color: inherit;
        }
        .filter-strip input:not([type]) {
            width: 170px;
        }
        .filter-strip label {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            user-select: none;
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
            border-top: 1px solid light-dark(#b5b4ac, #3e4049);
        }
        div.head, div.row {
            display: grid !important;
            grid-template-columns: 84px minmax(125px, 1.3fr) minmax(115px, 1.2fr) minmax(115px, 1.2fr) minmax(115px, 1.2fr) minmax(115px, 1.2fr) minmax(94px, 0.95fr) minmax(72px, 0.7fr) 74px;
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
            padding: 4px 7px;
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
            padding: 4px 7px;
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
        .cell.link {
            cursor: pointer;
            text-decoration: underline;
        }
        .storno {
            color: var(--error-color, #c53030);
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
        .row.total .cell {
            border-right: 1px solid light-dark(#b8b7ae, #3e4049);
        }
        .row.total .cell:last-child {
            border-right: none;
        }
        .entry-card {
            @apply --vertical;
            flex-shrink: 0;
            gap: 8px;
            margin: 8px;
            padding: 10px 12px;
            border: 2px solid #4f6bed;
            border-radius: 6px;
            background: light-dark(#ffffff, #22232a);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
        }
        .entry-bar {
            @apply --horizontal;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        .entry-sides {
            @apply --horizontal;
            gap: 12px;
        }
        .entry-side {
            @apply --vertical;
            flex: 1;
            gap: 4px;
            padding: 8px;
            border: 1px solid light-dark(#d2d1c8, #3e4049);
            border-radius: 4px;
            background: light-dark(#fafaf7, #1b1c20);
        }
        .entry-side-title {
            font-weight: 700;
            border-bottom: 1px solid light-dark(#e2e2dc, #2f3038);
            padding-bottom: 4px;
        }
        .btn-action {
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 600;
            border: 1px solid light-dark(#b8b7ae, #4a4c56);
            border-radius: 3px;
            background: light-dark(linear-gradient(180deg, #fafaf8 0%, #e8e7de 100%), linear-gradient(180deg, #32343a 0%, #26282d 100%));
            color: inherit;
            cursor: pointer;
        }
    </style>

    <oda-packets no-flex mode="month" ~if="packetsStart"
        :start="packetsStart" :end="packetsEnd" :days="packetDays"
        ::value="packetsKey" @selection-changed="onPackets($event)"></oda-packets>

    <div class="filter-strip">
        <input :value="account" placeholder="Счёт (например 41, 62)…" @change="setAccount($this.value)">
        <input :value="opClass" placeholder="Класс операций…" @change="setOpClass($this.value)">
        <select ~if="units.length > 1" title="Подразделение" @change="setUnit($this.value)">
            <option value="" :selected="!unit">Все подразделения</option>
            <option ~for="units" :value="$for.item.cid" :selected="$for.item.cid === unit">{{$for.item.label}}</option>
        </select>
        <label><input type="checkbox" :checked="effective" @change="setEffective($this.checked)"> только действующие</label>
    </div>

    <div class="error" ~if="error">{{error}}</div>

    <div class="grid">
        <div class="head-wrap">
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
        </div>
        <div class="grid-body">
            <div class="row" ~for="displayRows" ~class="{storno: $for.item.storno}" @dblclick="openEntry($for.item.entry)">
                <div class="cell link" title="Открыть карточку проводки" @tap="openEntry($for.item.entry)">{{$for.item.date}}</div>
                <div class="cell link" @tap="openOperation($for.item)">{{$for.item.op}}</div>
                <div class="cell link" @tap="openAccount($for.item, 'debit')">{{$for.item.debit}}</div>
                <div class="cell">{{$for.item.debitAnalytics}}</div>
                <div class="cell link" @tap="openAccount($for.item, 'credit')">{{$for.item.credit}}</div>
                <div class="cell">{{$for.item.creditAnalytics}}</div>
                <div class="cell num">{{$for.item.amount}}</div>
                <div class="cell num">{{$for.item.qty}}</div>
                <div class="cell">{{$for.item.status}}</div>
            </div>
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

    <!-- Экран 4 ODANT: Сборная карточка проводки -->
    <div class="entry-card" ~if="entryCard">
        <div class="entry-bar">
            <strong>Проводка #{{entryCard.entry}}</strong>
            <span>Сумма: <strong>{{money(entryCard.amount)}}</strong></span>
            <span ~if="entryCard.qty">Кол-во: {{entryCard.qty}}</span>
            <span class="storno" ~if="entryCard.storno">[СТОРНО]</span>
            <span style="margin-left:auto;">Операция: <strong>{{entryCard.operation?.title}}</strong></span>
            <button type="button" class="btn-action" @tap="closeEntry()">Закрыть</button>
        </div>
        <div class="entry-sides">
            <div class="entry-side">
                <div class="entry-side-title">ДЕБЕТ: {{entryCard.debit?.label}}</div>
                <div>Сумма Дт: <strong>{{money(entryCard.debit?.amount)}}</strong></div>
                <div ~for="entryCard.debit?.analytics">
                    <span>{{$for.item.label}}:</span> <strong>{{$for.item.title || '—'}}</strong>
                </div>
            </div>
            <div class="entry-side">
                <div class="entry-side-title">КРЕДИТ: {{entryCard.credit?.label}}</div>
                <div>Сумма Кт: <strong>{{money(entryCard.credit?.amount)}}</strong></div>
                <div ~for="entryCard.credit?.analytics">
                    <span>{{$for.item.label}}:</span> <strong>{{$for.item.title || '—'}}</strong>
                </div>
            </div>
        </div>
    </div>
    `,
    packetsKey: { $def: '*', $type: String, $save: true },
    packetsStart: '',
    packetsEnd: '',
    packetDays: null,
    _packetFiltered: false,
    _initializingPackets: false,
    _attachedDone: false,
    _initialNav: null,
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
    entryCard: null,
    error: '',
    money,
    get countText() {
        const n = (this.items || []).length;
        return n < this.count ? `Записей: ${n} из ${this.count}` : `Записей: ${n}`;
    },
    /** Счёт для показа: код (последний сегмент пути) и название (без дублирования кода). */
    accountText(cid) {
        const code = String(cid || '').split('/').pop().replace(/^acc\./, '');
        const label = String(this.names?.classes?.[cid] || '').trim();
        if (!label || label === code)
            return code;
        if (label.startsWith(code + ' ') || label.startsWith(code + '.') || /^\d+(?:\.\d+)?\s/.test(label))
            return label;
        return `${code} ${label}`;
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
            entry: e.id || e.entry || null,
            op_id: e.op_id || '',
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
    async setAccount(val) {
        this.account = String(val || '');
        await this.reload();
    },
    async setOpClass(val) {
        this.opClass = String(val || '');
        await this.reload();
    },
    async setUnit(val) {
        this.unit = String(val || '');
        await this.reload();
    },
    async setEffective(val) {
        this.effective = !!val;
        await this.reload();
    },
    async onPackets(e) {
        const d = e?.detail?.value ?? e?.detail ?? {};
        if (Array.isArray(d))
            return;
        if (this._initializingPackets)
            return;
        if (d.selected?.name === '*') {
            _writeSavedPeriod('*', '', '');
            if (this._packetFiltered || this.from || this.to) {
                this._packetFiltered = false;
                this.from = '';
                this.to = '';
                await this.reload();
            }
            return;
        }
        if (d.period?.start && d.period?.end) {
            const changed = this.from !== d.period.start || this.to !== d.period.end || !this._packetFiltered;
            this._packetFiltered = true;
            this.from = d.period.start;
            this.to = d.period.end;
            _writeSavedPeriod(this.packetsKey, this.from, this.to);
            if (changed)
                await this.reload();
        }
    },
    _restorePeriodState(nav = null) {
        const hasNavPeriod = nav && (nav.from !== undefined || nav.to !== undefined || nav.packetsKey);
        if (!hasNavPeriod && (this.from || this.to))
            return;
        const saved = _readSavedPeriod();
        const localSavedKey = typeof this.loadFromLocalStorage === 'function' ? this.loadFromLocalStorage('packetsKey') : undefined;
        if (typeof localSavedKey === 'string' && localSavedKey && (typeof this.packetsKey !== 'string' || this.packetsKey === '*'))
            this.packetsKey = localSavedKey;
        const pk = typeof this.packetsKey === 'string' ? this.packetsKey : '';
        const src = hasNavPeriod ? nav : (saved || (pk && pk !== '*' ? { packetsKey: pk } : null));
        if (!src)
            return;
        this._initializingPackets = true;
        try {
            const rawKey = typeof src.packetsKey === 'string' && src.packetsKey ? src.packetsKey : (pk || '*');
            let from = String(src.from || '');
            let to = String(src.to || '');
            if (!from && !to && rawKey !== '*') {
                const derived = _boundsFromPacketsKey(rawKey, 'month');
                if (derived.from && derived.to) {
                    from = derived.from;
                    to = derived.to;
                }
            }
            const key = _derivePacketsKey(from, to, rawKey);
            this.from = from;
            this.to = to;
            this._packetFiltered = !!(from || to);
            this.packetsKey = key;
        }
        finally {
            this._initializingPackets = false;
        }
    },
    async openEntry(entryId) {
        if (!entryId || !this.$item)
            return null;
        this.error = '';
        try {
            this.entryCard = await this.$item.fetch('db_entry', { entry: entryId });
            return this.entryCard;
        }
        catch (e) {
            this.error = String(e?.message || e);
            return null;
        }
    },
    closeEntry() {
        this.entryCard = null;
    },
    async attached() {
        const initNav = this._initialNav;
        this._initialNav = null;
        this._restorePeriodState(initNav);
        await this.loadScope();
        await this.reload();
        this._attachedDone = true;
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
    _syncPacketRange(res) {
        if (!res)
            return false;
        if (!('range' in res)) {
            if (!this.packetsStart) {
                this.packetsStart = _yearStart();
                this.packetsEnd = _yearEnd();
            }
            return false;
        }
        const r = res.range;
        if (!r || !r.start || !r.end) {
            this.packetsStart = '';
            this.packetsEnd = '';
            this.packetDays = null;
            return false;
        }
        this.packetsStart = r.start;
        this.packetsEnd = r.end;
        this.packetDays = Array.isArray(r.days) && r.days.length ? r.days : null;
        const keyStr = typeof this.packetsKey === 'string' ? this.packetsKey : '';
        const isNowKey = keyStr === 'now' || keyStr.startsWith('now:');
        if (this._packetFiltered && !isNowKey && this.to && this.to < r.start) {
            this._initializingPackets = true;
            try {
                this._packetFiltered = false;
                this.from = '';
                this.to = '';
                this.packetsKey = '*';
                _writeSavedPeriod('*', '', '');
            }
            finally {
                this._initializingPackets = false;
            }
            return true;
        }
        return false;
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
            if (this._syncPacketRange(res))
                return await this.reload();
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
    async openPath(path, nav) {
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (t && window.execute)
                window.execute(t, nav);
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Класс операции (её форма — список операций с окном редактора). */
    openOperation(row) {
        const nav = row?.op_id ? { view: 'objects', id: row.op_id } : undefined;
        return this.openPath(this.names?.paths?.[row.op_cid] || row.op_cid, nav);
    },
    openAccount(row, side) {
        const cid = side === 'debit' ? row.debit_cid : row.credit_cid;
        return this.openPath(this.names?.paths?.[cid] || cid);
    },
};
