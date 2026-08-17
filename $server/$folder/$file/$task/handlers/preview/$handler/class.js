/**
 * Preview ai.task — shell: лента + промптбар.
 * data/items/$item/focusedBlock/result/streamingText/streaming; без знания внутренностей детей.
 */

import './ui/views.js';
import './ui/panel.js';

export default {
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                overflow: hidden;
            }
        </style>
        <microchat-ribbon flex :data :$item></microchat-ribbon>
        <microchat-panel info-invert no-flex :data :$item></microchat-panel>
    `,
    colorMode: 'content',
    data: null,
    streamingText: '',
    /** wait-кнопки прячем, пока идёт стрим (реактивный флаг для кэша геттеров) */
    streaming: false,

    $item: {
        $def: null,
        async set(n) {
            n?.listen('changed', async () => {
                this.streamingText = '';
                this.data = await n.load();
                // каркас с button до первого delta — уже стрим-фаза
                this.streaming = this._isStreamSkeleton(this.focusedBlock);
            });
            n?.listen('chat.delta', e => {
                this.streaming = true;
                this.streamingText += e.detail?.value?.token || '';
            });
            n?.listen('chat.done', async () => {
                this.streaming = false;
                this.streamingText = '';
                this.data = await n.load();
            });
            this.data = await n?.load();
            this.streaming = false;
        },
    },
    get title() { return this.data?.title || this.$item?.name || 'task'; },
    get items() { return this.data?.items; },
    get result() {
        return this.$('microchat-ribbon')?.viewFor(this.focusedBlock)?.result;
    },
    get focusedBlock() {
        let items = this.items;
        while (items?.length) {
            let last;
            for (let i = items.length - 1; i >= 0; i--) {
                if (!items[i]?.hidden) { last = items[i]; break; }
            }
            if (!last || last.content || !last.items?.length) return last;
            items = last.items;
        }
        return undefined;
    },
    /** каркас wait-блока: stop-лейбл есть, тела ещё нет */
    _isStreamSkeleton(b) {
        if (typeof b?.stop !== 'string') return false;
        if (b.content || b.html) return false;
        return true;
    },
};
