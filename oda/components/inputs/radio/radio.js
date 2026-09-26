ODA({is: 'oda-radio-input',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            gap: 8px;
        }
        label.card {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 10px 12px;
            cursor: pointer;
        }
        label.card:has(> input[type="radio"]:checked) {
            border-width: 2px;
            padding: 9px 11px;
        }
        label.card input { flex-shrink: 0; margin-top: 2px; }
        label.card input:disabled ~ span { opacity: .5; }
        label.card .desc {
            display: block;
            font-size: small;
            opacity: 0.7;
        }
        input.other-text {
            @apply --flex;
            min-width: 0;
            box-sizing: border-box;
            padding: 6px 8px;
            font: inherit;
            border: 1px solid var(--border-color);
            border-radius: 4px;
        }
    </style>
    <label class="card" ~for="options">
        <input type="radio" :name="groupName" :value="$for.item.value" :disabled :checked="isChecked($for.item.value)" @change="value = $for.item.value">
        <span><b>{{$for.item.label}}</b><span class="desc" ~if="$for.item.desc">{{$for.item.desc}}</span></span>
    </label>
    <label class="card" ~if="other">
        <input type="radio" :name="groupName" value="custom" :disabled :checked="isOtherChecked" @change="value = otherText || ''">
        <span><b>{{otherLabel}}</b><input class="other-text" type="text" :placeholder="otherLabel" :disabled :value="otherText" @input="value = $this.value"></span>
    </label>
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
    get groupName() {
        return 'rg-' + this.__id__;
    },
    isChecked(value) {
        return String(this.value ?? '') === String(value ?? '');
    },
    get isOtherChecked() {
        if (!this.other)
            return false;
        const v = String(this.value ?? '');
        if (!v)
            return false;
        return !(this.options || []).some(o => String(o.value) === v);
    },
    get otherText() {
        const v = String(this.value ?? '');
        if (!v)
            return '';
        return (this.options || []).some(o => String(o.value) === v) ? '' : v;
    },
});
