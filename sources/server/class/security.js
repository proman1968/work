/**
 * Подсистема безопасности, ролей, рабочих мест, ссылок и секретов ($class).
 */
import * as fs from 'node:fs';
import { FS } from '../index.js';
import { DEV_MODE } from '../../host/config.js';
import * as POLICY from '../access/policy.js';
import * as REFS from '../access/refs.js';
import * as LINKS from '../access/links.js';
import * as WORKPLACES from '../access/workplaces.js';
import { classObjectCount } from '../../data/api.js';

const ACCESS_DENIED = 'Доступ запрещён';

/** Кэш нормализованных ROLES по объекту DATA (DATA пересобирается при reset/init). */
const declaredRolesCache = new WeakMap();

export const classSecurityMethods = {
    /**
     * Объявленные роли точки: базовые (ADMIN, BOSS, USER, GUEST) + `ROLES` из class.js,
     * собранного по `~` (прикладные роли — в слое своего типа или класса).
     */
    get declared_roles() {
        return Promise.resolve(this.init).then(() => this._declaredRolesSync());
    },

    /** declared_roles по уже собранному DATA (без init). */
    _declaredRolesSync() {
        const data = this.DATA;
        if (!data || typeof data !== 'object')
            return POLICY.normalizeRoles(null);
        let roles = declaredRolesCache.get(data);
        if (!roles) {
            roles = POLICY.normalizeRoles(data.ROLES);
            declaredRolesCache.set(data, roles);
        }
        return roles;
    },

    /** uid, назначенные на роль локально в #security (ключ — id роли). */
    _roleIds(roleId, declared = this._declaredRolesSync()) {
        if (roleId === 'LINKS' || roleId === 'ROLES')
            return [];
        const security = this.DATA?.['#security'];
        if (!security || !declared[roleId])
            return [];
        const list = security[roleId];
        return Array.isArray(list) ? list.filter(v => typeof v === 'string') : [];
    },

    /** Класс — подразделение ($structure или наследник: $base, $server). */
    async _isStructure() {
        try {
            return (await this.type_chain).includes('$structure');
        }
        catch {
            return false;
        }
    },

    /** Назначен ли uid на прикладную роль (#security.ROLES) этого подразделения. */
    async _isPlaceMember(uid) {
        if (!uid || !(await this._isStructure()))
            return false;
        return WORKPLACES.isPlaceMember(this.DATA?.['#security'], uid);
    },

    /** На классе назначен хотя бы один пользователь (любая роль или место). */
    hasAssignments() {
        const declared = this._declaredRolesSync();
        return Object.keys(declared).some(id => this._roleIds(id, declared).length > 0)
            || WORKPLACES.hasPlaceAssignments(this.DATA?.['#security']);
    },

    /** Получить список ролей текущего пользователя в классе. */
    async roles(params = {}) {
        const uid = this.constructor.resolveUid(params);
        if (!uid)
            return [];
        await this.init;
        const declared = this._declaredRolesSync();
        const roles = [];
        for (const id of Object.keys(declared)) {
            if (this._roleIds(id, declared).includes(uid)) {
                roles.push(id);
                continue;
            }
            if (!POLICY.isSystemRole(id))
                continue;
            for (let p = this.$parent; p; p = p.$parent) {
                if (!(p instanceof FS.$class))
                    continue;
                await p.init;
                const pd = p._declaredRolesSync();
                if (pd[id] && p._roleIds(id, pd).includes(uid)) {
                    roles.push(id);
                    break;
                }
            }
        }
        if (!roles.includes('USER') && await this._isPlaceMember(uid))
            roles.push('USER');
        const principal = params.session?.principal;
        if (principal?.kind === 'node') {
            const claimed = principal.roles?.length ? new Set(principal.roles) : null;
            return POLICY.orderRoles(roles.filter(r =>
                (declared[r]?.principals || []).includes('node') && (!claimed || claimed.has(r))), declared);
        }
        return POLICY.orderRoles(roles, declared);
    },

    /** Идентификатор субъекта, которым является этот класс ($user — uid, $node — id сервера). */
    get principalId() {
        return this.id;
    },

    /** Роль назначена пользователю в этой точке (а не унаследована сверху). */
    async hasLocalRole(params = {}, role = params.role) {
        const uid = this.constructor.resolveUid(params);
        if (!uid || !role)
            return false;
        await this.init;
        return this._roleIds(role).includes(uid)
            || (role === this.constructor.ROLES.USER && await this._isPlaceMember(uid));
    },

    /** Рабочая зона роли — папка в метапапке, куда save_file пишет файлы этой роли. */
    async work_zone(params = {}) {
        const role = params.role || 'GUEST';
        if (!POLICY.isRoleId(role) || POLICY.RESERVED_ZONE_NAMES.includes(role))
            throw new Error('work_zone: недопустимое имя роли «' + role + '»');
        return this.meta_folder._get_next_item(role, FS.$folder);
    },

    /** @deprecated используй work_zone */
    get_storage(params) {
        return this.work_zone(params);
    },

    /** Доступ пользователя к классу ('admin'|'write'|'read'|null). */
    async data_access(params = {}) {
        if (await this.isModuleBlocked())
            return null;
        return LINKS.dataAccess(this, params);
    },

    /** Цепочки ссылок подразделения для дерева. */
    async link_tree(params = {}) {
        if (!(await this._isStructure()))
            return [];
        await this.init;
        const sec = this.DATA?.['#security'];
        const { common, places } = WORKPLACES.normalizeSecurity(sec);
        const roles = await this.roles(params).catch(() => []);
        const admin = DEV_MODE || roles.includes('ADMIN') || await this._isWorkAdmin(params).catch(() => false);
        if (!roles.length && !admin)
            return [];
        const uid = this.constructor.resolveUid(params);
        const rank = { read: 1, write: 2, admin: 3 };
        const eff = new Map();
        const add = (id, access, via) => {
            const cur = eff.get(id);
            if ((rank[access] || 0) <= (rank[cur?.access] || 0) && cur)
                cur.via.push(...via.filter(v => !cur.via.includes(v)));
            else
                eff.set(id, { access, via: [...new Set([...(cur?.via || []), ...via])] });
        };
        if (admin) {
            for (const l of common)
                add(l.id, l.access === 'write' ? 'admin' : 'read', [null]);
            for (const { node, trail } of WORKPLACES.walkPlaces(places)) {
                const via = [WORKPLACES.trailKey(trail)];
                for (const l of node.LINKS)
                    add(l.id, l.access === 'write' ? 'admin' : 'read', via);
            }
        }
        else {
            for (const l of common)
                add(l.id, l.access, [null]);
            for (const [id, e] of WORKPLACES.placeLinksFor(sec, uid, { bossAll: roles.includes('BOSS') }))
                add(id, e.access, e.via);
        }
        return this._linkTrie(eff);
    },

    /** Собрать цепочки ссылок от корней типов (включая всё дочернее поддерево прилинкованного класса). */
    async _linkTrie(eff) {
        const rank = { read: 1, write: 2, admin: 3 };
        const byPath = new Map();
        const resolvedItems = new Map();
        const roots = [];
        const targetPaths = [];
        for (const [id, e] of eff) {
            const modMatch = /^(\/ORGANIZATIONS\/[^/]+\/MODULES\/[^/]+|\/MODULES\/[^/]+)\/(.+)$/.exec(id);
            if (modMatch) {
                try {
                    let modItem = await globalThis.WORK?.get_item(modMatch[1]);
                    if (Array.isArray(modItem))
                        modItem = modItem.at(-1);
                    if (modItem && typeof modItem.isModuleBlocked === 'function' && await modItem.isModuleBlocked())
                        continue;
                }
                catch { /* ignore */ }
            }
            const segs = modMatch ? modMatch[2].split('/').filter(Boolean) : id.split('/').filter(Boolean);
            let prefix = modMatch ? modMatch[1] : '', parent = null;
            segs.forEach((seg, i) => {
                prefix += '/' + seg;
                let n = byPath.get(prefix);
                if (!n) {
                    n = { path: prefix, label: seg, icon: '', type: '', access: 'read', via: [], objectCount: 0, children: [] };
                    byPath.set(prefix, n);
                    if (parent)
                        parent.children.push(n);
                    else
                        roots.push(n);
                }
                if (i === segs.length - 1 && (rank[e.access] || 0) >= (rank[n.access] || 0)) {
                    n.access = e.access;
                    n.via = [...new Set([...(n.via || []), ...(e.via || [])])];
                }
                parent = n;
            });
            targetPaths.push([id, e]);
        }

        const expandSubtree = async (parentNode, parentItem, inherited) => {
            if (!parentNode || !parentItem)
                return;
            let kids = [];
            try {
                kids = ((await parentItem.items) || []).filter(c => c instanceof FS.$class && !LINKS.NO_LINK_TYPES.has(c.type));
            }
            catch { kids = []; }
            for (const child of kids) {
                const childPath = child.path;
                if (!childPath)
                    continue;
                resolvedItems.set(childPath, child);
                let cn = byPath.get(childPath);
                if (!cn) {
                    cn = {
                        path: childPath,
                        label: child.id,
                        icon: '',
                        type: '',
                        access: inherited.access,
                        via: [...(inherited.via || [])],
                        objectCount: 0,
                        children: [],
                    };
                    byPath.set(childPath, cn);
                    parentNode.children.push(cn);
                }
                else {
                    if ((rank[inherited.access] || 0) > (rank[cn.access] || 0))
                        cn.access = inherited.access;
                    cn.via = [...new Set([...(cn.via || []), ...(inherited.via || [])])];
                    if (!parentNode.children.includes(cn))
                        parentNode.children.push(cn);
                }
                await expandSubtree(cn, child, { access: cn.access, via: cn.via });
            }
        };

        for (const [id, e] of targetPaths) {
            const targetNode = byPath.get(id);
            if (!targetNode)
                continue;
            try {
                let targetItem = resolvedItems.get(id) || await globalThis.WORK.get_item(id);
                if (Array.isArray(targetItem))
                    targetItem = targetItem.at(-1);
                if (targetItem) {
                    resolvedItems.set(id, targetItem);
                    await expandSubtree(targetNode, targetItem, { access: targetNode.access || e.access, via: targetNode.via?.length ? targetNode.via : e.via });
                }
            }
            catch { /* ignore */ }
        }

        for (const n of byPath.values()) {
            try {
                let t = resolvedItems.get(n.path) || await globalThis.WORK.get_item(n.path);
                if (Array.isArray(t))
                    t = t.at(-1);
                if (!t)
                    continue;
                await t.init;
                n.label = t.DATA?.label || t.name || n.label;
                n.icon = t.DATA?.icon || '';
                n.type = t.type || '';
                const cnt = t.DATA?.objectCount ?? await classObjectCount(n.path, n.type);
                if (cnt > 0)
                    n.objectCount = cnt;
            }
            catch { /* сегмент как есть */ }
        }
        const sort = (arr) => {
            arr.sort((a, b) => String(a.label).localeCompare(String(b.label), 'ru'));
            arr.forEach(n => sort(n.children));
        };
        sort(roots);
        return roots;
    },

    /** Дерево прикладных ролей подразделения с назначениями и ссылками. */
    async places(params = {}) {
        if (!(await this._isStructure()))
            return { common: [], commonTree: [], places: [] };
        await this.init;
        const uid = this.constructor.resolveUid(params);
        const roles = await this.roles(params).catch(() => []);
        const sec = this.DATA?.['#security'];
        const { common, places } = WORKPLACES.normalizeSecurity(sec);
        const mine = new Set(WORKPLACES.memberTrailKeys(sec, uid));
        const boss = roles.includes('BOSS');
        const seen = new Map();
        const describe = async (id) => {
            if (!seen.has(id)) {
                seen.set(id, (async () => {
                    try {
                        let t = await globalThis.WORK.get_item(id);
                        if (Array.isArray(t))
                            t = t.at(-1);
                        if (!t)
                            return null;
                        await t.init;
                        return { label: t.DATA?.label || t.name || id, icon: t.DATA?.icon || '', type: t.type || '' };
                    }
                    catch {
                        return null;
                    }
                })());
            }
            return seen.get(id);
        };
        const toEff = (links, via) => {
            const rank = { read: 1, write: 2, admin: 3 };
            const eff = new Map();
            for (const l of links) {
                const cur = eff.get(l.id);
                if (!cur || (rank[l.access] || 0) > (rank[cur.access] || 0))
                    eff.set(l.id, { access: l.access, via });
            }
            return eff;
        };
        const outCommon = [];
        for (const l of common)
            outCommon.push({ id: l.id, access: l.access, ...(await describe(l.id) || {}) });
        const walk = async (nodes, trail = []) => {
            const out = [];
            for (const node of nodes) {
                const t = [...trail, node.id];
                const key = WORKPLACES.trailKey(t);
                const links = [];
                for (const l of node.LINKS)
                    links.push({ id: l.id, access: l.access, ...(await describe(l.id) || {}) });
                out.push({
                    id: node.id, label: node.label, icon: node.icon,
                    users: [...node.USERS], links,
                    tree: await this._linkTrie(toEff(node.LINKS, [key])),
                    mine: mine.has(key),
                    inherited: mine.size > 0 && !mine.has(key)
                        && [...mine].some(m => key.startsWith(m + '/')),
                    bossView: boss && !mine.has(key),
                    roles: await walk(node.ROLES, t),
                });
            }
            return out;
        };
        return { common: outCommon, commonTree: await this._linkTrie(toEff(common, [null])), places: await walk(places) };
    },

    /** Право писать объекты точки (create/update/delete). */
    async _assertDataWrite(params = {}) {
        if (params.session?.$user === globalThis.WORK)
            return globalThis.WORK?.id || 'system';
        const uid = this.constructor.resolveUid(params);
        if (DEV_MODE)
            return uid || globalThis.WORK?.id || 'dev';
        if (!uid || !(await this.canSee(this, params)))
            throw new Error(ACCESS_DENIED);
        const level = await this.data_access(params);
        if (level !== 'write' && level !== 'admin')
            throw new Error(ACCESS_DENIED);
        return uid;
    },

    _secretPath(filename) {
        if (!this.meta_folder || !filename)
            return null;
        return this.meta_folder.dir + '/#secret/' + filename;
    },

    _legacySecretPath(filename) {
        if (!this.meta_folder || !filename)
            return null;
        return this.meta_folder.dir + '/#system/' + filename;
    },

    /** Область элемента внутри этой точки (access/policy.js). */
    areaOf(item) {
        if (!item || typeof item !== 'object' || item === this)
            return { kind: POLICY.AREA.SYSTEM };
        const itemClass = item.$class ?? item.$owner;
        if (itemClass && itemClass !== this && itemClass.path !== this.path)
            return { kind: POLICY.AREA.NESTED };
        return POLICY.areaOfPath(item.path, this.path, Object.keys(this._declaredRolesSync()));
    },

    /** Зона элемента: имя роли для зоны, иначе SYSTEM | DATA | INDEX | LOGS | SECRET | NESTED. */
    resolveZone(item) {
        if (!item || typeof item !== 'object')
            return null;
        const area = this.areaOf(item);
        return area.kind === POLICY.AREA.ZONE ? area.role : area.kind.toUpperCase();
    },

    /** Видимость по ролям пользователя в этой точке (без ленты). */
    _readableByRoles(item, roles, uid) {
        if (!roles?.length)
            return false;
        const declared = this._declaredRolesSync();
        const area = this.areaOf(item);
        const opts = area.kind === POLICY.AREA.LOGS ? this._logOwnership(item, uid) : {};
        return roles.some(r => POLICY.canRead(declared[r], area, opts));
    },

    /** Видимость элемента (чтение). */
    async canSee(item, params = {}) {
        if (DEV_MODE) return true;
        const users = this.DATA['#security']?.USER;
        if (Array.isArray(users) && users.includes('GUEST')) return true;
        if (!item || typeof item !== 'object') return true;

        const uid = this.constructor.resolveUid(params);
        if (!uid)
            return this._isSystemPath(item);
        if (params.session?.principal?.kind === 'node') {
            if (this.principalId === uid)
                return item === this || this.areaOf(item).kind === POLICY.AREA.LOGS;
        }
        else if (this.id === uid) return true;
        if (globalThis.WORK && await this._isWorkAdmin(params))
            return true;
        if (this._isSystemItem(item))
            return true;
        const roles = await this.roles(params);
        const isModNode = this.type === '$module'
            || item?.type === '$module'
            || (this.type === '$domain' && this.id === 'MODULES')
            || (item?.type === '$domain' && item?.id === 'MODULES');
        if (isModNode && !roles.includes(this.constructor.ROLES.ADMIN) && !(await this.allAdmins).some(u => u?.id === uid))
            return false;
        if (await LINKS.grants(this, item, params))
            return true;
        if (await LINKS.isStructureAncestor(this, item, params))
            return true;
        if (!this.hasAssignments() && !roles.length) {
            const parent = this.$parent;
            if (parent && await parent.canSee(item, params))
                return true;
            return this._visibleViaFeed(uid, item);
        }
        if (this._readableByRoles(item, roles, uid))
            return true;
        return this._visibleViaFeed(uid, item);
    },

    /** Показано пользователю записью в его ленте (path/includes). */
    async _visibleViaFeed(uid, item) {
        try {
            return await REFS.visible(uid, item?.path);
        }
        catch {
            return false;
        }
    },

    /** Право записи (требует params.role). */
    async canWrite(item, params = {}) {
        if (DEV_MODE) return true;
        if (!item || typeof item !== 'object') return false;
        const uid = this.constructor.resolveUid(params);
        if (!uid) return false;
        const rel = [params.folder, params.filename].filter(Boolean).join('/');
        const target = rel && item.path ? item.path.replace(/\/+$/, '') + '/' + rel : item.path;
        const protectedTarget = POLICY.isExecutablePath(target, this.path) || POLICY.isAgentControlPath(target, this.path);
        if (this.id === uid && params.session?.principal?.kind !== 'node' && !protectedTarget)
            return true;
        if (globalThis.WORK && await this._isWorkAdmin(params))
            return true;
        if (this._isSystemItem(item))
            return false;
        const role = params.role;
        if (!role) return false;
        const roles = await this.roles(params);
        if (!roles.includes(role))
            return false;
        const declared = this._declaredRolesSync();
        const local = this._roleIds(role, declared).includes(uid);
        if (POLICY.canWrite(declared[role], this.areaOf(item), {
            local,
            executable: POLICY.isExecutablePath(item.path, this.path),
        }))
            return true;
        return LINKS.grantsWrite(this, params);
    },

    /** Единая проверка доступа (бросает при отказе): read → canSee, write → canWrite, ADMIN → ADMIN точки. */
    async assertAccess(params = {}, level = this.constructor.ACCESS_LEVEL.READ, folder) {
        if (DEV_MODE) return;
        if (!params?.session) return;
        if (params.session?.$user === globalThis.WORK) return;
        const uid = this.constructor.resolveUid(params);
        const L = this.constructor.ACCESS_LEVEL;
        const ROLES = this.constructor.ROLES;
        if (!uid && level !== L.READ)
            throw new Error(ACCESS_DENIED);
        const roleIsAdmin = !params.role || params.role === ROLES.ADMIN;
        if (roleIsAdmin && globalThis.WORK && await this._isWorkAdmin(params))
            return;
        switch (level) {
            case L.READ:
                if (!(await this.canSee(folder || this, params)))
                    throw new Error(ACCESS_DENIED);
                break;
            case L.WRITE:
                if (!(await this.canWrite(folder || this, params)))
                    throw new Error(ACCESS_DENIED);
                break;
            case L.ADMIN:
                if (params.role && params.role !== ROLES.ADMIN)
                    throw new Error(ACCESS_DENIED);
                if (globalThis.WORK && await this._isWorkAdmin(params))
                    return;
                throw new Error(ACCESS_DENIED);
            default:
                throw new Error(ACCESS_DENIED);
        }
    },

    async allowAccess(params) {
        let result = await this.canSee(this, params);
        if (!result) {
            const items = await this.items;
            for (const i of items) {
                if (i instanceof FS.$class && await i.allowAccess(params)) {
                    result = true;
                    break;
                }
            }
        }
        return result;
    },

    /** Проверка ADMIN на корневом WORK. */
    async _isWorkAdmin(params = {}) {
        if (!globalThis.WORK) return false;
        return globalThis.WORK !== this && await globalThis.WORK.roles?.(params).then(r => r.includes(this.constructor.ROLES.ADMIN));
    },

    /** Системный путь ($server, sources, oda, корень WORK). */
    _isSystemPath(item) {
        const p = item?.path ?? '';
        if (!p) return true;
        if (['/$server', '/sources', '/oda'].some(s => p.startsWith(s))) return true;
        return false;
    },

    _isSystemItem(item) {
        if (!item) return false;
        if (item === globalThis.WORK) return true;
        return this._isSystemPath(item);
    },

    /** Прочитать секрет из #secret (fallback: #system). Требует ADMIN. */
    async read_secret(params = {}) {
        await this.assertAccess(params, this.constructor.ACCESS_LEVEL.ADMIN);
        const filename = params.filename;
        if (!filename)
            throw new Error('Не указано имя файла');
        if (!/^[\p{L}\p{N}_.-]+$/u.test(filename) || filename.includes('..'))
            throw new Error('Имя файла секрета: буквы, цифры, точка и дефис, без обхода каталогов');
        for (const p of [this._secretPath(filename), this._legacySecretPath(filename)]) {
            if (!p || !fs.existsSync(p))
                continue;
            try {
                return JSON.parse(fs.readFileSync(p, { encoding: 'utf-8' }));
            }
            catch (e) {
                console.warn('[WORK] read_secret:', e.message);
            }
        }
        return {};
    },

    /** Сохранить секрет в #secret через save_file. Требует ADMIN. */
    async save_secret(params = {}) {
        await this.assertAccess(params, this.constructor.ACCESS_LEVEL.ADMIN);
        if (!params.filename)
            throw new Error('Не указано имя файла');
        if (!/^[\p{L}\p{N}_.-]+$/u.test(params.filename) || params.filename.includes('..'))
            throw new Error('Имя файла секрета: буквы, цифры, точка и дефис, без обхода каталогов');
        if (params.post == null)
            throw new Error('Не указано тело файла');
        if (!this.meta_folder)
            throw new Error('Нет метапапки класса');
        const secretFolder = await this.meta_folder._get_next_item('#secret', FS.$folder);
        return secretFolder.save_file({ ...params });
    },

    /** Назначенные пользователи класса по роли. */
    async members(params = {}) {
        const { role, inherited } = params;
        const ROLES = this.constructor.ROLES;
        switch (role) {
            case ROLES.ADMIN:
                return inherited ? this.allAdmins : this.admins;
            case ROLES.BOSS:
                return inherited ? this.allBosses : this.bosses;
            case ROLES.USER:
                return this.users;
            case ROLES.GUEST:
                return this.guests;
        }
        if (role && (await this.declared_roles)[role])
            return this._localRole(role);
        return this.assignedUsers;
    },

    /** Пользователи роли, назначенные локально в #security. */
    _localRole(role) {
        return Promise.resolve(this.init).then(async () => {
            const ids = [...this._roleIds(role)];
            if (role === this.constructor.ROLES.USER)
                for (const u of WORKPLACES.placeUserIds(this.DATA?.['#security']))
                    if (!ids.includes(u))
                        ids.push(u);
            if (!ids?.length) return [];
            const usersRoot = await globalThis.WORK.$users;
            const result = [];
            for (const id of ids) {
                if (id === 'GUEST') continue;
                const user = await usersRoot.get_item('//' + id);
                if (user)
                    result.push(user);
            }
            return result;
        });
    },

    get users() {
        return this._localRole(this.constructor.ROLES.USER);
    },

    get guests() {
        return this._localRole(this.constructor.ROLES.GUEST);
    },

    get admins() {
        return this._localRole(this.constructor.ROLES.ADMIN);
    },

    get bosses() {
        return this._localRole(this.constructor.ROLES.BOSS);
    },

    get allAdmins() {
        return Promise.all([Promise.resolve(this.$parent?.allAdmins), this._localRole(this.constructor.ROLES.ADMIN)])
            .then(([parents, local]) => {
                const seen = new Set((parents || []).map(u => u?.id));
                return [...(parents || []), ...local.filter(u => !seen.has(u.id))];
            });
    },

    get allBosses() {
        return Promise.all([Promise.resolve(this.$parent?.allBosses), this._localRole(this.constructor.ROLES.BOSS)])
            .then(([parents, local]) => {
                const seen = new Set((parents || []).map(u => u?.id));
                return [...(parents || []), ...local.filter(u => !seen.has(u.id))];
            });
    },

    get assignedUsers() {
        return Promise.all([
            Promise.resolve(this.allAdmins),
            Promise.resolve(this.allBosses),
            Promise.resolve(this.users),
            Promise.resolve(this.guests),
            Promise.resolve(this.declared_roles).then(declared => Promise.all(
                Object.keys(declared)
                    .filter(id => !POLICY.BASE_ORDER.includes(id))
                    .map(id => this._localRole(id)))),
        ]).then(([admins, bosses, users, guests, custom]) => {
            const all = [...admins, ...bosses, ...users, ...guests, ...custom.flat()];
            const seen = new Set();
            return all.filter(u => {
                if (!u?.id || seen.has(u.id))
                    return false;
                seen.add(u.id);
                return true;
            });
        });
    },
};
