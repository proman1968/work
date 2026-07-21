ODA({
    is: 'work-editor-builder',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                gap: 8px;
                padding: 16px;
                min-width: 280px;
            }
            .row {
                @apply --vertical;
                gap: 4px;
            }
            .row[hidden] { display: none; }
            label {
                font-size: 0.85rem;
                opacity: 0.75;
            }
            input, textarea {
                padding: 10px 12px;
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.15);
                background: rgba(15,23,42,0.45);
                color: inherit;
                font-size: 1rem;
                box-sizing: border-box;
            }
            input[readonly], textarea[readonly] {
                opacity: 0.7;
            }
            textarea { width: 100%; }
            .err { color: #fca5a5; font-size: 0.85rem; }
        </style>
        <div class="row" ~for="visibleFields" :hidden="$for.item.hidden && !$for.item.computed">
            <label ~if="!$for.item.hidden">{{$for.item.label || $for.item.id}}</label>
            <input ~if="$for.item.type !== 'Text' && !$for.item.hidden"
                   :type="$for.item.type === 'Number' ? 'number' : 'text'"
                   :readonly="$for.item.readonly || $for.item.computed"
                   :placeholder="$for.item.placeholder"
                   :value="values?.[$for.item.id]"
                   @input="onInput($for.item.id, $event.target.value)">
            <textarea ~if="$for.item.type === 'Text' && !$for.item.hidden"
                      rows="4"
                      :readonly="$for.item.readonly"
                      :placeholder="$for.item.placeholder"
                      :value="values?.[$for.item.id]"
                      @input="onInput($for.item.id, $event.target.value)"></textarea>
            <div class="err" ~if="errors?.[$for.item.id]">{{errors[$for.item.id]}}</div>
        </div>
    `,
    descriptor: null,
    values: null,
    errors: null,
    get visibleFields() {
        return this.descriptor?.fields || [];
    },
    onInput(id, value) {
        if (!this.values) this.values = {};
        this.values[id] = value;
        this.fire('change', { id, value, values: { ...this.values } });
    },
    async getValues() {
        return { ...(this.values || this.descriptor?.values || {}) };
    },
    setValues(values = {}) {
        this.values = { ...(this.descriptor?.values || {}), ...values };
    },
    setErrors(errors = {}) {
        this.errors = errors;
    },
    attached() {
        this.setValues(this.descriptor?.values || {});
    },
    descriptorChanged() {
        this.setValues(this.descriptor?.values || {});
    },
});
