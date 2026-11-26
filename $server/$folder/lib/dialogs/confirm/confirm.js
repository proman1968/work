export default{
    imports: '/oda//button.js',
    template:/* html */`
        <style>
            :host {
                border-radius: 8px;
                max-width: min(480px, 100%);
                box-sizing: border-box;
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
        </style>
        <fieldset vertical>
            <span no-flex light ~html="message"></span>
        </fieldset>
    `,
    message: '',
}