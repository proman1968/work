/**
 * $node — узел сети WORK в реестре `/NODES`:
 *  1) Корень реестра (`/NODES`, `isRegistry === true`);
 *  2) Конкретный узел сети (`/NODES/<Узел>`, `isNodeRoot === true`);
 *  3) Смонтированный удалённый элемент внутри узла (`/NODES/<Узел>/<удалённый_путь>`, `isMountedRemote === true`),
 *     который отображается в дереве внутри `/NODES/<Узел>`, открывается в штатных вкладках нашего
 *     проводника (`work-form`) и прозрачно проксирует чтение и действия на удалённый сервер по протоколу `work-node/1`.
 */
import * as fs from 'node:fs';
import { $class } from './class.js';
import { $folder } from './folder.js';
import { FS } from './index.js';
import { DATA_METHODS } from '../data/api.js';
import {
    normalizeRemotePath,
    addNodePrefix,
    rewriteRemoteInfo,
    rewriteRemoteDataResult,
    resolveMountRoles,
    callMountedRemote,
} from '../modules/nodes/mount.js';

const ACCESS_DENIED = 'Доступ запрещён';
const REMOTE_SYNC_TTL_MS = 4_000;

const MODULE_TYPE_FALLBACK = {
    $register: '/MODULES/Register/REGISTER',
    $account: '/MODULES/Register/REGISTER/$register/$folder/$class/$account',
    $virtual: '/MODULES/Register/CATALOGS/$catalog/$folder/$class/$virtual',
    $operation: '/MODULES/Register/OPERATIONS',
    $catalog: '/MODULES/Register/CATALOGS',
};

export class $node extends $class {
    static sourceUrl = import.meta.url;

    /** Корень реестра (/NODES), а не конкретный узел. */
    get isRegistry() {
        return !this._isMountedRemote && !(this.$parent instanceof $node);
    }

    /** Сам узел сервера партнёра (/NODES/<Узел>). */
    get isNodeRoot() {
        return !this._isMountedRemote && (this.$parent instanceof $node);
    }

    /** Смонтированный виртуальный элемент внутри /NODES/<Узел>/... */
    get isMountedRemote() {
        return Boolean(this._isMountedRemote);
    }

    get remotePath() {
        return this._remotePath || '';
    }

    set remotePath(v) {
        this._remotePath = v;
    }

    /** Корневой узел /NODES/<Узел> для этого элемента. */
    get $nodeRoot() {
        if (this._isMountedRemote)
            return this._nodeRoot;
        if (this.isNodeRoot)
            return this;
        return null;
    }

    /** Идентификатор субъекта узла в #security других классов — id его сервера. */
    get principalId() {
        if (this._isMountedRemote)
            return this.$nodeRoot?.principalId || this.id;
        return this.DATA?.host_id ? String(this.DATA.host_id).toUpperCase() : this.id;
    }

    get type() {
        if (this._isMountedRemote)
            return this._remoteType || this.DATA?.type || '$class';
        return this.meta_folder?.id;
    }

    get meta_folder() {
        if (this._isMountedRemote)
            return null;
        try {
            if (!fs.existsSync(this.real_dir))
                fs.mkdirSync(this.real_dir + '/' + this.constructor.name, { recursive: true });
            return FS.$folder.build(fs.readdirSync(this.real_dir).find(f => f[0] === '$'), this);
        }
        catch (e) {
            console.warn('[WORK] meta_folder:', e.message);
        }
    }

    get $folder() {
        return this.constructor.inherit(WORK.$folder, this.meta_folder || this);
    }

    get $public() {
        return {
            get isRemote() {
                return this._isMountedRemote ? true : undefined;
            },
            get remotePath() {
                return this._isMountedRemote ? this._remotePath : undefined;
            },
            get form() {
                if (this.DATA?.$public?.form)
                    return this.DATA.$public.form;
                if (this.DATA?.form)
                    return this.DATA.form;
                if (this._isMountedRemote) {
                    const t = this.type;
                    if (t === '$catalog' || t === '$operation') return 'objects';
                    if (t === '$virtual') return 'virtual';
                    if (t === '$register') return 'sheet';
                    if (t === '$account') return 'postings';
                    if (t === '$base' || t === '$structure') return 'chat';
                    if (t === '$file') return 'file';
                }
                return undefined;
            },
        };
    }

