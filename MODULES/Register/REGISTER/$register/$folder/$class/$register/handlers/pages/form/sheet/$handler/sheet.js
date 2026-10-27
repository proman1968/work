/**
 * form/sheet — Экран 1 ODANT: Общая оборотно-сальдовая ведомость Журнала (`db_sheet`, sources/data/api.js).
 * Сверху — полоса периодов `oda-packets` с запоминанием выбранного периода.
 * В центре — таблица с двухслойным заголовком (Счёт / Субсчёт | На начало: Дебет/Кредит | За период: Дебет/Кредит | На конец: Дебет/Кредит),
 * вертикальными разделителями и прижатым к низу футером итогов.
 * Переходы к счёту (Обороты | Анализ | Проводки) работают через штатные $handler Счёта на сервисной панели формы (`focusedItem`).
 */

const PERIOD_STORAGE_KEY = 'work.accounting.period';

function _day(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const _today = () => _day(new Date());
const _yearStart = () => `${new Date().getFullYear()}-01-01`;
const _yearEnd = () => _today();

const money = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

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
        div.head-top, div.head, div.row {
            display: grid !important;
            grid-template-columns: minmax(220px, 2.6fr) repeat(6, minmax(90px, 1fr));
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
        .head-top {
            border-bottom: 1px solid light-dark(#b8b7ae, #3e4049);
            font-weight: 600;
            font-size: 12px;
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
            cursor: pointer;
        }
        div.row:hover:not(.selected):not(.total) {
            background: light-dark(#f2f5fb, rgba(255, 255, 255, 0.05));
        }
        div.row.selected {
            background: #6882d6 !important;
            color: #ffffff !important;
        }
        div.row.selected .cell {
            background: transparent !important;
            color: #ffffff !important;
            border-right-color: rgba(255, 255, 255, 0.3) !important;
        }
        div.row.selected .cell.acc {
            border-right-color: rgba(255, 255, 255, 0.55) !important;
        }
        .cell {
            min-width: 0;
            padding: 4px 8px;
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
            padding: 3px 8px;
        }
        .head-wrap .cell:last-child {
            border-right: none;
        }
        .cell.span2 {
            grid-column: span 2;
            justify-content: center;
            text-align: center;
            border-right: 1px solid light-dark(#9a9990, #4a4c56);
        }
        .cell.span2:last-child {
            border-right: none;
        }
        .cell.acc {
            border-right: 2px solid light-dark(#8c8b82, #52545f) !important;
        }
        .head .cell.acc.sub-head {
            padding-left: 20px;
        }
        .grid-body div.row .cell.acc {
            background: light-dark(#f6f6f4, #222328);
            text-indent: 8px;
        }
        .grid-body div.row:hover:not(.selected) .cell.acc {
            background: light-dark(#ebeff8, #282a32);
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
        .cell.group-sep {
            border-right: 1px solid light-dark(#9a9990, #4a4c56);
        }
        .grid-body div.row .cell.debit-col {
            background: light-dark(rgba(224, 245, 248, 0.32), rgba(56, 189, 248, 0.03));
        }
        .grid-body div.row .cell.credit-col {
            background: light-dark(rgba(253, 230, 238, 0.32), rgba(244, 114, 182, 0.03));
        }
        div.row.top-level, div.row.group {
            font-weight: 700;
        }
        div.row.detail .cell.acc {
            font-weight: 400;
            font-style: italic;
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
        .row.total .cell.acc {
            justify-content: space-between;
        }
        .row-count {
            font-weight: 600;
            opacity: 0.85;
            margin-left: 8px;
        }
    </style>
    <oda-packets no-flex mode="month" ~if="packetsStart"
        :start="packetsStart" :end="packetsEnd" :days="packetDays"
        ::value="packetsKey" @selection-changed="onPackets($event)"></oda-packets>
    <div class="error" ~if="error">{{error}}</div>
    <div class="grid">
        <div class="head-wrap">
            <div class="head-top">
                <div class="cell acc">Счёт</div>
                <div class="cell span2">На начало</div>
                <div class="cell span2">За период</div>
                <div class="cell span2">На конец</div>
            </div>
            <div class="head">
                <div class="cell acc sub-head">Субсчёт</div>
                <div class="cell num">Дебет</div>
                <div class="cell num group-sep">Кредит</div>
                <div class="cell num">Дебет</div>
                <div class="cell num group-sep">Кредит</div>
                <div class="cell num">Дебет</div>
                <div class="cell num">Кредит</div>
            </div>
        </div>
        <div class="grid-body">
            <div class="row" ~class="{group: !$for.item.leaf, 'top-level': $for.item.level === 0, detail: $for.item.detail, selected: selectedRow?.account === $for.item.account && selectedRow?.label === $for.item.label}"
                ~for="displayRows" @tap="selectRow($for.item)" @dblclick="open($for.item)">
                <div class="cell acc" ~style="{paddingLeft: $for.item.indent + 'px'}">{{$for.item.label}}</div>
                <div class="cell num debit-col">{{$for.item.open_debit}}</div>
                <div class="cell num credit-col group-sep">{{$for.item.open_credit}}</div>
                <div class="cell num debit-col">{{$for.item.debit}}</div>
                <div class="cell num credit-col group-sep">{{$for.item.credit}}</div>
                <div class="cell num debit-col">{{$for.item.close_debit}}</div>
                <div class="cell num credit-col">{{$for.item.close_credit}}</div>
            </div>
        </div>
        <div class="row total">
            <div class="cell acc"><span>Итого</span><span class="row-count">{{displayRows.length}}</span></div>
            <div class="cell num">{{totals.open_debit}}</div>
            <div class="cell num group-sep">{{totals.open_credit}}</div>
            <div class="cell num">{{totals.debit}}</div>
            <div class="cell num group-sep">{{totals.credit}}</div>
            <div class="cell num">{{totals.close_debit}}</div>
            <div class="cell num">{{totals.close_credit}}</div>
        </div>
    </div>
    `,
    packetsKey: { $def: '*', $type: String, $save: true },
    packetsStart: _yearStart(),
    packetsEnd: _yearEnd(),
    packetDays: null,
    _packetFiltered: false,
    _initializingPackets: false,
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
    focusedItem: null,
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
    /** Подпись строки: счёт — код и название (без дублирования кода), строка разворота — объекты аналитик. */
    rowLabel(r) {
        if (r.key)
            return Object.values(r.key).map(id => (id === null ? '—' : this.names?.objects?.[id] || id)).join(' / ');
        const code = String(r.account || '').split('/').pop().replace(/^acc\./, '');
        const label = String(r.label || this.names?.classes?.[r.account] || '').trim();
        if (!label || label === code)
            return code;
        if (label.startsWith(code + ' ') || label.startsWith(code + '.') || /^\d+(?:\.\d+)?\s/.test(label))
            return label;
        return `${code} ${label}`;
    },
    get displayRows() {
        return (this.rows || []).map(r => ({
            account: r.account,
            key: r.key || null,
            label: this.rowLabel(r),
            leaf: !!r.leaf,
            detail: !!r.key,
            level: Number(r.level) || 0,
            indent: (Number(r.level) || 0) * 16,
            ...this.cells(r),
        }));
    },
    selectRow(row) {
        this.selectedRow = row || null;
        this._syncFocusedAccount(this.selectedRow);
    },
    async _syncFocusedAccount(row) {
        const path = this.names?.paths?.[row?.account] || row?.account;
        if (!path || typeof WORK === 'undefined' || typeof WORK.get_item !== 'function') {
            this.focusedItem = null;
            return;
        }
        try {
            const item = await WORK.get_item(path);
            if (this.selectedRow !== row)
                return;
            this.focusedItem = item || null;
            const host = this.domHost || this.parentElement;
            if (host && 'focusedItem' in host)
                host.focusedItem = this.focusedItem;
        }
        catch {
            this.focusedItem = null;
        }
    },
    buildDrilldownNav(viewId = 'postings') {
        const target = this.selectedRow || this.displayRows?.[0];
        const mode = viewId === 'turnovers' ? 'turnovers' : viewId === 'analysis' ? 'analysis' : 'card';
        const nav = {
            view: viewId,
            mode,
            packetsKey: this.packetsKey || _derivePacketsKey(this.from, this.to),
            from: this.from || '',
            to: this.to || '',
            unit: this.unit || '',
        };
        if (target?.key && typeof target.key === 'object') {
            const filters = Object.fromEntries(Object.entries(target.key).filter(([, v]) => v));
            if (Object.keys(filters).length)
                nav.filters = filters;
        }
        return nav;
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
        const src = hasNavPeriod ? nav : saved;
        if (!src)
            return;
        this._initializingPackets = true;
        try {
            const from = String(src.from || '');
            const to = String(src.to || '');
            const key = _derivePacketsKey(from, to, typeof src.packetsKey === 'string' ? src.packetsKey : '*');
            this.from = from;
            this.to = to;
            this._packetFiltered = !!(from || to);
            this.packetsKey = key;
        }
        finally {
            this._initializingPackets = false;
        }
    },
    async applyNav(nav) {
        if (!nav || typeof nav !== 'object')
            return;
        this._restorePeriodState(nav);
        if (nav.unit !== undefined)
            this.unit = String(nav.unit || '');
        if (nav.account !== undefined)
            this.account = String(nav.account || '');
        if (nav.by !== undefined)
            this.by = String(nav.by || '');
        _writeSavedPeriod(this.packetsKey, this.from, this.to);
        await this.reload();
    },
    async attached() {
        this._restorePeriodState();
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
    _syncPacketRange(res) {
        if (!res || !('range' in res))
            return false;
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
        if (this._packetFiltered && ((this.to && this.to < r.start) || (this.from && this.from > r.end))) {
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
        this.rows = [];
        this.total = null;
        this.error = '';
        if (!this.$item)
            return;
        try {
            const res = await this.$item.fetch('db_sheet', this.params());
            if (this._syncPacketRange(res))
                return await this.reload();
            this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
            this.rows = Array.isArray(res?.rows) ? res.rows : [];
            this.total = res?.total || null;
            if (this.displayRows.length) {
                const prevAcc = this.selectedRow?.account;
                const found = prevAcc && this.displayRows.find(r => r.account === prevAcc && r.label === this.selectedRow?.label);
                this.selectRow(found || this.displayRows[0]);
            }
            else {
                this.selectRow(null);
            }
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
            const view = mode === 'turnovers' ? 'turnovers' : mode === 'analysis' ? 'analysis' : 'postings';
            const nav = {
                view,
                from: this.from,
                to: this.to,
                unit: this.unit,
            };
            if (typeof this.packetsKey === 'string' && this.packetsKey !== '*')
                nav.packetsKey = this.packetsKey;
            if (mode)
                nav.mode = mode;
            if (target?.key && typeof target.key === 'object') {
                const filters = Object.fromEntries(Object.entries(target.key).filter(([, v]) => v));
                if (Object.keys(filters).length)
                    nav.filters = filters;
            }
            if (typeof this.packetsKey === 'string')
                _writeSavedPeriod(this.packetsKey, this.from, this.to);
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
