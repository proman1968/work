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
            }
        </style>
        <div ~if="showTools" class="tools-list">
            <div ~for="tools" @pointerdown="executeTool($for.item)" class="tool">
                <oda-icon :icon="$for.item.icon" :icon-size></oda-icon>
                <div>{{$for.item.label}}</div>
            </div>
        </div>
        <item-tree ~if="showHandlers" @resize :hide-tops :hide-roots expander-order="1" expand-all :$item="handlersRoot" :allow-categories></item-tree>
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
    get tools(){
        return this.$item?.tools;
    },
    executeTool(tool) {
        this.fire('close');
        tool.execute();
    }
}
