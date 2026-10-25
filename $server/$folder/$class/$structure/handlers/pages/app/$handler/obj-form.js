/**
 * `<work-object-form>` — универсальная форма объекта справочника или операции по схеме (`db_schema`):
 * поля по типам, ссылки с виртуальными справочниками и датой операции, табличные части, ошибки по полям.
 * У операции — действия по статусу «Зарегистрировать / Исправить / Отменить / Печать» и проводки
 * (предпросмотр черновика или действующие). Логика действий и значений — чистые модули
 * (`lifecycle.js`, `fields.js`), здесь только экран.
 *
 * Свойства: `path` (класс вызова — группа или лист), `objectId` (id или 'new'), `cls` (лист нового
 * объекта), `canWrite`, `embedded` (окно создания из ссылки), `seed` (текст для первого поля).
 * События режима `embedded`: `object-saved` (`detail` `{ id, title }`).
 */
import { html, css, nothing } from '/vendor/lit/lit.js';
import { WorkElement } from './base.js';
import { app } from './store.js';
import {
    fieldLabel, toDraft, toBody, pruneDraft, validateDraft, errorMap, toLocalInput, fromLocalInput,
    formatDateTime, formatMoney,
} from './fields.js';
import { formState, statusLabel, statusVariant, pickWriteContext, contextKey } from './lifecycle.js';
import { pathByCid } from './class-tree.js';
import { entryRows, entriesSum } from './entries.js';
import './field-input.js';
import './table-input.js';
import './icon.js';

const TIME_FIELD = Object.freeze({ id: '__time', label: 'Дата операции', type: 'datetime', required: true });
const PREVIEW_DELAY = 700;

/** Сообщение об успехе переживает пересоздание формы: после создания открывается другой адрес, а с ним — новый элемент. */
const flash = { text: '' };

export class WorkObjectForm extends WorkElement {
    static properties = {
        path: { type: String },
        objectId: { type: String },
        cls: { type: String },
        canWrite: { type: Boolean },
        embedded: { type: Boolean },
        seed: { type: String },
        loading: { state: true },
        failure: { state: true },
        schema: { state: true },
        obj: { state: true },
        draft: { state: true },
        time: { state: true },
        names: { state: true },
        errors: { state: true },
        message: { state: true },
        notice: { state: true },
        busy: { state: true },
        entries: { state: true },
        prints: { state: true },
        place: { state: true },
        confirm: { state: true },
    };

    static styles = css`
        :host { display: block; max-width: 72rem; margin: 0 auto; padding: var(--wa-space-l); box-sizing: border-box; }
        :host([embedded]) { padding: 0; max-width: none; }
        header { display: flex; align-items: flex-start; gap: var(--wa-space-m); margin-bottom: var(--wa-space-m); }
        header .grow { flex: 1; min-width: 0; }
        h1 { margin: 0; font-family: var(--wa-font-family-heading); font-size: var(--wa-font-size-2xl); line-height: 1.15; }
        :host([embedded]) h1 { font-size: var(--wa-font-size-l); }
        .tags { display: flex; flex-wrap: wrap; gap: var(--wa-space-xs); margin-top: var(--wa-space-xs); align-items: center; }
        .bar { display: flex; flex-wrap: wrap; gap: var(--wa-space-s); align-items: center; margin-bottom: var(--wa-space-m); position: sticky; top: 0; z-index: 5; padding: var(--wa-space-xs) 0; background: var(--wa-color-surface-lowered, var(--wa-color-surface-default)); }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: var(--wa-space-m); margin-bottom: var(--wa-space-l); align-items: start; }
        .full { grid-column: 1 / -1; }
        .tables { display: grid; gap: var(--wa-space-l); margin-bottom: var(--wa-space-l); }
        h2 { margin: var(--wa-space-l) 0 var(--wa-space-s); font-size: var(--wa-font-size-l); font-family: var(--wa-font-family-heading); display: flex; align-items: center; gap: var(--wa-space-s); }
        wa-callout { margin-bottom: var(--wa-space-m); }
        table.entries { width: 100%; border-collapse: collapse; background: var(--wa-color-surface-default); border: 1px solid var(--wa-color-surface-border); border-radius: var(--wa-border-radius-l); overflow: hidden; }
        .entries th, .entries td { padding: var(--wa-space-xs) var(--wa-space-m); text-align: left; border-bottom: 1px solid var(--wa-color-surface-border); vertical-align: top; }
        .entries th { font-size: var(--wa-font-size-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--wa-color-text-quiet); background: var(--wa-color-surface-lowered); font-weight: 600; }
        .entries tr:last-child td { border-bottom: 0; }
        .entries .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .entries .note { display: block; color: var(--wa-color-text-quiet); font-size: var(--wa-font-size-s); }
        .entries tr.storno td { color: var(--wa-color-danger-on-quiet, var(--wa-color-danger-fill-loud)); }
        .entries tfoot td { font-weight: 600; background: var(--wa-color-surface-lowered); border-bottom: 0; }
        .hint { color: var(--wa-color-text-quiet); font-size: var(--wa-font-size-s); }
        .loading { display: grid; place-items: center; padding: var(--wa-space-4xl); }
        label.place { display: grid; gap: var(--wa-space-3xs); }
        label.place span { font-size: var(--wa-font-size-s); }
        select { font: inherit; padding: var(--wa-space-xs); border-radius: var(--wa-border-radius-m); border: 1px solid var(--wa-color-surface-border); background: var(--wa-color-surface-default); color: inherit; }
    `;

