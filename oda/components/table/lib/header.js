import * as utils from '../table.js'
ODA({is: 'oda-table-header',
    template:`
        <style>
            :host{
                @apply --header;
                @apply --horizontal;
                box-sizing: border-box;
                font-size: small;
                z-index: 3;
                top: 0px;
                position: sticky;
                width: max-content;
                min-width: 100%;
                border: .15em solid var(--dark-background);
                max-width: {{autoWidth?'100%':'auto'}};
            }
        </style>
        <oda-table-header-cell class="cell" draggable="true" :auto-width ~for="cols"></oda-table-header-cell>
    `,
    get table(){
        return this.host;
    },
    $listeners:{
        dragleave(e){
            utils.drag.item.$pdp.state = 'info'
            requestAnimationFrame(()=>{
                for (let column of this.table.flat_columns){
                    column.$element.style.transform = '';
                }
            })
        },
        dragover(e) {
            if (!utils.drag.item)
                return;
            
            e.dataTransfer.dropEffect = "move";
            e.preventDefault();
            let delta = e.clientX - utils.drag.start.x;
            let column = utils.drag.item;
            switch (utils.drag.type){
                case 'column-resize':{

                    let next, width, index, columns, updates = [];
                    while(column.column){
                        width = column.getBoundingClientRect().width + (column.fix === 'right'?-delta:delta);
                        column.$pdp.state = 'info'
                        if(column.minWidth > width){
                            delta = column.minWidth - width;
                            width = column.minWidth;
                            column.$pdp.state = 'error'
                            column.style.width = width + 'px';
                            column.width = width;
                            return;
                        }
                        column.width = width;
                        updates.push(column)
                        columns = utils.getSortedChildren(column.parentElement);
                        index = columns.indexOf(column);
                        next = columns[index + 1];
                        if (this.host.autoWidth){
                            if (next){
                                width = next.getBoundingClientRect().width - delta;
                                next.$pdp.state = 'info'
                                if(next.minWidth > width){
                                    delta = next.minWidth - width;
                                    width = next.minWidth;
                                    next.$pdp.state = 'error';
                                    next.style.width = width + 'px';
                                    next.width = width;
                                    return;
                                }
                                next.width = width;
                                updates.push(next);
                                break;
                            }
                        }
                        column = column.host;
                    }
                    while(column = updates.pop()){
                        column.style.width = column.width + 'px';
                    }

                    utils.drag.start.x = e.clientX;
                } break;
                case 'column-move':{
                    let move = 0;
                    let columns = utils.getSortedChildren(column.parentElement).filter(col => col.fix === column.fix);

                    let index = columns.indexOf(column);
                    let deltaY = e.clientY - utils.drag.start.y;
                    if (utils.drag.item.error){
                        for (let el of utils.drag.item.parentElement.children){
                            el.style.transform = ``;
                        }
                    }
                    else{
                        let sign = Math.sign(delta);
                        if (!sign) return;
                        
                        let column = columns[index += sign];
                        
                        utils.drag.item.style.transform = `translateX(${delta + move}px)`;
                        let width = utils.drag.item.getBoundingClientRect().width * -sign;
                  
                        delta = Math.abs(delta);
                        while (column){
                            if(!column.hidden){
                                let w = column.getBoundingClientRect().width
                                if(delta < w / 2)
                                    column.style.transform = '';
                                else
                                    column.style.transform = `translateX(${width + move}px)`;
                                delta -= w;
                            }
                            column = columns[index += sign];
                        }
                        if (delta > 0){
                            utils.drag.item.$pdp.state = 'error'
                            utils.drag.item.style.transform = `translateX(${e.clientX - utils.drag.start.x - (sign * delta)+ move}px)`;
                        }
                        else
                            utils.drag.item.$pdp.state = 'info'


                    }
                } break;
            }
        }
    }
})
ODA({is: 'oda-table-header-cell',
    template: /*html*/`
        <style>
            :host{
                overflow: hidden;
                @apply --vertical;
                border-top: .05em solid var(--header-background);
                box-sizing: border-box;
                @apply --no-flex;
                @apply --header;
            }
            label {
                align-self: center;
                text-align: center;
                padding: 8px;
                text-overflow: ellipsis;
                overflow: hidden;
                white-space:break-spaces !important;
            }
            :host([fix="right"]) .splitter{
                left: 0px;
            }
            .splitter{
                position: absolute !important;
                cursor: ew-resize !important;
                top: 0px;
                right: 0px;
                width: 3px;
                box-sizing: border-box;
                border-color: var(--dark-background);
                height: 100%;;
            }
            .splitter:hover{
                border-color: red;
            }
            div{
                overflow: hidden;
            }

            input{
                border: none;
                width: 0px;
                font-size: small;
                margin: 4px;
                margin-right: 0px;
                padding: 2px 8px;
                border-radius: 16px;
                
            }
            input:focus{
                outline: .15em solid var(--focused-color);
                outline-offset: -2px;
            }
            :host(:not([fix])){
                filter: brightness(0.95);
            }
            #toolbar{
                border-top: .05em solid var(--dark-background);
            }
        </style>
        <style>
            :host{     
                order: {{real_order}};
                min-width: {{minWidth}}px;
                width: {{realWidth}}px;
                left: {{(fix === 'left')?_sticky_left:'initial'}};
                right: {{(fix === 'right')?_sticky_right:'initial'}};
                position: {{fix?'sticky':'relative'}};
                z-index: {{fix?2:0}};
                direction: {{fix === 'right'?'ltr':'initial'}};
            }
            .splitter{
                order: {{fix === 'right'?-1:1}};
                border-right: {{fix !== 'right'?'.15em solid var(--dark-background)':'none'}};
                border-left: {{fix === 'right'?'.15em solid var(--dark-background)':'none'}};
            }
            .expander{
                position: absolute;
                top: 0px;
                left: 0px;
            }
        </style>
        <div flex horizontal style="position: relative;" @contextmenu.stop.prevent>
            <div vertical flex>
                <div horizontal flex @tap="setSort" style="align-items: center;">
                    <oda-button class="expander" @tap.stop="expanded = !expanded" ~if="hasChildren" :rotate="expanded?90:0" icon="icons:chevron-right"></oda-button>
                    <label flex ~html="column.label || column.name"></label>
                    <oda-icon :icon-size
                        ~if="allowSort && sortOrder"
                        style="right: 0px; top: 0px; position: absolute;"
                        :icon="sortIcon"
                        title="sort"
                    ></oda-icon>
                </div>
                <div id="toolbar" ~if="showColumnTools && showTools" horizontal class="filter" draggable>
                    <oda-button ~for="buttons"
                        @tap.stop="$for.item.execute($event)" 
                        ~if="treeMode" 
                        :icon-size
                        :icon="$for?.item.icon"
                        no-flex></oda-button>
                    <div ~if="showColumnFilter" flex horizontal >
                        <input type="search" placeholder="filter" ::value="filter" light flex :success="!!filter" @dragstart.stop.prevent @dragover.stop.prevent>
                        <oda-button  no-flex icon="icons:filter" :icon-size style="transform: scale(0.7);"></oda-button>
                    </div>
                </div>
            </div>
            <div :draggable="(!column.width).toString()" :disabled="column.width" no-flex class="splitter" @dragstart.stop></div>
         </div>

        <div flex horizontal dark ~show="hasChildren && expanded" style="box-sizing: border-box">
            <oda-table-header-cell draggable="true" ~for="column?.items" flex auto-width></oda-table-header-cell>
        </div>
    `,
    '@attributes':{
        flex: {
            $attr: true,
            $type: Boolean,
            get(){
                return this.column?.flex ?? this.$pdp.autoWidth;
            }
        }
    },
    get showColumnTools(){
        return this.column?.showColumnTools || this.table.showColumnTools;
    },
    get name(){
        return this.column.name;
    },
    get showTools(){
        return !!this.name && !this.expanded;
    },
    get treeMode(){
        return this.column.treeMode;
    },
    get buttons(){
        let buttons = [];
        if(!this.treeMode)
            return buttons;
        buttons.push(...[
            {
                icon:"eva:o-diagonal-arrow-left-up-outline",
                execute: () => {
                    this.$pdp.table.collapseAll();
                }
            },
            {
                icon:"eva:o-arrowhead-left-outline",
                execute: () => {
                    this.$pdp.table.collapse();
                }
            },
            {
                icon:"eva:o-arrowhead-right-outline",
                execute: () => {
                    this.$pdp.table.expand();
                }
            },
        ])
        if(this.$pdp.table.allowCheck !== 'none'  ){
            buttons.push({
                icon: "fontawesome:s-list-check",
                execute: (e) => {
                    e.target.showContextMenu({
                        anchor: e.target,
                        style:{
                            left: 'anchor(left)',
                            positionArea: 'end'
                        },
                        title: 'all',
                        items: [
                            {
                                icon: "icons:check-box",
                                label: 'check',
                                execute: () => {
                                    this.$pdp.table.check();
                                }
                            },
                            {
                                icon: "icons:check-box-outline-blank",
                                label: 'uncheck',
                                execute: () => {
                                    this.$pdp.table.uncheck();
                                }
                            },
                            {
                                icon: "icons:expand-tree",
                                label: 'invert',
                                execute: () => {
                                    this.$pdp.table.checkInvert();
                                }
                            },
                        ]
                    })
                }
            })
        }
            
        return buttons;
    },
    filter:{
        $def: '',
        $save: true,
    },
    get _sticky_left(){
        let left = 0;
        for (let col of this.table.visible_columns){
            if (col.$element === this)
                break;
            left += col.$element?.width || 0;
        }
        return left;
    },
    get _sticky_right(){
        let right = 0;
        for (let col of this.table.visible_columns.toReversed()){
            if (col.$element === this)
                break;
            right += col.$element?.width || 0;
        }
        return right;
    },
    get _has_next(){
        let columns = utils.getSortedChildren(this.parentElement);
        if(columns.last && columns.last !== this)
            return true;
    },
    fix:{
        $def: '',
        $attr: true,
        get(){
            return this.column?.fix;
        }
    },
    $public:{
        label: {
            $type: String,
            get(){
                return this.column.label || this.column.name
            }
        }
    },
    get table(){
        return this.host.table;
    },
    error:{
        $def: false,
        $attr: true,
    },
    get minWidth(){
        if (this.column.width)
            return this.column.width;
        let min = this.$pdp.iconSize * 2;
        const calculate = (col)=>{
            let w = min;
            if(col.treeMode){
                w += min * 2;
                if(this.table.allowCheck !== 'none')
                    w += this.$pdp.iconSize;
            }
            if (col.items){
                for (let c of col.items){
                    w += calculate(c);
                }
            }
            return w;
        }
        return calculate(this.column);
    },
    get maxWidth(){
        return this.column.width || 2000;
    },
    get realWidth(){
        return this.column.width || this.width;
    },
    _onDragstart(e) {
        utils.drag.type = 'column-resize';
        e.stopPropagation();
        e.dataTransfer.setDragImage(document.createElement('img'), 0, 0);
        e.dataTransfer.effectAllowed = "all";
        utils.drag.item = this;
        utils.drag.item.$pdp.state = 'info';
        utils.drag.width = this.getBoundingClientRect().width;
        utils.drag.item.style.zIndex = 2;
        utils.drag.start = {x: e.clientX, y: e.clientY};
    },
    get hasChildren(){
        return !!this.column?.items?.length;
    },
    dragging: {
        $def: false,
        $attr: true,
    },
    get $saveKey(){
        return this.name || '';
    },
    get path(){
        if(this.host.is === 'oda-table-header-cell')
            return this.host.path + '\n' + '  '.repeat(this.host.path.split('\n').length) + this.label;
        return this.label;
    },
    expanded: {
        $save: true,
        $def: false,
        set(n){
            this.$pdp.visible_columns = undefined;
        }
    },
    autoWidth: true,
    column: {
        get(){
            this.$for.item.$element = this;
            return this.$for.item;
        }
    },
    sortOrder: {
        $def: 0,
        $save: true,
    },
    get sortIcon() {
        if (+this.sortOrder > 0)
            return '@:▼' + Math.abs(this.sortOrder);
        if (+this.sortOrder < 0)
            return '@:▲'+ Math.abs(this.sortOrder);
        return '';
    },
    setSort(e) {
        if (!this.table.allowSort || !this.column.name) return;
        if (this.sortOrder > 0) {
            this.sortOrder = -this.sortOrder;
        }
        else {
            this.sortOrder = this.sortOrder < 0 ? 0 : this.table.sorts_columns.length + 1;
            this.async(() => {
                this.table.sorts_columns.forEach((i, idx) => {
                    i.sortOrder = (idx + 1) * Math.sign(i.sortOrder);
                });
            });
        }

    },
    width:{
        $attr: true,
        $def: 100,
        $save: true,
        set(n){
            if (n<32)
                this.width = 32;
        }
    },
    get real_order(){
        switch(this.column?.fix){
            case 'left':
                return (this.order - 10000);
            case 'right':
                return (this.order + 10000);
        }
        return this.order;
    },
    order:{
        $attr: true,
        $def: 0,
        $save: true
    },
    groupOrder:{
        $def: -1,
        $save: true,
        set(n){
            this.$pdp.groups = undefined;
        }
    },
    groupSort:{
        $def: 0,
        $save: true,
    },
    olap_dim_order:{
        $def: -1,
        $save: true
    },
    hidden:{
        $attr: true,
        $def: false,
        $save: true,
        get (){
            return this.column?.hidden
        }
    },
    _onContextmenu(e){
        this.showContextMenu({
            anchor: e,
            title: 'Column menu',
            style:{
                left: 'anchor(left)',
                positionArea: 'end'
            },
            items: [{label: 'asfasdf', icon: 'icons:error', execute: (e)=>{

            }, items:[
                {label: 1},
                {label: 2}
            ]}]
        })
    },
    $listeners:{
        resize(e){
            this.width = Math.round(this.getBoundingClientRect().width);
        },
        dragstart(e){
            e.stopPropagation();
            e.dataTransfer.setDragImage(e.target.$('label'), 0, 0);
            e.dataTransfer.effectAllowed = "all";
            this.dragging  = true;
            this.style.zIndex = 5;
            this.$pdp.raised = true;
            this.$pdp.state = 'info';
            let order = -1;
            this.host.setAttribute('drop-reciver', '');
            let items = utils.getSortedChildren(this.parentElement)
            for (let el of items){
                el.order = ++order;
            }
            utils.drag.item = this;
            utils.drag.type = 'column-move';
            utils.drag.start = {x:e.clientX, y:e.clientY};
        },
        dragend(e){
            this.host.removeAttribute('drop-reciver');
            for (let column of this.table.flat_columns){
                let el = column.$element;
                el.dragging  = false;
                el.style.zIndex = el.fix?2:0;
                el.style.transform = '';
                el.$pdp.raised = false;
                el.$pdp.state = false;
                el._has_next = undefined;
            }
        },
        drop(e){
            e.stopPropagation();
            switch (utils.drag.type){
                case 'column-move':{
                    let items = utils.getSortedChildren(utils.drag.item.parentElement);
                    let idx = items.indexOf(utils.drag.item);
                    let moves = items.filter((el, i)=> i<idx && el.style.transform)
                    if (moves.length){
                        utils.drag.item.order = moves[0].order;
                        for (let el of moves){
                            el.order += 1;
                        }
                    }
                    else{
                        moves = items.filter((el, i) => i>idx && el.style.transform)
                        if (moves.length){
                            utils.drag.item.order = moves.last.order;
                            for (let el of moves){
                                el.order -= 2;
                            }
                        }
                    }
                }
            }
        }
    }
})
