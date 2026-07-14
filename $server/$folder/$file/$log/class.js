export default{
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                padding: 4px 16px;
            }
        </style>    
        <div flex ~html="value" style="white-space: break-spaces; padding-top: 4px; overflow: hidden;"></div>
    `,
    async createEmbeddings(){
        let log = await this.json;
        for(let f of log){
            let file = await WORK.get_item(f.path);
            if(!file) continue;
            let text = await file.load();
            console.log(text);
        }
        return true;
    },
    attached(){
        this.async(()=>{
            this.$pdp.colorMode = 'content';
        }) 
    },
    get value(){
        return this.$item?.load()?.then(text=>{
            return `[${text}]`;
        });
    },
    get json(){
        return this.value?.then(val=>{
            return JSON.parse(val);
        })
    }
}