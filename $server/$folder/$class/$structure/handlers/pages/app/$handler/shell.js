/**
 * Оболочка рабочего места: шапка (организация, навигатор по подразделениям и местам, тема, пользователь),
 * хлебные крошки, меню места слева и экран справа. Экраны — по `view` маршрута: `home`, `class`.
 */
import { html, css, nothing, keyed } from '/vendor/lit/lit.js';
import { WorkElement } from './base.js';
import { app } from './store.js';
import { breadcrumbs, nodeTrail } from './menu.js';
import { formatHash } from './router.js';
import { applyScheme, savedScheme } from './vendor.js';
import './icon.js';
import './org-nav.js';
import './menu-view.js';
import './view-home.js';
import './view-class.js';

export class WorkApp extends WorkElement {
    static properties = {
        scheme: { state: true },
    };

    static styles = css`
        :host { display: block; height: 100%; }
        wa-page { height: 100%; }
        @media (min-width: 861px) { wa-page { --menu-width: var(--work-nav-width, 19rem); } }
        .burger { display: none; margin-left: calc(var(--wa-space-xs) * -1); }
        @media (max-width: 860px) { .burger { display: inline-flex; } }
        wa-page::part(base) { height: 100%; }
        .bar {
            display: flex; align-items: center; gap: var(--wa-space-m);
            height: var(--work-header-height, 3.5rem);
            padding: 0 var(--wa-space-m);
            background: var(--wa-color-surface-default);
            border-bottom: 1px solid var(--wa-color-surface-border);
            box-sizing: border-box;
        }
        .brand { display: flex; align-items: center; gap: var(--wa-space-xs); color: inherit; text-decoration: none; cursor: pointer; flex: none; }
        .mark {
            display: grid; place-items: center; width: 2rem; height: 2rem;
            border-radius: var(--wa-border-radius-m);
            background: linear-gradient(135deg, var(--wa-color-brand-fill-loud), var(--wa-color-purple-50, var(--wa-color-brand-fill-loud)));
            color: var(--wa-color-brand-on-loud, #fff); font-weight: 700; font-size: var(--wa-font-size-m);
        }
        .name { font-family: var(--wa-font-family-heading); font-weight: 700; letter-spacing: 0.04em; }
        .grow { flex: 1; }
        .sub { padding: var(--wa-space-xs) var(--wa-space-m); background: var(--wa-color-surface-default); border-bottom: 1px solid var(--wa-color-surface-border); }
        wa-breadcrumb-item::part(label) { cursor: pointer; }
        .nav { background: var(--wa-color-surface-default); min-height: 100%; }
        main { min-height: 100%; }
        .center { display: grid; place-items: center; height: 100%; padding: var(--wa-space-l); box-sizing: border-box; }
        .card { max-width: 32rem; display: grid; gap: var(--wa-space-m); }
        .actions { display: flex; gap: var(--wa-space-s); }
        .user { font-size: var(--wa-font-size-s); color: var(--wa-color-text-quiet); }
        @media (max-width: 860px) { .user { display: none; } }
    `;

    constructor() {
        super();
        this.scheme = savedScheme();
    }

    render() {
        switch (app.status) {
            case 'loading':
            case 'idle':
                return html`<div class="center"><wa-spinner style="font-size: 3rem"></wa-spinner></div>`;
            case 'error':
                return this.failure(app.error);
            case 'empty':
                return html`<div class="center"><div class="card">
                    <wa-callout variant="neutral"><work-icon slot="icon" name="carbon:user-avatar"></work-icon>
                        В организации вам не назначено рабочее место. Обратитесь к администратору.</wa-callout>
                    <div class="actions"><wa-button variant="neutral" @click=${() => app.load()}>Проверить снова</wa-button></div>
                </div></div>`;
            default:
                return this.page();
        }
    }

    failure(error) {
        return html`<div class="center"><div class="card">
            <wa-callout variant=${error?.denied ? 'warning' : 'danger'}>
                <work-icon slot="icon" name="carbon:warning"></work-icon>
                <strong>${error?.denied ? 'Нет доступа' : 'Не удалось открыть рабочее место'}</strong><br>${error?.message ?? ''}
            </wa-callout>
            <div class="actions">
                <wa-button variant="brand" @click=${() => app.load()}>Повторить</wa-button>
                <wa-button appearance="outlined" variant="neutral" href="/">Войти</wa-button>
            </div>
        </div></div>`;
    }

    updated() {
        const key = formatHash(app.route);
        if (key !== this._key) {
            this._key = key;
            const page = this.renderRoot.querySelector('wa-page');
            if (page)
                page.navOpen = false;
        }
    }

    toggleScheme() {
        this.scheme = this.scheme === 'dark' ? 'light' : 'dark';
        applyScheme(this.scheme);
    }

    page() {
        const route = app.route;
        const uid = app.ws.uid;
        return html`
            <wa-page mobile-breakpoint="860">
                <header slot="header" class="bar">
                    <wa-button class="burger" data-toggle-nav appearance="plain" variant="neutral" title="Меню места">
                        <work-icon name="carbon:menu" label="Меню"></work-icon>
                    </wa-button>
                    <a class="brand" @click=${() => app.go({ view: 'home', path: '' })} title="Главная">
                        <span class="mark">W</span><span class="name">WORK</span>
                    </a>
                    <work-org-nav></work-org-nav>
                    <span class="grow"></span>
                    ${uid ? html`<span class="user" title="Пользователь">${uid}</span>` : nothing}
                    <wa-button appearance="plain" variant="neutral" title=${this.scheme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} @click=${this.toggleScheme}>
                        <work-icon name=${this.scheme === 'dark' ? 'carbon:sun' : 'carbon:moon'} label="Тема"></work-icon>
                    </wa-button>
                </header>
                <div slot="subheader" class="sub">${this.crumbs()}</div>
                <nav slot="navigation" class="nav"><work-menu></work-menu></nav>
                <main>${this.screen(route)}</main>
            </wa-page>`;
    }

    /** Крошка подразделения или места: переключить контекст, а в нём самом — вернуться на главную. */
    openCrumb(b) {
        if (b.enabled && !app.setContext({ unit: b.unit, place: b.place }))
            app.go({ view: 'home', path: '' });
    }

    crumbs() {
        const items = breadcrumbs(app.ws, app.ctx);
        const view = app.route.view === 'class' ? nodeTrail(app.sections, app.route.path) : [];
        return html`<wa-breadcrumb>
            ${items.map(b => html`<wa-breadcrumb-item @click=${() => this.openCrumb(b)}>${b.label}</wa-breadcrumb-item>`)}
            ${view.map(n => html`<wa-breadcrumb-item @click=${() => app.go({ view: 'class', path: n.path })}>${n.label}</wa-breadcrumb-item>`)}
            ${app.route.view === 'class' && !view.length ? html`<wa-breadcrumb-item>${app.ws.classes[app.route.path]?.label ?? app.route.path}</wa-breadcrumb-item>` : nothing}
        </wa-breadcrumb>`;
    }

    screen(route) {
        switch (route.view) {
            case 'home':
                return html`<work-home></work-home>`;
            case 'class':
                return keyed(route.path, html`<work-class-view .path=${route.path}></work-class-view>`);
            default:
                return html`<div class="center"><wa-callout variant="warning"><work-icon slot="icon" name="carbon:warning"></work-icon>
                    Экран «${route.view}» не найден.</wa-callout></div>`;
        }
    }
}

customElements.define('work-app', WorkApp);
