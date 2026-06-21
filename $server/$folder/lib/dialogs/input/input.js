export default{
    imports: '/oda//button.js',
    template:/* html */`
        <style>
            :host {
                max-width: 250px;
                border-radius: 8px;
                @apply --light;
            }
            fieldset {
                border: none;
            }
            .btn {
                padding: 8px;
                border-radius: 4px;
                @apply --raised;
            }
            span {
                text-align: center;
                font-size: x-large;
                margin: 16px 2px;
                padding: 4px;
                border-radius: 8px;
                white-space: break-spaces;
            }
            input {
                width: -webkit-fill-available;
                outline: node;
                border: node;
                padding: 2px 4px;
                margin-top: 16px;
                margin-bottom: 16px;
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