    get type_chain() {
        if (this._isMountedRemote && this.type === '$file') {
            const dot = String(this.id || '').lastIndexOf('.');
            const ext = dot > 0 ? '$' + String(this.id).slice(dot + 1).toLowerCase() : '$file';
            return this.constructor.type_chain[ext] ??= new AsyncPromise(async () => {
                let folder = await WORK.$folder.children;
                folder = folder.find(f => f.id === '$file');
                folder = await folder?.find_item(ext, item => item.id?.[0] === '$');
                if (!folder)
                    return ['$file', ext];
                return folder.path.split('/').slice(3);
            });
        }
        const type = this.type;
        return this.constructor.type_chain[type] ??= new AsyncPromise(async () => {
            const folder = await WORK.$folder.find_item(type, item => item.id?.[0] === '$' && item.id !== '$file');
            if (!folder)
                return ['$class', type];
            return folder.path.split('/').slice(3);
        });
    }

    /** Для смонтированных элементов подставляем эталонный класс модуля в _tilde_layers, чтобы работали его формы. */
    async _remotePeerMetaFolders() {
        if (!this._isMountedRemote)
            return [];
        const out = [];
        const rp = String(this._remotePath || '');
        const m = /^(?:\/ORGANIZATIONS\/[^/]+)?\/MODULES\/([^/]+)(\/.*)?$/.exec(rp);
        if (m) {
            const modPath = `/MODULES/${m[1]}${m[2] || ''}`;
            try {
                const peer = await globalThis.WORK?.get_item(modPath);
                if (peer) {
                    for (let p = peer; p && p instanceof $class; p = p.$parent) {
                        if (p.type === this.type && p.meta_folder)
                            out.unshift(p.meta_folder);
                        else if (p.meta_folder) {
                            const decl = await p.meta_folder.get_item('$folder/$class/' + this.type).catch(() => null);
                            if (decl)
                                out.unshift(decl);
                        }
                    }
                }
            }
            catch { /* ignore */ }
        }
        if (!out.length && MODULE_TYPE_FALLBACK[this.type]) {
            try {
                const fb = await globalThis.WORK?.get_item(MODULE_TYPE_FALLBACK[this.type]);
                if (fb)
                    out.push(fb.meta_folder || fb);
            }
            catch { /* ignore */ }
        }
        return out;
    }

    async _assertRegistry() {
        await this.init;
        if (!this.isRegistry)
            throw new Error('Метод реестра узлов вызывается на /NODES');
    }

    async _assertNode() {
        await this.init;
        if (this.isRegistry || this._isMountedRemote)
            throw new Error('Метод узла вызывается на узле /NODES/<узел>');
    }

    /** Создать или вернуть дочерний смонтированный элемент по имени сегмента. */
    _getMountedChild(segId, initialData = null) {
        const root = this.$nodeRoot;
        if (!root)
            return null;
        this.__mounted__ ??= Object.create(null);
        let child = this.__mounted__[segId];
        if (!child) {
            const baseRemote = this._isMountedRemote ? this._remotePath : '';
            const remotePath = normalizeRemotePath(baseRemote + '/' + segId);
            child = new $node({ id: segId, label: initialData?.label || segId }, this);
            child.id = segId;
            child._isMountedRemote = true;
            child._nodeRoot = root;
            child._remotePath = remotePath;
            this.__mounted__[segId] = child;
        }
        if (initialData && typeof initialData === 'object') {
            child._applyRemoteData(initialData);
        }
        return child;
    }

    /** Найти или построить цепочку смонтированных элементов по относительному удалённому пути. */
    _ensureMountedChain(remotePath, leafData = null) {
        const segs = normalizeRemotePath(remotePath).split('/').filter(Boolean);
        let cur = this.$nodeRoot;
        for (let i = 0; i < segs.length; i++) {
            const isLast = i === segs.length - 1;
            cur = cur._getMountedChild(segs[i], isLast ? leafData : null);
        }
        return cur;
    }

