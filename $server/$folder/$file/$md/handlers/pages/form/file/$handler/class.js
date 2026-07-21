export default {
    imports: '/oda//markdown/markdown.js',
    fileControl: 'oda-md-viewer',
    allowSave: true
}

ODA({
    is: 'oda-md-viewer',
    template: /*html*/`
        <style>
            :host{
                @apply --flex;
                @apply --vertical;
                overflow: auto;
            }
        </style>
        <oda-button slot="top-panel" :icon="editMode ? 'carbon:view' : 'carbon:edit'" :title="editMode ? 'view' : 'edit'" @tap="changeMode"></oda-button>
        <oda-markdown :value :edit-mode flex @change="_onChanged"></oda-markdown>
    `,
    value: '',
    editMode: false,
    $item: {
        $def: null,
        set(n) {
            if (n) {
                n.load().then(content => {
                    const apply = (text) => {
                        const base = n.short || n.path || '';
                        const File = CORE.$file || n.constructor;
                        if (typeof File.fixWorkMdLinks === 'function')
                            text = File.fixWorkMdLinks(text, base);
                        if (typeof File.fixMdHistoryLinks === 'function')
                            text = File.fixMdHistoryLinks(text);
                        this.value = text;
                    };
                    if (content?.DATA instanceof Blob) {
                        content.DATA.text().then(text => apply(text));
                    }
                    else {
                        apply(content);
                    }
                })
            }
        }
    },
    _onChanged(e) {
        const body = e.detail.value;
        if (!this.$item.body || (this.$item.body !== body)) {
            this.$item.body = body;
            this.$item.isChanged = true;
        }
    },
    changeMode(e) {
        this.editMode = !this.editMode;
    }
})
