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
                    if (content?.DATA instanceof Blob)
                        content.DATA.text().then(text => this.value = text);
                    else
                        this.value = content;
                })
            }
        }
    }
})