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
        <div ~if="value?.startStr && value?.endStr"><label>Date:</label> {{value.startStr.replace('T', ' ') }} - {{value.endStr.replace('T', ' ') }}</div>
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
    value: undefined
}
