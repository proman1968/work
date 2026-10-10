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
    /** Путь места в дереве ROLES ('heads/seo'): пользователи и назначения — по месту, а не по роли. */
    place: '',
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
            case 'BOSS':  return 'BOSS';
            case 'ADMIN': return 'ADMIN';
            case 'GUEST': return 'GUEST';
            default:      return 'USER';
        }
    },
    get _sourceUsers() {
        if (this.place)
            return this._placeUsers();
        if (!this.$item)
            return;
        const attrName = this.securityKey.toLowerCase();
        return Promise.resolve(this.$item?.[attrName]).then(list => Array.isArray(list) ? list : []);
    },
    /** Пользователи рабочего места: поиск узла по trail в places() владельца. */
    async _placeUsers() {
        const owner = this.$item;
        if (!owner?.fetch || !this.place)
            return [];
        try {
            const d = await owner.fetch('places');
            const node = this._findPlace(d?.places, String(this.place).split('/').filter(Boolean));
            if (!node)
                return [];
            return WORK.usersByIds(node.users || []).then(l => (l || []).filter(Boolean));
        }
        catch {
            return [];
        }
    },
    _findPlace(nodes, steps) {
        if (!steps.length)
            return null;
        const node = (nodes || []).find(n => n?.id === steps[0]);
        if (!node)
            return null;
        return steps.length === 1 ? node : this._findPlace(node.roles, steps.slice(1));
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
            if (!(await this.canEdit)) return;
            const user = this.getUser(e.dataTransfer);
            if (!user) return;
            return this.assignUser(user);
        }
    },
    async assignUser(user) {
        if (this.place)
            return this._assignPlace(user, false);
        const security = await this.getSecurity();
        const key = this.securityKey;
        security[key] ??= [];
        if (!security[key].includes(user.id))
            security[key].push(user.id);
        await this.saveSecurity(security);
    },
    async suspendUser(user) {
        if (this.place)
            return this._assignPlace(user, true);
        const security = await this.getSecurity();
        const key = this.securityKey;
        if (security[key])
            security[key] = security[key].filter(id => id !== user.id);
        await this.saveSecurity(security);
    },
    /** Назначить на место / снять с места: правка USERS узла #security.ROLES по trail. */
    async _assignPlace(user, remove) {
        if (!user?.id || !this.place)
            return;
        const security = await this.getSecurity();
        const steps = String(this.place).split('/').filter(Boolean);
        let level = Array.isArray(security.ROLES) ? security.ROLES : [];
        let node = null;
        for (const id of steps) {
            node = level.find(r => r?.id === id);
            if (!node)
                return;
            level = Array.isArray(node.ROLES) ? node.ROLES : [];
        }
        if (!node)
            return;
        if (remove)
            node.USERS = (node.USERS || []).filter(id => id !== user.id);
        else {
            node.USERS ??= [];
            if (!node.USERS.includes(user.id))
                node.USERS.push(user.id);
        }
        await this.saveSecurity(security);
        this.$item?.fire?.('changed', { value: null });
    },
    _userMenu(e) {
        if (this.selectMode) return;
        e.preventDefault();
        e.stopPropagation();
        const user = e.target.$item;
        if (!user) return;
        Promise.resolve(this.canEdit).then(ok => {
            if (!ok) return;
            const label = this.place ? 'Снять с места' : 'Отстранить пользователя';
            const items = [{
                icon: 'icons:remove',
                label,
                execute: () => this.suspendUser(user),
            }];
            const menu = ODA.createElement('oda-tree', {
                items, nodeTemplate: 'menu-node', hideTops: 0, hideRoots: 1,
                execute(item) { this.parentElement.close(item); },
            });
            WORK.showDropdown(menu, { TITLE: { label: user.label } }, e.target);
        });
    }
}
