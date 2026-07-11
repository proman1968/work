export default{
    imports: '~/lib//node.js',
    template:/* html */`
        <item-node ~for="files" :$item="$for.item"></item-node>
    `,
    get files(){
        return new AsyncPromise(async ()=>{
            let s = await this.$item?.storage;
            return s?.items;
        })
    }
}