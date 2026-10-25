/**
 * `<work-members>` — состав виртуального справочника («Клиенты», «Сотрудники») на сегодня: объекты
 * реестра-источника с ненулевым сальдо (`db_members`), их сальдо и поля записей-расширений. Только
 * чтение: состав задаёт учёт, а объекты правятся в реестре-источнике.
 */
import { html, css, nothing } from '/vendor/lit/lit.js';
import { WorkElement } from './base.js';
import { app } from './store.js';
import { ACCESS_LABELS } from './menu.js';
import { formatValue, formatMoney, fieldLabel, plural } from './fields.js';
import './icon.js';

export class WorkMembers extends WorkElement {
    static properties = {
        path: { type: String },
        node: { attribute: false },
        schema: { attribute: false },
        data: { state: true },
        failure: { state: true },
        query: { state: true },
    };

    static styles = css`
        :host { display: block; max-width: 72rem; margin: 0 auto; padding: var(--wa-space-l); box-sizing: border-box; }
        header { display: flex; align-items: center; gap: var(--wa-space-m); margin-bottom: var(--wa-space-m); }
        .badge-icon { display: grid; place-items: center; width: 3rem; height: 3rem; font-size: 1.5rem; border-radius: var(--wa-border-radius-l); background: var(--wa-color-brand-fill-quiet); color: var(--wa-color-brand-on-quiet); }
        h1 { margin: 0; font-family: var(--wa-font-family-heading); font-size: var(--wa-font-size-2xl); }
        .hint { color: var(--wa-color-text-quiet); font-size: var(--wa-font-size-s); margin: var(--wa-space-3xs) 0 0; }
        wa-input { max-width: 24rem; margin-bottom: var(--wa-space-m); }
        .wrap { background: var(--wa-color-surface-default); border: 1px solid var(--wa-color-surface-border); border-radius: var(--wa-border-radius-l); overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: var(--wa-space-xs) var(--wa-space-m); text-align: left; border-bottom: 1px solid var(--wa-color-surface-border); white-space: nowrap; }
        th { font-size: var(--wa-font-size-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--wa-color-text-quiet); background: var(--wa-color-surface-lowered); font-weight: 600; }
        td.num { text-align: right; font-variant-numeric: tabular-nums; }
        tr:last-child td { border-bottom: 0; }
        .empty, .loading { padding: var(--wa-space-3xl); text-align: center; color: var(--wa-color-text-quiet); }
    `;

    willUpdate(changed) {
        if (changed.has('path'))
            this.fetch();
    }

    async fetch() {
        const path = this.path;
        this.data = null;
        this.failure = null;
        try {
            const res = await app.api.members(path, {});
            if (path === this.path)
                this.data = res;
        }
        catch (e) {
            if (path === this.path)
                this.failure = e;
        }
    }

    render() {
        const cls = this.node ?? app.ws.classes[this.path];
        const overlay = this.schema?.overlay ?? [];
        const q = (this.query ?? '').trim().toLowerCase();
        const items = (this.data?.items ?? []).filter(m => !q || m.title.toLowerCase().includes(q));
        return html`
            <header>
                <div class="badge-icon"><work-icon name=${cls?.icon || 'carbon:user-multiple'}></work-icon></div>
                <div>
                    <h1>${cls?.label}</h1>
                    <p class="hint">Состав на сегодня по сальдо счёта-источника${this.node ? ` · ${ACCESS_LABELS[this.node.access]}` : ''}${this.data ? ` · реестр «${this.data.registry.label}»` : ''}</p>
                </div>
            </header>
            ${this.failure ? html`<wa-callout variant="danger"><work-icon slot="icon" name="carbon:warning"></work-icon>${this.failure.message}</wa-callout>` : nothing}
            <wa-input label="Поиск" placeholder="Название" with-clear .value=${this.query ?? ''} @input=${e => { this.query = e.target.value; }}></wa-input>
            <div class="wrap">
                ${!this.data && !this.failure ? html`<div class="loading"><wa-spinner style="font-size: 2rem"></wa-spinner></div>` : html`
                    <table>
                        <thead><tr><th>Название</th><th class="num">Сальдо</th>${overlay.map(f => html`<th>${fieldLabel(f)}</th>`)}</tr></thead>
                        <tbody>${items.map(m => html`<tr>
                            <td>${m.title}</td>
                            <td class="num">${formatMoney(m.balance.debit - m.balance.credit)}</td>
                            ${overlay.map(f => html`<td>${formatValue(f, m.ext?.body?.[f.id])}</td>`)}</tr>`)}</tbody>
                    </table>
                    ${items.length ? nothing : html`<div class="empty">В составе никого нет</div>`}`}
            </div>
            ${this.data ? html`<p class="hint">${items.length} ${plural(items.length, 'участник', 'участника', 'участников')}</p>` : nothing}`;
    }
}

customElements.define('work-members', WorkMembers);
