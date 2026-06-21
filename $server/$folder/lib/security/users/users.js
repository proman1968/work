export default {
    imports: '~/lib//security.js, ~/lib//user.js',
    extends: 'item-security',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                flex-wrap: wrap;
                justify-content: space-between;
                padding: 4px;
                gap: 8px;
            }
            .part {
                gap: 4px;
                padding: 2px;
                border-radius: 16px;
                min-width: 24px;
            }
        </style>
        <div class="horizontal part" no-flex>
            <item-user border ~for="users" :$item="$for.item" :icon-size @tap="_add"></item-user>
        </div>
        <div flex></div>
        <div ~if="selected_users.length" class="horizontal part" success-invert no-flex>
            <oda-icon icon="eva:f-arrow-ios-back" :icon-size @tap="_clear"></oda-icon>
            <item-user border ~for="selection" :$item="$for.item" :icon-size @tap="_remove"></item-user>
        </div>
    `,
    get $saveKey(){
        return this.$item?.path || ''
    },
    iconSize: 24,
    selected_users: {
        $def: [],
        $save: true,
        set(n){
            this.users = undefined;
            this.selected = undefined;
        }
    },
    allowRemoveAccess: false,
    get all_users(){
        return this.$item?.users;
    },
    get users() {
        return this.selected_users && this.all_users?.then(users => {
            return users?.reduce?.((res, val) => {
                if (!this.selected_users.includes(val.id)) 
                    res.add(val);
                return res;
            }, []) || [];
        })
    },
    get selection(){
        return this.selected_users && this.all_users?.then(users => {
            return  users?.reduce?.((res, val) => {
                if (this.selected_users.includes(val.id))
                    res.add(val);
                return res;
            }, []) || [];
        })
    },
    $listeners: {
        async drop(e) {
            const user = this.getUser(e.dataTransfer);
            if (!user) {
                return;
            }
            return this.assignUser(user);
        }
    },
    async assignUser(user) {
        const security = await this.getSecurity();
        security.members.add(user.id);
        this.$item.save(undefined, {});
    },
    _add(e) {
        let selected = [...this.selected_users];
        selected.add(e.target.$item.id);
        this.selected_users = selected;
    },
    _remove(e) {
        let selected = [...this.selected_users];
        selected.remove(e.target.$item.id);
        this.selected_users = selected;
    },
    _clear(e) {
        this.selected_users = [];
    },
    async _removeAccess(e) {
        const security = await this.getSecurity();
        const users = await this.users;
        security.members = users.map(u => u.id);
        this.$item.save(undefined, {});
    }
}