export default{

    template: /* html */`
        <style>
            :host{
                background-color: black;
                @apply --vertical;
            }
            :host([only-doc]) {
                min-height: 0;
            }
            img {
                align-self: center;
                object-fit: contain;
                max-width: 95%;
                max-height: 95%;
                min-height: 0;
            }
            :host([only-doc]) img {
                max-height: none;
                min-width: 0;
                @apply --flex;
            }
        </style>
        <img @tap="$item.execute()" loading="lazy" :src/>
    `,
    onlyDoc: {
        $def: false,
        $attr: true,
    },
    get src() {
        return this.$item?.url;
    },
}