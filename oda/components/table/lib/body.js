ODA({is:'oda-table-body', imports: 'oda//checkbox',
    template:/*html*/`
        <style>
            :host{
                @apply --vertical;
                @apply --light;
                box-sizing: content-box;
                @apply --content;
                max-height: 0px;
                min-width: max-content;
                position: sticky;
                z-index: 1;
            }
            :host([even-odd]) .row[odd]{
                filter: brightness(.98)
            } 
            .group{
                align-items: center;
            }
        </style>
        <oda-table-row class="row" ~for="rows" ~is="$for.item.is"></oda-table-row>
    `
})

ODA({is: 'oda-table-row',
    template: /*html*/`
        <style>
            :host{
                @apply --horizontal;
                @apply --no-flex;
                @apply --content;
                box-sizing: border-box;
                width: max-content;
            }
            :host([row-lines]){
               border: .05em solid var(--header-background);
            }
            :host([is-group]){
                @apply --dark;
            }
            :host([is-raised]){
                @apply --header;
                border-color: var(--dark-background) !important;
            }
            :host([is-special-row]){
                flex-wrap: wrap;
            }
            .cell[part^=cell--]{
                font-weight: bold;
                cursor: pointer !important;
                border: none !important;
            }
            .cell:focus{
                outline: 1px dotted blue;
                outline-offset: -1px;
            }                
        </style>
        <style>
            :host{
                min-height: {{minRowHeight}}px;
                max-height: {{maxRowHeight?maxRowHeight + 'px': 'unset'}};
            }
        </style>

        <oda-table-cell class="cell" ~for="columns"></oda-table-cell>
    `,
    expanded:{
        get(){
            return this.row?.expanded;
        },
        set(n){
            if(n === false){
                this.$pdp.table.fire('before-collapse', this.row);
                this.row.expanded = n;
                if(this.row.isRaised){
                    this.$pdp.scrollToTop(this.column?.row.source);
                }
                queueMicrotask(()=>{
                    this.$pdp.table.fire('after-collapse', this.row);
                })
            }
            else if(n === true){
                this.$pdp.table.fire('before-expand', this.row);
                this.row.expanded = n;
                this.$pdp.items = undefined;
                queueMicrotask(()=>{
                    this.$pdp.table.fire('after-expand', this.row);
                })
            }
        }
    },
    get columns(){
        if(this.row?.isRaised){
            return this.row.items.map((row, i)=>{
                let name = 'group' + i;
                this.row[name] = row.name;
                return {name, treeMode: true, row}
            })
        
        }
        if(this.row?.isGroup){
            return [{name: 'name', treeMode: true}]
        }
        return this.$pdp.visible_columns;
    },
    get row(){
        return this.$for?.item
    },
    rowLines:{
        $def: false,
        $attr: true,
        get(){
            return this.host.$pdp.rowLines;
        }
    },
    isGroup:{
        $def: false,
        $attr: true,
        get(){
            return this.row?.isGroup;
        }
    },
    isRaised:{
        $def: false,
        $attr: true,
        get(){
            return this.row?.isRaised;
        }
    },
    isSpecialRow:{
        $def: false,
        $attr: true,
        get(){
            return this.isRaised || this.isGroup;
        }
    },
    odd:{
        $def: false,
        $attr: true,
        get (){
            return (this.$pdp.sortedItems?.indexOf(this.row) % 2);
        }
    },
    focused:{
        $def: false,
        $attr: true,
        get(){
            return this.$pdp.allowFocus && !this.isGroup &&  this.$pdp.focusedRow === this.row;
        }
    },
    tabindex:{
        $def: false,
        $attr: true,
        get(){
            return this.isSpecialRow?(this.$for.index * 1000):false;
        }
    },
    exportparts:{
        $def: '',
        $attr: true,
        get(){
            if(this.isSpecialRow) return 'cell--1';
            return this.columns?.map((_, idx)=>{
                return `cell-${idx}`;
            }).join(',');
        }
    },
    $listeners:{
        tap(e){
            this.$pdp.focusedRow = this.row;
        }
    }
})

