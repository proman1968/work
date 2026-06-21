export default{
    imports: '/oda//button.js',
    template:/* html */`
        <style>
            :host {
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
        </style>
        <fieldset vertical>
            <span no-flex light ~html="message"></span>
        </fieldset>
    `,
    message: '',
}