export default {
    imports: 'oda//app-layout',
    extends: 'oda-app-layout',
    icon: 'enterprise:calendar',
    template: /*html*/`
        <oda-form-calendar slot="main" flex :$item style="overflow-y: auto;" :events ::day ::day-from ::day-to></oda-form-calendar>
        <div slot="right-panel" vertical flex icon="carbon:table-of-contents:180" style="overflow-y: auto; height: 0; padding: 4px 0;">
            <oda-form-calendar-list-view flex :$item label="Tasks" :events :day :day-from :day-to></oda-form-calendar-list-view>
        </div>
    `,
    day: {
        $def: '',
        set(n) {
            this._invalidateEvents();
        }
    },
    dayFrom: '',
    dayTo: '',
    get _logsSource() {
        if (this.$item instanceof CORE.$user)
            return WORK.USER;
        return (async () => {
            const admins = await this.$item.admins;
            return this._logsSource = admins.find(user => user.id === WORK.uid) || WORK.USER;
        })();
    },
    get _logsFolder() {
        const day = this.day;
        if (!day)
            return null;
        return (async () => {
            const source = await this._logsSource;
            if (!source)
                return null;
            await source.logs(day);
            const folder = await source.get_item('/~/logs/.data.logs/history/' + day);
            if (!folder)
                return null;
            this._boundOnLogsChanged ||= () => { this.events = undefined; };
            folder.unlisten?.('changed', this._boundOnLogsChanged);
            folder.listen?.('changed', this._boundOnLogsChanged);
            return this._logsFolder = folder;
        })();
    },
    get events() {
        const day = this.day;
        if (!day)
            return [];
        return (async () => {
            const folder = await this._logsFolder;
            if (!folder)
                return this.events = [];
            let files = await folder.get_item('/*.logs');
            if (!Array.isArray(files))
                files = files ? [files] : [];
            files = await Promise.all(files.map(f => Promise.resolve(f)));
            files = files.filter(f => f?.id?.endsWith?.('.logs'));
            files = files.slice().sort((a, b) => a.id < b.id ? -1 : 1);
            const events = [];
            for (const file of files) {
                const raw = await file.load();
                const log = typeof raw === 'string' ? JSON.parse(raw) : raw;
                let content = log?.content;
                if (typeof content === 'string')
                    content = JSON.parse(content);
                if (!content?.start || !content?.end)
                    continue;
                events.push({
                    start: content.start,
                    end: content.end,
                    summary: content.summary ?? '',
                    location: content.location ?? '',
                    $item: file
                });
            }
            return this.events = events;
        })();
    },
    _invalidateEvents() {
        this.events = undefined;
        this._logsFolder = undefined;
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
            el = ODA.createElement('oda-calendar-event-form', { $item: file });
        } else {
            const detail = arg || {};
            const start = detail.start ? new Date(detail.start) : new Date();
            if (detail.allDay) start.setHours(9, 0, 0, 0);
            const end = detail.end ? new Date(detail.end) : new Date(start.getTime() + 60 * 60 * 1000);
            el = ODA.createElement('oda-calendar-event-form', {
                events: [{
                    start: start.toISOTimezoneString(),
                    end: end.toISOTimezoneString()
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
            return null;
        }

        const persist = eventToPersist(el.events[0]);
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
            location: persist.location
        });
        await this.$item.save_file(file, { message, time: startDate.getTime() });
    }
}

import '/$server/$folder/$file/$ics/handlers/pages/form/file/$handler/class.js'

ODA({
    is: 'oda-form-calendar',
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
            .date-picker {
                border: 1px solid var(--border-color);
                border-radius: 4px;
                cursor: pointer;
            }
            .btn_mode {
                border-radius: 4px;
            }
        </style>
        <item-users accent-invert flex :$item slot="top"></item-users>
        <div vertical class="toolbar">
            <div horizontal>
                <div class="date-nav" horizontal flex>
                    <oda-button icon="icons:chevron-left" @tap="prevPeriod"></oda-button>
                    <input type="date" id="date-picker" class="date-picker" ::value="datePickerValue">
                    <oda-button icon="icons:chevron-right" @tap="nextPeriod"></oda-button>
                </div>
                <div horizontal>
                    <oda-button class="btn_mode" icon="bootstrap:calendar2-day" :border="viewMode==='day'" @tap="viewMode='day'"></oda-button>
                    <oda-button class="btn_mode" icon="bootstrap:calendar2-week" :border="viewMode==='week'" @tap="viewMode='week'"></oda-button>
                    <oda-button class="btn_mode" icon="bootstrap:calendar2-month" :border="viewMode==='month'" @tap="viewMode='month'"></oda-button>
                </div>
            </div>
        </div>
        <div class="calendar-container" flex>
            <oda-calendar-day-view ~if="viewMode==='day'" :events :current-date="currentDate"></oda-calendar-day-view>
            <oda-calendar-week-view ~if="viewMode==='week'" :events :current-date="currentDate"></oda-calendar-week-view>
            <oda-calendar-month-view ~if="viewMode==='month'" :events :current-date="currentDate"></oda-calendar-month-view>
        </div>
    `,
    $item: null,
    events: [],
    day: {
        $def: '',
        set(n) {
        }
    },
    dayFrom: {
        $def: '',
        set(n) {
        }
    },
    dayTo: {
        $def: '',
        set(n) {
        }
    },
    viewMode: {
        $def: 'day', // month, week, day, list
        $save: true,
        set(n) {
            this._updateDateRange();
        }
    },
    currentDate: {
        $def: new Date(),
        set(n) {
            this._updateDateRange();
        }
    },
    _formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },
    _updateDateRange() {
        const date = this.currentDate || new Date();
        this.day = this._formatDate(date);
        if (this.viewMode === 'day') {
            this.dayFrom = this.day;
            this.dayTo = this.day;
        } else if (this.viewMode === 'week') {
            const start = new Date(date);
            const dayOfWeek = start.getDay();
            const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            start.setDate(start.getDate() + diff);
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            this.dayFrom = this._formatDate(start);
            this.dayTo = this._formatDate(end);
        } else if (this.viewMode === 'month') {
            const start = new Date(date.getFullYear(), date.getMonth(), 1);
            const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
            this.dayFrom = this._formatDate(start);
            this.dayTo = this._formatDate(end);
        }
    },
    get datePickerValue() {
        this.currentDate ||= new Date();
        const year = this.currentDate.getFullYear();
        const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(this.currentDate.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },
    set datePickerValue(value) {
        if (value) {
            this.currentDate = new Date(value);
        }
    },
    attached() {
        this.async(() => {
            this._updateDateRange();
        })
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
    prevPeriod() {
        const newDate = new Date(this.currentDate);
        if (this.viewMode === 'day') {
            newDate.setDate(newDate.getDate() - 1);
        } else if (this.viewMode === 'week') {
            newDate.setDate(newDate.getDate() - 7);
        } else {
            newDate.setMonth(newDate.getMonth() - 1);
        }
        this.currentDate = newDate;
        this._updateDateRange();
    },
    nextPeriod() {
        const newDate = new Date(this.currentDate);
        if (this.viewMode === 'day') {
            newDate.setDate(newDate.getDate() + 1);
        } else if (this.viewMode === 'week') {
            newDate.setDate(newDate.getDate() + 7);
        } else {
            newDate.setMonth(newDate.getMonth() + 1);
        }
        this.currentDate = newDate;
        this._updateDateRange();
    },
    goToday() {
        this.currentDate = new Date();
    }
})

ODA({
    is: 'oda-calendar-day-view',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                position: relative;
            }
            .day-body {
                position: relative;
            }
            .slot {
                cursor: pointer;
                height: 16px;
                min-height: 16px;
                box-sizing: border-box;
            }
            .slot:hover {
                background: var(--light-background);
            }
            .hour-label {
                width: 20px;
                border-right: 1px solid var(--border-color);
                font-size: 12px;
                text-align: center;
                box-sizing: border-box;
            }
            .minute-label {
                width: 12px;
                border-right: 1px solid var(--border-color);
                font-size: 10px;
                text-align: right;
                box-sizing: border-box;
                height: 16px;
                line-height: 16px;
                overflow: hidden;
            }
            .event-block {
                position: absolute;
                box-sizing: border-box;
                background: var(--success-color);
                color: var(--dark-color);
                padding: 2px 4px;
                border: 1px solid var(--dark-color);
                border-radius: 4px;
                font-size: small;
                overflow: hidden;
                pointer-events: auto;
                cursor: pointer;
            }
            .event-block .row {
                align-items: center;
                gap: 8px;
            }
            .event-block .interval {
                white-space: nowrap;
                opacity: .8;
                font-size: xx-small;
            }
            .event-block .summary {
                @apply --bold;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .event-block .location {
                font-size: xx-small;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        </style>
        <div ~is="'style'" ~text="anchorStyles"></div>
        <div class="day-body">
            <div horizontal ~for="24" style="border-bottom: 1px solid var(--border-color);">
                <div class="hour-label">
                    {{String($for.item).padStart(2, '0')}}
                </div>
                <div vertical flex>
                    <div horizontal ~for="intervalsInHour" flex ~style="{borderTop: $for.$for.index === 0 ? 'none' :'1px dotted var(--border-color)'}">
                        <div class="minute-label" disabled>
                            {{String(interval * $for.$for.index).padStart(2, '0')}}
                        </div>
                        <div flex class="slot" ~class="'event-block-anchor-' + $for.index + '-' + $for.$for.item" @tap="selectDayTime($for.$for.item, $for.index)">
                        </div>
                    </div>
                </div>
            </div>
            <div ~for="laidOutEvents" :class="$for.item.class" ~style="$for.item.style" @tap.stop="open($for.item.$item)">
                <div horizontal class="row">
                    <div class="interval">{{$for.item.interval}}</div>
                    <div class="summary">{{$for.item.summary}}</div>
                </div>
                <div class="location" ~if="$for.item.location">{{$for.item.location}}</div>
            </div>
        </div>
    `,
    interval: 15,
    get intervalsInHour() {
        return 60 / this.interval;
    },
    get anchorStyles() {
        let style = '';
        for (let h = 0; h < 24; h++) {
            for (let i = 0; i < this.intervalsInHour; i ++) {
                style += `.event-block-anchor-${h}-${i} { anchor-name: --slot-${h}-${i}; }\r\n`;
                // block-anchor-start
                style += `.bas-${h}-${i} {
    position-anchor: --slot-${h}-${i};
    top: anchor(top);
}\r\n`;
                // block-anchor-end
                style += `.bae-${h}-${i} {
    bottom: anchor(--slot-${h}-${i} top);
}\r\n`;
            }
        }
        return style;
    },
    currentDate: new Date(),
    events: [],
    slotAnchor(hour, intervalIdx) {
        return `--slot-${hour}-${intervalIdx}`;
    },
    timeToAnchor(date, edge = 'bas') {
        const interval = this.interval;
        const h = date.getHours();
        const m = ~~(date.getMinutes() / interval);
        return `${edge}-${h}-${m}`;
    },
    get laidOutEvents() {
        const events = this.events;
        if (!events || events.then)
            return [];
        const gap = 2;
        const pad = n => String(n).padStart(2, '0');
        const hhmm = iso => {
            const d = new Date(iso);
            if (isNaN(d))
                return '';
            return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };
        const items = events
            .map(e => ({
                start: e.start,
                end: e.end,
                summary: e.summary ?? '',
                location: e.location ?? '',
                $item: e.$item,
                _start: new Date(e.start).getTime(),
                _end: new Date(e.end).getTime()
            }))
            .filter(e => !isNaN(e._start) && !isNaN(e._end) && e._end > e._start)
            .sort((a, b) => a._start - b._start || (b._end - b._start) - (a._end - a._start));

        const result = [];
        const cluster = [];
        const columns = [];
        let clusterEnd = 0;

        const flush = () => {
            const colCount = Math.max(columns.length, 1);
            const gutter = 30; // former .events-layer left
            for (const item of cluster) {
                let startClass = this.timeToAnchor(new Date(item.start), 'bas');
                let endClass = this.timeToAnchor(new Date(item.end), 'bae');
                const a = hhmm(item.start);
                const b = hhmm(item.end);
                result.push({
                    summary: item.summary,
                    location: item.location,
                    $item: item.$item,
                    interval: a && b ? `${a} - ${b}` : '',
                    style: {
                        left: `calc(${gutter}px + (100% - ${gutter}px) * ${item._col / colCount} + ${gap * 2}px)`,
                        width: `calc((100% - ${gutter}px) / ${colCount})`
                    },
                    class: `event-block ${startClass} ${endClass}`
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
    },
    selectDayTime(intervalIdx, hour) {
        const start = new Date(this.$pdp.currentDate || new Date());
        start.setHours(parseInt(hour), this.interval * intervalIdx, 0, 0);
        const end = new Date(start.getTime() + this.interval * 60 * 1000);
        this.fire('add-event', { start, end });
    },
    open($item) {
        this.$pdp.showMeeting($item);
    }
})

ODA({
    is: 'oda-calendar-week-view',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow: auto;
            }
            .week-grid {
                display: grid;
                grid-template-columns: 60px repeat(7, 1fr);
                gap: 1px;
                background: var(--border-color);
                border-bottom: 1px solid var(--border-color);
                color: var(--dark-color);
            }
            .time-header {
                @apply --header;
                padding: 8px;
            }
            .day-header {
                @apply --header;
                padding: 8px;
                text-align: center;
                font-weight: normal;
            }
            .day-header[today] {
                background: var(--info-color);
            }
            .time-slot {
                @apply --content;
                padding: 4px;
                text-align: center;
            }
            .hour-cell {
                @apply --content;
                /* min-height: 120px; */
                padding: 2px;
                position: relative;
            }
            .hour-cell:hover {
                background: var(--light-background);
            }
            .event-block {
                background: var(--success-color);
                padding: 4px;
                margin: 2px;
                border-radius: 2px;
                font-size: small;
                cursor: pointer;
                overflow: hidden;
                color: var(--dark-color);
            }
            .event-block:hover {
                opacity: 0.8;
            }
        </style>
        <div class="week-grid" style="border-top: 1px solid var(--border-color);">
            <div class="time-header"></div>
            <div ~for="weekDays" class="day-header" :today="$for.item.isToday">
                <div>{{$for.item.dayName}}</div>
                <div>{{$for.item.date}}</div>
            </div>
        </div>
        <div ~for="hours" vertical>
            <div horizontal class="week-grid">
                <div class="time-slot">{{$for.item}}</div>
                <div ~for="weekDays" class="hour-cell" @tap="selectWeekTime($for.$for.item, $for.item)">
                    <div ~for="getEventsForHour($for.$for.item, $for.item)"
                         class="event-block">
                        {{$for.$for.$for.item.title}}
                    </div>
                </div>
            </div>
        </div>
    `,
    currentDate: new Date(),
    events: [],
    hours: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    get weekDays() {
        const days = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Находим понедельник текущей недели
        const current = new Date(this.$pdp.currentDate);
        const dayOfWeek = current.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        current.setDate(current.getDate() + diff);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const monthsNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        for (let i = 0; i < 7; i++) {
            const date = new Date(current);
            date.setDate(current.getDate() + i);
            const checkToday = new Date(date);
            checkToday.setHours(0, 0, 0, 0);
            days.push({
                date: `${date.getDate()} ${monthsNames[date.getMonth()]}`,
                dayName: dayNames[date.getDay()],
                fullDate: date,
                isToday: checkToday.getTime() === today.getTime()
            })
        }
        return days;
    },
    getEventsForHour(dayInfo, hour) {
        if (!this.events || this.events.then) return [];
        const hourNum = parseInt(hour);
        const dayStart = new Date(dayInfo.fullDate);
        dayStart.setHours(hourNum, 0, 0, 0);
        const dayEnd = new Date(dayInfo.fullDate);
        dayEnd.setHours(hourNum, 59, 59, 999);
        return this.events.filter(event => {
            const eventStart = new Date(event.start || 0);
            return !isNaN(eventStart) && eventStart >= dayStart && eventStart <= dayEnd;
        })
    },
    selectWeekTime(dayInfo, hour) {
        const start = new Date(dayInfo.fullDate);
        start.setHours(parseInt(hour), 0, 0, 0);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        this.fire('add-event', { start, end });
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
                grid-template-columns: repeat(7, 1fr);
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
            .day-cell {
                @apply --content;
                min-height: 100px;
                padding: 4px;
                position: relative;
                cursor: pointer;
            }
            .day-cell:hover {
                background: var(--light-background);
            }
            .day-cell[other-month] {
                opacity: 0.9;
            }
            .day-cell[today] {
                background: var(--info-background);
            }
            .day-number {
                font-weight: normal;
                margin-bottom: 4px;
            }
            .event-badge {
                font-size: xx-small;
                padding: 2px 4px;
                margin: 2px 0;
                border-radius: 2px;
                background: var(--success-color);
                color: var(--info-background);;
                text-wrap: auto;
            }
        </style>
        <div class="calendar-grid">
            <div ~for="weekdays" class="weekday-header">{{$for.item}}</div>
            <div ~for="calendarDays" class="day-cell"
                 :other-month="$for.item.otherMonth"
                 :today="$for.item.isToday"
                 @tap="selectMonthDay($for.item)">
                <div class="day-number">{{$for.item.day}}</div>
                <div ~for="$for.item.events" class="event-badge"
                     :title="$for?.$for?.item.title">
                    {{$for?.$for?.item.title}}
                </div>
            </div>
        </div>
    `,
    currentDate: new Date(),
    events: [],
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    get calendarDays() {
        const year = this.$pdp.currentDate.getFullYear();
        const month = this.$pdp.currentDate.getMonth();
        // Первый день месяца
        const firstDay = new Date(year, month, 1);
        // Последний день месяца
        const lastDay = new Date(year, month + 1, 0);
        // День недели первого дня (0 = воскресенье, нужно преобразовать к понедельнику = 0)
        let firstDayOfWeek = firstDay.getDay() - 1;
        if (firstDayOfWeek < 0) firstDayOfWeek = 6;
        const days = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Добавляем дни предыдущего месяца
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = firstDayOfWeek - 1; i >= 0; i--) {
            const day = prevMonthLastDay - i;
            days.push({
                day,
                date: new Date(year, month - 1, day),
                otherMonth: true,
                isToday: false,
                events: []
            });
        }
        // Добавляем дни текущего месяца
        for (let day = 1; day <= lastDay.getDate(); day++) {
            const date = new Date(year, month, day);
            const isToday = date.getTime() === today.getTime();
            days.push({
                day,
                date,
                otherMonth: false,
                isToday,
                events: this.getEventsForDay(date)
            });
        }
        // Добавляем дни следующего месяца до заполнения сетки
        const remainingDays = 42 - days.length; // 6 недель * 7 дней
        for (let day = 1; day <= remainingDays; day++) {
            days.push({
                day,
                date: new Date(year, month + 1, day),
                otherMonth: true,
                isToday: false,
                events: []
            });
        }
        return days;
    },
    getEventsForDay(date) {
        if (!this.events || this.events.then) return [];
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);
        return this.events.filter(event => {
            const eventStart = new Date(event.start || 0);
            return !isNaN(eventStart) && eventStart >= dayStart && eventStart <= dayEnd;
        })
    },
    selectMonthDay(dayInfo) {
        const start = new Date(dayInfo.date);
        start.setHours(9, 0, 0, 0);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        this.fire('add-event', { start, end, allDay: false });
    }
})

ODA({
    is: 'oda-form-calendar-list-view',
    template: /*html*/`
        <style>
            oda-log-view:hover {
                @apply --info-invert;
            }
        </style>
        <oda-log-view ~for="items" :data="$for.item" @tap.stop="open($for.item.$item)"></oda-log-view>
    `,
    day: '',
    dayFrom: '',
    dayTo: '',
    events: [],
    get items() {
        const events = this.events;
        if (!events || events.then)
            return [];
        return events;
    },
    open($item) {
        this.$pdp.showMeeting($item);
    },
})

ODA({is: 'oda-log-view',
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
            .main {
                @apply --vertical;
                @apply --flex;
                min-width: 0;
            }
            .row1 {
                @apply --horizontal;
                align-items: baseline;
                gap: 8px;
            }
            .summary {
                @apply --bold;
                text-align: left;
                justify-content: flex-start;
            }
            .interval {
                white-space: nowrap;
                font-size: small;
                opacity: .8;
            }
            .location {
                font-size: small;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                text-align: left;
                justify-content: flex-start;
            }
            oda-button {
                scale: .8;
                border-radius: 50%;
            }
            oda-button:hover {
                @apply --selection;
            }
        </style>
            <div class="row1" horizontal>
                <span class="interval">{{interval}}</span>
                <span class="summary" flex>{{summary}}</span>
            </div>
            <div class="location">{{location}}</div>
    `,
    data: null,
    get event() {
        return this.data || null;
    },
    get interval() {
        const e = this.event;
        if (!e?.start || !e?.end)
            return '';
        const a = this._hhmm(e.start);
        const b = this._hhmm(e.end);
        if (!a || !b)
            return '';
        return `${a} - ${b}`;
    },
    get summary() {
        return this.event?.summary ?? '';
    },
    get location() {
        return this.event?.location ?? '';
    },
    _hhmm(iso) {
        const d = new Date(iso);
        if (isNaN(d))
            return '';
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
})

/** Persist shape from form event (start/end already offset-ISO) */
function eventToPersist(ev) {
    return {
        summary: ev.summary ?? '',
        location: ev.location ?? '',
        description: ev.description ?? '',
        start: ev.start || (ev.startStr ? new Date(ev.startStr).toISOTimezoneString() : ''),
        end: ev.end || (ev.endStr ? new Date(ev.endStr).toISOTimezoneString() : '')
    };
}

/** `.name.ext` before `/history/` → `name.ext` */
function filenameFromHistoryPath(path) {
    const m = String(path).match(/\/([^/]+)\/history(?:\/|$)/);
    if (!m)
        throw new Error('Не history-путь: ' + path);
    return m[1].startsWith('.') ? m[1].slice(1) : m[1];
}
