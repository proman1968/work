export default {
}

ODA({
    is: 'pack-preview',
    imports: 'oda//icon, ~/lib//chat-item',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                width: 100%;
                gap: 4px;
            }
            .includes {
                @apply --vertical;
                width: 100%;
            }
            .empty {
                opacity: .6;
                font-size: x-small;
                padding: 4px 8px;
            }
        </style>
        <div class="includes" ~if="includes.length">
            <chat-item ~for="includes" is-include :$file="$for.item"></chat-item>
        </div>
        <div ~if="!includes.length" class="empty">Пустой .pack</div>
    `,
    log: null,
    get includes() {
        const paths = this.log?.includes?.length ? this.log.includes : (this.$item?.includes?.length ? this.$item.includes : []);
        if (!paths.length)
            return [];
        return Promise.all(paths.map(p => WORK.get_item(p, 'info'))).then(items => items.filter(Boolean));
    }
})
