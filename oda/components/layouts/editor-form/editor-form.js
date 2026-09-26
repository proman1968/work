import '../../inputs/text/text.js';
import '../../inputs/textarea/textarea.js';
import '../../inputs/date/date.js';
import '../../inputs/datetime/datetime.js';
import '../../inputs/select/select.js';
import '../../inputs/radio/radio.js';
import '../../inputs/table/table.js';
import '../../inputs/numeric/numeric.js';
import '../../checkbox/checkbox.js';
import '../../icon/icon.js';

/** Типы полей (паритет FORM_SPEC_TYPES + Table как текстовый, DateTime с временем). */
export const EDITOR_FIELD_TYPES = ['String', 'Text', 'Number', 'Date', 'DateTime', 'Boolean', 'Select', 'Radio', 'Table'];

/** Тип поля -> тег редактора. Number/Boolean — существующие oda-компоненты. */
const EDITORS = {
    String: 'oda-text-input',
    Text: 'oda-textarea-input',
    Number: 'oda-numeric-input',
    Date: 'oda-date-input',
    DateTime: 'oda-datetime-input',
    Boolean: 'oda-checkbox',
    Select: 'oda-select-input',
    Radio: 'oda-radio-input',
    Table: 'oda-table-input',
};

export function editorForType(type) {
    return EDITORS[type] || EDITORS.String;
}

function cleanField(f, seen) {
    if (!f || typeof f !== 'object')
        return null;
    const id = String(f.id || '').trim();
    if (!id || seen.has(id))
        return null;
    seen.add(id);
    const type = EDITOR_FIELD_TYPES.includes(f.type) ? f.type : 'String';
    const field = {
        id,
        label: String(f.label || id).trim(),
        type,
        required: f.required === true,
        placeholder: String(f.placeholder || ''),
    };
    if (f.disabled === true)
        field.disabled = true;
    if (type === 'Select' || type === 'Radio') {
        const options = Array.isArray(f.options) ? f.options : [];
        field.options = options
            .filter(o => o && typeof o === 'object' && String(o.value ?? '').trim() !== '')
            .map(o => ({
                value: String(o.value).trim(),
                label: String(o.label || o.value).trim(),
                desc: String(o.desc || ''),
            }));
        if (!field.options.length)
            return null;
        if (f.other && typeof f.other === 'object') {
            field.other = {
                value: String(f.other.value ?? '').trim(),
                label: String(f.other.label || 'Свой ответ').trim(),
            };
        }
        else if (f.other === true) {
            field.other = { value: '', label: 'Свой ответ' };
        }
    }
    if (Array.isArray(f.children)) {
        const childSeen = new Set();
        field.children = f.children.map(c => cleanField(c, childSeen)).filter(Boolean);
    }
    if (type === 'Table' && Array.isArray(f.columns)) {
        const colSeen = new Set();
        field.columns = f.columns.map(c => {
            const clean = cleanField(c, colSeen);
            if (!clean)
                return null;
            if (typeof c?.calc === 'string' && c.calc.trim())
                clean.calc = c.calc.trim();
            if (c?.total === true)
                clean.total = true;
            if (c?.readonly === true)
                clean.readonly = true;
            return clean;
        }).filter(Boolean);
    }
    return field;
}

/**
 * Канонические поля из metadata. Входы:
 * - массив полей
 * - { title, fields: [...] } (parseFormSpec / normalizeFormSpec)
 * - { FIELDS: [...] } / объект с METADATA (встроенный стандарт: METADATA: { FIELDS })
 * - map { key: descriptor } (id = key)
 */
