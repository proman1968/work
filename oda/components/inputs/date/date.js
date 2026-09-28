ODA({is: 'oda-date-input',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            @apply --flex;
        }
        input {
            @apply --flex;
            min-width: 0;
            display: block;
            box-sizing: border-box;
            padding: 4px;
            font-size: 125%;
            border: none;
            border-radius: 4px;
        }
    </style>
    <input type="date" :value @change="value = $this.value">
    `,
    value: '',
    meta: null,
    get disabled() {
        return !!this.meta?.disabled;
    },
});
