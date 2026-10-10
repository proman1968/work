import '/oda/components/button/button.js'
import '/oda/components/structure/form/form.js'
import '/oda/components/layouts/splitter/splitter.js'
import '/oda//table/lib/body.js'
import '/oda//table/lib/panel.js'
import '/oda//table/lib/header.js'
import '/oda//table/lib/footer.js'
/**
 * oda-table — таблица: виртуализация строк, дерево строк, группировка, дерево колонок, фиксированные колонки,
 * сортировка и фильтр, ширина колонок (ручная, по содержимому), контролы ячеек по карте controls (oda-structure),
 * мини-форма строки в боковой панели.
 */
ODA({is: 'oda-table', extends: 'oda-structure',
    $public:{
        /** правка ячеек контролами (иначе контролы только отображают значение) */
        editable: {
            $def: false,
            $attr: true
        },
        /** строка поиска по видимым колонкам */
        filter: '',
        /** ширина колонок по содержимому при смене данных (для колонок без заданной width) */
        autoFit: false,
        /** разрешить боковую панель строки (двойной щелчок / Enter по строке) */
        allowRowPanel: false,
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
        <style>
            .row-panel {
                width: 22em;
                overflow: hidden;
                border-left: 1px solid var(--subtle-border);
                @apply --content;
            }
            .row-panel-title {
                align-items: center;
                gap: var(--space-s);
                padding: var(--space-xs) var(--space-xs) var(--space-xs) var(--space-m);
                font-weight: 600;
            }
            .row-panel oda-form {
                overflow: auto;
                padding: var(--space-s);
                --form-label-width: 40%;
            }
        </style>
        <oda-table-panel ~if="showGroupPanel"></oda-table-panel>
        <div horizontal flex style="overflow: hidden;">
            <div id="container" vertical header flex style="overflow-y: auto;" ~style="{overflowX: autoWidth?'hidden': 'auto'}" @scroll>
                <oda-table-header></oda-table-header>
                <oda-table-body flex :even-odd  ~style="{top: (showHeader?$('oda-table-header')?.offsetHeight:0) + 'px'}"></oda-table-body>
                <div vertical flex content style="position: relative; z-index: 0;" ~style="{minHeight: scrollExpand + 'px'}">
                    <oda-table-row flex></oda-table-row>
                </div>
                <oda-table-footer ~if="showFooter"></oda-table-footer>
            </div>
            <oda-splitter ~if="rowPanelShown" left min="160"></oda-splitter>
            <div ~if="rowPanelShown" class="row-panel" vertical no-flex>
                <div class="row-panel-title" horizontal no-flex header>
                    <span flex>{{rowTitle}}</span>
                    <oda-button icon="icons:close" :icon-size title="Закрыть" @tap="rowPanelOpen = false"></oda-button>
                </div>
                <oda-form flex dense :fields="rowFields" :data="focusedRow" :controls :readonly="!editable" @field-changed="onRowFormChanged($event)"></oda-form>
            </div>
        </div>
    `,
    '@system':{
        get table(){
            return this;
        },
        get treeColumn(){
            return this.columnsList.find(i=>i.treeMode);
        },
        get footerHeight(){
            return this.$('oda-table-footer')?.offsetHeight || 0;
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
        /** данные после фильтра и сортировки (новые массивы; сами строки — те же объекты) */
        get preparedData(){
            const filters = (this.visible_columns ?? []).filter(c => c.name && c.$element?.filter).map(c => [c.name, c.$element.filter.toLowerCase()]);
            const search = String(this.filter ?? '').toLowerCase();
            const names = (this.visible_columns ?? []).map(c => c.name).filter(Boolean);
            const sorts = (this.sorts_columns ?? []).map(c => [c.name, Math.sign(c.$element.sortOrder)]);
            const text = (row, name) => String(row[name] ?? '').toLowerCase();
            const own = row => filters.every(([n, f]) => text(row, n).includes(f)) && (!search || names.some(n => text(row, n).includes(search)));
            const compare = (a, b) => {
                for (const [n, dir] of sorts) {
                    const x = a[n], y = b[n];
                    if (x === y) continue;
                    if (x === undefined || x === null) return 1;
                    if (y === undefined || y === null) return -1;
                    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
                }
                return 0;
            };
            const prepare = rows => {
                let res = rows;
                if (filters.length || search || sorts.length)
                    for (const r of res)
                        if (r.items?.length) CHILDREN.set(r, prepare(r.items));
                if (filters.length || search)
                    res = res.filter(r => own(r) || CHILDREN.get(r)?.length);
                if (sorts.length)
                    res = [...res].sort(compare);
                return res;
            };
            CHILDREN = new WeakMap();
            return prepare(this.dataSet ?? []);
        },
        get items(){
            if (!this.dataSet?.length) return [];
            return extract(this.preparedData, 0, undefined, !!(this.filter || this.visible_columns?.some(c => c.$element?.filter)));
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
        /** строка, открытая в боковой панели */
        rowPanelOpen: false,
        get rowPanelShown(){
            return this.allowRowPanel && this.rowPanelOpen && !!this.focusedRow && !this.focusedRow.isGroup && !this.focusedRow.isRaised;
        },
        /** поля мини-формы строки — листовые колонки */
        get rowFields(){
            return this.flat_columns.filter(c => c.name && !c.items?.length).map(c => this.cellField(this.focusedRow, c));
        },
        get rowTitle(){
            const col = this.treeColumn ?? this.flat_columns.find(c => c.name);
            return String(this.focusedRow?.[col?.name] ?? '');
        },
        onRowFormChanged(e){
            const { field, value, data } = e.detail.value;
            this.items = undefined;
            this.fire('cell-changed', { row: data, column: this.flat_columns.find(c => c.name === field.id), value });
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
                let columns = flat(this.columnsList);
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
            },
            /** сортировка только по колонке: dir 1 / -1, 0 — сброс */
            sortBy(column, dir){
                for (const c of this.flat_columns)
                    if (c.$element) c.$element.sortOrder = c === column ? dir : 0;
            },
            /** ширина колонки по содержимому (заголовок и первые 500 строк данных) */
            fitColumn(column){
                const el = column.$element;
                if (!el || !column.name)
                    return;
                const ctx = CANVAS.getContext('2d');
                ctx.font = getComputedStyle(this).font;
                const rows = this.sortedItems.slice(0, 500);
                let w = ctx.measureText(String(column.label ?? column.name)).width + this.iconSize * 1.5;
                const options = column.options ?? [];
                const text = v => String(options.find(o => (o?.value ?? o) === v)?.label ?? v ?? '');
                // у контрола (выбор, дата…) — место под его кнопку
                const extra = this.cellControl(this.cellField(undefined, column)) ? this.iconSize * 1.5 : 0;
                for (const row of rows)
                    w = Math.max(w, ctx.measureText(text(row[column.name])).width + this.iconSize + extra
                        + (column.treeMode ? (row.level + 1) * this.treeStep + (this.allowCheck !== 'none' ? this.iconSize : 0) : 0));
                w = Math.min(600, Math.max(el.minWidth, Math.ceil(w)));
                el.style.width = w + 'px';
                el.width = w;
                this.col_styles = undefined;
            },
            /** состояние отметки строки с каскадом: down — потомкам, up — пересчёт предков, double — оба */
            setChecked(row, state){
                const mode = this.allowCheck;
                if (row.checked === state)
                    return;
                const down = r => r.items?.forEach(c => { c.checked = state; down(c); });
                row.checked = state;
                if (['down', 'double', 'clear-down', 'clear-double'].includes(mode))
                    down(row);
                if (['up', 'double', 'clear-up', 'clear-double'].includes(mode)) {
                    for (let p = PARENTS.get(row); p; p = PARENTS.get(p)) {
                        const states = new Set(p.items.map(c => c.checked || 'unchecked'));
                        p.checked = states.size > 1 ? 'indeterminate' : [...states][0];
                    }
                }
                this.items = undefined;
                this.fire('checked-changed', { row, state });
            },
            /** описание поля ячейки: колонка ← строка ($fields['*']) ← ячейка ($fields[имя колонки]) */
            cellField(row, column){
                return { ...column, id: column.name ?? column.id, ...row?.$fields?.['*'], ...row?.$fields?.[column.name] };
            },
            /** тег контрола ячейки: field.control / template, иначе по карте controls (без карты — текст) */
            cellControl(field){
                if (field.control || field.template)
                    return field.control || field.template;
                if (this.controls)
                    return this.controlOf(field);
                if (this.cellTemplate !== 'span')
                    return this.cellTemplate;
            },
            /** значение ячейки изменено пользователем */
            setCell(row, column, value){
                if (!this.editable || row[column.name] === value)
                    return;
                row[column.name] = value;
                this.fire('cell-changed', { row, column, value });
            }
        },
        get col_styles(){
            let fix, width, next_fix;
            return this.visible_columns?.map((col, idx)=>{
                col = col.$element;
                fix = col.fix;
                
                width = col.flex ? Math.ceil(col.getBoundingClientRect().width) : Math.max(col.realWidth || 0, col.minWidth || 0);
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
        /** колонки (columns может быть Promise до загрузки) */
        get columnsList(){
            return Array.isArray(this.columns) ? this.columns : [];
        },
        get cols(){
            const cols = [...this.columnsList]
            if (!this.autoWidth)
                cols.push({ flex: true, order: 1000, disabled: true });
            return cols;
        },
        get groups(){
            let groups =  this.flat_columns.filter(col=>col.$element?.groupOrder > -1);
            if(groups.length)
                return groups;
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
    $observers: {
        _autoFit(dataSet, visible_columns, autoFit){
            if (autoFit)
                requestAnimationFrame(() => visible_columns.filter(c => c.name && !c.width).forEach(c => this.fitColumn(c)));
        }
    }
})

/** родитель строки дерева (для каскадной отметки) */
const PARENTS = new WeakMap();
/** дочерние строки после фильтра и сортировки (исходные items не меняются) */
let CHILDREN = new WeakMap();
const CANVAS = document.createElement('canvas');

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


/** дерево → плоский список видимых строк; при фильтре (open) ветки с совпадениями раскрыты */
function extract(items, level = 0, parent, open = false){
    let result = []
    for (let row of items){
        row.level = level;
        row.expanded ??= false;
        row.checked ??= 'unchecked';
        if (parent)
            PARENTS.set(row, parent);
        result.push(row);
        const children = CHILDREN.get(row) ?? row.items;
        if (children && (row.expanded || open))
            result.push(...extract(children, level + 1, row, open));
    }
    return result;
}