ODA({is:'oda-table-cell',
    template: /*html*/`
        <style>
            :host{
                @apply --content;
                @apply --horizontal;
                position: sticky;
                left: 0px;
                overflow: hidden;
                box-sizing: content-box;

            }
            :host([col-lines]){
                border-left: .05em solid var(--header-background) !important;
                border-right: .05em solid var(--header-background) !important;
            }
            :host(:hover){
                @apply --hover;
            }
            :host([disabled]) {
                opacity: 0.5;
                pointer-events: none;
            }
            :host([is-raised]){
                @apply --header;
                border: none !important;
            }
            :host([is-group]){
                @apply --dark;
                border: none !important;
            }
            :host([is-group]) > .container, div{
                align-self: center !important;
                white-space: nowrap !important;
            }
            :host([tree-mode]) > .container, div{
                align-self: center !important;
                
            }
            .container{
                @apply --flex;
                @apply --vertical;
                text-overflow: ellipsis;
                align-self: baseline;
                overflow: hidden;
            }
            oda-icon{
                cursor: pointer;
            }   
            label{
                margin: 4px;
            } 
            div{
                position: relative;
            } 
            :host(:focus) {
                @apply --active;
            }
        </style>
        <div ~if="treeMode" horizontal @down.stop ~style="{paddingLeft: (level * $pdp.treeStep) + 'px'}">
            <style>
                .checkbox{
                    transform: scale(.8);
                    margin: 0px 4px 0px 0px;
                    width: {{iconSize}}px;
                    max-width: {{iconSize}}px;
                    min-width: {{iconSize}}px;              
                    height: {{iconSize}}px;
                    min-height: {{iconSize}}px;
                    max-height: {{iconSize}}px;
            }                
            </style>
            <oda-icon ~if="showExpander" :transparent="!row?.items?.length" icon="icons:chevron-right" 
                :rotate="(row?.expanded)?90:0" @tap.stop="host.expanded = !host.expanded"></oda-icon>
            <span disabled ~if="subCount" style="align-self: end; font-size: xx-small; position: absolute; right: 0px;">{{subCount}}</span>
            <oda-checkbox ~if="showCheckbox && row" class="checkbox" ::state="row.checked"></oda-checkbox>
            
        </div>
        <span ~is="$pdp.cellTemplate" :$item="value" ~html="value"></span>
    `,
    colLines:{
        $def: false,
        $attr: true,
        get(){
            return this.host.$pdp.colLines;
        }
    },
    get showExpander(){
        return !this.$pdp.hideRoot || this.level;
    },
    $listeners: {
        tap(e){
            if(this.isRaised){
                e.stopPropagation();
                e.preventDefault();
                this.$pdp.scrollToTop(this.column?.row.source, true);
            }
        },
        down(e) {
            if(e.button) return;
            e.preventDefault();
            this.focus();
            this.$pdp.focusedRow = this.row;
        },
        keydown(e) {
            const container = this.$pdp.container;
            if (!container) return;

            const currentRow = this.host;
            const rowHeight = currentRow.offsetHeight;

            const handlers = {
                ArrowLeft: () => {
                    const prevCell = this.previousElementSibling;
                    if (prevCell?.matches('oda-table-cell')) prevCell.focus();
                },
                ArrowRight: () => {
                    const nextCell = this.nextElementSibling;
                    if (nextCell?.matches('oda-table-cell')) nextCell.focus();
                },
                ArrowUp: () => {
                    const prevRow = currentRow.previousElementSibling;
                    if (!prevRow && this.$pdp.screenTopRowIndex > 0) {
                        container.scrollTop = Math.max(0, container.scrollTop - rowHeight);
                        return;
                    }
                    const targetCell = prevRow?.querySelector(`oda-table-cell[col="${this.colId}"]`);
                    if (targetCell) targetCell.focus();
                },
                ArrowDown: () => {
                    const nextRow = currentRow.nextElementSibling;
                    const currentBottom = currentRow.offsetTop + rowHeight;
                    const visibleBottom = this.$pdp.bodyHeight;
                    
                    if (currentBottom > visibleBottom - rowHeight && 
                        this.$pdp.screenTopRowIndex + this.$pdp.screenRowCount < this.$pdp.rowCount) {
                        container.scrollTop += rowHeight;
                        return;
                    }
                    const targetCell = nextRow?.querySelector(`oda-table-cell[col="${this.colId}"]`);
                    if (targetCell) targetCell.focus();
                },
                Space: (e) => {
                    this.$pdp.focusedRow = this.row;
                },
                Enter: (e) => {
                    this.$pdp.focusedRow = this.row;
                }
            };

            if (handlers[e.key]) {
                e.preventDefault();
                handlers[e.key]();
            }
        }
    },
    get showCheckbox(){
        return !this.isGroup && !this.disabled && this.$pdp.allowCheck !== 'none';
    },
    get order(){
        return this.column?.$element?.order || 0;
    },
    tabindex:{
        $attr: true,
        get(){
            return this.disabled?false:(this.host.tabindex + this.order);
        }
    },
    treeMode:{
        $type: Boolean,
        $attr: true,
        get(){
            return this.column.treeMode;
        }
    },
    isGroup:{
        $def: false,
        $attr: true,
        get(){
            if(this.column?.row)
                return this.column?.row?.isGroup;
            return this.$pdp.row?.isGroup;
        }
    },
    isRaised:{
        $def: false,
        $attr: true,
        get(){
            return this.$pdp.row?.isRaised;
        }
    },
    disabled: {
        $attr: true,
        $type: Boolean,
        get() {
            return this.column?.disabled;
        }
    },
    get column(){
        return this.$for.item;
    },
    get col_name(){
        return this.column?.name;
    },
    get value(){
        return this.col_name && this.$pdp.row?.[this.col_name];
    },
    part:{
        $attr: true,
        get(){
            return 'cell-' + (this.$pdp.isSpecialRow?-1:this.$for.index);
        }
    },
    get level(){
        return this.column?.row?.level ?? this.$pdp.row?.level ?? 0;
    },
    get subCount(){
        return this.column?.row?.count;
    }

})
