/**
 * form/postings — экранная форма счёта ($account) на учётном ядре (sources/data/api.js).
 * Объединяет три режима работы со счётом по модели ODANT и сборную карточку проводки:
 * - `mode: 'card'` (по умолчанию) — проводки счёта (`db_card`) с сальдо после каждой записи;
 * - `mode: 'analysis'` (Экран 2 ODANT) — Анализ счёта в разрезе аналитик (`db_sheet`),
 *   слева панель аналитик (порядок иерархии ↑↓, фильтр по значениям и субаналитикам)
 *   и переключатель ЗНАЧЕНИЯ (Сумма / Количество), справа таблица с двухслойным заголовком, быстрым фильтром и прижатым футером Итого;
 * - `mode: 'turnovers'` (Экран 3 ODANT) — двухпанельные Обороты счёта (`db_turnovers`):
 *   слева радиокнопки ГРУППИРОВАТЬ (Нет / Дни / Недели / Месяцы / Кварталы / Годы / Операции / Счета / Все)
 *   и сводная таблица периодов с сальдо и оборотом, справа — документы выбранного периода с переходом к проводке и документу;
 * - `entryCard` (Экран 4 ODANT) — сборная карточка проводки (`db_entry`) из записей счёта Дебета и счёта Кредита.
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
const qtyFmt = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 4 }) : '');
/** Сальдо со знаком (Дт − Кт) текстом: «1 200,00 Дт», «300,00 Кт». */
const saldo = v => (Number(v) > 0 ? money(v) + ' Дт' : Number(v) < 0 ? money(-v) + ' Кт' : '0');

export const TURNOVER_GROUPS = [
    { id: 'none', label: 'Нет' },
    { id: 'day', label: 'Дни' },
    { id: 'week', label: 'Недели' },
    { id: 'month', label: 'Месяцы' },
    { id: 'quarter', label: 'Кварталы' },
    { id: 'year', label: 'Годы' },
    { id: 'operation', label: 'Операции' },
    { id: 'account', label: 'Счета' },
    { id: 'all', label: 'Все' },
];

/** Парсинг строки фильтра субаналитики: «поле:значение» или просто текст поиска по name. */
function parseSubFilterInput(raw) {
    const s = String(raw || '').trim();
    if (!s)
        return null;
    const colon = s.indexOf(':');
    const eq = s.indexOf('=');
    const sep = colon > 0 && (eq < 0 || colon < eq) ? colon : eq;
    if (sep > 0) {
        const field = s.slice(0, sep).trim();
        const val = s.slice(sep + 1).trim();
        return field && val ? { [field]: { contains: val } } : null;
    }
    return { name: { contains: s } };
}

