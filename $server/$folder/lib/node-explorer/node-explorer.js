export default {
    imports: '~/lib//node',
    template: /*html*/`
        <style>
            :host {
                justify-content: flex-start;
                @apply --horizontal;
                flex-wrap: wrap;
                overflow: hidden;

            }            
            item-node:not(:first-child){
                max-width: 200px;
            }
            div {
                opacity: .9;
                overflow: hidden;
            }
            div:hover {
                opacity: 1;
            }
            oda-icon{
                scale(0.8);
                transition: scale, opacity .3s ;
                cursor: pointer;
                display: block;
                align-self: center;
                opacity: .5;
            }
            oda-icon:hover{
                scale(1.3);
                opacity: .9;
            }
            ::slotted(*){
                align-self: center;
            }
        </style>
        <div
            ~for="levels"
            :item="$for.item"
            :focused="focusedItem === $for.item"
            :success="focusedItem === $for.item"
            class="horizontal ellipsis"
            style="flex-direction: initial;"
            @tap="setFocus($for.item)"
        >
            <item-node is-explorer :icon-size 
                :$item="$for.item"
                class="flex ellipsis"
            ></item-node>
            <oda-icon
                ~if="$for.item?.path?.length>1"
                :icon-size
                :icon="get_icon($for.item)"
                class="no-flex"
                title="Go to parent"
                @down.stop
                @tap.stop="expand($for.item)"
            ></oda-icon>
        </div>
        <slot no-flex></slot>        
    `,
    async get_icon(item){
        let last_item = (await this.levels).last
        return this.nextIcon + (last_item !== item?':180':'');
    },
    iconSize: 24,
    nextIcon: 'icons:chevron-right',
    focusedItem: null,
    levels: {
        $type: Array,
        async get() {
            let item = this.$item;
            const result = [item];
            while (item && item !== this.expandedItem) {
                item = await item.parent;
                if (item ) {
                    result.push(item);
                }
            }
            return result;
        }
    },
    setFocus(item) {
        this.focusedItem = (this.allowFocus) ? item : null;
    },
    deep: {
        $def: 0,
        $attr: true,
    },
    get expandedItem() {
        this.async(()=>{
            return this.expand(this.$item, this.deep);
        }, 200)
        return this.$item;
    },
    async expand(item, deep = 100) {
        if(item === this.expandedItem){
            let type = item.type;
            while (deep > 0 &&item && item?.type === type){
                item = await item.parent;           
                deep--;
            }      
        }
        this.expandedItem = item;
    }
}

