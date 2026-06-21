export default{
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
                @apply --flex;
            }
            iframe{
                border: none;
                width: 100%;
                height: 100%;
            }
        </style>
        <iframe :src></iframe>
    `,
    get src() {
        return '/sources/modules/document/index.html?src=' + this.$item?.url + '&menu=off&save=event';
    }
}