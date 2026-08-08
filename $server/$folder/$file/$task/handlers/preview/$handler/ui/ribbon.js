/**
 * Preview ribbon — лента блоков, scroll.
 * Топ: shell даёт flex + $item; вложенная — только :items.
 * Стрим-текст — на shell ($pdp.streamingText); раскрытие — views.
 */

ODA({ is: 'microchat-ribbon',
    template: /*html*/`
        <style>
            :host {
                @apply --info-invert;
                @apply --vertical;
                flex: none;
                min-height: auto;
                overflow: visible;
                box-sizing: border-box;
            }
            :host([top]) {
                overflow-y: auto;
                flex: 1;
                min-height: 0;
            }
        </style>
        <div ~is="tag($for.item)" ~if="!$for.item.hidden" :data="$for.item" ~for="items"></div>
    `,
    top: {
        $def: false,
        $attr: true,
        get() { return !!this.$item; },
    },
    items: {
        $def: [],
        set(n) {
            // load async: attached на пустой ленте; ждать items
            if (this.top && n?.length) this.pinBottom();
        },
    },
    $item: {
        $def: null,
        set(n) {
            n?.listen('chat.delta', () => {
                const follow = this.nearBottom;
                this.async(() => { if (follow) this.scrollToBottom(true); });
            });
            n?.listen('chat.done', () => this.async(() => this.scrollToBottom()));
            if (this.items?.length) this.pinBottom();
        },
    },
    /** specialty если CE уже есть или ODA уже стартовал (telemetry) — не ждать define */
    tag(item) {
        const name = 'microchat-view-' + item.type;
        return (customElements.get(name) || ODA.telemetry?.[name]) ? name : 'microchat-view';
    },
    attached() {
        if (this.top && this.items?.length) this.pinBottom();
    },
    /**
     * Начальная докрутка: не стопать на nearBottom при ещё коротком scrollHeight
     * (details/open/markdown дорисуют позже). Стоп — высота стабильна и у низа, или лимит.
     */
    pinBottom() {
        if (!this.top) return;
        const gen = ++this._pinGen;
        const tick = (left, lastH) => {
            this.async(() => {
                if (gen !== this._pinGen) return;
                this.scrollToBottom(true);
                const h = this.scrollHeight;
                if (left <= 1) return;
                if (h === lastH && this.nearBottom) return;
                tick(left - 1, h);
            }, 100);
        };
        tick(25, 0);
    },
    _pinGen: 0,
    get nearBottom() {
        return this.scrollTop + this.clientHeight >= this.scrollHeight - 10;
    },
    scrollToBottom(force) {
        if (!this.top) return true;
        if (force || this.nearBottom)
            this.scrollTop = this.scrollHeight;
        return this.nearBottom;
    },
});
