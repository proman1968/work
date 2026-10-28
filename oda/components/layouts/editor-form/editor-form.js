import '/oda/components/structure/controls.js';
import '/oda/components/icon/icon.js';
import { CONTROLS, controlOf } from '/oda/components/structure/controls-map.js';

/** Типы полей (паритет FORM_SPEC_TYPES + Table как текстовый, DateTime с временем, File). */
export const EDITOR_FIELD_TYPES = ['String', 'Text', 'Number', 'Date', 'DateTime', 'Boolean', 'Select', 'Radio', 'Table', 'Link', 'Struct', 'File'];

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
    if (typeof f.catalog === 'string' && f.catalog.trim())
        field.catalog = f.catalog.trim();
    if (f.analytic === true)
        field.analytic = true;
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
    const rawChildren = Array.isArray(f.children) ? f.children : (type === 'Struct' && Array.isArray(f.fields) ? f.fields : null);
    if (rawChildren) {
        const childSeen = new Set();
        field.children = rawChildren.map(c => cleanField(c, childSeen)).filter(Boolean);
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
 * - { FIELDS: [...] } / { STATIC: [...] } / объект с METADATA
 *   (встроенный стандарт: METADATA: { STATIC — свойства класса, FIELDS — поля объектов }).
 * kind: 'auto' (STATIC при наличии, иначе FIELDS) | 'static' | 'fields'.
 */
export function normalizeEditorFields(meta, kind = 'auto') {
    let title = '';
    let list = [];
    if (Array.isArray(meta)) {
        list = meta;
    }
    else if (meta && typeof meta === 'object') {
        title = String(meta.title || meta.label || '');
        if (Array.isArray(meta.fields))
            list = meta.fields;
        else if (Array.isArray(meta.STATIC) && (kind !== 'fields') && (kind === 'static' || meta.STATIC.length || !Array.isArray(meta.FIELDS)))
            list = meta.STATIC;
        else if (Array.isArray(meta.FIELDS))
            list = meta.FIELDS;
        else if (meta.METADATA && typeof meta.METADATA === 'object') {
            const md = meta.METADATA;
            if (kind === 'static')
                list = Array.isArray(md.STATIC) ? md.STATIC : (Array.isArray(md.FIELDS) ? md.FIELDS : []);
            else if (kind === 'fields')
                list = Array.isArray(md.FIELDS) ? md.FIELDS : [];
            else if (Array.isArray(md.STATIC) && md.STATIC.length)
                list = md.STATIC;
            else if (Array.isArray(md.FIELDS))
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
            gap: 6px;
            padding: 10px 12px;
            overflow-x: hidden;
            overflow-y: auto;
        }
        .form-title {
            font-size: 14px;
            font-weight: 700;
            padding-bottom: 2px;
        }
    </style>
    <div class="form-title" ~if="title">{{title}}</div>
    <oda-editor-form-field ~for="fields" :field="$for.item" :data :field-errors="fieldErrors"></oda-editor-form-field>
    `,
    metadata: null,
    data: {},
    fieldErrors: null,
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
            font-size: 13px;
            border: 1px solid light-dark(#c8c8c0, #3a3b42);
            border-radius: 4px;
            padding: 2px 8px 4px;
            margin: 0;
        }
        legend {
            font-size: 11.5px;
            font-weight: 600;
            color: light-dark(#4b5563, #9ca3af);
            padding: 0 4px;
        }
        fieldset.invalid {
            border-color: red;
        }
        .editor-box {
            @apply --vertical;
            @apply --flex;
            min-width: 0;
        }
        .children-box {
            @apply --horizontal;
            @apply --flex;
            flex-wrap: wrap;
            margin: 4px -4px -2px -8px;
            gap: 6px;
        }
        .req {
            color: red;
        }
        .field-error {
            color: var(--error-color, red);
            font-size: smaller;
            padding: 2px 4px 0;
        }
    </style>
    <fieldset ~class="{ invalid: hasError }">
        <legend>{{label}}<span class="req" ~if="required"> *</span></legend>
        <oda-icon ~if="children?.length" :icon="expanded ? 'icons:chevron-right:90' : 'icons:chevron-right'" fill="var(--light-color)" icon-size="24" @click="expanded = !expanded"></oda-icon>
        <div class="editor-box">
            <div ~if="field?.type !== 'Struct'" ~is="editor" ::value="data[field.id]" :field :meta="field" :at="data?.time || ''" :allow-other="!!field.other" :borderless="field?.type !== 'Table'" :dense="field?.type !== 'Table'" no-header :disabled="!!field.disabled"></div>
            <div ~if="children?.length && expanded" class="children-box">
                <oda-editor-form-field ~for="children" :field="$for.item" :data="subData" :field-errors="fieldErrors" :path-prefix="fullPath"></oda-editor-form-field>
            </div>
            <div class="field-error" ~if="serverError">{{serverError}}</div>
        </div>
    </fieldset>
    `,
    field: null,
    data: null,
    fieldErrors: null,
    pathPrefix: '',
    expanded: true,
    get fullPath() {
        const id = this.field?.id || '';
        return this.pathPrefix && id ? `${this.pathPrefix}.${id}` : id;
    },
    get serverError() {
        const map = this.fieldErrors;
        if (!map || typeof map !== 'object')
            return '';
        const fp = this.fullPath;
        const id = this.field?.id || '';
        if (fp && map[fp])
            return String(map[fp]);
        if (id && map[id])
            return String(map[id]);
        if (fp) {
            const bracket = fp + '[';
            const sub = [];
            for (const [k, v] of Object.entries(map)) {
                if (k.startsWith(bracket) && v)
                    sub.push(`${k.slice(fp.length)}: ${v}`);
            }
            if (sub.length)
                return sub.join('; ');
        }
        return '';
    },
    get subData() {
        if (!this.data || typeof this.data !== 'object')
            return {};
        if (this.field?.type === 'Struct' && this.field.id) {
            if (!this.data[this.field.id] || typeof this.data[this.field.id] !== 'object' || Array.isArray(this.data[this.field.id]))
                this.data[this.field.id] = {};
            return this.data[this.field.id];
        }
        return this.data;
    },
    get editor() {
        return controlOf(CONTROLS, this.field);
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
        return !!this.serverError || (this.required && isEmpty(this.data?.[this.field?.id]));
    },
});
