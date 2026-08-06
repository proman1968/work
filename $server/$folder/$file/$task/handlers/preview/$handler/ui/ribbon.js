/**
 * Preview ribbon — лента блоков, scroll, live-stream.
 * Топ: shell даёт flex + $item; вложенная — только :items.
 * Раскрытие блоков — views (autoOpen).
 */

ODA({ is: 'microchat-ribbon',
    imports: 'oda//markdown//markdown-viewer',
    template: /*html*/`
        <style>
            :host {
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
                scroll-behavior: smooth;
            }
        </style>
        <div ~is="tag($for.item)" :data="$for.item" ~for="items"></div>
        <oda-markdown-viewer ~if="$item && streamingText" :value="streamingText"
                vertical style="padding: 4px 12px; font-size: small;"></oda-markdown-viewer>
    `,
    top: {
        $def: false,
        $attr: true,
        get() { return !!this.$item; },
    },
    items: [],
    streamingText: '',
    $item: {
        $def: null,
        set(n) {
            n?.listen('chat.delta', e => {
                this.streamingText += e.detail?.value?.token || '';
                this.scrollToBottom();
            });
            n?.listen('chat.done', () => {
                this.streamingText = '';
                this.scrollToBottom();
            });
        },
    },
    tag(item) {
        const name = 'microchat-view-' + item.type;
        return customElements.get(name) ? name : 'microchat-view';
    },
    attached() {
        this.async(() => this.scrollToBottom(true), 100);
    },
    scrollToBottom(force) {
        if (force || this.scrollTop + this.clientHeight >= this.scrollHeight - 10)
            this.scrollTop = this.scrollHeight;
    },
});
