import { bindLinkTree, isLinkNode } from './link-nodes.js';

/**
 * Есть ли дети по флагу сервера (hasItems), без запроса @items. undefined — флага нет
 * или он неприменим: ветка настройки достраивает детей на клиенте, фильтры дерева отсекают часть.
 */
export function knownHasItems(it, pdp = {}) {
    if (!it || isLinkNode(it) || it.type === '$server')
        return undefined;
    if (pdp.hideSystem || pdp.hideFiles || pdp.onlyClasses || pdp.itemsSelector !== 'items')
        return undefined;
    // __version — реактивная зависимость: после события changed флаг удаляется и пересчитывается по items
    it.__version;
    if (it.type === '$module' && (it.DATA?.enabled === false || it.DATA?.blocked === true || it.DATA?.systemBlocked === true))
        return false;
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
    get label() {
        return this.$item?.label || 'tree';
    },
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
        // тот же фильтр, что у узла (oda-tree-node.items): вне отладки неадмину корень показывает только классы —
        // иначе предзагрузка тянет @items скрытых узлов (node_modules, USERS, файлов корня)
        if ($item?.type === '$server' && items instanceof Array && !WORK?.DEV_MODE && !(await $item.isAdmin))
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
    runGlobalSearch() {
        const q = String(this.filter || '').trim();
        if (!q)
            return;
        const target = this.$item || globalThis.WORK;
        if (target && typeof window?.execute === 'function')
            window.execute(target, { view: 'search', q });
    },
    _onTreeScroll() {
        if (this._scrollRaf)
            return;
        this._scrollRaf = requestAnimationFrame(() => {
            this._scrollRaf = 0;
            const scroller = this.$('div[style*="overflow: auto"]');
            const scrollTop = scroller ? scroller.getBoundingClientRect().top : 0;
            for (const n of this._mountedNodes || [])
                n._syncStuck?.(scrollTop);
        });
    },
}
ODA({is: 'oda-tree-node',
    imports: 'oda//icon, ~/lib//node, ~/lib//users',
    template:/*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow: visible;
                padding: 0;
                min-width: 0;
            }
            .node {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
                overflow: hidden;
                height: 30px;
                min-height: 30px;
                padding: 0 2px;
                box-sizing: border-box;
                background: var(--content-background);
                color: var(--content-color);
            }
            .node.is-stuck {
                position: sticky !important;
                background: light-dark(#f6f6f8, color-mix(in oklch, var(--content-color) 10%, var(--content-background)));
                border-bottom: 1px solid var(--subtle-border);
                box-shadow: 0 1px 2px var(--shadow-color);
            }
            .node:hover:not(.node-focused) {
                background: color-mix(in oklch, var(--content-color) 6%, var(--content-background));
            }
            .node.is-stuck:hover:not(.node-focused) {
                background: light-dark(#ededf2, color-mix(in oklch, var(--content-color) 14%, var(--content-background)));
            }
            .node.node-focused {
                background: light-dark(#e0e0e0, color-mix(in oklch, var(--content-color) 18%, var(--content-background)));
                box-shadow: inset 0 -2px 0 var(--accent-color);
            }
            .node.module-blocked item-node {
                opacity: .5;
            }
            .sub-nodes {
                @apply --vertical;
                @apply --flex;
                overflow: visible;
                min-width: 0;
            }
            oda-icon {
                cursor: pointer;
            }
            /* экспандер — по верху первой строки: иначе при раскрытой панели
               он съезжает к центру выросшего узла */
            .node > oda-icon {
                align-self: flex-start;
                margin-top: 3px;
            }
            /* пользователи места — компактно в правом краю строки, название не сжимают */
            item-node item-users {
                @apply --no-flex;
            }
            /* доступ узла-ссылки: A — запись, R — только чтение */
            .access {
                font-size: xx-small;
                font-family: monospace;
                border: 1px solid var(--border-color);
                border-radius: 6px;
                padding: 0 3px;
                margin-left: 4px;
                opacity: .7;
                @apply --no-flex;
                align-self: center;
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
        <div draggable="true" ~if="hideTops<1" class='node' ~class="{'node-focused': isFocused, 'is-stuck': isStuck, 'module-blocked': isModuleBlocked}" :style="nodeStickyStyle" :category="isCategory"  @tap="isCategory?$pdp.focusedItem=$pdp.focusedItem:$pdp.focusedItem = $item" @dragstart>
            <oda-icon ~if="hideRoots<1" ~show="showExpander" :disabled="!expanderIcon" :icon="expanderIcon" :icon-size="expanderIconSize" @tap.stop="expanded = !expanded"></oda-icon>
            <div vertical flex style="min-width: 0; overflow: hidden;">
                <div horizontal flex style="min-width: 0; overflow: hidden; align-items: center;">
                    <oda-icon ~show="showCheckbox" :disabled="!checkboxIcon || (isModule && $item?.DATA?.systemBlocked)" :icon="checkboxIcon" :icon-size="20" :title="moduleCheckboxTitle" @tap.stop="checked = !checked"></oda-icon>
                    <item-node flex style="min-width: 0;" :expanded auto-run :show-users :show-size="showSize && !isCategory" :hide-icon="isCategory" :show-tools="isFocused && showTools" :menu-mode :$item :show-status @tap="setItemFocus">
                        <item-users ~if="isStructureNode" :$item="$item" role="BOSS" :select-mode="false" :icon-size="20"></item-users>
                        <item-users ~if="isPlace" :$item="$item.owner" :place="$item.trail" :select-mode="false" :icon-size="20"></item-users>
                        <span class="access" ~if="isLinkWrite">A</span>
                        <span class="access" ~if="isLinkRead">R</span>
                    </item-node>
                </div>
            </div>
        </div>
        <div horizontal flex ~if="expanded || $pdp.filter" style="min-height: 1px; overflow: visible;">
            <div class='step' ~if="hideRoots<1"></div>
            <div class='sub-nodes'>
                <oda-tree-node :show-status :show-users ~is="nodeTemplate" :sticky-level="hideTops > 0 || hideRoots > 0 ? stickyLevel : stickyLevel + 1" :hide-roots="hideRoots-1" :hide-tops="hideTops-1" ~for='items' :$item="$for?.item" :menu-mode></oda-tree-node>
            </div>
        </div>
    `,
    stickyLevel: 0,
    isStuck: false,
    attached() {
        const tree = this.$pdp?.tree;
        if (tree) {
            tree._mountedNodes ??= new Set();
            tree._mountedNodes.add(this);
        }
    },
    detached() {
        this.$pdp?.tree?._mountedNodes?.delete(this);
    },
    _syncStuck(scrollTop = 0) {
        if (!this.expanded || this.hideRoots > 0 || !this.expanderIcon) {
            if (this.isStuck)
                this.isStuck = false;
            return;
        }
        const subEl = this.$('.sub-nodes');
        if (!subEl) {
            if (this.isStuck)
                this.isStuck = false;
            return;
        }
        const lvl = Number(this.stickyLevel) || 0;
        const targetTop = scrollTop + lvl * 30;
        const hRect = this.getBoundingClientRect();
        const stuck = hRect.height > 34 && hRect.top <= targetTop + 1 && hRect.bottom > targetTop + 32;
        if (this.isStuck !== stuck)
            this.isStuck = stuck;
    },
    get nodeStickyStyle() {
        const lvl = Number(this.stickyLevel) || 0;
        const step = Number(this.$pdp?.step) || 12;
        const indent = lvl > 0 ? lvl * step : 0;
        const padStyle = indent > 0 ? `margin-left: -${indent}px; padding-left: ${2 + indent}px;` : '';
        if (!this.expanded || this.hideRoots > 0 || !this.expanderIcon)
            return padStyle;
        return `${padStyle} position: sticky !important; top: ${lvl * 30}px; z-index: ${30 - lvl};`;
    },
    get isStructureNode() {
        const it = this.$item;
        if (!it || isLinkNode(it) || ('isPlace' in Object(it) && it.isPlace))
            return false;
        const t = it.type;
        return t === '$base' || t === '$structure';
    },
    get isModule() {
        const it = this.$item;
        return Boolean(it && !isLinkNode(it) && it.type === '$module');
    },
    get isModuleBlocked() {
        if (!this.isModule)
            return false;
        this.$item.__version;
        return this.$item.DATA?.enabled === false || this.$item.DATA?.blocked === true || this.$item.DATA?.systemBlocked === true;
    },
    get moduleCheckboxTitle() {
        if (!this.isModule)
            return '';
        if (this.$item?.DATA?.systemBlocked)
            return 'Модуль заблокирован на уровне системы WORK (/MODULES/' + this.$item.id + ')';
        const inWorkRoot = String(this.$item?.path || '').startsWith('/MODULES/');
        if (this.isModuleBlocked)
            return inWorkRoot ? 'Модуль заблокирован во всей системе WORK (клик — включить)' : 'Модуль заблокирован в этой базе (клик — включить)';
        return inWorkRoot ? 'Модуль активен в системе WORK (клик — заблокировать во всей системе)' : 'Модуль активен в базе (клик — заблокировать в базе)';
    },
    get hasSecurity(){
        // Ветка настройки — только у подразделений ($structure и наследники)
        // с заполненной #security (ROLES, LINKS или назначения — флаг из $public).
        // Места и ссылки рисуются обычными дочерними узлами (см. items).
        const t = this.$item?.type;
        if (t !== '$structure' && t !== '$base' && t !== '$server')
            return false;
        return !!this.$item?.DATA?.hasSecurity;
    },
    /** Строка рабочего места (#security.ROLES): пользователи — через item-users в слоте. */
    get isPlace() {
        return !!this.$item && ('isPlace' in Object(this.$item)) && this.$item.isPlace === true;
    },
    /**
     * Значок доступа узла-ссылки. Чтение linkAccess только у ссылок:
     * у настоящих элементов его нет, и прямое чтение дёрнуло бы `_onEmpty`.
     */
    get isLinkWrite() {
        return isLinkNode(this.$item) && this.$item.linkAccess !== 'read';
    },
    get isLinkRead() {
        return isLinkNode(this.$item) && this.$item.linkAccess === 'read';
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
            // виртуальные узлы (места) не обязаны сериализоваться полностью
            let json = '';
            try {
                json = JSON.stringify(this.$item);
            }
            catch {
                json = JSON.stringify({ path: this.$item?.path, label: this.$item?.label });
            }
            dt.setData('data', json);
            dt.setData('application/json', json);
            dt.setData('text/plain', this.$item.short || this.$item.path || '');
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
        if (this.isModule)
            return true;
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
        if (!item)
            return false;
        if (String(item.label || item.id || '').toLowerCase().includes(f))
            return true;
        const rawKids = item[this.$pdp.itemsSelector];
        const cachedKids = Array.isArray(rawKids) ? rawKids : (item[R]?.cache?.[this.$pdp.itemsSelector] || []);
        if (Array.isArray(cachedKids) && cachedKids.some(k => this._deepMatch(k, f)))
            return true;
        const secKids = item._secNodes;
        if (Array.isArray(secKids) && secKids.some(k => this._deepMatch(k, f)))
            return true;
        return false;
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
                if (!n)
                    this.isStuck = false;
                this.$pdp?.tree?._onTreeScroll?.();
            }
        }
    },
    checked: {
        async set(n) {
            if (n !== undefined) {
                if (this.isModule && this.$pdp.checkMode === 'none') {
                    await this._toggleModuleEnabled(!!n);
                    return;
                }
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
            if (this.isModule && this.$pdp.checkMode === 'none') {
                this.$item.__version;
                return !this.isModuleBlocked;
            }
            return this.$pdp.checkedItems.includes(this.$item);
        }
    },
    async _toggleModuleEnabled(nextEnabled) {
        const it = this.$item;
        if (!it?.fetch)
            return;
        if (nextEnabled && it.DATA?.systemBlocked)
            return;
        try {
            const res = await it.fetch('set_enabled', { enabled: nextEnabled });
            if (it.DATA && res && typeof res === 'object') {
                it.DATA.enabled = res.enabled;
                it.DATA.localEnabled = res.localEnabled;
                it.DATA.systemBlocked = res.systemBlocked;
            }
            if (!res?.enabled)
                this.expanded = false;
            it.increaseVersion?.();
            it.fire?.('changed', { value: null });
        }
        catch (e) {
            console.warn('[tree] set_enabled:', e?.message || e);
        }
    },
    get items() {
        if (this.isModuleBlocked)
            return Promise.resolve([]);
        return Promise.resolve(this.$item?.[this.$pdp.itemsSelector]).then(async raw => {
            let items = applyTreeFilters(raw, this.$pdp);
            if (this.$item?.type === '$server') {
                //const allAdmins = await this.$item?.allAdmins;
                if (!WORK?.DEV_MODE && !(await this.$item.isAdmin)) {
                    items = items.filter(f => f instanceof CORE.$class);
                }
            }
            // Места и ссылки подразделения — обычные дочерние узлы дерева
            // (ветка настройки): места с пользователями, ссылки — цепочкой
            // от корня «Данные» через link-nodes. Кэш на узел, сброс — по 'changed'.
            try {
                if (this.hasSecurity && Array.isArray(items)) {
                    if (this._secTreeFor !== this.$item) {
                        this._secTree = null;
                        this._secTreeFor = this.$item;
                    }
                    this._secTree ??= this._buildSecNodes(this.$item);
                    const extra = await this._secTree;
                    if (extra?.length)
                        items = [...extra, ...items];
                }
            }
            catch { /* без ветки настройки */ }
            this.$item?.addEventListener?.('changed', e=>{
                this.async(async ()=>{
                    this._secTree = null;
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
     * Ветка настройки подразделения: узлы мест ($place) и цепочки ссылок.
     * Один запрос places на узел; результат кэшируется (см. items).
     */
    async _buildSecNodes(item) {
        if (!item || !item.path || item.type === '$server' || !(item instanceof CORE.$class))
            return [];
        let d = null;
        try {
            d = await item.fetch('places');
        }
        catch { return []; }
        if (!d || !d.places?.length)
            return [];
        const out = [];
        for (const p of d.places || [])
            out.push(await this._placeNode(item, p, ''));
        try {
            Object.defineProperty(item, '_secNodes', { value: out, configurable: true, writable: true });
        }
        catch { /* ignore */ }
        return out;
    },
    /** Узел рабочего места: вложенные места плюс цепочка его ссылок. */
    async _placeNode(structItem, p, trail) {
        const t = trail ? trail + '/' + p.id : p.id;
        const kids = [];
        for (const c of p.roles || [])
            kids.push(await this._placeNode(structItem, c, t));
        try {
            kids.push(...await bindLinkTree(p.tree || [], (path) => WORK.get_item(path)));
        }
        catch { /* без ссылок места */ }
        const node = {
            id: p.id,
            label: p.label || p.id,
            icon: p.icon || 'fontawesome:s-user-tie',
            type: '$place',
            trail: t,
            expanded: false,
            isPlace: true,
            items: kids,
        };
        // владелец — вне перечисляемых: иначе JSON.stringify узла закольцуется
        Object.defineProperty(node, 'owner', { value: structItem });
        return typeof Reactor?.activate === 'function' ? Reactor.activate(node) : node;
    },
    /**
     * Есть ли дети по флагу сервера (hasItems), без запроса @items. undefined — флага нет
     * или он неприменим (ветка настройки достраивает детей на клиенте, фильтры дерева отсекают часть).
     */
    get knownHasItems() {
        return knownHasItems(this.$item, this.$pdp);
    },
    get expanderIcon() {
        if (this.isModuleBlocked)
            return '';
        let icon = 'icons:chevron-right';
        if (this.expanded)
            icon += ':90'
        // у подразделения с настройкой стрелка есть всегда —
        // иначе узел без детей (как «Продажи») нельзя раскрыть и ветку не увидеть
        if (this.hasSecurity)
            return icon;
        const known = this.knownHasItems;
        if (known !== undefined)
            return known ? icon : '';
        return Promise.resolve(this.items).then(items => items?.length ? icon : '');
    },
    iconChecked: 'icons:check-box',
    iconUnchecked: 'icons:check-box-outline-blank',
    iconIntermediate: 'icons:check-box-indeterminate',
    get checkboxIcon() {
        if (this.isModule && this.$pdp.checkMode === 'none')
            return this.checked ? this.iconChecked : this.iconUnchecked;
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