    _applyRemoteData(raw) {
        if (!raw || typeof raw !== 'object')
            return;
        const rootPath = this.$nodeRoot?.path || '';
        const rewritten = rewriteRemoteInfo(raw, rootPath, this._remotePath);
        if (rewritten.type && rewritten.type !== '$node')
            this._remoteType = rewritten.type;
        this.DATA = {
            ...(this.DATA || {}),
            ...rewritten,
            id: this.id,
        };
        this._remoteSyncedAt = Date.now();
    }

    async _syncRemote(params = {}) {
        if (!this._isMountedRemote)
            return this;
        if (this._remoteSyncedAt && Date.now() - this._remoteSyncedAt < REMOTE_SYNC_TTL_MS && this._remoteType)
            return this;
        const root = this.$nodeRoot;
        if (!root)
            return this;
        await root.init;
        if (root.DATA?.status !== 'active' || !root.DATA?.origin || !root.DATA?.host_id)
            return this;
        try {
            const info = await callMountedRemote(root, this._remotePath, 'info', { ...params, deep: 1 });
            if (info && typeof info === 'object') {
                this._applyRemoteData(info);
                if (Array.isArray(info.items)) {
                    this._mountedItems = info.items.map(it => this._getMountedChild(it.id || String(it.path || '').split('/').pop(), it)).filter(Boolean);
                }
            }
        }
        catch {
            this._remoteType ??= '$domain';
            this.DATA = {
                id: this.id,
                label: this.DATA?.label || this.id,
                type: this._remoteType,
                path: this.path,
                remotePath: this._remotePath,
                isRemote: true,
                hasItems: true,
            };
            this._remoteSyncedAt = Date.now();
        }
        return this;
    }

    get init() {
        if (this._isMountedRemote) {
            return this[R].cache.init ??= new AsyncPromise(async () => {
                this.DATA ??= { id: this.id, label: this.id, path: this.path, remotePath: this._remotePath, isRemote: true };
                return this;
            });
        }
        const parentInit = Object.getOwnPropertyDescriptor($folder.prototype, 'init')?.get?.getter;
        return parentInit ? parentInit.call(this) : Promise.resolve(this);
    }

    /** Дочерние элементы для /NODES/<Узел> и смонтированных под ним узлов. */
    _children(recursive = true) {
        if (this.isRegistry)
            return super._children(recursive);
        return new AsyncPromise(async () => {
            if (this.isNodeRoot) {
                await this.init;
                if (this.DATA?.status !== 'active' || !this.DATA?.origin || !this.DATA?.host_id)
                    return [];
                const grants = Array.isArray(this.DATA?.remote?.grants) ? this.DATA.remote.grants : [];
                if (grants.length) {
                    const topChildren = [];
                    const seenTop = new Set();
                    for (const g of grants) {
                        const gp = normalizeRemotePath(g?.point || '/');
                        if (gp === '/') {
                            try {
                                const rootInfo = await callMountedRemote(this, '/', 'info', { deep: 1, as: g.role });
                                for (const it of rootInfo?.items || []) {
                                    if (!it?.id || it.id[0] === '$' || seenTop.has(it.id))
                                        continue;
                                    seenTop.add(it.id);
                                    topChildren.push(this._getMountedChild(it.id, it));
                                }
                            }
                            catch { /* ignore */ }
                            continue;
                        }
                        const segs = gp.split('/').filter(Boolean);
                        if (!segs.length)
                            continue;
                        this._ensureMountedChain(gp, { label: g.label || segs.at(-1), hasItems: true });
                        const firstSeg = segs[0];
                        if (!seenTop.has(firstSeg)) {
                            seenTop.add(firstSeg);
                            topChildren.push(this._getMountedChild(firstSeg));
                        }
                    }
                    return topChildren;
                }
                try {
                    const rootInfo = await callMountedRemote(this, '/', 'info', { deep: 1 });
                    return (rootInfo?.items || [])
                        .filter(it => it?.id && it.id[0] !== '$' && it.id[0] !== '.')
                        .map(it => this._getMountedChild(it.id, it));
                }
                catch {
                    return [];
                }
            }
            await this._syncRemote();
            const map = new Map();
            for (const ch of this._mountedItems || []) {
                if (ch?.id)
                    map.set(ch.id, ch);
            }
            for (const [id, ch] of Object.entries(this.__mounted__ || {})) {
                if (!map.has(id))
                    map.set(id, ch);
            }
            return [...map.values()];
        });
    }

