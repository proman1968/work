export default {
    icon: 'carbon:request-quote',
    label: 'Заявка',
    template: /* html */ `
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                padding: 16px;
                gap: 12px;
                overflow: auto;
                box-sizing: border-box;
            }
            .row {
                @apply --horizontal;
                gap: 8px;
                flex-wrap: wrap;
            }
            .muted { opacity: .7; font-size: small; }
            pre {
                margin: 0;
                padding: 12px;
                border-radius: 8px;
                background: rgba(0,0,0,.04);
                overflow: auto;
                font-size: 12px;
                line-height: 1.4;
            }
            h3 { margin: 0; }
        </style>
        <div class="row">
            <h3>{{title}}</h3>
            <span class="muted">{{status}}</span>
        </div>
        <div class="muted">{{buyerLine}}</div>
        <pre>{{jsonText}}</pre>
    `,
    body: null,
    get title() {
        return this.body?.product?.label || this.$item?.name || 'Заявка';
    },
    get status() {
        return this.body?.status || '';
    },
    get buyerLine() {
        const b = this.body;
        if (!b) return '';
        return [b.role, b.buyer].filter(Boolean).join(' · ');
    },
    get jsonText() {
        return this.body ? JSON.stringify(this.body, null, 2) : '';
    },
    async attached() {
        await this._load();
    },
    async _load() {
        try {
            const raw = await this.$item?.load?.({ encoding: 'utf-8' });
            this.body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
            this.body = { error: e.message || String(e) };
        }
    },
}
