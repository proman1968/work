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
    get value(){
        return this.$item?.load()
    }
}