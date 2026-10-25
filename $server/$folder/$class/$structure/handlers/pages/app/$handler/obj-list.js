/**
 * `<work-object-list>` — универсальный список объектов класса меню (справочник или операции, с
 * потомками): поиск, статус, период и отбор по полям, сортировка и страницы считает сервер
 * (`db_query`). Состояние списка — в адресе (`list-model.js`), поэтому ссылку можно переслать, а
 * возврат из формы возвращает к тому же поиску и странице. «Создать» — в лист класса; у группы с
 * несколькими листьями — выбор листа в дереве.
 */
import { html, css, nothing } from '/vendor/lit/lit.js';
import { WorkElement } from './base.js';
import { app } from './store.js';
import { ACCESS_LABELS, SCOPE_LABELS, FAMILIES, scopeOf } from './menu.js';
import { formatValue, formatDateTime, enumOptions, fieldLabel, plural } from './fields.js';
import { statusLabel, statusVariant } from './lifecycle.js';
import {
    PAGE_SIZE, STATUS_FILTERS, readListState, listRouteParams, patchListState, listQuery, listColumns, nextOrder, sortable,
    defaultOrder, filterFields,
} from './list-model.js';
import { creatableTree, creatableLeaves } from './class-tree.js';
import './link-input.js';
import './icon.js';

const SEARCH_DELAY = 350;

export class WorkObjectList extends WorkElement {
    static properties = {
        path: { type: String },
        node: { attribute: false },
        schema: { attribute: false },
        searchText: { state: true },
        items: { state: true },
        total: { state: true },
        names: { state: true },
        titles: { state: true },
        loading: { state: true },
        failure: { state: true },
        picking: { state: true },
    };

    static styles = css`
        :host { display: block; max-width: 84rem; margin: 0 auto; padding: var(--wa-space-l); box-sizing: border-box; }
        header { display: flex; align-items: center; gap: var(--wa-space-m); margin-bottom: var(--wa-space-m); }
        header .grow { flex: 1; min-width: 0; }
        .badge-icon { display: grid; place-items: center; flex: none; width: 3rem; height: 3rem; font-size: 1.5rem; border-radius: var(--wa-border-radius-l); background: var(--wa-color-brand-fill-quiet); color: var(--wa-color-brand-on-quiet); }
        h1 { margin: 0; font-family: var(--wa-font-family-heading); font-size: var(--wa-font-size-2xl); line-height: 1.15; }
        .tags { display: flex; flex-wrap: wrap; gap: var(--wa-space-xs); margin-top: var(--wa-space-xs); }
        .tools { display: flex; flex-wrap: wrap; gap: var(--wa-space-s); align-items: end; margin-bottom: var(--wa-space-m); }
        .tools .search { flex: 1 1 16rem; min-width: 12rem; }
        .tools wa-select, .tools wa-input.date { width: 11rem; }
        .tools .flt { width: 13rem; }
        .wrap { background: var(--wa-color-surface-default); border: 1px solid var(--wa-color-surface-border); border-radius: var(--wa-border-radius-l); overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: var(--wa-space-xs) var(--wa-space-m); text-align: left; border-bottom: 1px solid var(--wa-color-surface-border); white-space: nowrap; max-width: 24rem; overflow: hidden; text-overflow: ellipsis; }
        th { font-size: var(--wa-font-size-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--wa-color-text-quiet); background: var(--wa-color-surface-lowered); font-weight: 600; user-select: none; }
        th.sort { cursor: pointer; }
        th.sort:hover { color: var(--wa-color-text-normal); }
        th .arrow { margin-left: var(--wa-space-3xs); }
        td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
        tbody tr { cursor: pointer; }
        tbody tr:hover { background: var(--wa-color-brand-fill-quiet); }
        tbody tr:focus-visible { outline: 2px solid var(--wa-color-brand-fill-loud); outline-offset: -2px; }
        tr:last-child td { border-bottom: 0; }
        .empty { padding: var(--wa-space-3xl); text-align: center; color: var(--wa-color-text-quiet); }
        .foot { display: flex; align-items: center; justify-content: space-between; gap: var(--wa-space-m); margin-top: var(--wa-space-m); flex-wrap: wrap; color: var(--wa-color-text-quiet); font-size: var(--wa-font-size-s); }
        .loading { display: grid; place-items: center; padding: var(--wa-space-4xl); }
        wa-callout { margin-bottom: var(--wa-space-m); }
        .dim { opacity: 0.5; transition: opacity 0.15s; }
        ul.pick { list-style: none; margin: 0; padding: 0; }
        ul.pick ul { list-style: none; margin: 0 0 0 var(--wa-space-l); padding: 0; border-left: 1px solid var(--wa-color-surface-border); }
        .pick .group { display: block; padding: var(--wa-space-xs) var(--wa-space-s); font-weight: 600; color: var(--wa-color-text-quiet); }
        .pick button { display: flex; align-items: center; gap: var(--wa-space-s); width: 100%; padding: var(--wa-space-xs) var(--wa-space-s); border: 0; background: none; font: inherit; color: inherit; cursor: pointer; border-radius: var(--wa-border-radius-s); text-align: left; }
        .pick button:hover { background: var(--wa-color-brand-fill-quiet); }
    `;

