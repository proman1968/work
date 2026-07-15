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
            <item-user border ~for="availableUsers" :$item="$for.item" :icon-size @tap="_tap" @contextmenu.capture="_userMenu"></item-user>
        </div>
        <div flex></div>
        <div ~if="selectMode && selectedUsers.length" class="horizontal part" success-invert no-flex>
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
        }
    },
    get availableUsers() {
        return new AsyncPromise(async () => {
            const all = await this._sourceUsers;
            if (!this.selectMode)
                return all;
            return all?.filter(u => !this.selected_users.includes(u.id)) || [];
        });
    },
    get selectedUsers() {
        return new AsyncPromise(async () => {
            if (!this.selectMode)
                return [];
            const all = await this._sourceUsers;
            return all?.filter(u => this.selected_users.includes(u.id)) || [];
        });
    },
    get _sourceUsers() {
        if (this.role === 'master')
            return Promise.resolve(this.$item?.masters).then(list => Array.isArray(list) ? list : []);
        if (this.role === 'admin')
            return Promise.resolve(this.$item?.admins).then(list => Array.isArray(list) ? list : []);
        return Promise.resolve(this.$item?.slaves).then(list => Array.isArray(list) ? list : []);
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
        if (this.role === 'master')
            security.master = user.id;
        else if (this.role === 'admin')
            security.admin = user.id;
        else {
            security.slaves ??= [];
            if (!security.slaves.includes(user.id))
                security.slaves.push(user.id);
        }
        await this.saveSecurity(security);
    },
    async suspendUser(user) {
        const security = await this.getSecurity();
        if (this.role === 'master')
            delete security.master;
        else if (this.role === 'admin')
            delete security.admin;
        else if (security.slaves)
            security.slaves = security.slaves.filter(id => id !== user.id);
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