    async _hasItems(list = 'items') {
        if (this.isRegistry)
            return super._hasItems(list);
        if (this.isNodeRoot) {
            await this.init;
            if (this.DATA?.status !== 'active')
                return false;
            return true;
        }
        if (this._isMountedRemote) {
            if (typeof this.DATA?.hasItems === 'boolean')
                return this.DATA.hasItems;
            if (this.__mounted__ && Object.keys(this.__mounted__).length > 0)
                return true;
            return this.type !== '$file';
        }
        return false;
    }

    async get_item(path = [], deep = 0, $tilde, params) {
        if (this.isRegistry)
            return super.get_item(path, deep, $tilde, params);
        const steps = this.constructor.parsePathSteps(path);
        const first = steps[0];
        if (!first) {
            if (this._isMountedRemote && !$tilde)
                await this._syncRemote(params);
            return super.get_item(steps, deep, $tilde, params);
        }
        if (first[0] === '~' || first[0] === '@' || first[0] === '*' || first === '.' || first === 'index.html' || first === '$node') {
            if (this._isMountedRemote)
                await this._syncRemote(params);
            return super.get_item(steps, deep, $tilde, params);
        }
        const seg = steps.shift();
        const child = this._getMountedChild(seg);
        if (!child)
            return null;
        if (!steps.length || steps[0]?.[0] === '~' || steps[0]?.[0] === '@')
            await child._syncRemote(params);
        if (!steps.length)
            return child;
        return child.get_item(steps, deep + 1, $tilde, params);
    }

    async canSee(item, params = {}) {
        if (this._isMountedRemote) {
            const roles = await resolveMountRoles(this.$nodeRoot, params);
            return roles.length > 0;
        }
        return super.canSee(item, params);
    }

    async canWrite(item, params = {}) {
        if (this._isMountedRemote) {
            const roles = await resolveMountRoles(this.$nodeRoot, params);
            return roles.length > 0;
        }
        return super.canWrite(item, params);
    }

    async allowAccess(params) {
        if (this._isMountedRemote)
            return this.canSee(this, params);
        return super.allowAccess(params);
    }

    async info(p = { deep: 0, reset: false }) {
        if (!this._isMountedRemote)
            return super.info(p);
        if (p.reset)
            this._remoteSyncedAt = 0;
        await this._syncRemote(p);
        const deep = +p.deep || 0;
        if (deep > 0) {
            try {
                const raw = await callMountedRemote(this.$nodeRoot, this._remotePath, 'info', p);
                if (raw && typeof raw === 'object') {
                    this._applyRemoteData(raw);
                    return rewriteRemoteInfo(raw, this.$nodeRoot.path, this._remotePath);
                }
            }
            catch {
                // fallback к каркасным детям из grants
            }
        }
        return super.info(p);
    }

    async load(params = {}) {
        if (this._isMountedRemote)
            return callMountedRemote(this.$nodeRoot, this._remotePath, 'load', params);
        return super.load(params);
    }

    async read_text(params = {}) {
        if (this._isMountedRemote)
            return callMountedRemote(this.$nodeRoot, this._remotePath, 'read_text', params);
        return super.read_text?.(params);
    }

    async readme_merged(params = {}) {
        if (this._isMountedRemote) {
            const res = await callMountedRemote(this.$nodeRoot, this._remotePath, 'readme_merged', params);
            if (res && typeof res === 'object' && res.path)
                return { ...res, path: addNodePrefix(res.path, this.$nodeRoot.path) };
            return res;
        }
        return super.readme_merged(params);
    }

    async logs(params = {}) {
        if (this._isMountedRemote) {
            const res = await callMountedRemote(this.$nodeRoot, this._remotePath, 'logs', params);
            return rewriteRemoteInfo(res, this.$nodeRoot.path, this._remotePath);
        }
        return super.logs(params);
    }

