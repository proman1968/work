export default {
    imports: '/oda//markdown-viewer/markdown-viewer.js',
    fileControl: 'oda-md-viewer'
}

ODA({
    is: 'oda-md-viewer',
    template: /*html*/`
        <style>
            :host{
                @apply --vertical;
                overflow: auto;
                @apply --flex;
            }
        </style>
        <oda-markdown-viewer :value flex></oda-markdown-viewer>
    `,
    value: '',
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
                    if (content?.DATA instanceof Blob)
                        content.DATA.text().then(text => apply(text));
                    else
                        apply(content);
                })
            }
        }
    }
})
