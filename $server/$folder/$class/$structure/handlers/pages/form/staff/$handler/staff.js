export default {
    imports: 'oda//icon, oda//button',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                padding: 16px 20px;
                gap: 16px;
                overflow-y: auto;
                background: #ffffff;
                color: #222;
            }
            .card {
                @apply --vertical;
                gap: 10px;
                padding: 14px 16px;
                border: 1px solid #e2e4e8;
                border-radius: 8px;
                background: #fafafa;
            }
            .place-card {
                @apply --vertical;
                gap: 10px;
                padding: 12px 14px;
                border: 1px solid #dcdce2;
                border-radius: 8px;
                background: #ffffff;
            }
            .place-card.active-place {
                border-color: #3b1d5e;
                box-shadow: 0 0 0 2px rgba(59, 29, 94, 0.12);
            }
            .card-header {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                font-size: 15px;
            }
            .role-row {
                @apply --horizontal;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
            }
            .role-title {
                font-size: 13px;
                font-weight: 600;
                color: #444;
                min-width: 140px;
            }
            .user-chip {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 3px 8px;
                border-radius: 14px;
                background: #ede9fe;
                color: #2e1065;
                font-size: 13px;
            }
            .user-chip .rm {
                cursor: pointer;
                font-weight: bold;
                opacity: .65;
                padding: 0 2px;
            }
            .user-chip .rm:hover {
                opacity: 1;
                color: #b91c1c;
            }
            select, input[type="text"] {
                padding: 4px 8px;
                border: 1px solid #cbd5e1;
                border-radius: 6px;
                font: inherit;
                font-size: 13px;
                background: #fff;
            }
            .links-box {
                @apply --vertical;
                gap: 6px;
                padding-top: 6px;
                border-top: 1px dashed #e2e8f0;
            }
            .link-row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                padding: 3px 6px;
                background: #f8fafc;
                border-radius: 6px;
            }
            .muted {
                color: #777;
                font-size: 13px;
            }
        </style>

        <div class="card">
            <div class="card-header">
                <oda-icon :icon="$item?.icon || 'odant:structure'" icon-size="24"></oda-icon>
                <span>{{$item?.label || $item?.id}} — Руководство и администрирование</span>
            </div>

            <div class="role-row">
                <span class="role-title">Руководитель (BOSS):</span>
                <div class="user-chip" ~for="bossList">
                    <oda-icon icon="fontawesome:s-user-tie" icon-size="14"></oda-icon>
                    <span>{{userLabel($for.item)}}</span>
                    <span ~if="canEdit" class="rm" title="Снять руководителя" @tap="removeRoleUser('BOSS', $for.item)">×</span>
                </div>
                <span ~if="!bossList.length" class="muted">не назначен</span>
                <select ~if="canEdit" @change="addRoleUser('BOSS', $event)">
                    <option value="">+ Назначить руководителя…</option>
                    <option ~for="allUsers" :value="$for.item.id">{{$for.item.label}} ({{$for.item.id}})</option>
                </select>
            </div>

            <div class="role-row">
                <span class="role-title">Администратор (ADMIN):</span>
                <div class="user-chip" ~for="adminList">
                    <oda-icon icon="icons:verified-user" icon-size="14"></oda-icon>
                    <span>{{userLabel($for.item)}}</span>
                    <span ~if="canEdit" class="rm" title="Снять администратора" @tap="removeRoleUser('ADMIN', $for.item)">×</span>
                </div>
                <span ~if="!adminList.length" class="muted">не назначен (наследуется сверху)</span>
                <select ~if="canEdit" @change="addRoleUser('ADMIN', $event)">
                    <option value="">+ Назначить администратора…</option>
                    <option ~for="allUsers" :value="$for.item.id">{{$for.item.label}} ({{$for.item.id}})</option>
                </select>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <oda-icon icon="odant:workplace" icon-size="22"></oda-icon>
                <span>Рабочие места подразделения ({{flatPlaces.length}})</span>
                <div ~if="canEdit" class="horizontal" style="margin-left:auto;gap:6px;align-items:center;">
                    <input type="text" placeholder="Название нового рабочего места…" :value="newPlaceLabel" @input="newPlaceLabel = $event.target.value" style="width:220px;">
                    <oda-button icon="icons:add" @tap="addPlace('')">Добавить место</oda-button>
                </div>
            </div>

            <div ~if="!flatPlaces.length" class="muted">В этом подразделении ещё нет рабочих мест.</div>

            <div ~for="flatPlaces" class="place-card" ~class="{'active-place': focusedTrail === $for.item.trail}" :style="'margin-left:' + ($for.item.depth * 24) + 'px'">
                <div class="card-header">
                    <oda-icon icon="fontawesome:s-user-tie" icon-size="20"></oda-icon>
                    <span>{{$for.item.node.label || $for.item.node.id}}</span>
                    <span class="muted">({{$for.item.trail}})</span>
                    <div ~if="canEdit" class="horizontal" style="margin-left:auto;gap:6px;">
                        <oda-button icon="icons:add" title="Добавить подчинённое рабочее место" @tap="promptSubPlace($for.item.trail)">Подчинённое место</oda-button>
                        <oda-button icon="icons:delete" title="Удалить рабочее место" @tap="removePlace($for.item.trail)"></oda-button>
                    </div>
                </div>

                <div class="role-row">
                    <span class="role-title">Сотрудники места:</span>
                    <div class="user-chip" ~for="$for.item.users">
                        <oda-icon icon="icons:person" icon-size="14"></oda-icon>
                        <span>{{userLabel($for.$for.item)}}</span>
                        <span ~if="canEdit" class="rm" title="Снять с рабочего места" @tap="removePlaceUser($for.item.trail, $for.$for.item)">×</span>
                    </div>
                    <span ~if="!$for.item.users.length" class="muted">сотрудники не назначены</span>
                    <select ~if="canEdit" @change="addPlaceUser($for.item.trail, $event)">
                        <option value="">+ Назначить сотрудника…</option>
                        <option ~for="allUsers" :value="$for.$for.item.id">{{$for.$for.item.label}} ({{$for.$for.item.id}})</option>
                    </select>
                </div>

                <div class="links-box">
                    <div class="role-row">
                        <span class="role-title">Привязанные классы ({{$for.item.links.length}}):</span>
                        <select ~if="canEdit && availableClasses.length" @change="addPlaceLink($for.item.trail, $event)" style="max-width:340px;">
                            <option value="">+ Привязать учётный класс…</option>
                            <option ~for="availableClasses" :value="$for.$for.item.path">{{$for.$for.item.title}} ({{$for.$for.item.shortPath}})</option>
                        </select>
                    </div>
                    <div class="link-row" ~for="$for.item.links">
                        <oda-icon icon="odant:class" icon-size="16"></oda-icon>
                        <span style="flex:1;font-weight:500;">{{classTitle($for.$for.item.id)}}</span>
                        <select :disabled="!canEdit" @change="updatePlaceLinkAccess($for.item.trail, $for.$for.item.id, $event.target.value)">
                            <option value="read" :selected="$for.$for.item.access === 'read'">Чтение (R)</option>
                            <option value="write" :selected="$for.$for.item.access === 'write'">Запись (A)</option>
                        </select>
                        <select :disabled="!canEdit" @change="updatePlaceLinkScope($for.item.trail, $for.$for.item.id, $event.target.value)">
                            <option value="" :selected="!$for.$for.item.scope">По умолчанию</option>
                            <option value="own" :selected="$for.$for.item.scope === 'own'">Свои (own)</option>
                            <option value="place" :selected="$for.$for.item.scope === 'place'">Место (place)</option>
                            <option value="unit" :selected="$for.$for.item.scope === 'unit'">Подразделение (unit)</option>
                            <option value="all" :selected="$for.$for.item.scope === 'all'">Все (all)</option>
                        </select>
                        <span ~if="canEdit" style="cursor:pointer;color:#b91c1c;font-weight:bold;padding:0 4px;" title="Отвязать класс" @tap="removePlaceLink($for.item.trail, $for.$for.item.id)">×</span>
                    </div>
                </div>
            </div>
        </div>
        <div ~if="error" style="color:var(--error-color, #c00);">{{error}}</div>
    `,
    security: null,
    allUsers: [],
    userMap: {},
    availableClasses: [],
    classMap: {},
    canEdit: false,
    focusedTrail: '',
    newPlaceLabel: '',
    error: '',
    async attached() {
        await this.reload();
    },
    async applyNav(nav = {}) {
        if (nav.place)
            this.focusedTrail = String(nav.place);
        await this.reload();
    },
    get bossList() {
        return Array.isArray(this.security?.BOSS) ? this.security.BOSS : [];
    },
    get adminList() {
        return Array.isArray(this.security?.ADMIN) ? this.security.ADMIN : [];
    },
    get flatPlaces() {
        const out = [];
        const walk = (roles, prefix = '', depth = 0) => {
            for (const r of Array.isArray(roles) ? roles : []) {
                if (!r?.id)
                    continue;
                const trail = prefix ? `${prefix}/${r.id}` : r.id;
                out.push({
                    trail,
                    depth,
                    node: r,
                    users: Array.isArray(r.USERS) ? [...r.USERS] : [],
                    links: Array.isArray(r.LINKS) ? [...r.LINKS] : [],
                });
                if (Array.isArray(r.ROLES) && r.ROLES.length)
                    walk(r.ROLES, trail, depth + 1);
            }
        };
        walk(this.security?.ROLES || []);
        return out;
    },
    userLabel(uid) {
        return this.userMap?.[uid] || uid;
    },
    classTitle(path) {
        return this.classMap?.[path] || String(path || '').replace(/^\/ORGANIZATIONS\/[^/]+\/MODULES\/[^/]+\//, '');
    },
    async reload() {
        this.error = '';
        if (!this.$item)
            return;
        try {
            this.canEdit = !!(WORK?.DEV_MODE || await this.$item.isAdmin);
            const body = await this.$item.body;
            this.security = JSON.parse(JSON.stringify(body?.['#security'] || {}));
            await this.loadUsers();
            await this.loadAvailableClasses();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async loadUsers() {
        try {
            const uRoot = (await WORK.get_item('/USERS')) || (await WORK.get_item('/users'));
            const items = (await uRoot?.items) || [];
            const list = [];
            const map = {};
            for (const u of items) {
                if (!u?.id || u.id[0] === '$')
                    continue;
                const label = u.label || u.DATA?.label || u.id;
                list.push({ id: u.id, label });
                map[u.id] = label;
            }
            this.allUsers = list;
            this.userMap = map;
        }
        catch { /* ignore */ }
    },
    async loadAvailableClasses() {
        try {
            const p = String(this.$item?.path || '');
            const m = /^(\/ORGANIZATIONS\/[^/]+)/.exec(p);
            const basePath = m ? m[1] : '';
            if (!basePath)
                return;
            const modRoot = await WORK.get_item(basePath + '/MODULES/Register');
            if (!modRoot?.fetch)
                return;
            const info = await WORK.fetch(location.origin + basePath + '/MODULES/Register', 'info', { deep: 4, branch: 'classes' });
            const list = [];
            const map = {};
            const prefix = basePath + '/MODULES/Register/';
            const visit = (nodes) => {
                for (const n of Array.isArray(nodes) ? nodes : []) {
                    if (!n?.path || !n.id || n.id[0] === '$')
                        continue;
                    if (['$catalog', '$virtual', '$operation', '$register', '$account'].includes(n.type)) {
                        const shortPath = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : n.path;
                        const title = n.label || n.id;
                        list.push({ path: n.path, title, shortPath });
                        map[n.path] = `${title} (${shortPath})`;
                    }
                    if (Array.isArray(n.items))
                        visit(n.items);
                }
            };
            visit(info?.items || []);
            this.availableClasses = list;
            this.classMap = map;
        }
        catch { /* ignore */ }
    },
    async persist(nextSec) {
        this.error = '';
        try {
            const body = await this.$item.body;
            body['#security'] = nextSec;
            await this.$item.save(body);
            this.security = JSON.parse(JSON.stringify(nextSec));
            this.$item.reset?.();
            this.$item.fire?.('changed', { value: null });
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async addRoleUser(role, e) {
        const uid = e?.target?.value;
        if (e?.target)
            e.target.value = '';
        if (!uid)
            return;
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        sec[role] = Array.isArray(sec[role]) ? sec[role] : [];
        if (!sec[role].includes(uid))
            sec[role].push(uid);
        await this.persist(sec);
    },
    async removeRoleUser(role, uid) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        if (!Array.isArray(sec[role]))
            return;
        sec[role] = sec[role].filter(id => id !== uid);
        await this.persist(sec);
    },
    _findPlaceMut(sec, trail) {
        const steps = String(trail || '').split('/').filter(Boolean);
        let list = Array.isArray(sec.ROLES) ? sec.ROLES : [];
        let node = null;
        for (const id of steps) {
            node = list.find(r => r?.id === id);
            if (!node)
                return null;
            list = Array.isArray(node.ROLES) ? node.ROLES : [];
        }
        return node;
    },
    async addPlace(parentTrail = '', customLabel = '') {
        const label = String(customLabel || this.newPlaceLabel || '').trim();
        if (!label)
            return;
        const id = label.toLowerCase().replace(/[^a-zа-яё0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || ('place_' + Date.now());
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const newNode = { id, label, USERS: [], LINKS: [] };
        if (parentTrail) {
            const parent = this._findPlaceMut(sec, parentTrail);
            if (!parent)
                return;
            parent.ROLES = Array.isArray(parent.ROLES) ? parent.ROLES : [];
            if (!parent.ROLES.some(r => r.id === id))
                parent.ROLES.push(newNode);
        }
        else {
            sec.ROLES = Array.isArray(sec.ROLES) ? sec.ROLES : [];
            if (!sec.ROLES.some(r => r.id === id))
                sec.ROLES.push(newNode);
            this.newPlaceLabel = '';
        }
        await this.persist(sec);
    },
    async promptSubPlace(parentTrail) {
        const name = window.prompt?.('Название подчинённого рабочего места:');
        if (name && name.trim())
            await this.addPlace(parentTrail, name.trim());
    },
    async removePlace(trail) {
        const steps = String(trail || '').split('/').filter(Boolean);
        if (!steps.length)
            return;
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const targetId = steps.pop();
        if (!steps.length) {
            sec.ROLES = (sec.ROLES || []).filter(r => r?.id !== targetId);
        }
        else {
            const parent = this._findPlaceMut(sec, steps.join('/'));
            if (parent && Array.isArray(parent.ROLES))
                parent.ROLES = parent.ROLES.filter(r => r?.id !== targetId);
        }
        await this.persist(sec);
    },
    async addPlaceUser(trail, e) {
        const uid = e?.target?.value;
        if (e?.target)
            e.target.value = '';
        if (!uid)
            return;
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findPlaceMut(sec, trail);
        if (!node)
            return;
        node.USERS = Array.isArray(node.USERS) ? node.USERS : [];
        if (!node.USERS.includes(uid))
            node.USERS.push(uid);
        await this.persist(sec);
    },
    async removePlaceUser(trail, uid) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findPlaceMut(sec, trail);
        if (!node || !Array.isArray(node.USERS))
            return;
        node.USERS = node.USERS.filter(id => id !== uid);
        await this.persist(sec);
    },
    async addPlaceLink(trail, e) {
        const clsPath = e?.target?.value;
        if (e?.target)
            e.target.value = '';
        if (!clsPath)
            return;
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findPlaceMut(sec, trail);
        if (!node)
            return;
        node.LINKS = Array.isArray(node.LINKS) ? node.LINKS : [];
        if (!node.LINKS.some(l => l?.id === clsPath))
            node.LINKS.push({ id: clsPath, access: 'read' });
        await this.persist(sec);
    },
    async updatePlaceLinkAccess(trail, clsPath, access) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findPlaceMut(sec, trail);
        const link = node?.LINKS?.find(l => l?.id === clsPath);
        if (!link)
            return;
        link.access = access === 'write' ? 'write' : 'read';
        await this.persist(sec);
    },
    async updatePlaceLinkScope(trail, clsPath, scope) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findPlaceMut(sec, trail);
        const link = node?.LINKS?.find(l => l?.id === clsPath);
        if (!link)
            return;
        if (scope)
            link.scope = scope;
        else
            delete link.scope;
        await this.persist(sec);
    },
    async removePlaceLink(trail, clsPath) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findPlaceMut(sec, trail);
        if (!node || !Array.isArray(node.LINKS))
            return;
        node.LINKS = node.LINKS.filter(l => l?.id !== clsPath);
        await this.persist(sec);
    },
}
