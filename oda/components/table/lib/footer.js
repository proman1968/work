ODA({is:'oda-table-footer',
    template:`
        <style>
            :host{
                @apply --horizontal;
                @apply --dark;
                box-sizing: border-box;
                min-width: max-content;
                position: sticky; 
                bottom: {{row?footerHeight:0}}px; 
                z-index: 2;
                overflow-x: visible;
                border: .05em solid var(--header-background) !important;
                position: sticky;
            }
        </style>
        <oda-table-footer-cell class="cell" ~for="columns" :part="'cell-' + $for.index"></oda-table-footer-cell>
    `,
    get row(){
        return this.$for?.item
    },
    get columns(){
        return this.$pdp.visible_columns
    },
    exportparts:{
        $def: '',
        $attr: true,
        get(){
            return this.columns?.map((_, idx)=>{
                return `cell-${idx}`;
            }).join(',');
        }
    }
})
ODA({is: 'oda-table-footer-cell',
    template:`
        <style>
            :host{
                @apply --horizontal;
                @apply --dark;
                box-sizing: border-box;
                border-left: .05em solid var(--dark-color) !important;
                border-right: .05em solid var(--dark-color) !important;
                align-items: center;
                overflow: hidden;
            }
            label{
                padding: 4px;
                text-overflow: ellipsis;
                white-space: nowrap;
                overflow: hidden;
                text-align: end;
            }
        </style>
        <oda-icon :icon></oda-icon>
        <label class="label flex" ~html="value"></label>

    `,
    aggregate:{
        $save: true,
        $def: 'none',
        $attr: true,
        $list:  {
            '': '@:none',
            'sum': '@:sum',
            'avg': '@:avg',
            'min': '@:min',
            'max': '@:max',
            'count': '@:count',
        }
    },
    get icon(){
        return this[PROPS].aggregate.$list[this.aggregate] || '';
    },
    get row(){
        return this.host.row;
    },
    get value(){
        if(this.row)
            return this.row?.[this.column.name];
    },
    get treeMode(){
        return this.column?.treeMode;
    }, 
    get column(){
        return this.$for.item;
    },
    get $saveKey(){
        return this.column.name || '';
    },
    $listeners:{
        tap(e){
            e.preventDefault();
            let list = this[PROPS].aggregate.$list
            let items = Object.keys(list).map((label, i)=>{
                return {label, execute: () => {
                    this.aggregate = label
                }, icon: list[label]}
            })
            this.showContextMenu({
                anchor: this,
                title: 'aggregate <br><b>'+this.$for.item.$element.label+'</b>',
                style: {
                    left: 'anchor(left)',
                    positionArea: 'top'
       
                },
                items
            })

        }
    }
})