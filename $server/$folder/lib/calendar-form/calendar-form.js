export default {
}

const pad = n => String(n).padStart(2, '0');

function allDayBounds(start, end) {
    const s = new Date(start);
    const t = new Date(end);
    s.setHours(0, 0, 0, 0);
    t.setHours(0, 0, 0, 0);
    if (t <= s)
        t.setDate(s.getDate() + 1);
    return {
        start: s.toISOTimezoneString(),
        end: t.toISOTimezoneString()
    };
}

function applyAllDayTimes(ev) {
    const s = new Date(ev.start);
    if (ev.allDay) {
        const bounds = allDayBounds(ev.start, ev.end);
        ev.start = bounds.start;
        ev.end = bounds.end;
        return;
    }
    if (s.getHours() === 0 && s.getMinutes() === 0) {
        s.setHours(9, 0, 0, 0);
        ev.start = s.toISOTimezoneString();
        ev.end = new Date(s.getTime() + 60 * 60 * 1000).toISOTimezoneString();
    }
}

const CATEGORIES = [
    { id: 'meeting', label: 'Встреча', color: '#2563eb' },
    { id: 'important', label: 'Важное', color: '#dc2626' },
    { id: 'personal', label: 'Личное', color: '#7c3aed' },
    { id: 'client', label: 'Клиент', color: '#059669' },
];

