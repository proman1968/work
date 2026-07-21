export default {
    imports: 'oda//tools/jupyter/jupyter.js, oda//app-layout',
    fileControl: 'oda-ipynb-viewer',
    allowSave: true,
}

ODA({
    is: 'oda-ipynb-viewer',
    extends:'oda-app-layout',
    template: /* html */`
        <oda-jupyter slot="main" class="flex" @change.stop @changed.stop="_change" :file_path></oda-jupyter>
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
        return this.$('oda-jupyter')?.notebook;
    }
})
