ODA({is: 'oda-tabs', imports: 'oda//button, oda//icon, oda//menu-list',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                align-items: center;
                overflow: hidden;
                max-width: 100%;
                max-height: 100%;
                box-sizing: border-box;
                gap: 6px;
                user-select: none;
            }
            :host([direction="vertical"]) {
                flex-direction: column;
                align-items: stretch;
            }
            :host([variant="bar"]) {
                background: var(--subtle-background);
                color: var(--content-color);
                border-bottom: 1px solid var(--subtle-border);
                padding: 4px 8px;
                min-height: 38px;
            }
            :host([variant="rail"]) {
                @apply --accent-invert;
                padding: 4px 8px;
                min-height: 38px;
            }
            :host([variant="pills"]) {
                background: var(--subtle-background);
                color: var(--content-color);
                border: 1px solid var(--subtle-border);
                border-radius: 10px;
                padding: 3px;
                gap: 3px;
                width: fit-content;
                min-height: 34px;
            }
            :host([variant="bar"][compact]),
            :host([variant="rail"][compact]) {
                padding: 3px 6px;
                min-height: 32px;
            }
            :host([variant="pills"][compact]) {
                padding: 2px;
                min-height: 30px;
            }
            :host([hidden]) {
                display: none !important;
            }
            :host([selected]) {
                outline: 2px solid var(--accent-color);
            }
            .tablist-wrap {
                @apply --horizontal;
                align-items: center;
                flex: 1 1 auto;
                min-width: 0;
                overflow: hidden;
                outline: none;
            }
            :host([direction="vertical"]) .tablist-wrap {
                flex-direction: column;
                align-items: stretch;
            }
            #scroller {
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 4px;
                flex: 1 1 auto;
                min-width: 0;
                overflow-x: auto;
                overflow-y: hidden;
                scrollbar-width: none;
            }
            #scroller::-webkit-scrollbar {
                display: none;
            }
            :host([direction="vertical"]) #scroller {
                flex-direction: column;
                align-items: stretch;
                overflow-x: hidden;
                overflow-y: auto;
            }
            :host([variant="pills"]) #scroller,
            :host([no-shrink]) #scroller {
                flex-wrap: wrap;
                overflow: visible;
                gap: 3px;
            }
            .extra-buttons {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
            }
            .list-btn {
                border-radius: 8px !important;
                min-width: 26px;
                width: 26px;
                height: 26px;
                padding: 0 !important;
                flex-shrink: 0;
                opacity: 0.78;
                transition: background-color var(--duration-fast) var(--easing), opacity var(--duration-fast) var(--easing);
            }
            .list-btn:hover {
                opacity: 1;
            }
            :host([variant="rail"]) .list-btn {
                color: var(--accent-back);
                fill: var(--accent-back);
            }
            :host([variant="rail"]) .list-btn:hover {
                background: color-mix(in oklch, var(--accent-back) 14%, transparent);
            }
        </style>
        <slot name="left" class="no-flex horizontal-center"></slot>
        <div class="tablist-wrap" role="tablist" aria-label="Вкладки" tabindex="0" @keydown="_onKeydown">
            <div id="scroller"
                @resize="_onResize"
                @scroll="_onScroll"
                :direction
                @mousewheel.passive="_onMousewheel"
                @dragover="_onDragover">
                <oda-tabs-tab
                    role="tab"
                    :aria-selected="$for.index === focusedIndex ? 'true' : 'false'"
                    :selected="$for.index === selectedIndex && selectedIndex !== focusedIndex"
                    :draggable="allowDrag ? 'true' : 'false'"
                    ~for="items"
                    :item="$for.item"
                    :index="$for.index">
                </oda-tabs-tab>
            </div>
        </div>
        <div class="extra-buttons" ~if="buttons?.length">
            <oda-button :icon-size="16"
                role="button"
                ~for="buttons"
                ~props="$for.item">
            </oda-button>
        </div>
        <slot name="right" class="no-flex horizontal-center"></slot>
        <oda-button
            class="list-btn"
            ~if="showListBtn"
            no-flex
            icon="icons:expand-more"
            :icon-size="18"
            title="Список открытых вкладок"
            @tap.stop="openTabsMenu($event)">
        </oda-button>
    `,
    buttons: [],
    items: [],
    _onResize() {
        this.__is_vertical = undefined;
    },
    _onScroll() {
        this.__is_vertical = undefined;
    },
    attached() {
        requestAnimationFrame(() => {
            this.focusedTab?.scrollIntoView({
                inline: 'nearest',
                block: 'nearest'
            });
        });
    },
    get showListBtn() {
        if (!this.allowList || this.variant === 'pills')
            return false;
        return Array.isArray(this.items) && this.items.length > 1;
    },
    get hasAnyClosable() {
        if (!Array.isArray(this.items))
            return false;
        return this.items.some(i => i?.closable !== false && (this.allowClose || i?.allowClose || i?.closable));
    },
    isTabClosable(item) {
        if (!item || item.closable === false)
            return false;
        return Boolean(this.allowClose || item.allowClose || item.closable);
    },
    selectTab(index, event = null) {
        const list = this.items || [];
        if (index < 0 || index >= list.length)
            return;
        const item = list[index];
        if (item?.disabled)
            return;
        this.dimmed = false;
        this.focusedIndex = index;
        this.dispatchEvent(new CustomEvent('tab-select', {
            detail: { item, index, event },
            bubbles: true,
            composed: true,
        }));
    },
    requestCloseTab(index, event = null) {
        const list = this.items || [];
        const item = list[index];
        if (!this.isTabClosable(item))
            return;
        const closeEvt = new CustomEvent('tab-close', {
            detail: { item, index, event },
            bubbles: true,
            composed: true,
            cancelable: true,
        });
        this.dispatchEvent(closeEvt);
        this.fire('close', item);
        if (!closeEvt.defaultPrevented && typeof item.close === 'function')
            item.close(item, index);
    },
    async closeOthers(keepIndex) {
        const list = this.items || [];
        const keepItem = list[keepIndex];
        const evt = new CustomEvent('close-others', {
            detail: { item: keepItem, index: keepIndex },
            bubbles: true,
            composed: true,
            cancelable: true,
        });
        this.dispatchEvent(evt);
        if (evt.defaultPrevented)
            return;
        const targets = list.filter((it, idx) => idx !== keepIndex && this.isTabClosable(it));
        for (const it of targets.reverse()) {
            const idx = (this.items || []).indexOf(it);
            if (idx >= 0)
                this.requestCloseTab(idx);
        }
    },
    async closeRight(fromIndex) {
        const list = this.items || [];
        const fromItem = list[fromIndex];
        const evt = new CustomEvent('close-right', {
            detail: { item: fromItem, index: fromIndex },
            bubbles: true,
            composed: true,
            cancelable: true,
        });
        this.dispatchEvent(evt);
        if (evt.defaultPrevented)
            return;
        const targets = list.filter((it, idx) => idx > fromIndex && this.isTabClosable(it));
        for (const it of targets.reverse()) {
            const idx = (this.items || []).indexOf(it);
            if (idx >= 0)
                this.requestCloseTab(idx);
        }
    },
    async closeAll() {
        const evt = new CustomEvent('close-all', {
            detail: { items: this.items },
            bubbles: true,
            composed: true,
            cancelable: true,
        });
        this.dispatchEvent(evt);
        if (evt.defaultPrevented)
            return;
        const targets = (this.items || []).filter(it => this.isTabClosable(it));
        for (const it of targets.reverse()) {
            const idx = (this.items || []).indexOf(it);
            if (idx >= 0)
                this.requestCloseTab(idx);
        }
    },
    async openTabsMenu(e) {
        const list = this.items || [];
        if (!list.length)
            return;
        const anchor = e?.currentTarget || e?.target || this;
        const menuItems = list.map((item, idx) => ({
            label: (item.dirty ? '● ' : '') + (item.label || item.title || `Вкладка ${idx + 1}`),
            icon: item.icon || this.defaultIcon || 'icons:dashboard',
            value: idx,
            execute: () => this.selectTab(idx),
        }));
        const closables = list.filter(i => this.isTabClosable(i));
        if (closables.length > 0 && list.length > 1) {
            menuItems.push({
                group: 'Действия',
                label: this.closeAllLabel || 'Закрыть все',
                icon: 'icons:close',
                value: '__close_all__',
                execute: () => this.closeAll(),
            });
        }
        try {
            await ODA.showMenu({ items: menuItems, value: this.focusedIndex }, anchor);
        }
        catch { /* отмена */ }
    },
    async _openTabContextMenu(index, e) {
        if (!this.allowContextMenu)
            return;
        const list = this.items || [];
        const item = list[index];
        if (!item)
            return;
        if (!this.hasAnyClosable)
            return;
        e.preventDefault();
        e.stopPropagation();
        const canCloseThis = this.isTabClosable(item);
        const hasOthers = list.some((it, idx) => idx !== index && this.isTabClosable(it));
        const hasRight = list.some((it, idx) => idx > index && this.isTabClosable(it));
        const hasAny = list.some(it => this.isTabClosable(it)) && list.length > 1;
        const menuItems = [
            {
                label: 'Закрыть',
                icon: 'icons:close',
                disabled: !canCloseThis,
                value: 'close',
                execute: () => this.requestCloseTab(index, e),
            },
            {
                label: 'Закрыть другие',
                icon: 'icons:clear-all',
                disabled: !hasOthers,
                value: 'others',
                execute: () => this.closeOthers(index),
            },
            {
                label: 'Закрыть справа',
                icon: 'icons:arrow-forward',
                disabled: !hasRight,
                value: 'right',
                execute: () => this.closeRight(index),
            },
            {
                group: 'Все вкладки',
                label: this.closeAllLabel || 'Закрыть все',
                icon: 'icons:delete-sweep',
                disabled: !hasAny,
                value: 'all',
                execute: () => this.closeAll(),
            },
        ];
        try {
            await ODA.showMenu({ items: menuItems }, e);
        }
        catch { /* отмена */ }
    },
    _onDragover(e) {
        if (!this.allowDrag || !drag.item || drag.host !== this)
            return;
        e.dataTransfer.effectAllowed = 'move';
        e.preventDefault();
        const pos = this.__is_vertical ? e.clientY : e.clientX;
        const delta = pos - drag.start;
        const scroller = this.__scroller;
        if (!scroller)
            return;
        const rect = scroller.getBoundingClientRect();
        const start = this.__is_vertical ? rect.top : rect.left;
        const end = this.__is_vertical ? rect.bottom : rect.right;
        if (pos < start + 24)
            drag.start += this.__scroll(12);
        else if (pos > end - 24)
            drag.start += this.__scroll(-12);

        const tr = 'translate' + (this.__is_vertical ? 'Y' : 'X');
        const dragCenter = pos - drag.pointer + (drag.item[this.offsetSize] / 2);
        let newIndex = drag.fromIndex;
        const children = Array.from(scroller.children).filter(el => el.localName === 'oda-tabs-tab');
        for (const el of children) {
            if (el === drag.item) {
                el.style.transform = `${tr}(${delta}px)`;
                continue;
            }
            const r = el.getBoundingClientRect();
            const center = this.__is_vertical ? (r.top + r.height / 2) : (r.left + r.width / 2);
            if (el.index < drag.fromIndex && dragCenter < center) {
                el.style.transform = `${tr}(${drag.item[this.offsetSize] + 4}px)`;
                if (el.index < newIndex)
                    newIndex = el.index;
            }
            else if (el.index > drag.fromIndex && dragCenter > center) {
                el.style.transform = `${tr}(${-(drag.item[this.offsetSize] + 4)}px)`;
                if (el.index > newIndex)
                    newIndex = el.index;
            }
            else {
                el.style.transform = '';
            }
        }
        drag.toIndex = newIndex;
    },
    get tabs() {
        return this;
    },
    _onMousewheel(e) {
        if (this.variant === 'pills' || this.noShrink)
            return;
        const delta = e.deltaY || -e.wheelDelta || 0;
        if (delta && this.__scroller)
            this.__scroller.scrollLeft += delta;
    },
    __scroll(step) {
        if (!this.__scroller)
            return 0;
        let move = 0;
        if (this.direction === 'horizontal') {
            move = this.__scroller.scrollLeft;
            this.__scroller.scrollLeft -= step;
            move -= this.__scroller.scrollLeft;
        }
        else {
            move = this.__scroller.scrollTop;
            this.__scroller.scrollTop -= step;
            move -= this.__scroller.scrollTop;
        }
        return move;
    },
    toHome() {
        if (this.__scroller)
            this.__scroller.scrollTop = this.__scroller.scrollLeft = 0;
    },
    toEnd() {
        if (this.__scroller)
            this.__scroller.scrollTop = this.__scroller.scrollLeft = 100000000;
    },
    get __scroller() {
        return this.$('#scroller') || undefined;
    },
    get __scrollSize() {
        return this.__is_vertical ? this.__scroller?.scrollHeight : this.__scroller?.scrollWidth;
    },
    get __scrollPos() {
        return Math.round(this.__is_vertical ? (this.__scroller?.scrollTop || 0) : (this.__scroller?.scrollLeft || 0));
    },
    get __scrollerWidth() {
        return this.__is_vertical ? this.__scroller?.offsetHeight : this.__scroller?.offsetWidth;
    },
    get __buttonSize() {
        return Math.round((this.iconSize || 16) * 0.85);
    },
    $public: {
        variant: {
            $def: 'bar',
            $list: ['bar', 'rail', 'pills'],
            $attr: true,
        },
        compact: {
            $def: false,
            $type: Boolean,
            $attr: true,
        },
        noShrink: {
            $def: false,
            $type: Boolean,
            $attr: true,
        },
        allowDrag: false,
        allowClose: false,
        allowList: true,
        allowContextMenu: true,
        closeAllLabel: 'Закрыть все',
        align: {
            $list: ['left', 'bottom', 'right', 'top'],
            $def: 'top',
            set() {
                if (!this.__scroller) return;
                requestAnimationFrame(() => {
                    for (const el of this.__scroller.children) {
                        el.render?.(true);
                    }
                });
            }
        },
        focusedIndex: {
            $def: 0,
            set() {
                this.selectedIndex = -1;
                this.debounce('focusedIndex', () => {
                    this.focusedTab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
                });
            }
        },
        iconSize: 16,
        maxWidth: 230,
        dimmed: false,
        defaultIcon: ''
    },
    get focused() {
        return this.items?.[this.focusedIndex];
    },
    get focusedTab() {
        return this.__scroller?.children?.[this.focusedIndex] || null;
    },
    get __is_vertical() {
        return this.align === 'left' || this.align === 'right';
    },
    direction: {
        $type: String,
        $attr: true,
        get() {
            return this.__is_vertical ? 'vertical' : 'horizontal';
        }
    },
    get offsetSize() {
        return this.__is_vertical ? 'offsetHeight' : 'offsetWidth';
    },
    get offsetStart() {
        return this.__is_vertical ? 'offsetTop' : 'offsetLeft';
    },
    selectedIndex: -1,
    _onKeydown(e) {
        const len = this.items?.length || 0;
        if (!len)
            return;
        const currentIndex = this.selectedIndex === -1 ? Math.max(0, this.focusedIndex) : this.selectedIndex;
        switch (e.key) {
            case 'Escape':
                this.selectedIndex = -1;
                this.focusedTab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
                break;
            case ' ':
            case 'Enter':
                e.preventDefault();
                this.selectTab(currentIndex, e);
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                if (currentIndex > 0) {
                    this.selectedIndex = currentIndex - 1;
                    this.__scroller?.children?.[this.selectedIndex]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
                }
                break;
            case 'ArrowRight':
            case 'ArrowDown':
                e.preventDefault();
                if (currentIndex < len - 1) {
                    this.selectedIndex = currentIndex + 1;
                    this.__scroller?.children?.[this.selectedIndex]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
                }
                break;
            case 'Home':
                e.preventDefault();
                this.selectTab(0, e);
                break;
            case 'End':
                e.preventDefault();
                this.selectTab(len - 1, e);
                break;
        }
    }
});

const drag = {
    item: null,
    host: null,
    fromIndex: -1,
    toIndex: -1,
    pointer: 0,
    start: 0,
};

ODA({
    is: 'oda-tabs-tab',
    template: /*html*/`
        <style>
            :host {
                display: flex;
                flex: 0 1 auto;
                min-width: 34px;
                max-width: 230px;
                height: 30px;
                border-radius: 9px;
                position: relative;
                overflow: hidden;
                cursor: pointer;
                user-select: none;
                box-sizing: border-box;
                transition: background-color var(--duration-fast) var(--easing),
                            box-shadow var(--duration-fast) var(--easing),
                            color var(--duration-fast) var(--easing),
                            opacity var(--duration-fast) var(--easing),
                            transform var(--duration-fast) var(--easing);
            }
            :host([no-icon]) {
                min-width: 56px;
            }
            :host([aria-selected="true"]) {
                flex: 0 0 auto;
                min-width: 88px;
                max-width: 270px;
                z-index: 1;
            }
            :host([no-shrink]) {
                flex: 0 0 auto;
                min-width: max-content;
                max-width: none;
            }
            :host([compact]) {
                height: 26px;
                border-radius: 7px;
            }
            :host([variant="pills"]) {
                flex: 0 0 auto;
                min-width: max-content;
                max-width: none;
                height: 28px;
                border-radius: 7px;
            }
            :host([variant="bar"]) {
                color: var(--content-color);
                fill: var(--content-color);
                opacity: 0.82;
            }
            :host([variant="bar"]:hover) {
                opacity: 1;
                background: color-mix(in oklch, var(--content-color) 6%, transparent);
            }
            :host([variant="bar"][aria-selected="true"]) {
                opacity: 1;
                background: var(--content-background);
                color: var(--accent-color);
                fill: var(--accent-color);
                box-shadow: var(--elevation-2);
                font-weight: 600;
            }
            :host([variant="rail"]) {
                color: var(--accent-back);
                fill: var(--accent-back);
                opacity: 0.88;
            }
            :host([variant="rail"]:hover) {
                opacity: 1;
                background: color-mix(in oklch, var(--accent-back) 14%, transparent);
            }
            :host([variant="rail"][aria-selected="true"]) {
                opacity: 1;
                background: var(--light-background);
                color: var(--light-color);
                fill: var(--light-color);
                box-shadow: 0 2px 6px var(--shadow-color);
                font-weight: 700;
            }
            :host([variant="pills"]) {
                color: var(--content-color);
                fill: var(--content-color);
                opacity: 0.78;
            }
            :host([variant="pills"]:hover) {
                opacity: 1;
                background: color-mix(in oklch, var(--content-color) 6%, transparent);
            }
            :host([variant="pills"][aria-selected="true"]) {
                opacity: 1;
                background: var(--content-background);
                color: var(--accent-color);
                fill: var(--accent-color);
                box-shadow: var(--elevation-1);
                font-weight: 600;
            }
            :host([selected]) {
                outline: 2px solid var(--focus-ring-color);
                outline-offset: -2px;
            }
            :host([disabled]) {
                opacity: 0.45;
                pointer-events: none;
            }
            .panel {
                display: flex;
                align-items: center;
                width: 100%;
                min-width: 0;
                height: 100%;
                padding: 0 9px;
                box-sizing: border-box;
                overflow: hidden;
            }
            :host([variant="pills"]) .panel {
                padding: 0 11px;
            }
            .tab-icon {
                flex-shrink: 0;
            }
            .tab-label {
                flex: 1 1 0;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 13px;
                line-height: 1.25;
                margin-left: 6px;
            }
            :host([no-icon]) .tab-label {
                margin-left: 0;
            }
            :host([variant="pills"]) .tab-label,
            :host([compact]) .tab-label {
                font-size: 12.5px;
            }
            .tab-badge {
                flex-shrink: 0;
                margin-left: 6px;
                font-size: 11px;
                font-weight: 600;
                line-height: 16px;
                min-width: 18px;
                height: 16px;
                padding: 0 5px;
                border-radius: 999px;
                text-align: center;
                box-sizing: border-box;
                background: color-mix(in oklch, currentColor 12%, transparent);
                color: inherit;
            }
            :host([aria-selected="true"]) .tab-badge {
                background: var(--accent-soft);
                color: var(--accent-color);
            }
            :host([variant="rail"][aria-selected="true"]) .tab-badge {
                background: color-mix(in oklch, var(--light-color) 14%, transparent);
                color: var(--light-color);
            }
            .tab-tail {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                width: 0;
                margin-left: 0;
                opacity: 0;
                overflow: hidden;
                transition: width var(--duration-fast) var(--easing),
                            opacity var(--duration-fast) var(--easing),
                            margin-left var(--duration-fast) var(--easing);
            }
            :host([aria-selected="true"]) .tab-tail.has-tail,
            :host(:hover) .tab-tail.has-tail,
            .tab-tail.is-dirty {
                width: 18px;
                margin-left: 4px;
                opacity: 1;
            }
            .dirty-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: var(--accent-color);
                display: block;
            }
            :host([variant="rail"]:not([aria-selected="true"])) .dirty-dot {
                background: var(--accent-back);
            }
            :host(:hover) .tab-tail.can-close .dirty-dot {
                display: none;
            }
            .close-btn {
                display: none;
                align-items: center;
                justify-content: center;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                cursor: pointer;
                opacity: 0.72;
                transition: background-color var(--duration-fast) var(--easing), opacity var(--duration-fast) var(--easing);
            }
            :host([aria-selected="true"]) .tab-tail.can-close:not(.is-dirty) .close-btn,
            :host(:hover) .tab-tail.can-close .close-btn {
                display: inline-flex;
            }
            .close-btn:hover {
                opacity: 1;
                background: color-mix(in oklch, currentColor 14%, transparent);
            }
        </style>
        <div class="panel" :title="tooltip" @tap="focus($event)">
            <oda-icon class="tab-icon" ~if="hasIcon" :icon="resolvedIcon" :icon-size="resolvedIconSize"></oda-icon>
            <span class="tab-label" ~if="label">{{label}}</span>
            <span class="tab-badge" ~if="showBadge">{{badgeText}}</span>
            <span class="tab-tail" ~class="{ 'has-tail': canClose || isDirty, 'can-close': canClose, 'is-dirty': isDirty }" ~if="canClose || isDirty">
                <span class="dirty-dot" ~if="isDirty" title="Есть несохранённые изменения"></span>
                <span class="close-btn" ~if="canClose" title="Закрыть" @tap.stop="close($event)" @pointerdown.stop>
                    <oda-icon icon="icons:close" :icon-size="13"></oda-icon>
                </span>
            </span>
        </div>
    `,
    variant: {
        $attr: true,
        get() {
            return this.host?.variant || 'bar';
        }
    },
    compact: {
        $attr: true,
        $type: Boolean,
        get() {
            return Boolean(this.host?.compact);
        }
    },
    noShrink: {
        $attr: true,
        $type: Boolean,
        get() {
            return Boolean(this.host?.noShrink);
        }
    },
    noIcon: {
        $attr: true,
        $type: Boolean,
        get() {
            return !this.hasIcon;
        }
    },
    get hasIcon() {
        return Boolean(this.resolvedIcon);
    },
    get resolvedIcon() {
        return this.item?.icon || this.host?.defaultIcon || '';
    },
    get resolvedIconSize() {
        return this.host?.compact ? 14 : (this.host?.iconSize || 16);
    },
    get canClose() {
        return Boolean(this.host?.isTabClosable?.(this.item));
    },
    get isDirty() {
        return Boolean(this.item?.dirty);
    },
    get label() {
        return this.item?.label || '';
    },
    get tooltip() {
        return this.item?.title || this.label || '';
    },
    get showBadge() {
        const c = this.item?.count;
        return c !== undefined && c !== null && c !== '' && c !== 0 && c !== '0' || Boolean(this.item?.showZeroCount && c === 0);
    },
    get badgeText() {
        return String(this.item?.count ?? '');
    },
    get disabled() {
        return Boolean(this.item?.disabled);
    },
    $listeners: {
        mousedown(e) {
            if (e.button === 1 && this.canClose)
                e.preventDefault();
        },
        auxclick(e) {
            if (e.button === 1 && this.canClose) {
                e.preventDefault();
                e.stopPropagation();
                this.close(e);
            }
        },
        contextmenu(e) {
            this.host?._openTabContextMenu?.(this.index, e);
        },
        dragstart(e) {
            if (!this.host?.allowDrag) {
                e.preventDefault();
                return;
            }
            e.dataTransfer.setData('text/plain', String(this.index));
            e.dataTransfer.setDragImage(document.createElement('img'), 0, 0);
            e.dataTransfer.effectAllowed = 'move';
            drag.item = this;
            drag.host = this.host;
            drag.fromIndex = this.index;
            drag.toIndex = this.index;
            drag.pointer = this.host.__is_vertical ? e.offsetY : e.offsetX;
            drag.start = this.host.__is_vertical ? e.clientY : e.clientX;
            this.style.transition = 'none';
            this.style.zIndex = 2;
            this.style.opacity = '0.85';
        },
        dragend() {
            const scroller = this.host?.__scroller;
            if (scroller) {
                for (const el of scroller.children) {
                    el.style.transform = '';
                }
            }
            this.style.transform = '';
            this.style.transition = '';
            this.style.zIndex = '';
            this.style.opacity = '';
            drag.item = null;
            drag.host = null;
            drag.fromIndex = -1;
            drag.toIndex = -1;
        },
        drop(e) {
            e.preventDefault();
            if (!drag.item || drag.host !== this.host)
                return;
            const fromIndex = drag.fromIndex;
            const toIndex = drag.toIndex >= 0 ? drag.toIndex : this.index;
            const scroller = this.host?.__scroller;
            if (scroller) {
                for (const el of scroller.children) {
                    el.style.transform = '';
                }
            }
            if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex)
                return;
            const next = [...(this.host.items || [])];
            const focusedItem = next[this.host.focusedIndex];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            this.host.items = next;
            if (focusedItem) {
                const newFocused = next.indexOf(focusedItem);
                if (newFocused >= 0)
                    this.host.focusedIndex = newFocused;
            }
            this.host.dispatchEvent(new CustomEvent('reorder', {
                detail: { items: next, fromIndex, toIndex },
                bubbles: true,
                composed: true,
            }));
        }
    },
    index: -1,
    item: null,
    focus(e) {
        this.host?.selectTab?.(this.index, e);
    },
    close(e) {
        e?.stopPropagation?.();
        this.host?.requestCloseTab?.(this.index, e);
    }
});
