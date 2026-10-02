/**
 * item-popover — оболочка всплывающих окон WORK (ODA.popoverTag): oda-popover + навигатор $item в заголовке.
 */
export default {
    imports: '/oda/components/containers/popover/popover.js',
    extends: 'oda-popover',
    title: '',
    get hasTitle() {
        return !!(this.$item || this.TITLE?.label);
    },
    $observers: {
        // заголовок-навигатор по $item — светлый потомок в слоте title оболочки
        _titleExplorer($item) {
            this.querySelector(':scope > item-node-explorer[slot="title"]')?.remove();
            if ($item)
                this.appendChild(ODA.createElement('item-node-explorer', { slot: 'title', $item, deep: this.TITLE?.deep ?? 0 }));
        }
    }
}