    constructor() {
        super();
        this.items = [];
        this.total = 0;
        this.names = {};
        this.titles = {};
        this.searchText = '';
    }

    get st() {
        return readListState(app.route.params);
    }

    /** Подразделение контекста для отбора операций; корень организации — без отбора (сводный вид, объекты без подразделения). */
    get unit() {
        const unit = app.ctx?.unit ?? '';
        return unit === app.org?.cid ? '' : unit;
    }

    willUpdate(changed) {
        if (!this.schema)
            return;
        const st = this.st;
        if (changed.has('path') || changed.has('schema'))
            this._lastQ = undefined;
        if (st.q !== this._lastQ) {
            this._lastQ = st.q;
            this.searchText = st.q;
        }
        const query = listQuery(st, this.schema, { unit: this.unit });
        const key = JSON.stringify([this.path, query]);
        if (key !== this._key) {
            this._key = key;
            this.fetchPage(query);
        }
        this.resolveTitles(st);
    }

    async fetchPage(query) {
        const key = this._key;
        this.loading = true;
        this.failure = null;
        try {
            const res = await app.api.query(this.path, query);
            if (key !== this._key)
                return;
            this.items = res.items;
            this.total = res.total;
            this.names = res.names ?? {};
        }
        catch (e) {
            if (key === this._key) {
                this.failure = e;
                this.items = [];
                this.total = 0;
            }
        }
        finally {
            if (key === this._key)
                this.loading = false;
        }
    }

    /** Названия выбранных в фильтрах объектов (в адресе — только id). */
    async resolveTitles(st) {
        for (const f of filterFields(this.schema)) {
            const id = st.filters[f.id];
            if (f.type !== 'link' || !id || this.titles[id] !== undefined || this._asked?.has(id))
                continue;
            (this._asked ??= new Set()).add(id);
            app.api.read(f.targetPath, id).then(o => { this.titles = { ...this.titles, [id]: o?.title || id }; })
                .catch(() => { this.titles = { ...this.titles, [id]: id }; });
        }
    }

    set(patch) {
        app.go({ params: listRouteParams(patchListState(this.st, patch)) });
    }

