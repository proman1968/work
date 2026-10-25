/**
 * Навигатор по организации (Р15): кнопка с текущим контекстом (подразделение / место) и дерево
 * «мои подразделения и места». Выбор места или подразделения переключает контекст: меню и фильтры.
 * Подразделение без прав (каркас дерева) недоступно для выбора, но показывает путь.
 */
import { html, css, nothing } from '/vendor/lit/lit.js';
import { WorkElement } from './base.js';
import { app } from './store.js';
import { orgTree, sameContext, RIGHTS_LABELS } from './menu.js';
import './icon.js';

const VIEW_LABELS = { mine: 'моё', below: 'подчинённое', boss: 'руководитель', admin: 'админ' };

export class WorkOrgNav extends WorkElement {
    static styles = css`
        :host { display: inline-block; min-width: 0; }
        .current { max-width: min(32rem, 52vw); }
        .current::part(label) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        wa-popover::part(body) { padding: var(--wa-space-xs); }
        .panel { width: min(26rem, 88vw); max-height: min(70vh, 34rem); overflow: auto; }
        .hint { margin: 0; padding: var(--wa-space-2xs) var(--wa-space-s) var(--wa-space-xs); color: var(--wa-color-text-quiet); font-size: var(--wa-font-size-s); }
        .node { display: inline-flex; align-items: center; gap: var(--wa-space-xs); min-width: 0; }
        .node.muted { color: var(--wa-color-text-quiet); }
        .node .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tag {
            flex: none;
            font-size: var(--wa-font-size-2xs);
            padding: 0 var(--wa-space-xs);
            border-radius: var(--wa-border-radius-pill);
            background: var(--wa-color-brand-fill-quiet);
            color: var(--wa-color-brand-on-quiet);
        }
        .tag.plain { background: var(--wa-color-neutral-fill-quiet); color: var(--wa-color-neutral-on-quiet); }
    `;

    render() {
        const ctx = app.context;
        if (!ctx)
            return nothing;
        const tree = orgTree(app.ws);
        return html`
            <wa-button id="trigger" class="current" appearance="outlined" variant="neutral" with-caret title="Подразделения и места">
                <work-icon slot="start" name=${ctx.place?.icon || ctx.unit.icon || 'carbon:tree-view-alt'}></work-icon>
                ${ctx.title}
            </wa-button>
            <wa-popover for="trigger" placement="bottom-start" without-arrow>
                <div class="panel">
                    <p class="hint">Где вы работаете сейчас — от этого зависят меню и данные.</p>
                    <wa-tree selection="single" @wa-selection-change=${this.pick}>
                        ${tree.map(n => this.node(n))}
                    </wa-tree>
                </div>
            </wa-popover>`;
    }

    node(n) {
        const here = sameContext(n, app.ctx);
        const open = this.opened(n);
        const skeleton = n.kind === 'unit' && !n.rights;
        return html`
            <wa-tree-item ?expanded=${open || skeleton} ?selected=${here} ?disabled=${skeleton} data-unit=${n.unit} data-place=${n.place}>
                <span class="node ${skeleton ? 'muted' : ''}">
                    <work-icon name=${n.icon || (n.kind === 'unit' ? 'carbon:building' : 'carbon:user-avatar')}></work-icon>
                    <span class="label">${n.label}</span>
                    ${n.kind === 'place'
                        ? (n.mine ? html`<span class="tag">моё</span>` : n.view !== 'admin' ? html`<span class="tag plain">${VIEW_LABELS[n.view] ?? ''}</span>` : nothing)
                        : n.rights && n.rights !== 'member' ? html`<span class="tag plain">${RIGHTS_LABELS[n.rights]}</span>` : nothing}
                </span>
                ${n.children.map(c => this.node(c))}
            </wa-tree-item>`;
    }

    /** Ветка раскрыта, если в ней текущий контекст. */
    opened(n) {
        const c = app.ctx;
        if (!c)
            return false;
        if (n.kind === 'unit')
            return app.chain.some(u => u.cid === n.unit);
        return n.unit === c.unit && !!c.place && (c.place === n.place ? false : c.place.startsWith(n.place + '/'));
    }

    pick(e) {
        const item = e.detail.selection?.[0];
        if (!item?.dataset || item.disabled)
            return;
        const ctx = { unit: item.dataset.unit, place: item.dataset.place || '' };
        if (sameContext(ctx, app.ctx))
            return;
        app.setContext(ctx);
        this.renderRoot.querySelector('wa-popover')?.hide();
    }
}

customElements.define('work-org-nav', WorkOrgNav);
