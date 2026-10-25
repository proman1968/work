/**
 * `<work-link-input>` — выбор объекта для поля-ссылки (`db_choices`): поиск по началам слов; у
 * виртуального справочника без поиска — состав на дату операции (`at`), с поиском к нему
 * примешивается реестр (новый покупатель находится), «показать всех» расширяет выбор; не нашлось —
 * «создать» в окне с формой класса (`work-object-form` в режиме `embedded`).
 *
 * Событие `link-change`: `detail` `{ value, title }` (пустое `value` — очистка).
 */
import { LitElement, html, css, nothing } from '/vendor/lit/lit.js';
import { app } from './store.js';
import './icon.js';

const LIMIT = 30;
const DELAY = 220;

export class WorkLinkInput extends LitElement {
    static properties = {
        field: { attribute: false },
        value: { type: String },
        caption: { type: String },
        label: { type: String },
        at: { type: Number },
        required: { type: Boolean },
        disabled: { type: Boolean },
        open: { state: true },
        search: { state: true },
        result: { state: true },
        busy: { state: true },
        all: { state: true },
        failure: { state: true },
        creating: { state: true },
    };

    static styles = css`
        :host { display: block; min-width: 0; }
        wa-input { width: 100%; }
        .list { box-sizing: border-box; max-height: 18rem; overflow: auto; background: var(--wa-color-surface-raised, var(--wa-color-surface-default)); border: 1px solid var(--wa-color-surface-border); border-radius: var(--wa-border-radius-m); box-shadow: var(--wa-shadow-l); padding: var(--wa-space-3xs); z-index: 20; }
        .item { display: flex; align-items: center; gap: var(--wa-space-s); width: 100%; padding: var(--wa-space-xs) var(--wa-space-s); border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; border-radius: var(--wa-border-radius-s); }
        .item:hover, .item.active { background: var(--wa-color-brand-fill-quiet); }
        .item .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .note { padding: var(--wa-space-xs) var(--wa-space-s); color: var(--wa-color-text-quiet); font-size: var(--wa-font-size-s); }
        .more { color: var(--wa-color-brand-on-quiet); }
        .out { font-size: var(--wa-font-size-xs); color: var(--wa-color-text-quiet); }
        wa-dialog { --width: 40rem; }
        .kinds { display: flex; flex-wrap: wrap; gap: var(--wa-space-xs); margin-bottom: var(--wa-space-m); }
    `;

    constructor() {
        super();
        this.open = false;
        this.search = '';
        this.result = null;
        this.all = false;
        this.active = -1;
        this.creating = null;
    }

    get target() {
        return this.field?.targetPath || this.field?.target || '';
    }

    get items() {
        return this.result?.items ?? [];
    }

    openList() {
        if (this.disabled || this.open)
            return;
        this.open = true;
        this.search = '';
        this.all = false;
        this.fetch(0);
    }

    closeList() {
        this.open = false;
        clearTimeout(this._timer);
    }

    onInput(e) {
        this.search = e.target.value;
        this.open = true;
        this.active = -1;
        this.fetch(DELAY);
    }

