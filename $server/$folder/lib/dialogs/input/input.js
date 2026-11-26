export default{
    imports: '/oda//button.js',
    template:/* html */`
        <style>
            :host {
                width: min(360px, calc(100vw - 32px));
                max-width: 100%;
                box-sizing: border-box;
                border-radius: 8px;
                @apply --light;
            }
            fieldset {
                border: none;
                min-width: 0;
            }
            .btn {
                padding: 8px;
                border-radius: 4px;
                @apply --raised;
            }
            span {
                text-align: center;
                font-size: large;
                margin: 12px 2px;
                padding: 4px;
                border-radius: 8px;
                white-space: break-spaces;
                word-break: break-word;
            }
            input {
                width: 100%;
                box-sizing: border-box;
                outline: none;
                border: 1px solid var(--control-border-color, var(--subtle-border));
                border-radius: var(--control-radius, 6px);
                padding: 6px 8px;
                margin-top: 12px;
                margin-bottom: 12px;
            }
        </style>
        <fieldset vertical>
            <span no-flex light ~html="legend"></span>
            <input autofocus :placeholder ::value @keydown>
        </fieldset>
    `,
    _onKeydown(e) {
        switch (e.key.toLowerCase()) {
            case 'enter': {
                this.parentElement.ok();
            } break;
            case 'escape': {
                this.parentElement.close();
            } break;
        }
    },
    attached() {
        this.async(() => {
            this.$('input').focus();
        })
    },
    placeholder: 'value',
    legend: 'input',
    value: '',
}