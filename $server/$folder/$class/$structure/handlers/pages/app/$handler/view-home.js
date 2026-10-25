/**
 * Главная рабочего места: кто и где работает, что доступно (слои меню) и права места —
 * ссылки на классы с доступом и видимостью данных (Р8).
 */
import { html, css, nothing } from '/vendor/lit/lit.js';
import { WorkElement } from './base.js';
import { app } from './store.js';
import { ACCESS_LABELS, SCOPE_LABELS, RIGHTS_LABELS, FAMILIES, scopeOf } from './menu.js';
import './icon.js';

const count = n => n.children.reduce((s, c) => s + count(c), 1);

export class WorkHome extends WorkElement {
    static styles = css`
        :host { display: block; max-width: 72rem; margin: 0 auto; padding: var(--wa-space-l); box-sizing: border-box; }
        header { display: flex; align-items: center; gap: var(--wa-space-m); margin-bottom: var(--wa-space-l); }
        .badge-icon {
            display: grid; place-items: center; flex: none;
            width: 3rem; height: 3rem; font-size: 1.5rem;
            border-radius: var(--wa-border-radius-l);
            background: var(--wa-color-brand-fill-quiet); color: var(--wa-color-brand-on-quiet);
        }
        h1 { margin: 0; font-family: var(--wa-font-family-heading); font-size: var(--wa-font-size-2xl); line-height: 1.15; }
        .sub { margin: var(--wa-space-3xs) 0 0; color: var(--wa-color-text-quiet); }
        .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: var(--wa-space-m); margin-bottom: var(--wa-space-l); }
        wa-card::part(body) { padding: var(--wa-space-m); }
        .card-head { display: flex; align-items: center; gap: var(--wa-space-s); margin-bottom: var(--wa-space-s); font-weight: 600; }
        .card-head .count { margin-left: auto; font-weight: 400; color: var(--wa-color-text-quiet); font-size: var(--wa-font-size-s); }
        ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
        li a {
            display: flex; align-items: center; gap: var(--wa-space-xs);
            padding: var(--wa-space-2xs) var(--wa-space-xs);
            border-radius: var(--wa-border-radius-m);
            color: inherit; text-decoration: none; cursor: pointer;
        }
        li a:hover { background: var(--wa-color-surface-lowered); color: var(--wa-color-brand-on-quiet); }
        h2 { margin: var(--wa-space-l) 0 var(--wa-space-s); font-size: var(--wa-font-size-l); font-family: var(--wa-font-family-heading); }
        table { width: 100%; border-collapse: collapse; background: var(--wa-color-surface-default); border: 1px solid var(--wa-color-surface-border); border-radius: var(--wa-border-radius-l); overflow: hidden; }
        th, td { padding: var(--wa-space-xs) var(--wa-space-m); text-align: left; border-bottom: 1px solid var(--wa-color-surface-border); }
        th { font-size: var(--wa-font-size-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--wa-color-text-quiet); background: var(--wa-color-surface-lowered); font-weight: 600; }
        tr:last-child td { border-bottom: 0; }
        td .cell { display: inline-flex; align-items: center; gap: var(--wa-space-xs); }
        .muted { color: var(--wa-color-text-quiet); }
    `;

    render() {
        const ctx = app.context;
        if (!ctx)
            return nothing;
        const sections = app.sections;
        const links = ctx.links.map(l => ({ ...l, cls: app.ws.classes[l.id] })).filter(l => l.cls);
        return html`
            <header>
                <div class="badge-icon"><work-icon name=${ctx.place?.icon || ctx.unit.icon || 'carbon:building'}></work-icon></div>
                <div>
                    <h1>${ctx.title}</h1>
                    <p class="sub">
                        ${RIGHTS_LABELS[ctx.unit.rights] ?? ''}${ctx.place ? ` · место «${ctx.place.label}»` : ' · сводный вид подразделения'}
                    </p>
                </div>
            </header>
            ${sections.length ? html`<div class="cards">
                ${sections.map(s => html`
                    <wa-card>
                        <div class="card-head">
                            <work-icon name=${s.icon}></work-icon>${s.label}
                            <span class="count">${s.items.reduce((n, i) => n + count(i), 0)}</span>
                        </div>
                        <ul>
                            ${s.items.slice(0, 6).map(n => html`
                                <li><a @click=${() => app.go({ view: 'class', path: n.path })}>
                                    <work-icon name=${n.icon} fallback=${n.leaf ? 'carbon:document' : 'carbon:folders'}></work-icon>${n.label}
                                </a></li>`)}
                            ${s.items.length > 6 ? html`<li class="muted" style="padding: var(--wa-space-2xs) var(--wa-space-xs)">и ещё ${s.items.length - 6}…</li>` : nothing}
                        </ul>
                    </wa-card>`)}
            </div>` : html`<wa-callout variant="neutral"><work-icon slot="icon" name="carbon:information"></work-icon>
                У этого места нет ссылок на справочники, операции и счета — меню пусто.</wa-callout>`}
            ${links.length ? html`
                <h2>Права этого места</h2>
                <table>
                    <thead><tr><th>Класс</th><th>Слой</th><th>Доступ</th><th>Данные</th></tr></thead>
                    <tbody>
                        ${links.map(l => html`
                            <tr>
                                <td><a class="cell" style="cursor:pointer" @click=${() => app.go({ view: 'class', path: l.id })}>
                                    <work-icon name=${l.cls.icon || 'carbon:folders'}></work-icon>${l.cls.label}</a></td>
                                <td class="muted">${FAMILIES.find(f => f.id === l.cls.family)?.label ?? l.cls.family}</td>
                                <td><wa-badge appearance="outlined" variant=${l.access === 'read' ? 'neutral' : 'success'}>${ACCESS_LABELS[l.access] ?? l.access}</wa-badge></td>
                                <td>${SCOPE_LABELS[scopeOf(l.cls.family, l.scope)]}</td>
                            </tr>`)}
                    </tbody>
                </table>` : nothing}`;
    }
}

customElements.define('work-home', WorkHome);
