import '/oda/components/structure/controls.js';
import '/oda/components/icon/icon.js';
import { CONTROLS, controlOf } from '/oda/components/structure/controls-map.js';

/** Типы полей (паритет FORM_SPEC_TYPES + Table как текстовый, DateTime с временем, File). */
export const EDITOR_FIELD_TYPES = ['String', 'Text', 'Number', 'Date', 'DateTime', 'Boolean', 'Select', 'Radio', 'Table', 'Link', 'Struct', 'File'];

const COMPACT_FIELD_RE = /^(time|date|doc_date|valid_from|until|num|number|doc_num|doc_number|order_number|in_num|doc_n|num_d|invoice_n|sum|amount|total|price|qty|count|nds|nds_rate|nds_sum|vat|vat_sum|inn|kpp|ogrn|okpo|bik|priority|order|turn|status|phone|tel|email|code|personnel_number|salary)$/i;
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

/** Минимальные ограничения и эластичность поля по его типу (механика автоподстройки как в oda-layout-designer). */
export function fieldSizingStyle(item) {
    if (!item || typeof item !== 'object')
        return { minWidth: '100%', flex: '1 1 100%', maxWidth: '100%' };
    if (item.kind === 'divider' || item.kind === 'header')
        return { minWidth: '100%', flex: '1 1 100%', maxWidth: '100%' };
    if (item.kind === 'spacer')
        return { minWidth: '180px', flex: '1 1 200px', maxWidth: '100%' };

    const f = item.field || item;
    const type = String(f.type || 'String');
    const id = String(f.id || '').trim();
    const explicitSpan = Number(item.span);

    if (type === 'Table' || type === 'Struct' || type === 'Text' || Boolean(f.children?.length) || FULL_WIDTH_FIELD_RE.test(id) || explicitSpan === 12) {
        return { minWidth: '100%', flex: '1 1 100%', maxWidth: '100%' };
    }
    if (type === 'Boolean') {
        return { minWidth: '165px', flex: '0 1 auto', maxWidth: '280px' };
    }
    if (type === 'Date' || type === 'DateTime') {
        return { minWidth: '220px', flex: '1 1 230px', maxWidth: '100%' };
    }
    if (type === 'Number' || COMPACT_FIELD_RE.test(id) || (explicitSpan >= 2 && explicitSpan <= 4)) {
        return { minWidth: '190px', flex: '1 1 205px', maxWidth: '100%' };
    }
    // Стандартные строковые и ссылочные поля (String, Link, Select, Radio, File)
    return { minWidth: '300px', flex: '2 1 320px', maxWidth: '100%' };
}

const LAYOUT_STORAGE_PREFIX = 'work.form.layout.v2:';

function readSavedLayout(key, layer = 'ROOT') {
    if (!key || typeof localStorage === 'undefined')
        return null;
    try {
        const raw = localStorage.getItem(LAYOUT_STORAGE_PREFIX + key);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        if (parsed.layers && typeof parsed.layers === 'object') {
            const l = parsed.layers[layer];
            return l && Array.isArray(l.items) ? l : null;
        }
        if (layer === 'ROOT' && Array.isArray(parsed.items))
            return parsed;
        return null;
    }
    catch {
        return null;
    }
}

function writeSavedLayout(key, spec, layer = 'ROOT') {
    if (!key || typeof localStorage === 'undefined')
        return;
    try {
        if (spec === null) {
            localStorage.removeItem(LAYOUT_STORAGE_PREFIX + key);
            return;
        }
        let full = { layers: {} };
        const raw = localStorage.getItem(LAYOUT_STORAGE_PREFIX + key);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed?.layers && typeof parsed.layers === 'object')
                    full = parsed;
            }
            catch { /* ignore */ }
        }
        if (!spec || !Array.isArray(spec.items))
            delete full.layers[layer];
        else
            full.layers[layer] = spec;
        localStorage.setItem(LAYOUT_STORAGE_PREFIX + key, JSON.stringify(full));
    }
    catch { /* ignore */ }
}

