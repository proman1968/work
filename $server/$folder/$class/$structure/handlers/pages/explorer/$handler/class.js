export default{
    icon: 'icons:tree-structure',
    imports: '~/lib//explorer.js',
    extends: 'item-explorer',
    template: /* html */`
        <item-tree ~for="list" header allow-search hidden slot='left-panel' allow-focus hide-roots="2" hide-tops="0" :$item="WORK.get_item($for.item)" style="height: 0"></item-tree>
        
    `,
    list:[
        '/users', '/MARKET', '/support'
    ]  
}