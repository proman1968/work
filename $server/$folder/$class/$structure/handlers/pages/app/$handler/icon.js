/**
 * `<work-icon name="набор:значок">` — значок из спрайтов проекта (`/oda/tools/icons/lib/svg/<набор>.svg#<значок>`):
 * те же имена, что в `icon` у class.js (`icons:shopping-cart`, `fontawesome:s-building`, `carbon:report`).
 */
import { LitElement, html, css, svg, nothing } from '/vendor/lit/lit.js';

export const ICON_BASE = '/oda/tools/icons/lib/svg/';

/** Адрес значка в спрайте или null (нет имени или неверный формат). */
export function iconHref(name) {
    const m = /^([\w-]+):([\w.-]+)$/.exec(String(name ?? '').trim());
    return m ? `${ICON_BASE}${m[1]}.svg#${m[2]}` : null;
}

const sprites = new Map();

/** Есть ли значок в спрайте (спрайт читается один раз). Не нашёлся спрайт — считаем, что есть. */
async function spriteHas(lib, id) {
    if (!sprites.has(lib)) {
        sprites.set(lib, fetch(`${ICON_BASE}${lib}.svg`)
            .then(r => (r.ok ? r.text() : ''))
            .then(text => (text ? new Set([...text.matchAll(/<symbol[^>]*\sid="([^"]+)"/g)].map(m => m[1])) : null))
            .catch(() => null));
    }
    const ids = await sprites.get(lib);
    return !ids || ids.has(id);
}

export class WorkIcon extends LitElement {
    static properties = {
        name: { type: String, reflect: true },
        label: { type: String },
        fallback: { type: String },
        missing: { state: true },
    };

    constructor() {
        super();
        this.fallback = 'carbon:folders';
    }

    willUpdate(changed) {
        if (changed.has('name')) {
            this.missing = false;
            const m = /^([\w-]+):([\w.-]+)$/.exec(String(this.name ?? '').trim());
            if (m)
                spriteHas(m[1], m[2]).then(has => { this.missing = !has; });
        }
    }

    static styles = css`
        :host {
            display: inline-flex;
            flex: none;
            width: 1.15em;
            height: 1.15em;
            vertical-align: -0.2em;
        }
        svg {
            width: 100%;
            height: 100%;
            fill: currentColor;
        }
        .dot {
            width: 28%;
            height: 28%;
            margin: auto;
            border-radius: 50%;
            background: currentColor;
            opacity: 0.45;
        }
    `;

    render() {
        const href = iconHref(this.missing || !this.name ? this.fallback : this.name);
        if (!href)
            return html`<span class="dot"></span>`;
        return html`<svg viewBox="0 0 24 24" role=${this.label ? 'img' : 'presentation'} aria-label=${this.label || nothing}>${svg`<use href=${href}></use>`}</svg>`;
    }
}

customElements.define('work-icon', WorkIcon);