    constructor() {
        super();
        this.errors = {};
        this.names = {};
        this.draft = {};
        this.prints = [];
        this.entries = null;
        this.canWrite = true;
    }

    /* ---------- состояние ---------- */

    get isNew() {
        return this.objectId === 'new';
    }

    get fields() {
        return this.schema?.fields ?? [];
    }

    get isOp() {
        return this.schema?.family === 'operation';
    }

    /** Лист класса объекта: у нового — выбранный, у сохранённого — по `cid`. */
    get leaf() {
        return this._leaf || this.cls || this.path;
    }

    get dirty() {
        return this.isNew || JSON.stringify({ d: this.draft, t: this.time }) !== this._baseline;
    }

    get at() {
        return this.isOp ? fromLocalInput(this.time) ?? undefined : undefined;
    }

    get state() {
        return formState({
            family: this.schema?.family, status: this.obj?.status ?? '', isNew: this.isNew, canWrite: this.canWrite !== false,
            autoRegister: !!this.schema?.autoRegister, dirty: this.dirty, hasPrints: this.prints.length > 0,
        });
    }

    willUpdate(changed) {
        if (changed.has('path') || changed.has('objectId') || changed.has('cls'))
            this.load();
        else if ((changed.has('draft') || changed.has('time')) && this.schema && this.isOp && this.previewMode)
            this.schedulePreview();
    }

    get previewMode() {
        return this.isNew || this.obj?.status === 'draft';
    }

    /* ---------- загрузка ---------- */

    async load() {
        const seq = this._seq = (this._seq ?? 0) + 1;
        this.loading = true;
        this.failure = null;
        this.message = '';
        this.errors = {};
        this.entries = null;
        this.prints = [];
        this.confirm = '';
        clearTimeout(this._preview);
        try {
            let obj = null;
            let leaf = this.cls || this.path;
            if (!this.isNew) {
                obj = await app.api.read(this.path, this.objectId);
                if (!obj)
                    throw new Error('Объект не найден');
                leaf = pathByCid(app.ws.classes, obj.cid) ?? this.path;
            }
            const { schema } = await app.schema(leaf);
            if (seq !== this._seq)
                return;
            this._leaf = leaf;
            this.schema = schema;
            this.obj = obj;
            this.names = { ...(obj?.names ?? {}) };
            this.draft = obj ? toDraft(schema.fields, obj.body) : this.seeded(schema);
            this.time = schema.family === 'operation' ? toLocalInput(obj?.time ?? Date.now()) : '';
            this._baseline = JSON.stringify({ d: this.draft, t: this.time });
            this.notice = flash.text ?? '';
            flash.text = '';
            if (this.isNew && this.canWrite !== false)
                this.place = pickWriteContext((await app.api.scope(leaf).catch(() => ({ contexts: [] }))).contexts, app.ctx);
            else
                this.place = null;
            this.loading = false;
            if (schema.family === 'operation') {
                this.loadPrints();
                this.loadEntries();
            }
        }
        catch (e) {
            if (seq === this._seq) {
                this.failure = e;
                this.loading = false;
            }
        }
    }

    seeded(schema) {
        const f = schema.fields.find(x => x.type === 'string' && x.required) ?? schema.fields.find(x => x.type === 'string');
        return this.seed && f ? { [f.id]: this.seed } : {};
    }

