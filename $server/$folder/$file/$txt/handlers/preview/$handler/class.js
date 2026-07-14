export default{
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                padding: 4px 16px;
            }
        </style>    
        <div flex ~html="value" style="white-space: break-spaces; padding-top: 4px; overflow: hidden;"></div>
    `,
    colorMode: 'content',
    value: '',
    logContent: {
        set(n) {
            this._logContent = n;
            if (n && !this.value)
                this.value = n;
        }
    },
    set $item(n) {
        this.value = this._logContent ?? '';
        if (!n)
            return;
        n.load().then(content => {
            this.value = content != null ? String(content) : (this._logContent ?? '');
        }).catch(() => {
            if (this._logContent)
                this.value = this._logContent;
        });
    },
}
