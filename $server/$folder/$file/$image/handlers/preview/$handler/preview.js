export default{

    template: /* html */`
        <style>
            :host{
                background-color: black;
                @apply --vertical;
            }
        </style>
        <img @tap="$item.execute()" loading="lazy" :src height="150px;"  style="align-self: center;"/>
    `,
    get src() {
        return this.$item?.url;
    },
}