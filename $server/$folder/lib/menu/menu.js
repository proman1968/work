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

                    .tool{
                        @apply --horizontal;
                        @apply --flex;
                        align-items: center;
                        font-size: 120%;
                        padding: 2px;
                    }
                }
                .handlers-help{
                    @apply --horizontal;
                    align-items: center;
                    justify-content: flex-end;
                    padding: 2px 4px;
                }
                .handlers-help oda-icon{
                    opacity: .55;
                    cursor: pointer;
                }
                .handlers-help oda-icon:hover{
                    opacity: 1;
                }
            }
        </style>
        <div ~if="showTools" class="tools-list">
            <div ~for="tools" @pointerdown="executeTool($for.item)" class="tool">
                <oda-icon :icon="$for.item.icon" :icon-size></oda-icon>
                <div>{{$for.item.label}}</div>
            </div>
        </div>
        <div ~if="showHandlers && hasHandlersReadme" class="handlers-help">
            <oda-icon icon="icons:help" :icon-size="16" @tap.stop="openHandlersReadme" title="readme.md"></oda-icon>
        </div>
        <item-tree ~if="showHandlers" @resize :hide-tops :hide-roots :hide-readme="true" expander-order="1" expand-all :$item="handlersRoot" :allow-categories></item-tree>
    `,
    hideRoots: 2,
    hideTops: 1,
    allowCategories: true,
    path: '',
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
        return this.$item?.fetch('handlers', {path: this.path});
    },
    get handlersReadme() {
        return Promise.resolve(this.handlersRoot).then(async root => {
            if (!root) return null;
            let items = root.items;
            if (items?.then) items = await items;
            if (Array.isArray(items)) {
                const found = items.find(f => /^readme\.md$/i.test(f.id));
                if (found) return found;
            }
            if (typeof root.get_item === 'function') {
                try {
                    const readme = await root.get_item('readme.md');
                    if (readme && !Array.isArray(readme)) return readme;
                } catch {}
            }
            return null;
        })
    },
    get hasHandlersReadme() {
        return Promise.resolve(this.handlersReadme).then(r => !!r);
    },
    async openHandlersReadme(e) {
        e?.stopPropagation?.();
        const readme = await this.handlersReadme;
        if (!readme) return;
        readme.$context = this.$item;
        if (typeof readme.execute === 'function')
            await readme.execute();
        else if (window.execute)
            await window.execute(Reactor.activate(readme));
        this.parentElement?.fire('close');
    },
    get tools(){
        return this.$item?.tools;
    },
    executeTool(tool) {
        this.fire('close');
        tool.execute();
    }
}