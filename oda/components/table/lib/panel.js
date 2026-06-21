import * as utils from '../table.js'
ODA({is: 'oda-table-panel',
    template: /*html*/`
    <style>
        :host {
            @apply --header;
            @apply --horizontal;
            @apply --no-flex;
            overflow: hidden;
            border-bottom: 1px solid var(--dark-background) !important;
            align-items: center;
            font-family: monospace;
        }
    </style>   
    <oda-table-groups class="flex horizontal"></oda-table-groups>
    <span>{{screenTopRowIndex}}</span>
    <input type="checkbox" ::checked="autoWidth">
    `,

});
ODA({is: 'oda-table-groups',
    template: /*html*/`
        <style>
            :host{
                @apply --horizontal;
                @apply --flex;
                overflow: hidden !important;   
      
            }
            label{
                align-self: center;
                transition: transform .2s;
                transform-origin: left;
                padding: 4px;
                min-height: 100%;
            }
            label:hover{
                transform: scale(1.5);
                
            }
        </style>
        <oda-icon :disabled="!groups?.length" :icon-size icon="icons:dns" style="align-self: center;"></oda-icon>
        <label no-flex ~if="!groups?.length">Drag columns here to set row groups...</label>
        <div class="flex horizontal" style="overflow: hidden;">
            <oda-table-group-cell
                draggable="true"
                ~for="groups" 
                :column="$for.item.$element" 
            ></oda-table-group-cell>

        </div>
    `,
    $listeners: {
        dragover(e) {
            if (utils.drag.type !== 'column-move')
                return;
            e.preventDefault();
            this.dropReciver = true;
        },
        dragleave(e) {
            this.dropReciver = false;
        },
        drop(e) {
            this.dropReciver = false;
            e.stopPropagation()
            utils.drag.item.groupOrder = this.$pdp.groups?.length || 0;
            this.$pdp.items = undefined;
            
        }
    },
    dropReciver: {
        $def: false,
        $attr: true
    }
})
ODA({is: 'oda-table-group-cell', 
    template: /*html*/`
        <style>
            :host{
                @apply --horizontal;
                @apply --flex;
                @apply --dark;
                margin: 2px;
                align-items: center;
                text-overflow: ellipsis;
                white-space: nowrap;
                overflow: hidden;
                border-radius: 8px;
                padding: 2px;
                flex-grow: unset;
                gap: 2px;
                position: relative;
                
            }
            label{
                min-width: 20px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: pre;
                @apply --light;
                padding: 0px 8px;
                border-radius: 6px;
                align-content: center;
                align-self: normal;
                cusror: pointer;
            }
            oda-icon {
                cursor: pointer;
                position: absolute;
                left: -25%;
                top: -25%;
            }
            .closer:hover{
                @apply --error;
            }
            oda-button{
                border-radius: 50%;
            }
        </style>

        <label class="label flex" ~html="label"></label>
        <div horizontal style="position: relative;">
            <oda-icon :icon-size="iconSize * .7"
                ~if="allowSort && sort"
                :icon="sortIcon"
                title="sort"
            ></oda-icon>
            <oda-button class="closer" no-flex icon="icons:close" :icon-size="iconSize * .7" @tap></oda-button>
        </div>
       

        
    `,
    get label(){
        return this.column.path
    },
    column: null,
    get $saveKey(){
        return this.column.$saveKey;
    },
    get sort(){
        return this.column.groupSort;
    },
    set sort(n){
        this.column.groupSort = n;
    },
    get sortIcon() {
        switch(this.sort){
            case -1:{
                return '@:▼';
            } break;
            case 1:{
                return '@:▲';
            } break;
        }
        return '';
    },
    $listeners:{
        dragstart(e){
            e.stopPropagation();
        },
        tap(e){
            if (!this.$pdp.allowSort) return;
            switch(this.sort){
                case 0:{
                    this.sort = 1; 
                } break;
                case 1:{
                    this.sort = -1;
                } break;
                default:{
                    this.sort = 0;
                } break;
            }
        }
    },
    _onTap(e){
        this.column.groupOrder = -1;
    }
});