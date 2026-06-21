export default {
    imports: 'oda//app-layout',
    extends:'oda-app-layout',
    icon: 'enterprise:calendar',
    template: /* html */`
        <oda-form-calendar slot="main" flex :$item></oda-form-calendar>
        <oda-form-calendar-list-view slot="right-panel" flex :$item label="Tasks" icon="carbon:table-of-contents:180"></oda-form-calendar-list-view>
    `
}

ODA({
    is: 'oda-form-calendar',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                @apply --flex;
            }
            .toolbar {
                padding: 4px;
                @apply --vertical;
                @apply --header;
                align-items: normal;
            }
            .calendar-container{
                @apply --vertical;
                @apply --flex;
                overflow: auto;
            }
            .date-picker{
                border: 1px solid var(--border-color);
                border-radius: 4px;
                cursor: pointer;
            }
            .btn_mode {
                border-radius: 4px;
            }
        </style>
        <item-users accent-invert  flex :$item  slot="top"></item-users>
        <div vertical class="toolbar">
            
            <div horizontal>
                <div class="date-nav" horizontal flex>
                    <oda-button icon="icons:chevron-left" @tap="prevPeriod"></oda-button>
                    <input type="date" class="date-picker" ::value="datePickerValue">
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
    viewMode: {
        $def: 'day', // month, week, day, list
        $save: true
    },
    currentDate: undefined,
    get datePickerValue(){
        this.currentDate ||= new Date();
        const year = this.currentDate.getFullYear();
        const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(this.currentDate.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },
    set datePickerValue(value){
        if(value){
            this.currentDate = new Date(value);
        }
    },
    get events() {
        return []
    },
    $listeners:{
        'add-event'(e) {
            this._addEvent(e);
        }
    },
    async _addEvent(e) {
        const detail = e?.detail?.value || {};
        const start = detail.start ? new Date(detail.start) : new Date();
        if (detail.allDay) start.setHours(9, 0, 0, 0);
        const end = detail.end ? new Date(detail.end) : new Date(start.getTime() + 60 * 60 * 1000);
        const el = ODA.createElement('oda-calendar-event-form', {
            body: {
                startStr: this.toLocalDateTime(start),
                endStr: this.toLocalDateTime(end)
            }
        })
        await WORK.showDialog(el, { TITLE: { label: 'New event', icon: 'enterprise:calendar' } });
        const startDate = new Date(el.body.startStr);
        const endDate = new Date(el.body.endStr);
        if (isNaN(startDate) || isNaN(endDate) || endDate <= startDate) return;
        let body = JSON.stringify(el.body);
        const filename = `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ics`;
        let file = new File([body || ''], filename, { type: "text/plain" });
        await this.$item.save_file(file);
    },
    toLocalDateTime(date) {
        const pad = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },
    prevPeriod() {
        const newDate = new Date(this.currentDate);
        if(this.viewMode === 'day'){
            newDate.setDate(newDate.getDate() - 1);
        } else if(this.viewMode === 'week'){
            newDate.setDate(newDate.getDate() - 7);
        } else {
            newDate.setMonth(newDate.getMonth() - 1);
        }
        this.currentDate = newDate;
    },
    nextPeriod() {
        const newDate = new Date(this.currentDate);
        if(this.viewMode === 'day'){
            newDate.setDate(newDate.getDate() + 1);
        } else if(this.viewMode === 'week'){
            newDate.setDate(newDate.getDate() + 7);
        } else {
            newDate.setMonth(newDate.getMonth() + 1);
        }
        this.currentDate = newDate;
    },
    goToday() {
        this.currentDate = new Date();
    },
    parseICSContent(icsContent, sourcePath){
        const events = [];
        const lines = icsContent.split(/\r?\n/);
        let currentEvent = null;
        for(let i = 0; i < lines.length; i++){
            let line = lines[i].trim();
            // Обработка многострочных значений
            while(i + 1 < lines.length && lines[i + 1].match(/^[ \t]/)){
                i++;
                line += lines[i].trim();
            }
            if(line === 'BEGIN:VEVENT'){
                currentEvent = {sourcePath};
            } else if(line === 'END:VEVENT' && currentEvent){
                events.push(currentEvent);
                currentEvent = null;
            } else if(currentEvent){
                // Разделяем ключ и значение, учитывая параметры (например, DTSTART;TZID=...)
                let colonIndex = line.indexOf(':');
                if(colonIndex > 0){
                    const fullKey = line.substring(0, colonIndex);
                    const value = line.substring(colonIndex + 1);
                    // Извлекаем имя ключа без параметров
                    const key = fullKey.split(';')[0];
                    if(key === 'DTSTART'){
                        currentEvent.start = this.parseICSDate(value);
                    } else if(key === 'DTEND'){
                        currentEvent.end = this.parseICSDate(value);
                    } else if(key === 'SUMMARY'){
                        currentEvent.title = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, '\n');
                    } else if(key === 'DESCRIPTION'){
                        currentEvent.description = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, '\n');
                    } else if(key === 'LOCATION'){
                        currentEvent.location = value.replace(/\\,/g, ',').replace(/\\;/g, ';');
                    } else if(key === 'STATUS'){
                        currentEvent.status = value;
                    } else if(key === 'UID'){
                        currentEvent.uid = value;
                    }
                }
            }
        }
        return events;
    },
    parseICSDate(dateStr){
        // Удаляем экранирование
        dateStr = dateStr.replace(/\\/g, '');
        // Формат: 20130802T103400 или 20130802
        if(dateStr.match(/^\d{8}(T\d{6})?$/)){
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            const hour = dateStr.substring(9, 11) || '00';
            const minute = dateStr.substring(11, 13) || '00';
            const second = dateStr.substring(13, 15) || '00';

            return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
        }
        return new Date(dateStr);
    }
})

