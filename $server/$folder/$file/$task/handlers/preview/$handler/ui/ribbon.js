/**
 * Preview ribbon — лента блоков, auto-open, scroll, live-stream.
 * Связь с shell: :items :$item.
 */

/**
 * Узлы на пути к focusedBlock: предки + лист — для :auto-open.
 */
export function tipOpenSet(items) {
    const open = new Set();
    if (!Array.isArray(items) || !items.length) return open;
    let list = items;
    while (true) {
        const active = [...list].reverse()
            .find(b => b?.type === 'task' && b.state === 'active' && Array.isArray(b.items));
        if (active) {
            open.add(active);
            list = active.items;
            continue;
        }
        const last = list.at(-1);
        if (last && Array.isArray(last.items) && last.items.length && !last.closed) {
            open.add(last);
            list = last.items;
            continue;
        }
        const waiting = [...list].filter(b => b?.type === 'task').reverse().find(b => {
            const nested = Array.isArray(b.items) ? b.items : [];
            return nested.length && !!String(nested.at(-1)?.button?.label || '').trim();
        });
        if (waiting) {
            open.add(waiting);
            for (const n of tipOpenSet(waiting.items)) open.add(n);
            return open;
        }
        if (last) open.add(last);
        return open;
    }
}

/** Спец-view по type; иначе база microchat-view (без customElements.get — гонка регистрации). */
const VIEW_TYPES = new Set([
    'prompt', 'form', 'questions', 'step', 'task', 'file', 'tool', 'tool_result',
]);

export function viewTag(item) {
    const t = item?.type;
    if (!t) return '';
    return VIEW_TYPES.has(t) ? 'microchat-view-' + t : 'microchat-view';
}

ODA({ is: 'microchat-ribbon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow-y: auto;
                flex: 1;
                min-height: 0;
                scroll-behavior: smooth;
                box-sizing: border-box;
            }
            :host([embedded]) {
                flex: none;
                min-height: auto;
                overflow: visible;
                padding-bottom: 0;
            }
            .feed { @apply --vertical; }
        </style>

        <div class="feed" vertical>
            <div ~is="tag($for.item)" ~if="visible($for.item)" :data="$for.item"
                    :auto-open="isAutoOpen($for.item)" :stick-top="stickTop" ~for="items"></div>
            <microchat-streaming ~if="!embedded && streamingText" :text="streamingText"></microchat-streaming>
        </div>
    `,
    items: [],
    streamingText: '',
    stickTop: { $def: 0, $type: Number },
    embedded: { $def: false, $type: Boolean, $attr: true },
    _autoFollow: true,
    _userStopped: false,
    _ro: null,
    $item: {
        $def: null,
        set(n) {
            if (this.embedded) return;
            n?.listen('chat.delta', e => this._onDelta(e));
            n?.listen('chat.done', () => this._onDone());
            n?.listen('chat.error', () => this._onDone());
            n?.listen('chat.clear_stream', () => this._onClearStream());
            n?.listen('chat.stop', () => this.markStopped());
            n?.listen('chat.resume', () => this.clearStopped());
        },
    },
    tag(item) { return viewTag(item); },
    get tipOpen() { return tipOpenSet(this.items); },
    isAutoOpen(item) { return this.tipOpen.has(item); },
    visible(item) {
        if (!item?.type) return false;
        if ((item.type === 'questions' || item.type === 'form') && item.answered)
            return false;
        if ((item.type === 'plan' || item.type === 'report') && !item.button)
            return false;
        if (item.type === 'task' && !Array.isArray(item.steps) && !Array.isArray(item.items))
            return false;
        return true;
    },
    attached() {
        if (this.embedded) return;
        this._autoFollow = true;
        this._ro = new ResizeObserver(() => this.scrollBottom());
        this.async(() => {
            const feed = this.$('.feed');
            if (feed) this._ro.observe(feed);
            this.scrollBottom();
        });
    },
    detached() {
        this._ro?.disconnect();
        this._ro = null;
    },
    onScroll() {
        if (this.embedded) return;
        this._autoFollow = this.scrollTop + this.clientHeight >= this.scrollHeight - 10;
    },
    listeners: {
        scroll: 'onScroll',
    },
    scrollBottom() {
        if (this.embedded || !this._autoFollow) return;
        this.scrollTop = this.scrollHeight;
    },
    markStopped() {
        this._userStopped = true;
        this.streamingText = '';
    },
    clearStopped() {
        this._userStopped = false;
    },
    _onDelta(e) {
        if (this._userStopped || this.embedded) return;
        const token = e.detail?.value?.token;
        if (!token) return;
        this.streamingText += token;
        this._autoFollow = true;
        this.scrollBottom();
    },
    _onClearStream() {
        if (this._userStopped || this.embedded) return;
        this.streamingText = '';
    },
    _onDone() {
        this._userStopped = false;
        this.streamingText = '';
    },
});

ODA({ is: 'microchat-streaming',
    template: /*html*/`
        <div vertical light style="padding: 4px 12px; font-size: small;">
            <oda-markdown-viewer :value="text"></oda-markdown-viewer>
        </div>
    `,
    imports: 'oda//markdown//markdown-viewer',
    text: '',
});
