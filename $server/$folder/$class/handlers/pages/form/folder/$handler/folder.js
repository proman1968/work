export default{
    imports: '~/lib//tree.js',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                overflow-y: hidden;
                @apply --content;
            }
        </style>     
        <item-tree flex :$item="storage" show-size hide-system items-selector="entries" hide-tops="1" hide-roots="1" ></item-tree>
    `,
    get storage(){
        const $item = this.$item;
        const role = $item?.role;
        if (!$item || !role)
            return Promise.resolve($item?.ensureRole?.()).then(() => this.storage);
        // ADMIN и BOSS видят метапапку целиком, остальные классы — только папку своей роли
        if (role === 'ADMIN' || role === 'BOSS' || !($item instanceof CORE.$class))
            return $item.storage_folder;
        return $item.fetch('work_zone', { role });
    }
}