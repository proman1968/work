/**
 * Preview ribbon — лента блоков, scroll.
 * Топ: shell даёт flex + $item; вложенная — только :items.
 * Стрим-текст — на shell ($pdp.streamingText); раскрытие — views.
 * Активная копия сейчас в views.js (shell import); держать scroll-контракт в синхе.
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
            // reload: докрутка только если уже в хвосте
            if (this.top && n?.length && this.stickBottom) this.pinBottom();
        },
    },
    /** follow только в хвосте; user-scroll вверх — стоп до возврата вниз */
    stickBottom: true,
    _pinGen: 0,
    $item: {
        $def: null,
        set(n) {
            n?.listen('chat.delta', () => {
                this.async(() => { if (this.stickBottom) this.scrollToBottom(); });
            });
            n?.listen('chat.done', () => this.async(() => {
                if (this.stickBottom) this.pinBottom();
            }));
            if (this.items?.length) this.pinBottom(true);
        },
    },
    /** specialty если CE уже есть или ODA уже стартовал (telemetry) — не ждать define */
    tag(item) {
        const name = 'microchat-view-' + item.type;
        return (customElements.get(name) || ODA.telemetry?.[name]) ? name : 'microchat-view';
    },
    attached() {
        /** Follow on/off — только намерение пользователя (wheel/touch/drag).
         *  Не включать follow по scroll+nearBottom: докрутка стрима сама даёт scroll у низа
         *  и гоняет stickBottom обратно true на первом же wheel вверх. */
        if (!this.top) return;
        const stop = () => {
            this.stickBottom = false;
            this._pinGen++;
        };
        const resume = () => {
            if (!this.nearBottom) return;
            this.stickBottom = true;
        };
        this.addEventListener('wheel', e => {
            if (e.deltaY < 0) stop();
            else if (e.deltaY > 0) resume();
        }, { passive: true });
        this.addEventListener('touchmove', stop, { passive: true });
        this.addEventListener('touchend', resume, { passive: true });
        this.addEventListener('mousedown', () => {
            this._scrollDrag = true;
            document.addEventListener('mouseup', () => {
                this._scrollDrag = false;
                resume();
            }, { once: true });
        });
        this.addEventListener('scroll', () => {
            if (this._scrollDrag && !this.nearBottom) stop();
        }, { passive: true });
        if (this.items?.length) this.pinBottom(true);
    },
    /**
     * Докрутка к хвосту, пока layout растёт (markdown/details).
     * force — только первый open; иначе только при stickBottom.
     */
    pinBottom(force) {
        if (!this.top) return;
        if (force) this.stickBottom = true;
        else if (!this.stickBottom) return;
        const gen = ++this._pinGen;
        const tick = (left, lastH) => {
            this.async(() => {
                if (gen !== this._pinGen || !this.stickBottom) return;
                this.scrollToBottom();
                const h = this.scrollHeight;
                if (left <= 1) return;
                if (h === lastH && this.nearBottom) return;
                tick(left - 1, h);
            }, 100);
        };
        tick(25, 0);
    },
    get nearBottom() {
        return this.scrollTop + this.clientHeight >= this.scrollHeight - 24;
    },
    scrollToBottom() {
        if (!this.top || !this.stickBottom) return this.nearBottom;
        this.scrollTop = this.scrollHeight;
        return this.nearBottom;
    },
});
