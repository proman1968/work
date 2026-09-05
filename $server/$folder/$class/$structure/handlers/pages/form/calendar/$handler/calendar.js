export default {
    imports: 'oda//app-layout, ~/lib//calendar-form.js',
    extends: 'oda-app-layout',
    icon: 'enterprise:calendar',
    template: /*html*/`
        <oda-form-calendar slot="main" flex :$item style="overflow-y: auto;" :events ::view-mode ::current-date ::selected_users></oda-form-calendar>
        <div slot="right-panel" vertical flex icon="carbon:table-of-contents:180" style="overflow-y: auto; height: 0; padding: 4px 0;">
            <oda-form-calendar-list-view flex label="Tasks" :events></oda-form-calendar-list-view>
        </div>
    `,
    viewMode: {
        $def: 'day',
        $save: true,
        set() {
            this.events = undefined;
        }
    },
    currentDate: {
        $def: new Date(),
        set() {
            this.events = undefined;
        }
    },
    selected_users: {
        $def: [],
        set() {
            this.events = undefined;
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
    get events() {
        const dayFrom = this.dayFrom;
        const dayTo = this.dayTo;
        const selected_users = this.selected_users;
        const source = this.$item;
        if (!dayFrom || !dayTo || !source)
            return [];
        return (async () => {
            const history = await source.get_item('/~/logs/.data.logs/history');
            this._boundOnLogsChanged ||= () => { this.events = undefined; };
            if (history !== this._historyFolder) {
                this._historyFolder?.unlisten?.('changed', this._boundOnLogsChanged);
                history?.listen?.('changed', this._boundOnLogsChanged);
                this._historyFolder = history;
            }
            const rows = await source.logs({
                mode: 'bodies',
                from: dayFrom,
                to: dayTo,
                ext: 'ics',
            });
            const parsed = [];
            for (const row of rows || []) {
                if (selected_users.length && !selected_users.includes(row.sender))
                    continue;
                let content = row.content;
                if (typeof content === 'string')
                    content = JSON.parse(content);
                if (!content?.start || !content?.end)
                    continue;
                parsed.push({ row, content });
            }
            const events = await Promise.all(parsed.map(async ({ row, content }) => ({
                start: content.start,
                end: content.end,
                summary: content.summary ?? '',
                location: content.location ?? '',
                allDay: !!content.allDay,
                $item: row.logsFilePath && await WORK.get_item(row.logsFilePath)
            })));
            events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
            return this.events = events;
        })();
    },
    async showMeeting(arg) {
        const isEdit = arg && typeof arg.load === 'function';
        let el;
        let historyPath;

        if (isEdit) {
            const raw = await arg.load();
            const log = typeof raw === 'string' ? JSON.parse(raw) : raw;
            historyPath = log.path;
            const file = await WORK.get_item(log.path);
            el = ODA.createElement('calendar-form', { $item: file });
        } else {
            const detail = arg || {};
            const start = detail.start ? new Date(detail.start) : new Date();
            let end;
            if (detail.allDay) {
                start.setHours(0, 0, 0, 0);
                end = detail.end ? new Date(detail.end) : new Date(start);
                if (!detail.end)
                    end.setDate(end.getDate() + 1);
                else
                    end.setHours(0, 0, 0, 0);
                if (end <= start)
                    end.setDate(start.getDate() + 1);
            } else {
                end = detail.end ? new Date(detail.end) : new Date(start.getTime() + 30 * 60 * 1000);
            }
            el = ODA.createElement('calendar-form', {
                events: [{
                    start: start.toISOTimezoneString(),
                    end: end.toISOTimezoneString(),
                    allDay: !!detail.allDay
                }]
            });
        }

        try {
            await WORK.showDialog(el, {
                TITLE: { label: isEdit ? 'Event' : 'New event', icon: 'enterprise:calendar' },
                OK: { label: 'Сохранить', icon: 'icons:save' },
                CANCEL: { label: 'Отмена', icon: 'icons:close' },
            });
        } catch {
            return;
        }

        const persist = el.eventToPersist(el.events[0]);
        const startDate = new Date(persist.start);
        const endDate = new Date(persist.end);
        if (isNaN(startDate) || isNaN(endDate) || endDate <= startDate)
            return;

        const filename = isEdit
            ? filenameFromHistoryPath(el.$item?.path || historyPath)
            : `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ics`;
        const body = isEdit
            ? (el.$item?.body ?? JSON.stringify(persist))
            : JSON.stringify(persist);
        const file = new File([body || ''], filename, { type: 'text/plain' });
        const message = JSON.stringify({
            start: persist.start,
            end: persist.end,
            summary: persist.summary,
            location: persist.location,
            allDay: !!persist.allDay
        });
        await this.$item.save_file(file, { message, time: startDate.getTime() });
        this.events = undefined;
    }
}

ODA({
    is: 'oda-form-calendar', imports: '~/lib//users.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
            }
            .toolbar {
                @apply --vertical;
                @apply --header;
                padding: 4px;
                align-items: normal;
            }
            .calendar-container {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
            }
            .btn_mode {
                border-radius: 4px;
            }
        </style>
        <item-users accent-invert flex :$item ::selected_users slot="top"></item-users>
        <div vertical class="toolbar">
            <div horizontal>
                <oda-date-nav :view-mode ::current-date></oda-date-nav>
                <div horizontal>
                    <oda-button class="btn_mode" icon="bootstrap:calendar2-day" :border="viewMode==='day'" title="День" @tap="viewMode='day'"></oda-button>
                    <oda-button class="btn_mode" icon="bootstrap:calendar2-range" :border="viewMode==='workweek'" title="Рабочая неделя" @tap="viewMode='workweek'"></oda-button>
                    <oda-button class="btn_mode" icon="bootstrap:calendar2-week" :border="viewMode==='week'" title="Неделя" @tap="viewMode='week'"></oda-button>
                    <oda-button class="btn_mode" icon="bootstrap:calendar2-month" :border="viewMode==='month'" title="Месяц" @tap="viewMode='month'"></oda-button>
                </div>
            </div>
        </div>
        <div class="calendar-container" flex>
            <oda-calendar-month-view ~if="viewMode==='month'" :events :current-date :day-from="dayFrom" :day-to="dayTo"></oda-calendar-month-view>
            <oda-calendar-time-grid ~if="viewMode!=='month'" :events :current-date :view-mode></oda-calendar-time-grid>
        </div>
    `,
    $item: null,
    events: [],
    selected_users: [],
    viewMode: {
        $def: 'day',
        $save: true
    },
    currentDate: {
        $def: new Date()
    },
    $listeners: {
        'add-event'(e) {
            this._addEvent(e);
        }
    },
    async _addEvent(e) {
        const detail = e?.detail?.value || {};
        await this.$pdp.showMeeting(detail);
    },
})

ODA({
    is: 'oda-calendar-event',
    template: /*html*/`
        <style>
            :host {
                display: block;
                box-sizing: border-box;
                background: var(--success-color);
                color: var(--dark-color);
                padding: 2px 4px;
                border-radius: 2px;
                font-size: small;
                overflow: hidden;
                cursor: pointer;
            }
            :host(:hover) {
                opacity: 0.8;
            }
            :host([block]) {
                position: absolute;
                z-index: 1;
                border: 1px solid var(--dark-color);
                border-radius: 4px;
                pointer-events: auto;
            }
            :host([badge]) {
                font-size: xx-small;
                margin: 2px 0;
                color: var(--info-background);
            }
            .row {
                align-items: center;
                gap: 8px;
                min-width: 0;
            }
            .interval {
                white-space: nowrap;
                opacity: .8;
                font-size: xx-small;
            }
            .summary {
                @apply --bold;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
            }
        </style>
        <div horizontal class="row">
            <div class="interval">{{interval}}</div>
            <div class="summary">{{summary}}</div>
        </div>
    `,
    data: null,
    get interval() {
        return eventInterval(this.data);
    },
    get summary() {
        return this.data?.summary ?? '';
    },
    $listeners: {
        tap(e) {
            e.stopPropagation();
            this.$pdp.showMeeting(this.data?.$item);
        }
    }
})

ODA({
    is: 'oda-calendar-time-grid',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
            }
            .time-grid {
                display: grid;
                gap: 1px;
                background: var(--border-color);
                border-bottom: 1px solid var(--border-color);
                color: var(--dark-color);
                position: sticky;
                top: 0;
                z-index: 3;
                flex-shrink: 0;
            }
            .time-header {
                @apply --header;
                padding: 8px;
                position: sticky;
                left: 0;
                z-index: 1;
            }
            .day-header {
                @apply --header;
                padding: 0;
                font-weight: normal;
                min-width: 0;
                height: 100%;
                box-sizing: border-box;
            }
            .day-header[today] {
                @apply --info;
            }
            .day-title {
                padding: 8px;
                align-items: baseline;
                gap: 8px;
                min-width: 0;
            }
            .day-name {
                text-align: center;
            }
            .all-day {
                @apply --flex;
                min-height: 32px;
                cursor: pointer;
                border-top: 1px solid var(--border-color);
                padding: 2px 4px;
                box-sizing: border-box;
            }
            .all-day:hover {
                background: var(--light-background);
            }
            .time-body {
                display: grid;
                position: relative;
            }
            .time-col {
                @apply --content;
                position: sticky;
                left: 0;
                z-index: 2;
            }
            .slot-label {
                height: 32px;
                box-sizing: border-box;
                border-top: 1px dotted var(--border-color);
                font-size: 10px;
                align-items: center;
                justify-content: flex-end;
                padding-right: 4px;
                gap: 4px;
            }
            .slot-label[hour-start] {
                border-top: 1px solid var(--border-color);
            }
            .slot-label:first-of-type {
                border-top: none;
            }
            .hour-label {
                font-size: 12px;
                text-align: center;
            }
            .minute-label {
                width: 14px;
                text-align: right;
                overflow: hidden;
            }
            .day-col {
                @apply --content;
                position: relative;
                min-width: 0;
                overflow: hidden;
            }
            .slot {
                height: 32px;
                box-sizing: border-box;
                cursor: pointer;
                border-top: 1px dotted var(--border-color);
                border-left: 1px solid var(--border-color);
            }
            .slot:first-child {
                border-top: none;
            }
            .slot[hour-start] {
                border-top: 1px solid var(--border-color);
            }
            .slot[hour-start]:first-child {
                border-top: none;
            }
            .day-col > .slot:first-of-type {
                border-top: none;
            }
            .slot:hover {
                background: var(--light-background);
            }
        </style>
        <div class="time-grid" style="border-top: 1px solid var(--border-color);" ~style="gridStyle">
            <div class="time-header"></div>
            <div ~for="columns" class="day-header" vertical :today="$for.item.isToday">
                <div horizontal class="day-title">
                    <div>{{$for.item.day}}</div>
                    <div class="day-name flex">{{$for.item.dayName}}</div>
                </div>
                <div class="all-day" vertical @tap="selectAllDay($for.item)">
                    <oda-calendar-event badge ~for="$for.item.allDayBlocks" :data="$for.$for.item" :title="$for.$for.item.title"></oda-calendar-event>
                </div>
            </div>
        </div>
        <div class="time-body" ~style="gridStyle">
            <div vertical class="time-col">
                <div ~for="hourSlots" class="slot-label" horizontal :hour-start="$for.item.isHourStart">
                    <span class="hour-label">{{$for.item.hourLabel}}</span>
                    <span class="minute-label" disabled>{{$for.item.minuteLabel}}</span>
                </div>
            </div>
            <div ~for="columns" class="day-col" vertical>
                <div ~for="hourSlots" class="slot" :hour-start="$for.$for.item.isHourStart"
                     @tap="selectSlot($for.item, $for.$for.item)"></div>
                <oda-calendar-event block ~for="$for.item.blocks" :data="$for.$for.item" ~style="$for.$for.item.style" :title="$for.$for.item.title"></oda-calendar-event>
            </div>
        </div>
    `,
    interval: 30,
    currentDate: {
        $def: new Date(),
        set(n) {
            this.gridDays = undefined;
            this.columns = undefined;
            this.gridStyle = undefined;
        }
    },
    viewMode: {
        $def: 'day',
        set(n) {
            this.gridDays = undefined;
            this.columns = undefined;
            this.gridStyle = undefined;
        }
    },
    events: [],
    get gridStyle() {
        const n = this.columns?.length || 1;
        return { gridTemplateColumns: `48px repeat(${n}, 1fr)` };
    },
    get hourSlots() {
        const interval = this.interval;
        const perHour = 60 / interval;
        const slots = [];
        for (let h = 0; h < 24; h++) {
            for (let i = 0; i < perHour; i++) {
                slots.push({
                    hour: h,
                    intervalIdx: i,
                    hourLabel: i === 0 ? String(h).padStart(2, '0') : '',
                    minuteLabel: String(interval * i).padStart(2, '0'),
                    isHourStart: i === 0
                });
            }
        }
        return slots;
    },
    get gridDays() {
        const date = _asDate(this.currentDate);
        const mode = this.viewMode;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const toDay = (d) => {
            const check = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            return {
                day: d.getDate(),
                dayName: dayNames[d.getDay()],
                fullDate: d,
                isToday: check.getTime() === today.getTime()
            };
        };
        if (mode === 'day')
            return [toDay(new Date(date.getFullYear(), date.getMonth(), date.getDate()))];
        const start = _weekStart(date);
        const count = mode === 'workweek' ? 5 : 7;
        const days = [];
        for (let i = 0; i < count; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            days.push(toDay(d));
        }
        return days;
    },
    get columns() {
        const days = this.gridDays;
        const events = this.events;
        const list = (!events || events.then) ? [] : events;
        return days.map(day => ({
            ...day,
            allDayBlocks: _allDayEvents(list, day.fullDate),
            blocks: _layoutDayEvents(list, day.fullDate)
        }));
    },
    selectSlot(column, slot) {
        const start = new Date(column.fullDate);
        start.setHours(slot.hour, this.interval * slot.intervalIdx, 0, 0);
        const end = new Date(start.getTime() + this.interval * 60 * 1000);
        this.fire('add-event', { start, end });
    },
    selectAllDay(column) {
        const start = new Date(column.fullDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        this.fire('add-event', { start, end, allDay: true });
    }
})

ODA({
    is: 'oda-calendar-month-view',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow: auto;
            }
            .calendar-grid {
                display: grid;
                grid-template-columns: auto repeat(7, 1fr);
                gap: 1px;
                background: var(--border-color);
                border: 1px solid var(--border-color);
            }
            .weekday-header {
                @apply --header;
                padding: 8px;
                text-align: center;
                font-weight: normal;
                font-size: small;
            }
        </style>
        <div class="calendar-grid">
            <div class="weekday-header"></div>
            <div ~for="weekdays" class="weekday-header">{{$for.item}}</div>
            <oda-calendar-month-week ~for="weeks" :item="$for.item"></oda-calendar-month-week>
        </div>
    `,
    currentDate: new Date(),
    events: [],
    dayFrom: '',
    dayTo: '',
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    get calendarDays() {
        const from = this.dayFrom;
        const to = this.dayTo;
        if (!from || !to)
            return [];
        const month = _asDate(this.currentDate).getMonth();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = [];
        const cur = _parseDay(from);
        const end = _parseDay(to);
        while (cur <= end) {
            const date = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
            days.push({
                day: date.getDate(),
                date,
                otherMonth: date.getMonth() !== month,
                isToday: date.getTime() === today.getTime(),
                events: this.getEventsForDay(date)
            });
            cur.setDate(cur.getDate() + 1);
        }
        return days;
    },
    get weeks() {
        const days = this.calendarDays;
        const weeks = [];
        for (let i = 0; i < days.length; i += 7) {
            const row = days.slice(i, i + 7);
            weeks.push({
                label: _weekRangeLabel(row[0].date, row[row.length - 1].date),
                days: row
            });
        }
        return weeks;
    },
    getEventsForDay(date) {
        const events = this.events;
        if (!events?.length || events.then)
            return [];
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
        return events.filter(event => {
            const start = new Date(event.start).getTime();
            const end = new Date(event.end).getTime();
            return !isNaN(start) && !isNaN(end) && end > dayStart && start < next;
        }).map(event => ({ ...event, title: eventTitle(event) }));
    },
    selectMonthDay(dayInfo) {
        const start = new Date(dayInfo.date);
        start.setHours(9, 0, 0, 0);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        this.fire('add-event', { start, end });
    }
})

ODA({
    is: 'oda-calendar-month-week',
    template: /*html*/`
        <style>
            :host {
                display: contents;
            }
            .week-label {
                @apply --content;
                writing-mode: vertical-rl;
                transform: rotate(180deg);
                text-align: center;
                font-size: small;
                white-space: nowrap;
            }
            oda-calendar-month-day:hover {
                background: var(--light-background);
            }
            oda-calendar-month-day[other-month] {
                opacity: 0.9;
            }
            oda-calendar-month-day[today] {
                background: var(--info-background);
            }
            oda-calendar-month-day[today]:hover {
                background: var(--light-background);
            }
        </style>
        <div class="week-label">{{item?.label}}</div>
        <oda-calendar-month-day ~for="item?.days" :item="$for.item" :other-month="$for.item.otherMonth" :today="$for.item.isToday"></oda-calendar-month-day>
    `,
    item: null,
})

ODA({
    is: 'oda-calendar-month-day',
    template: /*html*/`
        <style>
            :host {
                @apply --content;
                min-height: 100px;
                padding: 4px;
                position: relative;
                cursor: pointer;
                overflow: hidden;
            }
            .day-number {
                font-weight: normal;
                margin-bottom: 4px;
            }
        </style>
        <div class="day-number">{{item?.day}}</div>
        <oda-calendar-event badge ~for="item?.events" :data="$for.item" :title="$for.item.title"></oda-calendar-event>
    `,
    item: null,
    $listeners: {
        tap(e) {
            this.$pdp.selectMonthDay(this.item)
        }
    }
})

ODA({
    is: 'oda-form-calendar-list-view',
    template: /*html*/`
        <oda-log-group ~for="groups" :item="$for.item" vertical flex>
        </oda-log-group>
    `,
    events: [],
    _collapsed: {},
    _toggleGroup(dateKey) {
        this._collapsed = { ...this._collapsed, [dateKey]: !this._collapsed[dateKey] };
    },
    get groups() {
        const events = this.events;
        if (!events || events.then)
            return [];
        const map = new Map();
        for (const ev of events) {
            const key = _formatDate(_asDate(ev.start));
            let group = map.get(key);
            if (!group) {
                group = { dateKey: key, label: _dateGroupLabel(ev.start), events: [] };
                map.set(key, group);
            }
            group.events.push(ev);
        }
        const result = [...map.values()];
        result.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
        const collapsed = this._collapsed;
        for (const g of result)
            g.collapsed = !!collapsed[g.dateKey];
        return result;
    },
    open($item) {
        this.$pdp.showMeeting($item);
    },
})

ODA({is: 'oda-log-group',
    template: /*html*/`
        <style>
            .group-header {
                padding: 4px 8px;
                align-items: center;
                gap: 6px;
                cursor: pointer;
                user-select: none;
                border-top: 1px solid var(--border-color);
            }
            .group-header:first-child {
                border-top: none;
            }
            .group-header:hover {
                background: var(--light-background);
            }
            .group-label {
                @apply --bold;
            }
            .group-count {
                opacity: .5;
                font-size: small;
            }
            .group-items {
                padding-left: 8px;
            }
            oda-log-view:hover {
                @apply --info-invert;
            }
        </style>
        <div horizontal class="group-header" @tap="$pdp._toggleGroup(item.dateKey)">
            <oda-button :icon="item.collapsed ? 'icons:chevron-right' : 'icons:chevron-right:90'" icon-size="16" no-padding></oda-button>
            <span class="group-label">{{item.label}}</span>
            <span class="group-count">{{item.events.length}}</span>
        </div>
        <div ~if="!item.collapsed" class="group-items" vertical flex>
            <oda-log-view ~for="item.events" :data="$for.item" @tap.stop="open($for.item.$item)"></oda-log-view>
        </div>
    `,
    item: null,
})

ODA({
    is: 'oda-log-view',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                min-width: 0;
                padding: 4px 8px;
                gap: 4px;
                cursor: pointer;
            }
            .row1 {
                align-items: baseline;
                gap: 8px;
            }
            .interval {
                white-space: nowrap;
                font-size: small;
                opacity: .8;
            }
            .summary {
                text-align: left;
                justify-content: flex-start;
            }
            .location {
                font-size: small;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                text-align: left;
                justify-content: flex-start;
            }
        </style>
        <div class="row1" horizontal>
            <span class="interval">{{interval}}</span>
            <span class="summary" flex bold>{{summary}}</span>
        </div>
        <div class="location">{{location}}</div>
    `,
    data: null,
    get event() {
        return this.data;
    },
    get interval() {
        return eventInterval(this.event);
    },
    get summary() {
        return this.event?.summary ?? '';
    },
    get location() {
        return this.event?.location ?? '';
    }
})

ODA({
    is: 'oda-date-nav',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --flex;
            }
            .date-picker {
                position: relative;
                cursor: pointer;
                border-radius: 4px;
                padding: 4px 8px;
                align-content: center;
                white-space: nowrap;
            }
            .date-picker input {
                position: absolute;
                inset: 0;
                opacity: 0;
                pointer-events: none;
                width: 100%;
                height: 100%;
            }
        </style>
        <oda-button icon="icons:chevron-left" title="Назад" @tap="prevPeriod"></oda-button>
        <oda-button icon="icons:today" title="Сегодня" @tap="goToday"></oda-button>
        <oda-button icon="icons:chevron-right" title="Вперёд" @tap="nextPeriod"></oda-button>
        <div class="date-picker info" title="Выберите дату" @tap="openPicker">{{periodLabel}}
            <input type="date" tabindex="-1" ::value="datePickerValue">
        </div>
    `,
    viewMode: {
        $def: 'day'
    },
    currentDate: {
        $def: new Date()
    },
    get datePickerValue() {
        return _formatDate(_asDate(this.currentDate));
    },
    set datePickerValue(value) {
        if (value)
            this.currentDate = _parseDay(value);
    },
    get periodLabel() {
        return _periodLabel(_asDate(this.currentDate), this.viewMode);
    },
    openPicker() {
        const input = this.$('input');
        if (input.showPicker)
            input.showPicker();
        else
            input.click();
    },
    prevPeriod() {
        this.currentDate = _shiftDate(_asDate(this.currentDate), this.viewMode, -1);
    },
    nextPeriod() {
        this.currentDate = _shiftDate(_asDate(this.currentDate), this.viewMode, 1);
    },
    goToday() {
        this.currentDate = new Date();
    }
})

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthsNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthsFullNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
const monthsRu = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const daysRu = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function _weekRangeLabel(first, last) {
    const d1 = first.getDate();
    const d2 = last.getDate();
    const m2 = monthsNames[last.getMonth()];
    if (first.getMonth() === last.getMonth())
        return `${d1} - ${d2} ${m2}`;
    return `${d1} ${monthsNames[first.getMonth()]} - ${d2} ${m2}`;
}

function eventHhmm(iso) {
    const d = new Date(iso);
    if (isNaN(d))
        return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function eventInterval(ev) {
    if (ev?.allDay)
        return 'all day';
    if (!ev?.start || !ev?.end)
        return '';
    const a = eventHhmm(ev.start);
    const b = eventHhmm(ev.end);
    if (!a || !b)
        return '';
    return `${a} - ${b}`;
}

function eventTitle(ev) {
    const interval = eventInterval(ev);
    const summary = (ev?.summary ?? '').trim();
    const location = (ev?.location ?? '').trim();
    let line1 = interval;
    if (summary)
        line1 = interval ? `${interval} | ${summary}` : summary;
    if (location)
        return line1 ? `${line1}\n${location}` : location;
    return line1;
}

function filenameFromHistoryPath(path) {
    const m = String(path).match(/\/([^/]+)\/history(?:\/|$)/);
    if (!m)
        throw new Error('Не history-путь: ' + path);
    return m[1].startsWith('.') ? m[1].slice(1) : m[1];
}

function _asDate(value) {
    if (value instanceof Date && !isNaN(value))
        return value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))
        return _parseDay(value);
    const d = new Date(value || Date.now());
    return isNaN(d) ? new Date() : d;
}

function _parseDay(value) {
    const s = String(value);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m)
        return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function _formatDate(date) {
    const d = _asDate(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function _dotDate(date, parts = 'dmy') {
    const dd = String(date.getDate()).padStart(2, '0');
    if (parts === 'd')
        return dd;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    if (parts === 'dm')
        return `${dd}.${mm}`;
    return `${dd}.${mm}.${date.getFullYear()}`;
}

function _periodLabel(date, viewMode) {
    const d = _asDate(date);
    if (viewMode === 'month')
        return `${monthsFullNames[d.getMonth()]} ${d.getFullYear()}`;
    if (viewMode === 'week' || viewMode === 'workweek') {
        const start = _weekStart(d);
        const end = new Date(start);
        end.setDate(end.getDate() + (viewMode === 'workweek' ? 4 : 6));
        const sameYear = start.getFullYear() === end.getFullYear();
        const sameMonth = sameYear && start.getMonth() === end.getMonth();
        const left = sameMonth ? _dotDate(start, 'd') : sameYear ? _dotDate(start, 'dm') : _dotDate(start);
        return `${left} - ${_dotDate(end)}`;
    }
    return _dotDate(d);
}

function _weekStart(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayOfWeek = start.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    start.setDate(start.getDate() + diff);
    return start;
}

function _weekEnd(date) {
    const end = _weekStart(date);
    end.setDate(end.getDate() + 6);
    return end;
}

function _shiftDate(date, viewMode, dir) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (viewMode === 'day')
        next.setDate(next.getDate() + dir);
    else if (viewMode === 'week' || viewMode === 'workweek')
        next.setDate(next.getDate() + dir * 7);
    else
        next.setMonth(next.getMonth() + dir);
    return next;
}

function _dateGroupLabel(iso) {
    const d = _asDate(iso);
    const dayOfWeek = daysRu[d.getDay()];
    const dayNum = d.getDate();
    const month = monthsRu[d.getMonth()];
    const year = d.getFullYear();
    return `${dayOfWeek}, ${dayNum} ${month} ${year} г.`;
}

function _allDayEvents(events, date) {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const result = [];
    for (const e of events) {
        if (!e.allDay)
            continue;
        const s = new Date(e.start).getTime();
        const t = new Date(e.end).getTime();
        if (isNaN(s) || isNaN(t) || t <= s)
            continue;
        if (t <= dayStart || s >= next)
            continue;
        result.push({
            start: e.start,
            end: e.end,
            summary: e.summary ?? '',
            location: e.location ?? '',
            allDay: true,
            $item: e.$item,
            title: eventTitle(e)
        });
    }
    return result;
}

function _layoutDayEvents(events, date) {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const startMs = dayStart.getTime();
    const endMs = dayEnd.getTime();
    const dayMinutes = (endMs - startMs) / 60000;
    const gap = 2;
    const items = [];
    for (const e of events) {
        if (e.allDay)
            continue;
        const s = new Date(e.start).getTime();
        const t = new Date(e.end).getTime();
        if (isNaN(s) || isNaN(t) || t <= s)
            continue;
        if (t <= startMs || s >= endMs)
            continue;
        const clipStart = Math.max(s, startMs);
        const clipEnd = Math.min(t, endMs);
        items.push({
            start: e.start,
            end: e.end,
            summary: e.summary ?? '',
            location: e.location ?? '',
            $item: e.$item,
            _start: clipStart,
            _end: clipEnd,
            _topMin: (clipStart - startMs) / 60000,
            _durMin: (clipEnd - clipStart) / 60000
        });
    }
    items.sort((a, b) => a._start - b._start || (b._end - a._start) - (a._end - a._start));

    const result = [];
    const cluster = [];
    const columns = [];
    let clusterEnd = 0;

    const flush = () => {
        const colCount = Math.max(columns.length, 1);
        for (const item of cluster) {
            result.push({
                start: item.start,
                end: item.end,
                summary: item.summary,
                location: item.location,
                $item: item.$item,
                title: eventTitle(item),
                style: {
                    top: `${item._topMin / dayMinutes * 100}%`,
                    height: `${Math.max(item._durMin / dayMinutes * 100, 100 / 48)}%`,
                    left: `calc(${item._col / colCount * 100}% + ${gap}px)`,
                    width: `calc(${100 / colCount}% - ${gap * 2}px)`
                }
            });
        }
        cluster.length = 0;
        columns.length = 0;
        clusterEnd = 0;
    };

    for (const ev of items) {
        if (cluster.length && ev._start >= clusterEnd)
            flush();
        let col = columns.findIndex(end => end <= ev._start);
        if (col === -1) {
            col = columns.length;
            columns.push(ev._end);
        } else {
            columns[col] = ev._end;
        }
        ev._col = col;
        cluster.push(ev);
        clusterEnd = Math.max(clusterEnd, ev._end);
    }
    if (cluster.length)
        flush();
    return result;
}
