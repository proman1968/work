export default {
    imports: 'oda//code-editor, oda//app-layout, oda//tools/icons/icons-tree/icons-tree.js',
    fileControl: 'oda-devs-viewer',
    allowSave: true,
}

ODA({
    is: 'oda-devs-viewer',
    extends: 'oda-app-layout',
    template: /* html */`
        <oda-code-editor slot="main" class="flex" @change :src></oda-code-editor>
        <oda-icons-tree slot="right-panel" light label="Icons" icon="carbon:image" style="height: 0px;"></oda-icons-tree>
    `,
    $item: {
        $def: null,
        set(n) {
            if (n) {
                this.$item = n;
            }
        }
    },
    get src(){
        if(this.$item){
            return this.$item.load().then(src=>{
                if(typeof src === 'object')
                    src = JSON.stringify(src, undefined, 4);
                return src;
            })
        }
    }
})