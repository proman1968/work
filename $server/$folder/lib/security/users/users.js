export default {
    imports: '~/lib//security.js, ~/lib//user.js',
    extends: 'item-security',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                flex-wrap: wrap;
                justify-content: space-between;
                gap: 8px;
                min-height: {{iconSize + 6}}px; /* border (2 * 1px) + padding (2 * 2px) */
            }
            .part {
                @apply --horizontal;
                @apply --no-flex;
                gap: 4px;
                padding: 2px;
                border-radius: 16px;
                min-width: 20px;
            }
        </style>
        <div class="part">
            <item-user border ~for="availableUsers" :$item="$for.item" :icon-size @tap="_tap" @contextmenu.capture="_userMenu"></item-user>
        </div>
        <div flex ~if="selectMode && selectedUsers.length"></div>
        <div ~if="selectMode && selectedUsers.length" class="part success-invert">
            <oda-icon icon="eva:f-arrow-ios-back" :icon-size @tap="_clear"></oda-icon>
            <item-user border ~for="selectedUsers" :$item="$for.item" :icon-size @tap="_tap"></item-user>
        </div>
    `,
    role: '',
    selectMode: true,
    iconSize: 24,
    selected_users: {
        $def: [],
        $save: true,
        set(n) {
            this._avail = undefined;
            this._sel = undefined;

            this.availableUsers = undefined;
            this.selectedUsers = undefined;
        }
    },
    get availableUsers() {
        if (!this.$item)
            return;
        return Promise.resolve(this._sourceUsers).then(all => {
            if (!this.selectMode)
                return all;
            return all?.filter(u => !this.selected_users.includes(u.id)) || [];
        });
    },
    get selectedUsers() {
        if (!this.selectMode)
            return [];
        return Promise.resolve(this._sourceUsers).then(all =>
            all?.filter(u => this.selected_users.includes(u.id)) || []
        );
    },
    get hasUsers() {
        if (this._sourceUsers instanceof Promise) {
            this._sourceUsers.then((users) => {
                this.hasUsers = users?.length > 0;
            })
            return true;
        }

        return this._sourceUsers?.length > 0;
    },
    get securityKey() {
        switch (this.role) {
            case 'BOSS':  return 'BOSSES';
            case 'ADMIN': return 'ADMINS';
            case 'GUEST': return 'GUESTS';
            default:      return 'USERS';
        }
    },
    get _sourceUsers() {
        if (!this.$item)
            return;
        const attrName = this.securityKey.toLowerCase();
        return Promise.resolve(this.$item?.[attrName]).then(list => Array.isArray(list) ? list : []);
    },
    _tap(e) {
        if (!this.selectMode)
            return;
        const id = e.target.$item?.id;
        if (!id) return;
        let selected = [...this.selected_users];
        if (selected.includes(id))
            selected = selected.filter(x => x !== id);
        else
            selected.push(id);
        this.selected_users = selected;
        this.fire('selected_users-changed', selected);
    },
    _clear(e) {
        this.selected_users = [];
        this.fire('selected_users-changed', []);
    },
    $listeners: {
        async drop(e) {
            if (this.selectMode) return;
            const user = this.getUser(e.dataTransfer);
            if (!user) return;
            return this.assignUser(user);
        }
    },
    async assignUser(user) {
        const security = await this.getSecurity();
        const key = this.securityKey;
        security[key] ??= [];
        if (!security[key].includes(user.id))
            security[key].push(user.id);
        await this.saveSecurity(security);
    },
    async suspendUser(user) {
        const security = await this.getSecurity();
        const key = this.securityKey;
        if (security[key])
            security[key] = security[key].filter(id => id !== user.id);
        await this.saveSecurity(security);
    },
    _userMenu(e) {
        if (this.selectMode) return;
        e.preventDefault();
        e.stopPropagation();
        const user = e.target.$item;
        const items = [{
            icon: 'icons:remove',
            label: 'Отстранить пользователя',
            execute: () => this.suspendUser(user),
        }];
        const menu = ODA.createElement('oda-tree', {
            items, nodeTemplate: 'menu-node', hideTops: 0, hideRoots: 1,
            execute(item) { this.parentElement.close(item); },
        });
        WORK.showDropdown(menu, { TITLE: { label: user.label } }, e.target);
    }
}

ODA({is: 'menu-node', exports: 'oda//icon.js',
    template: /*html*/`
    <style>
        :host { @apply --horizontal; cursor: pointer; align-items: center; }
    </style>
    <oda-icon :icon></oda-icon>
    <span>{{label}}</span>
    `,
    row: null,
    get icon() { return this.row?.icon; },
    get label() { return this.row?.label; },
    $listeners: {
        tap(e) {
            this.row.execute?.();
            this.$pdp.execute?.(this.row);
        }
    }
})
