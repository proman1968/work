export default {
}

const pad = n => String(n).padStart(2, '0');

ODA({
    is: 'calendar-form',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                padding: 8px;
                gap: 8px;
                min-width: 320px;
                overflow: auto;
            }
            fieldset {
                border: 1px solid var(--border-color);
                border-radius: 4px;
                padding: 2px 8px;
                margin: 0px;
                min-width: 0px;
            }
            legend {
                font-size: small;
                padding: 0px 4px;
            }
            input, textarea {
                border: none;
                outline: none;
                background-color: transparent;
                font-family: inherit;
                font-size: inherit;
                width: 100%;
                padding: 4px 0px;
                box-sizing: border-box;
            }
            textarea {
                resize: vertical;
                min-height: 60px;
            }
            .row {
                @apply --horizontal;
                gap: 8px;
            }
            .row > fieldset {
                @apply --flex;
            }
            .box {
                padding: 4px;
                border: 1px solid var(--border-color);
                border-radius: 4px;
            }
        </style>
        <div ~for="events" class="box" light>
            <fieldset>
                <legend>Title</legend>
                <input id="summary" :value="$for.item.summary || ''" autofocus @input="(e) => on_input(e, $for.index)">
            </fieldset>
            <div class="row">
                <fieldset>
                    <legend>Start</legend>
                    <input id="start" type="datetime-local" :value="toDatetimeLocalInput($for.item.start)" @input="(e) => on_input(e, $for.index)">
                </fieldset>
                <fieldset>
                    <legend>End</legend>
                    <input id="end" type="datetime-local" :value="toDatetimeLocalInput($for.item.end)" @input="(e) => on_input(e, $for.index)">
                </fieldset>
            </div>
            <fieldset>
                <legend>Location</legend>
                <input id="location" :value="$for.item.location || ''" @input="(e) => on_input(e, $for.index)">
            </fieldset>
            <fieldset>
                <legend>Description</legend>
                <textarea id="description" :value="$for.item.description || ''" @input="(e) => on_input(e, $for.index)"></textarea>
            </fieldset>
        </div>
    `,
    /** Offset-ISO / Date → value for datetime-local input (no zone) */
    toDatetimeLocalInput(date) {
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d))
            return '';
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
            + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    /** Persist shape from form event (start/end already offset-ISO) */
    eventToPersist(ev) {
        return {
            summary: ev.summary ?? '',
            location: ev.location ?? '',
            description: ev.description ?? '',
            start: ev.start || (ev.startStr ? new Date(ev.startStr).toISOTimezoneString() : ''),
            end: ev.end || (ev.endStr ? new Date(ev.endStr).toISOTimezoneString() : '')
        };
    },
    on_input(e, i) {
        e.stopPropagation();
        const id = e.target.id;
        if (id === 'start' || id === 'end')
            this.events[i][id] = new Date(e.target.value).toISOTimezoneString();
        else
            this.events[i][id] = e.target.value;
        const body = JSON.stringify(
            this.events.length === 1
                ? this.eventToPersist(this.events[0])
                : this.events.map(this.eventToPersist)
        );
        if (this.$item && (!this.$item.body || (this.$item.body !== body))) {
            this.$item.body = body;
            this.$item.isChanged = true;
        }
    },
    events: undefined,
    body: {
        $def: '',
        set(n) {
            if (n)
                this.events = this.parseICSSimple(n);
        }
    },
    set $item(n) {
        if (n) {
            this.async(async () => {
                const content = await n.load();
                this.body = content;
            })
        }
    },
    hydrateEvent(raw) {
        const ev = {
            summary: raw.summary ?? '',
            location: raw.location ?? '',
            description: raw.description ?? '',
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
    /** ICS DTSTART/DTEND → offset-ISO. Floating = local; Z = UTC instant. */
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
        const hour = parseInt(compact.substring(9, 11) || '0', 10);
        const minute = parseInt(compact.substring(11, 13) || '0', 10);
        const second = parseInt(compact.substring(13, 15) || '0', 10);
        const date = utc
            ? new Date(Date.UTC(year, month, day, hour, minute, second))
            : new Date(year, month, day, hour, minute, second);
        return date.toISOTimezoneString();
    },
    parseICSSimple(icsContent) {
        const lines = icsContent.split(/\r?\n/);
        if (lines[0].startsWith('[')) {
            const arr = JSON.parse(icsContent);
            return arr.map(this.hydrateEvent);
        }
        if (lines[0].startsWith('{'))
            return [this.hydrateEvent(JSON.parse(icsContent))];

        const events = [];
        let currentEvent = null;

        for (const line of lines) {
            if (line.startsWith('BEGIN:VEVENT')) {
                currentEvent = {
                    summary: '',
                    location: '',
                    description: '',
                    start: '',
                    end: ''
                };
                continue;
            }

            if (line.startsWith('END:VEVENT') && currentEvent) {
                events.push(currentEvent);
                currentEvent = null;
                continue;
            }

            if (!currentEvent) continue;

            const colonIndex = line.indexOf(':');
            if (colonIndex === -1) continue;

            const key = line.substring(0, colonIndex).split(';')[0];
            const value = line.substring(colonIndex + 1);

            if (key === 'SUMMARY') currentEvent.summary = value;
            else if (key === 'LOCATION') currentEvent.location = value;
            else if (key === 'DESCRIPTION') currentEvent.description = value;
            else if (key === 'DTSTART') currentEvent.start = this.parseICSDate(value);
            else if (key === 'DTEND') currentEvent.end = this.parseICSDate(value);
        }

        return events;
    }
})