ODA({
    is: 'calendar-form',
    imports: 'oda//checkbox, oda//icon, oda//button',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                padding: 10px 14px;
                gap: 10px;
                min-width: 420px;
                max-width: 560px;
                max-height: 75vh;
                overflow-y: auto;
                font-size: 13px;
                color: var(--content-color);
            }
            fieldset {
                border: 1px solid var(--subtle-border, #cbd5e1);
                border-radius: 8px;
                padding: 3px 10px 6px;
                margin: 0;
                min-width: 0;
                background: var(--content-background);
            }
            legend {
                font-size: 11.5px;
                padding: 0 4px;
                color: var(--muted-color);
            }
            input, textarea, select {
                border: none;
                outline: none;
                background-color: transparent;
                color: inherit;
                font-family: inherit;
                font-size: 13px;
                width: 100%;
                padding: 3px 0;
                box-sizing: border-box;
            }
            textarea {
                resize: vertical;
                min-height: 64px;
            }
            .row {
                @apply --horizontal;
                gap: 10px;
                align-items: stretch;
            }
            .row > fieldset {
                @apply --flex;
            }
            .box {
                @apply --vertical;
                gap: 10px;
            }
            .all-day-toggle {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                cursor: pointer;
                font-size: 13px;
            }
            .cats {
                @apply --horizontal;
                gap: 6px;
                flex-wrap: wrap;
                padding-top: 2px;
            }
            .cat-chip {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                padding: 4px 10px;
                border-radius: 999px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                cursor: pointer;
                font-size: 12px;
                background: var(--subtle-background, #f8fafc);
                user-select: none;
            }
            .cat-chip.active {
                border-color: var(--accent-color, #2563eb);
                background: color-mix(in srgb, var(--accent-color, #2563eb) 10%, var(--content-background, #fff));
                font-weight: 600;
            }
            .cat-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
            }
            .att-list {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                max-height: 112px;
                overflow-y: auto;
                padding: 4px 0 2px;
            }
            .att-chip {
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                padding: 3px 8px;
                border-radius: 999px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                font-size: 12px;
                cursor: pointer;
                background: var(--subtle-background, #f8fafc);
            }
            .att-chip.selected {
                border-color: var(--accent-color, #2563eb);
                background: color-mix(in srgb, var(--accent-color, #2563eb) 14%, var(--content-background, #fff));
                color: var(--accent-color, #2563eb);
                font-weight: 600;
            }
            .att-search {
                border-bottom: 1px solid var(--subtle-border, #e2e8f0) !important;
                margin-bottom: 4px;
                font-size: 12.5px;
            }
            .cancel-row {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 6px 8px;
                border-radius: 8px;
                border: 1px solid color-mix(in srgb, #dc2626 30%, transparent);
                background: color-mix(in srgb, #dc2626 6%, transparent);
                color: #b91c1c;
                cursor: pointer;
            }
        </style>
        <div ~for="events" class="box">
            <fieldset>
                <legend>Название</legend>
                <input id="summary" placeholder="Например: Планёрка отдела" :value="$for.item.summary || ''" autofocus @input="(e) => on_input(e, $for.index)">
            </fieldset>

            <div class="row" style="align-items: center; justify-content: space-between;">
                <label class="all-day-toggle">
                    <oda-checkbox :value="$for.item.allDay" @value-changed="(e) => on_all_day(e, $for.index)"></oda-checkbox>
                    <span>Весь день</span>
                </label>
                <div class="cats">
                    <span ~for="categories" class="cat-chip"
                        ~class="{ active: ($for.$for.item.category || 'meeting') === $for.item.id }"
                        @tap="setCategory($for.$for.index, $for.item.id)">
                        <span class="cat-dot" :style="'background:' + $for.item.color"></span>
                        <span>{{$for.item.label}}</span>
                    </span>
                </div>
            </div>

            <div class="row">
                <fieldset>
                    <legend>Начало</legend>
                    <input id="start" :type="$for.item.allDay ? 'date' : 'datetime-local'" :value="$for.item.allDay ? toDateInput($for.item.start) : toDatetimeLocalInput($for.item.start)" @input="(e) => on_input(e, $for.index)">
                </fieldset>
                <fieldset>
                    <legend>Окончание</legend>
                    <input id="end" :type="$for.item.allDay ? 'date' : 'datetime-local'" :value="$for.item.allDay ? toDateInput($for.item.end, true) : toDatetimeLocalInput($for.item.end)" @input="(e) => on_input(e, $for.index)">
                </fieldset>
            </div>

            <div class="row">
                <fieldset>
                    <legend>Повтор</legend>
                    <select id="recurrence" :value="$for.item.recurrence || 'none'" @change="(e) => on_input(e, $for.index)">
                        <option value="none">Не повторяется</option>
                        <option value="daily">Каждый день</option>
                        <option value="weekly">Каждую неделю</option>
                        <option value="monthly">Каждый месяц</option>
                        <option value="yearly">Каждый год</option>
                    </select>
                </fieldset>
                <fieldset>
                    <legend>Напоминание</legend>
                    <select id="reminderMin" :value="String($for.item.reminderMin || 0)" @change="(e) => on_input(e, $for.index)">
                        <option value="0">Без напоминания</option>
                        <option value="15">За 15 минут</option>
                        <option value="60">За 1 час</option>
                        <option value="1440">За 1 день</option>
                    </select>
                </fieldset>
            </div>

            <fieldset>
                <legend>Место или ссылка на созвон</legend>
                <input id="location" placeholder="Переговорная / ссылка на встречу" :value="$for.item.location || ''" @input="(e) => on_input(e, $for.index)">
            </fieldset>

            <fieldset ~if="contacts.length">
                <legend>Участники из команды ({{($for.item.attendees || []).length}})</legend>
                <input class="att-search" type="search" placeholder="Фильтр коллег…" :value="attFilter" @input="attFilter = $event.target.value">
                <div class="att-list">
                    <span ~for="filteredContacts" class="att-chip"
                        ~class="{ selected: ($for.$for.item.attendees || []).includes($for.item.id) }"
                        @tap="toggleAttendee($for.$for.index, $for.item.id)">
                        <span>{{$for.item.label || $for.item.id}}</span>
                    </span>
                </div>
            </fieldset>

            <fieldset>
                <legend>Внешние email участников (через запятую)</legend>
                <input id="externalEmails" placeholder="partner@company.ru" :value="($for.item.externalEmails || []).join(', ')" @input="(e) => on_external(e, $for.index)">
            </fieldset>

            <fieldset>
                <legend>Описание и повестка</legend>
                <textarea id="description" placeholder="Вопросы для обсуждения, ссылки, заметки…" :value="$for.item.description || ''" @input="(e) => on_input(e, $for.index)"></textarea>
            </fieldset>
        </div>

        <label ~if="canCancel" class="cancel-row">
            <oda-checkbox ::value="cancelled"></oda-checkbox>
            <span>Отменить эту встречу (удалится из сетки календаря)</span>
        </label>
    `,
    categories: CATEGORIES,
    contacts: [],
    attFilter: '',
    get filteredContacts() {
        const q = String(this.attFilter || '').trim().toLowerCase();
        if (!q)
            return this.contacts;
        return this.contacts.filter(c => String(c.label || c.id || '').toLowerCase().includes(q));
    },
    async attached() {
        if (!this.contacts?.length && typeof globalThis.WORK?.visible_contacts === 'function') {
            try {
                const list = await globalThis.WORK.visible_contacts();
                if (Array.isArray(list))
                    this.contacts = list.filter(c => c && c.id && !c.external);
            }
            catch { /* ignore */ }
        }
    },
    toDatetimeLocalInput(date) {
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d))
            return '';
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
            + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    toDateInput(date, inclusiveEnd = false) {
        const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
        if (isNaN(d))
            return '';
        if (inclusiveEnd && d.getHours() === 0 && d.getMinutes() === 0)
            d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
    eventToPersist(ev) {
        let start = ev.start || (ev.startStr ? new Date(ev.startStr).toISOTimezoneString() : '');
        let end = ev.end || (ev.endStr ? new Date(ev.endStr).toISOTimezoneString() : '');
        const allDay = !!ev.allDay;
        if (allDay && start && end) {
            const bounds = allDayBounds(start, end);
            start = bounds.start;
            end = bounds.end;
        }
        const result = {
            summary: ev.summary ?? '',
            location: ev.location ?? '',
            description: ev.description ?? '',
            start,
            end,
            allDay,
            attendees: Array.isArray(ev.attendees) ? ev.attendees : [],
            externalEmails: Array.isArray(ev.externalEmails) ? ev.externalEmails : [],
            recurrence: ev.recurrence || 'none',
            reminderMin: Number(ev.reminderMin) || 0,
            category: ev.category || 'meeting',
        };
        for (const key of ['uid', 'status', 'time', 'organizer', 'sourceNodePath'])
            if (ev[key] != null)
                result[key] = ev[key];
        return result;
    },
    setCategory(i, catId) {
        if (!this.events?.[i])
            return;
        this.events[i].category = catId;
        this.events = [...this.events];
        this.commitEvents();
    },
    toggleAttendee(i, uid) {
        if (!this.events?.[i] || !uid)
            return;
        const cur = Array.isArray(this.events[i].attendees) ? [...this.events[i].attendees] : [];
        const idx = cur.indexOf(uid);
        if (idx >= 0) cur.splice(idx, 1);
        else cur.push(uid);
        this.events[i].attendees = cur;
        this.events = [...this.events];
        this.commitEvents();
    },
    on_external(e, i) {
        e.stopPropagation();
        const arr = String(e.target.value || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
        this.events[i].externalEmails = arr;
        this.commitEvents();
    },
    on_input(e, i) {
        e.stopPropagation();
        const id = e.target.id;
        if (id === 'start' || id === 'end') {
            if (this.events[i].allDay) {
                const d = new Date(`${e.target.value}T00:00:00`);
                if (id === 'end')
                    d.setDate(d.getDate() + 1);
                this.events[i][id] = d.toISOTimezoneString();
            }
            else {
                this.events[i][id] = new Date(e.target.value).toISOTimezoneString();
            }
        }
        else if (id === 'reminderMin') {
            this.events[i].reminderMin = Number(e.target.value) || 0;
        }
        else {
            this.events[i][id] = e.target.value;
        }
        this.commitEvents();
    },
    on_all_day(e, i) {
        e.stopPropagation();
        const ev = this.events[i];
        const checked = !!e.detail.value;
        if (!!ev.allDay === checked)
            return;
        ev.allDay = checked;
        applyAllDayTimes(ev);
        this.events = [...this.events];
        this.commitEvents();
    },
    commitEvents() {
        const body = JSON.stringify(
            this.events.length === 1
                ? this.eventToPersist(this.events[0])
                : this.events.map(ev => this.eventToPersist(ev))
        );
        if (this.$item && (!this.$item.body || (this.$item.body !== body))) {
            this.$item.body = body;
            this.$item.isChanged = true;
        }
    },
    events: undefined,
    canCancel: false,
    cancelled: false,
    set $item(n) {
        if (n) {
            this.async(async () => {
                let content = await n.load();
                if (typeof content === 'string')
                    content = JSON.parse(content);
                this.cancelled = content?.status === 'cancelled';
                this.events = [content];
            })
        }
    },
    hydrateEvent(raw) {
        const ev = {
            summary: raw.summary ?? '',
            location: raw.location ?? '',
            description: raw.description ?? '',
            allDay: !!raw.allDay,
            attendees: Array.isArray(raw.attendees) ? raw.attendees : [],
            externalEmails: Array.isArray(raw.externalEmails) ? raw.externalEmails : [],
            recurrence: raw.recurrence || 'none',
            reminderMin: Number(raw.reminderMin) || 0,
            category: raw.category || 'meeting',
            start: '',
            end: ''
        };
        if (raw.start)
            ev.start = /[Zz]|[+-]\d{2}:\d{2}$/.test(raw.start) ? raw.start : new Date(raw.start).toISOTimezoneString();
        else if (raw.startStr)
            ev.start = new Date(raw.startStr).toISOTimezoneString();
        if (raw.end)
            ev.end = /[Zz]|[+-]\d{2}:\d{2}$/.test(raw.end) ? raw.end : new Date(raw.end).toISOTimezoneString();
        else if (raw.endStr)
            ev.end = new Date(raw.endStr).toISOTimezoneString();
        return ev;
    },
    parseICSDate(dateStr) {
        if (!dateStr)
            return '';
        dateStr = dateStr.replace(/\\/g, '');
        if (dateStr.includes('-') && dateStr.includes('T'))
            return new Date(dateStr).toISOTimezoneString();
        const utc = /Z$/i.test(dateStr);
        const compact = dateStr.replace(/Z$/i, '');
        if (!/^\d{8}(T\d{6})?$/.test(compact))
            return new Date(dateStr);
        const year = parseInt(compact.substring(0, 4), 10);
        const month = parseInt(compact.substring(4, 6), 10) - 1;
        const day = parseInt(compact.substring(6, 8), 10);
        const hasTime = compact.length > 8;
        const hours = hasTime ? parseInt(compact.substring(9, 11), 10) : 0;
        const minutes = hasTime ? parseInt(compact.substring(11, 13), 10) : 0;
        const seconds = hasTime ? parseInt(compact.substring(13, 15), 10) : 0;
        const d = utc
            ? new Date(Date.UTC(year, month, day, hours, minutes, seconds))
            : new Date(year, month, day, hours, minutes, seconds);
        return d.toISOTimezoneString();
    },
    parseICSSimple(icsText) {
        const events = [];
        const lines = icsText.split(/\r\n|\n|\r/);
        let currentEvent = null;
        for (const line of lines) {
            if (line.startsWith('BEGIN:VEVENT')) {
                currentEvent = {};
            } else if (line.startsWith('END:VEVENT')) {
                if (currentEvent)
                    events.push(this.hydrateEvent(currentEvent));
                currentEvent = null;
            } else if (currentEvent) {
                const colonIdx = line.indexOf(':');
                if (colonIdx === -1)
                    continue;
                const key = line.slice(0, colonIdx).split(';')[0].trim();
                const value = line.slice(colonIdx + 1).trim();
                if (key === 'SUMMARY') currentEvent.summary = value;
                else if (key === 'LOCATION') currentEvent.location = value;
                else if (key === 'DESCRIPTION') currentEvent.description = value.replace(/\\n/g, '\n');
                else if (key === 'DTSTART') {
                    currentEvent.start = this.parseICSDate(value);
                    if (/^\d{8}$/.test(value.replace(/\\/g, '')))
                        currentEvent.allDay = true;
                }
                else if (key === 'DTEND') {
                    currentEvent.end = this.parseICSDate(value);
                }
            }
        }
        return events;
    }
});
