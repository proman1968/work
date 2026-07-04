export default{
    icon: 'files:package',
    imports: '/$server/$folder/lib/chat-item/$handler/data.js',
    template: /* html */`
        <pack-preview :$item></pack-preview>
    `
}
ODA({is: 'pack-preview',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                width: 100%;
            }
            .item{
                @apply --horizontal;
                padding: 0;
                width: 100%;
                box-sizing: border-box;
            }
        </style>
        <div ~for="includeFiles" class="item">
            <chat-item visible history compact :$file="$for.item"></chat-item>
        </div>
    `,
    $item: null,
    get packData(){
        return Promise.resolve(this.$item).then(async item => {
            if (!item?.load) return null;
            try {
                const raw = await item.load();
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
            catch { return null; }
        });
    },
    get includeFiles(){
        return this.packData?.then(async data => {
            if (!data?.includes?.length) return [];
            const items = await Promise.all(data.includes.map(f => WORK.get_item(f, 'info')));
            return items.filter(Boolean);
        }) ?? [];
    }
})