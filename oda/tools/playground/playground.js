ODA({is: 'oda-playground', imports: 'oda//app-layout, oda//button, oda//icon, /$server/$folder/lib/tree/tree.js',
    extends: 'oda-app-layout',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
            }
            .preview-frame {
                @apply --flex;
                border: none;
                width: 100%;
                height: 100%;
                overflow: hidden;
            }
            .empty-state {
                @apply --flex;
                @apply --vertical;
                align-items: center;
                justify-content: center;
                color: var(--disabled-color);
                font-size: large;
                gap: 8px;
            }
        </style>
        <app-layout-toolbar class="header" slot="header">
            <span class="flex" slot="header-center" style="font-weight: bold; font-size: large; text-align: center">ODA Playground</span>
        </app-layout-toolbar>
        <oda-tree slot="left-panel" id="tree" :$item="rootItem" :hide-system :allow-search
            @tap="onTreeTap"
            ~if="rootItem" style="font-size: small; overflow: auto;"></oda-tree>
        <div slot="left-panel" ~show="!rootItem" class="vertical flex center" style="padding: 16px; color: var(--disabled-color); font-size: small;">
            <span>Загрузка...</span>
        </div>
        <div slot="main" class="vertical flex">
            <div class="empty-state" ~show="!selectedPath">
                <oda-icon icon="icons:touch-app" icon-size="48"></oda-icon>
                <span>Выберите папку компонента из дерева слева</span>
            </div>
            <iframe ~show="selectedPath" class="preview-frame" :src="selectedPath"></iframe>
        </div>
    `,
    rootItem: null,
    selectedPath: '',
    onTreeTap() {
        let tree = this.$('#tree');
        let focused = tree?.focusedItem;
        if (focused?.path)
            this.selectedPath = focused.path + '/index.html';
    },
    attached() {
        this.loadRoot();
    },
    async loadRoot() {
        try {
            this.rootItem = await WORK.get_item('/oda');
        }
        catch (e) {
            console.warn('[playground] loadRoot:', e);
        }
    }
});