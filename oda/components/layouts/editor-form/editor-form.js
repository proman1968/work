import '/oda/components/structure/controls.js';
import '/oda/components/icon/icon.js';
import { CONTROLS, controlOf } from '/oda/components/structure/controls-map.js';

/** Типы полей (паритет FORM_SPEC_TYPES + Table как текстовый, DateTime с временем, File). */
export const EDITOR_FIELD_TYPES = ['String', 'Text', 'Number', 'Date', 'DateTime', 'Boolean', 'Select', 'Radio', 'Table', 'Link', 'Struct', 'File'];

const COMPACT_FIELD_RE = /^(time|date|doc_date|valid_from|until|num|number|doc_num|sum|amount|total|price|qty|count|nds|nds_rate|nds_sum|vat|inn|kpp|ogrn|okpo|bik|priority|order|turn|status|phone|tel|email|code|personnel_number|salary)$/i;
const FULL_WIDTH_FIELD_RE = /^(comment|descript|description|base|reason|purpose|content|note|notes|address|legal_address|fact_address|details|requisites|rekvizity)$/i;

/** Умная дефолтная ширина поля в 12-колоночной сетке (как в классическом ODANT). */
export function defaultFieldSpan(field) {
    if (!field || typeof field !== 'object')
        return 12;
    const explicit = Number(field.span || field.colSpan);
    if (explicit >= 1 && explicit <= 12)
        return Math.round(explicit);
    if (field.kind === 'divider' || field.kind === 'header')
        return 12;
    if (field.kind === 'spacer')
        return 4;
    const type = String(field.type || 'String');
    const id = String(field.id || '').trim();
    if (type === 'Table' || type === 'Text' || type === 'Struct')
        return 12;
    if (FULL_WIDTH_FIELD_RE.test(id))
        return 12;
    if (type === 'Date' || type === 'DateTime' || type === 'Number' || type === 'Boolean' || COMPACT_FIELD_RE.test(id))
        return 4;
    return 6;
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
    if (f.span || f.colSpan)
        field.span = defaultFieldSpan(f);
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

const LAYOUT_STORAGE_PREFIX = 'work.form.layout:';

function readSavedLayout(key) {
    if (!key || typeof localStorage === 'undefined')
        return null;
    try {
        const raw = localStorage.getItem(LAYOUT_STORAGE_PREFIX + key);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        return parsed && Array.isArray(parsed.items) ? parsed : null;
    }
    catch {
        return null;
    }
}

function writeSavedLayout(key, spec) {
    if (!key || typeof localStorage === 'undefined')
        return;
    try {
        if (!spec || !Array.isArray(spec.items))
            localStorage.removeItem(LAYOUT_STORAGE_PREFIX + key);
        else
            localStorage.setItem(LAYOUT_STORAGE_PREFIX + key, JSON.stringify(spec));
    }
    catch { /* ignore */ }
}

ODA({is: 'oda-editor-form',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            gap: 8px;
            padding: 8px 14px;
            overflow-x: hidden;
            overflow-y: auto;
            box-sizing: border-box;
        }
        .form-title {
            font-size: 14px;
            font-weight: 700;
            padding-bottom: 2px;
        }
        .designer-panel {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 8px 12px;
            background: var(--subtle-background);
            border: 1px dashed var(--accent-color);
            border-radius: var(--radius-s, 6px);
            font-size: 12px;
        }
        .designer-top {
            display: flex;
            flex-direction: row;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
        }
        .designer-title {
            font-weight: 700;
            color: var(--accent-color);
            margin-right: 6px;
        }
        .designer-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 9px;
            font-size: 12px;
            font-weight: 600;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xs, 4px);
            background: var(--content-background);
            color: var(--content-color);
            cursor: pointer;
        }
        .designer-btn:hover {
            border-color: var(--accent-color);
            background: var(--accent-soft);
            color: var(--accent-color);
        }
        .hidden-fields-box {
            display: flex;
            flex-direction: row;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            padding-top: 4px;
            border-top: 1px solid var(--border-color);
        }
        .hidden-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border: 1px solid var(--border-color);
            border-radius: 12px;
            background: var(--content-background);
            color: var(--content-color);
            cursor: pointer;
            font-size: 11.5px;
        }
        .hidden-chip:hover {
            border-color: var(--accent-color);
            color: var(--accent-color);
        }
        .fields-grid {
            display: grid;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            gap: 8px 10px;
            align-items: start;
        }
        .grid-item {
            min-width: 0;
            position: relative;
            box-sizing: border-box;
        }
        .grid-item.designing {
            outline: 1px dashed var(--accent-color);
            border-radius: var(--radius-xs, 4px);
            background: var(--accent-soft);
            cursor: grab;
        }
        .grid-item.drag-over {
            outline: 2px solid var(--accent-color);
        }
        .design-item-bar {
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: flex-end;
            gap: 3px;
            padding: 2px 4px 0;
            font-size: 11px;
            user-select: none;
        }
        .design-mini-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 18px;
            height: 17px;
            padding: 0 3px;
            font-size: 11px;
            font-weight: 700;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xs, 3px);
            background: var(--content-background);
            color: var(--content-color);
            cursor: pointer;
        }
        .design-mini-btn:hover {
            border-color: var(--accent-color);
            color: var(--accent-color);
        }
        .design-span-badge {
            font-size: 10.5px;
            color: var(--muted-color);
            padding: 0 3px;
        }
        .spacer-box {
            min-height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--muted-color);
            font-size: 11.5px;
            font-style: italic;
        }
        .header-box {
            font-size: 13.5px;
            font-weight: 700;
            color: var(--content-color);
            padding: 6px 2px 2px;
            border-bottom: 1px solid var(--border-color);
        }
        .divider-box {
            height: 1px;
            margin: 8px 0;
            background: light-dark(#cbd5e1, #3e4251);
        }
    </style>
    <div class="form-title" ~if="title && !hideTitle">{{title}}</div>
    <div class="designer-panel" ~if="designMode">
        <div class="designer-top">
            <span class="designer-title">Настройка расположения полей:</span>
            <button type="button" class="designer-btn" @tap="addSpacer()">+ "Пустой" элемент</button>
            <button type="button" class="designer-btn" @tap="addHeader()">+ Метка</button>
            <button type="button" class="designer-btn" @tap="addDivider()">+ Разделитель</button>
            <div style="flex:1;"></div>
            <button type="button" class="designer-btn" @tap="resetLayout()">По умолчанию</button>
            <button type="button" class="designer-btn" @tap="designMode = false">Готово</button>
        </div>
        <div class="hidden-fields-box" ~if="hiddenFields.length">
            <span style="font-weight:600;">Скрытые элементы (клик — вернуть на форму):</span>
            <span class="hidden-chip" ~for="hiddenFields" @tap="restoreField($for.item.id)">+ {{$for.item.label}}</span>
        </div>
    </div>
    <div class="fields-grid">
        <div class="grid-item" ~for="visibleLayoutItems"
            ~class="{designing: designMode, 'drag-over': dragOverId === $for.item.id}"
            ~style="{gridColumn: 'span ' + ($for.item.span || 12)}"
            :draggable="designMode ? 'true' : 'false'"
            @dragstart="onDragStart($for.item, $event)"
            @dragover="onDragOver($for.item, $event)"
            @dragleave="onDragLeave($for.item)"
            @drop="onDrop($for.item, $event)">
            <div class="design-item-bar" ~if="designMode">
                <span style="margin-right:auto; font-weight:600; opacity:0.75; padding-left:2px;">{{$for.item.kind === 'spacer' ? 'Пустой элемент' : $for.item.kind === 'divider' ? 'Разделитель' : ($for.item.label || $for.item.id)}}</span>
                <button type="button" class="design-mini-btn" title="Переименовать подпись" ~if="$for.item.kind !== 'spacer' && $for.item.kind !== 'divider'" @tap.stop="renameItem($for.item)">✎</button>
                <button type="button" class="design-mini-btn" title="Уже (−1 колонка)" @tap.stop="changeSpan($for.item, -1)">−</button>
                <span class="design-span-badge" title="Ширина в 12-колоночной сетке">{{$for.item.span}}/12</span>
                <button type="button" class="design-mini-btn" title="Шире (+1 колонка)" @tap.stop="changeSpan($for.item, 1)">+</button>
                <button type="button" class="design-mini-btn" title="Скрыть элемент" ~if="!$for.item.field?.required" @tap.stop="hideItem($for.item)">✕</button>
            </div>
            <div class="spacer-box" ~if="$for.item.kind === 'spacer'">
                <span ~if="designMode">[ "пустой" элемент ]</span>
            </div>
            <div class="header-box" ~if="$for.item.kind === 'header'">{{$for.item.label}}</div>
            <div class="divider-box" ~if="$for.item.kind === 'divider'"></div>
            <oda-editor-form-field ~if="$for.item.kind === 'field'" :field="$for.item.field" :data :field-errors="fieldErrors"></oda-editor-form-field>
        </div>
    </div>
    `,
    metadata: null,
    data: {},
    fieldErrors: null,
    hideTitle: {
        $def: false,
        $type: Boolean,
        $attr: true,
    },
    designMode: {
        $def: false,
        $type: Boolean,
        $attr: true,
    },
    layoutKey: '',
    layoutVersion: 0,
    dragSourceId: '',
    dragOverId: '',
    _customSeq: 0,
    get effectiveLayoutKey() {
        return this.layoutKey || this.metadata?.path || this.metadata?.cid || this.metadata?.title || '';
    },
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
    get layoutItems() {
        void this.layoutVersion;
        const baseFields = this.fields || [];
        const byId = new Map(baseFields.map(f => [f.id, f]));
        const saved = readSavedLayout(this.effectiveLayoutKey);
        const out = [];
        const usedIds = new Set();

        if (saved && Array.isArray(saved.items)) {
            for (const item of saved.items) {
                if (!item || !item.id)
                    continue;
                const span = Math.max(2, Math.min(12, Number(item.span) || 6));
                if (item.kind === 'spacer' || item.kind === 'header' || item.kind === 'divider') {
                    out.push({
                        id: item.id,
                        kind: item.kind,
                        label: item.label || (item.kind === 'header' ? 'Раздел' : ''),
                        span: item.kind === 'divider' ? 12 : span,
                        hidden: false,
                    });
                    continue;
                }
                const f = byId.get(item.id);
                if (!f)
                    continue;
                usedIds.add(f.id);
                const effectiveField = item.label && item.label !== f.label ? { ...f, label: item.label } : f;
                out.push({
                    id: f.id,
                    kind: 'field',
                    label: effectiveField.label,
                    span: Number(item.span) >= 2 && Number(item.span) <= 12 ? Number(item.span) : defaultFieldSpan(f),
                    hidden: !f.required && Boolean(item.hidden),
                    field: effectiveField,
                });
            }
        }

        for (const f of baseFields) {
            if (usedIds.has(f.id))
                continue;
            out.push({
                id: f.id,
                kind: 'field',
                label: f.label,
                span: defaultFieldSpan(f),
                hidden: false,
                field: f,
            });
        }
        return out;
    },
    get visibleLayoutItems() {
        return (this.layoutItems || []).filter(i => !i.hidden);
    },
    get hiddenFields() {
        return (this.layoutItems || []).filter(i => i.hidden && i.kind === 'field');
    },
    _persistLayout(items) {
        const clean = (items || []).map(i => ({
            id: i.id,
            kind: i.kind || 'field',
            label: i.label || '',
            span: i.span || 6,
            hidden: Boolean(i.hidden),
        }));
        writeSavedLayout(this.effectiveLayoutKey, { items: clean });
        this.layoutVersion++;
    },
    changeSpan(item, delta) {
        if (!item)
            return;
        const list = this.layoutItems.map(x => ({ ...x }));
        const target = list.find(x => x.id === item.id);
        if (!target)
            return;
        target.span = Math.max(2, Math.min(12, (Number(target.span) || 6) + delta));
        this._persistLayout(list);
    },
    hideItem(item) {
        if (!item)
            return;
        let list = this.layoutItems.map(x => ({ ...x }));
        if (item.kind !== 'field') {
            list = list.filter(x => x.id !== item.id);
        }
        else {
            const target = list.find(x => x.id === item.id);
            if (!target || target.field?.required)
                return;
            target.hidden = true;
        }
        this._persistLayout(list);
    },
    restoreField(id) {
        const list = this.layoutItems.map(x => ({ ...x }));
        const target = list.find(x => x.id === id);
        if (!target)
            return;
        target.hidden = false;
        this._persistLayout(list);
    },
    renameItem(item) {
        if (!item || typeof prompt !== 'function')
            return;
        const next = prompt('Подпись элемента:', item.label || '');
        if (next === null)
            return;
        const trimmed = String(next).trim();
        if (!trimmed)
            return;
        const list = this.layoutItems.map(x => ({ ...x }));
        const target = list.find(x => x.id === item.id);
        if (!target)
            return;
        target.label = trimmed;
        this._persistLayout(list);
    },
    addSpacer() {
        const list = this.layoutItems.map(x => ({ ...x }));
        list.push({ id: `_spacer_${Date.now()}_${++this._customSeq}`, kind: 'spacer', label: '', span: 4, hidden: false });
        this._persistLayout(list);
    },
    addHeader() {
        const lbl = typeof prompt === 'function' ? prompt('Текст заголовка / метки:', 'Реквизиты') : 'Реквизиты';
        if (!lbl)
            return;
        const list = this.layoutItems.map(x => ({ ...x }));
        list.push({ id: `_header_${Date.now()}_${++this._customSeq}`, kind: 'header', label: String(lbl).trim(), span: 12, hidden: false });
        this._persistLayout(list);
    },
    addDivider() {
        const list = this.layoutItems.map(x => ({ ...x }));
        list.push({ id: `_divider_${Date.now()}_${++this._customSeq}`, kind: 'divider', label: '', span: 12, hidden: false });
        this._persistLayout(list);
    },
    resetLayout() {
        writeSavedLayout(this.effectiveLayoutKey, null);
        this.layoutVersion++;
    },
    onDragStart(item, e) {
        if (!this.designMode || !item)
            return;
        this.dragSourceId = item.id;
        try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.id);
        }
        catch { /* ignore */ }
    },
    onDragOver(item, e) {
        if (!this.designMode || !this.dragSourceId || !item || item.id === this.dragSourceId)
            return;
        e.preventDefault();
        this.dragOverId = item.id;
    },
    onDragLeave(item) {
        if (this.dragOverId === item?.id)
            this.dragOverId = '';
    },
    onDrop(targetItem, e) {
        e?.preventDefault?.();
        const srcId = this.dragSourceId;
        this.dragSourceId = '';
        this.dragOverId = '';
        if (!this.designMode || !srcId || !targetItem || srcId === targetItem.id)
            return;
        const list = this.layoutItems.map(x => ({ ...x }));
        const fromIdx = list.findIndex(x => x.id === srcId);
        const toIdx = list.findIndex(x => x.id === targetItem.id);
        if (fromIdx < 0 || toIdx < 0)
            return;
        const [moved] = list.splice(fromIdx, 1);
        list.splice(toIdx, 0, moved);
        this._persistLayout(list);
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
            width: 100%;
        }
        fieldset {
            @apply --horizontal;
            flex: auto;
            width: 100%;
            min-width: 0;
            font-size: 13px;
            border: 1px solid light-dark(#c8c8c0, #3a3b42);
            border-radius: 4px;
            padding: 2px 8px 4px;
            margin: 0;
            box-sizing: border-box;
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