    async loadPrints() {
        try {
            const list = this.isNew ? [] : await app.api.printList(this.leaf, this.obj.id);
            this.prints = Array.isArray(list) ? list : [];
        }
        catch {
            this.prints = [];
        }
    }

    async loadEntries() {
        const seq = this._entriesSeq = (this._entriesSeq ?? 0) + 1;
        const status = this.obj?.status;
        try {
            let res;
            if (status === 'registered' || status === 'cancelled') {
                const j = await app.api.journal(this.leaf, { op: this.obj.id, effective: status === 'registered', limit: 500 });
                res = { kind: status === 'registered' ? 'posted' : 'history', items: j.items, names: j.names, errors: [] };
            }
            else {
                const body = toBody(this.fields, pruneDraft(this.fields, this.draft));
                const saved = !this.isNew && !this.dirty;
                const p = await app.api.preview(this.leaf, saved ? { id: this.obj.id } : { body, time: this.at });
                res = { kind: 'preview', items: p.entries, names: p.names, errors: p.errors ?? [] };
            }
            if (seq === this._entriesSeq)
                this.entries = res;
        }
        catch (e) {
            if (seq === this._entriesSeq)
                this.entries = { kind: 'unavailable', items: [], names: {}, errors: [], reason: e.message };
        }
    }

    schedulePreview() {
        clearTimeout(this._preview);
        this._preview = setTimeout(() => this.loadEntries(), PREVIEW_DELAY);
    }

    /* ---------- ввод ---------- */

    change(f, detail) {
        this.draft = { ...this.draft, [f.id]: detail.value };
        if (detail.names)
            this.names = { ...this.names, ...detail.names };
        const errors = { ...this.errors };
        for (const k of Object.keys(errors))
            if (k === f.id || (f.type === 'table' && k.startsWith(f.id + '[')))
                delete errors[k];
        this.errors = errors;
        this.notice = '';
    }

    /* ---------- действия ---------- */

    fail(e) {
        const map = errorMap(e.errors ?? []);
        if (Object.keys(map).length) {
            this.errors = map;
            this.message = map[''] || 'Исправьте отмеченные поля';
        }
        else
            this.message = e.message;
    }

    async run(action) {
        this.message = '';
        this.notice = '';
        if (action === 'print')
            return;
        if (action === 'cancel' || action === 'delete') {
            this.confirm = action;
            return;
        }
        const editing = ['save', 'create', 'register', 'correct'].includes(action);
        const draft = editing ? pruneDraft(this.fields, this.draft) : this.draft;
        if (editing) {
            this.draft = draft;
            const errors = validateDraft(this.fields, draft);
            if (!draft || Object.keys(errors).length) {
                this.errors = errors;
                this.message = 'Заполните обязательные поля';
                return;
            }
            this.errors = {};
        }
        await this.execute(action, draft);
    }

    async execute(action, draft) {
        this.busy = action;
        const api = app.api;
        const leaf = this.leaf;
        let saved = this.obj;
        let created = false;
        try {
            const body = toBody(this.fields, draft);
            const time = this.isOp ? { time: fromLocalInput(this.time) } : {};
            switch (action) {
                case 'save': case 'create': case 'register':
                    if (this.isNew) {
                        saved = await api.create(leaf, body, { ...time, ...(this.place?.chosen ?? {}) });
                        created = true;
                    }
                    else if (this.dirty)
                        saved = await api.update(leaf, saved.id, body, { version: saved.version, ...time });
                    if (action === 'register')
                        saved = await api.register(leaf, saved.id, saved.version);
                    flash.text = action === 'register' ? 'Операция зарегистрирована' : created ? 'Создано' : 'Сохранено';
                    break;
                case 'correct':
                    saved = await api.correct(leaf, saved.id, body, { version: saved.version, ...time });
                    flash.text = 'Операция исправлена: прежние проводки сторнированы, новые созданы';
                    break;
                case 'cancel':
                    saved = await api.cancel(leaf, saved.id, saved.version);
                    flash.text = 'Операция отменена: проводки сторнированы';
                    break;
                case 'delete':
                    await api.remove(leaf, saved.id, saved.version);
                    this.busy = '';
                    return this.back();
                case 'restore':
                    saved = await api.restore(leaf, saved.id);
                    flash.text = 'Восстановлено';
                    break;
                default:
                    return;
            }
            this.busy = '';
            this.saved(saved, created);
        }
        catch (e) {
            this.busy = '';
            flash.text = '';
            if (created)
                this.saved(saved, true);
            this.fail(e);
        }
    }

