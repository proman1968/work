export default{
    imports: '~/lib//node.js',
    template:/* html */`
        <item-node ~for="files" :$item="$for.item"></item-node>
    `,
    get files(){
        return this.$item?.storage.then(s=>s.items)
    }
}