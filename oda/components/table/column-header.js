/**
 * oda-table-header — шапка таблицы: многострочные заголовки со спанами из `layout`.
 * Поддерживает:
 * - сортировку по клику (и мультисортировку с Ctrl/Cmd);
 * - перетаскивание колонки в панель группировки (Drag & Drop);
 * - попап-фильтр по дате с календарём (для колонок дат, Скрин 2) и попап-фильтр по списку уникальных значений с чекбоксами (Скрины 3, 4);
 * - контекстное меню колонки и группировок по правому клику (Скрин 5);
 * - опциональную строку авто-фильтра под заголовками колонок.
 */

const CONTAINERS = '/oda/components/containers/containers.js';

const RU_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const RU_WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

function pad2(n) {
    return String(n).padStart(2, '0');
}

function toIsoDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isDateColumn(node) {
    if (!node)
        return false;
    const f = node.field || {};
    const t = String(node.type || f.type || '').toLowerCase();
    const k = String(node.key || node.name || f.id || '').toLowerCase();
    return Boolean(f.isDateCol || t === 'date' || t === 'datetime' || k === 'time' || k === 'date' || k.endsWith('_date'));
}

ODA({
    is: 'oda-table-header',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --no-flex;
                @apply --header;
                position: sticky;
                top: 0;
                z-index: 4;
                width: max(100%, var(--table-min-total, 100%));
                min-width: var(--table-min-total, auto);
                border-bottom: 1px solid var(--border-color);
                font-size: 12px;
                font-weight: 600;
            }
            .hgrid {
                @apply --flex;
                display: grid;
                align-items: stretch;
                grid-template-columns: var(--table-tracks, 1fr);
                min-width: var(--table-min-total, min-content);
            }
            .hcell {
                @apply --horizontal;
                position: relative;
                align-items: center;
                gap: 4px;
                box-sizing: border-box;
                min-width: 0;
                min-height: 25px;
                padding: 3px 8px;
                overflow: hidden;
                border-right: 1px solid var(--border-color);
                background-color: var(--header-background);
                color: var(--header-color);
                cursor: pointer;
                user-select: none;
            }
            .hcell.end {
                border-right: none;
            }
            .hcell.sticky-left {
                position: sticky;
                left: 0;
                z-index: 3;
                box-shadow: 1px 0 0 var(--border-color);
            }
            .hcell.sticky-right {
                position: sticky;
                right: 0;
                z-index: 3;
                border-left: 1px solid var(--border-color);
                box-shadow: -1px 0 0 var(--border-color);
            }
            .resizer {
                position: absolute;
                top: 0;
                right: 0;
                bottom: 0;
                width: 6px;
                cursor: col-resize;
                z-index: 5;
                user-select: none;
                touch-action: none;
            }
            .resizer:hover,
            .resizer.active {
                background-color: var(--accent-color);
                opacity: 0.7;
            }
            .title {
                min-width: 0;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
            }
            .marker {
                @apply --no-flex;
                cursor: pointer;
            }
            .sort {
                @apply --no-flex;
                font-size: var(--font-size-xs);
                color: var(--accent-color);
                white-space: nowrap;
            }
            .tool {
                @apply --no-flex;
                @apply --muted;
                margin-inline-start: auto;
                margin-block: calc(-1 * var(--space-s));
                cursor: pointer;
            }
            :host([col-lines]) .hcell:not(.end) {
                border-right: 1px solid var(--subtle-border);
            }
            :host([row-lines]) {
                border-bottom: 1px solid var(--subtle-border);
            }
            .autofilter-grid {
                display: grid;
                align-items: stretch;
                grid-template-columns: var(--table-tracks, 1fr);
                min-width: var(--table-min-total, min-content);
                border-top: 1px solid var(--border-color);
                background: var(--content-background);
                color: var(--content-color);
                font-weight: 400;
            }
            .af-cell {
                display: flex;
                align-items: center;
                gap: 4px;
                min-width: 0;
                min-height: 23px;
                padding: 1px 6px;
                border-right: 1px solid var(--subtle-border);
                box-sizing: border-box;
                background: var(--content-background);
            }
            .af-cell:last-child {
                border-right: none;
            }
            .af-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 1px;
                padding: 0 2px;
                font-size: 9px;
                font-weight: 700;
                font-family: var(--font-mono, monospace);
                color: var(--muted-color);
                border-radius: 2px;
                flex-shrink: 0;
                user-select: none;
            }
            .af-badge b {
                display: inline-block;
                padding: 0 2px;
                border: 1px solid var(--border-color);
                border-radius: 2px;
                background: var(--subtle-background);
                line-height: 1.25;
            }
            .af-badge b.mid {
                background: var(--success-soft);
                color: var(--success-color);
                border-color: var(--success-color);
            }
            .af-op {
                font-size: 11px;
                font-weight: 700;
                color: var(--muted-color);
                padding: 0 2px;
                flex-shrink: 0;
                user-select: none;
            }
            .af-input {
                flex: 1;
                min-width: 0;
                border: none;
                outline: none;
                background: transparent;
                color: var(--accent-color);
                font-size: 12px;
                font-weight: 500;
                padding: 1px 2px;
            }
            .af-input::placeholder {
                color: var(--muted-color);
                font-weight: 400;
            }
            .af-clear {
                border: none;
                background: transparent;
                color: var(--muted-color);
                font-size: 11px;
                cursor: pointer;
                padding: 0 2px;
                flex-shrink: 0;
            }
            .af-clear:hover {
                color: var(--error-color);
            }
        </style>
        <div class="hgrid">
            <div class="hcell" ~for="cells" ~style="cellStyle($for.item)" ~class="{end: isEnd($for.item), 'sticky-left': isStickyLeft($for.item), 'sticky-right': isStickyRight($for.item)}"
                draggable="true"
                @dragstart="onColDragStart($for.item.node, $event)"
                @click="sortColumn($for.item.node, $event)"
                @contextmenu.stop.prevent="openHeaderContextMenu($for.item.node, $event)">
                <oda-icon ~if="$for.item.node.allowExpand" class="marker" icon="icons:chevron-right" :rotate="$for.item.node.expanded ? 90 : 0" @click.stop="toggleColumn($for.item.node)"></oda-icon>
                <span class="title">{{$for.item.node.label}}</span>
                <span class="sort" ~if="sortMark($for.item.node)">{{sortMark($for.item.node)}}</span>
                <oda-icon ~if="isLeaf($for.item)" class="tool" icon="icons:filter" :icon-size="16" :fill="filterFill($for.item.node)" title="Фильтр колонки" @click.stop="openFilter($for.item.node, $event)"></oda-icon>
                <div class="resizer" ~if="isLeaf($for.item)" title="Потяните для изменения ширины (двойной клик — авто)" @pointerdown.stop.prevent="startResize($for.item.node, $event)" @click.stop @dblclick.stop="autoFitColumn($for.item.node)"></div>
            </div>
        </div>
        <div class="autofilter-grid" ~if="host?.showAutoFilterRow">
            <div class="af-cell" ~for="leaves">
                <span class="af-badge" ~if="!isNumericOrDateCol($for.item)" title="Поиск вхождения подстроки (ABC)"><b>A</b><b class="mid">B</b><b>C</b></span>
                <span class="af-op" ~if="isNumericOrDateCol($for.item)" title="Фильтр по значению">=</span>
                <input class="af-input" type="search" :value="autoFilterValue($for.item)" @input="onAutoFilterInput($for.item, $event.target.value)">
                <button type="button" class="af-clear" ~if="autoFilterValue($for.item)" title="Очистить фильтр колонки" @tap.stop="onAutoFilterInput($for.item, '')">✕</button>
            </div>
        </div>
    `,
    $public: {
        layout: {
            $type: Object
        },
        colLines: {
            $def: false,
            $attr: true
        },
        rowLines: {
            $def: false,
            $attr: true
        }
    },
    get headers() {
        return this.layout?.headers ?? [];
    },
    get leaves() {
        return this.layout?.leaves ?? [];
    },
    get cells() {
        return this.headers.flat();
    },
    get host() {
        return this.getRootNode?.()?.host;
    },
    cellStyle(cell) {
        return {
            gridColumn: `${(cell?.start ?? 0) + 1} / span ${cell?.colSpan ?? 1}`,
            gridRow: `${(cell?.level ?? 0) + 1} / span ${cell?.rowSpan ?? 1}`,
        };
    },
    isEnd(cell) {
        const cols = this.layout?.leaves?.length ?? 0;
        return (cell?.start ?? 0) + (cell?.colSpan ?? 1) === cols && !this.host?.hasFiller;
    },
    isStickyLeft(cell) {
        return (cell?.start ?? 0) === 0 && Boolean(cell?.node?.field?.stickyLeft || cell?.node?.key === 'name');
    },
    isStickyRight(cell) {
        const cols = this.layout?.leaves?.length ?? 0;
        const isLastCol = (cell?.start ?? 0) + (cell?.colSpan ?? 1) === cols;
        return isLastCol && Boolean(cell?.node?.field?.stickyRight || cell?.node?.field?.isGroupCol);
    },
    onColDragStart(node, e) {
        if (!node?.key)
            return;
        try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/x-oda-table-col', node.key);
            e.dataTransfer.setData('text/plain', node.key);
        }
        catch { /* ignore */ }
    },
    startResize(node, e) {
        if (!node?.key || !this.host)
            return;
        const hcell = e.currentTarget?.closest?.('.hcell');
        const resizer = e.currentTarget;
        const startW = Math.round(hcell?.getBoundingClientRect()?.width || node.width || 120);
        const startX = e.clientX;
        resizer?.classList?.add('active');
        let rafId = 0;
        let pendingW = startW;
        const applyWidth = () => {
            rafId = 0;
            this.host?.setColumnState?.(node.key, { width: pendingW }, { skipPersist: true });
        };
        const onMove = (ev) => {
            pendingW = Math.max(52, Math.round(startW + (ev.clientX - startX)));
            if (!rafId)
                rafId = requestAnimationFrame(applyWidth);
        };
        const onUp = () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = 0;
                this.host?.setColumnState?.(node.key, { width: pendingW }, { skipPersist: true });
            }
            this.host?._savePersistedColumnState?.();
            resizer?.classList?.remove('active');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    },
    resetResize(node) {
        if (node?.key)
            this.host?.setColumnState?.(node.key, { width: undefined });
    },
    autoFitColumn(node) {
        if (!node?.key || !this.host)
            return;
        this.host.autoFitColumn?.(node.key);
    },
    toggleColumn(node) {
        if (node?.key !== undefined)
            this.host?.setColumnState?.(node.key, { expanded: !node.expanded });
    },
    sortColumn(node, e) {
        if (node?.key === undefined || e?.defaultPrevented)
            return;
        this.host?.sortBy?.(node.key, { add: !!(e?.ctrlKey || e?.metaKey) });
    },
    sortMark(node) {
        const order = Math.trunc(Number(node?.sortOrder)) || 0;
        if (order > 0)
            return `▼${order}`;
        if (order < 0)
            return `▲${-order}`;
        return '';
    },
    isLeaf(cell) {
        return !!cell?.node && !!this.layout?.leaves?.includes(cell.node);
    },
    filterFill(node) {
        return this.host?.columnFilter?.[node?.key] ? 'var(--accent-color)' : '';
    },
    isNumericOrDateCol(node) {
        if (!node)
            return false;
        if (isDateColumn(node))
            return true;
        const f = node.field || {};
        const t = String(node.type || f.type || '').toLowerCase();
        return Boolean(f.formatMoney || t === 'number' || t === 'money' || t === 'integer');
    },
    autoFilterValue(node) {
        const raw = this.host?.columnFilter?.[node?.key] ?? '';
        if (raw.startsWith('@in:') || raw.startsWith('@date:'))
            return '';
        return raw;
    },
    onAutoFilterInput(node, val) {
        if (!node?.key || !this.host)
            return;
        this.host.setColumnState(node.key, { filter: val || '' });
    },
    /**
     * Открыть попап фильтра колонки:
     * - для колонки даты (Date / DateTime / time) — фильтр по дате с календарём (Скрин 2);
     * - для всех остальных колонок — список уникальных значений с чекбоксами, (Показать все), (Пустые), OK / Отмена (Скрины 3, 4).
     */
    async openFilter(node, e) {
        const host = this.host;
        const anchor = e?.currentTarget ?? e?.target ?? this;
        if (!host || node?.key === undefined)
            return;
        const key = node.key;
        await import(CONTAINERS);
        await customElements.whenDefined(ODA.popoverTag);

        if (isDateColumn(node)) {
            const el = ODA.createElement('oda-table-date-filter', {
                table: host,
                columnNode: node,
                colKey: key,
                currentFilter: host.columnFilter?.[key] ?? '',
            });
            const shown = ODA.showDropdown(el, { TITLE: { label: node.label || key } }, anchor);
            shown.catch(err => {
                if (!(err instanceof ODA.CancelError))
                    throw err;
            });
            return;
        }

        const el = ODA.createElement('oda-table-value-filter', {
            table: host,
            columnNode: node,
            colKey: key,
            currentFilter: host.columnFilter?.[key] ?? '',
        });
        const shown = ODA.showDropdown(el, { TITLE: { label: node.label || key } }, anchor);
        shown.catch(err => {
            if (!(err instanceof ODA.CancelError))
                throw err;
        });
    },
    /** Контекстное меню колонки и таблицы по правому клику на заголовке (Скрин 5). */
    async openHeaderContextMenu(node, e) {
        const host = this.host;
        if (!host)
            return;
        await import(CONTAINERS);
        await customElements.whenDefined(ODA.popoverTag);
        const menu = ODA.createElement('oda-table-context-menu', {
            table: host,
            columnNode: node,
            anchorEvent: e,
        });
        const shown = ODA.showDropdown(menu, {}, e);
        shown.catch(err => {
            if (!(err instanceof ODA.CancelError))
                throw err;
        });
    },
    $listeners: {
        contextmenu(e) {
            e.preventDefault();
            e.stopPropagation();
            this.openHeaderContextMenu(null, e);
        }
    }
});

/**
 * Попап фильтра по дате с календарём месяца и быстрыми чекбоксами (Скрин 2).
 */
ODA({
    is: 'oda-table-date-filter',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                padding: 10px 12px;
                gap: 8px;
                min-width: 245px;
                font-size: 12.5px;
                box-sizing: border-box;
                user-select: none;
            }
            .chk-row {
                display: flex;
                align-items: center;
                gap: 6px;
                cursor: pointer;
            }
            .cal-box {
                @apply --vertical;
                gap: 6px;
                padding: 6px 8px;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 4px);
                background: var(--subtle-background);
            }
            .cal-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-weight: 700;
                padding: 2px 4px;
            }
            .cal-nav {
                border: none;
                background: transparent;
                color: var(--content-color);
                cursor: pointer;
                font-size: 13px;
                padding: 2px 6px;
                border-radius: 3px;
            }
            .cal-nav:hover {
                background: var(--accent-soft);
                color: var(--accent-color);
            }
            .cal-grid {
                display: grid;
                grid-template-columns: repeat(7, 1fr);
                gap: 2px;
                text-align: center;
            }
            .cal-wd {
                font-size: 11px;
                font-weight: 600;
                color: var(--muted-color);
                padding: 2px 0;
            }
            .cal-wd.weekend {
                color: var(--error-color);
            }
            .cal-day {
                height: 24px;
                line-height: 24px;
                border-radius: 3px;
                font-size: 12px;
                cursor: pointer;
                border: 1px solid transparent;
            }
            .cal-day:hover {
                background: var(--accent-soft);
                border-color: var(--accent-color);
            }
            .cal-day.other {
                opacity: 0.35;
            }
            .cal-day.weekend:not(.selected) {
                color: var(--error-color);
            }
            .cal-day.today {
                border-color: var(--accent-color);
                font-weight: 700;
            }
            .cal-day.selected {
                background: var(--selected-background);
                color: var(--selected-color);
                font-weight: 700;
            }
            .footer-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-top: 4px;
                border-top: 1px solid var(--subtle-border);
            }
            .clear-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border: 1px solid var(--error-color);
                border-radius: 3px;
                background: var(--error-soft);
                color: var(--error-color);
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
            }
            .act-btn {
                padding: 3px 12px;
                font-size: 12px;
                font-weight: 600;
                border: 1px solid var(--border-color);
                border-radius: 3px;
                background: var(--content-background);
                color: var(--content-color);
                cursor: pointer;
            }
            .act-btn:hover {
                border-color: var(--accent-color);
                background: var(--accent-soft);
            }
        </style>
        <label class="chk-row">
            <input type="checkbox" :checked="showAll" @change="onShowAllChange($event.target.checked)">
            <span>Показать все</span>
        </label>
        <label class="chk-row">
            <input type="checkbox" :checked="!showAll" @change="onFilterByDateChange($event.target.checked)">
            <span>Фильтровать по дате:</span>
        </label>
        <div class="cal-box">
            <div class="cal-head">
                <button type="button" class="cal-nav" @tap="shiftMonth(-1)">◀</button>
                <span>{{monthTitle}}</span>
                <button type="button" class="cal-nav" @tap="shiftMonth(1)">▶</button>
            </div>
            <div class="cal-grid">
                <div class="cal-wd" ~for="weekdays" ~class="{weekend: $for.index >= 5}">{{$for.item}}</div>
                <div class="cal-day" ~for="calendarDays"
                    ~class="{other: !$for.item.inMonth, weekend: $for.item.isWeekend, today: $for.item.isToday, selected: selectedIso === $for.item.iso}"
                    @tap="pickDay($for.item)">{{$for.item.day}}</div>
            </div>
        </div>
        <label class="chk-row">
            <input type="checkbox" :checked="quickMode === 'today'" @change="pickQuick('today', $event.target.checked)">
            <span>Сегодня</span>
        </label>
        <label class="chk-row">
            <input type="checkbox" :checked="quickMode === 'yesterday'" @change="pickQuick('yesterday', $event.target.checked)">
            <span>Вчера</span>
        </label>
        <label class="chk-row">
            <input type="checkbox" :checked="quickMode === 'tomorrow'" @change="pickQuick('tomorrow', $event.target.checked)">
            <span>Завтра</span>
        </label>
        <div class="footer-row">
            <button type="button" class="clear-btn" title="Сбросить фильтр" @tap="clearFilter()">✕</button>
            <button type="button" class="act-btn" @tap="closePopup()">Закрыть</button>
        </div>
    `,
    table: null,
    columnNode: null,
    colKey: '',
    currentFilter: '',
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    selectedIso: '',
    quickMode: '',
    weekdays: RU_WEEKDAYS,
    attached() {
        const raw = String(this.currentFilter || '').trim();
        let iso = '';
        if (raw.startsWith('@date:'))
            iso = raw.slice(6).split('..')[0];
        else if (/^\d{4}-\d{2}-\d{2}$/.test(raw))
            iso = raw;
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
            this.selectedIso = iso;
            const [y, m] = iso.split('-').map(Number);
            this.viewYear = y;
            this.viewMonth = m - 1;
        }
        else {
            // Определим месяц по последней дате в колонке таблицы, чтобы календарь открывался на актуальном месяце данных
            const rows = this.table?.dataSet || [];
            const col = this.columnNode;
            let latest = '';
            for (const r of rows) {
                const v = typeof col?.valueOf === 'function' ? col.valueOf(r) : r?.[col?.name || this.colKey];
                const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || ''));
                if (m && m[1] > latest)
                    latest = m[1];
            }
            if (latest) {
                const [y, m] = latest.split('-').map(Number);
                this.viewYear = y;
                this.viewMonth = m - 1;
            }
        }
    },
    get showAll() {
        return !this.selectedIso;
    },
    get monthTitle() {
        return `${RU_MONTHS[this.viewMonth] || ''} ${this.viewYear}`;
    },
    get calendarDays() {
        const y = this.viewYear;
        const m = this.viewMonth;
        const first = new Date(y, m, 1);
        const dow = (first.getDay() + 6) % 7; // 0 = ПН .. 6 = ВС
        const start = new Date(y, m, 1 - dow);
        const todayIso = toIsoDate(new Date());
        const out = [];
        for (let i = 0; i < 42; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const iso = toIsoDate(d);
            const wd = (d.getDay() + 6) % 7;
            out.push({
                day: d.getDate(),
                iso,
                inMonth: d.getMonth() === m,
                isWeekend: wd >= 5,
                isToday: iso === todayIso,
            });
        }
        return out;
    },
    shiftMonth(delta) {
        const d = new Date(this.viewYear, this.viewMonth + delta, 1);
        this.viewYear = d.getFullYear();
        this.viewMonth = d.getMonth();
    },
    onShowAllChange(checked) {
        if (checked)
            this.clearFilter();
    },
    onFilterByDateChange(checked) {
        if (!checked) {
            this.clearFilter();
            return;
        }
        if (!this.selectedIso) {
            const defIso = `${this.viewYear}-${pad2(this.viewMonth + 1)}-01`;
            this.applyDate(defIso);
        }
    },
    pickDay(item) {
        if (!item?.iso)
            return;
        this.quickMode = '';
        this.viewYear = Number(item.iso.slice(0, 4));
        this.viewMonth = Number(item.iso.slice(5, 7)) - 1;
        this.applyDate(item.iso);
    },
    pickQuick(mode, checked) {
        if (!checked) {
            this.quickMode = '';
            this.clearFilter();
            return;
        }
        this.quickMode = mode;
        const d = new Date();
        if (mode === 'yesterday')
            d.setDate(d.getDate() - 1);
        else if (mode === 'tomorrow')
            d.setDate(d.getDate() + 1);
        const iso = toIsoDate(d);
        this.viewYear = d.getFullYear();
        this.viewMonth = d.getMonth();
        this.applyDate(iso);
    },
    applyDate(iso) {
        this.selectedIso = iso;
        this.table?.setColumnState?.(this.colKey, { filter: `@date:${iso}` });
    },
    clearFilter() {
        this.selectedIso = '';
        this.quickMode = '';
        this.table?.setColumnState?.(this.colKey, { filter: '' });
    },
    closePopup() {
        this.parentElement?.close?.('ok');
    }
});

