const HOUR_HEIGHT = 56;
const HALF_HEIGHT = HOUR_HEIGHT / 2;

const CAT_COLORS = {
    meeting: { bg: '#eff6ff', border: '#2563eb', text: '#1e3a8a' },
    important: { bg: '#fef2f2', border: '#dc2626', text: '#991b1b' },
    personal: { bg: '#f5f3ff', border: '#7c3aed', text: '#5b21b6' },
    client: { bg: '#ecfdf5', border: '#059669', text: '#065f46' },
    task: { bg: '#fff7ed', border: '#ea580c', text: '#9a3412' },
    ai: { bg: '#f0fdf4', border: '#16a34a', text: '#166534' },
};

function _newUid() {
    if (globalThis.crypto?.randomUUID)
        return globalThis.crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function _asDate(v) {
    if (v instanceof Date && !isNaN(v))
        return new Date(v.getTime());
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [y, m, d] = v.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const d = v ? new Date(v) : new Date();
    return isNaN(d) ? new Date() : d;
}

function _formatDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function _weekStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d;
}

function _weekEnd(date) {
    const d = _weekStart(date);
    d.setDate(d.getDate() + 6);
    return d;
}

function _parseDay(str) {
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y, m - 1, d);
}

function _formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function _eventStyleVars(ev) {
    const key = ev.kind === 'task' ? 'task' : ev.kind === 'schedule' ? 'ai' : (ev.category || 'meeting');
    return CAT_COLORS[key] || CAT_COLORS.meeting;
}

function _layoutDayEvents(dayEvents, dayDate) {
    const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime();
    const dayEnd = dayStart + 86400_000;
    const minHeight = 20;
    const items = [];
    for (const ev of dayEvents) {
        if (ev.allDay) continue;
        const s = Date.parse(ev.start);
        const e = Date.parse(ev.end);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= dayStart || s >= dayEnd)
            continue;
        const cs = Math.max(s, dayStart);
        const ce = Math.min(e, dayEnd);
        const startMin = (cs - dayStart) / 60000;
        const endMin = Math.max(startMin + 20, (ce - dayStart) / 60000);
        items.push({
            ev,
            startMin,
            endMin,
            top: (startMin / 60) * HOUR_HEIGHT,
            height: Math.max(minHeight, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2),
        });
    }
    items.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

    // Группируем пересекающиеся события в кластеры и раскладываем по столбцам
    const clusters = [];
    let curCluster = [];
    let clusterEnd = -1;
    for (const it of items) {
        if (!curCluster.length || it.startMin < clusterEnd) {
            curCluster.push(it);
            clusterEnd = Math.max(clusterEnd, it.endMin);
        }
        else {
            clusters.push(curCluster);
            curCluster = [it];
            clusterEnd = it.endMin;
        }
    }
    if (curCluster.length) clusters.push(curCluster);

    const out = [];
    for (const cluster of clusters) {
        const cols = [];
        for (const it of cluster) {
            let colIdx = cols.findIndex(endT => endT <= it.startMin);
            if (colIdx < 0) {
                colIdx = cols.length;
                cols.push(it.endMin);
            }
            else {
                cols[colIdx] = it.endMin;
            }
            it.col = colIdx;
        }
        const totalCols = Math.max(1, cols.length);
        for (const it of cluster) {
            const widthPct = 100 / totalCols;
            const leftPct = it.col * widthPct;
            out.push({
                ...it.ev,
                top: it.top,
                height: it.height,
                leftPct,
                widthPct,
                timeLabel: `${_formatTime(it.ev.start)}–${_formatTime(it.ev.end)}`,
            });
        }
    }
    return out;
}

