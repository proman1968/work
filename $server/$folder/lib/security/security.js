export default {
    imports: '~/lib//tree.js, ~/lib//user.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: 2px;
                padding: 2px 2px 4px 26px;
                font-size: small;
                overflow: hidden;
            }
            .row {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
                min-height: 24px;
            }
            .tag {
                opacity: .55;
                font-size: x-small;
                min-width: 52px;
            }
            .link {
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                cursor: pointer;
                padding: 0 4px;
                border-radius: 8px;
            }
            .link:hover {
                background: var(--accent-soft);
            }
            .chip {
                @apply --chip;
                font-size: xx-small;
            }
        </style>
        <div ~if="hasContent" vertical>
            <div class="row" ~if="sysAdmins?.length">
                <span class="tag">ADMIN</span>
                <item-user ~for="sysAdmins" :$item="$for.item" :icon-size="20" :title="$for.item.label"></item-user>
            </div>
            <div class="row" ~if="sysBosses?.length">
                <span class="tag">BOSS</span>
                <item-user ~for="sysBosses" :$item="$for.item" :icon-size="20" :title="$for.item.label"></item-user>
            </div>
            <div class="row" ~if="commonLinks?.length">
                <span class="tag">Ссылки</span>
                <div class="link" ~for="commonLinks" @tap="openLink($for.item.path)" :title="$for.item.id">
                    <oda-icon :icon="$for.item.icon || 'bootstrap:database'" icon-size="16"></oda-icon>
                    <span>{{$for.item.label || $for.item.id}}</span>
                    <span class="chip">{{$for.item.access === 'write' ? 'запись' : 'чтение'}}</span>
                </div>
            </div>
            <item-place ~for="placeList" :$item :place="$for.item" :depth="0" :trail="$for.item.id"></item-place>
        </div>
    `,
    $item: {
        $type: Object,
        set(n) {},
    },
    /** @deprecated отображает только первого админа; используй item-users с role="ADMIN". */
    get admin() {
        return Promise.resolve(this.$item?.allAdmins).then(admins => {
            return this.admin = admins?.length ? admins.last : null;
        })
    },
    get placesData() {
        if (!this.$item?.fetch)
            return null;
        return this.$item.fetch('places').catch(() => null);
    },
    get sysAdmins() {
        const ids = this.$item?.DATA?.roleIds?.ADMIN;
        if (!Array.isArray(ids) || !ids.length)
            return [];
        return Promise.resolve(WORK.usersByIds(ids)).then(l => (l || []).filter(Boolean)).catch(() => []);
    },
    get sysBosses() {
        const ids = this.$item?.DATA?.roleIds?.BOSS;
        if (!Array.isArray(ids) || !ids.length)
            return [];
        return Promise.resolve(WORK.usersByIds(ids)).then(l => (l || []).filter(Boolean)).catch(() => []);
    },
    get commonLinks() {
        return Promise.resolve(this.placesData).then(d => Array.isArray(d?.common) ? d.common : []);
    },
    get placeList() {
        return Promise.resolve(this.placesData).then(d => Array.isArray(d?.places) ? d.places : []);
    },
    get hasContent() {
        return Promise.all([this.sysAdmins, this.sysBosses, this.commonLinks, this.placeList]).then(([a, b, c, p]) =>
            (a?.length + b?.length + c?.length + p?.length) > 0
        ).catch(() => false);
    },
    $listeners: {
        dragover(e) {
            if (e.dataTransfer.dropEffect === 'copy') {
                e.preventDefault();
            }
        },
    },
    getUser(dataTransfer) {
        const data = dataTransfer.getData('data');
        const user = JSON.parse(data);
        return (user.type === '$user') ? user : null;
    },
    /** Прочитать текущие назначения безопасности из body класса. */
    async getSecurity() {
        const body = await this.$item.body;
        return body?.['#security'] || {};
    },
    /** Сохранить назначения безопасности в body класса. */
    async saveSecurity(security) {
        const body = await this.$item.body;
        body['#security'] = security;
        await this.$item.save(body);
    },
    async selectUser(e) {
        const currentTarget = e.currentTarget;
        const $users = await WORK.get_item('/USERS');
        const menu = ODA.createElement('item-tree',
            {
                $item: $users,
                hideTops: 1,
                hideRoots: 2,
                execute(item) {
                    this.parentElement.close(item);
                }
            }
        );
        const user = await WORK.showDropdown(menu, { TITLE: { label: 'Выберите пользователя' } }, currentTarget);
        if (user) {
            return this.assignUser(user);
        }
    },
    assignUser(user) {
        throw new Error('Метод "assignUser" не переопределён');
    },
    /** Открыть класс по ссылке: во вкладке explorer, иначе — в новой вкладке. */
    async openLink(path) {
        if (!path)
            return;
        const top = WORK.top;
        if (typeof top?.execute === 'function') {
            try {
                const item = await WORK.get_item(path);
                if (item) {
                    top.execute(item);
                    return;
                }
            }
            catch { /* ниже — новая вкладка */ }
        }
        window.open(encodeURI(path + '/~/handlers/pages/form/'), '_blank');
    },
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

ODA({is: 'item-place',
    imports: '~/lib//security.js',
    extends: 'item-security',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: 2px;
                overflow: hidden;
            }
            .row {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
                min-height: 24px;
                border-radius: 8px;
            }
            .row.drop {
                outline: 1px dashed var(--accent-color);
            }
            .place {
                font-weight: 600;
            }
            .mine {
                color: var(--accent-color);
                font-size: x-small;
            }
            .sub {
                opacity: .55;
                font-size: x-small;
            }
            .link {
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                cursor: pointer;
                padding: 0 4px;
                border-radius: 8px;
            }
            .link:hover {
                background: var(--accent-soft);
            }
            .chip {
                @apply --chip;
                font-size: xx-small;
            }
        </style>
        <div>
            <div class="row" :style="'padding-left:' + (depth * 12) + 'px'" @dragover="allowDrop" @dragleave="leaveDrop" @drop="dropUser">
                <span class="place">{{place?.label || place?.id}}</span>
                <span class="mine" ~if="place?.mine">• моё</span>
                <span class="sub" ~if="place?.inherited">• наследует</span>
                <span class="sub" ~if="place?.bossView">• обзор BOSS</span>
                <item-user ~for="placeUsers" :$item="$for.item" :icon-size="20" :title="$for.item.label" @contextmenu.capture="_userMenu"></item-user>
                <oda-icon ~if="canEdit" icon="icons:add" icon-size="14" @tap="selectUser" title="Назначить на место"></oda-icon>
            </div>
            <div class="row" ~for="placeLinks" :style="'padding-left:' + ((depth + 1) * 12) + 'px'">
                <div class="link" @tap="openLink($for.item.path)" :title="$for.item.id">
                    <oda-icon :icon="$for.item.icon || 'bootstrap:database'" icon-size="14"></oda-icon>
                    <span>{{$for.item.label || $for.item.id}}</span>
                    <span class="chip">{{$for.item.access === 'write' ? 'запись' : 'чтение'}}</span>
                </div>
            </div>
            <item-place ~for="place?.roles" :$item :place="$for.item" :depth="depth + 1" :trail="trail + '/' + $for.item.id"></item-place>
        </div>
    `,
    place: null,
    depth: 0,
    trail: '',
    get placeUsers() {
        const ids = Array.isArray(this.place?.users) ? this.place.users : [];
        if (!ids.length)
            return [];
        return Promise.resolve(WORK.usersByIds(ids)).then(l => (l || []).filter(Boolean)).catch(() => []);
    },
    get placeLinks() {
        return Array.isArray(this.place?.links) ? this.place.links : [];
    },
    get canEdit() {
        return Promise.resolve(this.$item?.isAdmin).then(v => !!v).catch(() => false);
    },
    allowDrop(e) {
        try {
            if (e.dataTransfer.types?.includes('data')) {
                e.preventDefault();
                e.currentTarget?.classList?.add('drop');
            }
        }
        catch { /* мимо */ }
    },
    leaveDrop(e) {
        e.currentTarget?.classList?.remove('drop');
    },
    /** Назначить пользователя на это место (только ADMIN структуры). */
    async assignUser(user) {
        return this.assignPlaceUser(user);
    },
    async dropUser(e) {
        e.preventDefault();
        e.currentTarget?.classList?.remove('drop');
        let user = null;
        try {
            user = this.getUser(e.dataTransfer);
        }
        catch { return; }
        if (!user)
            return;
        return this.assignPlaceUser(user);
    },
    async assignPlaceUser(user) {
        if (!user?.id)
            return;
        const security = await this.getSecurity();
        const steps = String(this.trail || this.place?.id || '').split('/').filter(Boolean);
        let level = Array.isArray(security.ROLES) ? security.ROLES : (security.ROLES = []);
        let node = null;
        for (const id of steps) {
            node = level.find(r => r?.id === id);
            if (!node)
                return;
            level = Array.isArray(node.ROLES) ? node.ROLES : (node.ROLES = []);
        }
        if (!node)
            return;
        node.USERS ??= [];
        if (!node.USERS.includes(user.id))
            node.USERS.push(user.id);
        await this.saveSecurity(security);
        this.$item?.fire?.('changed', { value: null });
    },
    async suspendPlaceUser(user) {
        if (!user?.id)
            return;
        const security = await this.getSecurity();
        const steps = String(this.trail || this.place?.id || '').split('/').filter(Boolean);
        let level = Array.isArray(security.ROLES) ? security.ROLES : [];
        let node = null;
        for (const id of steps) {
            node = level.find(r => r?.id === id);
            if (!node)
                return;
            level = Array.isArray(node.ROLES) ? node.ROLES : [];
        }
        if (node?.USERS)
            node.USERS = node.USERS.filter(id => id !== user.id);
        await this.saveSecurity(security);
        this.$item?.fire?.('changed', { value: null });
    },
    _userMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        const user = e.target.$item;
        if (!user)
            return;
        Promise.resolve(this.canEdit).then(ok => {
            if (!ok)
                return;
            const items = [{
                icon: 'icons:remove',
                label: 'Снять с места',
                execute: () => this.suspendPlaceUser(user),
            }];
            const menu = ODA.createElement('oda-tree', {
                items, nodeTemplate: 'menu-node', hideTops: 0, hideRoots: 1,
                execute(item) { this.parentElement.close(item); },
            });
            WORK.showDropdown(menu, { TITLE: { label: user.label } }, e.target);
        });
    }
})
