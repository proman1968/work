ODA({is: 'oda-text-input',
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
            text-overflow: ellipsis;
        }
    </style>
    <input :type="inputType" :value :placeholder :disabled @input="value = $this.value">
    `,
    value: '',
    meta: null,
    /** Тип нативного input (text/email/tel/url/password). Неизвестное — text. */
    get inputType() {
        const t = String(this.meta?.inputType || 'text').trim().toLowerCase();
        return ['text', 'email', 'tel', 'url', 'password', 'search'].includes(t) ? t : 'text';
    },
    get placeholder() {
        return this.meta?.placeholder || '';
    },
    get disabled() {
        return !!this.meta?.disabled;
    },
});
