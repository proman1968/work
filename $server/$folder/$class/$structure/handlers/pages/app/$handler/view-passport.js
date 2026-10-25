/**
 * Паспорт класса из ядра: слой, права места, схема (`db_schema`) и число объектов (`db_query`).
 * Показывается там, где нет списка объектов: у счетов и журналов (отчёты — день 8) и подразделений.
 */
import { html, css, nothing } from '/vendor/lit/lit.js';
import { WorkElement } from './base.js';
import { app } from './store.js';
import { ACCESS_LABELS, SCOPE_LABELS, FAMILIES, findNode, scopeOf } from './menu.js';
import './icon.js';

const FIELD_TYPES = { string: 'Строка', text: 'Текст', number: 'Число', money: 'Деньги', integer: 'Целое', boolean: 'Да/нет', date: 'Дата', datetime: 'Дата и время', link: 'Ссылка', table: 'Таблица', enum: 'Список', file: 'Файл' };

export class WorkPassport extends WorkElement {
    static properties = {
        path: { type: String },
        info: { state: true },
        failure: { state: true },
    };

    static styles = css`
        :host { display: block; max-width: 72rem; margin: 0 auto; padding: var(--wa-space-l); box-sizing: border-box; }
        header { display: flex; align-items: center; gap: var(--wa-space-m); margin-bottom: var(--wa-space-m); }
        .badge-icon { display: grid; place-items: center; flex: none; width: 3rem; height: 3rem; font-size: 1.5rem; border-radius: var(--wa-border-radius-l); background: var(--wa-color-brand-fill-quiet); color: var(--wa-color-brand-on-quiet); }
        h1 { margin: 0; font-family: var(--wa-font-family-heading); font-size: var(--wa-font-size-2xl); line-height: 1.15; }
        .tags { display: flex; flex-wrap: wrap; gap: var(--wa-space-xs); margin-top: var(--wa-space-xs); }
        h2 { margin: var(--wa-space-l) 0 var(--wa-space-s); font-size: var(--wa-font-size-l); font-family: var(--wa-font-family-heading); }
        table { width: 100%; border-collapse: collapse; background: var(--wa-color-surface-default); border: 1px solid var(--wa-color-surface-border); border-radius: var(--wa-border-radius-l); overflow: hidden; }
        th, td { padding: var(--wa-space-xs) var(--wa-space-m); text-align: left; border-bottom: 1px solid var(--wa-color-surface-border); }
        th { font-size: var(--wa-font-size-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--wa-color-text-quiet); background: var(--wa-color-surface-lowered); font-weight: 600; }
        tr:last-child td { border-bottom: 0; }
        code { font-family: var(--wa-font-family-code); font-size: var(--wa-font-size-s); color: var(--wa-color-text-quiet); }
        .stats { display: flex; gap: var(--wa-space-xl); margin: var(--wa-space-m) 0; }
        .stat b { display: block; font-size: var(--wa-font-size-2xl); font-family: var(--wa-font-family-heading); line-height: 1.1; }
        .stat span { color: var(--wa-color-text-quiet); font-size: var(--wa-font-size-s); }
        .soon { margin-top: var(--wa-space-l); }
        .loading { display: grid; place-items: center; padding: var(--wa-space-4xl); }
    `;

    constructor() {
        super();
        this.info = null;
        this.failure = null;
    }

    willUpdate(changed) {
        if (changed.has('path'))
            this.fetchInfo();
    }

    async fetchInfo() {
        const path = this.path;
        this.info = null;
        this.failure = null;
        const [schema, query] = await Promise.allSettled([
            app.api.schema(path),
            app.api.query(path, { limit: 1, deep: true }),
        ]);
        if (path !== this.path)
            return;
        if (schema.status === 'rejected') {
            this.failure = schema.reason;
            return;
        }
        this.info = {
            schema: schema.value.schema,
            errors: schema.value.errors ?? [],
            total: query.status === 'fulfilled' ? query.value.total : null,
        };
    }

    render() {
        const node = findNode(app.sections, this.path);
        const cls = app.ws.classes[this.path] ?? node;
        if (!cls)
            return html`<wa-callout variant="warning"><work-icon slot="icon" name="carbon:warning"></work-icon>
                Класс «${this.path}» не входит в меню этого места.</wa-callout>`;
        const family = FAMILIES.find(f => f.id === cls.family);
        const s = this.info?.schema;
        return html`
            <header>
                <div class="badge-icon"><work-icon name=${cls.icon || 'carbon:folders'}></work-icon></div>
                <div>
                    <h1>${cls.label}</h1>
                    <div class="tags">
                        <wa-badge appearance="outlined" variant="brand">${family?.label ?? cls.family}</wa-badge>
                        ${node ? html`
                            <wa-badge appearance="outlined" variant=${node.access === 'read' ? 'neutral' : 'success'}>${ACCESS_LABELS[node.access]}</wa-badge>
                            <wa-badge appearance="outlined" variant="neutral">данные: ${SCOPE_LABELS[scopeOf(cls.family, node.scope)]}</wa-badge>` : nothing}
                        <code>${this.path}</code>
                    </div>
                </div>
            </header>
            ${this.failure ? html`<wa-callout variant="danger"><work-icon slot="icon" name="carbon:warning"></work-icon>${this.failure.message}</wa-callout>`
                : !this.info ? html`<div class="loading"><wa-spinner style="font-size: 2rem"></wa-spinner></div>`
                : html`
                    <div class="stats">
                        ${this.info.total != null ? html`<div class="stat"><b>${this.info.total}</b><span>объектов</span></div>` : nothing}
                        <div class="stat"><b>${(s?.fields ?? []).length}</b><span>полей</span></div>
                        ${s?.postings?.length ? html`<div class="stat"><b>${s.postings.length}</b><span>правил проводок</span></div>` : nothing}
                    </div>
                    ${this.info.errors.length ? html`<wa-callout variant="warning"><work-icon slot="icon" name="carbon:warning"></work-icon>
                        Ошибки конфигурации: ${this.info.errors.join('; ')}</wa-callout>` : nothing}
                    ${(s?.fields ?? []).length ? html`
                        <h2>Поля</h2>
                        <table>
                            <thead><tr><th>Название</th><th>Тип</th><th>Код</th></tr></thead>
                            <tbody>${s.fields.map(f => html`<tr>
                                <td>${f.label || f.id}${f.required ? html` <span title="Обязательное">*</span>` : nothing}</td>
                                <td>${FIELD_TYPES[f.type] ?? f.type}</td><td><code>${f.id}</code></td></tr>`)}</tbody>
                        </table>` : nothing}`}
            <wa-callout class="soon" variant="neutral"><work-icon slot="icon" name="carbon:information"></work-icon>
                Журнал, оборотно-сальдовая ведомость и карточка счёта появятся на следующем шаге плана (отчёты).</wa-callout>`;
    }
}

customElements.define('work-passport', WorkPassport);
