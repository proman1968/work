const _serviceHandlersCache = new Map();

export default {
    imports: '~/lib//icon, ~/lib//node, oda//button',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
                gap: 6px;
            }
            .item {
                scale: .8;
                border: none;
                border-radius: 4px;
            }
            .service-wrap {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
                gap: 6px;
            }
            button.service-btn {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
                gap: 6px;
                padding: 3px 12px;
                min-height: 24px;
                font-size: 12.5px;
                font-weight: 600;
                border: 1px solid light-dark(#b8b8b0, #4a4b52);
                border-radius: 3px;
                background: light-dark(linear-gradient(180deg, #fafaf8 0%, #e8e7de 100%), linear-gradient(180deg, #32343a 0%, #26282d 100%));
                color: light-dark(#222, #e2e8f0);
                cursor: pointer;
                user-select: none;
                box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06);
                transition: background 0.12s ease, border-color 0.12s ease;
            }
            button.service-btn:hover {
                border-color: light-dark(#7c8ea6, #60a5fa);
                background: light-dark(linear-gradient(180deg, #ffffff 0%, #dfe8f6 100%), linear-gradient(180deg, #3b4252 0%, #2e3440 100%));
            }
            button.service-btn:active {
                transform: translateY(0.5px);
            }
        </style>
        <div class="service-wrap" ~show="showLabels && toolItems?.length">
            <button type="button" class="service-btn" ~for="toolItems" :title="$for.item?.label || $for.item?.id" @tap.stop="runTool($for.item, $event)">
                <oda-icon ~if="$for.item?.icon" :icon="$for.item.icon" icon-size="16"></oda-icon>
                <span>{{$for.item?.label || $for.item?.id}}</span>
            </button>
        </div>
        <div class="service-wrap" ~show="!showLabels && toolItems?.length">
            <item-icon auto-run class="item" light raised ~for="toolItems" raised border :show-labels :$item="$for?.item" :hide-toolbar="!showLabels"></item-icon>
        </div>
    `,
    $public: {
        targetItem: {
            $def: null,
        },
        filter: {
            $def: '',
            $list: ['service', 'quickTool'],
        },
        showLabels: {
            $def: false,
            $attr: true,
        },
        focusedOnly: {
            $def: false,
            $attr: true,
        },
        toolItems: {
            $def: [],
            $type: Array,
        }
    },
    _setTools(list) {
        const next = Array.isArray(list) ? list : [];
        this.toolItems = next;
        this.fire('tools-changed', next);
    },
    $observers: {
        async _syncTools(targetItem, $item, filter, focusedOnly) {
            const active = focusedOnly ? targetItem : (targetItem || $item);
            if (!active) {
                this._setTools([]);
                return;
            }
            const own = active.tools;
            if (Array.isArray(own) && own.length) {
                this._setTools(own);
                return;
            }
            if (filter !== 'service' || typeof active.fetch !== 'function' || !targetItem) {
                this._setTools([]);
                return;
            }
            const host = this.domHost;
            const hostPath = host?.$item?.short || host?.$item?.path || '';
            const activePath = active?.short || active?.path || '';
            if (hostPath && activePath && hostPath === activePath) {
                this._setTools([]);
                return;
            }
            const role = host?.activeRole || active.role || '';
            const list = await this.loadServiceHandlers(active, role);
            if (this.targetItem === active) {
                this._setTools(list);
                this.render?.();
            }
        }
    },
    async loadServiceHandlers($item, role) {
        const key = `${$item.short || $item.path || ''}:${role || ''}`;
        if (_serviceHandlersCache.has(key)) {
            const cached = _serviceHandlersCache.get(key);
            for (const h of cached)
                h.$context = $item;
            return cached;
        }
        try {
            const root = await $item.fetch('handlers', { path: '//form', role });
            const list = (root?.items || []).filter(item =>
                item.type === '$handler'
                && item.usable !== false
                && item.allowUse !== false
                && (item.service || item.DATA?.service)
            );
            list.sort((a, b) => (a.order ?? a.DATA?.order ?? 99) - (b.order ?? b.DATA?.order ?? 99));
            for (const h of list)
                h.$context = $item;
            _serviceHandlersCache.set(key, list);
            return list;
        }
        catch {
            return [];
        }
    },
    runTool(tool, e) {
        e?.stopPropagation?.();
        if (!tool)
            return;
        const target = tool.$context || this.targetItem || this.$item;
        if (tool.type === '$handler' && target && window.execute) {
            const vc = this.domHost?.view_control;
            const nav = typeof vc?.buildDrilldownNav === 'function'
                ? vc.buildDrilldownNav(tool.id, target)
                : {
                    view: tool.id,
                    mode: tool.id === 'postings' ? 'card' : tool.id,
                    from: vc?.from || '',
                    to: vc?.to || '',
                    packetsKey: vc?.packetsKey || '',
                    unit: vc?.unit || '',
                };
            window.execute(target, nav);
            return;
        }
        if (typeof tool.execute === 'function')
            tool.execute();
    }
}
