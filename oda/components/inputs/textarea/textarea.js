ODA({is: 'oda-textarea-input',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
        }
        textarea {
            @apply --flex;
            border: none;
            box-sizing: border-box;
            resize: vertical;
            min-height: 2em;
            white-space: pre;
            font-size: 125%;
            padding: 4px;
            border-radius: 4px;
        }
    </style>
    <textarea rows="4" :value :placeholder :disabled @input="value = $this.value"></textarea>
    `,
    value: '',
    meta: null,
    get placeholder() {
        return this.meta?.placeholder || '';
    },
    get disabled() {
        return !!this.meta?.disabled;
    },
});