    /** Объект записан: окно создания сообщает ссылке, экран — открывает созданный или перечитывает. */
    saved(obj, created) {
        if (this.embedded) {
            this.dispatchEvent(new CustomEvent('object-saved', { bubbles: true, composed: true, detail: { id: obj.id, title: obj.title || this.schema?.label } }));
            return;
        }
        if (created || this.isNew)
            app.go({ id: obj.id, params: this.withoutCls() });
        else
            this.load();
    }

    withoutCls() {
        const { cls, ...rest } = app.route.params ?? {};
        return rest;
    }

    back() {
        app.go({ id: '', params: this.withoutCls() });
    }

    async printForm(name) {
        const w = window.open('', '_blank');
        try {
            const res = await app.api.print(this.leaf, this.obj.id, name);
            w.document.open();
            w.document.write(res.html);
            w.document.close();
        }
        catch (e) {
            w?.close();
            this.message = e.message;
        }
    }

    /* ---------- экран ---------- */

    heading() {
        const label = this.schema.label;
        if (this.isNew)
            return `Новый объект: ${label}`;
        const date = this.isOp && this.obj.time ? ` от ${formatDateTime(this.obj.time)}` : '';
        return `${this.obj.title || label}${date}`;
    }

    actions() {
        const { actions } = this.state;
        return html`<div class="bar">
            ${this.embedded ? nothing : html`<wa-button appearance="outlined" variant="neutral" @click=${this.back}>
                <work-icon slot="start" name="carbon:arrow-left"></work-icon>К списку</wa-button>`}
            ${actions.filter(a => a.id !== 'print').map(a => html`<wa-button variant=${a.variant} appearance=${a.primary ? 'accent' : 'outlined'}
                ?disabled=${!a.enabled || !!this.busy} ?loading=${this.busy === a.id} data-action=${a.id} @click=${() => this.run(a.id)}>${a.label}</wa-button>`)}
            ${actions.some(a => a.id === 'print') ? this.prints.map(p => html`<wa-button appearance="outlined" variant="neutral" data-action="print" @click=${() => this.printForm(p.name)}>
                <work-icon slot="start" name="carbon:printer"></work-icon>${this.prints.length > 1 ? p.label : 'Печать'}</wa-button>`) : nothing}
        </div>`;
    }

    fieldView(f, editable) {
        const wide = f.type === 'textarea' || f.type === 'text';
        return html`<div class=${wide ? 'full' : ''}><work-field .field=${f} .value=${this.draft[f.id]} .names=${this.names} .at=${this.at}
            .error=${this.errors[f.id] ?? ''} ?disabled=${!editable}
            @field-change=${e => this.change(f, e.detail)}></work-field></div>`;
    }

    placePicker() {
        const p = this.place;
        if (!p?.ask)
            return nothing;
        const cur = contextKey(p.chosen);
        return html`<label class="place full"><span>Место записи</span>
            <select @change=${e => { const o = p.options.find(x => contextKey(x) === e.target.value); this.place = { ...p, chosen: { unit: o.unit, place: o.place } }; }}>
                ${p.options.map(o => html`<option value=${contextKey(o)} ?selected=${contextKey(o) === cur}>${o.label}</option>`)}
            </select></label>`;
    }

    entriesView() {
        const e = this.entries;
        if (!e)
            return html`<div class="hint">Проводки загружаются…</div>`;
        const note = {
            preview: 'Предпросмотр: проводки появятся при регистрации',
            posted: 'Действующие проводки',
            history: 'Операция отменена: все проводки сторнированы (история)',
        }[e.kind];
        const rows = entryRows(e.items, e.names);
        return html`
            <h2>Проводки ${note ? html`<span class="hint">${note}</span>` : nothing}</h2>
            ${e.kind === 'unavailable' ? html`<div class="hint">${this.isNew || this.dirty ? 'Проводки покажутся, когда форма заполнена верно' : e.reason}</div>` : nothing}
            ${e.errors.length ? html`<wa-callout variant="warning"><work-icon slot="icon" name="carbon:warning"></work-icon>${e.errors.map(x => x.message).join('; ')}</wa-callout>` : nothing}
            ${rows.length ? html`<table class="entries">
                <thead><tr><th>Дебет</th><th>Кредит</th><th class="num">Сумма</th><th class="num">Количество</th></tr></thead>
                <tbody>${rows.map(r => html`<tr class=${r.storno ? 'storno' : ''}>
                    <td>${r.debit}${r.debitNote ? html`<span class="note">${r.debitNote}</span>` : nothing}</td>
                    <td>${r.credit}${r.creditNote ? html`<span class="note">${r.creditNote}</span>` : nothing}</td>
                    <td class="num">${r.amountText}</td><td class="num">${r.qty}</td></tr>`)}</tbody>
                <tfoot><tr><td colspan="2">Итого</td><td class="num">${formatMoney(entriesSum(e.items))}</td><td></td></tr></tfoot>
            </table>` : e.kind === 'unavailable' ? nothing : html`<div class="hint">Проводок нет</div>`}`;
    }

