export default{
    imports: '~/lib//tree.js',
    icon: 'icons:pageview',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                overflow-y: hidden;
                @apply --content;
            }
        </style>     
        <item-tree flex :$item="storage" show-size hide-system items-selector="files" hide-tops="1" hide-roots="1" ></item-tree>
    `,
    get storage(){
        return this.$item?.storage_folder;
    }
}