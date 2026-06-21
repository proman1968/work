ODA({is: 'oda-form',
    template:/* html */`
        <style>
            :host{
                flex-wrap: wrap;
                @apply --horizontal;
                gap: 8px;
                overflow: hidden;
                position: relative;
            }
        </style>
        <oda-form-editor ~for='controls' :meta='$for.item' ::value="data[$for.item.key]"></oda-form-editor>
    `,
    data:{},
    metadata:{},
    get controls(){
        let controls = [];
        for(let key in this.metadata){
            let item = this.metadata[key];
            if(typeof item !== 'object')
                item = {value: item};
            item.is ??= (()=>{
                if(item.items)
                    return 'oda-select';
                return 'input';
            })()
            item.label ??= key;     
            item.value = this.data[key] || item.value;
            controls.push({key, item})
        }
        return controls;
    }
})
ODA({is: 'oda-form-editor',
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
                min-width: 30%;
            }
            label{
                font-size: xx-small;
            }    
            input{
                border: 1px solid var(--light-color);
                padding: 4px;
            }        
        </style>
        <label>{{meta?.item.label}}:</label>
        <input id="editor" ~is="meta?.item.is || 'input'" ::value :item="meta?.item" ~props="meta?.item"></input>  
    `,    
    set meta(n){
        this.value = n?.item.value || '';
    },
    value: ''

})

ODA({is: 'oda-select',
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
            }            
            select{
                padding: 4px; 
            } 
        </style>
        <select flex id="selector" ::value>
            <option ~for="items" :value="$for.item" ~html="String($for.item)"></option>
        </select> 
    `,  
    get items()  {
        return this.item?.items;
    },
    item: null,
    value: ''
})  
ODA({is: 'oda-textarea',
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
            }    
            textarea{
                padding: 4px;
                resize: none;
            }        
        </style>
        <textarea ::value :placeholder></textarea>
    `,   
    placeholder: '' ,
    item: {},
    get textarea(){
        return this.$('textarea');
    },
    value: {
        $def: '',
        set(n){
            if(!this.textarea) return;
            this.textarea.style.height = 'auto';
            this.textarea.style.height = (this.textarea.scrollHeight) + 'px';
        }
    },
    // _onInput(e){
    //     e.target.style.height = 'auto';
    //     e.target.style.height = (e.target.scrollHeight) + 'px';
    // },
}) 