ODA({is: 'oda-select-input',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            gap: 4px;
        }
        select {
            @apply --flex;
            min-width: 0;
            box-sizing: border-box;
            padding: 4px;
            font-size: 125%;
            border: none;
            border-radius: 4px;
        }
        input {
            min-width: 0;
            box-sizing: border-box;
            padding: 4px;
            font-size: 125%;
            border: none;
            border-radius: 4px;
        }
    </style>
    <select :value="value" :disabled @change="value = $this.value">
        <option ~for="options" :value="$for.item.value">{{$for.item.label}}</option>
    </select>
    <input ~if="other" type="text" :placeholder="otherLabel" :value="otherText" :disabled @input="value = $this.value">
    `,
    value: '',
    meta: null,
    get options() {
        return this.meta?.options || [];
    },
    get other() {
        return this.meta?.other;
    },
    get otherLabel() {
        return this.other?.label || 'Свой ответ';
    },
    get disabled() {
        return !!this.meta?.disabled;
    },
    get otherText() {
        const v = String(this.value ?? '');
        if (!v)
            return '';
        return (this.options || []).some(o => String(o.value) === v) ? '' : v;
    },
});
