export default {
    imports: '~/lib//tree',
    template: /*html*/`
        <style>
            :host {
                border: none;
                max-height: 100% !important;
                overflow: hidden;
                @apply --vertical;
                @apply --content;
            }
        </style>
        <item-tree @resize :hide-tops :hide-roots expander-order="1" expand-all :$item="menuRoot" :allow-categories></item-tree>
    `,
    hideRoots: 2,
    hideTops: 1,
    allowCategories: true,
    path: '',
    get menuRoot() {
        return this.$item?.fetch('handlers', {path: this.path});
    }
}