/** связь «дескриптор колонки -> ячейка заголовка» (без мутации данных колонок) */
const CELL_CTL = new WeakMap();

ODA({is: 'oda-tree', imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                width: 100%;
                max-width: 100%;
                min-width: 0;
                box-sizing: border-box;
                overflow: hidden;
            }
        </style>
        <style>{{cells_style}}</style>
        <div ~if="allowSearch" no-flex horizontal style="padding: var(--space-xs) var(--space-s); align-items: center; position: sticky; top: 0; z-index: 3;">
            <input flex type="search" placeholder="Поиск" ::value="filter" style="border: none; outline: none; background: transparent; color: inherit; font: inherit; min-width: 0;">
            <oda-icon no-flex icon="icons:search" :icon-size="18"></oda-icon>
        </div>
        <div vertical flex style="overflow: auto;">
            <oda-tree-header dark :columns ~if=showHeader></oda-tree-header>
            <div vertical style="overflow: visible;">
                <oda-tree-item :filter ~is="itemTemplate" flex :node-template :hide-tops :hide-roots :show-tools :menu-mode :show-users :show-size :show-status ~for='items' :row="$for?.item"></oda-tree-item>
            </div>
        </div>
    `,
    filter: '',
    label: 'tree',
    showHeader: false,
    nodeTemplate: 'span',
    itemTemplate: 'oda-tree-item',
    itemsSelector: 'items',
    allowDrag: false,
    get tree() {
        return this;
    },
    columns: [],
    get cells(){
        const extract_cells = (columns)=>{
            return columns.reduce((res, col)=>{
                if(CELL_CTL.get(col)?.expanded && col.items?.length){
                    res.push(...extract_cells(col.items))
                }
                else{
                    res.push(col)
                }
                return res;
            }, [])
        }
        return extract_cells(this.columns);
    },
    get cells_style(){
        const cells = this.cells;
        // Замеры кешируются (getBoundingClientRect вне кэша = layout-thrashing).
        // Поле обычное, не [R].cache: сброс — через invalidate в resize ниже.
        if (!this._cellsWidths || this._cellsWidths.length !== cells.length) {
            this._cellsWidths = cells.map(col => CELL_CTL.get(col)?.getBoundingClientRect?.().width || 200);
        }
        return cells.map((_, idx)=>{
            const width = this._cellsWidths[idx];
            return `*::part(cell-${idx}){
    max-width: ${width}px;
    min-width: ${width}px;
    width: ${width}px;
}`
        }).join('\n');
    },
    $listeners: {
        resize() {
            this._cellsWidths = undefined;
            this.invalidate('cells_style');
        }
    },
    $public: {
        allowCategories: false,
        maxDeep: 2,
        hideTops: 0,
        hideRoots: 0,
        allowFocus: false,
        expanderOrder: 0,
        checkMode: {
            $def: 'none',
            $list: ['none', 'binary', 'ternary'],
        },
        allowSearch: false,
        showTools:  false,
        showUsers: false,
        showStatus: false,
    },
    menuMode: 'tools',
    showSize: true,
    items: [],
    get step() {
        return (this.iconSize || 24) / 2;
    },
    async getItems(item, deep = 0) {
        let items = (await item?.[this.itemsSelector]) || [];
        if (items instanceof Array && deep > 0) {
            for (let next of items) {
                await this.getItems(next, deep - 1)
            }
        }
    },
    /** дети узла навигации (массив; Promise и мусор → []) */
    async nodeChildren(node) {
        const kids = await node?.[this.itemsSelector];
        return Array.isArray(kids) ? kids : [];
    },
    /** узлы верхнего уровня для навигации */
    rootItems() {
        return Array.isArray(this.items) ? this.items : [];
    },
    /** компонент узла -> данные узла */
    nodeOf(nodeComp) {
        return nodeComp?.row;
    },
    /** узел раскрыт */
    isOpen(node) {
        return !!node?.expanded;
    },
    async getLastChild(node) {
        let item = node;
        let children = await this.nodeChildren(item);
        while (children.length) {
            item = children[children.length - 1];
            children = await this.nodeChildren(item);
        }
        return item;
    },
    async _siblings() {
        const host = this.focusedNode?.host;
        const parent = host ? this.nodeOf(host) : undefined;
        const list = parent ? await this.nodeChildren(parent) : await this.rootItems();
        return { list, index: list.indexOf(this.focusedItem) };
    },
    async up() {
        if (!this.focusedItem) {
            const roots = await this.rootItems();
            this.focusedItem = await this.getLastChild(roots[roots.length - 1]);
            return;
        }
        const { list, index } = await this._siblings();
        if (index > 0) {
            this.focusedItem = await this.getLastChild(list[index - 1]);
            return;
        }
        const host = this.focusedNode?.host;
        const parent = host ? this.nodeOf(host) : undefined;
        this.focusedItem = parent ?? list[list.length - 1];
    },
    async down() {
        if (!this.focusedItem) {
            this.focusedItem = (await this.rootItems())[0];
            return;
        }
        const kids = await this.nodeChildren(this.focusedItem);
        if (kids.length && this.isOpen(this.focusedItem)) {
            this.focusedItem = kids[0];
            return;
        }
        let comp = this.focusedNode, item = this.focusedItem;
        while (comp) {
            const host = comp.host;
            const parent = host ? this.nodeOf(host) : undefined;
            const list = parent ? await this.nodeChildren(parent) : await this.rootItems();
            const i = list.indexOf(item);
            if (i > -1 && i < list.length - 1) {
                this.focusedItem = list[i + 1];
                return;
            }
            item = parent;
            comp = host;
        }
        this.focusedItem = (await this.rootItems())[0];
    },
    iconSize: 24,
    focusedItem: null,
    focusedNode: null,
    checkedItems: [],
    get parts(){
        return this.cells?.map((_, idx)=>`cell-${idx}`).join(',');
    }
})

ODA({is: 'oda-tree-header',
    template: /* html */`
        <style>
            :host{
                position: sticky;
                top: 0px;
                z-index: 1;
                font-size: x-small;
                @apply --horizontal;
            }
            .node{
                align-items: center;
                position: sticky;
                left: 0px;
                min-width: 100px;
                border-bottom: 1px solid var(--header-background);
                justify-content: center;
                @apply --horizontal;
            }
            span{
                margin: 4px;
            }
        </style>
        <div flex class="node">
            <span>{{label}}</span>
        </div>
        <oda-tree-header-cell ~for="columns" no-flex></oda-tree-header-cell>
    `,
    dragger: {},
    columns: [],
    $listeners:{
        dragover(e){
            let delta = e.clientX - this.dragger.start.x;
            let column = this.dragger.item;
            e.preventDefault();
            switch(this.dragger.type){
                case 'column-resize':{
                    this.dragger.item.style.width = Math.round(this.dragger.width - delta) + 'px';
                    this.dragger.start.x = e.clientX;
                } break;
            }

        },
        drop(e){

        },
        dragend(e){
            this.dragger = {};
        }
    }
})
ODA({is: 'oda-tree-header-cell',
    template:/* html */ `
        <style>
            :host{
                box-sizing: border-box;
                @apply --vertical;
                min-width: 200px;
                width: {{expanded ? 'auto' : width + 'px'}};
            }
            .column{
                align-items: center;
                border-bottom: 1px solid var(--header-background);
                @apply --horizontal;
            }
            .splitter{
                width: 1px;
                height: 100%;
                @apply --header;
                cursor: col-resize;
                @apply --no-flex;
            }
            .splitter:hover{
                @apply --content;
            }
            span{
                margin: 4px;
                text-align: center;
            }
        </style>
        <div flex class="column">
            <div draggable="true" class="splitter" @dragstart.stop></div>
            <oda-icon :icon="expanded?'icons:chevron-right:90':'icons:chevron-right'" ~if="column?.items?.length" @tap="expanded = !expanded"></oda-icon>
            <div vertical flex>
                <span flex>
                    {{column?.id || ''}}
                </span>
            </div>
        </div>
        <div horizontal flex ~if="column?.items?.length" ~show="expanded">
            <oda-tree-header-cell ~for="column?.items"></oda-tree-header-cell>
        </div>
    `,
    // $listeners:{
    //     resize(e){
    //         this.width = Math.round(this.getBoundingClientRect().width);
    //     }
    // },
    width:{
        $attr: true,
        $def: 50,
        $save: true,
        set(n){
            if (n<32)
                this.width = 32;
        }
    },
    expanded:{
        $attr: true,
        $def: false,
        $save: true,
        get(){
            return this.column?.expanded;
        }
    },
    get $saveKey(){
        return this.column?.id || '';
    },
    get column(){
        if(this.$for?.item){
            // связь «колонка -> ячейка заголовка» — в WeakMap, не мутацией данных
            CELL_CTL.set(this.$for.item, this);
            return this.$for.item;
        }
    },
    _onDragstart(e) {
        this.$pdp.dragger.type = 'column-resize';
        e.stopPropagation();
        e.dataTransfer.setDragImage(document.createElement('img'), 0, 0);
        e.dataTransfer.effectAllowed = "all";
        this.$pdp.dragger.item = this;
        this.$pdp.dragger.width = this.getBoundingClientRect().width;
        this.$pdp.dragger.item.style.zIndex = 2;
        this.$pdp.dragger.start = {x: e.clientX, y: e.clientY};
    }
})
ODA({is: 'oda-tree-item',
    imports: 'oda//icon.js',
    template:/*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
            }
            .row {
                @apply --horizontal;
                @apply --flex;
                align-items: center;
                overflow: hidden;
                top: 0px;
                position: sticky;
                border-radius: var(--radius-s);
                border-bottom: {{columns.length?'1px solid var(--header-background)':'none'}};
            }
            .row:hover {
                background: var(--accent-soft);
            }
            .row.focused {
                background: var(--accent-soft);
                outline: 2px solid var(--accent-color);
                outline-offset: -2px;
            }
            .sub-nodes {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
            }
            oda-icon {
                cursor: pointer;
            }
            .step {
                border-right: 1px dotted var(--header-background);
                width: {{hideTops>0?0:$pdp.step}}px;
                @apply --no-flex;
            }
            oda-icon {
                order: {{$pdp.expanderOrder}};
            }
            [category]{
                font-size: var(--font-size-xs);
                @apply --header;
            }
            .node{
                position: sticky;
                left: 0px;
                min-width: 75px;
                height: 100%;
                align-items: center;
                @apply --horizontal;
            }
            span{
                margin: 4px;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
            }
        </style>

        <div  :draggable ~if="hideTops<1" class='row' ~class="{focused: isFocused}" :category="isCategory"  @tap="isCategory?$pdp.focusedItem=$pdp.focusedItem:$pdp.focusedItem = row" @dragstart>
            <oda-icon ~if="useExpander" ~show="showExpander" :disabled="!expanderIcon" :icon="expanderIcon" :icon-size="expanderIconSize" @tap.stop="expanded = !expanded"></oda-icon>
            <oda-icon ~show="showCheckbox" :disabled="!checkboxIcon" :icon="checkboxIcon" :icon-size @tap.stop="checked = !checked"></oda-icon>
            <div flex class="node">
                <span :title="label" flex ~is="nodeTemplate" :row :expanded :show-size="showSize && !isCategory" :hide-icon="isCategory" :show-tools="isFocused && showTools" :menu-mode @tap="setItemFocus">{{label}}</span>
            </div>
            <div horizontal style="height: 100%;" ~if="!isCategory">
                <oda-tree-cell ~for="$pdp.cells"  ~is="$for?.item?.template || 'oda-tree-cell'" :part="'cell-' + $for?.index" :row :col="$for?.item"></oda-tree-cell>
            </div>
        </div>
        <div horizontal flex ~if="expanded || $pdp.filter" style="min-height: 1px;">
            <div class='step' ~if="hideRoots<1"></div>
            <div class='sub-nodes'>
                <oda-tree-item  :show-tools :show-users :show-size :show-status :hide-roots="hideRoots-1" :hide-tops="hideTops-1" ~for='items' :row="$for?.item" :menu-mode></oda-tree-item>
            </div>
        </div>
    `,
    get expanderIconSize(){
        return ODA.states.mobileMode ? this.iconSize * 2 : this.iconSize;
    },
    get useExpander(){
        return this.hideRoots<1;
    },
    hidden: {
        $def: false,
        $attr: true,
        /** скрыт поиском: ни сам, ни синхронно доступные потомки не совпали */
        get() {
            const f = String(this.$pdp.filter || '').toLowerCase();
            if (!f)
                return false;
            return !this._deepMatch(this.row, f);
        }
    },
    filter: '',
    _deepMatch(row, f) {
        if (String(row?.label ?? row?.id ?? '').toLowerCase().includes(f))
            return true;
        const kids = row?.[this.$pdp.itemsSelector];
        return Array.isArray(kids) && kids.some(k => this._deepMatch(k, f));
    },
    get draggable(){
        return this.$pdp.allowDrag?'true':false;
    },
    exportparts:{
        $attr: true,
        get(){
            return this.$pdp.parts;
        }
    },
    get label(){
        return this.row.id || ''
    },
    get columns(){
        return this.$pdp.columns;
    },
    iconSize: 24,
    get nodeTemplate(){
        return (this.row?.nodeTemplate || this.host.nodeTemplate);
    },
    showTools: false,
    menuMode: {
        $def: 'tools',
        $list: ['tools']
    },
    showSize: true,
    setItemFocus(e){
        e.stopPropagation();
        this.$pdp.focusedItem = this.row;
        this.$pdp.focusedNode = this;
    },
    get isFocused() {
        if (!this.$pdp.allowFocus)
            return false;
        const focused = this.$pdp.focusedItem === this.row;
        if (focused && this.$pdp.focusedNode !== this) {
            this.$pdp.focusedNode = this;
        }
        return focused;
    },

    get isCategory() {
        return this.$pdp.allowCategories && this.hideRoots > 0;
    },
    _onDragstart(e) {
        e.stopPropagation();
        e.dataTransfer.setData('data', JSON.stringify(this.row));
    },
    get showExpander() {
        return !this.$pdp.expanderOrder || !!this.expanderIcon;
    },
    get showCheckbox() {
        return (this.$pdp.checkMode !== 'none') && !this.isCategory;// || !!this.checkboxIcon;
    },
    get rootNode() {
        return this.host === this.$pdp.tree;
    },
    $public: {
        hideTops: 0,
        hideRoots: 0
    },
    row: {},
    expanded: {
        get() {
            if(this.hideTops > 0 || this.hideRoots > 0)
                return true;
            return this.row?.expanded || false;
        },
        async set(n) {
            if (this.row && n !== undefined) {
                if (n) {
                    await this.$pdp.getItems(this.row, 1);
                    this.row.expanded = true;
                }
                this.row.expanded = n;
            }
        }
    },
    checked: {
        async set(n) {
            if (n !== undefined) {
                if (this.$pdp.checkMode === 'ternary') {
                    // todo: рекурсия
                    //await this.$pdp.getItems(this.row);
                }

                if (n) {
                    this.$pdp.checkedItems.add(this.row);
                }
                else {
                    this.$pdp.checkedItems.remove(this.row);
                }
            }
        },
        get(){
            return this.$pdp.checkedItems.includes(this.row);
        }
    },
    get items() {
        return Promise.resolve(this.row?.[this.$pdp.itemsSelector] || []).then(items => {
            this.row?.addEventListener?.('changed', e=>{
                this.async(async ()=>{
                    this.row.expanded = true;
                    if(e.detail.value){
                        let item = (await this.items)?.find(f=>f.id === e.detail.value);
                        if(item)
                            this.$pdp.tree.focusedItem = item;
                    }
                })
            }, {once: true})
            return items;
        })
    },
    get expanderIcon() {
        let icon = 'icons:chevron-right';
        if (this.expanded)
            icon += ':90'
        return Promise.resolve(this.items).then(items => items?.length ? icon : '');
    },
    iconChecked: 'icons:check-box',
    iconUnchecked: 'icons:check-box-outline-blank',
    iconIntermediate: 'icons:check-box-indeterminate',
    get checkboxIcon() {
        if (this.$pdp.checkMode === 'none') {
            return '';
        }
        if (this.$pdp.checkMode === 'ternary') {
            if (this.checked) {
                return this.iconChecked;
            }
            // todo: Получить checked у дочерних
        }
        return this.checked ? this.iconChecked : this.iconUnchecked;
    }
})
ODA({is: 'oda-tree-cell',
    template:/* html */`
        <style>
            :host{
                box-sizing: border-box;
                border-left: 1px solid var(--header-background);
                min-width: 10px;
                overflow: hidden;
                height: 100%;
                align-items: center;
                @apply --horizontal;
                @apply --no-flex;
            }
            .input{
                height: 100%;
                @apply --content;
            }
        </style>
        <div class="input" ~is="descriptor?.editor" flex :descriptor></div>
    `,
    get descriptor(){
        if(this.col?.id)
            return this.row?.[this.col.id];
    },
    row: null,
    col: null

})
