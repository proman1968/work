const _handlersCache = new Map();

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
            button.service-btn:hover:not(:disabled) {
                border-color: light-dark(#7c8ea6, #60a5fa);
                background: light-dark(linear-gradient(180deg, #ffffff 0%, #dfe8f6 100%), linear-gradient(180deg, #3b4252 0%, #2e3440 100%));
            }
            button.service-btn:active:not(:disabled) {
                transform: translateY(0.5px);
            }
            button.service-btn:disabled {
                opacity: 0.45;
                cursor: default;
                box-shadow: none;
                filter: grayscale(0.4);
            }
        </style>
        <div class="service-wrap" ~show="showLabels && toolItems?.length">
            <button type="button" class="service-btn" ~for="toolItems" :disabled="Boolean($for.item?.disabled)" :title="$for.item?.label || $for.item?.id" @tap.stop="runTool($for.item, $event)">
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
            set() { this._scheduleSync(); }
        },
        fallbackItem: {
            $def: null,
            set() { this._scheduleSync(); }
        },
        $item: {
            $def: null,
            set() { this._scheduleSync(); }
        },
        filter: {
            $def: '',
            $list: ['service', 'button', 'quickTool'],
            set() { this._scheduleSync(); }
        },
        showLabels: {
            $def: false,
            $attr: true,
        },
        focusedOnly: {
            $def: false,
            $attr: true,
            set() { this._scheduleSync(); }
        },
        stateVersion: {
            $def: 0,
            $type: Number,
            set() { this._scheduleSync(); }
        },
        toolItems: {
            $def: [],
            $type: Array,
        }
    },
    attached() {
        this._scheduleSync();
    },
    _scheduleSync() {
        this.debounce('sync-tools', () => {
            this._syncToolsNow();
        }, 5);
    },
    _setTools(list) {
        const next = Array.isArray(list) ? list : [];
        this.toolItems = next;
        this.fire('tools-changed', next);
        this.render?.(true);
    },
    _findFormHost() {
        for (let p = this.domHost || this.parentElement; p; p = p.domHost || p.parentElement) {
            if (p.localName === 'work-form' || 'view_control' in p)
                return p;
        }
        return this.domHost || null;
    },
    _computeDisabled(rawTool, hasFocus, isMulti, vc, actualTarget) {
        if (rawTool?.disabled === true)
            return true;
        if (this.focusedOnly && !hasFocus)
            return true;
        if (isMulti && !rawTool?.allowList && !rawTool?.DATA?.allowList)
            return true;
        if (typeof vc?.isToolDisabled === 'function') {
            if (vc.isToolDisabled(rawTool, actualTarget))
                return true;
        }
        return false;
    },
    _wrapWithState(list, hasFocus, isMulti, vc, actualTarget, contextItem) {
        return (list || []).map(h => {
            const disabled = this._computeDisabled(h, hasFocus, isMulti, vc, actualTarget);
            return {
                id: h.id,
                label: h.DATA?.label || h.label || h.id,
                icon: h.DATA?.icon || h.icon || '',
                type: h.type || '$handler',
                service: Boolean(h.DATA?.service || h.DATA?.isService || h.service === true || h.isService === true),
                isService: Boolean(h.DATA?.isService || h.DATA?.service || h.isService === true || h.service === true),
                isButton: Boolean(h.DATA?.isButton || h.DATA?.button || h.isButton === true || h.button === true),
                allowList: Boolean(h.DATA?.allowList || h.allowList === true),
                order: h.DATA?.order ?? (typeof h.order === 'number' ? h.order : 99),
                disabled,
                $handler: h.$handler || (h.type === '$handler' ? h : null),
                $context: contextItem || h.$context || null,
                execute: typeof h.execute === 'function' ? h.execute.bind(h) : null,
            };
        });
    },
    async _syncToolsNow() {
        const host = this._findFormHost();
        const vc = host?.view_control;
        const filter = this.filter;
        const focusedOnly = this.focusedOnly;
        const rawTarget = this.targetItem;
        const isMulti = Array.isArray(rawTarget) && rawTarget.length > 1;
        const singleTarget = Array.isArray(rawTarget) ? (rawTarget[0] || null) : rawTarget;
        const hasFocus = Boolean(singleTarget);

        // 1. Декларативные инструменты от активной вьюшки (для объектов БД и кастомных режимов)
        if (vc) {
            const vcList = filter === 'button'
                ? (focusedOnly ? vc.focusedButtons : vc.itemButtons)
                : filter === 'service'
                    ? (focusedOnly ? vc.focusedServices : vc.itemServices)
                    : null;
            if (Array.isArray(vcList)) {
                this._setTools(this._wrapWithState(vcList, hasFocus, isMulti, vc, rawTarget, singleTarget || this.$item));
                return;
            }
        }

        // 2. Источник хендлеров: для focusedOnly берём прототип (fallbackItem) или выбранный элемент
        const handlerSource = focusedOnly ? (this.fallbackItem || singleTarget) : (singleTarget || this.$item);
        if (!handlerSource) {
            this._setTools([]);
            return;
        }

        // 3. Собственные tools элемента (только для quickTool или не-сервисных/не-кнопочных)
        if (filter !== 'service' && filter !== 'button') {
            const own = handlerSource.tools;
            if (Array.isArray(own) && own.length) {
                this._setTools(own);
                return;
            }
            this._setTools([]);
            return;
        }

        if (typeof handlerSource.fetch !== 'function') {
            this._setTools([]);
            return;
        }

        // Не дублировать собственные представления открытого элемента в focusedOnly, если фокус указывает на сам корень формы
        if (focusedOnly) {
            const hostPath = host?.$item?.short || host?.$item?.path || '';
            const srcPath = handlerSource?.short || handlerSource?.path || '';
            if (hostPath && srcPath && hostPath === srcPath) {
                this._setTools([]);
                return;
            }
        }

        const role = host?.activeRole || handlerSource.role || '';
        const list = await this.loadFilteredHandlers(handlerSource, role, filter);
        const contextForRun = singleTarget || handlerSource;
        this._setTools(this._wrapWithState(list, hasFocus, isMulti, vc, rawTarget, contextForRun));
    },
    async loadFilteredHandlers($item, role, filter) {
        const key = `${$item.short || $item.path || ''}:${role || ''}:${filter || ''}`;
        if (_handlersCache.has(key)) {
            return _handlersCache.get(key);
        }
        try {
            const [formRoot, methodsRoot] = await Promise.all([
                $item.fetch('handlers', { path: '//form', role }).catch(() => null),
                $item.fetch('handlers', { path: '/methods', role }).catch(() => null),
            ]);
            const rawItems = [...(formRoot?.items || []), ...(methodsRoot?.items || [])];
            const seenIds = new Set();
            const list = rawItems.filter(item => {
                if (!item || item.type !== '$handler' || item.usable === false || item.allowUse === false)
                    return false;
                if (seenIds.has(item.id))
                    return false;
                const match = filter === 'service'
                    ? Boolean(item.DATA?.service || item.DATA?.isService || item.service === true || item.isService === true)
                    : filter === 'button'
                        ? Boolean(item.DATA?.isButton || item.DATA?.button || item.isButton === true || item.button === true)
                        : false;
                if (match)
                    seenIds.add(item.id);
                return match;
            });
            list.sort((a, b) => (a.DATA?.order ?? (typeof a.order === 'number' ? a.order : 99)) - (b.DATA?.order ?? (typeof b.order === 'number' ? b.order : 99)));
            _handlersCache.set(key, list);
            return list;
        }
        catch {
            return [];
        }
    },
    runTool(tool, e) {
        e?.stopPropagation?.();
        if (!tool || tool.disabled)
            return;
        const host = this._findFormHost();
        const vc = host?.view_control;
        if (typeof vc?.runToolHandler === 'function') {
            const handled = vc.runToolHandler(tool, e);
            if (handled !== false)
                return;
        }
        if (!tool.$handler && typeof tool.execute === 'function') {
            tool.execute(e);
            return;
        }
        const rawTarget = this.targetItem;
        const singleTarget = Array.isArray(rawTarget) ? (rawTarget[0] || null) : rawTarget;
        const target = singleTarget || tool.$context || this.$item;
        if (tool.$handler && String(tool.$handler.path || tool.$handler.short || '').includes('/methods/')) {
            tool.$handler.$context = target;
            tool.$handler.execute(e);
            return;
        }
        if (tool.type === '$handler' && target && window.execute) {
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
            tool.execute(e);
    }
}
