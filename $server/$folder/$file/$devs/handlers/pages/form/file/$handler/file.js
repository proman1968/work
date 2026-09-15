export default {
    imports: 'oda//code-editor, oda//app-layout, oda//tools/icons/icons-tree/icons-tree.js',
    fileControl: 'oda-devs-viewer',
    allowSave: true,
}

ODA({
    is: 'oda-devs-viewer',
    extends: 'oda-app-layout',
    template: /* html */`
        <oda-code-editor slot="main" class="flex" @change :src="value"></oda-code-editor>
        <oda-icons-tree slot="right-panel" light label="Icons" icon="carbon:image" style="height: 0px;"></oda-icons-tree>
    `,
    $item: null,
    get value() {
        if (this.$item) {
            return this.$item.load().then(value => {
                if (typeof value === 'object')
                    value = JSON.stringify(value, undefined, 4);
                return value;
            })
        }
    },
    _onChange(e) {
        const body = e.detail.value;
        if (!this.$item.body || (this.$item.body !== body)) {
            this.$item.body = body;
            this.$item.isChanged = true;
        }
    },
})