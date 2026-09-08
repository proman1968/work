export default {
    template: /*html*/ `
        <style>
            :host {
                @apply --vertical;
            }
            div {
                font-size: small;
                padding: 4px 8px;
                white-space: pre;

                -webkit-user-select: text; /* Для Safari и старых Chrome/Opera */
                -moz-user-select: text;    /* Для старых версий Firefox */
                -ms-user-select: text;     /* Для старых версий Internet Explorer */
                user-select: text;         /* Стандартное свойство */
            }
        </style>
        <div ~if="src" bold flex ~html="src"></div>
    `,
    get src() {
        return this.$item?.load().then(res => {
            return res?.title
        }).catch(err => {
            return '';
        })
    }
}