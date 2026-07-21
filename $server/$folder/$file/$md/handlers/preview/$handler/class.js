export default {
    imports: '/oda//markdown-viewer/markdown-viewer.js',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
            }
            oda-markdown-viewer{
                max-width: 100%;
                overflow-x: auto;
            }
        </style>
        <oda-markdown-viewer :value class="flex"></oda-markdown-viewer>
    `,
    attached(){
        this.async(()=>{
            this.$pdp.colorMode = 'content';
        }) 
    },
    set $item(n){
        if(n){
            n.load().then(content=>{
                const base = n.short || n.path || '';
                const File = CORE.$file || n.constructor;
                let text = content;
                if (typeof File.fixWorkMdLinks === 'function')
                    text = File.fixWorkMdLinks(text, base);
                if (typeof File.fixMdHistoryLinks === 'function')
                    text = File.fixMdHistoryLinks(text);
                this.value = text;
            })
        }
    },
    value: '',

}
