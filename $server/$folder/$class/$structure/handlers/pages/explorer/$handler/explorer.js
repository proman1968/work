export default{
    icon: 'icons:tree-structure',
    imports: '~/lib//explorer.js',
    extends: 'item-explorer',
    template: /* html */`
        <item-tree ~for="available" header allow-search hidden slot='left-panel' show-status allow-focus hide-roots="2" hide-tops="0" :$item="$for.item" style="height: 0"></item-tree>
        
    `,
    list:[
        '/USERS', '/MARKET', '/SUPPORT'
    ],
    get available(){
        return this.list.reduce(async (acc, item) => {
            acc = await acc;
            let $item = await WORK.get_item(item);
            if($item){
                acc.push($item);
            }
            return acc;
        }, []);
    },
}