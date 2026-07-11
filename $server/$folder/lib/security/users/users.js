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
            <item-user border ~for="users" :$item="$for.item" :icon-size @tap="_add" @contextmenu.capture="_userMenu"></item-user>
        </div>
        <div flex></div>
        <div ~if="selected_users.length" class="horizontal part" success-invert no-flex>
            <oda-icon icon="eva:f-arrow-ios-back" :icon-size @tap="_clear"></oda-icon>
            <item-user border ~for="selection" :$item="$for.item" :icon-size @tap="_remove" @contextmenu.capture="_userMenu"></item-user>
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
        return new AsyncPromise(async ()=>{
            if (!this.selected_users)
                return [];
            let users = await this.all_users;
            return users?.reduce?.((res, val) => {
                if (!this.selected_users.includes(val.id))
                    res.add(val);
                return res;
            }, []) || [];
        })
    },
    get selection(){
        return new AsyncPromise(async ()=>{
            if (!this.selected_users)
                return [];
            let users = await this.all_users;
            return users?.reduce?.((res, val) => {
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
        security.users.add(user.id);
        this.$item.save(undefined, {});
    },
    async suspendUser(user) {
        const security = await this.getSecurity();
        security.users.remove(user.id);
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
    _userMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        const user = e.target.$item;
        const items = [
            {
                icon: 'icons:remove',
                label: 'Отстранить пользователя',
                execute: (e) => {
                    this.suspendUser(user);
                }
            }
        ];

        const menu = ODA.createElement('oda-tree',
            {
                items,
                nodeTemplate: 'menu-node',
                hideTops: 0,
                hideRoots: 1,
                execute(item) {
                    this.parentElement.close(item);
                }
            }
        );
        WORK.showDropdown(menu, { TITLE: { label: user.label } }, e.target);
    }
}

ODA({is: 'menu-node', exports: 'oda//icon.js',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            cursor: pointer;
            align-items: center;
        }
    </style>
    <oda-icon :icon></oda-icon>
    <span>{{label}}</span>
    `,
    row: null,
    get icon() {
        return this.row?.icon;
    },
    get label() {
        return this.row?.label;
    },
    $listeners: {
        tap(e) {
            this.row.execute?.();
            this.$pdp.execute?.(this.row);
        }
    }
})