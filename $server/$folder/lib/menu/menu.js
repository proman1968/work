export default {
    imports: '~/lib//tree',
    template: /*html*/`
        <style>
            :host {
                border: none;
                max-height: 100% !important;
                overflow: hidden;
                @apply --vertical;
                @apply --content;
                min-width: 200px;
                .tools-list{
                    @apply --vertical;
                    padding: 4px;
                    gap: 1px;

                    .tool{
                        @apply --horizontal;
                        @apply --no-flex;
                        align-items: center;
                        gap: 8px;
                        font-size: 13px;
                        padding: 5px 10px;
                        border-radius: var(--radius-xs, 3px);
                        cursor: pointer;
                        user-select: none;
                    }
                    .tool:hover:not([disabled]){
                        background: var(--accent-soft);
                        color: var(--accent-color);
                    }
                    .tool[disabled]{
                        opacity: 0.42;
                        pointer-events: none;
                    }
                    .tool-shortcut{
                        margin-left: auto;
                        padding-left: 16px;
                        font-size: 11px;
                        color: var(--muted-color);
                    }
                }
            }
        </style>
        <div ~if="showTools" class="tools-list">
            <div ~for="tools" :disabled="Boolean($for.item.disabled)" @pointerdown.stop.prevent="executeTool($for.item, $event)" class="tool">
                <oda-icon :icon="$for.item.icon" icon-size="18"></oda-icon>
                <div>{{$for.item.label}}</div>
                <span class="tool-shortcut" ~if="$for.item.shortcut">{{$for.item.shortcut}}</span>
            </div>
        </div>
        <item-tree ~if="showHandlers" hide-files @resize :hide-tops :hide-roots :prefetch-deep="0" expander-order="1" expand-all :$item="handlersRoot" :allow-categories></item-tree>
    `,
    get $context(){
        return this.$item
    },
    hideRoots: 2,
    hideTops: 1,
    allowCategories: true,
    path: '',
    customTools: null,
    mode: {
        $def: 'handlers',
        $list: ['tools', 'handlers', 'both']
    },
    get showTools() {
        return ['tools', 'both'].includes(this.mode);
    },
    get showHandlers() {
        return ['handlers', 'both'].includes(this.mode);
    },
    get handlersRoot() {
        const $item = this.$item;
        if (!$item)
            return null;
        // роль должна быть известна до запроса: без неё фильтр по роли не сработает
        return Promise.resolve($item.ensureRole?.()).then(() =>
            $item.fetch('handlers', { path: this.path }));
    },
    get tools(){
        return this.customTools || this.$item?.tools || [];
    },
    executeTool(tool, e) {
        if (!tool || tool.disabled)
            return;
        e?.stopPropagation?.();
        this.parentElement?.close?.('ok');
        this.fire('close');
        tool.execute?.();
    }
}