    confirmDialog() {
        if (!this.confirm)
            return nothing;
        const cancel = this.confirm === 'cancel';
        return html`<wa-dialog open label=${cancel ? 'Отменить операцию?' : 'Удалить?'} @wa-after-hide=${e => { if (e.target === e.currentTarget) this.confirm = ''; }}>
            ${cancel ? 'Все проводки операции будут сторнированы. Операцию нельзя будет вернуть в работу.' : 'Объект будет помечен удалённым.'}
            <wa-button slot="footer" variant="neutral" appearance="outlined" @click=${() => { this.confirm = ''; }}>Нет</wa-button>
            <wa-button slot="footer" variant="danger" data-action="confirm" @click=${() => { const a = this.confirm; this.confirm = ''; this.execute(a, this.draft); }}>${cancel ? 'Отменить операцию' : 'Удалить'}</wa-button>
        </wa-dialog>`;
    }

    render() {
        if (this.failure)
            return html`<wa-callout variant="danger"><work-icon slot="icon" name="carbon:warning"></work-icon>${this.failure.message}</wa-callout>
                ${this.embedded ? nothing : html`<wa-button appearance="outlined" variant="neutral" @click=${this.back}>К списку</wa-button>`}`;
        if (this.loading || !this.schema)
            return html`<div class="loading"><wa-spinner style="font-size: 2rem"></wa-spinner></div>`;
        const { editable } = this.state;
        const simple = this.fields.filter(f => f.type !== 'table');
        const tables = this.fields.filter(f => f.type === 'table');
        const status = this.obj?.status;
        return html`
            <header>
                <div class="grow">
                    <h1>${this.heading()}</h1>
                    <div class="tags">
                        ${status ? html`<wa-badge variant=${statusVariant(status)}>${statusLabel(status)}</wa-badge>` : html`<wa-badge variant="neutral">Новый</wa-badge>`}
                        <wa-badge appearance="outlined" variant="neutral">${this.schema.label}</wa-badge>
                        ${this.obj ? html`<span class="hint">версия ${this.obj.version}</span>` : nothing}
                        ${this.canWrite === false ? html`<wa-badge appearance="outlined" variant="neutral">только чтение</wa-badge>` : nothing}
                    </div>
                </div>
            </header>
            ${this.actions()}
            ${this.message ? html`<wa-callout variant="danger"><work-icon slot="icon" name="carbon:warning"></work-icon>${this.message}</wa-callout>` : nothing}
            ${this.notice ? html`<wa-callout variant="success"><work-icon slot="icon" name="carbon:checkmark"></work-icon>${this.notice}</wa-callout>` : nothing}
            ${this.errors[''] && this.errors[''] !== this.message ? html`<wa-callout variant="danger">${this.errors['']}</wa-callout>` : nothing}
            <div class="grid">
                ${this.isOp ? html`<div><work-field .field=${TIME_FIELD} .value=${this.time} .error=${''} ?disabled=${!editable}
                    @field-change=${e => { this.time = e.detail.value; this.notice = ''; }}></work-field></div>` : nothing}
                ${simple.map(f => this.fieldView(f, editable))}
                ${this.placePicker()}
            </div>
            ${tables.length ? html`<div class="tables">${tables.map(f => html`<work-table-input .field=${f} .rows=${this.draft[f.id]} .errors=${this.errors} .names=${this.names}
                .at=${this.at} ?disabled=${!editable} @field-change=${e => this.change(f, e.detail)}></work-table-input>`)}</div>` : nothing}
            ${this.isOp ? this.entriesView() : nothing}
            ${this.confirmDialog()}`;
    }
}

customElements.define('work-object-form', WorkObjectForm);
