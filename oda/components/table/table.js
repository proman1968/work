import '/oda//button.js'
import '/oda//table/lib/body.js'
import '/oda//table/lib/panel.js'
import '/oda//table/lib/header.js'
import '/oda//table/lib/footer.js'
ODA({is: 'oda-table',
    $public:{
        '@templates':{
            cellTemplate: 'span',
        },
        iconSize: 24,
        autoWidth: {
            $def: false,
        },
        '@view':{
            showGroupPanel:{
                $def: false,
                $save: true,
            },
            showHeader: false,
            showFooter: false,
            pivotMode:{
                $def: false,
                $save: true,
            },
        },
        '@tree':{
            get treeStep(){
                return this.iconSize;
            },
            hideRoot: false,
            allowCheck:{
                $def: 'none',
                $list: ['none', 'single', 'down', 'up', 'double', 'clear-down', 'clear-up', 'clear-double']
            },
            check(){
                this.items.forEach(i=>i.checked = 'checked');
            },
            uncheck(){
                this.items.forEach(i=>i.checked  = '');
            },
            checkInvert(){
                this.items.forEach(i=>{
                    if(i.checked === 'checked')
                        i.checked = '';
                    else
                        i.checked = 'checked';
                });
            },
        },
        '@columns':{
            allowSort: false,
            showColumnFilter: {
                $def: false,
                $save: true,
            },
            showColumnTools: false,
        },
        '@rows':{
            evenOdd: false,
            rowLines: false,
            get minRowHeight(){
                return Math.ceil(this.iconSize * 1.33333);
            },
            maxRowHeight: 0,
            showGroupFooter: false,
            allowFocus: false,
            allowFixRows: false,
        },
        '@special':{
            hoveringCells:{
                $save: true,
                $def: false,
                icon: 'bootstrap:eyeglasses'
            }
        }
    },
    focusedRow: null,
    template: /*html*/`
        <style>
            :host {
                @apply --flex;
                @apply --vertical;
                overflow: hidden;
                position: relative;
                @apply --light;
            }
            :host(:not([show-header])) oda-table-header{
                position: absolute !important;
                z-index: -1 !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        </style>
        <style>{{col_styles}}</style>
        <oda-table-panel ~if="showGroupPanel"></oda-table-panel>
        <div id="container" vertical header flex style="overflow-y: auto;" ~style="{overflowX: autoWidth?'hidden': 'auto'}" @scroll>
            <oda-table-header></oda-table-header>
            <oda-table-body flex :even-odd  ~style="{top: (showHeader?$('oda-table-header')?.offsetHeight:0) + 'px'}"></oda-table-body>
            <div vertical flex content ~style="{minHeight: scrollExpand + 'px'}">
                <oda-table-row flex style="min-heigth: 100%"></oda-table-row>
            </div>
            <oda-table-footer ~if="showFooter"></oda-table-footer>
        </div>
    `,
    '@system':{
        get table(){
            return this;
        },
        get treeColumn(){
            return this.columns.find(i=>i.treeMode);
        },
        get footerHeight(){
            return this.$('oda-table-fooler')?.offsetHeight || 0;
        },
        get scrollExpand(){
            let h = Math.ceil((this.rowCount + this.raised.length + 1) * this.minRowHeight);
            if(h<0)
                h = 0;
            return  h;
        },
        get container() {
            return this.$('#container') || undefined;
        },
        fixedRows: [],
    },

    '@data-pipe':{
        '@flags': {
            screenTopRowIndex: {
                $def: 0,
            },
            get screenRowCount(){
                return Math.ceil(this.clientHeight / this.minRowHeight);
            },
            rowCount: {
                get(){
                    return this.sortedItems.length;
                }
            },
            scrollToTop(row, focus = false){
                if(typeof row === 'object'){
                    row = this.filteredItems.indexOf(row);
                }
                if(row<0)
                    return;
                this.container.scrollTop = Math.ceil(row * this.minRowHeight) + 1;
                this.screenTopRowIndex = row
                if(focus){
                    this.focusedRow = this.filteredItems[this.screenTopRowIndex];
                }
            }
        },
        dataSet:[],
        get items(){
            if (!this.dataSet?.length) return [];
            let items =  extract(this.dataSet);
            return items;
        },
        get filteredItems(){
            return this.groupedItems;
        },
        group_items: {},
        get groupedItems(){
            if(!this.groups?.length)
                return this.items;
            const grouping = (items, parent = '', level = 0)=>{
                let group_layer = this.groups[level];
                if(!group_layer){
                    if(this.$pdp.showGroupFooter)   {
                        let footer = items.find(i=>i.is === 'oda-table-footer')
                        if(!footer){
                            footer = {is: 'oda-table-footer'};
                            this.visible_columns.forEach(column=>{
                                if(!column.name)
                                    return;
                                if(column.treeMode)
                                    footer[column.name] = items.length;
                            })
                            items.push(footer);
                        }
                    } 
                    return items;
                }
                let group_map = this.group_items[parent + '/' + group_layer.name] ??= {};
                Object.values(group_map).forEach(i=>{
                    if(i.expanded)
                        i.items = [];
                    else
                        i.items = [i];
                })
                let group_item;
                for(let item of items){
                    if(item.level) 
                        continue;
                    let value = item[group_layer.name] ?? ' ';
                    let name = group_layer.$element.label + ': ' + value;
                    let group = group_map[name] ??= {name, items: [], isGroup: true, level, value};
                    if(group_item !== group){
                        group.expanded ??= false;   
                        if(!group.expanded){
                            group.items = [group];
                        }
                        group_item = group;
                    }   
                    if(group_item.expanded)  
                        group_item.items.push(item);
                }   
                group_map = sort(Object.values(group_map), 'value', group_layer.$element.groupSort);
                let result = []
                for(let group of group_map){
                    result.push(group);
                    if(!group.expanded) continue;
                    group.items = grouping(group.items, parent + '/' + group.name, level + 1);
                }
                return result;
            }     

            let group_items = grouping(this.items);
            group_items = extract(group_items);
            return group_items;
        },
        get sortedItems(){
            return this.filteredItems;
        },
        raised: [],
        get rows(){
            
            let raised = [];
            const rows = this.sortedItems.slice(this.screenTopRowIndex, this.screenTopRowIndex + this.screenRowCount);
            if (this.allowFixRows) {
                let group_length = this.groups?.length;
                let topIndex = this.screenTopRowIndex;
                let row = this.sortedItems[topIndex];
                let count = 0;
                let stack = [];
                let before = [];
                while(topIndex--){
                    let prev = this.sortedItems[topIndex];
                    if(!prev)
                        break;
                    if(prev.level < row.level){
                        let name = prev[this.treeColumn.name] || prev.name;
                        let level = prev.level;
                        let group = {name, isRaised: true, level, source: prev, count,
                            get expanded(){
                                return this.source.expanded;
                            },
                            set expanded(n){
                                if(n !== undefined)
                                    this.source.expanded = n;
                            }
                        };
                        if(prev.isGroup)
                            group.isGroup = prev.isGroup;
                        group.items = [group];
                        if(before[level] !== undefined){
                            group.level = 0;
                            stack.unshift(group);
                        }
                        else if(stack.length){
                            group.items.push(...stack);
                            raised.unshift(group);
                            stack.clear();
                        }
                        else{
                            raised.unshift(group);
                        }
                    }
                    else if(prev.level > row.level){
                        continue;   
                    }
                    else{
                        if(prev.level === 0)
                            break;
                        count++;
                    }
                    row = prev;
                }
            }
            this.raised = raised;
            return [...this.fixedRows, ...raised, ...rows];
        }
    },
    '@events': {
        _onScroll(e) {
            let val = Math.floor(e.target.scrollTop / this.minRowHeight); 
            this.debounce('-scroll-', ()=>{ 
                this.screenTopRowIndex = val;
            })
        },
        _onDragenter(e) {
            e.target.classList.add('error');
        },
        _onDragleave(e) {
            e.target.classList.remove('error');
        },
        _onDelete_drop(e) {
            drag.item.hidden = true;
            e.target.classList.remove('error');
        },
        $listeners:{
            resize(e){
                queueMicrotask(()=>{
                    this.screenRowCount = undefined;
                    this.col_styles = undefined;                   
                })
     
            }
        }
    },
    '@columns': {
        colLines: false,
        get sorts_columns() {
            let columns = this.visible_columns?.filter(i => i.$element?.sortOrder);
            return columns?.sort((a, b) => {
                return Math.abs(a.sortOrder) > Math.abs(b.sortOrder) ? 1 : -1;
            });
        },
        flat_columns:{
            $def: [],
            get(){
                function flat(cols){
                    cols = cols?.reduce((res, item)=>{
                        res.push(item);
                        let items = item.items
                        if (items?.length){
                            items = flat(items);
                            res.push(...items);
                        }   
                        return res;
                    }, []) || [];
                    return cols;
                }
                let columns = flat(this.columns);
                return columns;
            }
        },
        '@functions':{
            collapse(){
                this.items.forEach(i=>{
                    if(i.expanded && !i.items?.some(i=>i.expanded))
                        i.expanded = false;
                })
                this.items = undefined;
            },
            expand(){
                this.groupedItems.forEach(i=>{
                    i.expanded = true;
                })
                this.items = undefined;
            },
            collapseAll(){
                this.items.forEach(i=>{
                    i.expanded = false;
                })
                this.items = undefined;
            },
            expandAll(){
                this.groupedItems.forEach(i=>{
                    i.expanded = true;
                })
                this.items = undefined;
            },
            home(){
                this.container.scrollTop = 0;
            }
        },
        get col_styles(){
            let fix, width, next_fix;
            return this.visible_columns?.map((col, idx)=>{
                col = col.$element;
                fix = col.fix;
                
                width = col.width || Math.ceil(col?.getBoundingClientRect?.()?.width);
                let styles = `*::part(cell-${idx}){
                    min-width: ${width}px;
                    max-width: ${width}px;
                    width: ${width}px;
                    left: ${fix === 'left'?col._sticky_left+'px':'unset'};
                    right: ${fix === 'right'?col._sticky_right+'px':'unset'};
                    position: ${fix?'sticky':'relative'};
                    z-index: ${fix?2:0};`
                next_fix = this.visible_columns[idx + 1]?.fix;
                if(fix){
                    styles += '\nfilter: brightness(0.9);'
                }
                if (fix === 'right'){
                    if(next_fix){
                        col.fixBorder = fix;
                    } 
                    else   {
                        col.fixBorder = ''
                    }
                        
                }
                else if(fix === 'left' && !next_fix){
                    col.fixBorder = fix;
                }
                else{
                    col.fixBorder = ''
                }
                    
                styles += '\n}'
                return styles;
    
            }).join('\n');
        },
        columns: [],
        get cols(){
            const cols = [...this.columns]
            if (!this.autoWidth)
                cols.push({ flex: true, order: 1000, disabled: true, flex: true});
            return cols;
        },
        get groups(){
            let groups =  this.flat_columns.filter(col=>col.$element?.groupOrder > -1);
            if(groups.length)
                return groups;
        },
        set groups(n){
            console.warn(n)
        },
        visible_columns:{
            $def: [],
            get(){
                function flat(items){
                    let columns = items.filter(i=>i.$element && !i.$element.hidden).map(i=>i.$element)
                    columns =  sort(columns);
                    const result = [];
                    for (let col of columns){
                        if (col.column.items?.length && col.expanded)
                            result.push(...flat(col.column.items))
                        else
                            result.push(col)
                    }
                    return result;
                }
                const columns = flat(this.cols);
                return columns.length?columns.map(i=>i.column):undefined
            }
        },
    },

})

export function getSortedChildren(el){
    return sort(el.children, 'real_order');
}
export function sort(items, prop = 'real_order', dir = 1){
    return Array.from(items).sort((a, b)=>{
        if (b[prop] > a[prop]) return -1 * dir;
        if (b[prop] < a[prop]) return 1 * dir;
        return 0;
    })
}
export const drag = {}


function extract(items, level = 0){
    let result = []
    for (let row of items){
        row.level = level;
        row.expanded ??= false;
        row.checked ??= 'unchecked';
        result.push(row);
        if (row.items && row.expanded)
            result.push(...extract(row.items, level + 1));
    }
    return result;
}