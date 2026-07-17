export default {
    imports: '~/lib//security.js, ~/lib//icon.js',
    extends: 'item-security',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
            }
        </style>
        <item-icon :$item="admin" default="box:s-user-plus" title="Назначить админа" :icon-size @tap="selectUser"></item-icon>
    `,
    iconSize: 24,
    $listeners: {
        async drop(e) {
            const user = this.getUser(e.dataTransfer);
            if (!user) {

                return;
            }

            return this.assignUser(user);
        },
    },
    async assignUser(user) {
        const security = await this.getSecurity();
        security.ADMIN = user.id;

        this.$item.save(undefined, {});
    }
}