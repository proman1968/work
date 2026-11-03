/**
 * Открыть модальное окно выбора одного или подбора нескольких объектов из справочника (`catalog`).
 * Используется:
 *  - при нажатии «+ Новый» в табличной части (`oda-table-input`), если среди колонок таблицы есть поле-ссылка (`multiple: true`);
 *  - при нажатии кнопки подбора «⋯» в строчном поле-ссылке (`oda-link-input`, `multiple: false`).
 *
 * Возвращает:
 *  - `null` — пользователь закрыл/отменил диалог;
 *  - `{ emptyRow: true, items: [] }` — пользователь нажал «+ Пустая строка»;
 *  - `{ emptyRow: false, items: [{ id, name, body, cid }] }` — выбранные объекты (1 или несколько).
 */
export async function openCatalogPickerDialog({
    catalog = '',
    at = '',
    multiple = true,
    allowEmptyRow = false,
    title = '',
} = {}) {
    if (!catalog || typeof WORK?.showModal !== 'function' || typeof document === 'undefined')
        return null;
    const picker = ODA.createComponent('oda-table-link-picker', {
        catalog,
        at: at || '',
        multiple: Boolean(multiple),
        allowEmptyRow: Boolean(allowEmptyRow),
    });
    const catName = String(catalog).split('/').filter(Boolean).pop() || 'Справочник';
    const dialogTitle = title || (multiple ? `Подбор из справочника «${catName}»` : `Выбор из справочника «${catName}»`);
    try {
        await WORK.showModal(picker, {
            TITLE: { label: dialogTitle },
            allowClose: true,
            width: Math.min(680, (window.innerWidth || 720) - 32),
        });
    }
    catch {
        if (!picker.confirmed)
            return null;
    }
    if (!picker.confirmed)
        return null;
    return {
        emptyRow: Boolean(picker.confirmedEmptyRow),
        items: Array.isArray(picker.confirmedItems) ? picker.confirmedItems : [],
    };
}

export function buildTableRowsFromPicked(cols, linkCol, items) {
    if (!linkCol || !Array.isArray(items))
        return [];
    return items.map(item => {
        const row = { [linkCol.id]: item.id };
        const b = item.body || {};
        for (const col of (cols || [])) {
            if (col.id === linkCol.id || col.readonly)
                continue;
            if (col.id === 'unit' && (b.base_unit || b.unit))
                row.unit = b.base_unit || b.unit;
            else if (col.id === 'fio' && item.name)
                row.fio = item.name;
            else if (b[col.id] !== undefined && b[col.id] !== null && b[col.id] !== '')
                row[col.id] = b[col.id];
        }
        return row;
    });
}

globalThis.__workCatalogPicker = { openCatalogPickerDialog, buildTableRowsFromPicked };

