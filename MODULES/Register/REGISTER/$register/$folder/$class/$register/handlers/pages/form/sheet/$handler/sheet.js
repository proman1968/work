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
            background: var(--header-background);
            color: var(--header-color);
            border-bottom: 1px solid var(--border-color);
            user-select: none;
            scrollbar-gutter: stable;
            overflow-y: hidden;
        }
        .head-top {
            border-bottom: 1px solid var(--border-color);
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
            background: var(--content-background);
        }
        div.row {
            flex-shrink: 0;
            min-height: 25px;
            border-bottom: 1px solid var(--subtle-border);
            cursor: pointer;
        }
        div.row:hover:not(.selected):not(.total) {
            background: var(--accent-soft);
        }
        div.row.selected {
            background: var(--selected-background) !important;
            color: var(--selected-color) !important;
        }
        div.row.selected .cell {
            background: transparent !important;
            color: var(--selected-color) !important;
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
            border-right: 1px solid var(--subtle-border);
        }
        .cell:last-child {
            border-right: none;
        }
        .head-wrap .cell {
            border-right: 1px solid var(--border-color);
            padding: 3px 8px;
        }
        .head-wrap .cell:last-child {
            border-right: none;
        }
        .cell.span2 {
            grid-column: span 2;
            justify-content: center;
            text-align: center;
            border-right: 1px solid var(--border-color);
        }
        .cell.span2:last-child {
            border-right: none;
        }
        .cell.acc {
            border-right: 2px solid var(--border-color) !important;
        }
        .head .cell.acc.sub-head {
            padding-left: 20px;
        }
        .grid-body div.row .cell.acc {
            background: var(--subtle-background);
            text-indent: 8px;
        }
        .grid-body div.row:hover:not(.selected) .cell.acc {
            background: var(--accent-soft);
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
            border-right: 1px solid var(--border-color);
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
            background: var(--header-background);
            color: var(--header-color);
            border-top: 2px solid var(--border-color);
            border-bottom: none;
            scrollbar-gutter: stable;
            overflow-y: hidden;
            cursor: default;
        }
        .row.total .cell {
            border-right: 1px solid var(--border-color);
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
    <oda-packets no-flex mode="month"
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
        <div class="grid-body" @tap="onGridBodyTap($event)">
            <div class="row" ~class="{group: !$for.item.leaf, 'top-level': $for.item.level === 0, detail: $for.item.detail, selected: selectedRow?.account === $for.item.account && selectedRow?.label === $for.item.label}"
                ~for="displayRows" @tap.stop="selectRow($for.item)" @dblclick="open($for.item)" @contextmenu.stop.prevent="onRowContextMenu($for.item, $event)">
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
    _attachedDone: false,
    _initialNav: null,
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
    fallbackFocusedItem: null,
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
    rowHasPostings(r) {
        if (!r)
            return false;
        if (typeof r.hasPostings === 'boolean')
            return r.hasPostings;
        if (r.opening || r.turnover || r.closing) {
            return Boolean(
                Number(r.opening?.debit) || Number(r.opening?.credit)
                || Number(r.turnover?.debit) || Number(r.turnover?.credit)
                || Number(r.closing?.debit) || Number(r.closing?.credit)
                || Number(r.qty?.opening) || Number(r.qty?.debit) || Number(r.qty?.credit) || Number(r.qty?.closing)
            );
        }
        return Boolean(r.open_debit || r.open_credit || r.debit || r.credit || r.close_debit || r.close_credit);
    },
    rowHasAnalytics(r) {
        if (!r)
            return false;
        if (typeof r.hasAnalytics === 'boolean')
            return r.hasAnalytics;
        if (r.key && typeof r.key === 'object' && Object.keys(r.key).length)
            return true;
        if ((this.rows || []).some(x => x.account === r.account && x.key))
            return true;
        return Array.isArray(this.slots) && this.slots.length > 0;
    },
    isToolDisabled(tool) {
        const row = this.selectedRow;
        if (!row || !this.rowHasPostings(row))
            return true;
        if (tool?.id === 'analysis' && !this.rowHasAnalytics(row))
            return true;
        return false;
    },
    get displayRows() {
        return (this.rows || []).map(r => ({
            account: r.account,
            key: r.key || null,
            label: this.rowLabel(r),
            leaf: !!r.leaf,
            detail: !!r.key,
            hasAnalytics: this.rowHasAnalytics(r),
            hasPostings: this.rowHasPostings(r),
            level: Number(r.level) || 0,
            indent: (Number(r.level) || 0) * 16,
            ...this.cells(r),
        }));
    },
    _findFormHost() {
        if (this.$form && ('focusedItem' in this.$form || typeof this.$form.syncFromView === 'function'))
            return this.$form;
        for (let p = this.parentElement || this.domHost; p; p = p.parentElement || p.domHost) {
            if (p.localName === 'work-form' || typeof p.syncFromView === 'function' || 'focusedItem' in p)
                return p;
        }
        return null;
    },
    _notifyForm() {
        const host = this._findFormHost();
        if (!host)
            return;
        if (typeof host.syncFromView === 'function')
            host.syncFromView(this);
        else
            host.focusedItem = this.focusedItem;
    },
    onGridBodyTap(e) {
        if (!e?.target?.closest?.('.row'))
            this.selectRow(null);
    },
    selectRow(row) {
        this.selectedRow = row || null;
        this._syncFocusedAccount(this.selectedRow);
    },
    async _ensureFallbackFocused() {
        if (this.fallbackFocusedItem)
            return this.fallbackFocusedItem;
        if (typeof WORK === 'undefined' || typeof WORK.get_item !== 'function')
            return null;
        const firstRow = this.displayRows?.[0];
        const firstPath = (firstRow && (this.names?.paths?.[firstRow.account] || firstRow.account))
            || (this.$item?.short ? `${this.$item.short}/$register/$folder/$class/$account` : '');
        if (!firstPath)
            return null;
        try {
            this.fallbackFocusedItem = await WORK.get_item(firstPath);
        }
        catch {
            this.fallbackFocusedItem = null;
        }
        return this.fallbackFocusedItem;
    },
    async _syncFocusedAccount(row) {
        const path = this.names?.paths?.[row?.account] || row?.account || '';
        if (!row || !path) {
            this.focusedItem = null;
            await this._ensureFallbackFocused();
            this._notifyForm();
            return;
        }
        // Мгновенно выставляем фокус с путём, чтобы кнопки переключились без ожидания сети
        this.focusedItem = { path, short: path };
        this._notifyForm();
        if (typeof WORK === 'undefined' || typeof WORK.get_item !== 'function')
            return;
        try {
            await this._ensureFallbackFocused();
            const item = await WORK.get_item(path);
            if (this.selectedRow !== row)
                return;
            if (item) {
                this.focusedItem = item;
                this._notifyForm();
            }
        }
        catch {
            /* оставляем { path, short: path } */
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
    _applyNavFields(nav) {
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
    },
    async applyNav(nav) {
        if (!nav || typeof nav !== 'object')
            return;
        this._applyNavFields(nav);
        await this.reload();
    },
    async attached() {
        if (this._attachedDone && !this._initialNav)
            return;
        const initNav = this._initialNav;
        this._initialNav = null;
        if (initNav)
            this._applyNavFields(initNav);
        else
            this._restorePeriodState();
        await Promise.all([this.loadSlots(), this.loadScope(), this.reload()]);
        this._attachedDone = true;
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
        this.error = '';
        if (!this.$item) {
            this.rows = [];
            this.total = null;
            return;
        }
        try {
            const res = await this.$item.fetch('db_sheet', this.params());
            if (this._syncPacketRange(res))
                return await this.reload();
            this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
            this.rows = Array.isArray(res?.rows) ? res.rows : [];
            this.total = res?.total || null;
            if (this.displayRows.length) {
                const prevAcc = this.selectedRow?.account;
                const found = prevAcc ? this.displayRows.find(r => r.account === prevAcc && r.label === this.selectedRow?.label) : null;
                this.selectRow(found || null);
            }
            else {
                this.selectRow(null);
            }
        }
        catch (e) {
            this.error = String(e?.message || e);
            this.selectRow(null);
        }
    },
    async onRowContextMenu(row, e) {
        if (!row)
            return;
        await this.selectRow(row);
        const path = this.names?.paths?.[row.account] || row.account;
        if (!path || typeof WORK?.showMenu !== 'function')
            return;
        try {
            const t = await WORK.get_item(path);
            if (t)
                await WORK.showMenu({ $item: t, mode: 'handlers' }, e);
        }
        catch { /* ignore */ }
    },
    async open(row, mode = '') {
        const target = row || this.selectedRow;
        if (!target || !this.rowHasPostings(target))
            return;
        if (mode === 'analysis' && !this.rowHasAnalytics(target))
            return;
        const path = this.names?.paths?.[target?.account] || target?.account;
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (!t || !window.execute)
                return;
            const effectiveMode = mode || (target.detail ? '' : (this.rowHasAnalytics(target) ? 'analysis' : 'turnovers'));
            const view = effectiveMode === 'turnovers' ? 'turnovers' : effectiveMode === 'analysis' ? 'analysis' : 'postings';
            const nav = {
                view,
                from: this.from,
                to: this.to,
                unit: this.unit,
            };
            if (typeof this.packetsKey === 'string' && this.packetsKey !== '*')
                nav.packetsKey = this.packetsKey;
            if (effectiveMode)
                nav.mode = effectiveMode;
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
