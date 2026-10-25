/**
 * Меню рабочего места: разделы по слоям модели (операции, справочники, журнал и счета),
 * внутри — ссылки места с поддеревом классов. Выбор пункта открывает класс (`view=class`).
 */
import { html, css, nothing } from '/vendor/lit/lit.js';
import { WorkElement } from './base.js';
import { app } from './store.js';
import { ACCESS_LABELS, SCOPE_LABELS, scopeOf, nodeTrail } from './menu.js';
import './icon.js';

export class WorkMenu extends WorkElement {
    static styles = css`
        :host { display: block; padding: var(--wa-space-s) var(--wa-space-xs) var(--wa-space-xl); }
        .home {
            display: flex; align-items: center; gap: var(--wa-space-xs);
            margin: 0 var(--wa-space-xs) var(--wa-space-s);
            padding: var(--wa-space-xs) var(--wa-space-s);
            border-radius: var(--wa-border-radius-m);
            color: var(--wa-color-text-normal);
            text-decoration: none;
            cursor: pointer;
        }
        .home:hover { background: var(--wa-color-surface-lowered); }
        .home.active { background: var(--wa-color-brand-fill-quiet); color: var(--wa-color-brand-on-quiet); font-weight: 600; }
        h3 {
            display: flex; align-items: center; gap: var(--wa-space-xs);
            margin: var(--wa-space-m) var(--wa-space-s) var(--wa-space-2xs);
            font-size: var(--wa-font-size-xs);
            font-weight: 600;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--wa-color-text-quiet);
        }
        .item { display: inline-flex; align-items: center; gap: var(--wa-space-xs); min-width: 0; width: 100%; }
        .item .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .item .ro { margin-left: auto; flex: none; font-size: var(--wa-font-size-s); color: var(--wa-color-text-quiet); }
        .empty { margin: var(--wa-space-l) var(--wa-space-m); color: var(--wa-color-text-quiet); font-size: var(--wa-font-size-s); }
    `;

    render() {
        const sections = app.sections;
        const here = app.route.view === 'class' ? app.route.path : '';
        const trail = new Set(nodeTrail(sections, here).map(n => n.path));
        return html`
            <a class="home ${app.route.view === 'home' ? 'active' : ''}" @click=${() => app.go({ view: 'home', path: '' })}>
                <work-icon name="carbon:home"></work-icon>Главная
            </a>
            ${sections.map(s => html`
                <h3><work-icon name=${s.icon}></work-icon>${s.label}</h3>
                <wa-tree selection="single" @wa-selection-change=${this.pick}>
                    ${s.items.map(n => this.node(n, here, trail))}
                </wa-tree>`)}
            ${sections.length ? nothing : html`<p class="empty">У этого места нет ссылок на справочники, операции и счета.</p>`}`;
    }

    node(n, here, trail) {
        const hint = `${ACCESS_LABELS[n.access] ?? n.access} · видны: ${SCOPE_LABELS[scopeOf(n.family, n.scope)]}`;
        return html`
            <wa-tree-item ?selected=${n.path === here} ?expanded=${trail.has(n.path) && n.path !== here} data-path=${n.path} title=${hint}>
                <span class="item">
                    <work-icon name=${n.icon} fallback=${n.leaf ? 'carbon:document' : 'carbon:folders'}></work-icon>
                    <span class="label">${n.label}</span>
                    ${n.access === 'read' ? html`<work-icon class="ro" name="carbon:view" label="Только чтение"></work-icon>` : nothing}
                </span>
                ${n.children.map(c => this.node(c, here, trail))}
            </wa-tree-item>`;
    }

    pick(e) {
        const path = e.detail.selection?.[0]?.dataset?.path;
        if (path && !(app.route.view === 'class' && app.route.path === path))
            app.go({ view: 'class', path });
    }
}

customElements.define('work-menu', WorkMenu);