ODA({is: 'oda-table-link-picker',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            min-width: min(620px, 90vw);
            max-height: 74vh;
            background: var(--content-background, #ffffff);
            color: var(--content-color, #1f2937);
            font-size: 13px;
            box-sizing: border-box;
        }
        .picker-top {
            @apply --horizontal;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color);
            background: var(--header-background, #f3f4f6);
            flex-shrink: 0;
        }
        .search-input {
            flex: 1;
            min-width: 140px;
            padding: 4px 8px;
            font-size: 13px;
            border: 1px solid var(--border-color);
            border-radius: 3px;
            background: var(--content-background, #fff);
            color: var(--content-color, #111);
            outline: none;
        }
        .search-input:focus {
            border-color: var(--accent-color);
        }
        .top-btn {
            padding: 4px 9px;
            font-size: 12px;
            font-weight: 600;
            border: 1px solid var(--border-color);
            border-radius: 3px;
            background: var(--content-background, #fff);
            color: var(--content-color, #222);
            cursor: pointer;
            white-space: nowrap;
        }
        .top-btn:hover {
            border-color: var(--accent-color);
            color: var(--accent-color);
        }
        .list-wrap {
            @apply --vertical;
            flex: 1;
            min-height: 220px;
            max-height: 52vh;
            overflow-y: auto;
        }
        .item-row {
            @apply --horizontal;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            border-bottom: 1px solid var(--subtle-border, #e5e7eb);
            cursor: pointer;
            user-select: none;
        }
        .item-row:hover {
            background: var(--hover-background, rgba(37, 99, 235, 0.06));
        }
        .item-row[selected] {
            background: var(--selected-background, rgba(37, 99, 235, 0.14));
            font-weight: 600;
        }
        .item-check {
            width: 15px;
            height: 15px;
            cursor: pointer;
            flex-shrink: 0;
        }
        .item-name {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .item-sub {
            font-size: 11.5px;
            color: var(--muted-color, #6b7280);
            white-space: nowrap;
            flex-shrink: 0;
        }
        .empty-msg {
            padding: 24px 16px;
            text-align: center;
            color: var(--muted-color, #6b7280);
        }
        .picker-footer {
            @apply --horizontal;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 12px;
            border-top: 1px solid var(--border-color);
            background: var(--header-background, #f3f4f6);
            flex-shrink: 0;
        }
        .footer-right {
            @apply --horizontal;
            align-items: center;
            gap: 6px;
            margin-left: auto;
        }
        .btn {
            padding: 4px 12px;
            font-size: 12.5px;
            font-weight: 600;
            border: 1px solid var(--border-color);
            border-radius: 3px;
            background: var(--content-background, #fff);
            color: var(--content-color, #222);
            cursor: pointer;
        }
        .btn:hover:not(:disabled) {
            border-color: var(--accent-color);
        }
        .btn.primary {
            background: var(--accent-color, #2563eb);
            border-color: var(--accent-color, #2563eb);
            color: #ffffff;
        }
        .btn:disabled {
            opacity: 0.45;
            cursor: default;
        }
    </style>
    <div class="picker-top">
        <input class="search-input" type="search" placeholder="Поиск по наименованию…" :value="searchQuery" @input="onSearchInput($event.target.value)" @keydown="onSearchKeyDown($event)">
        <button type="button" class="top-btn" ~if="hasOthers && !showAll" @tap="toggleShowAll()">Показать все (+{{othersCount}})</button>
        <button type="button" class="top-btn" ~if="multiple && items.length" @tap="toggleSelectAll()">{{allSelected ? 'Снять все' : 'Выбрать все'}}</button>
    </div>
    <div class="list-wrap">
        <div class="empty-msg" ~if="!loading && !items.length">Ничего не найдено</div>
        <div class="item-row" ~for="items" :selected="isSelected($for.item.id)" @click="onRowClick($for.item, $event)" @dblclick="onRowDblClick($for.item, $event)">
            <input ~if="multiple" class="item-check" type="checkbox" :checked="isSelected($for.item.id)" @click.stop="toggleItem($for.item)">
            <span class="item-name" :title="$for.item.name">{{$for.item.name}}</span>
            <span class="item-sub" ~if="$for.item.unit">{{$for.item.unit}}</span>
            <span class="item-sub" ~if="$for.item.member === false">· вне состава</span>
        </div>
    </div>
    <div class="picker-footer">
        <button type="button" class="btn" ~if="allowEmptyRow" @tap="confirmEmptyRow()">+ Пустая строка</button>
        <span ~if="multiple && selectedIds.length" style="font-size:12px; font-weight:600;">Выбрано: {{selectedIds.length}}</span>
        <div class="footer-right">
            <button type="button" class="btn primary" :disabled="!selectedIds.length" @tap="confirmSelection()">{{confirmLabel}}</button>
            <button type="button" class="btn" @tap="cancel()">Отмена</button>
        </div>
    </div>
    `,
    catalog: '',
    at: '',
    multiple: true,
    allowEmptyRow: false,
    searchQuery: '',
    showAll: false,
    hasOthers: false,
    othersCount: 0,
    loading: false,
    items: [],
    selectedIds: [],
    _byId: null,
    confirmed: false,
    confirmedEmptyRow: false,
    confirmedItems: [],
    get allSelected() {
        return this.items.length > 0 && this.items.every(i => this.selectedIds.includes(i.id));
    },
    get confirmLabel() {
        if (this.multiple && this.selectedIds.length > 1)
            return `Добавить (${this.selectedIds.length})`;
        return 'Выбрать';
    },
    attached() {
        this._byId = new Map();
        this.loadItems();
    },
    isSelected(id) {
        return (this.selectedIds || []).includes(id);
    },
    async loadItems() {
        if (!this.catalog || typeof WORK?.get_item !== 'function')
            return;
        this.loading = true;
        try {
            const cat = await WORK.get_item(this.catalog);
            if (!cat)
                return;
            const q = String(this.searchQuery || '').trim();
            const [choicesRes, queryRes] = await Promise.all([
                cat.fetch('db_choices', { search: q, all: this.showAll, limit: 200, ...(this.at ? { at: this.at } : {}) }).catch(() => null),
                cat.fetch('db_query', { search: q, limit: 200 }).catch(() => null),
            ]);
            const bodyById = new Map();
            for (const o of (queryRes?.items || [])) {
                if (o?.id)
                    bodyById.set(o.id, { body: o.body || {}, cid: o.cid || '', title: o.title || o.body?.name || o.id });
            }
            this.othersCount = Number(choicesRes?.others) || 0;
            this.hasOthers = this.othersCount > 0;
            const rawList = Array.isArray(choicesRes?.items) && choicesRes.items.length
                ? choicesRes.items
                : (queryRes?.items || []).map(o => ({ id: o.id, title: o.title || o.body?.name || o.id, member: true }));
            this._byId ??= new Map();
            this.items = rawList.map(i => {
                const full = bodyById.get(i.id);
                const body = full?.body || {};
                const unit = String(body.base_unit || body.unit || '').trim();
                const entry = {
                    id: i.id,
                    name: i.title || full?.title || body.name || i.id,
                    member: i.member,
                    unit,
                    body,
                    cid: full?.cid || '',
                };
                this._byId.set(entry.id, entry);
                return entry;
            });
            if (!this.selectedIds.length && this.items.length && !this.multiple) {
                this.selectedIds = [this.items[0].id];
            }
        }
        finally {
            this.loading = false;
        }
    },
    onSearchInput(val) {
        this.searchQuery = val;
        this.debounce('picker-search', () => this.loadItems(), 220);
    },
    onSearchKeyDown(e) {
        if (e.key === 'Enter' && this.selectedIds.length) {
            e.preventDefault();
            this.confirmSelection();
        }
    },
    toggleShowAll() {
        this.showAll = true;
        this.loadItems();
    },
    toggleItem(item) {
        if (!item?.id)
            return;
        if (!this.multiple) {
            this.selectedIds = [item.id];
            return;
        }
        if (this.selectedIds.includes(item.id))
            this.selectedIds = this.selectedIds.filter(x => x !== item.id);
        else
            this.selectedIds = [...this.selectedIds, item.id];
    },
    toggleSelectAll() {
        if (this.allSelected) {
            const visibleSet = new Set(this.items.map(i => i.id));
            this.selectedIds = this.selectedIds.filter(id => !visibleSet.has(id));
        }
        else {
            const next = new Set(this.selectedIds);
            for (const i of this.items)
                next.add(i.id);
            this.selectedIds = [...next];
        }
    },
    onRowClick(item) {
        this.toggleItem(item);
    },
    onRowDblClick(item, e) {
        e?.stopPropagation?.();
        if (!item?.id)
            return;
        if (!this.selectedIds.includes(item.id))
            this.selectedIds = this.multiple ? [...this.selectedIds, item.id] : [item.id];
        this.confirmSelection();
    },
    _closePopover() {
        for (let p = this.parentElement || this.domHost; p; p = p.parentElement || p.domHost) {
            if (typeof p.close === 'function') {
                p.close('ok');
                return;
            }
        }
    },
    confirmSelection() {
        if (!this.selectedIds.length)
            return;
        this.confirmed = true;
        this.confirmedEmptyRow = false;
        this.confirmedItems = this.selectedIds.map(id => this._byId?.get(id) || { id, name: id, body: {} });
        this._closePopover();
    },
    confirmEmptyRow() {
        this.confirmed = true;
        this.confirmedEmptyRow = true;
        this.confirmedItems = [];
        this._closePopover();
    },
    cancel() {
        this.confirmed = false;
        this._closePopover();
    },
});

ODA({is: 'oda-link-input',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            gap: 4px;
            min-width: 0;
        }
        .row {
            @apply --horizontal;
            align-items: center;
            gap: 2px;
            min-width: 0;
            box-sizing: border-box;
        }
        input {
            @apply --flex;
            min-width: 0;
            box-sizing: border-box;
            padding: 4px;
            font-size: 125%;
            border: none;
            border-radius: 4px;
            outline: none;
            background: transparent;
            color: inherit;
        }
        .pick {
            padding: 2px 6px;
            font-size: 12px;
            border: none;
            border-radius: 3px;
            background: transparent;
            color: var(--muted-color, #6b7280);
            cursor: pointer;
            line-height: 1;
            flex-shrink: 0;
        }
        .pick:hover {
            color: var(--accent-color, #2563eb);
            background: var(--hover-background, rgba(0, 0, 0, 0.05));
        }
        .variants {
            @apply --vertical;
            gap: 2px;
            max-height: 160px;
            overflow-y: auto;
        }
        .variant {
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
        }
        .variant:hover {
            background-color: var(--active-background, #e8e8e8);
        }
        .variant[other], .variant[action] {
            opacity: .75;
        }
        .variant[action] {
            font-style: italic;
        }
        .variant[error] {
            color: var(--error-color);
            cursor: default;
        }
        :host([disabled]) {
            @apply --disabled;
        }
        /* без рамки и фона — ячейка таблицы, строка property-grid (как у oda-input) */
        :host([borderless]) .row,
        :host([borderless]) input,
        :host([borderless]) .pick {
            background-color: transparent;
            border: none;
            border-radius: 0;
            box-shadow: none;
        }
        :host([dense]) {
            position: relative;
            flex: 1 1 auto;
        }
        :host([dense]) input {
            padding: 3px 6px;
            font-size: 13px;
            line-height: 1.35;
        }
        :host([dense]:not([borderless])) .row {
            min-height: 28px;
            border: 1px solid light-dark(#b8b7ae, #3e4049);
            border-radius: 3px;
            background: light-dark(#ffffff, #1b1c20);
            color: light-dark(#1f1f1f, #e2e8f0);
            padding-right: 2px;
        }
        :host([readonly][dense]:not([borderless])) .row {
            background: var(--subtle-background, #f3f4f6);
        }
        :host([dense]:not([borderless]):focus-within) .row {
            border-color: var(--accent-color, #2563eb);
            box-shadow: 0 0 0 1px var(--accent-color, #2563eb);
        }
        input.resolved-link {
            color: var(--accent-color, #2563eb);
            text-decoration: underline;
            cursor: pointer;
        }
        input.resolved-link:hover {
            opacity: 0.85;
        }
        :host([dense]) .variants {
            position: absolute;
            top: calc(100% + 2px);
            left: 0;
            min-width: 100%;
            z-index: 100;
            background: light-dark(#ffffff, #22232a);
            border: 1px solid light-dark(#9a9990, #4a4c56);
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
        }
    </style>
    <div class="row">
        <input ~class="{'resolved-link': Boolean(resolved)}" :value="text" :readonly="locked" :placeholder="meta?.placeholder || field?.placeholder || 'поиск…'" :disabled="inputDisabled" :title="resolved ? 'Открыть «' + text + '»' : ''" @click="onInputClick($event)" @input="onText($this.value)" @focus="onFocus()">
        <button type="button" class="pick" ~if="value && !readonly && !isDisabled" @tap="value = ''" title="Очистить">×</button>
        <button type="button" class="pick" ~if="catalog && !readonly && !isDisabled && !borderless" @tap.stop="openCatalogDialog()" title="Выбрать из справочника">⋯</button>
    </div>
    <!-- mousedown.prevent: фокус остаётся в поле, иначе ячейка таблицы теряет его до клика и отбрасывает выбор -->
    <div class="variants" ~if="variants?.length" @mousedown.prevent="true">
        <div class="variant" ~for="variants" :other="$for.item.member === false" :action="!!($for.item.all || $for.item.create)"
            :error="!!$for.item.error" @tap="pick($for.item)">{{showName($for.item)}}</div>
    </div>
    `,
    // без $def (как в oda-input): значение приходит биндингом; дефолт '' материализовался бы
    // на attached() — раньше привязки хоста — и через ::value затирал бы ссылку в данных
    value: undefined,
    meta: null,
    /** поле в виде структуры (form, table): каталог — путь типа, либо catalog из описания */
    field: null,
    /** только чтение: без выбора и очистки, но клик по разрешённой ссылке открывает объект */
    readonly: {
        $def: false,
        $type: Boolean,
        $attr: true,
    },
    /** отключено: атрибут/проп `disabled` (у `oda-input` — то же имя); раньше был геттером без сеттера и записи терял */
    disabled: {
        $def: false,
        $attr: true
    },
    /** без рамки и фона (ячейка таблицы, строка property-grid) */
    borderless: {
        $def: false,
        $attr: true
    },
    dense: {
        $def: false,
        $attr: true
    },
    text: '',
    /** id объекта справочника, найденного по value: пока он есть — поле только для показа */
    resolved: '',
    /** дата, на которую берётся состав виртуального справочника (дата операции); пусто — сейчас */
    at: '',
    /** варианты: { id, name, member? } | { all } — показать весь справочник | { create } — создать | { error } */
    variants: [],
    /** отключено своим признаком или описанием поля (`meta.disabled`) */
    get isDisabled() {
        return this.disabled || !!this.meta?.disabled;
    },
    /** нативный input недоступен: только при явном disabled (или в readonly без выбранной ссылки), чтобы клик по ссылке работал */
    get inputDisabled() {
        return this.isDisabled || (!!this.readonly && !this.resolved);
    },
    /** значение найдено в справочнике или режим чтения: показываем имя, текст не принимаем */
    get locked() {
        return !!this.resolved || !!this.readonly;
    },
    /** контракт контролла: обязательность — из описания поля; ошибки — как у oda-input */
    get errors() {
        const required = this.meta?.required === true || this.field?.required === true;
        return required && !String(this.value ?? '').trim() ? ['Обязательное поле'] : [];
    },
    validate() {
        return !this.errors.length;
    },
    get catalog() {
        const type = this.field?.type;
        return String(this.meta?.catalog || this.field?.catalog || (typeof type === 'string' && type.startsWith('/') ? type : '')).trim();
    },
    showName(item) {
        const name = item?.name || item?.id || '';
        return item?.member === false ? name + ' · из справочника' : name;
    },
    pick(item) {
        if (item?.error)
            return;
        if (item?.all)
            return this.search(this.text, { all: true });
        if (item?.create)
            return this.createAndPick(item.create, item.title);
        // выбрали из списка — значение уже разрешено, поле запирается сразу, не дожидаясь db_read
        this.text = item?.name || item?.id || '';
        this.resolved = item?.id || '';
        this.value = item?.id || '';
        this.variants = [];
    },
    async openCatalogDialog() {
        if (!this.catalog || this.inputDisabled)
            return;
        this.variants = [];
        const res = await openCatalogPickerDialog({
            catalog: this.catalog,
            at: this.at,
            multiple: false,
            allowEmptyRow: false,
            title: this.field?.label ? `Выбор: ${this.field.label}` : '',
        });
        if (res?.items?.length) {
            this.pick(res.items[0]);
        }
    },
    /** значение и описание приходят биндингами, часто уже после attached — имя пересчитываем при каждом изменении */
    $observers: {
        resolveOn(value) {
            this.resolve(value);
        }
    },
    async attached() {
        await this.resolve();
    },
    async resolve(value = this.value) {
        const id = String(value ?? '').trim();
        if (!id || !this.catalog) {
            this.resolved = '';
            this.text = '';
            return;
        }
        try {
            const cat = await WORK.get_item(this.catalog);
            // объект учётного ядра на справочнике ссылки: заголовок или имя
            const obj = await cat.fetch('db_read', { id });
            const name = obj?.title || obj?.body?.name || '';
            // пока шёл запрос, значение могли сменить (очистка, выбор) — чужой ответ не применяем
            if (String(this.value ?? '').trim() !== id)
                return;
            this.resolved = id;
            this.text = name || id;
        }
        catch {
            if (String(this.value ?? '').trim() !== id)
                return;
            // объект не нашёлся (удалён, нет доступа) — id показываем, но поле оставляем правимым
            this.resolved = '';
            this.text = id;
        }
    },
    onText(v) {
        this.text = v;
        this.debounce('search', () => this.search(v), 300);
    },
    /** Фокус в пустом поле — сразу доступный список (состав на дату), без ввода. */
    onFocus() {
        if (!this.locked && !this.inputDisabled && !this.variants?.length)
            this.search(this.text);
    },
    onInputClick(e) {
        if (this.resolved) {
            this.openLinkedObject(e);
        }
    },
    async openLinkedObject(e) {
        const objId = String(this.resolved || this.value || '').trim();
        let targetPath = this.catalog;
        if (!objId || !targetPath || typeof WORK?.get_item !== 'function')
            return;
        e?.stopPropagation?.();
        let formHost = null;
        for (let p = this; p; p = p.domHost || p.parentElement || p.getRootNode?.()?.host) {
            if (p.localName === 'work-form' || typeof p.openInForm === 'function') {
                formHost = p;
                break;
            }
        }
        const hostPath = String(formHost?.currentItem?.short || formHost?.currentItem?.path || formHost?.$item?.short || formHost?.$item?.path || '');
        if (!targetPath.startsWith('/')) {
            const m = hostPath.match(/^(\/ORGANIZATIONS\/[^/]+\/MODULES\/[^/]+)/);
            if (m)
                targetPath = `${m[1]}/${targetPath.replace(/^\/+/, '')}`;
        }
        else if (targetPath.startsWith('/MODULES/')) {
            const m = hostPath.match(/^(\/ORGANIZATIONS\/[^/]+)/);
            if (m)
                targetPath = `${m[1]}${targetPath}`;
        }
        try {
            const target = await WORK.get_item(targetPath);
            if (!target)
                return;
            const nav = { view: 'object', id: objId, label: String(this.text || objId) };
            if (formHost && typeof formHost.openInForm === 'function') {
                await formHost.openInForm(target, nav);
            }
            else if (typeof window !== 'undefined' && typeof window.execute === 'function') {
                window.execute(target, nav);
            }
        }
        catch (err) {
            console.warn('openLinkedObject error:', err);
        }
    },
    /**
     * Варианты учётного ядра (db_choices): без ввода — состав виртуального справочника на дату,
     * с вводом — участники и подходящие объекты реального справочника; «показать все»,
     * если вне состава ещё есть объекты; «создать», если ничего не нашлось.
     */
    async choices(cat, q, { all = false } = {}) {
        const res = await cat.fetch('db_choices', { search: q, all, limit: 20, ...(this.at ? { at: this.at } : {}) });
        const out = (Array.isArray(res?.items) ? res.items : []).map(i => ({ id: i.id, name: i.title || i.id, member: i.member }));
        if (!q && !all && res?.others > 0)
            out.push({ all: true, name: `Показать все (ещё ${res.others})` });
        if (q && !out.length && res?.create?.length)
            out.push({ create: res.create[0], title: q, name: `Создать «${q}» в «${res.create[0].label}»` });
        this.variants = out;
    },
    /** Создать объект с введённым названием и сослаться на него. */
    async createAndPick(target, title) {
        try {
            const cls = await WORK.get_item(target.path || target.cid);
            const obj = await cls.fetch('db_create', {}, { name: title });
            this.pick({ id: obj.id, name: obj.title || title });
        }
        catch (e) {
            this.variants = [{ error: true, name: String(e?.message || e) }];
        }
    },
    async search(v, opts = {}) {
        this.variants = [];
        const q = String(v ?? '').trim();
        if (!this.catalog)
            return;
        try {
            await this.choices(await WORK.get_item(this.catalog), q, opts);
        }
        catch (e) {
            this.variants = [{ error: true, name: String(e?.message || e) }];
        }
    },
});
