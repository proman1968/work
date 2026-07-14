export default {
    imports: 'oda//code-editor, oda//app-layout, oda//tools/icons/icons-tree/icons-tree.js',
    extends:'oda-app-layout',
    template: /* html */`
        <oda-code-editor slot="main"  class="flex" @change :src></oda-code-editor>
        <oda-icons-tree slot="right-panel" light label="Icons" icon="carbon:image" style="height: 0px;"></oda-icons-tree>
    `,
    _onChange(e){
        // this.$item.isChanged = true;
    },
    $item:null,
    get src(){
        if(this.$item){
            return this.$item.load().then(src=>{
                if(typeof src === 'object')
                    src = JSON.stringify(src, undefined, 4);
                return src;
            })
        }
    }
}
