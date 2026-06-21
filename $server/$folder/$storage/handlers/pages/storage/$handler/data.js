export default{
    icon: 'bootstrap:database-fill-gear',
    imports: '~/lib//explorer.js',
    extends: 'item-explorer',
    hideTops: 0,
    hideRoots: 1,
    showSize: true,
    itemsSelector: 'files',
    async ready(){
        if(this.$item){
            this.$context =  this.$item;
            this.$item = undefined;
            this.$item = await this.$context.storage_folder;
        }
    },
    $public:{
        get allowUse(){
            return this.$item?.connstructor?.name !== '$file'
        }  
    }



}