ODA({is: 'oda-tokenizer',
    template: /*html*/ `
        <style>
            :host{
                @apply --vertical;
                /*@apply --dark;*/
                overflow: hidden;
                height: 300px;
            }
            span{
                padding: 4px;
                width: 50px;
                font-size: small;

            }
        </style>
        <div class="bold horizontal header">
            <span>token</span>
            <span>stat</span>
            <span flex>vector</span>
            <span>error</span>
        </div>
        <div flex style="overflow-y: auto;">
            <div raised ~for="tokenizer?.vocabulary" vertical @tap="focused_token = $for.key" :focused="focused_token === $for.key">
                <div class="horizontal">
                    <span dark no-flex>{{show_key($for.key)}}</span>
                    <oda-button style="width: 30px; margin: 2px; padding: 0px; border-radius: 4px;" header :label="~~$for.item.stat?.length" :disabled="!$for.item.stat?.length" @tap="show_next_tokens($event, $for.item.stat)"></oda-button>
                    <div class="flex" ~style="getBackGradient($for.item.emb? $for.item.emb.data: 0)"></div>
                    <span style="text-align: right; font-size: x-small;" dark :error="$for.item.error" no-flex>{{($for.item.error || '').toLocaleString('ru-RU', {style: 'percent',  minimumFractionDigits: 2, maximumFractionDigits: 2})}}</span>
                </div>
            </div>
        </div>
        <div class="horizontal header bold">
            <span>tokens: {{this.tokenizer?.size || 0}}</span>
            <span flex></span>
            <span  style="text-align: right;">{{tokenizer?.error.toLocaleString('ru-RU', {style: 'percent',  minimumFractionDigits: 2, maximumFractionDigits: 2})}}</span>
        </div>
        <progress no-flex style="width: 100%" max="100" :value="progress"></progress>
    `,
    set tokenizer(n){
        n.onProgress = this.onProgress.bind(this);
    },
    progress: 0,
    async onProgress(progress = 0){
        await new Promise(resolve=>{
            this.progress = progress;
            requestAnimationFrame(()=>{
                resolve();
            })
        })
    },
    focused_token: '',
    get error(){
        return this.tokenizer?.error;
    },
    get size(){
        return this.tokenizer?.size;
    },
    getBackGradient(vector){
        return {background: `linear-gradient(to right, ${this.getColors(vector)})`}
    },
    getColors(items){
        const getColor = (val)=>{
            return Math.round(300 * val);
        }
        const length = items.length
        return  Array.from(items || []).map((val, idx, items)=>{
            return `hsl(${getColor(val)}, 100%, 50%) ${((idx+1)/length) * 100}%, hsl(${getColor(items[idx+1] || 0)}, 100%, 50%)  ${((idx+1)/length) * 100}%`;
        }).join(', ');
    },
    show_key(key) {
        switch( key ) {
            case '\n':
                return '\\n';
            case '\r':
                return '\\r';
            case '\t':
                return '\\t';
        }
        key = key.replaceAll(' ', '_')
        return key;
    },
    async show_next_tokens(e, list){
        try {
            let vocabulary = this.tokenizer.vocabulary;
            list = Object.entries(list);
            list = list.toSorted((a, b) => b[1] - a[1]);
            list = list.map(word => {
                return {  
                    get icon(){
                        let type = vocabulary[word[0]].t;
                        switch(type){
                            case 'space':
                                return `box:i-space-bar`;
                            case 'end':
                                return `bootstrap:dot`;
                            case 'divider':
                                return `iconoir:divide-selection-2`;
                            case 'quote':
                                return `carbon:quotes`;
                            case 'symbol':
                                return `box:i-math`;
                            case 'digits':
                                return `carbon:string-integer`;
                            case 'more':
                                break;
                        }
                        return `carbon:text-font`;
                    }, 
                    label: `${word[1]}`
                };
            });
            const res = await ODA.showDropdown('oda-menu', {items:list} );
            const choice = res.control.focusedItem.label.split('\"')[1];
            this.focused_token = choice;
            this.async(()=>{
                this.$('div[focused]').scrollIntoViewIfNeeded();
            }, 300);
        }
        catch (e) {
            //console.error(e);
        }
    }
})