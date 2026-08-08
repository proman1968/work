export default {
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                padding: 4px;
                align-items: flex-start;
            }
            label {
                font-size: small;
            }
        </style>
        <div ~if="interval"><label>Date:</label> {{interval}}</div>
        <div ~if="value?.summary"><label>Summary:</label> {{value?.summary}}</div>
        <div ~if="value?.location"><label>Location:</label> {{value?.location}}</div>
        <div ~if="value?.description"><label>Description:</label> {{value?.description}}</div>
    `,
    attached() {
        this.async(() => {
            this.$pdp.colorMode = 'content';
        })
    },
    set $item(n) {
        if (n) {
            n.load().then(content => {
                const value = JSON.parse(content);
                this.value = Array.isArray(value) ? value[0] : value;
            })
        }
    },
    value: undefined,
    get interval() {
        const v = this.value;
        if (!v)
            return '';
        const a = this._fmt(v.start, v.startStr);
        const b = this._fmt(v.end, v.endStr);
        if (!a || !b)
            return '';
        return `${a} - ${b}`;
    },
    _fmt(iso, legacy) {
        if (iso) {
            const local = this.toDatetimeLocalInput(iso);
            return local ? local.replace('T', ' ') : '';
        }
        if (legacy)
            return String(legacy).replace('T', ' ');
        return '';
    },
    /** Offset-ISO / Date → value for datetime-local input (no zone) */
    toDatetimeLocalInput(date) {
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d))
            return '';
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
            + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
}

const pad = n => String(n).padStart(2, '0');