    async chatSource(params = {}) {
        if (this._isMountedRemote) {
            const res = await callMountedRemote(this.$nodeRoot, this._remotePath, 'chatSource', params);
            return typeof res === 'string' ? addNodePrefix(res, this.$nodeRoot.path) : this.path;
        }
        return super.chatSource(params);
    }

    async save_message(params = {}) {
        if (this._isMountedRemote)
            return callMountedRemote(this.$nodeRoot, this._remotePath, 'save_message', params, params.post);
        return super.save_message(params);
    }

    async search_tree(params = {}) {
        if (this._isMountedRemote) {
            const res = await callMountedRemote(this.$nodeRoot, this._remotePath, 'search_tree', params);
            if (res && typeof res === 'object') {
                const pref = this.$nodeRoot.path;
                return {
                    ...res,
                    files: (res.files || []).map(f => ({ ...f, path: addNodePrefix(f.path, pref) })),
                    nodes: (res.nodes || []).map(n => ({ ...n, path: addNodePrefix(n.path, pref) })),
                    objects: (res.objects || []).map(o => ({ ...o, cid: addNodePrefix(o.cid, pref) })),
                };
            }
            return res;
        }
        return super.search_tree(params);
    }

    /** Добавить узел сети в реестр (/NODES). */
    async node_add(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.ADMIN);
        await this._assertRegistry();
        const { addNode } = await import('../modules/nodes/registry.js');
        return addNode(this, params);
    }

    /** Граф сети для визуализации (/NODES). */
    async network_graph(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        const { networkGraph } = await import('../modules/nodes/registry.js');
        return networkGraph({ depth: params.depth });
    }

    /** Обновить карточку узла (/NODES/<узел>): роли и выданные нашему серверу точки (grants). */
    async node_refresh(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.ADMIN);
        await this._assertNode();
        const { refreshNode } = await import('../modules/nodes/registry.js');
        return refreshNode(this, params);
    }

    /** Прямой вызов метода на удалённом узле от имени представителя (/NODES/<узел>?remote). */
    async remote(params = {}, post) {
        await this._assertNode();
        const body = post && typeof post === 'object' && !Buffer.isBuffer(post) ? post : {};
        const as = String(params.as ?? body.as ?? '');
        const path = String(params.path ?? body.path ?? '/');
        const method = String(params.method ?? body.method ?? 'info');
        let args = params.args ?? body.args ?? {};
        if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = {}; }
        }
        const session = params.session;
        const uid = $class.resolveUid(params);
        if (!uid || session?.principal?.kind === 'node')
            throw new Error(ACCESS_DENIED);
        if (this.DATA.status !== 'active')
            throw new Error('Узел не активен: ' + (this.DATA.status || 'pending'));
        const declared = await this.declared_roles;
        if (!declared[as] || ['ADMIN', 'BOSS'].includes(as))
            throw new Error('Роль «' + as + '» не объявлена узлом');
        if (!this._roleIds(as, declared).includes(uid)) {
            const { audit } = await import('./access/audit.js');
            audit('deny', { path: this.path, method: 'remote', reason: 'not representative', as, params });
            throw new Error(ACCESS_DENIED);
        }
        const { nodeFetch } = await import('../modules/nodes/outbound.js');
        const { audit } = await import('./access/audit.js');
        audit('node_out', { node: this.principalId, as, path, method, params });
        return nodeFetch(this.DATA, {
            path, method, params: args, post: body.post,
            actor: uid, actorLabel: session?.$user?.label, roles: [as],
        });
    }
}

// Прозрачное проксирование всех методов учётного ядра (db_*) для смонтированных элементов /NODES/<Узел>/...
for (const [name, m] of Object.entries(DATA_METHODS)) {
    Object.defineProperty($node.prototype, name, {
        value: async function (params = {}) {
            if (this._isMountedRemote) {
                const post = params?.post ?? params?.body;
                const res = await callMountedRemote(this.$nodeRoot, this._remotePath, name, params, post);
                return rewriteRemoteDataResult(res, this.$nodeRoot.path);
            }
            return m.fn(this, params);
        },
        writable: true,
        configurable: true,
    });
}

$node.type_chain = Object.create(null);
