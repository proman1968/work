import { parseFormSpec } from '/$server/$folder/$file//$task/task.js';

export default {}

ODA({
    is: 'item-editor-form',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            align-items: flex-start;
            flex-wrap: wrap;
            gap: 8px;
            padding: 16px;
            overflow-x: hidden;
            overflow-y: auto;
        }
    </style>
    <item-editor-form-field-container ~if="!spec" ~for="dataAccessNode?.children" :data-access-node="$for?.item"></item-editor-form-field-container>
    <item-editor-form-field-container ~if="spec" ~for="specNodes" :data-access-node="$for?.item"></item-editor-form-field-container>
    `,
    dataAccessNode: null,
    /** Мета-спека из content блока (parseFormSpec); legacy — dataAccessNode. */
    get spec() {
        if (this._specData !== this.data) {
            this._specData = this.data;
            try {
                this._specCache = parseFormSpec(this.data?.content);
            }
            catch {
                this._specCache = null;
            }
        }
        return this._specCache;
    },
    /** Значения — объект блока (общий с data.values → $pdp.result → APPROVE). */
    get values() {
        if (!this.data || typeof this.data !== 'object')
            return {};
        return this.data.values ??= {};
    },
    /** Снимок значений для $pdp.result/APPROVE. */
    get result() {
        return { ...(this.values || {}) };
    },
    /** Адаптеры полей спеки под дерево dataAccessNode: значения — общий объект values. */
    get specNodes() {
        const spec = this.spec;
        const values = this.values ?? {};
        if (!spec || !Array.isArray(spec.fields))
            return [];
        return spec.fields.map(f => ({
            id: f.id,
            label: f.label || f.id,
            field: { type: f.type || 'String', options: f.options || [], other: f.other || null, placeholder: f.placeholder || '', required: !!f.required },
            children: [],
            getValue: async () => values[f.id] ?? '',
            setValue: v => { values[f.id] = v; },
            peek: () => values[f.id] ?? '',
        }));
    },
});

ODA({
    is: 'item-editor-form-container',
    template: /*html*/`
    <style>
        :host([sizing="small"]) {
            flex: 1 0 4em;
        }
        :host([sizing="mid"]) {
            flex: 1 0 auto;
        }
        :host([sizing="full"]) {
            flex: 1 0 100%;
        }
        :host {
            @apply --horizontal;
        }
    </style>`,
    sizing: {
        $attr: true,
        $list: ['small', 'mid', 'full'],
        $def: 'mid'
    },
});

ODA({
    is: 'item-editor-form-field-container',
    extends: 'item-editor-form-container',
    template: /*html*/`
    <style>
        :host {
            fieldset {
                @apply --horizontal;
                flex: auto;
                font-size: inherit;
                border-radius: 8px;

                .editor-box {
                    @apply --vertical;
                    @apply --flex;

                    .children-box {
                        @apply --horizontal;
                        @apply --flex;
                        flex-wrap: wrap;
                        margin: 4px -8px -4px -16px;
                        gap: 8px;
                    }
                }
            }
        }
    </style>
    <fieldset>
        <legend>{{label}}</legend>
        <oda-icon ~if="children?.length" :icon="expanded ? 'icons:chevron-right:90' : 'icons:chevron-right'" fill="var(--light-color)" icon-size="32" @click="expanded = !expanded"></oda-icon>
        <div class="editor-box" border>
            <div ~is="editorTag" :data-access-node></div>
            <div ~if="children?.length && expanded" class="children-box">
                <item-editor-form-field-container ~for="children" :data-access-node="$for?.item"></item-editor-form-field-container>
            </div>
        </div>
    </fieldset>
    `,
    get editorTag() {
        switch (this.dataAccessNode.field.type) {
            case 'Number':
                return 'item-editor-form-number-field-editor';
            case 'Date':
                return 'item-editor-form-date-field-editor';
            case 'Boolean':
                return 'item-editor-form-boolean-field-editor';
            case 'Table':
            default: {
                return 'item-editor-form-string-field-editor'
            }
            case 'Text': {
                return 'item-editor-form-text-field-editor'
            }
            case 'Select': {
                return 'item-editor-form-select-field-editor'
            }
            case 'Radio': {
                return 'item-editor-form-radio-field-editor'
            }
        }
    },
    dataAccessNode: null,
    expanded: {
        $save: true,
        $def: false
    },
    get sizing() {
        switch (this.dataAccessNode?.field.type) {
            case 'Table':
            case 'Text':
            case 'Select':
            case 'Radio': {
                return 'full'
            }
            case 'Boolean': {
                return 'small';
            }
            case 'String':
            case 'Number':
            case 'DateTime':
            default: {
                return 'mid'
            }
        }

    },
    get $saveKey() {
        return this.dataAccessNode?.id;
    },
    get label() {
        return this.dataAccessNode?.label;
    },
    get children() {
        return this.dataAccessNode?.children;
    },
});
ODA({
    is: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            @apply --flex;
        }
    </style>
    `,
    dataAccessNode: null,
    async getValue() {
        return (await this.dataAccessNode.getValue()) || '';
    },
    async setValue(value) {
        this.dataAccessNode.setValue(value);
    }
});
ODA({
    is: 'item-editor-form-string-field-editor',
    extends: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
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
    <input type="text" size="12" :value="getValue()" @input="setValue($this.value)">
    `,
});
ODA({
    is: 'item-editor-form-text-field-editor',
    extends: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
        :host{
            @apply --vertical;
        }
        textarea {
            @apply --flex;
            border: none;
            box-sizing: border-box;
            resize: vertical;
            min-height: 2em;
            white-space: pre;
            height: {{editorHeight}}px;
        }
        {{''}}
    </style>
    <textarea rows="4" :value="getValue()" @input="setValue($this.value)" @resize="editorHeight = $this.offsetHeight"></textarea>
    `,
    editorHeight: {
        $save: true,
        $def: 60
    }
})
ODA({
    is: 'item-editor-form-number-field-editor',
    extends: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
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
    <input type="number" :value="getValue()" @input="setValue($this.value)">
    `,
});
ODA({
    is: 'item-editor-form-date-field-editor',
    extends: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
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
    <input type="date" :value="getValue()" @input="setValue($this.value)">
    `,
});
ODA({
    is: 'item-editor-form-boolean-field-editor',
    extends: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            align-items: center;
        }
        input { width: 20px; height: 20px; }
    </style>
    <input type="checkbox" :checked="isChecked" @change="setValue($this.checked)">
    `,
    get isChecked() {
        const v = this.dataAccessNode?.peek ? this.dataAccessNode.peek() : '';
        return v === true || v === 'true' || v === 'да';
    },
});
ODA({
    is: 'item-editor-form-select-field-editor',
    extends: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
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
    </style>
    <select :value="current" @change="setValue($this.value)">
        <option ~for="field?.options" :value="$for.item.value">{{$for.item.label}}</option>
    </select>
    <input ~if="other" type="text" size="12" :placeholder="otherLabel" :value="otherText" @input="setOther($this.value)">
    `,
    get field() { return this.dataAccessNode?.field; },
    get other() { return this.field?.other; },
    get otherLabel() { return this.other?.label || 'Свой ответ'; },
    get current() { return this.dataAccessNode?.peek ? this.dataAccessNode.peek() ?? '' : ''; },
    get otherText() {
        const v = String(this.current ?? '');
        if (!v)
            return '';
        return (this.field?.options || []).some(o => String(o.value) === v) ? '' : v;
    },
    async setValue(value) {
        this.dataAccessNode.setValue(value);
    },
    async setOther(value) {
        this.dataAccessNode.setValue(value);
    },
});
ODA({
    is: 'item-editor-form-radio-field-editor',
    extends: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
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
    <label class="card" ~for="field?.options">
        <input type="radio" :name="fieldId" :value="$for.item.value" :checked="isChecked($for.item.value)" @change="setValue($for.item.value)">
        <span><b>{{$for.item.label}}</b><span class="desc" ~if="$for.item.desc">{{$for.item.desc}}</span></span>
    </label>
    <label class="card" ~if="other">
        <input type="radio" :name="fieldId" value="custom" :checked="isOtherChecked" @change="setOther(otherText || '')">
        <span><b>{{other.label}}</b><input class="other-text" type="text" :placeholder="other.label" :value="otherText" @input="setOther($this.value)"></span>
    </label>
    `,
    get field() { return this.dataAccessNode?.field; },
    get fieldId() { return this.dataAccessNode?.id || 'choice'; },
    get other() { return this.field?.other; },
    get current() { return this.dataAccessNode?.peek ? this.dataAccessNode.peek() ?? '' : ''; },
    isChecked(value) {
        return String(this.current ?? '') === String(value);
    },
    get isOtherChecked() {
        if (!this.other)
            return false;
        const v = String(this.current ?? '');
        if (!v)
            return false;
        return !(this.field?.options || []).some(o => String(o.value) === v);
    },
    get otherText() {
        const v = String(this.current ?? '');
        if (!v)
            return '';
        return (this.field?.options || []).some(o => String(o.value) === v) ? '' : v;
    },
    async setValue(value) {
        this.dataAccessNode.setValue(value);
    },
    async setOther(value) {
        this.dataAccessNode.setValue(value);
    },
});