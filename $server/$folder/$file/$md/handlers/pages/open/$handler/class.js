export default {
    imports: '/oda//markdown-viewer/markdown-viewer.js',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                overflow: auto;
                @apply --flex;
            }
        </style>
        <oda-markdown-viewer :value class="flex"></oda-markdown-viewer>
    `,
    get value() {
        if (this.$item) {
            try {
                this.$item.load().then(v => {
                    if (v.DATA instanceof Blob) {
                        v.DATA.text().then(text => {
                            this.value = text;
                        })
                    } else {
                        this.value = v;
                    }
                })
            } catch (error) {
                console.error('Error loading markdown:', error);
                this.value = `# Ошибка загрузки\n\n${error.message}`;
            }
        }
    }
}
