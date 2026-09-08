export default{
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                padding: 4px 16px;
            }
            div {
                white-space: break-spaces;
                padding-top: 4px;
                overflow: hidden;

                -webkit-user-select: text; /* Для Safari и старых Chrome/Opera */
                -moz-user-select: text;    /* Для старых версий Firefox */
                -ms-user-select: text;     /* Для старых версий Internet Explorer */
                user-select: text;         /* Стандартное свойство */
            }
        </style>
        <div flex ~html="value"></div>
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
