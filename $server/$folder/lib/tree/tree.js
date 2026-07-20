export default {
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
            }
            input {
                margin: auto;
                padding: 2px 0px 2px 8px;
                width: 0px;
                border: none;
                outline: none;
            }
            .search {
                margin: 2px 8px;
                border-radius: 16px;
                overflow: hidden;
                min-height: 30px;
                align-items: center;
            }
            oda-icon {
                scale: .7;
                opacity: .5;
            }
            oda-button {
                padding: 4px;
            }
        </style>
        <div ~if="allowSearch" raised horizontal style="padding:5px; align-items: center; z-index:3; position: sticky; top: 0px;">
            <div class="search" raised horizontal flex content>
                <input autofocus  id="site-search" content type="search" placeholder="Search" flex/>
                <oda-icon @tap="$('input').focus()" :icon-size icon="icons:search"></oda-icon>
            </div>
        </div>
        <div vertical flex style="overflow: auto;">
            <div vertical style="overflow: visible;">
                <oda-tree-node :show-tools :menu-mode :show-users ~is="nodeTemplate" :hide-tops :hide-roots ~for='items'></oda-tree-node>
            </div>
        </div>
    `,
    showUsers: false,
    showSize: false,
    get expanderIconSize(){
        return ODA.states?.mobileMode ? this.iconSize * 2 : this.iconSize;
    },
    nodeTemplate: 'oda-tree-node',
    itemsSelector: 'items',
    get tree() {
        return this;
    },
    expandAll: false,
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
        showTools: false,
        menuMode: {
            $def: 'handlers',
            $list: ['tools', 'handlers', 'both']
        },
        hideSystem: false,
        hideReadme: false,
    },
    items: [],
    get step() {
        return (this.iconSize || 24) / 2;
    },
    $item: {
        async set(n) {
            if (n) {
                n?.addEventListener?.('changed', e => {
                    this.isChanged = true;
                    this.render();
                })
                await this.getItems(n, 1)
                this.items = [n];
            }
            else {
                this.items = [];
            }
        }
    },
    async getItems($item, deep = 0) {
        let items = (await $item?.[this.itemsSelector]) || [];
        if(this.hideSystem)
            items = items.filter(f=>!f.isType)
        if(this.hideReadme)
            items = items.filter(f => !/^readme\.md$/i.test(f.id))
        if (items instanceof Array && deep > 0) {
            for (let next of items) {
                await this.getItems(next, deep - 1);
            }
        }
    },
    async getLastChild($item) {
        let focusedItem = $item;
        let children = await focusedItem?.[this.itemsSelector];
        while (children?.length) {
            focusedItem = children.last;
            children = await focusedItem?.[this.itemsSelector];
        }
        return focusedItem;
    },
    async up(e) {
        if (this.focusedItem === null) {
            this.focusedItem = await this.getLastChild(this.$item);
            //this.focusedNode = this.$('div div oda-tree-node:last-child');
            return;
        }

        if (this.focusedNode === null) {
            console.warn('this.focusedNode === null')
            return;
        }

        if (this.focusedItem === this.$item.items.first) {
            this.focusedItem = await this.getLastChild(this.$item);
            return;
        }

        const host = this.focusedNode.host;
        if (this.focusedItem === host.$item.items.first) {
            this.focusedItem = host.$item;
        }
        else {
            const items = host.$item.items;
            this.focusedItem = items[items.indexOf(this.focusedItem) - 1];
        }
    },
    async down(e) {
        if (this.focusedItem === null) {
            this.focusedItem = this.$item.items.first;
            //this.focusedNode = this.$('div div oda-tree-node:first-child');
            return;
        }

        if (this.focusedNode === null) {
            console.warn('this.focusedNode === null')
            return;
        }

        let host = (this.focusedItem === this.$item.items.last) ? this : this.focusedNode.host;
        if (this.focusedItem === host.$item.items.last) {
            const children = await this.focusedItem?.[this.itemsSelector];
            if (children.length) {
                this.focusedItem = children[0];
                return;
            }

            if (host.$item === this.$item.items.last) {
                this.focusedItem = this.$item.items.first;
                return;
            }

            let $item = this.focusedItem;
            let idx = host.$item.items.indexOf($item);
            while (idx === (host.$item.items.length - 1)) {
                $item = host.$item;
                if (host.$item === this.$item.items.last) {
                    this.focusedItem = this.$item.items.first;
                    return;
                }
                host = host.host;
                idx = host.$item.items.indexOf($item);
            }
            this.focusedItem = host.$item.items[idx + 1];
        }
        else {
            this.focusedItem = host.$item.items[host.$item.items.indexOf(this.focusedItem) + 1];
        }
    },
    focusedItem: null,
    focusedNode: null,
    checkedItems: [],
}
ODA({is: 'oda-tree-node',
    imports: 'oda//icon, ~/lib//node',
    template:/*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
            }
            .node {
                @apply --horizontal;
                @apply --flex;
                align-items: center;
                overflow: hidden;
                top: 0px;
                position: sticky;
            }
            .sub-nodes {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
            }
            oda-icon {
                cursor: pointer;
            }
        </style>
        <style>
            .step {
                width: {{hideTops>0?0:$pdp.step}}px;
                @apply --no-flex;
                border-right: 1px dotted silver;
            }
            oda-icon {
                order: {{$pdp.expanderOrder}};
            }
            [category]{
                font-size: xx-small;
                @apply --dark;
            }
            [category]>item-node{
                padding: 0px;
            }
        </style>
        <div draggable="true" ~if="hideTops<1" class='node' :category="isCategory"  @tap="isCategory?$pdp.focusedItem=$pdp.focusedItem:$pdp.focusedItem = $item" @dragstart>
            <oda-icon ~if="hideRoots<1" ~show="showExpander" :disabled="!expanderIcon" :icon="expanderIcon" :icon-size="expanderIconSize" @tap.stop="expanded = !expanded"></oda-icon>
            <oda-icon ~show="showCheckbox" :disabled="!checkboxIcon" :icon="checkboxIcon" :icon-size @tap.stop="checked = !checked"></oda-icon>
            <item-node :expanded :info-invert="isFocused" auto-run :show-users :show-size="showSize && !isCategory" :hide-icon="isCategory" :show-tools="isFocused && showTools" :menu-mode :$item show-status @tap="setItemFocus"></item-node>
        </div>
        <div horizontal flex ~if="expanded" style="min-height: 1px;">
            <div class='step' ~if="hideRoots<1"></div>
            <div class='sub-nodes'>
                <oda-tree-node :show-users ~is="nodeTemplate" :hide-roots="hideRoots-1" :hide-tops="hideTops-1" ~for='items' :$item="$for?.item" :menu-mode></oda-tree-node>
            </div>
        </div>
    `,
    showUsers: false,
    menuMode: {
        $def: 'handlers',
        $list: ['tools', 'handlers', 'both']
    },
    setItemFocus(e){
        e.stopPropagation();
        this.$pdp.focusedItem = this.$item;
        this.$pdp.focusedNode = this;
    },
    get isFocused() {
        if (!this.$pdp.allowFocus)
            return false;
        const focused = this.$pdp.focusedItem === this.$item;
        if (focused && this.$pdp.focusedNode !== this) {
            this.$pdp.focusedNode = this;
        }
        return focused;
    },

    get isCategory() {
        return this.$pdp.allowCategories && this.hideRoots > 0 && this.$item?.type === '$folder'
    },
    _onDragstart(/**@type {DragEvent}*/e) {
        e.stopPropagation();
        if (e.dataTransfer) {
            const dt = e.dataTransfer;
            dt.setData('data', JSON.stringify(this.$item));
            dt.setData('application/json', JSON.stringify(this.$item));
            dt.setData('text/plain', this.$item.short);
            dt.setData('application/oda.work.shortcut', JSON.stringify({
                icon: this.$item.icon,
                label: this.$item.label,
                path: this.$item.short
            }));
            dt.effectAllowed = "all";
        }
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
        hideTops: {
            $def: 0,
            set(n) {
                if (n > 0) {
                    this.expanded = true;
                }
            }
        },
        hideRoots: {
            $def: 0,
            set(n) {
                if (n > 0) {
                    this.expanded = true;
                }
            }
        }
    },
    get $item() {
        return this.$for?.item;
    },
    expanded: {
        get() {
            return this.$pdp.expandAll || this.$item?.expanded || false;
        },
        async set(n) {
            if (this.$item && n !== undefined) {
                if (n) {
                    await this.$pdp.getItems(this.$item, 1);
                    this.$item.expanded = true;
                }
                this.$item.expanded = n;
            }
        }
    },
    checked: {
        async set(n) {
            if (n !== undefined) {
                if (this.$pdp.checkMode === 'ternary') {
                    // todo: рекурсия
                    //await this.$pdp.getItems(this.$item);
                }

                if (n) {
                    this.$pdp.checkedItems.add(this.$item);
                }
                else {
                    this.$pdp.checkedItems.remove(this.$item);
                }
            }
        },
        get(){
            return this.$pdp.checkedItems.includes(this.$item);
        }
    },
    get items() {
        return new AsyncPromise(async ()=>{
            let items = (await this.$item?.[this.$pdp.itemsSelector]) || [];
            if(this.$pdp.hideSystem)
                items = items.filter(f=>!f.isType)
            if(this.$pdp.hideReadme)
                items = items.filter(f => !/^readme\.md$/i.test(f.id))
            this.$item?.addEventListener?.('changed', e=>{
                this.items = undefined;
                this.async(async ()=>{
                    this.render();
                    this.$item.expanded = true;
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
        return new AsyncPromise(async ()=>{
            let icon = 'icons:chevron-right';
            if (this.expanded)
                icon += ':90'
            let items = await this.items;
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