/**
 * Попап фильтра колонки со списком уникальных значений, чекбоксами "(Показать все)" и "(Пустые)" и кнопками OK / Отмена (Скрины 3 и 4).
 */
ODA({
    is: 'oda-table-value-filter',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                width: 270px;
                min-width: 220px;
                min-height: 190px;
                max-height: 380px;
                padding: 8px;
                gap: 6px;
                font-size: 12.5px;
                box-sizing: border-box;
                resize: both;
                overflow: hidden;
                user-select: none;
            }
            .search-input {
                width: 100%;
                padding: 4px 8px;
                font-size: 12px;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 3px);
                background: var(--content-background);
                color: var(--content-color);
                box-sizing: border-box;
                outline: none;
            }
            .search-input:focus {
                border-color: var(--accent-color);
            }
            .values-list {
                @apply --vertical;
                flex: 1;
                min-height: 110px;
                overflow-y: auto;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 3px);
                background: var(--content-background);
                padding: 4px 6px;
                gap: 2px;
            }
            .val-row {
                display: flex;
                align-items: center;
                gap: 6px;
                min-height: 21px;
                padding: 1px 4px;
                border-radius: 2px;
                cursor: pointer;
                white-space: nowrap;
            }
            .val-row:hover {
                background: var(--accent-soft);
            }
            .val-label {
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .footer-bar {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 6px;
                padding-top: 2px;
            }
            .dlg-btn {
                min-width: 68px;
                padding: 3px 12px;
                font-size: 12px;
                font-weight: 600;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 3px);
                background: var(--subtle-background);
                color: var(--content-color);
                cursor: pointer;
            }
            .dlg-btn:hover {
                border-color: var(--accent-color);
                background: var(--accent-soft);
                color: var(--accent-color);
            }
        </style>
        <input class="search-input" ~if="allOptions.length > 7" type="search" placeholder="Поиск значения…" :value="searchText" @input="searchText = $event.target.value">
        <div class="values-list">
            <label class="val-row">
                <input type="checkbox" :checked="isAllChecked" @change="toggleAll($event.target.checked)">
                <span class="val-label">(Показать все)</span>
            </label>
            <label class="val-row" ~if="hasBlankOption">
                <input type="checkbox" :checked="isValueChecked('')" @change="toggleValue('', $event.target.checked)">
                <span class="val-label">(Пустые)</span>
            </label>
            <label class="val-row" ~for="filteredOptions">
                <input type="checkbox" :checked="isValueChecked($for.item.value)" @change="toggleValue($for.item.value, $event.target.checked)">
                <span class="val-label" :title="$for.item.label">{{$for.item.label}}</span>
            </label>
        </div>
        <div class="footer-bar">
            <button type="button" class="dlg-btn" @tap="applyAndClose()">OK</button>
            <button type="button" class="dlg-btn" @tap="cancel()">Отмена</button>
        </div>
    `,
    table: null,
    columnNode: null,
    colKey: '',
    currentFilter: '',
    searchText: '',
    allOptions: [],
    hasBlankOption: false,
    selectedSet: null,
    allSelected: true,
    _tick: 0,
    attached() {
        const rows = this.table?.dataSet || [];
        const col = this.columnNode;
        const field = col?.field || {};
        const isNum = field.formatMoney || ['number', 'money', 'integer'].includes(String(col?.type || field.type || '').toLowerCase());
        const map = new Map();
        let hasBlank = false;

        for (const r of rows) {
            if (!r || typeof r !== 'object')
                continue;
            const v = typeof col?.valueOf === 'function' ? col.valueOf(r) : r[col?.name || this.colKey];
            if (v === undefined || v === null || v === '') {
                hasBlank = true;
                continue;
            }
            const rawStr = String(v);
            if (!map.has(rawStr)) {
                let label = rawStr;
                if (field.formatMoney && Number.isFinite(Number(v)))
                    label = Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                map.set(rawStr, { value: rawStr, label, numVal: isNum ? Number(v) : NaN });
            }
        }
        const opts = [...map.values()];
        opts.sort((a, b) => {
            if (isNum && Number.isFinite(a.numVal) && Number.isFinite(b.numVal))
                return a.numVal - b.numVal;
            return a.label.localeCompare(b.label, 'ru', { numeric: true });
        });
        this.allOptions = opts;
        this.hasBlankOption = hasBlank;

        const rawFilter = String(this.currentFilter || '').trim();
        this.selectedSet = new Set();
        if (!rawFilter) {
            this.allSelected = true;
        }
        else if (rawFilter.startsWith('@in:')) {
            try {
                const parsed = JSON.parse(rawFilter.slice(4));
                if (Array.isArray(parsed)) {
                    this.allSelected = false;
                    for (const item of parsed)
                        this.selectedSet.add(String(item ?? ''));
                }
            }
            catch {
                this.allSelected = true;
            }
        }
        else {
            const needle = rawFilter.toLowerCase();
            this.allSelected = false;
            for (const o of opts) {
                if (o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle))
                    this.selectedSet.add(o.value);
            }
        }
        this._tick++;
    },
    get filteredOptions() {
        const q = String(this.searchText || '').trim().toLowerCase();
        if (!q)
            return this.allOptions || [];
        return (this.allOptions || []).filter(o => o.label.toLowerCase().includes(q));
    },
    get isAllChecked() {
        void this._tick;
        return Boolean(this.allSelected);
    },
    isValueChecked(val) {
        void this._tick;
        if (this.allSelected)
            return false;
        return Boolean(this.selectedSet?.has(String(val ?? '')));
    },
    toggleAll(checked) {
        this.selectedSet = new Set();
        this.allSelected = Boolean(checked);
        this._tick++;
    },
    toggleValue(val, checked) {
        const s = String(val ?? '');
        this.selectedSet ??= new Set();
        if (this.allSelected) {
            this.allSelected = false;
            this.selectedSet.clear();
        }
        if (checked)
            this.selectedSet.add(s);
        else
            this.selectedSet.delete(s);
        this._tick++;
    },
    applyAndClose() {
        if (this.allSelected || !this.selectedSet || this.selectedSet.size === 0) {
            this.table?.setColumnState?.(this.colKey, { filter: '' });
        }
        else {
            const arr = [...this.selectedSet];
            this.table?.setColumnState?.(this.colKey, { filter: `@in:${JSON.stringify(arr)}` });
        }
        this.parentElement?.close?.('ok');
    },
    cancel() {
        this.parentElement?.close?.('');
    }
});

/**
 * Контекстное меню шапки колонки и группировки (Скрин 5).
 */
ODA({
    is: 'oda-table-context-menu',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                min-width: 245px;
                padding: 4px 0;
                font-size: 12.5px;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 4px);
                box-shadow: var(--elevation-2);
                user-select: none;
            }
            .menu-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 5px 12px;
                cursor: pointer;
                color: var(--content-color);
            }
            .menu-item:hover:not([disabled]) {
                background: var(--accent-soft);
                color: var(--accent-color);
            }
            .menu-item[disabled] {
                opacity: 0.42;
                pointer-events: none;
            }
            .menu-sep {
                height: 1px;
                margin: 3px 0;
                background: var(--subtle-border);
            }
            .menu-ico {
                width: 16px;
                text-align: center;
                font-size: 12px;
                font-weight: 700;
                color: var(--accent-color);
                flex-shrink: 0;
            }
        </style>
        <div class="menu-item" :disabled="!hasGroups" @tap="expandAllGroups(true)">
            <span class="menu-ico">⊞</span>
            <span>Раскрыть группы</span>
        </div>
        <div class="menu-item" :disabled="!hasGroups" @tap="expandAllGroups(false)">
            <span class="menu-ico">⊟</span>
            <span>Свернуть группы</span>
        </div>
        <div class="menu-sep"></div>
        <div class="menu-item" :disabled="!columnNode" @tap="sortCol(1)">
            <span class="menu-ico">▲</span>
            <span>Сортировка по возрастанию</span>
        </div>
        <div class="menu-item" :disabled="!columnNode" @tap="sortCol(-1)">
            <span class="menu-ico">▼</span>
            <span>Сортировка по убыванию</span>
        </div>
        <div class="menu-item" ~if="columnNode?.sortOrder" @tap="sortCol(0)">
            <span class="menu-ico">✕</span>
            <span>Снять сортировку</span>
        </div>
        <div class="menu-sep"></div>
        <div class="menu-item" ~if="columnNode && !isGroupedCol" @tap="groupByCol()">
            <span class="menu-ico">▤</span>
            <span>Группировать по этой колонке</span>
        </div>
        <div class="menu-item" ~if="columnNode && isGroupedCol" @tap="ungroupCol()">
            <span class="menu-ico">▫</span>
            <span>Разгруппировать</span>
        </div>
        <div class="menu-item" @tap="toggleGroupPanel()">
            <span class="menu-ico">▥</span>
            <span>{{table?.showGroupPanel ? 'Скрыть область группировки' : 'Показать область группировки'}}</span>
        </div>
        <div class="menu-sep"></div>
        <div class="menu-item" :disabled="!canHideCol" @tap="hideCol()">
            <span class="menu-ico">⊘</span>
            <span>Скрыть колонку</span>
        </div>
        <div class="menu-item" @tap="openColumnsDialog()">
            <span class="menu-ico">☰</span>
            <span>Выбор колонок и категорий</span>
        </div>
        <div class="menu-item" :disabled="!columnNode" @tap="fitCol()">
            <span class="menu-ico">↔</span>
            <span>Подбор ширины</span>
        </div>
        <div class="menu-sep"></div>
        <div class="menu-item" :disabled="!hasActiveFilter" @tap="clearFilters()">
            <span class="menu-ico" style="color: var(--error-color);">✕</span>
            <span>Очистить фильтр</span>
        </div>
        <div class="menu-item" :disabled="!columnNode" @tap="openColumnFilterPopup()">
            <span class="menu-ico">▼</span>
            <span>Конструктор фильтра…</span>
        </div>
        <div class="menu-item" @tap="toggleSearchPanel()">
            <span class="menu-ico">🔍</span>
            <span>{{table?.showSearchPanel ? 'Скрыть панель поиска' : 'Показать панель поиска'}}</span>
        </div>
        <div class="menu-item" @tap="toggleAutoFilterRow()">
            <span class="menu-ico">▽</span>
            <span>{{table?.showAutoFilterRow ? 'Скрыть строку авто-фильтра' : 'Показать строку авто-фильтра'}}</span>
        </div>
    `,
    table: null,
    columnNode: null,
    anchorEvent: null,
    get hasGroups() {
        return Boolean(this.table?.groupsSpec?.length);
    },
    get isGroupedCol() {
        return Number(this.columnNode?.groupOrder ?? -1) > -1;
    },
    get canHideCol() {
        return Boolean(this.columnNode?.key && this.columnNode.key !== this.table?.treeColumn?.key);
    },
    get hasActiveFilter() {
        const cf = this.table?.columnFilter;
        const hasCol = cf && typeof cf === 'object' && Object.values(cf).some(v => v && String(v).trim() !== '');
        return Boolean(hasCol || this.table?.filter);
    },
    _close() {
        this.parentElement?.close?.('ok');
    },
    expandAllGroups(open) {
        this.table?.setAllGroupsExpanded?.(open);
        this._close();
    },
    sortCol(dir) {
        if (!this.columnNode?.key)
            return;
        this.table?.setColumnState?.(this.columnNode.key, { sortOrder: dir });
        this._close();
    },
    groupByCol() {
        if (!this.columnNode?.key)
            return;
        this.table?.addGroupColumn?.(this.columnNode.key);
        this._close();
    },
    ungroupCol() {
        if (!this.columnNode?.key)
            return;
        this.table?.removeGroupColumn?.(this.columnNode.key);
        this._close();
    },
    toggleGroupPanel() {
        if (this.table) {
            this.table.showGroupPanel = !this.table.showGroupPanel;
            this.table._savePersistedColumnState?.();
        }
        this._close();
    },
    hideCol() {
        if (!this.canHideCol)
            return;
        this.table?.setColumnState?.(this.columnNode.key, { hidden: true });
        this._close();
    },
    fitCol() {
        if (this.columnNode?.key)
            this.table?.autoFitColumn?.(this.columnNode.key);
        this._close();
    },
    clearFilters() {
        if (this.table) {
            this.table.columnFilter = {};
            this.table.filter = '';
        }
        this._close();
    },
    openColumnFilterPopup() {
        const tbl = this.table;
        const col = this.columnNode;
        const ev = this.anchorEvent || tbl;
        this._close();
        if (tbl && col) {
            const header = tbl.$?.('oda-table-header');
            setTimeout(() => header?.openFilter?.(col, ev), 20);
        }
    },
    toggleSearchPanel() {
        if (this.table) {
            this.table.showSearchPanel = !this.table.showSearchPanel;
            this.table._savePersistedColumnState?.();
        }
        this._close();
    },
    toggleAutoFilterRow() {
        if (this.table) {
            this.table.showAutoFilterRow = !this.table.showAutoFilterRow;
            this.table._savePersistedColumnState?.();
        }
        this._close();
    },
    openColumnsDialog() {
        const tbl = this.table;
        const ev = this.anchorEvent || tbl;
        this._close();
        setTimeout(() => tbl?.showSettings?.(ev), 20);
    }
});
