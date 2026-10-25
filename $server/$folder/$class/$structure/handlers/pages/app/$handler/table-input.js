/**
 * `<work-table-input>` — табличная часть объекта: строки с вложенными полями (в том числе ссылками),
 * добавить, дублировать и удалить строку, итоги по числовым колонкам, нарушения сервера по ячейкам
 * (`lines[2].qty`). Событие `field-change`: `detail` `{ value: строки, names? }`.
 */
import { LitElement, html, css, nothing } from '/vendor/lit/lit.js';
import { fieldLabel, columnTotals, formatNumber, formatMoney, rowPath, emptyRow } from './fields.js';
import './field-input.js';
import './icon.js';

export class WorkTableInput extends LitElement {
    static properties = {
        field: { attribute: false },
        rows: { attribute: false },
        errors: { attribute: false },
        names: { attribute: false },
        at: { type: Number },
        disabled: { type: Boolean },
    };

    static styles = css`
        :host { display: block; }
        .head { display: flex; align-items: center; gap: var(--wa-space-s); margin-bottom: var(--wa-space-xs); }
        .head b { font-family: var(--wa-font-family-heading); }
        .req { color: var(--wa-color-danger-fill-loud); }
        .grow { flex: 1; }
        table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--wa-color-surface-border); border-radius: var(--wa-border-radius-l); background: var(--wa-color-surface-default); }
        th, td { padding: var(--wa-space-2xs) var(--wa-space-xs); vertical-align: top; border-bottom: 1px solid var(--wa-color-surface-border); text-align: left; }
        th { font-size: var(--wa-font-size-xs); letter-spacing: 0.04em; text-transform: uppercase; color: var(--wa-color-text-quiet); background: var(--wa-color-surface-lowered); font-weight: 600; white-space: nowrap; }
        tr:last-child td { border-bottom: 0; }
        td.n { width: 2.5rem; text-align: right; color: var(--wa-color-text-quiet); padding-top: var(--wa-space-s); }
        td.act { width: 5rem; white-space: nowrap; text-align: right; }
        tfoot td { background: var(--wa-color-surface-lowered); font-weight: 600; text-align: right; border-bottom: 0; padding: var(--wa-space-xs); }
        tfoot td:first-child { text-align: left; }
        .err { color: var(--wa-color-danger-on-quiet, var(--wa-color-danger-fill-loud)); font-size: var(--wa-font-size-s); margin-top: var(--wa-space-3xs); }
        .empty { padding: var(--wa-space-m); color: var(--wa-color-text-quiet); text-align: center; }
        .bad { border-color: var(--wa-color-danger-border-loud, var(--wa-color-danger-fill-loud)); }
        .wide { overflow-x: auto; }
        td work-field { min-width: 8rem; }
    `;

    /** Строки с учётом правки, которую форма ещё не вернула обратно (две правки подряд до перерисовки не теряются). */
    get list() {
        const rows = this._pending ?? this.rows;
        return Array.isArray(rows) ? rows : [];
    }

    updated(changed) {
        if (changed.has('rows'))
            this._pending = null;
    }

    emit(rows, names) {
        this._pending = rows;
        this.dispatchEvent(new CustomEvent('field-change', { bubbles: true, composed: true, detail: { value: rows, ...(names ? { names } : {}) } }));
    }

    setCell(index, id, detail) {
        const rows = this.list.map((r, i) => (i === index ? { ...r, [id]: detail.value } : r));
        this.emit(rows, detail.names);
    }

    add() {
        this.emit([...this.list, emptyRow()]);
    }

    remove(index) {
        this.emit(this.list.filter((_, i) => i !== index));
    }

    duplicate(index) {
        const rows = [...this.list];
        rows.splice(index + 1, 0, { ...rows[index] });
        this.emit(rows);
    }

    totals() {
        const cols = this.field.fields;
        const sums = columnTotals(cols, this.list);
        if (!Object.keys(sums).length)
            return nothing;
        return html`<tfoot><tr><td>Итого</td>${cols.map(f => html`<td>${f.id in sums ? (f.type === 'money' ? formatMoney(sums[f.id]) : formatNumber(sums[f.id])) : ''}</td>`)}<td></td></tr></tfoot>`;
    }

    render() {
        const f = this.field;
        const cols = f.fields ?? [];
        const err = this.errors?.[f.id];
        return html`
            <div class="head">
                <b>${fieldLabel(f)}${f.required ? html` <span class="req">*</span>` : nothing}</b>
                <span class="grow"></span>
                ${this.disabled ? nothing : html`<wa-button size="s" appearance="outlined" variant="brand" @click=${this.add}>
                    <work-icon slot="start" name="carbon:add"></work-icon>Добавить строку</wa-button>`}
            </div>
            <div class="wide">
                <table class=${err ? 'bad' : ''}>
                    <thead><tr><th>№</th>${cols.map(c => html`<th>${fieldLabel(c)}${c.required ? html` <span class="req">*</span>` : nothing}</th>`)}${this.disabled ? nothing : html`<th></th>`}</tr></thead>
                    <tbody>
                        ${this.list.length ? this.list.map((row, i) => html`<tr>
                            <td class="n">${i + 1}</td>
                            ${cols.map(c => html`<td><work-field compact .field=${c} .value=${row[c.id]} .names=${this.names} .at=${this.at}
                                .error=${this.errors?.[rowPath(f.id, i, c.id)] ?? ''} ?disabled=${this.disabled}
                                @field-change=${e => { e.stopPropagation(); this.setCell(i, c.id, e.detail); }}></work-field></td>`)}
                            ${this.disabled ? nothing : html`<td class="act">
                                <wa-button appearance="plain" size="s" variant="neutral" title="Дублировать строку" @click=${() => this.duplicate(i)}><work-icon name="carbon:copy" label="Дублировать"></work-icon></wa-button>
                                <wa-button appearance="plain" size="s" variant="danger" title="Удалить строку" @click=${() => this.remove(i)}><work-icon name="carbon:trash-can" label="Удалить"></work-icon></wa-button>
                            </td>`}
                        </tr>`) : html`<tr><td colspan=${cols.length + 2} class="empty">Строк нет</td></tr>`}
                    </tbody>
                    ${this.totals()}
                </table>
            </div>
            ${err ? html`<div class="err">${err}</div>` : nothing}`;
    }
}

customElements.define('work-table-input', WorkTableInput);
