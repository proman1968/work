export default {
    allowSave: true,
    fileControl: 'oda-calendar-event-form'
}

ODA({
    is: 'oda-calendar-event-form',
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
                    <input id="startStr" type="datetime-local" :value="$for.item.startStr" @input="(e) => on_input(e, $for.index)">
                </fieldset>
                <fieldset>
                    <legend>End</legend>
                    <input id="endStr" type="datetime-local" :value="$for.item.endStr" @input="(e) => on_input(e, $for.index)">
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
    on_input(e, i) {
        e.stopPropagation();
        this.events[i][e.target.id] = e.target.value;
        const body = JSON.stringify(this.events);
        if (!this.$item.body || (this.$item.body !== body)) {
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
            n.load().then(content => {
                this.body = content;
            })
        }
    },
    parseICSSimple(icsContent) {
        const events = [];
        const lines = icsContent.split(/\r?\n/);
        if (lines[0].startsWith('['))
            return JSON.parse(lines);
        if (lines[0].startsWith('{'))
            return [JSON.parse(lines)];

        let currentEvent = null;

        for (const line of lines) {
            if (line.startsWith('BEGIN:VEVENT')) {
                currentEvent = {
                    summary: '',
                    location: '',
                    description: '',
                    startStr: '',
                    endStr: ''
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
            else if (key === 'DTSTART') currentEvent.startStr = this.parseICSDate(value);
            else if (key === 'DTEND') currentEvent.endStr = this.parseICSDate(value);
        }

        return events;
    },
    parseICSDate(dateStr) {
        if (dateStr.includes(':')) return dateStr;
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1;
        const day = parseInt(dateStr.substring(6, 8));
        const hour = parseInt(dateStr.substring(9, 11));
        const minute = parseInt(dateStr.substring(11, 13));
        const second = parseInt(dateStr.substring(13, 15) || '0');

        const date = new Date(Date.UTC(year, month, day, hour, minute, second));

        const localYear = date.getFullYear();
        const localMonth = String(date.getMonth() + 1).padStart(2, '0');
        const localDay = String(date.getDate()).padStart(2, '0');
        const localHour = String(date.getHours()).padStart(2, '0');
        const localMinute = String(date.getMinutes()).padStart(2, '0');

        return `${localYear}-${localMonth}-${localDay}T${localHour}:${localMinute}`;
    }
})