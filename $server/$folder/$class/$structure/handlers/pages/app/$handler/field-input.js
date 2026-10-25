/**
 * `<work-field>` — один ввод по типу поля схемы (строка, текст, число, деньги, да/нет, дата, список,
 * ссылка). Не знает про форму: получает `field`, `value`, `error`, отдаёт `field-change` с `detail`
 * `{ value, names? }` (`names` — название выбранного объекта ссылки: форма хранит их для показа).
 * Таблицы рисует `<work-table-input>`.
 */
import { LitElement, html, css, nothing } from '/vendor/lit/lit.js';
import { inputKind, enumOptions, fieldLabel } from './fields.js';
import './link-input.js';

export class WorkField extends LitElement {
    static properties = {
        field: { attribute: false },
        value: { attribute: false },
        error: { type: String },
        disabled: { type: Boolean },
        names: { attribute: false },
        at: { type: Number },
        compact: { type: Boolean },
    };

    static styles = css`
        :host { display: block; min-width: 0; }
        wa-input, wa-textarea, wa-select { width: 100%; }
        .err { color: var(--wa-color-danger-on-quiet, var(--wa-color-danger-fill-loud)); font-size: var(--wa-font-size-s); margin-top: var(--wa-space-3xs); }
        .bad::part(base) { border-color: var(--wa-color-danger-border-loud, var(--wa-color-danger-fill-loud)); }
        .bad { --wa-form-control-border-color: var(--wa-color-danger-border-loud, var(--wa-color-danger-fill-loud)); }
        wa-checkbox { padding: var(--wa-space-xs) 0; }
    `;

    emit(value, names) {
        this.dispatchEvent(new CustomEvent('field-change', { bubbles: true, composed: true, detail: { value, ...(names ? { names } : {}) } }));
    }

    control() {
        // в ячейке таблицы обязательность видна в заголовке колонки: звёздочка поля без подписи только мешает
        const f = this.compact ? { ...this.field, required: false } : this.field;
        const label = this.compact ? undefined : fieldLabel(f);
        const bad = this.error ? 'bad' : '';
        const v = this.value;
        const common = { label, disabled: this.disabled };
        switch (inputKind(f)) {
            case 'textarea':
                return html`<wa-textarea class=${bad} label=${label ?? nothing} rows="3" resize="auto" ?required=${f.required} ?disabled=${this.disabled}
                    .value=${v ?? ''} @input=${e => this.emit(e.target.value)}></wa-textarea>`;
            case 'number':
                return html`<wa-input class=${bad} label=${label ?? nothing} type="number" step=${f.type === 'integer' ? '1' : 'any'} inputmode="decimal"
                    ?required=${f.required} ?disabled=${this.disabled} .value=${v ?? ''} @input=${e => this.emit(e.target.value)}></wa-input>`;
            case 'boolean':
                return html`<wa-checkbox class=${bad} ?checked=${v === true || v === 'true'} ?disabled=${this.disabled}
                    @change=${e => this.emit(e.target.checked)}>${label ?? ''}</wa-checkbox>`;
            case 'date':
                return html`<wa-input class=${bad} label=${label ?? nothing} type="date" ?required=${f.required} ?disabled=${this.disabled}
                    .value=${v ?? ''} @input=${e => this.emit(e.target.value)}></wa-input>`;
            case 'datetime':
                return html`<wa-input class=${bad} label=${label ?? nothing} type="datetime-local" ?required=${f.required} ?disabled=${this.disabled}
                    .value=${v ?? ''} @input=${e => this.emit(e.target.value)}></wa-input>`;
            case 'enum':
                return html`<wa-select class=${bad} label=${label ?? nothing} ?required=${f.required} ?disabled=${this.disabled} placeholder="—"
                    .value=${v ?? ''} @change=${e => this.emit(e.target.value)}>
                    ${f.required ? nothing : html`<wa-option value="">—</wa-option>`}
                    ${enumOptions(f).map(o => html`<wa-option value=${o.value}>${o.label}</wa-option>`)}
                </wa-select>`;
            case 'link':
                return html`<work-link-input class=${bad} .field=${f} .value=${v ?? ''} .caption=${this.names?.[v] ?? ''} .at=${this.at}
                    label=${common.label ?? nothing} ?required=${f.required} ?disabled=${this.disabled}
                    @link-change=${e => { e.stopPropagation(); this.emit(e.detail.value, e.detail.value ? { [e.detail.value]: e.detail.title } : undefined); }}></work-link-input>`;
            default:
                return html`<wa-input class=${bad} label=${label ?? nothing} ?required=${f.required} ?disabled=${this.disabled}
                    .value=${v ?? ''} @input=${e => this.emit(e.target.value)}></wa-input>`;
        }
    }

    render() {
        return html`${this.control()}${this.error ? html`<div class="err">${this.error}</div>` : nothing}`;
    }
}

customElements.define('work-field', WorkField);
