/**
 * Preview ribbon — лента блоков, tip-open, scroll, live-stream.
 * Связь с shell: :items :$item.
 */

/**
 * Исполняемая ветка tip: deepest active task.items, иначе спуск в items
 * последнего контейнера, иначе waiting task с button, иначе текущий список.
 */
export function tipBranch(items) {
    if (!Array.isArray(items) || !items.length) return [];
    let list = items;
    while (true) {
        const active = [...list].reverse()
            .find(b => b?.type === 'task' && b.state === 'active' && Array.isArray(b.items));
        if (active) {
            list = active.items;
            continue;
        }
        const last = list.at(-1);
        if (last && Array.isArray(last.items) && last.items.length && !last.closed) {
            list = last.items;
            continue;
        }
        const waiting = [...list].filter(b => b?.type === 'task').reverse().find(b => {
            const nested = Array.isArray(b.items) ? b.items : [];
            return nested.length && !!String(nested.at(-1)?.button?.label || '').trim();
        });
        if (waiting)
            return waiting.items;
        return list;
    }
}

/**
 * Tip для панели над промптом: последний блок ветки, если у него есть button.label.
 */
export function tipBlock(items) {
    const branch = tipBranch(items);
    if (!branch.length) return null;
    const last = branch[branch.length - 1];
    const label = String(last?.button?.label || '').trim();
    if (!label) return null;
    return last;
}

/**
 * Узлы на пути к tip: предки + конечный лист — для :auto-open.
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

/** Зарегистрирован microchat-view-{type} → он, иначе база microchat-view. */
export function viewTag(item) {
    const t = item?.type;
    if (!t) return '';
    const custom = 'microchat-view-' + t;
    return customElements.get(custom) ? custom : 'microchat-view';
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
            .ribbon { @apply --vertical; }
        </style>

        <div ~is="tag($for.item)" ~if="visible($for.item)" :data="$for.item"
                :auto-open="isAutoOpen($for.item)" :stick-top="stickTop" ~for="items"></div>

        <microchat-streaming ~if="!embedded && streamingText" :text="streamingText"></microchat-streaming>
    `,
    items: [],
    streamingText: '',
    stickTop: { $def: 0, $type: Number },
    embedded: { $def: false, $type: Boolean, $attr: true },
    _autoFollow: true,
    _userStopped: false,
    $item: {
        $def: null,
        set(n) {
            if (this.embedded) return;
            Promise.resolve(n).then(item => {
                if (!item?.listen) return;
                item.listen('chat.delta', e => this._onDelta(e));
                item.listen('chat.done', () => this._onDone());
                item.listen('chat.error', () => this._onDone());
                item.listen('chat.clear_stream', () => this._onClearStream());
            });
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
        this.scrollBottom(true);
    },
    observers: [
        function _followItems(items, streamingText) {
            if (this.embedded) return;
            this.scrollBottom(!!items?.length && !streamingText);
        },
    ],
    onScroll() {
        if (this.embedded) return;
        this._autoFollow = this.scrollTop + this.clientHeight >= this.scrollHeight - 10;
    },
    listeners: {
        scroll: 'onScroll',
    },
    scrollBottom(forceLayout = false) {
        if (this.embedded || !this._autoFollow) return;
        const go = () => { this.scrollTop = this.scrollHeight; };
        this.async(go, 50);
        if (forceLayout) {
            this.async(go, 150);
            this.async(go, 400);
        }
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