    fetch(delay) {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.load(), delay);
    }

    async load() {
        const seq = this._seq = (this._seq ?? 0) + 1;
        this.busy = true;
        this.failure = null;
        try {
            const res = await app.api.choices(this.target, { search: this.search.trim(), at: this.at, all: this.all, limit: LIMIT });
            if (seq !== this._seq)
                return;
            this.result = res;
        }
        catch (e) {
            if (seq === this._seq)
                this.failure = e;
        }
        finally {
            if (seq === this._seq)
                this.busy = false;
        }
    }

    choose(item) {
        this.dispatchEvent(new CustomEvent('link-change', { bubbles: true, composed: true, detail: { value: item?.id ?? '', title: item?.title ?? '' } }));
        this.closeList();
    }

    onKey(e) {
        const n = this.items.length;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            this.openList();
            this.active = n ? (this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n : -1;
        }
        else if (e.key === 'Enter' && this.open && this.items[this.active]) {
            e.preventDefault();
            this.choose(this.items[this.active]);
        }
        else if (e.key === 'Escape')
            this.closeList();
    }

    showAll() {
        this.all = true;
        this.load();
    }

    async startCreate(kinds) {
        const seed = this.search.trim();
        this.closeList();
        await import('./obj-form.js');
        this.creating = { kinds, cls: kinds[0].path, seed };
    }

    created(e) {
        e.stopPropagation();
        const { id, title } = e.detail;
        this.creating = null;
        this.choose({ id, title });
    }

    list() {
        const r = this.result;
        const q = this.search.trim();
        return html`<div class="list" @mousedown=${e => e.preventDefault()}>
            ${this.failure ? html`<div class="note">${this.failure.message}</div>` : nothing}
            ${this.items.map((it, i) => html`<button class="item ${i === this.active ? 'active' : ''}" @click=${() => this.choose(it)}>
                <span class="t">${it.title || it.id}</span>
                ${r.virtual && !it.member ? html`<span class="out">не в составе</span>` : nothing}
            </button>`)}
            ${!this.items.length && !this.busy && !this.failure ? html`<div class="note">${q ? 'Ничего не найдено' : 'Пока нет вариантов'}</div>` : nothing}
            ${this.busy && !this.items.length ? html`<div class="note">Загрузка…</div>` : nothing}
            ${r?.virtual && r.others > 0 && !q && !this.all ? html`<button class="item more" @click=${this.showAll}>Показать всех (ещё ${r.others})</button>` : nothing}
            ${r?.create?.length && !this.busy ? html`<button class="item more" @click=${() => this.startCreate(r.create)}>
                <work-icon name="carbon:add"></work-icon>${q ? `Создать «${q}»…` : 'Создать…'}</button>` : nothing}
        </div>`;
    }

    dialog() {
        const c = this.creating;
        if (!c)
            return nothing;
        return html`<wa-dialog open label="Новый объект" light-dismiss @wa-after-hide=${e => { if (e.target === e.currentTarget) this.creating = null; }}>
            ${c.kinds.length > 1 ? html`<div class="kinds">${c.kinds.map(k => html`
                <wa-button size="s" appearance=${k.path === c.cls ? 'accent' : 'outlined'} variant="neutral" @click=${() => { this.creating = { ...c, cls: k.path }; }}>${k.label}</wa-button>`)}</div>` : nothing}
            ${c.kinds.map(k => (k.path === c.cls ? html`<work-object-form embedded .path=${k.path} .cls=${k.path} .objectId=${'new'} .seed=${c.seed}
                @object-saved=${e => this.created(e)}></work-object-form>` : nothing))}
        </wa-dialog>`;
    }

    render() {
        return html`
            <wa-input id="box" label=${this.label ?? nothing} placeholder="Выбрать…" autocomplete="off" ?required=${this.required} ?disabled=${this.disabled}
                .value=${this.open ? this.search : (this.caption || (this.value ? '…' : ''))}
                @focus=${this.openList} @click=${this.openList} @input=${this.onInput} @keydown=${this.onKey} @blur=${() => setTimeout(() => this.closeList(), 120)}>
                ${this.value && !this.disabled ? html`<wa-button slot="end" appearance="plain" variant="neutral" size="s" title="Очистить"
                    @mousedown=${e => e.preventDefault()} @click=${() => this.choose(null)}><work-icon name="carbon:close" label="Очистить"></work-icon></wa-button>` : nothing}
            </wa-input>
            <wa-popup anchor="box" placement="bottom-start" sync="width" flip shift ?active=${this.open}>${this.open ? this.list() : nothing}</wa-popup>
            ${this.dialog()}`;
    }
}

customElements.define('work-link-input', WorkLinkInput);