export default {
    imports: 'oda//icon, oda//button, ~/lib//calendar-form.js',
    icon: 'enterprise:calendar',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
                background: var(--content-background, #ffffff);
                color: var(--content-color, #1e293b);
                position: relative;
            }
            .cal-header {
                @apply --horizontal;
                align-items: center;
                gap: 8px 10px;
                padding: 8px 14px;
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
                background: var(--subtle-background, #f8fafc);
                flex-wrap: wrap;
                flex-shrink: 0;
                max-width: 100%;
                box-sizing: border-box;
            }
            .cal-group {
                @apply --horizontal;
                align-items: center;
                flex-wrap: wrap;
                gap: 4px;
                max-width: 100%;
                min-width: 0;
            }
            .btn-new {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                padding: 6px 13px;
                border-radius: 8px;
                border: none;
                background: var(--accent-color, #2563eb);
                color: var(--accent-back, #ffffff);
                font: inherit;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);
            }
            .btn-new:hover { filter: brightness(1.06); }
            .btn-outline {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                padding: 5px 10px;
                border-radius: 7px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--content-background, #ffffff);
                color: inherit;
                font: inherit;
                font-size: 12.5px;
                font-weight: 500;
                cursor: pointer;
            }
            .btn-outline:hover { background: var(--accent-soft); }
            .btn-outline.active {
                border-color: var(--accent-color, #2563eb);
                color: var(--accent-color, #2563eb);
                background: color-mix(in srgb, var(--accent-color, #2563eb) 10%, var(--content-background, #ffffff));
                font-weight: 600;
            }
            .period-title {
                font-size: 15px;
                font-weight: 700;
                margin: 0 4px;
                white-space: nowrap;
            }
            .date-jump {
                border: 1px solid var(--subtle-border, #cbd5e1);
                border-radius: 6px;
                padding: 3px 6px;
                font: inherit;
                font-size: 12px;
                background: var(--content-background, #ffffff);
                color: inherit;
                cursor: pointer;
            }
            .layer-pill {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                padding: 4px 9px;
                border-radius: 999px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--content-background, #ffffff);
                font: inherit;
                font-size: 12px;
                cursor: pointer;
                opacity: 0.65;
                transition: opacity 0.12s ease, border-color 0.12s ease;
            }
            .layer-pill.on {
                opacity: 1;
                font-weight: 600;
                border-color: var(--border-color, #94a3b8);
            }
            .layer-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
            }
            .seg-tabs {
                @apply --horizontal;
                align-items: center;
                flex-wrap: wrap;
                padding: 2px;
                border-radius: 8px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--content-background, #ffffff);
                gap: 2px;
            }
            .seg-btn {
                border: none;
                background: transparent;
                color: inherit;
                font: inherit;
                font-size: 12.5px;
                font-weight: 500;
                padding: 4px 10px;
                border-radius: 6px;
                cursor: pointer;
            }
            .seg-btn.active {
                background: var(--accent-color, #2563eb);
                color: var(--accent-back, #ffffff);
                font-weight: 600;
            }
            .att-popover {
                position: absolute;
                top: 50px;
                right: 12px;
                z-index: 20;
                width: min(260px, calc(100vw - 24px));
                max-height: min(320px, 60dvh);
                overflow-y: auto;
                background: var(--content-background, #ffffff);
                border: 1px solid var(--border-color, #cbd5e1);
                border-radius: 10px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
                padding: 10px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                font-size: 12.5px;
                box-sizing: border-box;
            }
            @media (max-width: 768px) {
                .period-title {
                    font-size: 13.5px;
                    white-space: normal;
                }
                .seg-btn {
                    padding: 4px 7px;
                    font-size: 12px;
                }
            }
            .att-row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 5px 8px;
                border-radius: 6px;
                cursor: pointer;
            }
            .att-row:hover { background: var(--subtle-background, #f1f5f9); }
            .att-row.selected {
                background: color-mix(in srgb, var(--accent-color, #2563eb) 12%, transparent);
                color: var(--accent-color, #2563eb);
                font-weight: 600;
            }
        </style>

        <div class="cal-header">
            <div class="cal-group">
                <button type="button" class="btn-new" @tap="openCreate()" title="Создать новую встречу">
                    <oda-icon icon="icons:add" icon-size="16"></oda-icon>
                    <span>Встреча</span>
                </button>
                <button type="button" class="btn-outline" @tap="goToday()">Сегодня</button>
                <button type="button" class="btn-outline" @tap="stepDate(-1)" title="Назад" style="padding: 5px 7px;">
                    <oda-icon icon="icons:chevron-left" icon-size="16"></oda-icon>
                </button>
                <button type="button" class="btn-outline" @tap="stepDate(1)" title="Вперёд" style="padding: 5px 7px;">
                    <oda-icon icon="icons:chevron-right" icon-size="16"></oda-icon>
                </button>
                <span class="period-title">{{periodTitle}}</span>
                <input class="date-jump" type="date" :value="day" @change="onDateJump($event)" title="Перейти к дате">
            </div>

            <div style="flex: 1;"></div>

            <div class="cal-group">
                <button type="button" class="layer-pill" ~class="{ on: showEvents }" @tap="showEvents = !showEvents" title="Встречи и события">
                    <span class="layer-dot" style="background:#2563eb;"></span>
                    <span>Встречи</span>
                </button>
                <button type="button" class="layer-pill" ~class="{ on: showTasks }" @tap="showTasks = !showTasks" title="Задачи узла">
                    <span class="layer-dot" style="background:#ea580c;"></span>
                    <span>Задачи</span>
                </button>
                <button type="button" class="layer-pill" ~class="{ on: showSchedules }" @tap="showSchedules = !showSchedules" title="Расписания ИИ-двойника">
                    <span class="layer-dot" style="background:#16a34a;"></span>
                    <span>Расписания ИИ</span>
                </button>
            </div>

            <div class="cal-group" ~if="contacts.length">
                <button type="button" class="btn-outline" ~class="{ active: selected_users.length > 0 || showPeopleMenu }" @tap="showPeopleMenu = !showPeopleMenu" title="Фильтр по участникам">
                    <oda-icon icon="icons:supervisor-account" icon-size="15"></oda-icon>
                    <span>{{selected_users.length ? 'Участники (' + selected_users.length + ')' : 'Участники'}}</span>
                </button>
            </div>

            <div class="seg-tabs">
                <button type="button" class="seg-btn" ~class="{ active: viewMode === 'day' }" @tap="setViewMode('day')">День</button>
                <button type="button" class="seg-btn" ~class="{ active: viewMode === 'workweek' }" @tap="setViewMode('workweek')">Раб. неделя</button>
                <button type="button" class="seg-btn" ~class="{ active: viewMode === 'week' }" @tap="setViewMode('week')">Неделя</button>
                <button type="button" class="seg-btn" ~class="{ active: viewMode === 'month' }" @tap="setViewMode('month')">Месяц</button>
            </div>

            <button type="button" class="btn-outline" @tap="reloadEvents()" title="Обновить календарь" style="padding: 5px 8px;">
                <oda-icon icon="icons:refresh" icon-size="15"></oda-icon>
            </button>
        </div>

        <div ~if="showPeopleMenu" class="att-popover">
            <div style="display:flex;align-items:center;justify-content:space-between;font-weight:700;">
                <span>Фильтр по сотрудникам</span>
                <button type="button" class="btn-outline" style="padding:2px 6px;font-size:11px;" ~if="selected_users.length" @tap="clearUsers()">Сбросить</button>
            </div>
            <div ~for="contacts" class="att-row" ~class="{ selected: selected_users.includes($for.item.id) }" @tap="toggleUserFilter($for.item.id)">
                <span>{{selected_users.includes($for.item.id) ? '☑' : '☐'}}</span>
                <span>{{$for.item.label || $for.item.id}}</span>
            </div>
        </div>

        <oda-calendar-month-view ~if="viewMode === 'month'" flex :events="visibleEvents" :current-date="currentDate"
            @add-event="onAddEvent($event)" @open-event="onOpenEvent($event)"></oda-calendar-month-view>

        <oda-calendar-time-grid ~if="viewMode !== 'month'" flex :events="visibleEvents" :current-date="currentDate" :view-mode="viewMode"
            @add-event="onAddEvent($event)" @open-event="onOpenEvent($event)" @move-event="onMoveEvent($event)"></oda-calendar-time-grid>
    `,
    viewMode: {
        $def: 'week',
        $save: true,
        set() { this.events = undefined; }
    },
    currentDate: {
        $def: null,
        set() { this.events = undefined; }
    },
    selected_users: {
        $def: [],
        set() { this.events = undefined; }
    },
    showEvents: true,
    showTasks: {
        $def: true,
        $save: true,
        set() { this.events = undefined; }
    },
    showSchedules: {
        $def: true,
        $save: true,
        set() { this.events = undefined; }
    },
    showPeopleMenu: false,
    contacts: [],
    _userChangedViewMode: false,
    setViewMode(m) {
        this._userChangedViewMode = true;
        this.viewMode = m;
    },
    async attached() {
        if (!this.currentDate)
            this.currentDate = new Date();
        if (typeof window !== 'undefined' && window.innerWidth <= 768 && !this._userChangedViewMode && this.viewMode === 'week')
            this.viewMode = 'day';
        if (typeof globalThis.WORK?.visible_contacts === 'function') {
            try {
                const list = await globalThis.WORK.visible_contacts();
                if (Array.isArray(list))
                    this.contacts = list.filter(c => c && c.id && !c.external);
            }
            catch { /* ignore */ }
        }
    },
    get day() {
        return _formatDate(_asDate(this.currentDate));
    },
    get dayFrom() {
        const date = _asDate(this.currentDate);
        const mode = this.viewMode;
        if (mode === 'week' || mode === 'workweek')
            return _formatDate(_weekStart(date));
        if (mode === 'month') {
            const first = new Date(date.getFullYear(), date.getMonth(), 1);
            return _formatDate(_weekStart(first));
        }
        return this.day;
    },
    get dayTo() {
        const date = _asDate(this.currentDate);
        const mode = this.viewMode;
        if (mode === 'workweek') {
            const friday = _weekStart(date);
            friday.setDate(friday.getDate() + 4);
            return _formatDate(friday);
        }
        if (mode === 'week')
            return _formatDate(_weekEnd(date));
        if (mode === 'month') {
            const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
            return _formatDate(_weekEnd(last));
        }
        return this.day;
    },
    get periodTitle() {
        const d = _asDate(this.currentDate);
        if (this.viewMode === 'day') {
            return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        }
        if (this.viewMode === 'month') {
            const s = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
            return s.charAt(0).toUpperCase() + s.slice(1);
        }
        const f = _parseDay(this.dayFrom);
        const t = _parseDay(this.dayTo);
        if (f.getMonth() === t.getMonth())
            return `${f.getDate()}–${t.getDate()} ${t.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}`;
        return `${f.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} – ${t.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    },
    get visibleEvents() {
        const all = Array.isArray(this.events) ? this.events : [];
        return all.filter(ev => {
            if (ev.kind === 'task') return this.showTasks;
            if (ev.kind === 'schedule') return this.showSchedules;
            return this.showEvents;
        });
    },
    get events() {
        const dayFrom = this.dayFrom;
        const dayTo = this.dayTo;
        const selected_users = this.selected_users;
        const includeTasks = this.showTasks;
        const includeSchedules = this.showSchedules;
        const source = this.$item;
        if (!dayFrom || !dayTo || !source)
            return [];
        return (async () => {
            this._boundOnLogsChanged ||= () => { this.events = undefined; };
            if (source !== this._historyFolder) {
                this._historyFolder?.unlisten?.('changed', this._boundOnLogsChanged);
                source?.listen?.('changed', this._boundOnLogsChanged);
                this._historyFolder = source;
            }
            if (typeof source.fetch === 'function') {
                try {
                    const res = await source.fetch('calendar_list', {}, JSON.stringify({
                        from: dayFrom,
                        to: dayTo,
                        includeTasks,
                        includeSchedules,
                        attendees: selected_users,
                    }));
                    const list = Array.isArray(res?.events) ? res.events : [];
                    return this.events = list;
                }
                catch { /* fallback to logs */ }
            }
            const rows = await source.logs?.({ mode: 'bodies', from: dayFrom, to: dayTo, ext: 'ics' }).catch(() => []);
            const out = [];
            for (const row of rows || []) {
                try {
                    const c = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
                    if (!c || c.status === 'cancelled' || !c.start || !c.end) continue;
                    out.push({ kind: 'event', ...c, path: row.path, row });
                }
                catch { /* ignore */ }
            }
            return this.events = out;
        })();
    },
    detached() {
        this._historyFolder?.unlisten?.('changed', this._boundOnLogsChanged);
        this._historyFolder = null;
    },
    reloadEvents() {
        this.events = undefined;
    },
    goToday() {
        this.currentDate = new Date();
    },
    stepDate(dir) {
        const d = _asDate(this.currentDate);
        if (this.viewMode === 'day') d.setDate(d.getDate() + dir);
        else if (this.viewMode === 'week' || this.viewMode === 'workweek') d.setDate(d.getDate() + 7 * dir);
        else d.setMonth(d.getMonth() + dir);
        this.currentDate = d;
    },
    onDateJump(e) {
        if (e.target.value)
            this.currentDate = _parseDay(e.target.value);
    },
    toggleUserFilter(uid) {
        const cur = [...this.selected_users];
        const i = cur.indexOf(uid);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(uid);
        this.selected_users = cur;
    },
    clearUsers() {
        this.selected_users = [];
    },
    openCreate() {
        const start = _asDate(this.currentDate);
        const now = new Date();
        start.setHours(Math.max(9, Math.min(18, now.getHours() + 1)), 0, 0, 0);
        const end = new Date(start.getTime() + 60 * 60_000);
        this.showMeeting({ start, end, allDay: false });
    },
    onAddEvent(e) {
        this.showMeeting(e?.detail?.value || e?.detail || {});
    },
    async onOpenEvent(e) {
        const ev = e?.detail?.value || e?.detail;
        if (!ev) return;
        if (ev.kind === 'task' && ev.path) {
            const item = await globalThis.WORK?.get_item?.(ev.path).catch(() => null);
            if (item && typeof window?.execute === 'function')
                window.execute(item);
            return;
        }
        if (ev.kind === 'schedule') {
            ODA.showMessage?.(`Расписание ИИ: «${ev.summary}» (${_formatTime(ev.start)})`);
            return;
        }
        await this.showMeeting(ev);
    },
    async onMoveEvent(e) {
        const d = e?.detail?.value || e?.detail;
        if (!d?.ev || !d.start || !d.end || d.ev.kind !== 'event')
            return;
        const payload = {
            ...d.ev,
            start: d.start,
            end: d.end,
            status: 'confirmed',
        };
        try {
            await this.$item.fetch('calendar_save', {}, JSON.stringify(payload));
            this.events = undefined;
        }
        catch (err) {
            ODA.showMessage?.(err?.message || String(err));
        }
    },
    async showMeeting(arg) {
        const isEdit = Boolean(arg && arg.uid && arg.start);
        let el;
        let uid;

        if (isEdit) {
            uid = arg.uid;
            const editPayload = {
                ...arg,
                start: arg.masterStart || arg.start,
                end: arg.masterEnd || arg.end,
            };
            el = ODA.createElement('calendar-form', {
                events: [editPayload],
                canCancel: true,
            });
        }
        else {
            uid = _newUid();
            const detail = arg || {};
            const start = detail.start ? new Date(detail.start) : new Date();
            let end;
            if (detail.allDay) {
                start.setHours(0, 0, 0, 0);
                end = detail.end ? new Date(detail.end) : new Date(start);
                if (!detail.end) end.setDate(end.getDate() + 1);
                else end.setHours(0, 0, 0, 0);
                if (end <= start) end.setDate(start.getDate() + 1);
            }
            else {
                end = detail.end ? new Date(detail.end) : new Date(start.getTime() + 60 * 60_000);
            }
            el = ODA.createElement('calendar-form', {
                events: [{
                    start: start.toISOTimezoneString(),
                    end: end.toISOTimezoneString(),
                    allDay: !!detail.allDay,
                    category: 'meeting',
                    recurrence: 'none',
                    reminderMin: 15,
                    attendees: [],
                    externalEmails: [],
                }],
            });
        }

        try {
            await WORK.showDialog(el, {
                TITLE: { label: isEdit ? 'Редактирование встречи' : 'Новая встреча', icon: 'enterprise:calendar' },
                OK: { label: 'Сохранить', icon: 'icons:save' },
                CANCEL: { label: 'Отмена', icon: 'icons:close' },
            });
        }
        catch {
            return;
        }

        const persist = el.eventToPersist(el.events[0]);
        const startDate = new Date(persist.start);
        const endDate = new Date(persist.end);
        if (isNaN(startDate) || isNaN(endDate) || endDate <= startDate) {
            ODA.showMessage?.('Время окончания должно быть позже начала');
            return;
        }
        const status = el.cancelled ? 'cancelled' : 'confirmed';
        const payload = {
            ...persist,
            uid,
            status,
            summary: persist.summary || (status === 'cancelled' ? 'Отменено' : 'Встреча'),
            time: startDate.getTime(),
        };
        try {
            if (typeof this.$item.fetch === 'function') {
                await this.$item.fetch('calendar_save', {}, JSON.stringify(payload));
            }
            else {
                await this.$item.save_file(
                    new File([JSON.stringify(payload)], `${uid}.ics`, { type: 'application/json' }),
                    { time: startDate.getTime(), encoding: 'utf-8', message: JSON.stringify(payload) }
                );
            }
            this.events = undefined;
        }
        catch (err) {
            ODA.showMessage?.(err?.message || String(err));
        }
    },
};

ODA({
    is: 'oda-calendar-time-grid',
    imports: 'oda//icon',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
                position: relative;
                user-select: none;
            }
            .sticky-top {
                position: sticky;
                top: 0;
                z-index: 5;
                background: var(--content-background, #ffffff);
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
                flex-shrink: 0;
            }
            .grid-row {
                display: grid;
                grid-template-columns: 56px repeat(var(--cols, 7), minmax(0, 1fr));
            }
            @media (max-width: 768px) {
                .grid-row,
                .body-grid {
                    min-width: calc(56px + var(--cols, 7) * 110px);
                }
            }
            .time-corner {
                border-right: 1px solid var(--subtle-border, #e2e8f0);
                font-size: 11px;
                color: var(--muted-color);
                display: flex;
                align-items: flex-end;
                justify-content: flex-end;
                padding: 4px 6px;
            }
            .day-head {
                display: flex;
                flex-direction: column;
                border-right: 1px solid var(--subtle-border, #e2e8f0);
                min-width: 0;
            }
            .day-head:last-child { border-right: none; }
            .day-label {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 8px 4px 6px;
                font-size: 12.5px;
                font-weight: 600;
            }
            .day-num {
                width: 26px;
                height: 26px;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
            }
            .day-head[today] .day-num {
                background: var(--accent-color, #2563eb);
                color: #ffffff;
            }
            .day-head[today] .day-name {
                color: var(--accent-color, #2563eb);
            }
            .all-day-cell {
                min-height: 26px;
                padding: 2px 4px;
                border-top: 1px solid var(--subtle-border, #e2e8f0);
                display: flex;
                flex-direction: column;
                gap: 2px;
                cursor: pointer;
                background: var(--subtle-background, #f8fafc);
            }
            .all-day-chip {
                font-size: 11px;
                font-weight: 600;
                padding: 2px 6px;
                border-radius: 4px;
                border-left: 3px solid;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                cursor: pointer;
            }
            .body-grid {
                display: grid;
                grid-template-columns: 56px repeat(var(--cols, 7), minmax(0, 1fr));
                position: relative;
                flex: 1 0 auto;
            }
            .hours-col {
                border-right: 1px solid var(--subtle-border, #e2e8f0);
                background: var(--content-background, #ffffff);
            }
            .hour-mark {
                height: 56px;
                box-sizing: border-box;
                padding: 2px 6px 0 0;
                text-align: right;
                font-size: 11px;
                color: var(--muted-color, #64748b);
                border-top: 1px solid transparent;
            }
            .day-col {
                position: relative;
                border-right: 1px solid var(--subtle-border, #e2e8f0);
                height: 1344px;
            }
            .day-col:last-child { border-right: none; }
            .day-col[today] {
                background: color-mix(in srgb, var(--accent-color, #2563eb) 3%, transparent);
            }
            .half-slot {
                height: 28px;
                box-sizing: border-box;
                cursor: pointer;
                border-top: 1px dotted var(--subtle-border, #e2e8f0);
            }
            .half-slot.hour-start {
                border-top: 1px solid var(--subtle-border, #e2e8f0);
            }
            .half-slot:first-child { border-top: none; }
            .half-slot:hover {
                background: color-mix(in srgb, var(--accent-color, #2563eb) 7%, transparent);
            }
            .ev-card {
                position: absolute;
                box-sizing: border-box;
                padding: 3px 6px 6px;
                border-radius: 6px;
                border-left: 3px solid;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
                font-size: 11.5px;
                overflow: hidden;
                cursor: pointer;
                z-index: 2;
                transition: box-shadow 0.12s ease;
            }
            .ev-card:hover {
                z-index: 4;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.16);
            }
            .ev-title {
                font-weight: 700;
                line-height: 1.2;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .ev-meta {
                font-size: 10.5px;
                opacity: 0.85;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .ev-resize {
                position: absolute;
                left: 0;
                right: 0;
                bottom: 0;
                height: 6px;
                cursor: ns-resize;
            }
            .now-line {
                position: absolute;
                left: 0;
                right: 0;
                height: 2px;
                background: #dc2626;
                z-index: 3;
                pointer-events: none;
            }
            .now-line::before {
                content: '';
                position: absolute;
                left: -4px;
                top: -3px;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #dc2626;
            }
        </style>

        <div class="sticky-top">
            <div class="grid-row" ~style="colsStyle">
                <div class="time-corner">Весь день</div>
                <div ~for="columns" class="day-head" :today="$for.item.isToday">
                    <div class="day-label">
                        <span class="day-name">{{$for.item.dayName}}</span>
                        <span class="day-num">{{$for.item.dayNum}}</span>
                    </div>
                    <div class="all-day-cell" @tap="onAllDayTap($for.item)">
                        <div ~for="$for.item.allDayEvents" class="all-day-chip"
                            :style="cardStyle($for.item)"
                            @tap.stop="openEv($for.item)">
                            {{$for.item.summary || 'Событие'}}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="body-grid" ~style="colsStyle">
            <div class="hours-col">
                <div ~for="hours" class="hour-mark">{{$for.item}}</div>
            </div>
            <div ~for="columns" class="day-col" :today="$for.item.isToday"
                @dragover.prevent="onDragOver($event)"
                @drop.prevent="onDrop($event, $for.item)">
                <div ~for="halfSlots" class="half-slot" ~class="{ 'hour-start': $for.item.isHour }"
                    @tap="onSlotTap($for.$for.item, $for.item)"></div>

                <div ~if="$for.item.isToday && nowTop >= 0" class="now-line" :style="'top:' + nowTop + 'px;'"></div>

                <div ~for="$for.item.timedEvents" class="ev-card"
                    :draggable="$for.item.kind === 'event'"
                    :style="timedCardStyle($for.item)"
                    @dragstart="onDragStart($event, $for.item)"
                    @tap.stop="openEv($for.item)">
                    <div class="ev-title">{{$for.item.summary || 'Событие'}}</div>
                    <div class="ev-meta">{{$for.item.timeLabel}}{{$for.item.location ? ' · ' + $for.item.location : ''}}</div>
                    <div ~if="$for.item.kind === 'event'" class="ev-resize" @pointerdown.stop="startResize($event, $for.item)"></div>
                </div>
            </div>
        </div>
    `,
    events: [],
    currentDate: null,
    viewMode: 'week',
    nowTop: -1,
    _scrolledOnce: false,
    _dragEv: null,
    attached() {
        this._updateNowLine();
        this._nowTimer = setInterval(() => this._updateNowLine(), 60_000);
        requestAnimationFrame(() => {
            if (!this._scrolledOnce) {
                this._scrolledOnce = true;
                this.scrollTop = 8 * HOUR_HEIGHT;
            }
        });
    },
    detached() {
        clearInterval(this._nowTimer);
    },
    _updateNowLine() {
        const d = new Date();
        this.nowTop = ((d.getHours() * 60 + d.getMinutes()) / 60) * HOUR_HEIGHT;
    },
    get hours() {
        const out = [];
        for (let h = 0; h < 24; h++)
            out.push(String(h).padStart(2, '0') + ':00');
        return out;
    },
    get halfSlots() {
        const out = [];
        for (let i = 0; i < 48; i++)
            out.push({ idx: i, isHour: i % 2 === 0 });
        return out;
    },
    get columns() {
        const cur = _asDate(this.currentDate);
        const todayStr = _formatDate(new Date());
        const count = this.viewMode === 'day' ? 1 : this.viewMode === 'workweek' ? 5 : 7;
        const start = this.viewMode === 'day' ? new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()) : _weekStart(cur);
        const list = Array.isArray(this.events) ? this.events : [];
        const cols = [];
        for (let i = 0; i < count; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const ds = _formatDate(d);
            const dayStartMs = d.getTime();
            const dayEndMs = dayStartMs + 86400_000;
            const dayEvents = list.filter(ev => {
                const s = Date.parse(ev.start);
                const e = Date.parse(ev.end);
                return Number.isFinite(s) && Number.isFinite(e) && e > dayStartMs && s < dayEndMs;
            });
            cols.push({
                dateStr: ds,
                fullDate: d,
                dayNum: d.getDate(),
                dayName: d.toLocaleDateString('ru-RU', { weekday: 'short' }),
                isToday: ds === todayStr,
                allDayEvents: dayEvents.filter(ev => ev.allDay),
                timedEvents: _layoutDayEvents(dayEvents, d),
            });
        }
        return cols;
    },
    get colsStyle() {
        return `--cols: ${this.columns.length};`;
    },
    cardStyle(ev) {
        const c = _eventStyleVars(ev);
        return `background:${c.bg};border-left-color:${c.border};color:${c.text};`;
    },
    timedCardStyle(ev) {
        const c = _eventStyleVars(ev);
        return `top:${ev.top}px;height:${ev.height}px;left:calc(${ev.leftPct}% + 2px);width:calc(${ev.widthPct}% - 4px);background:${c.bg};border-left-color:${c.border};color:${c.text};`;
    },
    onAllDayTap(col) {
        const s = new Date(col.fullDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(s);
        e.setDate(e.getDate() + 1);
        this.fire('add-event', { start: s, end: e, allDay: true });
    },
    onSlotTap(col, slot) {
        const s = new Date(col.fullDate);
        const h = Math.floor(slot.idx / 2);
        const m = (slot.idx % 2) * 30;
        s.setHours(h, m, 0, 0);
        const e = new Date(s.getTime() + 60 * 60_000);
        this.fire('add-event', { start: s, end: e, allDay: false });
    },
    openEv(ev) {
        this.fire('open-event', ev);
    },
    onDragStart(e, ev) {
        if (ev.kind !== 'event') {
            e.preventDefault();
            return;
        }
        this._dragEv = ev;
        e.dataTransfer?.setData('text/plain', ev.uid || 'event');
    },
    onDragOver(e) {
        if (this._dragEv)
            e.preventDefault();
    },
    onDrop(e, col) {
        const ev = this._dragEv;
        this._dragEv = null;
        if (!ev) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const y = Math.max(0, e.clientY - rect.top);
        const halfIdx = Math.min(47, Math.floor(y / HALF_HEIGHT));
        const durMs = Math.max(30 * 60_000, Date.parse(ev.end) - Date.parse(ev.start));
        const nextStart = new Date(col.fullDate);
        nextStart.setHours(Math.floor(halfIdx / 2), (halfIdx % 2) * 30, 0, 0);
        const nextEnd = new Date(nextStart.getTime() + durMs);
        this.fire('move-event', {
            ev,
            start: nextStart.toISOTimezoneString(),
            end: nextEnd.toISOTimezoneString(),
        });
    },
    startResize(e, ev) {
        e.preventDefault();
        const startY = e.clientY;
        const origStartMs = Date.parse(ev.start);
        const origEndMs = Date.parse(ev.end);
        const onMove = (mv) => {
            const dy = mv.clientY - startY;
            const deltaMin = Math.round((dy / HOUR_HEIGHT) * 60 / 15) * 15;
            const nextEndMs = Math.max(origStartMs + 30 * 60_000, origEndMs + deltaMin * 60_000);
            const card = e.target.closest('.ev-card');
            if (card)
                card.style.height = Math.max(20, ((nextEndMs - origStartMs) / 3600_000) * HOUR_HEIGHT - 2) + 'px';
        };
        const onUp = (up) => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            const dy = up.clientY - startY;
            const deltaMin = Math.round((dy / HOUR_HEIGHT) * 60 / 15) * 15;
            if (!deltaMin) return;
            const nextEndMs = Math.max(origStartMs + 30 * 60_000, origEndMs + deltaMin * 60_000);
            this.fire('move-event', {
                ev,
                start: new Date(origStartMs).toISOTimezoneString(),
                end: new Date(nextEndMs).toISOTimezoneString(),
            });
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    },
});

ODA({
    is: 'oda-calendar-month-view',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
                padding: 8px 12px 12px;
            }
            .month-grid {
                display: grid;
                grid-template-columns: repeat(7, minmax(0, 1fr));
                grid-auto-rows: minmax(105px, 1fr);
                gap: 1px;
                background: var(--subtle-border, #e2e8f0);
                border: 1px solid var(--subtle-border, #e2e8f0);
                border-radius: 8px;
                overflow: hidden;
                flex: 1 0 auto;
            }
            .wday-head {
                background: var(--subtle-background, #f8fafc);
                padding: 6px 8px;
                text-align: center;
                font-size: 12px;
                font-weight: 600;
                color: var(--muted-color, #64748b);
                min-height: auto;
                grid-row: auto;
            }
            .month-head-row {
                display: grid;
                grid-template-columns: repeat(7, minmax(0, 1fr));
                gap: 1px;
                background: var(--subtle-border, #e2e8f0);
                border: 1px solid var(--subtle-border, #e2e8f0);
                border-bottom: none;
                border-radius: 8px 8px 0 0;
                overflow: hidden;
            }
            .day-cell {
                background: var(--content-background, #ffffff);
                padding: 6px;
                display: flex;
                flex-direction: column;
                gap: 3px;
                cursor: pointer;
                min-width: 0;
            }
            .day-cell:hover { background: var(--subtle-background, #f8fafc); }
            .day-cell.other { opacity: 0.48; }
            .cell-num {
                width: 24px;
                height: 24px;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 12.5px;
                font-weight: 600;
                align-self: flex-end;
            }
            .day-cell.today .cell-num {
                background: var(--accent-color, #2563eb);
                color: #ffffff;
            }
            .chip {
                font-size: 11px;
                padding: 2px 5px;
                border-radius: 4px;
                border-left: 3px solid;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-weight: 500;
            }
            .more {
                font-size: 11px;
                color: var(--muted-color);
                padding-left: 4px;
            }
        </style>
        <div class="month-head-row">
            <div ~for="weekdays" class="wday-head">{{$for.item}}</div>
        </div>
        <div class="month-grid" style="border-top-left-radius:0;border-top-right-radius:0;">
            <div ~for="days" class="day-cell" ~class="{ other: $for.item.otherMonth, today: $for.item.isToday }" @tap="selectDay($for.item.date)">
                <span class="cell-num">{{$for.item.day}}</span>
                <div ~for="$for.item.visibleChips" class="chip" :style="chipStyle($for.item)" @tap.stop="openEv($for.item)">
                    {{$for.item.allDay ? '' : ($for.item.timeShort + ' ')}}{{$for.item.summary || 'Событие'}}
                </div>
                <div ~if="$for.item.extraCount > 0" class="more">+ ещё {{$for.item.extraCount}}</div>
            </div>
        </div>
    `,
    currentDate: null,
    events: [],
    weekdays: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    get days() {
        const cur = _asDate(this.currentDate);
        const month = cur.getMonth();
        const start = _weekStart(new Date(cur.getFullYear(), month, 1));
        const end = _weekEnd(new Date(cur.getFullYear(), month + 1, 0));
        const todayStr = _formatDate(new Date());
        const list = Array.isArray(this.events) ? this.events : [];
        const out = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const ds = _formatDate(date);
            const sMs = date.getTime();
            const eMs = sMs + 86400_000;
            const dayEvs = list.filter(ev => {
                const s = Date.parse(ev.start);
                const e = Date.parse(ev.end);
                return Number.isFinite(s) && Number.isFinite(e) && e > sMs && s < eMs;
            }).map(ev => ({ ...ev, timeShort: _formatTime(ev.start) }));
            out.push({
                day: date.getDate(),
                date,
                otherMonth: date.getMonth() !== month,
                isToday: ds === todayStr,
                visibleChips: dayEvs.slice(0, 4),
                extraCount: Math.max(0, dayEvs.length - 4),
            });
        }
        return out;
    },
    chipStyle(ev) {
        const c = _eventStyleVars(ev);
        return `background:${c.bg};border-left-color:${c.border};color:${c.text};`;
    },
    selectDay(date) {
        const s = new Date(date);
        s.setHours(0, 0, 0, 0);
        const e = new Date(s);
        e.setDate(e.getDate() + 1);
        this.fire('add-event', { start: s, end: e, allDay: true });
    },
    openEv(ev) {
        this.fire('open-event', ev);
    },
});