export default {
    imports: 'oda//button, oda//packets, ~/lib//editor-form',
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
        /* Компактная полоса отбора аналитик над Оборотами и Проводками */
        .filter-strip {
            @apply --horizontal;
            @apply --light;
            color: var(--content-color);
            flex-shrink: 0;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            padding: 3px 8px;
            min-height: 28px;
            border-bottom: 1px solid var(--border-color);
            font-size: 12px;
        }
        .filter-strip-label {
            font-weight: 600;
            color: var(--muted-color);
        }
        .filter-slot-item {
            @apply --horizontal;
            align-items: center;
            gap: 4px;
            width: 185px;
        }
        .filter-strip select {
            padding: 2px 6px;
            font-size: 12px;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xs, 3px);
            background: var(--content-background);
            color: var(--content-color);
        }

        /* Общие табличные стили (единые с Ведомостью sheet.js и oda-table) */
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
        }
        div.row:hover:not(.selected):not(.total):not(.opening-row) {
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
        .cell {
            min-width: 0;
            padding: 4px 7px;
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
            padding: 3px 7px;
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
        .cell.group-sep {
            border-right: 1px solid var(--border-color);
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
        .grid-body div.row .cell.debit-col {
            background: light-dark(rgba(224, 245, 248, 0.32), rgba(56, 189, 248, 0.03));
        }
        .grid-body div.row .cell.credit-col {
            background: light-dark(rgba(253, 230, 238, 0.32), rgba(244, 114, 182, 0.03));
        }
        .storno {
            color: var(--error-color);
        }
        div.row.opening-row, div.bar.opening {
            flex-shrink: 0;
            font-weight: 600;
            min-height: 24px;
            background: var(--light-background);
            color: var(--content-color);
            border-bottom: 1px solid var(--border-color);
            scrollbar-gutter: stable;
            overflow-y: hidden;
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
        .row-count {
            font-weight: 600;
            opacity: 0.85;
            margin-left: 8px;
        }

        /* Режим 1: Карточка проводок счёта (mode === 'card') */
        .card-grid {
            @apply --vertical;
            flex: 1;
            min-height: 0;
            overflow: hidden;
            border-top: 1px solid light-dark(#b5b4ac, #3e4049);
        }
        .card-grid div.head, .card-grid div.row, .card-grid div.bar.opening {
            display: grid !important;
            align-items: stretch;
        }

        /* Экран 2: Анализ счёта (mode === 'analysis') */
        .analysis-layout, .turnovers-layout {
            @apply --horizontal;
            flex: 1;
            min-height: 0;
            gap: 0;
            overflow: hidden;
            border-top: 1px solid light-dark(#b5b4ac, #3e4049);
        }
        .analysis-side {
            @apply --vertical;
            width: 245px;
            flex-shrink: 0;
            gap: 0;
            padding: 0;
            background: light-dark(#f3f2ea, #22232a);
            border-right: 1px solid light-dark(#9a9990, #4a4c56);
            overflow: hidden;
            font-size: 12px;
        }
        .analysis-side-top {
            @apply --horizontal;
            align-items: center;
            gap: 4px;
            padding: 4px 6px;
            border-bottom: 1px solid light-dark(#b8b7ae, #3e4049);
            background: light-dark(#e8e7dc, #26272f);
            flex-shrink: 0;
        }
        .slot-move-btn {
            padding: 2px 7px;
            font-size: 12px;
            line-height: 1.2;
            border: 1px solid light-dark(#b8b7ae, #4a4c56);
            border-radius: 2px;
            background: light-dark(#fff, #32343e);
            color: inherit;
            cursor: pointer;
        }
        .slot-move-btn:hover {
            background: light-dark(#eef2fa, #3d404c);
        }
        .features-grid {
            @apply --vertical;
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            background: light-dark(#ffffff, #1b1c20);
            border-bottom: 1px solid light-dark(#b8b7ae, #3e4049);
        }
        .feat-head, .feat-row {
            display: grid !important;
            grid-template-columns: minmax(105px, 1.05fr) minmax(95px, 1fr);
            align-items: stretch;
        }
        .feat-head {
            background: light-dark(#e3e1d3, #2a2b32);
            color: light-dark(#1f1f1f, #e2e8f0);
            border-bottom: 1px solid light-dark(#9a9990, #4a4c56);
            font-weight: 600;
            font-size: 11.5px;
            flex-shrink: 0;
        }
        .feat-row {
            min-height: 24px;
            border-bottom: 1px solid light-dark(#ecece8, #2c2d34);
            cursor: pointer;
            flex-shrink: 0;
        }
        .feat-row.selected {
            background: light-dark(#dbe4f8, rgba(104, 130, 214, 0.28));
        }
        .feat-cell {
            min-width: 0;
            padding: 2px 5px;
            display: flex;
            align-items: center;
            gap: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            border-right: 1px solid light-dark(#e2e2dc, #2f3038);
            box-sizing: border-box;
        }
        .feat-cell:last-child {
            border-right: none;
        }
        .feat-select {
            width: 100%;
            min-width: 0;
            padding: 1px 3px;
            font-size: 11.5px;
            border: 1px solid transparent;
            border-radius: 2px;
            background: transparent;
            color: light-dark(#1d4ed8, #93c5fd);
            cursor: pointer;
            outline: none;
        }
        .feat-select:focus, .feat-select:hover {
            border-color: light-dark(#b8b7ae, #4a4c56);
            background: light-dark(#fff, #24252c);
        }
        .analysis-side-bottom {
            @apply --vertical;
            gap: 3px;
            padding: 6px 8px;
            flex-shrink: 0;
            background: light-dark(#f3f2ea, #22232a);
        }
        .analysis-side-bottom label {
            display: flex;
            align-items: center;
            gap: 5px;
            cursor: pointer;
            user-select: none;
        }
        .analysis-main {
            @apply --vertical;
            flex: 1;
            min-width: 0;
            min-height: 0;
            overflow: hidden;
        }
        .analysis-table {
            @apply --vertical;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }
        .analysis-table div.head-top, .analysis-table div.head, .analysis-table div.filter-row, .analysis-table div.row {
            display: grid !important;
            grid-template-columns: minmax(210px, 2.5fr) repeat(6, minmax(90px, 1fr));
            align-items: stretch;
        }
        .filter-row {
            background: light-dark(#ffffff, #1f2026);
            border-top: 1px solid light-dark(#b8b7ae, #3e4049);
            min-height: 23px;
        }
        .filter-row .cell {
            padding: 1px 5px;
            gap: 4px;
        }
        .filter-mark {
            font-size: 10.5px;
            font-weight: 700;
            color: light-dark(#555, #94a3b8);
            flex-shrink: 0;
            user-select: none;
        }
        .inline-filter-input {
            flex: 1;
            min-width: 0;
            border: none;
            outline: none;
            background: transparent;
            color: inherit;
            font-size: 12px;
            padding: 1px 2px;
        }
        .analysis-table .grid-body div.row .cell.acc {
            background: light-dark(#f6f6f4, #222328);
        }
        .analysis-table div.row.group {
            font-weight: 700;
        }
        .analysis-table .row.total .cell.acc {
            justify-content: space-between;
        }

        /* Экран 3: Обороты счёта (mode === 'turnovers') */
        .group-title {
            font-weight: 700;
            font-size: 11.5px;
            letter-spacing: 0.02em;
            color: light-dark(#555, #cbd5e1);
            margin-bottom: 2px;
        }
        .periods-panel {
            @apply --vertical;
            flex: 1.12;
            min-width: 0;
            min-height: 0;
            overflow: hidden;
            border-right: 2px solid light-dark(#8c8b82, #52545f);
        }
        .periods-panel div.head, .periods-panel div.row {
            display: grid !important;
            grid-template-columns: minmax(110px, 1.3fr) repeat(4, minmax(82px, 1fr));
            align-items: stretch;
        }
        .periods-panel .grid-body div.row {
            cursor: pointer;
        }
        .docs-panel {
            @apply --vertical;
            flex: 1.38;
            min-width: 0;
            min-height: 0;
            overflow: hidden;
        }
        .docs-panel div.head, .docs-panel div.row {
            display: grid !important;
            grid-template-columns: 82px minmax(115px, 1.45fr) minmax(115px, 1.35fr) minmax(86px, 1fr) minmax(86px, 1fr) 30px;
            align-items: stretch;
        }
        .cell.entry-col {
            justify-content: center;
            padding: 0 2px;
        }
        .entry-icon-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 20px;
            padding: 0;
            border: 1px solid transparent;
            border-radius: 3px;
            background: transparent;
            color: light-dark(#444, #cbd5e1);
            cursor: pointer;
        }
        .entry-icon-btn:hover {
            border-color: light-dark(#b8b7ae, #4a4c56);
            background: light-dark(#eef2fa, #2d3039);
            color: light-dark(#1d4ed8, #93c5fd);
        }

        /* Экран 4: Сборная карточка проводки */
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
            padding: 3px 10px;
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

    <div class="error" ~if="error">{{error}}</div>

    <!-- Компактная полоса группировки, отбора по аналитикам и подразделению в Оборотах и Проводках -->
    <div class="filter-strip" ~if="mode !== 'analysis' && (mode === 'turnovers' || slots?.length || units.length > 1)">
        <span class="filter-strip-label" ~if="mode === 'turnovers'">Группировать:</span>
        <select ~if="mode === 'turnovers'" title="Группировать" @change="setGroupBy($this.value)">
            <option ~for="turnoverGroupOptions" :value="$for.item.id" :selected="$for.item.id === groupBy">{{$for.item.label}}</option>
        </select>
        <span class="filter-strip-label" ~if="slots?.length">Аналитики:</span>
        <div class="filter-slot-item" ~for="slots">
            <oda-link-input dense :meta="$for.item" ::value="filters[$for.item.id]" @value-changed="onFilterChanged()"></oda-link-input>
        </div>
        <select ~if="units.length > 1" title="Подразделение" @change="setUnit($this.value)">
            <option value="" :selected="!unit">Все подразделения</option>
            <option ~for="units" :value="$for.item.cid" :selected="$for.item.cid === unit">{{$for.item.label}}</option>
        </select>
    </div>

    <!-- Режим 1: Карточка проводок счёта (Проводки) -->
    <div class="grid card-grid" ~if="mode === 'card'">
        <div class="head-wrap">
            <div class="head" ~style="{gridTemplateColumns: cardGridCols}">
                <div class="cell">Дата</div>
                <div class="cell">Операция</div>
                <div class="cell num">Дебет</div>
                <div class="cell num">Кредит</div>
                <div class="cell num">Кол-во</div>
                <div class="cell" ~for="slots">{{$for.item.label}}</div>
                <div class="cell">Корр. счёт</div>
                <div class="cell num">Сальдо</div>
            </div>
            <div class="bar opening" ~style="{gridTemplateColumns: cardGridCols}">
                <div class="cell">На начало</div>
                <div class="cell"></div>
                <div class="cell num">{{money(opening.debit)}}</div>
                <div class="cell num">{{money(opening.credit)}}</div>
                <div class="cell num"></div>
                <div class="cell" ~for="slots"></div>
                <div class="cell"></div>
                <div class="cell num">{{openingText}}</div>
            </div>
        </div>
        <div class="grid-body">
            <div class="row" ~for="displayRows" ~class="{storno: $for.item.storno}" ~style="{gridTemplateColumns: cardGridCols}" @dblclick="openEntry($for.item.entry)">
                <div class="cell link" title="Открыть карточку проводки" @tap="openEntry($for.item.entry)">{{$for.item.date}}</div>
                <div class="cell link" title="Открыть документ операции" @tap="openOperation($for.item)">{{$for.item.op}}</div>
                <div class="cell num debit-col">{{$for.item.debit}}</div>
                <div class="cell num credit-col">{{$for.item.credit}}</div>
                <div class="cell num">{{$for.item.qty}}</div>
                <div class="cell" ~for="$for.item.slots">{{$for.$for.item}}</div>
                <div class="cell link" @tap="openCorr($for.item)">{{$for.item.corr}}</div>
                <div class="cell num">{{$for.item.bal}}</div>
            </div>
        </div>
        <div class="row total" ~style="{gridTemplateColumns: cardGridCols}">
            <div class="cell"><span>Обороты</span><span class="row-count">{{displayRows.length}}</span></div>
            <div class="cell">{{countText}}</div>
            <div class="cell num">{{money(turnover.debit)}}</div>
            <div class="cell num">{{money(turnover.credit)}}</div>
            <div class="cell num"></div>
            <div class="cell" ~for="slots"></div>
            <div class="cell">Сальдо на конец</div>
            <div class="cell num">{{closingText}}</div>
        </div>
    </div>

    <!-- Экран 2 ODANT: Анализ счёта в разрезе аналитик (колонки по числу привязанных аналитических справочников, без левой панели) -->
    <div class="analysis-layout" ~if="mode === 'analysis'">
        <div class="analysis-main">
            <div class="analysis-table">
                <div class="head-wrap">
                    <div class="head-top" ~style="{gridTemplateColumns: analysisGridCols}">
                        <div class="cell acc" ~style="{gridColumn: 'span ' + analysisSlots.length, justifyContent: 'space-between'}">
                            <span>Аналитика</span>
                            <span style="display:inline-flex; align-items:center; gap:10px; font-weight:500; font-size:11.5px;">
                                <label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="radio" name="valMode" value="amount" :checked="valueMode === 'amount'" @change="setValueMode('amount')"> Сумма</label>
                                <label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="radio" name="valMode" value="qty" :checked="valueMode === 'qty'" @change="setValueMode('qty')"> Кол-во</label>
                            </span>
                        </div>
                        <div class="cell span2">На начало</div>
                        <div class="cell span2">За период</div>
                        <div class="cell span2">На конец</div>
                    </div>
                    <div class="head" ~style="{gridTemplateColumns: analysisGridCols}">
                        <div class="cell" ~for="analysisSlots" ~class="{acc: $for.index === analysisSlots.length - 1}">{{$for.item.label}}</div>
                        <div class="cell num">Дебет</div>
                        <div class="cell num group-sep">Кредит</div>
                        <div class="cell num">Дебет</div>
                        <div class="cell num group-sep">Кредит</div>
                        <div class="cell num">Дебет</div>
                        <div class="cell num">Кредит</div>
                    </div>
                    <div class="filter-row" ~style="{gridTemplateColumns: analysisGridCols}">
                        <div class="cell" ~for="analysisSlots" ~class="{acc: $for.index === analysisSlots.length - 1}">
                            <span class="filter-mark">a%c</span>
                            <input class="inline-filter-input" :value="slotQueryOf($for.item.id)" :placeholder="$for.item.label + '…'" @input="setSlotQuery($for.item.id, $this.value)">
                        </div>
                        <div class="cell"><span class="filter-mark">=</span></div>
                        <div class="cell group-sep"><span class="filter-mark">=</span></div>
                        <div class="cell"><span class="filter-mark">=</span></div>
                        <div class="cell group-sep"><span class="filter-mark">=</span></div>
                        <div class="cell"><span class="filter-mark">=</span></div>
                        <div class="cell"><span class="filter-mark">=</span></div>
                    </div>
                </div>
                <div class="grid-body">
                    <div class="row" ~for="analysisRows"
                        ~style="{gridTemplateColumns: analysisGridCols}"
                        ~class="{group: !$for.item.detail, selected: selectedAnalysisRow?.label === $for.item.label}"
                        @tap="selectedAnalysisRow = $for.item"
                        @dblclick="openTurnoversFromAnalysis($for.item)">
                        <div class="cell link" ~for="$for.item.slotCells" ~class="{acc: $for.$for.index === $for.item.slotCells.length - 1}">{{$for.$for.item}}</div>
                        <div class="cell num debit-col">{{$for.item.open_debit}}</div>
                        <div class="cell num credit-col group-sep">{{$for.item.open_credit}}</div>
                        <div class="cell num debit-col">{{$for.item.debit}}</div>
                        <div class="cell num credit-col group-sep">{{$for.item.credit}}</div>
                        <div class="cell num debit-col">{{$for.item.close_debit}}</div>
                        <div class="cell num credit-col">{{$for.item.close_credit}}</div>
                    </div>
                </div>
                <div class="row total" ~style="{gridTemplateColumns: analysisGridCols}">
                    <div class="cell acc" ~style="{gridColumn: 'span ' + analysisSlots.length}"><span>Итого</span><span class="row-count">{{analysisRows.length}}</span></div>
                    <div class="cell num">{{analysisTotals.open_debit}}</div>
                    <div class="cell num group-sep">{{analysisTotals.open_credit}}</div>
                    <div class="cell num">{{analysisTotals.debit}}</div>
                    <div class="cell num group-sep">{{analysisTotals.credit}}</div>
                    <div class="cell num">{{analysisTotals.close_debit}}</div>
                    <div class="cell num">{{analysisTotals.close_credit}}</div>
                </div>
            </div>
        </div>
    </div>

    <!-- Экран 3 ODANT: Двухпанельные Обороты счёта -->
    <div class="turnovers-layout" ~if="mode === 'turnovers'">
        <div class="periods-panel">
            <div class="head-wrap">
                <div class="head">
                    <div class="cell">Период / Группа</div>
                    <div class="cell num">Дебет</div>
                    <div class="cell num">Кредит</div>
                    <div class="cell num">Сальдо</div>
                    <div class="cell num">Оборот</div>
                </div>
                <div class="row opening-row">
                    <div class="cell">На начало</div>
                    <div class="cell num">{{money(opening.debit)}}</div>
                    <div class="cell num">{{money(opening.credit)}}</div>
                    <div class="cell num">{{openingText}}</div>
                    <div class="cell num"></div>
                </div>
            </div>
            <div class="grid-body">
                <div class="row" ~for="turnoverGroups"
                    ~class="{selected: selectedGroupKey === $for.item.key}"
                    @tap="selectGroup($for.item.key)">
                    <div class="cell link">{{$for.item.label}}</div>
                    <div class="cell num debit-col">{{$for.item.debit}}</div>
                    <div class="cell num credit-col">{{$for.item.credit}}</div>
                    <div class="cell num">{{$for.item.balance}}</div>
                    <div class="cell num">{{$for.item.turnover}}</div>
                </div>
            </div>
            <div class="row total">
                <div class="cell"><span>На конец</span><span class="row-count">{{turnoverGroups.length}}</span></div>
                <div class="cell num">{{money(turnover.debit)}}</div>
                <div class="cell num">{{money(turnover.credit)}}</div>
                <div class="cell num">{{closingText}}</div>
                <div class="cell num">{{netTurnoverText}}</div>
            </div>
        </div>
        <div class="docs-panel">
            <div class="head-wrap">
                <div class="head">
                    <div class="cell">Дата</div>
                    <div class="cell">Операция</div>
                    <div class="cell">Корр. счёт</div>
                    <div class="cell num">Дебет</div>
                    <div class="cell num">Кредит</div>
                    <div class="cell entry-col" title="Проводка"></div>
                </div>
            </div>
            <div class="grid-body">
                <div class="row" ~for="turnoverDocs" ~class="{storno: $for.item.storno}" @dblclick="openEntry($for.item.entry)">
                    <div class="cell link" title="Открыть карточку проводки" @tap="openEntry($for.item.entry)">{{$for.item.date}}</div>
                    <div class="cell link" title="Открыть документ операции" @tap="openOperation($for.item)">{{$for.item.op}}</div>
                    <div class="cell link" title="Открыть корреспондирующий счёт" @tap="openCorr($for.item)">{{$for.item.corrDir}}</div>
                    <div class="cell num debit-col">{{$for.item.debit}}</div>
                    <div class="cell num credit-col">{{$for.item.credit}}</div>
                    <div class="cell entry-col">
                        <button type="button" class="entry-icon-btn" title="Открыть проводку" @tap.stop="openEntry($for.item.entry)">
                            <oda-icon icon="icons:list" icon-size="16"></oda-icon>
                        </button>
                    </div>
                </div>
            </div>
            <div class="row total">
                <div class="cell"><span>Итого</span><span class="row-count">{{turnoverDocs.length}}</span></div>
                <div class="cell"></div>
                <div class="cell"></div>
                <div class="cell num">{{turnoverDocsTotals.debit}}</div>
                <div class="cell num">{{turnoverDocsTotals.credit}}</div>
                <div class="cell entry-col"></div>
            </div>
        </div>
    </div>

    <!-- Экран 4 ODANT: Сборная карточка проводки (из записей счёта Дебета и счёта Кредита) -->
    <div class="entry-card" ~if="entryCard">
        <div class="entry-bar">
            <strong>Проводка #{{entryCard.entry}}</strong>
            <span>от {{entryCardDate}}</span>
            <span>Сумма: <strong>{{money(entryCard.amount)}}</strong></span>
            <span ~if="entryCard.qty">Кол-во: {{entryCard.qty}}</span>
            <span class="storno" ~if="entryCard.storno">[СТОРНО]</span>
            <span style="margin-left:auto;">Операция: <span class="cell link" style="display:inline;border:none;padding:0;" @tap="openEntryOperation()">{{entryCard.opTitle}}</span></span>
            <button type="button" class="btn-action" @tap="openEntryOperation()">Открыть документ</button>
            <button type="button" class="btn-action" @tap="closeEntry()">Закрыть</button>
        </div>
        <div class="entry-sides">
            <div class="entry-side">
                <div class="entry-side-title">ДЕБЕТ: <span class="cell link" style="display:inline;border:none;padding:0;" @tap="openEntrySideAccount('debit')">{{entryCard.debitLabel}}</span></div>
                <div>Сумма Дт: <strong>{{money(entryCard.debitAmount)}}</strong> <span ~if="entryCard.debitQty">({{entryCard.debitQty}})</span></div>
                <div ~for="entryCard.debitAnalytics">
                    <span>{{$for.item.label}}:</span> <strong>{{$for.item.title || '—'}}</strong>
                </div>
            </div>
            <div class="entry-side">
                <div class="entry-side-title">КРЕДИТ: <span class="cell link" style="display:inline;border:none;padding:0;" @tap="openEntrySideAccount('credit')">{{entryCard.creditLabel}}</span></div>
                <div>Сумма Кт: <strong>{{money(entryCard.creditAmount)}}</strong> <span ~if="entryCard.creditQty">({{entryCard.creditQty}})</span></div>
                <div ~for="entryCard.creditAnalytics">
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
    /** Режим экрана счёта: 'card' (Проводки) | 'analysis' (Экран 2: Анализ) | 'turnovers' (Экран 3: Обороты) */
    mode: 'card',
    /** Режим значений в Анализе счёта: 'amount' (Сумма) | 'qty' (Количество) */
    valueMode: 'amount',
    /** Группировка в Оборотах счёта (Экран 3) */
    groupBy: 'quarter',
    turnoverGroupOptions: TURNOVER_GROUPS,
    selectedGroupKey: '',
    groups: [],
    /** Выбранные слоты/признаки для разворота в Анализе счёта */
    activeSlots: [],
    /** Аналитические признаки по полям прилинкованных справочников */
    analyticFeatures: [],
    selectedFeatureId: '',
    /** Значения фильтра по полям прилинкованных справочников: { 'slotId.fieldId': val } */
    featureValues: {},
    /** Текстовые фильтры субаналитик: { слот: 'поле:значение' } */
    subFilters: {},
    analysisQuery: '',
    slotQueries: {},
    sheetRows: [],
    sheetTotal: null,
    selectedAnalysisRow: null,
    /** Открытая сборная карточка проводки (Экран 4) */
    entryCard: null,
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
    get analysisSlots() {
        return this.slots?.length ? this.slots : [{ id: '_default', label: 'Объект / Субсчёт' }];
    },
    get analysisGridCols() {
        const n = this.analysisSlots.length;
        const firstCols = Array(n).fill(n === 1 ? 'minmax(210px, 2.5fr)' : 'minmax(150px, 1.45fr)').join(' ');
        return `${firstCols} repeat(6, minmax(90px, 1fr))`;
    },
    slotQueryOf(slotId) {
        if (this.slotQueries && slotId in this.slotQueries)
            return this.slotQueries[slotId] || '';
        if (this.analysisSlots.length === 1)
            return this.analysisQuery || '';
        return '';
    },
    setSlotQuery(slotId, val) {
        const v = String(val || '');
        this.slotQueries = { ...(this.slotQueries || {}), [slotId]: v };
        if (this.analysisSlots.length === 1)
            this.analysisQuery = v;
    },
    get cardGridCols() {
        const slotCols = (this.slots || []).map(() => 'minmax(105px, 1.15fr)').join(' ');
        return `84px minmax(125px, 1.4fr) minmax(94px, 1fr) minmax(94px, 1fr) minmax(64px, 0.65fr) ${slotCols ? slotCols + ' ' : ''}minmax(125px, 1.3fr) minmax(105px, 1.1fr)`;
    },
    get openingText() {
        return saldo((Number(this.opening?.debit) || 0) - (Number(this.opening?.credit) || 0));
    },
    get closingText() {
        return saldo((Number(this.closing?.debit) || 0) - (Number(this.closing?.credit) || 0));
    },
    get netTurnoverText() {
        return saldo((Number(this.turnover?.debit) || 0) - (Number(this.turnover?.credit) || 0));
    },
    get countText() {
        const n = (this.items || []).length;
        return n < this.count ? `${n} из ${this.count}` : '';
    },
    get entryCardDate() {
        return this.entryCard?.time ? new Date(this.entryCard.time).toLocaleDateString('ru-RU') : '';
    },
    get entryCardOpTitle() {
        return this.entryCard?.operation?.title || this.entryCard?.operation?.classLabel || '';
    },
    get entryCardDebitLabel() {
        return this.entryCard?.debit?.label || this.entryCard?.debit?.account || '';
    },
    get entryCardCreditLabel() {
        return this.entryCard?.credit?.label || this.entryCard?.credit?.account || '';
    },
    accountText(cid) {
        const code = String(cid || '').split('/').pop().replace(/^acc\./, '');
        const label = String(this.names?.classes?.[cid] || '').trim();
        if (!label || label === code)
            return code;
        if (label.startsWith(code + ' ') || label.startsWith(code + '.') || /^\d+(?:\.\d+)?\s/.test(label))
            return label;
        return `${code} ${label}`;
    },
    /** Операция: её название, без названия (ядро отдаёт id) — класс операции. */
    opText(i) {
        const title = this.names?.objects?.[i.op_id];
        return (title && title !== i.op_id ? title : '') || this.names?.classes?.[i.op_cid] || i.op_id || '';
    },
    get displayRows() {
        return (this.items || []).map(i => ({
            entry: i.entry || i.id || null,
            date: i.time ? new Date(i.time).toLocaleDateString() : '',
            op: this.opText(i),
            op_id: i.op_id || '',
            op_cid: i.op_cid || '',
            debit: money(i.debit),
            credit: money(i.credit),
            qty: i.qty ? String(i.qty) : '',
            slots: (this.slots || []).map(s => {
                const id = i.analytics?.[s.id];
                return id ? this.names?.objects?.[id] || id : '';
            }),
            corr: this.accountText(i.corr),
            corr_cid: i.corr || '',
            bal: saldo(i.balance),
            storno: !!i.storno,
        }));
    },
    /** Сводные строки групп для левой таблицы Экрана 3 (Обороты счёта). */
    get turnoverGroups() {
        return (this.groups || []).map(g => ({
            key: g.key,
            label: g.label,
            debit: money(g.debit),
            credit: money(g.credit),
            balance: saldo(g.balance),
            turnover: saldo(g.turnover),
            count: g.count || 0,
        }));
    },
    /** Первичные документы выбранного периода для правой таблицы Экрана 3 (Обороты счёта). */
    get turnoverDocs() {
        const sel = this.selectedGroupKey;
        const list = (this.items || []).filter(i => !sel || !i.groupKey || i.groupKey === sel);
        return list.map(i => {
            const corrName = this.accountText(i.corr);
            const prefix = Number(i.debit) > 0 ? 'со сч. ' : 'на сч. ';
            return {
                entry: i.entry || i.id || null,
                date: i.time ? new Date(i.time).toLocaleDateString() : '',
                op: this.opText(i),
                op_id: i.op_id || '',
                op_cid: i.op_cid || '',
                corr: corrName,
                corrDir: corrName ? prefix + corrName : '',
                corr_cid: i.corr || '',
                debit: money(i.debit),
                credit: money(i.credit),
                rawDebit: Number(i.debit) || 0,
                rawCredit: Number(i.credit) || 0,
                storno: !!i.storno,
            };
        });
    },
    get turnoverDocsTotals() {
        let d = 0, c = 0;
        for (const doc of this.turnoverDocs || []) {
            d += doc.rawDebit || 0;
            c += doc.rawCredit || 0;
        }
        return { debit: money(d), credit: money(c) };
    },
    /** Форматирование ячеек Анализа счёта (Сумма или Количество). */
    analysisCells(r) {
        if (this.valueMode === 'qty') {
            const q = r?.qty || {};
            const openNet = Number(q.opening) || 0;
            const closeNet = Number(q.closing) || 0;
            return {
                open_debit: openNet > 0 ? qtyFmt(openNet) : '',
                open_credit: openNet < 0 ? qtyFmt(-openNet) : '',
                debit: qtyFmt(q.debit),
                credit: qtyFmt(q.credit),
                close_debit: closeNet > 0 ? qtyFmt(closeNet) : '',
                close_credit: closeNet < 0 ? qtyFmt(-closeNet) : '',
            };
        }
        return {
            open_debit: money(r?.opening?.debit), open_credit: money(r?.opening?.credit),
            debit: money(r?.turnover?.debit), credit: money(r?.turnover?.credit),
            close_debit: money(r?.closing?.debit), close_credit: money(r?.closing?.credit),
        };
    },
    /** Строки таблицы Экрана 2 (Анализ счёта) с колонками по каждому аналитическому справочнику. */
    get analysisRows() {
        const q = String(this.analysisQuery || '').trim().toLowerCase();
        const sq = this.slotQueries || {};
        const aSlots = this.analysisSlots;
        const rawList = this.sheetRows || [];
        const hasDetailRows = rawList.some(r => r?.key);
        const filteredRaw = hasDetailRows ? rawList.filter(r => r?.key) : rawList;
        const rows = filteredRaw.map(r => {
            const slotCells = aSlots.map(s => {
                if (r.key && typeof r.key === 'object') {
                    const id = s.id in r.key ? r.key[s.id] : Object.values(r.key)[0];
                    return id === null || id === undefined ? '—' : (this.names?.objects?.[id] || String(id));
                }
                return this.accountText(r.account);
            });
            const label = r.key
                ? slotCells.join(' / ')
                : this.accountText(r.account);
            return {
                account: r.account,
                key: r.key || null,
                detail: !!r.key,
                slotCells,
                label,
                indent: (Number(r.level) || 0) * 16,
                ...this.analysisCells(r),
            };
        });
        return rows.filter(r => {
            if (q && !r.label.toLowerCase().includes(q))
                return false;
            for (let i = 0; i < aSlots.length; i++) {
                const slotQ = String(sq[aSlots[i].id] || '').trim().toLowerCase();
                if (slotQ && !String(r.slotCells[i] || '').toLowerCase().includes(slotQ))
                    return false;
            }
            return true;
        });
    },
    get analysisTotals() {
        return this.analysisCells(this.sheetTotal);
    },
    featureLabel(feat) {
        if (!feat)
            return '';
        if ((this.slots || []).length > 1 && feat.slotLabel)
            return `${feat.slotLabel}: ${feat.label || feat.id}`;
        return feat.label || feat.id;
    },
    featureValueOf(feat) {
        if (!feat)
            return '';
        if (feat.isObject)
            return String(this.filters?.[feat.slotId] || '');
        return String(this.featureValues?.[feat.id] || '');
    },
    featureValueLabel(feat) {
        const val = this.featureValueOf(feat);
        if (!val)
            return 'Все';
        const opt = (feat?.options || []).find(o => o.value === val);
        return opt?.label || val;
    },
    async setFeatureValue(feat, value) {
        if (!feat)
            return;
        const val = String(value || '');
        if (feat.isObject) {
            this.filters = { ...(this.filters || {}), [feat.slotId]: val };
            await this.onFilterChanged();
            return;
        }
        this.featureValues = { ...(this.featureValues || {}), [feat.id]: val };
        if (val && !(this.activeSlots || []).includes(feat.spec) && !(this.activeSlots || []).includes(feat.slotId)) {
            this.activeSlots = [...(this.activeSlots || []), feat.spec];
        }
        await this.reload();
    },
    async moveFeature(delta) {
        const list = [...(this.analyticFeatures || [])];
        const idx = list.findIndex(f => f.id === this.selectedFeatureId);
        if (idx < 0)
            return;
        const target = idx + delta;
        if (target < 0 || target >= list.length)
            return;
        const [moved] = list.splice(idx, 1);
        list.splice(target, 0, moved);
        this.analyticFeatures = list;
        const order = list.map(f => f.spec);
        this.activeSlots = (this.activeSlots || []).slice().sort((a, b) => {
            const ia = order.indexOf(a), ib = order.indexOf(b);
            return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        });
        if (this.mode === 'analysis')
            await this.reload();
    },
    isSlotActive(slotId) {
        return (this.activeSlots || []).includes(slotId);
    },
    async toggleSlot(slotId, checked) {
        const cur = new Set(this.activeSlots || []);
        if (checked)
            cur.add(slotId);
        else
            cur.delete(slotId);
        const order = (this.analyticFeatures || []).map(f => f.spec);
        this.activeSlots = [...cur].sort((a, b) => {
            const ia = order.indexOf(a), ib = order.indexOf(b);
            if (ia < 0 && ib < 0)
                return 0;
            return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        });
        if (this.mode === 'analysis')
            await this.reload();
    },
    async moveSlot(index, delta) {
        const list = [...(this.slots || [])];
        const target = index + delta;
        if (index < 0 || index >= list.length || target < 0 || target >= list.length)
            return;
        const [moved] = list.splice(index, 1);
        list.splice(target, 0, moved);
        this.slots = list;
        const order = list.map(s => s.id);
        this.activeSlots = (this.activeSlots || []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
        if (this.analyticFeatures?.length) {
            this.analyticFeatures = [...this.analyticFeatures].sort((a, b) => order.indexOf(a.slotId) - order.indexOf(b.slotId));
        }
        if (this.mode === 'analysis')
            await this.reload();
    },
    async setUnit(val) {
        this.unit = String(val || '');
        await this.reload();
    },
    async onFilterChanged() {
        const sig = JSON.stringify(this.analytics());
        if (this._lastFilterSig === sig)
            return;
        this._lastFilterSig = sig;
        await this.reload();
    },
    async setSubFilter(slotId, value) {
        this.subFilters = { ...(this.subFilters || {}), [slotId]: String(value || '') };
        await this.reload();
    },
    setValueMode(vm) {
        this.valueMode = vm === 'qty' ? 'qty' : 'amount';
    },
    async setMode(m) {
        const next = ['card', 'analysis', 'turnovers'].includes(m) ? m : 'card';
        if (this.mode === next)
            return;
        this.mode = next;
        await this.reload();
    },
    async setGroupBy(g) {
        this.groupBy = g || 'quarter';
        this.selectedGroupKey = '';
        await this.reload();
    },
    selectGroup(key) {
        this.selectedGroupKey = this.selectedGroupKey === key ? '' : key;
    },
    async openTurnoversFromAnalysis(row) {
        const r = row || this.selectedAnalysisRow;
        if (r?.key && typeof r.key === 'object') {
            const next = { ...(this.filters || {}) };
            for (const [k, v] of Object.entries(r.key)) {
                if (v)
                    next[k] = v;
            }
            this.filters = next;
        }
        const host = this.domHost || this.parentElement;
        if (host && typeof host.applyNav === 'function' && host.view?.id && host.view.id !== 'turnovers') {
            await host.applyNav({
                view: 'turnovers',
                mode: 'turnovers',
                from: this.from,
                to: this.to,
                packetsKey: this.packetsKey,
                unit: this.unit,
                filters: this.filters,
            });
            return;
        }
        this.mode = 'turnovers';
        await this.reload();
    },
    /** Открыть сборную карточку проводки (Экран 4 ODANT) по номеру entry. */
    async openEntry(entryId) {
        if (!entryId || !this.$item)
            return null;
        this.error = '';
        try {
            const card = await this.$item.fetch('db_entry', { entry: entryId });
            if (card && typeof card === 'object') {
                const t = card.operation?.title;
                card.opTitle = (t && t !== card.operation?.id ? t : '') || card.operation?.label || card.operation?.classLabel || t || '';
                card.debitLabel = card.debit?.label || card.debit?.account || '';
                card.debitAmount = card.debit?.amount ?? card.amount ?? 0;
                card.debitQty = card.debit?.qty ?? card.qty ?? 0;
                card.debitAnalytics = card.debit?.analytics || [];
                card.creditLabel = card.credit?.label || card.credit?.account || '';
                card.creditAmount = card.credit?.amount ?? card.amount ?? 0;
                card.creditQty = card.credit?.qty ?? card.qty ?? 0;
                card.creditAnalytics = card.credit?.analytics || [];
            }
            this.entryCard = card;
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
    openEntryOperation() {
        if (!this.entryCard?.operation)
            return;
        return this.openOperation({
            op_cid: this.entryCard.operation.path || this.entryCard.operation.cid,
            op_id: this.entryCard.operation.id,
        });
    },
    openEntrySideAccount(side) {
        const s = side === 'credit' ? this.entryCard?.credit : this.entryCard?.debit;
        if (!s?.path && !s?.account)
            return;
        return this.openCorr({ corr_cid: s.path || s.account });
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
        if (nav.mode && ['card', 'analysis', 'turnovers'].includes(nav.mode))
            this.mode = nav.mode;
        else if (nav.view === 'turnovers' || nav.view === 'analysis')
            this.mode = nav.view;
        else if (nav.view === 'postings')
            this.mode = 'card';
        if (nav.groupBy)
            this.groupBy = String(nav.groupBy);
        this._restorePeriodState(nav);
        if (nav.unit !== undefined)
            this.unit = String(nav.unit || '');
        if (nav.filters && typeof nav.filters === 'object')
            this.filters = { ...nav.filters };
        _writeSavedPeriod(this.packetsKey, this.from, this.to);
    },
    async attached() {
        const initNav = this._initialNav;
        this._initialNav = null;
        if (initNav)
            this._applyNavFields(initNav);
        else
            this._restorePeriodState();
        await Promise.all([this.loadSlots(), this.loadScope()]);
        await this.reload();
        if (initNav?.entry)
            await this.openEntry(initNav.entry);
        this._attachedDone = true;
    },
    async applyNav(nav) {
        if (!nav || typeof nav !== 'object')
            return;
        this._applyNavFields(nav);
        await this.reload();
        if (nav.entry)
            await this.openEntry(nav.entry);
    },
    async openOperation(row) {
        const path = this.names?.paths?.[row?.op_cid] || row?.op_cid;
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (t && window.execute)
                window.execute(t, { view: 'objects', id: row.op_id });
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async openCorr(row) {
        const path = this.names?.paths?.[row?.corr_cid] || row?.corr_cid;
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (t && window.execute)
                window.execute(t, { view: 'postings', from: this.from, to: this.to, unit: this.unit });
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
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
    /** Слоты аналитик счёта из схемы ядра (с учётом наследования) и поля прилинкованных справочников. */
    async loadSlots() {
        try {
            const res = await this.$item?.fetch('db_schema');
            const s = res?.schema;
            const fields = Array.isArray(s?.fields) ? s.fields : [];
            this.slots = fields.filter(f => f?.analytic && f.type === 'link')
                .map(f => ({ id: f.id, label: f.label || f.id, type: 'Link', catalog: f.targetPath || f.target, placeholder: f.label || f.id }));
            this.activeSlots = this.slots.map(f => f.id);
            const serverSlots = Array.isArray(res?.slots) ? res.slots : [];
            const features = [];
            for (const slot of this.slots) {
                const srv = serverSlots.find(x => x.id === slot.id);
                if (Array.isArray(srv?.fields) && srv.fields.length) {
                    features.push(...srv.fields);
                }
                else {
                    features.push({
                        id: slot.id,
                        spec: slot.id,
                        slotId: slot.id,
                        fieldId: 'name',
                        label: 'Наименование',
                        slotLabel: slot.label,
                        isObject: true,
                        type: 'link',
                        catalog: slot.catalog,
                        options: [],
                    });
                }
            }
            this.analyticFeatures = features;
            this.selectedFeatureId = features[0]?.id || '';
        }
        catch (e) {
            this.slots = [];
            this.activeSlots = [];
            this.analyticFeatures = [];
            this.selectedFeatureId = '';
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
    /** Заданные фильтры субаналитик. */
    subanalytics() {
        const out = {};
        for (const [slotId, raw] of Object.entries(this.subFilters || {})) {
            const parsed = parseSubFilterInput(raw);
            if (parsed)
                out[slotId] = { ...(out[slotId] || {}), ...parsed };
        }
        for (const feat of this.analyticFeatures || []) {
            if (feat.isObject)
                continue;
            const val = this.featureValues?.[feat.id];
            if (val !== undefined && val !== null && val !== '') {
                if (!out[feat.slotId])
                    out[feat.slotId] = {};
                out[feat.slotId][feat.fieldId] = feat.type === 'boolean' ? (val === '1' || val === 'true' ? 1 : 0) : val;
            }
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
        const sub = this.subanalytics();
        if (Object.keys(sub).length)
            p.subanalytics = JSON.stringify(sub);
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
        this.groups = [];
        this.sheetRows = [];
        this.sheetTotal = null;
        this.count = 0;
        this.opening = this.turnover = this.closing = { debit: 0, credit: 0 };
        this.error = '';
        if (!this.$item)
            return;
        this._lastFilterSig = JSON.stringify(this.analytics());
        try {
            if (this.mode === 'analysis') {
                const p = this.params();
                delete p.limit;
                const by = (this.activeSlots?.length ? this.activeSlots : (this.slots || []).map(s => s.id)).filter(Boolean);
                if (by.length)
                    p.by = JSON.stringify(by);
                const res = await this.$item.fetch('db_sheet', p);
                if (this._syncPacketRange(res))
                    return await this.reload();
                this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
                this.sheetRows = Array.isArray(res?.rows) ? res.rows : [];
                this.sheetTotal = res?.total || null;
                this.selectedAnalysisRow = this.analysisRows.find(r => r.detail) || this.analysisRows[0] || null;
                return;
            }
            if (this.mode === 'turnovers') {
                const p = { ...this.params(), groupBy: this.groupBy || 'quarter' };
                const res = await this.$item.fetch('db_turnovers', p);
                if (this._syncPacketRange(res))
                    return await this.reload();
                this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
                this.groups = Array.isArray(res?.groups) ? res.groups : [];
                this.items = Array.isArray(res?.items) ? res.items : [];
                this.count = Number(res?.total) || this.items.length;
                this.opening = res?.opening || { debit: 0, credit: 0 };
                this.closing = res?.closing || { debit: 0, credit: 0 };
                this.turnover = { debit: res?.closing?.debit ?? 0, credit: res?.closing?.credit ?? 0 };
                if (!this.selectedGroupKey && this.groups.length)
                    this.selectedGroupKey = this.groups[0].key;
                return;
            }
            const res = await this.$item.fetch('db_card', this.params());
            if (this._syncPacketRange(res))
                return await this.reload();
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