    onSearch(e) {
        this.searchText = e.target.value;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.set({ q: this.searchText }), SEARCH_DELAY);
    }

    open(item) {
        app.go({ id: item.id });
    }

    get tree() {
        return creatableTree(app.ws.classes, this.path);
    }

    get canCreate() {
        return this.node?.access !== 'read' && creatableLeaves(this.tree).length > 0;
    }

    create() {
        const leaves = creatableLeaves(this.tree);
        if (leaves.length === 1)
            this.createIn(leaves[0].path);
        else
            this.picking = true;
    }

    createIn(path) {
        this.picking = false;
        app.go({ id: 'new', params: { ...app.route.params, cls: path } });
    }

    /* ---------- экран ---------- */

    cell(col, item) {
        switch (col.kind) {
            case 'time': return formatDateTime(item.time);
            case 'status': return html`<wa-badge variant=${statusVariant(item.status)}>${statusLabel(item.status)}</wa-badge>`;
            case 'class': return app.ws.classes[this.classPath(item.cid)]?.label ?? item.cid;
            case 'title': return item.title;
            default: return formatValue(col.field, item.body?.[col.field.id], this.names);
        }
    }

    classPath(cid) {
        return Object.values(app.ws.classes).find(c => c.cid === cid)?.path;
    }

    header(cols, st) {
        const order = st.order || defaultOrder(this.schema);
        return html`<tr>${cols.map(c => {
            const can = sortable(c);
            const active = order === c.key || order === '-' + c.key;
            const num = c.field && ['money', 'number', 'integer'].includes(c.field.type);
            return html`<th class="${can ? 'sort' : ''} ${num ? 'num' : ''}" data-col=${c.key} @click=${can ? () => this.set({ order: nextOrder(order, c.key) }) : null}>
                ${c.label}${active ? html`<span class="arrow">${order.startsWith('-') ? '↓' : '↑'}</span>` : nothing}</th>`;
        })}</tr>`;
    }

    filters(st) {
        const op = this.schema.family === 'operation';
        const dirty = st.q || st.status || st.from || st.to || Object.keys(st.filters).length;
        return html`<div class="tools">
            <wa-input class="search" label="Поиск" placeholder="Начало слов в названии и полях" with-clear autocomplete="off"
                .value=${this.searchText} @input=${this.onSearch}>
                <work-icon slot="start" name="carbon:search"></work-icon>
            </wa-input>
            <wa-select label="Статус" .value=${st.status} @change=${e => this.set({ status: e.target.value })}>
                ${STATUS_FILTERS[this.schema.family].map(s => html`<wa-option value=${s.id}>${s.label}</wa-option>`)}
            </wa-select>
            ${op ? html`
                <wa-input class="date" type="date" label="С" .value=${st.from} @change=${e => this.set({ from: e.target.value })}></wa-input>
                <wa-input class="date" type="date" label="По" .value=${st.to} @change=${e => this.set({ to: e.target.value })}></wa-input>` : nothing}
            ${filterFields(this.schema).map(f => this.filterControl(f, st))}
            ${dirty ? html`<wa-button appearance="plain" variant="neutral" @click=${() => app.go({ params: {} })}>Сбросить</wa-button>` : nothing}
        </div>`;
    }

    filterControl(f, st) {
        const v = st.filters[f.id] ?? '';
        const set = value => this.set({ filters: { [f.id]: value } });
        if (f.type === 'link')
            return html`<work-link-input class="flt" .field=${f} label=${fieldLabel(f)} .value=${v} .caption=${this.titles[v] ?? ''}
                @link-change=${e => { if (e.detail.title) this.titles = { ...this.titles, [e.detail.value]: e.detail.title }; set(e.detail.value); }}></work-link-input>`;
        const options = f.type === 'boolean' ? [{ value: 'true', label: 'Да' }, { value: 'false', label: 'Нет' }] : enumOptions(f);
        return html`<wa-select class="flt" label=${fieldLabel(f)} .value=${v} placeholder="Все" with-clear @change=${e => set(e.target.value)}>
            ${options.map(o => html`<wa-option value=${o.value}>${o.label}</wa-option>`)}</wa-select>`;
    }

    picker() {
        if (!this.picking)
            return nothing;
        const node = n => (n.creatable
            ? html`<li><button data-create=${n.path} @click=${() => this.createIn(n.path)}><work-icon name=${n.icon || 'carbon:document-add'}></work-icon>${n.label}</button></li>`
            : html`<li><span class="group">${n.label}</span><ul class="pick">${n.children.map(node)}</ul></li>`);
        const tree = this.tree;
        return html`<wa-dialog open label=${this.schema.family === 'operation' ? 'Новая операция: выберите вид' : 'Новый объект: выберите вид'}
            @wa-after-hide=${e => { if (e.target === e.currentTarget) this.picking = false; }}>
            <ul class="pick">${tree.creatable ? node(tree) : tree.children.map(node)}</ul>
        </wa-dialog>`;
    }

    render() {
        const cls = this.node ?? app.ws.classes[this.path];
        const family = FAMILIES.find(f => f.id === cls?.family);
        if (!this.schema)
            return html`<div class="loading"><wa-spinner style="font-size: 2rem"></wa-spinner></div>`;
        const st = this.st;
        const cols = listColumns(this.schema);
        const pages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        return html`
            <header>
                <div class="badge-icon"><work-icon name=${cls?.icon || 'carbon:folders'}></work-icon></div>
                <div class="grow">
                    <h1>${cls?.label}</h1>
                    <div class="tags">
                        <wa-badge appearance="outlined" variant="brand">${family?.label ?? cls?.family}</wa-badge>
                        ${this.node ? html`
                            <wa-badge appearance="outlined" variant=${this.node.access === 'read' ? 'neutral' : 'success'}>${ACCESS_LABELS[this.node.access]}</wa-badge>
                            <wa-badge appearance="outlined" variant="neutral">данные: ${SCOPE_LABELS[scopeOf(cls.family, this.node.scope)]}</wa-badge>` : nothing}
                    </div>
                </div>
                ${this.canCreate ? html`<wa-button variant="brand" data-action="new" @click=${this.create}><work-icon slot="start" name="carbon:add"></work-icon>Создать</wa-button>` : nothing}
            </header>
            ${this.filters(st)}
            ${this.failure ? html`<wa-callout variant="danger"><work-icon slot="icon" name="carbon:warning"></work-icon>${this.failure.message}</wa-callout>` : nothing}
            <div class="wrap ${this.loading && this.items.length ? 'dim' : ''}">
                <table>
                    <thead>${this.header(cols, st)}</thead>
                    <tbody>${this.items.map(item => html`<tr tabindex="0" data-id=${item.id} @click=${() => this.open(item)}
                        @keydown=${e => { if (e.key === 'Enter') this.open(item); }}>
                        ${cols.map(c => html`<td class=${c.field && ['money', 'number', 'integer'].includes(c.field.type) ? 'num' : ''}>${this.cell(c, item)}</td>`)}</tr>`)}</tbody>
                </table>
                ${!this.items.length ? (this.loading ? html`<div class="loading"><wa-spinner style="font-size: 2rem"></wa-spinner></div>`
                    : html`<div class="empty">${st.q || st.status || st.from || st.to || Object.keys(st.filters).length ? 'Ничего не найдено — измените отбор' : 'Объектов пока нет'}</div>`) : nothing}
            </div>
            <div class="foot">
                <span>${this.total} ${plural(this.total, 'объект', 'объекта', 'объектов')}</span>
                ${pages > 1 ? html`<wa-pagination .total=${this.total} page-size=${PAGE_SIZE} .page=${st.page} with-summary
                    @wa-page-change=${e => this.set({ page: e.target.page })}></wa-pagination>` : nothing}
            </div>
            ${this.picker()}`;
    }
}

customElements.define('work-object-list', WorkObjectList);
