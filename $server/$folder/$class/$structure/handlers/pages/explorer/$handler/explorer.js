export default{
    icon: 'icons:tree-structure',
    imports: '~/lib//explorer.js',
    extends: 'item-explorer',
    template: /* html */`
        <item-tree ~for="available" order="{{$for.index + 1}}" allow-search hidden slot='left-panel' show-status allow-focus hide-roots="1" hide-tops="0" :$item="$for.item" style="height: 0"></item-tree>
        
    `,
    list:[
        '/USERS', '/NODES'
    ],
    get available(){
        return Promise.all(this.list.map(path => CORE.$item.ITEMS[path] || WORK.get_item(path)))
            .then(res => res.filter(Boolean));
    },
}