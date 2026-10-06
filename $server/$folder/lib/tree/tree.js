import { isLinkNode } from './link-nodes.js';

/**
 * Есть ли дети по флагу сервера (hasItems), без запроса @items. undefined — флага нет
 * или он неприменим: ссылки и группы достраивают детей на клиенте, фильтры дерева отсекают часть.
 */
export function knownHasItems(it, pdp = {}) {
    if (!it || isLinkNode(it) || it.type === '$server')
        return undefined;
    if (pdp.hideSystem || pdp.hideFiles || pdp.onlyClasses || pdp.itemsSelector !== 'items')
        return undefined;
    // __version — реактивная зависимость: после события changed флаг удаляется и пересчитывается по items
    it.__version;
    const v = it.DATA?.hasItems;
    return typeof v === 'boolean' ? v : undefined;
}

function applyTreeFilters(items, host) {
    items = items || [];
    if (host.hideSystem)
        items = items.filter(f => !f.isType);
    if (host.hideFiles)
        items = items.filter(f => !(f instanceof CORE.$file));
    if (host.onlyClasses)
        items = items.filter(f => f instanceof CORE.$class);
    return items;
}

export default {
    imports: 'oda//tree',
    extends: 'oda-tree',
    /** строки и поиск — из базового шаблона; узлы — системные (item-node, $item) */
    nodeTemplate: 'oda-tree-node',
    itemTemplate: 'oda-tree-node',
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
        /** фильтры системных типов */
        hideSystem: false,
        hideFiles: false,
        onlyClasses: false, // только CORE.$class (site)
    },
    showUsers: false,
    showSize: false,
    showStatus: false,
    get expanderIconSize(){
        return ODA.states?.mobileMode ? this.iconSize * 1.5 : this.iconSize;
    },
    $item: {
        async set(n) {
            if (n) {
                n?.addEventListener?.('changed', e => {
                    this.isChanged = true;
                    this.render();
                })
                await this.prefetch(n);
                await this.getItems(n, 1)
                this.items = [n];
            }
            else {
                this.items = [];
            }
        }
    },
    /** Глубина первого слоя дерева одним запросом info (вглубь — по классам); 0 — выключить. */
    prefetchDeep: 3,
    /**
     * Первый слой дерева одним запросом: info точки входа на prefetchDeep уровней.
     * Вложенные списки раскладываются по элементам (__bind), у нижнего уровня — hasItems:
     * @items уходит только при раскрытии глубже предзагруженного.
     */
    async prefetch($item) {
        if (!this.prefetchDeep || this.itemsSelector !== 'items' || !$item?.fetch)
            return;
        if (Array.isArray($item[R]?.cache?.items))
            return;
        try {
            const res = await WORK.fetch(location.origin + ($item.short || '/'), 'info', { deep: this.prefetchDeep, branch: 'classes' });
            if (!Array.isArray(res?.items))
                return;
            $item.items = WORK.__bind(res.items);
            if (typeof res.hasItems === 'boolean' && $item.DATA)
                $item.DATA.hasItems = res.hasItems;
        }
        catch { /* как раньше — по @items */ }
    },
    /** предзагрузка дочерних $item с системными фильтрами */
    async getItems($item, deep = 0) {
        // дети уже известны или их нет — заранее не грузим (стрелка — по hasItems, список — при раскрытии)
        if (deep < 1 && typeof $item?.DATA?.hasItems === 'boolean' && !Array.isArray($item[R]?.cache?.[this.itemsSelector]))
            return;
        let items = applyTreeFilters(await $item?.[this.itemsSelector], this);
        // тот же фильтр, что у узла (oda-tree-node.items): неадмину корень показывает только классы —
        // иначе предзагрузка тянет @items скрытых узлов (node_modules, USERS, файлов корня)
        if ($item?.type === '$server' && items instanceof Array && !(await $item.isAdmin))
            items = items.filter(f => f instanceof CORE.$class);
        if (items instanceof Array && deep > 0) {
            for (let next of items) {
                await this.getItems(next, deep - 1);
            }
        }
    },
    /** навигация базового дерева — по $item */
    nodeOf(nodeComp) {
        return nodeComp?.$item;
    },
    rootItems() {
        return this.$item ? [this.$item] : [];
    },
    async nodeChildren(node) {
        return applyTreeFilters(Array.isArray(node?.[this.itemsSelector]) ? node[this.itemsSelector] : [], this);
    },
}
ODA({is: 'oda-tree-node',
    imports: 'oda//icon, ~/lib//node',
    template:/*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
                padding: 2px;
            }
            .node {
                @apply --horizontal;
                @apply --flex;
                align-items: center;
                overflow: hidden;
                top: 0px;
                position: sticky;
            }
            .node:hover {
                background: var(--accent-soft);
            }
            .node.focused {
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
        </style>
        <style>
            .step {
                width: {{hideTops>0?0:$pdp.step}}px;
                @apply --no-flex;
                border-right: 1px dotted var(--border-color);
            }
            oda-icon {
                order: {{$pdp.expanderOrder}};
            }
            [category]{
                font-size: var(--font-size-xs);
                @apply --dark;
            }
            [category]>item-node{
                padding: 0px;
            }
        </style>
        <div draggable="true" ~if="hideTops<1" class='node' ~class="{focused: isFocused}" :category="isCategory"  @tap="isCategory?$pdp.focusedItem=$pdp.focusedItem:$pdp.focusedItem = $item" @dragstart>
            <oda-icon ~if="hideRoots<1" ~show="showExpander" :disabled="!expanderIcon" :icon="expanderIcon" :icon-size="expanderIconSize" @tap.stop="expanded = !expanded"></oda-icon>
            <div vertical flex>
                <div horizontal flex>
                    <oda-icon ~show="showCheckbox" :disabled="!checkboxIcon" :icon="checkboxIcon" :icon-size @tap.stop="checked = !checked"></oda-icon>
                    <item-node :expanded auto-run :show-users :show-size="showSize && !isCategory" :hide-icon="isCategory" :show-tools="isFocused && showTools" :menu-mode :$item :show-status @tap="setItemFocus"></item-node>
                </div>
                <item-security ~if="hasSecurity" ~show="expanded"></item-security>
            </div>
        </div>
        <div horizontal flex ~if="expanded || $pdp.filter" style="min-height: 1px;">
            <div class='step' ~if="hideRoots<1"></div>
            <div class='sub-nodes'>
                <oda-tree-node :show-status :show-users ~is="nodeTemplate" :hide-roots="hideRoots-1" :hide-tops="hideTops-1" ~for='items' :$item="$for?.item" :menu-mode></oda-tree-node>
            </div>
        </div>
    `,
    get hasSecurity(){
        // Панель безопасности — только у подразделений ($structure и наследники);
        // пустая (без ROLES и LINKS) скрывается самим item-security.
        const t = this.$item?.type;
        return t === '$structure' || t === '$base' || t === '$server';
    },
    showStatus: false,
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
    hidden: {
        $def: false,
        $attr: true,
        /** скрыт поиском: ни сам, ни синхронно доступные потомки не совпали */
        get() {
            const f = String(this.$pdp.filter || '').toLowerCase();
            if (!f)
                return false;
            return !this._deepMatch(this.$item, f);
        }
    },
    _deepMatch(item, f) {
        if (String(item?.label || item?.id || '').toLowerCase().includes(f))
            return true;
        const kids = item?.[this.$pdp.itemsSelector];
        return Array.isArray(kids) && kids.some(k => this._deepMatch(k, f));
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
        return Promise.resolve(this.$item?.[this.$pdp.itemsSelector]).then(async raw => {
            let items = applyTreeFilters(raw, this.$pdp);
            if (this.$item?.type === '$server') {
                //const allAdmins = await this.$item?.allAdmins;
                if (!(await this.$item.isAdmin)) {
                    items = items.filter(f => f instanceof CORE.$class);
                }
            }
            // Подразделения показывают состав мест и ссылки панелью item-security
            // под узлом (см. hasSecurity) — отдельными детьми в дереве они не идут.
            this.$item?.addEventListener?.('changed', e=>{
                this.async(async ()=>{
                    this._linkTree = null;
                    this.$item.expanded = true;
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
    /**
     * Есть ли дети по флагу сервера (hasItems), без запроса @items. undefined — флага нет
     * или он неприменим (ссылки и группы достраивают детей на клиенте, фильтры дерева отсекают часть).
     */
    get knownHasItems() {
        return knownHasItems(this.$item, this.$pdp);
    },
    get expanderIcon() {
        let icon = 'icons:chevron-right';
        if (this.expanded)
            icon += ':90'
        const known = this.knownHasItems;
        if (known !== undefined)
            return known ? icon : '';
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