export function normalizeEditorFields(meta) {
    let title = '';
    let list = [];
    if (Array.isArray(meta)) {
        list = meta;
    }
    else if (meta && typeof meta === 'object') {
        title = String(meta.title || meta.label || '');
        if (Array.isArray(meta.fields))
            list = meta.fields;
        else if (Array.isArray(meta.FIELDS))
            list = meta.FIELDS;
        else if (meta.METADATA && typeof meta.METADATA === 'object') {
            const md = meta.METADATA;
            if (Array.isArray(md.FIELDS))
                list = md.FIELDS;
            else if (Array.isArray(md.fields))
                list = md.fields;
            else
                list = Object.entries(md).map(([id, d]) => Object.assign({ id }, d));
        }
        else {
            const entries = Object.entries(meta).filter(([k]) => !['title', 'label'].includes(k));
            if (entries.length && entries.every(([, d]) => d && typeof d === 'object' && 'type' in d))
                list = entries.map(([id, d]) => Object.assign({ id }, d));
        }
    }
    const seen = new Set();
    const fields = (Array.isArray(list) ? list : []).map(f => cleanField(f, seen)).filter(Boolean);
    return { title, fields };
}

function isEmpty(v) {
    return v === undefined || v === null || (typeof v === 'string' && !v.trim());
}

ODA({is: 'oda-editor-form',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            gap: 8px;
            padding: 16px;
            overflow-x: hidden;
            overflow-y: auto;
        }
        .form-title {
            font-size: 120%;
            font-weight: bold;
        }
    </style>
    <div class="form-title" ~if="title">{{title}}</div>
    <oda-editor-form-field ~for="fields" :field="$for.item" :data></oda-editor-form-field>
    `,
    metadata: null,
    data: {},
    get spec() {
        if (this._specSrc !== this.metadata) {
            this._specSrc = this.metadata;
            this._specCache = normalizeEditorFields(this.metadata);
        }
        return this._specCache;
    },
    get title() {
        return this.spec?.title || '';
    },
    get fields() {
        return this.spec?.fields || [];
    },
    /** Снимок значений (не сама data — безопасно отдавать наружу). */
    get result() {
        return Object.assign({}, this.data || {});
    },
    /** Ошибки required: { fieldId: message }. Пусто — валидно. */
    get errors() {
        const errors = {};
        for (const f of this.fields) {
            if (f.required && isEmpty(this.data?.[f.id]))
                errors[f.id] = 'Обязательное поле: ' + (f.label || f.id);
        }
        return errors;
    },
    get isValid() {
        return !Object.keys(this.errors).length;
    },
    validate() {
        return this.isValid;
    },
});

ODA({is: 'oda-editor-form-field',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
        }
        fieldset {
            @apply --horizontal;
            flex: auto;
            font-size: inherit;
            border-radius: 8px;
        }
        fieldset.invalid {
            border-color: red;
        }
        .editor-box {
            @apply --vertical;
            @apply --flex;
        }
        .children-box {
            @apply --horizontal;
            @apply --flex;
            flex-wrap: wrap;
            margin: 4px -8px -4px -16px;
            gap: 8px;
        }
        .req {
            color: red;
        }
    </style>
    <fieldset ~class="{ invalid: hasError }">
        <legend>{{label}}<span class="req" ~if="required"> *</span></legend>
        <oda-icon ~if="children?.length" :icon="expanded ? 'icons:chevron-right:90' : 'icons:chevron-right'" fill="var(--light-color)" icon-size="32" @click="expanded = !expanded"></oda-icon>
        <div class="editor-box">
            <div ~is="editor" ::value="data[field.id]" :meta="field" :disabled="field.disabled"></div>
            <div ~if="children?.length && expanded" class="children-box">
                <oda-editor-form-field ~for="children" :field="$for.item" :data></oda-editor-form-field>
            </div>
        </div>
    </fieldset>
    `,
    field: null,
    data: null,
    expanded: true,
    get editor() {
        return editorForType(this.field?.type);
    },
    get label() {
        return this.field?.label || this.field?.id || '';
    },
    get required() {
        return this.field?.required === true;
    },
    get children() {
        return this.field?.children || [];
    },
    get hasError() {
        return this.required && isEmpty(this.data?.[this.field?.id]);
    },
});
