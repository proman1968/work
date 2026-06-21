ODA({is: 'oda-tree', imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
            }
        </style>
        <style>{{cells_style}}</style>
        <div vertical flex style="overflow: auto;">
            <oda-tree-header dark :columns ~if=showHeader></oda-tree-header>
            <div vertical style="overflow: visible;">
                <oda-tree-item :filter ~is="itemTemplate" flex :node-template :hide-tops :hide-roots ~for='items' :row="$for?.item"></oda-tree-item>
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
                if(col.control?.expanded && col.items?.length){
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
        return this.cells.map((col, idx)=>{
            let width = col.control?.getBoundingClientRect().width || 200;
            return `*::part(cell-${idx}){
    max-width: ${width}px;
    min-width: ${width}px;
    width: ${width}px;
}`
        }).join('\n');
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
    },
    items: [],
    get step(){
        return this.iconSize || 12;
    },
    async getItems(item, deep = 0) {
        let items = (await item?.[this.itemsSelector]) || [];
        if (items instanceof Array && deep > 0) {
            for (let next of items) {
                await this.getItems(next, deep - 1)
            }
        }
    },
    async getLastChild(item) {
        let focusedItem = item;
        let children = await focusedItem?.[this.itemsSelector];
        while (children?.length) {
            focusedItem = children.last;
            children = await focusedItem?.[this.itemsSelector];
        }
        return focusedItem;
    },
    async up(e) {
        if (this.focusedItem === null) {
            this.focusedItem = await this.getLastChild(this.row);
            //this.focusedNode = this.$('div div oda-tree-node:last-child');
            return;
        }

        if (this.focusedNode === null) {
            console.warn('this.focusedNode === null')
            return;
        }

        if (this.focusedItem === this.row[this.itemsSelector].first) {
            this.focusedItem = await this.getLastChild(this.row);
            return;
        }

        const host = this.focusedNode.host;
        if (this.focusedItem === host.row[this.itemsSelector].first) {
            this.focusedItem = host.row;
        }
        else {
            const items = host.row[this.itemsSelector];
            this.focusedItem = items[items.indexOf(this.focusedItem) - 1];
        }
    },
    async down(e) {
        if (this.focusedItem === null) {
            this.focusedItem = this.row[this.itemsSelector].first;
            //this.focusedNode = this.$('div div oda-tree-node:first-child');
            return;
        }

        if (this.focusedNode === null) {
            console.warn('this.focusedNode === null')
            return;
        }

        let host = (this.focusedItem === this.row[this.itemsSelector].last) ? this : this.focusedNode.host;
        if (this.focusedItem === host.row[this.itemsSelector].last) {
            const children = await this.focusedItem?.[this.itemsSelector];
            if (children.length) {
                this.focusedItem = children[0];
                return;
            }

            if (host.row[this.itemsSelector] === this.row[this.itemsSelector].last) {
                this.focusedItem = this.row[this.itemsSelector].first;
                return;
            }

            let row = this.focusedItem;
            let idx = host.row[this.itemsSelector].indexOf(row);
            while (idx === (host.row[this.itemsSelector].length - 1)) {
                row = host.row;
                if (host.row === this.row[this.itemsSelector].last) {
                    this.focusedItem = this.row[this.itemsSelector].first;
                    return;
                }
                host = host.host;
                idx = host.row[this.itemsSelector].indexOf(row);
            }
            this.focusedItem = host.row[this.itemsSelector][idx + 1];
        }
        else {
            this.focusedItem = host.row[this.itemsSelector][row[this.itemsSelector].items.indexOf(this.focusedItem) + 1];
        }
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
            this.$for.item.control = this;
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
                border-bottom: {{columns.length?'1px solid var(--header-background)':'none'}};
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
                font-size: xx-small;
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
                text-overflow: ellipsis;
            }
        </style>

        <div  :draggable ~if="hideTops<1" class='row' :light="isFocused" :category="isCategory"  @tap="isCategory?$pdp.focusedItem=$pdp.focusedItem:$pdp.focusedItem = row" @dragstart>
            <oda-icon ~if="useExpander" ~show="showExpander" :disabled="!expanderIcon" :icon="expanderIcon" :icon-size="expanderIconSize" @tap.stop="expanded = !expanded"></oda-icon>
            <oda-icon ~show="showCheckbox" :disabled="!checkboxIcon" :icon="checkboxIcon" :icon-size @tap.stop="checked = !checked"></oda-icon>
            <div flex class="node" :info-invert="isFocused">
                <span :title="label" flex ~is="nodeTemplate" :row :expanded :show-size="showSize && !isCategory" :hide-icon="isCategory" :show-tools="isFocused && showTools" @tap="setItemFocus">{{label}}</span>
            </div>
            <div horizontal style="height: 100%;" ~if="!isCategory">
                <oda-tree-cell ~for="$pdp.cells"  ~is="$for?.item?.template || 'oda-tree-cell'" :part="'cell-' + $for?.index" :row :col="$for?.item"></oda-tree-cell>
            </div>
        </div>
        <div horizontal flex ~if="expanded" style="min-height: 1px;">
            <div class='step' ~if="hideRoots<1"></div>
            <div class='sub-nodes'>
                <oda-tree-item  :filter :show-tools :hide-roots="hideRoots-1" :hide-tops="hideTops-1" ~for='items' :row="$for?.item"></oda-tree-item>
            </div>
        </div>
    `,
    get expanderIconSize(){
        return ODA.states.mobileMode ? this.iconSize * 2 : this.iconSize;
    },
    _onResize(e){
        let height = e.target.offsetHeight;
        this.debounce('sub_resize', ()=>{
            if(height>1)
                this.hidden = false;
            else if(this.filter.length)
                this.hidden = true;

        })
    },
    get useExpander(){
        return this.hideRoots<1;
    },
    hidden:{
        $def: false,
        $attr: true,
    },
    filter: {
        $def: '',
        set(n){
            this.hidden = false;
        }
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
    get coumns(){
        return this.$pdp.columns;
    },
    iconSize: 24,
    get nodeTemplate(){
        return (this.row?.nodeTemplate || this.host.nodeTemplate);
    },
    showTools: false,
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
        let items = (this.row?.[this.$pdp.itemsSelector] || []);
        return Promise.resolve(items).then(items=>{
            this.row?.addEventListener?.('changed', e=>{
                this.items = undefined;
                this.async(async ()=>{
                    this.render();
                    this.row.expanded = true;
                    if(e.detail.value){
                        let item = (await this.items)?.find(f=>f.id === e.detail.value);
                        if(item)
                            this.$pdp.tree.focusedItem = item;
                    }
                })
            }, {ones: true})
            return items;
        })
    },
    get expanderIcon() {
        let icon = 'icons:chevron-right';
        if (this.expanded)
            icon += ':90'
        return this.items.then(items=>{
            if (!items?.length)
                return '';
            return icon;
        })
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

ODA({is: 'tree-editor',
    descriptor: {}
})
ODA({is: 'tree-string-editor', extends: 'tree-editor',
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
                overflow: hidden;
            }
            input{
                border: none;
                padding: 4px;
            }
        </style>
        <input flex ::value="descriptor.value" @keypress>
    `,
    _onKeypress(e){
        if(e.keyCode === 13){
            e.target.blur();
        }
    }
})
ODA({is: 'tree-boolean-editor',
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
                overflow: hidden;
            }
            input{
                border: none;
                padding: 4px;
            }
        </style>
        <input type="checkbox" flex ::checked="descriptor.value">
    `
})
ODA({is: 'tree-dropdown-editor', extends: 'tree-editor',
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
                overflow: hidden;
                position: relative;
            }
            select{
                padding: 4px;
                border: none;
                outline: none;
            }
            input{
                border: none;
                margin: 2px;
                outline: none;
            }
            .input{
                position: absolute;
                top: 0px;
                left: 0px;
                height: 100%;
                right: 1em;
            }
        </style>
        <select flex id="selector" ::value="descriptor.value">
            <option ~for="this.descriptor.list" :value="getItemValue($for.item)" ~html="String(getItemValue($for.item))"></option>
        </select>
        <div vertical class="input">
            <input flex ::value="descriptor.value">
        <div>
    `,
    getItemValue(item){
        return item?.id || item
    }
})

ODA({is: 'tree-icon-selector', imports: 'oda/tools//icons-tree', extends: 'tree-editor',
    template:/* html */`
        <style>
            :host{
                @apply --horizontal;
                overflow: hidden;
                position: relative;
                align-items: center;
            }

            input{
                border: none;
                outline: none;
                padding: 4px;
                width: 0px;
            }

        </style>
        <oda-icon no-flex :icon="descriptor.value"></oda-icon>
        <input flex ::value="descriptor.value">
        <oda-icon no-flex icon="icons:chevron-right:90" @tap="showTree"></oda-icon>
    `,
    showTree(e){
        let el = ODA.createComponent('oda-icons-tree');
        this.appendChild(el);
        el.addEventListener('value-changed', e=>{
            this.descriptor.value = e.detail.value;
        })
        WORK.showDropdown(el, {}, this);
    }
})