ODA({
    is: 'oda-calendar-day-view',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                position: relative;
            }
        </style>
        <style>
            .slot{
                cursor: pointer;
                min-height: 16px;
            }
            .slot:hover{
                background: var(--light-background);
            }
        </style>
        <div horizontal ~for="24" style="border-bottom: 1px solid var(--border-color);">
            <div style="width: 20px; border-right: 1px solid var(--border-color); font-size: 12px; text-align: center; padding: 4px;">
                {{String($for.item).padStart(2, '0')}}
            </div>
            <div vertical flex>
                <div horizontal ~for="intervalsInHour" flex ~style="{borderTop: $for.$for.index === 0 ? 'none' :'1px dotted var(--border-color)'}">
                    <div style="width: 10px; border-right: 1px solid var(--border-color); font-size: 10px; text-align: right; padding: 4px;" disabled>
                        {{String(interval * $for.$for.index).padStart(2, '0')}}
                    </div>
                    <div flex class="slot" @tap="selectDayTime($for.$for.item, $for.index)">
                    </div>
                </div>
            </div>
        </div>
    `,
    interval: 15,
    get intervalsInHour() {
        return 60 / this.interval;
    },
    currentDate: new Date(),
    events: [],
    selectDayTime(hour, intervalIdx) {
        const start = new Date(this.$pdp.currentDate || new Date());
        start.setHours(parseInt(hour), this.interval * intervalIdx, 0, 0);
        const end = new Date(start.getTime() + this.interval * 60 * 1000);
        this.fire('add-event', { start, end });
    }
})

ODA({
    is: 'oda-calendar-week-view',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                overflow: auto;
            }
            .week-grid{
                display: grid;
                grid-template-columns: 60px repeat(7, 1fr);
                gap: 1px;
                background: var(--border-color);
                border-bottom: 1px solid var(--border-color);
                color: var(--dark-color);
            }
            .time-header{
                @apply --header;
                padding: 8px;
            }
            .day-header{
                @apply --header;
                padding: 8px;
                text-align: center;
                font-weight: normal;
            }
            .day-header[today]{
                background: var(--info-color);
            }
            .time-slot{
                @apply --content;
                padding: 4px;
                text-align: center;
            }
            .hour-cell{
                @apply --content;
                /* min-height: 120px; */
                padding: 2px;
                position: relative;
            }
            .hour-cell:hover{
                background: var(--light-background);
            }
            .event-block{
                background: var(--success-color);
                padding: 4px;
                margin: 2px;
                border-radius: 2px;
                font-size: small;
                cursor: pointer;
                overflow: hidden;
                color: var(--dark-color);
            }
            .event-block:hover{
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
            const eventStart = event.start || new Date(0);
            return eventStart >= dayStart && eventStart <= dayEnd;
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
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                overflow: auto;
            }
            .calendar-grid{
                display: grid;
                grid-template-columns: repeat(7, 1fr);
                gap: 1px;
                background: var(--border-color);
                border: 1px solid var(--border-color);
            }
            .weekday-header{
                @apply --header;
                padding: 8px;
                text-align: center;
                font-weight: normal;
                font-size: small;
            }
            .day-cell{
                @apply --content;
                min-height: 100px;
                padding: 4px;
                position: relative;
                cursor: pointer;
            }
            .day-cell:hover{
                background: var(--light-background);
            }
            .day-cell[other-month]{
                opacity: 0.9;
            }
            .day-cell[today]{
                background: var(--info-background);
            }
            .day-number{
                font-weight: normal;
                margin-bottom: 4px;
            }
            .event-badge{
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
            const eventStart = event.start || new Date(0);
            return eventStart >= dayStart && eventStart <= dayEnd;
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
    is: 'oda-calendar-event-form',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                padding: 8px;
                gap: 8px;
                min-width: 320px;
            }
            fieldset{
                border: 1px solid var(--border-color);
                border-radius: 4px;
                padding: 2px 8px;
                margin: 0px;
                min-width: 0px;
            }
            legend{
                font-size: small;
                padding: 0px 4px;
            }
            input, textarea{
                border: none;
                outline: none;
                background-color: transparent;
                font-family: inherit;
                font-size: inherit;
                width: 100%;
                padding: 4px 0px;
                box-sizing: border-box;
            }
            textarea{
                resize: vertical;
                min-height: 60px;
            }
            .row{
                @apply --horizontal;
                gap: 8px;
            }
            .row > fieldset{
                @apply --flex;
            }
        </style>
        <fieldset>
            <legend>Title</legend>
            <input ::value="body.summary" autofocus>
        </fieldset>
        <div class="row">
            <fieldset>
                <legend>Start</legend>
                <input type="datetime-local" ::value="body.startStr">
            </fieldset>
            <fieldset>
                <legend>End</legend>
                <input type="datetime-local" ::value="body.endStr">
            </fieldset>
        </div>
        <fieldset>
            <legend>Location</legend>
            <input ::value="body.location">
        </fieldset>
        <fieldset>
            <legend>Description</legend>
            <textarea ::value="body.description"></textarea>
        </fieldset>
    `,
    body:{
        summary: '',
        location: '',
        description: '',
        startStr: '',
        endStr: ''
    }
})
