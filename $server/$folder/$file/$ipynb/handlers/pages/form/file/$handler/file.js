export default {
    imports: 'oda//tools/jupyter/jupyter.js, oda//app-layout',
    fileControl: 'oda-ipynb-viewer',
    allowSave: true,
}

/** Дерево /root/doc для выбора js-файла ячейки ноутбука (ручной ввод URL сверху). */
ODA({ is: 'item-tree-jupyter', imports: '~/lib//tree.js', extends: 'this, item-tree',
    template: `
        <div horizontal flex style="min-width: 240px; border-bottom: 1px solid var(--border-color);">
            <input flex ::value />
            <oda-button icon="icons:delete" @tap="clearUrl"></oda-button>
            <oda-button icon="icons:check" @tap="isOk"></oda-button>
        </div>
    `,
    get value() {
        return this.cell.url || '';
    },
    set value(v) {
        this.cell.url = v;
    },
    cell: undefined,
    clearUrl() {
        this.cell.url = '';
    },
    isOk() {
        this.parentElement.close({ url: this.value });
    }
});

/** oda-jupyter WORK: js-файл ячейки выбирается из дерева документов. */
ODA({ is: 'item-jupyter', extends: 'oda-jupyter',
    async selectFileUrl(e, cell) {
        const $root = await WORK.get_item('/root/doc');
        const menu = ODA.createElement('item-tree-jupyter', {
            $item: $root,
            hideTops: 1,
            hideRoots: 2,
            cell,
            execute(item) {
                this.parentElement.close(item);
            }
        });
        const item = await WORK.showDropdown(menu, { TITLE: { label: 'Select file - *.js' } }, e.currentTarget);
        return item.url;
    }
});

ODA({
    is: 'oda-ipynb-viewer',
    extends:'oda-app-layout',
    template: /* html */`
        <item-jupyter slot="main" class="flex" @change.stop @changed.stop="_change" :file_path></item-jupyter>
        <oda-jupyter-tree slot="right-panel" label="content" icon="carbon:table-of-contents"></oda-jupyter-tree>
    `,
    _change(e){
        const body = JSON.stringify(this.notebook.data);
        if (!this.$item.body || (this.$item.body !== body)) {
            this.$item.body = body;
            this.$item.isChanged = true;
        }
    },
    $item: null,
    get file_path() {
        if(this.$item) {
            return this.$item.url;
        }
    },
    get notebook() {
        return this.$('item-jupyter')?.notebook;
    }
})
