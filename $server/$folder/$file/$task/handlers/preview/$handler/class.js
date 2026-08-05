/**
 * Preview ai.task — shell: лента + промптбар.
 * Только data/items/$item/focusedBlock; без знания внутренностей детей.
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
        <microchat-ribbon flex :items :$item></microchat-ribbon>
        <microchat-panel info-invert no-flex :data :$item></microchat-panel>
    `,
    colorMode: 'content',
    data: null,

    $item: {
        $def: null,
        async set(n) {
            n?.listen('changed', async () => this.data = await n.load());
            this.data = await n?.load();
        },
    },
    get title() { return this.data?.title || this.$item?.name || 'task'; },
    get items() { return this.data?.items; },
    get focusedBlock() {
        let items = this.items;
        while (items?.last?.items?.length && !items.last.closed)
            items = items.last.items;
        return items?.last;
    },
};