function buildLayerLayoutItems(baseFields, layoutKey, layer = 'ROOT') {
    const byId = new Map((baseFields || []).map(f => [f.id, f]));
    const saved = readSavedLayout(layoutKey, layer);
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
                    layer,
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
                layer,
                kind: 'field',
                label: effectiveField.label,
                span: Number(item.span) >= 2 && Number(item.span) <= 12 ? Number(item.span) : defaultFieldSpan(f),
                hidden: !f.required && Boolean(item.hidden),
                field: effectiveField,
            });
        }
    }

    for (const f of (baseFields || [])) {
        if (usedIds.has(f.id))
            continue;
        out.push({
            id: f.id,
            layer,
            kind: 'field',
            label: f.label,
            span: defaultFieldSpan(f),
            hidden: false,
            field: f,
        });
    }
    return out;
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
            @apply --horizontal;
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 8px 14px;
            align-items: center;
            width: 100%;
            box-sizing: border-box;
        }
        .grid-item {
            min-width: 0;
            position: relative;
            box-sizing: border-box;
            --item-label-width: auto;
        }
        .grid-item:first-child,
        .grid-item[data-row-start] {
            --item-label-width: var(--form-label-width, 155px);
        }
        .grid-item:first-child[compact-item],
        .grid-item[data-row-start][compact-item] {
            min-width: calc(var(--form-label-width, 155px) + 145px) !important;
        }
        .grid-item.designing {
            outline: 1px dashed var(--accent-color);
            border-radius: var(--radius-xs, 4px);
            background: var(--accent-soft);
            cursor: grab;
            padding: 2px 4px 4px;
        }
        .grid-item.drag-over {
            outline: 2px solid var(--accent-color);
        }
        .grid-item[allow] {
            background-color: rgba(34, 197, 94, 0.12);
        }
        .grid-item[denied] {
            background-color: rgba(239, 68, 68, 0.14);
            cursor: not-allowed;
        }
        .grid-item[drop-to="left"]::before,
        .grid-item[drop-to="top"]::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            bottom: 0;
            width: 3px;
            z-index: 2;
            background-color: var(--success-color, #16a34a);
        }
        .grid-item[drop-to="right"]::after,
        .grid-item[drop-to="bottom"]::after {
            content: "";
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: 3px;
            z-index: 2;
            background-color: var(--success-color, #16a34a);
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
    <div class="fields-grid" horizontal ~style="{ '--form-label-width': labelColumnWidth }">
        <div class="grid-item" ~for="visibleLayoutItems"
            ~class="{designing: designMode, 'drag-over': dragOverId === $for.item.id && dragSourceLayer === 'ROOT'}"
            :compact-item="isCompactLayoutItem($for.item)"
            :allow="isItemAllowed($for.item, 'ROOT')"
            :denied="isItemDenied($for.item, 'ROOT')"
            :drop-to="dropToDirection($for.item, 'ROOT')"
            ~style="itemStyle($for.item)"
            :draggable="Boolean(designMode)"
            @dragstart="onDragStart($for.item, $event, 'ROOT')"
            @dragend="onDragEnd()"
            @dragover="onDragOver($for.item, $event, 'ROOT')"
            @dragleave="onDragLeave($for.item)"
            @drop="onDrop($for.item, $event, 'ROOT')">
            <div class="design-item-bar" ~if="designMode">
                <span style="margin-right:auto; font-weight:600; opacity:0.75; padding-left:2px;">{{$for.item.kind === 'spacer' ? 'Пустой элемент' : $for.item.kind === 'divider' ? 'Разделитель' : ($for.item.label || $for.item.id)}}</span>
                <button type="button" class="design-mini-btn" title="Переименовать подпись" ~if="$for.item.kind !== 'spacer' && $for.item.kind !== 'divider'" @tap.stop="renameItem($for.item)">✎</button>
                <button type="button" class="design-mini-btn" title="Уже" @tap.stop="changeSpan($for.item, -2)">−</button>
                <button type="button" class="design-mini-btn" title="На всю строку / компактно" @tap.stop="changeSpan($for.item, 2)">+</button>
                <button type="button" class="design-mini-btn" title="Скрыть элемент" ~if="!$for.item.field?.required" @tap.stop="hideItem($for.item)">✕</button>
            </div>
            <div class="spacer-box" ~if="$for.item.kind === 'spacer'">
                <span ~if="designMode">[ "пустой" элемент ]</span>
            </div>
            <div class="header-box" ~if="$for.item.kind === 'header'">{{$for.item.label}}</div>
            <div class="divider-box" ~if="$for.item.kind === 'divider'"></div>
            <oda-editor-form-field ~if="$for.item.kind === 'field'" :field="$for.item.field" :data :field-errors="fieldErrors" :readonly="readonly"></oda-editor-form-field>
        </div>
    </div>
    `,
    $pdp: {
        get formDesigner() {
            return this;
        },
    },
    metadata: null,
    data: {},
    fieldErrors: null,
    readonly: {
        $def: false,
        $type: Boolean,
        $attr: true,
    },
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
    dragSourceLayer: '',
    dragOverId: '',
    dragOverLayer: '',
    dragAlign: '',
    _customSeq: 0,
    get labelColumnWidth() {
        const items = this.visibleLayoutItems || [];
        let maxLen = 10;
        for (const it of items) {
            if (it.kind !== 'field' || !it.field)
                continue;
            const t = it.field.type;
            if (t === 'Table' || t === 'Struct' || Boolean(it.field.children?.length))
                continue;
            const lbl = String(it.label || it.field.label || it.field.id || '').trim();
            const len = lbl.length + (it.field.required ? 3 : 1);
            if (len > maxLen)
                maxLen = len;
        }
        const px = Math.min(185, Math.max(115, Math.round(maxLen * 7.4 + 12)));
        return `${px}px`;
    },
    attached() {
        if (typeof ResizeObserver === 'function' && !this._ro) {
            this._ro = new ResizeObserver(() => this._syncRowStarts());
            this._ro.observe(this);
        }
        this._syncRowStarts();
    },
    detached() {
        this._ro?.disconnect?.();
        this._ro = null;
    },
    onRender() {
        this._syncRowStarts();
    },
    $listeners: {
        resize() {
            this._syncRowStarts();
        },
    },
    isFullWidthItem(item) {
        if (!item)
            return true;
        if (item.kind === 'divider' || item.kind === 'header')
            return true;
        const f = item.field || item;
        const type = String(f.type || 'String');
        const id = String(f.id || '').trim();
        return type === 'Table' || type === 'Struct' || type === 'Text' || Boolean(f.children?.length) || FULL_WIDTH_FIELD_RE.test(id) || Number(item.span) === 12;
    },
    isCompactLayoutItem(item) {
        if (!item || item.kind !== 'field' || this.isFullWidthItem(item))
            return false;
        const f = item.field || item;
        const type = String(f.type || 'String');
        const id = String(f.id || '').trim();
        return type === 'Date' || type === 'DateTime' || type === 'Number' || type === 'Boolean' || COMPACT_FIELD_RE.test(id);
    },
    _syncRowStarts() {
        const run = () => {
            const grids = [this.$?.('.fields-grid'), ...(this.$$?.('.children-box') || [])].filter(Boolean);
            for (const grid of grids) {
                const all = [...(grid.querySelectorAll?.('.grid-item, .group-item') || [])]
                    .filter(el => el.closest?.('.fields-grid, .children-box') === grid && el.offsetParent !== null);
                if (!all.length)
                    continue;
                let baseLeft = null;
                let prevTop = null;
                for (let i = 0; i < all.length; i++) {
                    const el = all[i];
                    const left = el.offsetLeft;
                    const top = el.offsetTop;
                    if (baseLeft === null || left < baseLeft)
                        baseLeft = left;
                    const isStart = i === 0 || Math.abs(left - baseLeft) <= 10 || (prevTop !== null && top > prevTop + 10);
                    if (isStart)
                        el.setAttribute('data-row-start', '');
                    else
                        el.removeAttribute('data-row-start');
                    prevTop = el.offsetTop;
                }
            }
        };
        run();
        if (typeof requestAnimationFrame === 'function')
            requestAnimationFrame(run);
    },
    itemStyle(item) {
        return fieldSizingStyle(item);
    },
    isItemAllowed(item, layer = 'ROOT') {
        return Boolean(this.designMode && this.dragSourceId && this.dragSourceLayer === layer && this.dragSourceId !== item?.id);
    },
    isItemDenied(item, layer = 'ROOT') {
        return Boolean(this.designMode && this.dragSourceId && this.dragSourceLayer && this.dragSourceLayer !== layer);
    },
    dropToDirection(item, layer = 'ROOT') {
        if (!this.designMode || !this.dragSourceId || this.dragSourceLayer !== layer || this.dragOverId !== item?.id || this.dragOverLayer !== layer)
            return '';
        return this.dragAlign || 'left';
    },
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
    getLayerItems(baseFields, layer = 'ROOT') {
        void this.layoutVersion;
        return buildLayerLayoutItems(baseFields || [], this.effectiveLayoutKey, layer);
    },
    get layoutItems() {
        return this.getLayerItems(this.fields || [], 'ROOT');
    },
    get visibleLayoutItems() {
        return (this.layoutItems || []).filter(i => !i.hidden);
    },
    get hiddenFields() {
        return (this.layoutItems || []).filter(i => i.hidden && i.kind === 'field');
    },
    _persistLayout(items, layer = 'ROOT') {
        const clean = (items || []).map(i => ({
            id: i.id,
            kind: i.kind || 'field',
            label: i.label || '',
            span: i.span || 6,
            hidden: Boolean(i.hidden),
        }));
        writeSavedLayout(this.effectiveLayoutKey, { items: clean }, layer);
        this.layoutVersion++;
    },
    changeSpan(item, delta, layer = 'ROOT', baseFields = this.fields) {
        if (!item)
            return;
        const list = this.getLayerItems(baseFields, layer).map(x => ({ ...x }));
        const target = list.find(x => x.id === item.id);
        if (!target)
            return;
        target.span = Math.max(2, Math.min(12, (Number(target.span) || 6) + delta));
        this._persistLayout(list, layer);
    },
    hideItem(item, layer = 'ROOT', baseFields = this.fields) {
        if (!item)
            return;
        let list = this.getLayerItems(baseFields, layer).map(x => ({ ...x }));
        if (item.kind !== 'field') {
            list = list.filter(x => x.id !== item.id);
        }
        else {
            const target = list.find(x => x.id === item.id);
            if (!target || target.field?.required)
                return;
            target.hidden = true;
        }
        this._persistLayout(list, layer);
    },
    restoreField(id, layer = 'ROOT', baseFields = this.fields) {
        const list = this.getLayerItems(baseFields, layer).map(x => ({ ...x }));
        const target = list.find(x => x.id === id);
        if (!target)
            return;
        target.hidden = false;
        this._persistLayout(list, layer);
    },
    renameItem(item, layer = 'ROOT', baseFields = this.fields) {
        if (!item || typeof prompt !== 'function')
            return;
        const next = prompt('Подпись элемента:', item.label || '');
        if (next === null)
            return;
        const trimmed = String(next).trim();
        if (!trimmed)
            return;
        const list = this.getLayerItems(baseFields, layer).map(x => ({ ...x }));
        const target = list.find(x => x.id === item.id);
        if (!target)
            return;
        target.label = trimmed;
        this._persistLayout(list, layer);
    },
    addSpacer() {
        const list = this.layoutItems.map(x => ({ ...x }));
        list.push({ id: `_spacer_${Date.now()}_${++this._customSeq}`, kind: 'spacer', label: '', span: 4, hidden: false });
        this._persistLayout(list, 'ROOT');
    },
    addHeader() {
        const lbl = typeof prompt === 'function' ? prompt('Текст заголовка / метки:', 'Реквизиты') : 'Реквизиты';
        if (!lbl)
            return;
        const list = this.layoutItems.map(x => ({ ...x }));
        list.push({ id: `_header_${Date.now()}_${++this._customSeq}`, kind: 'header', label: String(lbl).trim(), span: 12, hidden: false });
        this._persistLayout(list, 'ROOT');
    },
    addDivider() {
        const list = this.layoutItems.map(x => ({ ...x }));
        list.push({ id: `_divider_${Date.now()}_${++this._customSeq}`, kind: 'divider', label: '', span: 12, hidden: false });
        this._persistLayout(list, 'ROOT');
    },
    resetLayout() {
        writeSavedLayout(this.effectiveLayoutKey, null);
        this.layoutVersion++;
    },
    onDragStart(item, e, layer = 'ROOT') {
        if (!this.designMode || !item) {
            e?.preventDefault?.();
            return;
        }
        e?.stopPropagation?.();
        this.dragSourceId = item.id;
        this.dragSourceLayer = layer;
        this.dragOverId = '';
        this.dragOverLayer = '';
        this.dragAlign = '';
        try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', `${layer}::${item.id}`);
        }
        catch { /* ignore */ }
    },
    onDragEnd() {
        this.dragSourceId = '';
        this.dragSourceLayer = '';
        this.dragOverId = '';
        this.dragOverLayer = '';
        this.dragAlign = '';
    },
    onDragOver(item, e, layer = 'ROOT') {
        if (!this.designMode || !this.dragSourceId || !item)
            return;
        e?.stopPropagation?.();
        // Запрещаем перетаскивание в чужую структурную группу (layer)
        if (this.dragSourceLayer !== layer) {
            if (e?.dataTransfer)
                e.dataTransfer.dropEffect = 'none';
            return;
        }
        if (item.id === this.dragSourceId)
            return;
        e?.preventDefault?.();
        const rect = e?.currentTarget?.getBoundingClientRect?.();
        let align = 'left';
        if (rect && rect.width > 0 && Number.isFinite(e?.clientX)) {
            align = (e.clientX - rect.left) > rect.width / 2 ? 'right' : 'left';
        }
        this.dragOverId = item.id;
        this.dragOverLayer = layer;
        this.dragAlign = align;
    },
    onDragLeave(item) {
        if (this.dragOverId === item?.id) {
            this.dragOverId = '';
            this.dragAlign = '';
        }
    },
    onDrop(targetItem, e, layer = 'ROOT', baseFields = this.fields) {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const srcId = this.dragSourceId;
        const srcLayer = this.dragSourceLayer;
        const align = this.dragAlign;
        this.onDragEnd();
        // Перемещение разрешено только внутри своей группы (layer)
        if (!this.designMode || !srcId || !targetItem || srcLayer !== layer || srcId === targetItem.id)
            return;
        const list = this.getLayerItems(baseFields, layer).map(x => ({ ...x }));
        const fromIdx = list.findIndex(x => x.id === srcId);
        let toIdx = list.findIndex(x => x.id === targetItem.id);
        if (fromIdx < 0 || toIdx < 0)
            return;
        const [moved] = list.splice(fromIdx, 1);
        toIdx = list.findIndex(x => x.id === targetItem.id);
        const insertIdx = (align === 'right' || align === 'bottom') ? toIdx + 1 : toIdx;
        list.splice(insertIdx, 0, moved);
        this._persistLayout(list, layer);
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
            min-width: 0;
        }
        .field-row {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 6px;
            width: 100%;
            min-width: 0;
            font-size: 13px;
            box-sizing: border-box;
        }
        .field-row.multiline {
            align-items: flex-start;
        }
        .field-row.multiline .field-label {
            padding-top: 5px;
        }
        .field-label {
            flex: 0 0 auto;
            width: var(--item-label-width, auto);
            min-width: var(--item-label-width, auto);
            max-width: var(--item-label-width, 185px);
            font-size: 13px;
            font-weight: 500;
            color: light-dark(#374151, #cbd5e1);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            user-select: none;
            line-height: 1.35;
        }
        .editor-box {
            @apply --vertical;
            flex: 1 1 115px;
            min-width: 115px;
            width: 100%;
        }
        .field-block > .editor-box {
            flex: 1 1 100%;
            min-width: 0;
        }
        .field-control {
            width: 100%;
            min-width: 110px;
            min-height: 28px;
            box-sizing: border-box;
        }
        .field-row.invalid .field-control {
            border-color: var(--error-color, #dc2626) !important;
        }
        .field-block {
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: 100%;
            min-width: 0;
            margin-top: 2px;
            box-sizing: border-box;
        }
        .block-header {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 4px;
            font-size: 13.5px;
            font-weight: 700;
            color: var(--accent-color, #1d4ed8);
            padding: 2px 0;
            user-select: none;
        }
        .children-box {
            @apply --horizontal;
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            align-items: center;
            padding: 8px 10px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            gap: 8px 14px;
            width: 100%;
            box-sizing: border-box;
        }
        .children-box[denied] {
            background-color: rgba(239, 68, 68, 0.08);
            border-color: var(--error-color, #dc2626);
        }
        .group-item {
            min-width: 0;
            position: relative;
            box-sizing: border-box;
            --item-label-width: auto;
        }
        .group-item:first-child,
        .group-item[data-row-start] {
            --item-label-width: var(--form-label-width, 155px);
        }
        .group-item.designing {
            outline: 1px dashed var(--accent-color);
            border-radius: var(--radius-xs, 4px);
            background: var(--accent-soft);
            cursor: grab;
            padding: 2px 4px 4px;
        }
        .group-item[allow] {
            background-color: rgba(34, 197, 94, 0.12);
        }
        .group-item[denied] {
            background-color: rgba(239, 68, 68, 0.14);
            cursor: not-allowed;
        }
        .group-item[drop-to="left"]::before,
        .group-item[drop-to="top"]::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            bottom: 0;
            width: 3px;
            z-index: 2;
            background-color: var(--success-color, #16a34a);
        }
        .group-item[drop-to="right"]::after,
        .group-item[drop-to="bottom"]::after {
            content: "";
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: 3px;
            z-index: 2;
            background-color: var(--success-color, #16a34a);
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
            border-radius: 3px;
            background: var(--content-background);
            color: var(--content-color);
            cursor: pointer;
        }
        .req {
            color: var(--error-color, #dc2626);
        }
        .field-error {
            color: var(--error-color, #dc2626);
            font-size: smaller;
            padding: 2px 4px 0;
        }
    </style>
    <div class="field-row" ~if="!isBlockField" ~class="{ invalid: hasError, multiline: field?.type === 'Text' }">
        <label class="field-label" ~class="{ compact: isCompactField }" :title="label">{{label}}<span class="req" ~if="required"> *</span>:</label>
        <div class="editor-box">
            <div class="field-control" ~is="editor" :value="data?.[field.id]" @value-changed="onFieldValueChanged($event)" :field :meta="field" :at="data?.time || ''" :allow-other="!!field.other" :borderless="false" dense no-header :readonly="Boolean(readonly || field?.readonly || field?.disabled)" :disabled="Boolean(field?.disabled)"></div>
            <div class="field-error" ~if="serverError">{{serverError}}</div>
        </div>
    </div>
    <div class="field-block" ~if="isBlockField" ~class="{ invalid: hasError }">
        <div class="block-header" ~style="{ cursor: children?.length ? 'pointer' : 'default' }" @click="children?.length && (expanded = !expanded)">
            <oda-icon ~if="children?.length" :icon="expanded ? 'icons:chevron-right:90' : 'icons:chevron-right'" icon-size="18"></oda-icon>
            <span>{{label}}<span class="req" ~if="required"> *</span></span>
        </div>
        <div class="editor-box">
            <div ~if="field?.type !== 'Struct'" ~is="editor" :value="data?.[field.id]" @value-changed="onFieldValueChanged($event)" :field :meta="field" :at="data?.time || ''" :allow-other="!!field.other" :borderless="false" no-header :readonly="Boolean(readonly || field?.readonly || field?.disabled)" :disabled="Boolean(field?.disabled)"></div>
            <div ~if="children?.length && expanded" class="children-box" horizontal :denied="formDesigner?.isItemDenied?.(null, groupLayer)">
                <div class="group-item" ~for="visibleGroupItems"
                    ~class="{designing: formDesigner?.designMode}"
                    :allow="formDesigner?.isItemAllowed?.($for.item, groupLayer)"
                    :denied="formDesigner?.isItemDenied?.($for.item, groupLayer)"
                    :drop-to="formDesigner?.dropToDirection?.($for.item, groupLayer)"
                    ~style="groupItemStyle($for.item)"
                    :draggable="Boolean(formDesigner?.designMode)"
                    @dragstart="formDesigner?.onDragStart?.($for.item, $event, groupLayer)"
                    @dragend="formDesigner?.onDragEnd?.()"
                    @dragover="formDesigner?.onDragOver?.($for.item, $event, groupLayer)"
                    @dragleave="formDesigner?.onDragLeave?.($for.item)"
                    @drop="formDesigner?.onDrop?.($for.item, $event, groupLayer, children)">
                    <div class="design-item-bar" ~if="formDesigner?.designMode">
                        <span style="margin-right:auto; font-weight:600; opacity:0.75; padding-left:2px;">{{$for.item.label || $for.item.id}}</span>
                        <button type="button" class="design-mini-btn" title="Переименовать подпись" @tap.stop="formDesigner?.renameItem?.($for.item, groupLayer, children)">✎</button>
                        <button type="button" class="design-mini-btn" title="Скрыть элемент" ~if="!$for.item.field?.required" @tap.stop="formDesigner?.hideItem?.($for.item, groupLayer, children)">✕</button>
                    </div>
                    <oda-editor-form-field :field="$for.item.field" :data="subData" :field-errors="fieldErrors" :path-prefix="fullPath" :readonly="readonly"></oda-editor-form-field>
                </div>
            </div>
            <div class="field-error" ~if="serverError">{{serverError}}</div>
        </div>
    </div>
    `,
    field: null,
    data: null,
    fieldErrors: null,
    readonly: {
        $def: false,
        $type: Boolean,
        $attr: true,
    },
    pathPrefix: '',
    expanded: true,
    get isBlockField() {
        const t = this.field?.type;
        return t === 'Table' || t === 'Struct' || Boolean(this.children?.length);
    },
    get isCompactField() {
        return COMPACT_FIELD_RE.test(String(this.field?.id || ''));
    },
    get groupLayer() {
        return 'ROOT/' + (this.fullPath || this.field?.id || 'struct');
    },
    get visibleGroupItems() {
        const d = this.formDesigner;
        if (d && typeof d.getLayerItems === 'function')
            return d.getLayerItems(this.children || [], this.groupLayer).filter(i => !i.hidden);
        return (this.children || []).map(f => ({ id: f.id, layer: this.groupLayer, kind: 'field', label: f.label || f.id, field: f }));
    },
    groupItemStyle(item) {
        return fieldSizingStyle(item);
    },
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
    onFieldValueChanged(e) {
        if (!this.isConnected || this.readonly || this.field?.readonly || this.field?.disabled)
            return;
        e.stopPropagation();
        const ctrl = e.currentTarget;
        const val = e.detail ? e.detail.value : (ctrl?.type === 'checkbox' ? ctrl.checked : ctrl?.value);
        if (this.data && this.field?.id) {
            if (this.data[this.field.id] === val)
                return;
            this.data[this.field.id] = val;
            this.fire('change', { id: this.field.id, value: val, label: ctrl?.text || '' });
        }
    },
});
