/**
 * $class — серверный класс узла структуры WORK (организация, подразделение, модуль,
 * справочник, операция, счёт, пользователь, модель ИИ, сервис, узел сети).
 *
 * Декомпозирован на тематические подмодули в `./class/`:
 *  - `scaffold.js`  — матрица вложенности типов (ALLOWED_CHILD_TYPES), скаффолдинг модулей и баз;
 *  - `script.js`    — сериализация, сравнение (diff) и разделение слоёв self/inherit для class.js;
 *  - `feed.js`      — лента событий и сообщения (logs, chatSource, save_message, append_log_includes);
 *  - `security.js`  — роли, доступ (canSee/canWrite/assertAccess), рабочие места (places/link_tree) и секреты;
 *  - `search.js`    — поиск по дереву, файлам и учётным объектам (search_tree).
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { FS } from './index.js';
import { $folder } from './folder.js';
import { assertClassId } from './assert-class-id.js';
import { safeNodeName } from './safe-node-name.js';
import * as POLICY from './access/policy.js';
import * as LINKS from './access/links.js';
import * as WORKPLACES from './access/workplaces.js';
import { DATA_METHODS, classHasObjects, classObjectCount, markClassesDirty } from '../data/api.js';
import { TRAINER_METHODS, localStreamChat } from '../modules/trainer/index.js';
import { DATA_TYPES } from '../data/classes.js';
import {
    looksLikeFileId,
    ALLOWED_CHILD_TYPES,
    readDeclaredChildTypesSync,
    extractStubClassJsSync,
    scaffoldModuleTreeSync,
    ensureBaseModulesDomainSync,
    parseModuleList,
    ensureModelField,
    parseCreateDevice,
    findChildWithModel,
} from './class/scaffold.js';
import { classScriptStatics } from './class/script.js';
import { classFeedMethods } from './class/feed.js';
import { classSecurityMethods } from './class/security.js';
import { classSearchMethods } from './class/search.js';
import { classArchiveMethods } from './class/archive.js';

export { looksLikeFileId, ALLOWED_CHILD_TYPES };

const ACCESS_DENIED = 'Доступ запрещён';

export class $class extends $folder {
    static sourceUrl = import.meta.url;
    static safeNodeName = safeNodeName;

    /** Базовые роли (прикладные объявляются в `ROLES` class.js, см. declared_roles). */
    static ROLES = { ADMIN: 'ADMIN', BOSS: 'BOSS', USER: 'USER', GUEST: 'GUEST' };

    /** @deprecated Зона = имя роли (папка роли в метапапке), вне зон — SYSTEM. См. access/policy.js. */
    static ZONES = { SYSTEM: 'SYSTEM', MANAGEMENT: 'BOSS', WORK: 'USER', GUESTS: 'GUEST' };

    /** @deprecated Зона роли = папка с именем роли. */
    static ZONES_MAP = {
        [$class.ROLES.ADMIN]: $class.ZONES.SYSTEM,
        [$class.ROLES.BOSS]: $class.ZONES.MANAGEMENT,
        [$class.ROLES.USER]: $class.ZONES.WORK,
        [$class.ROLES.GUEST]: $class.ZONES.GUESTS,
    };

    static POLICY = POLICY;

    /** Уровни доступа к методам. */
    static ACCESS_LEVEL = { READ: 'read', WRITE: 'write', ADMIN: 'ADMIN' };

    /** Проверить, что путь childPath находится внутри parentPath. */
    static isPathInside(childPath, parentPath) {
        if (!childPath || !parentPath) return false;
        if (childPath === parentPath) return true;
        return childPath.startsWith(parentPath + '/');
    }

    /** uid пользователя из params.session (сессия host). */
    static resolveUid(params = {}) {
        const session = params?.session;
        if (!session)
            return null;
        if (session.principal?.id)
            return session.principal.id;
        return typeof session.uid === 'string' && session.uid ? session.uid : null;
    }

    get $public() {
        return {
            get icon() {
                if (this.type === '$module')
                    return 'odant:module';
                if (this.type === '$domain' && this.id === 'MODULES')
                    return 'odant:folder';
                return this.DATA?.icon;
            },
            get isCustom() {
                return !WORK.types.includes(this.type);
            },
            get enabled() {
                if (this.type !== '$module')
                    return undefined;
                return this.DATA?.enabled !== false;
            },
            get localEnabled() {
                if (this.type !== '$module')
                    return undefined;
                return this.DATA?.localEnabled !== false;
            },
            get systemBlocked() {
                if (this.type !== '$module')
                    return undefined;
                return this.DATA?.systemBlocked === true;
            },
            get roleIds() {
                const out = {};
                for (const role of [$class.ROLES.ADMIN, $class.ROLES.BOSS, $class.ROLES.USER, $class.ROLES.GUEST])
                    out[role] = this._roleIds(role).filter(id => id !== 'GUEST');
                if (out.USER) {
                    const seen = new Set(out.USER);
                    for (const u of WORKPLACES.placeUserIds(this.DATA?.['#security']))
                        if (u !== 'GUEST' && !seen.has(u)) {
                            seen.add(u);
                            out.USER.push(u);
                        }
                }
                return out;
            },
            get hasSecurity() {
                const sec = this.DATA?.['#security'];
                if (!sec || typeof sec !== 'object')
                    return false;
                return Object.values(sec).some(v => Array.isArray(v) && v.length > 0);
            },
            get declaredRoles() {
                return this._declaredRolesSync();
            },
            get objectCount() {
                return this.DATA?.objectCount;
            },
        };
    }

    get size() {
        return this.meta_folder.size;
    }

    get METADATA() {
        return Object.assign({ FIELDS: [], STATIC: [] }, this.DATA?.METADATA || {});
    }

    /** Загрузить и объединить class.js класса из цепочки наследования. */
    async load(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        let files = await this.get_item('~/class.js');
        files = (files || []).filter(f => f.id === 'class.js');
        return $server.mergeFiles(files, params.reset);
    }

    /** Импортировать class.js класса как ES-модуль. */
    async import(params = {}) {
        const data = await this.load(params);
        return this.constructor.importScript(data);
    }

    async info(p = { deep: 0, reset: false }) {
        p.deep = +p.deep;
        if (p.reset)
            this.reset();
        await this.init;
        const cnt = await classObjectCount(this.path, this.type);
        if (this.DATA)
            this.DATA.objectCount = cnt > 0 ? cnt : undefined;
        if (this.type === '$module' && this.DATA) {
            const localEnabled = this._ownModuleEnabledSync();
            const sysBlocked = await this.isSystemModuleBlocked();
            this.DATA.localEnabled = localEnabled;
            this.DATA.systemBlocked = sysBlocked;
            this.DATA.enabled = localEnabled && !sysBlocked;
        }
        const arg = Object.assign({}, p);
        return super.info(arg);
    }

    get type_chain() {
        const type = this.type;
        return this.constructor.type_chain[type] ??= new AsyncPromise(async () => {
            const folder = await WORK.$folder.find_item(type, item => item.id?.[0] === '$' && item.id !== '$file');
            if (!folder)
                return [this.constructor.name, type];
            return folder.path.split('/').slice(3);
        });
    }

    get $distr_folder() {
        return new AsyncPromise(async () => {
            let folder = await this.$folder;
            for (const step of await this.type_chain) {
                folder = await folder._get_next_item(step, $folder);
                if (!folder)
                    break;
            }
            return folder;
        });
    }

    async loadMergedBaseline(tailSkip, files) {
        files ??= await this.get_item('~/class.js');
        files = files.slice(0, -tailSkip);
        if (!files.length)
            return {};
        const script = await $server.mergeFiles(files);
        return this.constructor.importScript(script);
    }

    /** Сохранить class.js этого класса (слои self/inherit). */
    async save(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.ADMIN);
        const { post } = params;

        const self_folder = this.meta_folder;
        const distributed_folder = await this.$distr_folder;

        const incoming = await this.constructor.importScript('export default ' + post);
        const [self_raw, inherit_raw] = this.constructor.separateInheritData(incoming);

        const dataJsFiles = await this.get_item('~/class.js');
        const baseSelf = await this.loadMergedBaseline(2, dataJsFiles);
        const baseInherit = await this.loadMergedBaseline(1, dataJsFiles);
        const self_data = this.constructor.pruneMeta(self_raw, baseSelf);
        const inherit_data = this.constructor.pruneMeta(inherit_raw, baseInherit);

        const self_to_save = this.constructor.getDifference(self_data, baseSelf);

        const fileParams = Object.assign({}, params, { filename: 'class.js' });
        const toDataScript = data => 'export default ' + this.constructor.toScript(data);

        const writes = [
            self_folder.save_file(Object.assign({}, fileParams, { post: toDataScript(self_to_save) })),
        ];
        const hasInherit = Array.isArray(inherit_data)
            ? inherit_data.length > 0
            : inherit_data && Object.keys(inherit_data).length > 0;
        if (hasInherit) {
            const dist_to_save = this.constructor.getDifference(inherit_data, baseInherit);
            const hasDistSave = Array.isArray(dist_to_save)
                ? dist_to_save.length > 0
                : dist_to_save && Object.keys(dist_to_save).length > 0;
            if (hasDistSave) {
                writes.push(distributed_folder.save_file(Object.assign({}, fileParams, {
                    post: toDataScript(dist_to_save),
                })));
            }
        }
        await Promise.all(writes);

        this.reset();
        this.DATA = await this.import();
        if (await this._isStructure())
            LINKS.reset();

        return true;
    }

    async save_file(params = {}) {
        if (params.filename === 'data.logs') {
            if (params.session && params.session.$user !== globalThis.WORK)
                throw new Error(ACCESS_DENIED);
            const folder = await this.meta_folder._get_next_item('logs', FS.$folder);
            return folder.save_data_file(params);
        }
        const storage = await this.work_zone(params);
        const folder = await storage.getFolderToSaveFile(params);
        return folder.save_file(params);
    }

    async get_write_stream(params) {
        const storage = await this.work_zone(params);
        const folder = await storage.getFolderToSaveFile(params);
        return folder.get_write_stream(params);
    }

    /** Ближайший модуль ($module), которому принадлежит этот узел (или сам узел, если он $module). */
    _enclosingModule() {
        for (let cur = this; cur; cur = cur.$parent) {
            if (cur instanceof $class && cur.type === '$module')
                return cur;
        }
        return null;
    }

    /** Собственный признак активности модуля из его локального $module/class.js (по умолчанию true). */
    _ownModuleEnabledSync() {
        const mod = this._enclosingModule();
        if (!mod)
            return true;
        const now = Date.now();
        if (mod._ownEnabledCache && now - mod._ownEnabledCache.ts < 1500)
            return mod._ownEnabledCache.val;
        let val = mod.DATA?.localEnabled !== false && mod.DATA?.blocked !== true;
        try {
            const ownFile = path.join(mod.real_dir, '$module', 'class.js');
            if (fs.existsSync(ownFile)) {
                const txt = fs.readFileSync(ownFile, 'utf-8');
                val = !(/\benabled\s*:\s*false\b/.test(txt) || /\bblocked\s*:\s*true\b/.test(txt));
            }
        }
        catch { /* ignore */ }
        mod._ownEnabledCache = { val, ts: now };
        return val;
    }

    /** Заблокирован ли одноимённый эталонный модуль на уровне всей системы WORK (/MODULES/<id>). */
    async isSystemModuleBlocked() {
        const mod = this._enclosingModule();
        if (!mod || !mod.id)
            return false;
        if (String(mod.path || '').startsWith('/MODULES/'))
            return false;
        const now = Date.now();
        if (mod._sysBlockedCache && now - mod._sysBlockedCache.ts < 1500)
            return mod._sysBlockedCache.val;
        const rootDir = globalThis.WORK?.real_dir || '.';
        const sysFile = path.join(rootDir, 'MODULES', mod.id, '$module', 'class.js');
        if (fs.existsSync(sysFile)) {
            try {
                const txt = fs.readFileSync(sysFile, 'utf-8');
                const val = /\benabled\s*:\s*false\b/.test(txt) || /\bblocked\s*:\s*true\b/.test(txt);
                mod._sysBlockedCache = { val, ts: now };
                return val;
            }
            catch { /* ignore */ }
        }
        try {
            const sysMod = await globalThis.WORK?.get_item('/MODULES/' + mod.id);
            if (sysMod) {
                await sysMod.init;
                if (!sysMod._ownModuleEnabledSync()) {
                    mod._sysBlockedCache = { val: true, ts: now };
                    return true;
                }
            }
        }
        catch { /* ignore */ }
        mod._sysBlockedCache = { val: false, ts: now };
        return false;
    }

    /** Заблокирован ли модуль (локально в базе или глобально на уровне WORK). */
    async isModuleBlocked() {
        const mod = this._enclosingModule();
        if (!mod)
            return false;
        if (!mod._ownModuleEnabledSync())
            return true;
        return mod.isSystemModuleBlocked();
    }

    /** Быстрое включение/блокировка модуля ($module) чек-боксом в дереве. */
    async set_enabled(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.ADMIN);
        if (this.type !== '$module')
            throw new Error('set_enabled: метод применим только к модулю ($module)');
        const nextEnabled = !(params.enabled === false || params.enabled === 'false' || params.enabled === 0 || params.enabled === '0');
        const ownFile = path.join(this.real_dir, '$module', 'class.js');
        let ownObj = {};
        if (fs.existsSync(ownFile)) {
            try {
                const raw = fs.readFileSync(ownFile, 'utf-8');
                ownObj = (await this.constructor.importScript(raw, this.path)) || {};
            }
            catch { ownObj = {}; }
        }
        if (!ownObj.label && this.DATA?.label)
            ownObj.label = this.DATA.label;
        delete ownObj.icon;
        delete ownObj.blocked;
        if (nextEnabled)
            delete ownObj.enabled;
        else
            ownObj.enabled = false;
        const post = 'export default ' + this.constructor.toScript(ownObj) + '\n';
        await this.meta_folder.save_file({
            ...params,
            role: $class.ROLES.ADMIN,
            filename: 'class.js',
            post,
            ignore_save_logs: true,
        });
        this._ownEnabledCache = null;
        this._sysBlockedCache = null;
        this.reset();
        await this.init;
        LINKS.reset();
        if (String(this.path || '').startsWith('/MODULES/')) {
            try {
                const orgsDom = await globalThis.WORK?.get_item('/ORGANIZATIONS');
                const orgs = (await orgsDom?.children) || [];
                for (const org of orgs) {
                    if (!org?.id || org.id[0] === '$')
                        continue;
                    const peer = await globalThis.WORK?.get_item(`${org.path}/MODULES/${this.id}`).catch(() => null);
                    if (peer) {
                        peer._ownEnabledCache = null;
                        peer._sysBlockedCache = null;
                        peer.reset();
                        await peer.init;
                    }
                }
            }
            catch { /* ignore */ }
        }
        const sysBlocked = await this.isSystemModuleBlocked();
        const localEnabled = this._ownModuleEnabledSync();
        const enabled = localEnabled && !sysBlocked;
        if (this.DATA) {
            this.DATA.localEnabled = localEnabled;
            this.DATA.systemBlocked = sysBlocked;
            this.DATA.enabled = enabled;
        }
        return { enabled, localEnabled, systemBlocked: sysBlocked };
    }

    get type() {
        return this.meta_folder.id;
    }

    get $folder() {
        return this.constructor.inherit(WORK.$folder, this.meta_folder);
    }

    /** Типы файлов данных класса: сам `$folder/$file/$data` и его подтипы. */
    get data_types() {
        return (async () => {
            const self = await this.meta_folder.get_item('$folder/$file/$data').catch(() => null);
            const list = await this.meta_folder.get_item('$folder/$file/$data/*');
            const all = [...(self ? [self] : []), ...(Array.isArray(list) ? list : [])];
            const types = all.filter(f => f && f.isType);
            await Promise.all(types.map(t => t.init));
            return types;
        })();
    }

    /** Расширение (или имя файла) — файл данных этого класса? */
    async is_data_type(extOrName) {
        const ext = FS.$file.fileExt(extOrName)
            || String(extOrName || '').replace(/^\$/, '').toLowerCase();
        if (!ext)
            return false;
        const types = await this.data_types;
        const id = '$' + ext;
        if ((types || []).some(t => t.id === id))
            return true;
        try {
            const td = await FS.$file.typeData(ext);
            return td?.point === true;
        }
        catch { return false; }
    }

    get meta_folder() {
        try {
            if (!fs.existsSync(this.real_dir))
                fs.mkdirSync(this.real_dir + '/' + this.constructor.name, { recursive: true });
            return FS.$folder.build(fs.readdirSync(this.real_dir).find(f => f[0] === '$'), this);
        }
        catch (e) {
            console.warn('[WORK] meta_folder:', e.message);
        }
    }

    get meta_file() {
        return new AsyncPromise(async () => {
            const folder = this.meta_folder;
            if (!folder)
                return null;
            const files = await folder.files;
            return (files || []).find(f => f.id === 'class.js') || null;
        });
    }

    get storage_folder() {
        return this.meta_folder;
    }

    get settings() {
        if (this.meta_folder) {
            const dir = this.meta_folder.dir + '/#system/settings.json';
            if (fs.existsSync(dir))
                return JSON.parse(fs.readFileSync(dir, { encoding: 'utf-8' }));
        }
        return null;
    }

    /** Допустимые типы дочерних классов внутри этого узла (кроме $file и $folder). */
    get allowed_child_types() {
        return Promise.resolve().then(() => {
            if (this === globalThis.WORK || this.constructor?.name === '$server' || this.type === '$server')
                return [...ALLOWED_CHILD_TYPES.$server];
            const myType = this.type;
            const declared = [];
            const add = list => {
                for (const t of list) {
                    if (t && !declared.includes(t))
                        declared.push(t);
                }
            };
            for (let p = this; p && p instanceof $class; p = p.$parent) {
                if (p !== this && p.type !== myType)
                    break;
                add(readDeclaredChildTypesSync(p.real_dir, p.type));
            }
            if (myType === '$domain' && !declared.length && this.id)
                add(readDeclaredChildTypesSync('./' + this.id, '$domain'));
            if (myType === '$domain') {
                return declared.length
                    ? [...new Set([...declared, '$domain'])]
                    : ['$domain', '$base', '$module', '$catalog', '$struct', '$operation', '$register'];
            }
            if (myType in ALLOWED_CHILD_TYPES)
                return [...new Set([...declared, ...ALLOWED_CHILD_TYPES[myType]])];
            if (myType === '$class')
                return declared.length ? declared : ['$class'];
            return declared.length ? declared : [myType];
        });
    }

    /** Создать дочерний класс (только допустимого внутри родителя типа). */
    async create(p = {}) {
        await this.assertAccess(p, $class.ACCESS_LEVEL.WRITE);
        const rawId = String(p.id ?? '').trim();
        const id = safeNodeName(rawId);
        if (!id)
            throw new Error('create: пустое имя узла после нормализации');
        if (looksLikeFileId(id))
            throw new Error('create создаёт только класс. Файл — save_file({ filename, post })');
        const allowed = await this.allowed_child_types;
        const parentType = (this === globalThis.WORK || this.constructor?.name === '$server') ? '$server' : this.type;
        let type = p.type;
        if (!type) {
            if (parentType === '$class')
                type = '$class';
            else if (allowed.length === 1)
                type = allowed[0];
            else {
                const primary = allowed.filter(t => t !== '$domain');
                if (primary.length === 1)
                    type = primary[0];
            }
        }
        if (!type)
            throw new Error(`create: укажите type для создания внутри ${this.path || '/'} (${parentType}); допустимы: ${allowed.join(', ') || 'нет'}`);
        if (type === '$file' || type === '$folder')
            throw new Error('create создаёт только класс. Файл — save_file; папки появляются при save_file');
        if (typeof type !== 'string' || type[0] !== '$' || type.length < 2)
            throw new Error('create: type должен быть типизатором с именем ($…)');
        if (type === '$class' && parentType !== '$class')
            throw new Error('create: $class — абстрактный базовый тип и не может находиться в дереве');
        if (!allowed.includes(type))
            throw new Error(`create: внутри ${this.path || '/'} (${parentType}) нельзя создать тип ${type}; допустимы: ${allowed.join(', ') || 'нет'}`);
        if (type === '$class')
            assertClassId(id);

        const inOrg = this.path === '/ORGANIZATIONS' || String(this.path || '').startsWith('/ORGANIZATIONS/');
        const srcModDir = (type === '$module' && inOrg) ? path.join('./MODULES', id) : '';
        const srcModClassFile = srcModDir ? path.join(srcModDir, '$module', 'class.js') : '';

        let post = p.post;
        if (post == null) {
            if (srcModClassFile && fs.existsSync(srcModClassFile)) {
                const customLabel = (p.label && p.label !== id && p.label !== rawId) ? p.label : '';
                post = extractStubClassJsSync(srcModClassFile, customLabel);
            }
            else {
                post = `export default {\n    label: '${p.label || id}'\n}`;
            }
        }
        if (type === '$ai' && rawId && rawId !== id) {
            const early = await parseCreateDevice(post, s => this.constructor.importScript(s));
            if (!early?.model)
                post = ensureModelField(post, rawId);
        }
        try {
            const script = /export\s+default/.test(String(post)) ? String(post) : ('export default ' + String(post));
            await this.constructor.importScript(script);
        }
        catch (e) {
            throw new Error('create: class.js не разбирается: ' + String(e.message || e).split('\n')[0]);
        }
        const device = await parseCreateDevice(post, s => this.constructor.importScript(s));
        const modelKey = device?.model != null && device.model !== '' ? String(device.model) : '';
        if (modelKey) {
            const dup = await findChildWithModel(this, modelKey);
            if (dup)
                throw new Error('create: model «' + modelKey + '» уже у ' + (dup.path || dup.id));
        }

        if (type === this.type && DATA_TYPES.includes(type) && await classHasObjects(this.path))
            throw new Error('create: у класса есть объекты — дочерний класс того же типа сделал бы его не листом');

        const ctor = FS[type] || FS.$class;
        const log = await this._createClass(id, type, ctor, post, p);
        const allowScaffold = p.scaffold !== false && p.scaffold !== 'false';
        if (allowScaffold && inOrg) {
            const targetDir = path.join(this.real_dir, id);
            if (type === '$module' && srcModDir && fs.existsSync(srcModDir)) {
                scaffoldModuleTreeSync(srcModDir, targetDir);
                const createdItem = await this._get_next_item(id, ctor);
                createdItem?.reset?.();
                this.reset();
            }
            else if (type === '$base') {
                ensureBaseModulesDomainSync(targetDir);
                for (const modId of parseModuleList(p.modules)) {
                    const modSrc = path.join('./MODULES', modId);
                    const modSrcClass = path.join(modSrc, '$module', 'class.js');
                    if (!fs.existsSync(modSrcClass))
                        continue;
                    const modDst = path.join(targetDir, 'MODULES', modId);
                    const modDstClass = path.join(modDst, '$module', 'class.js');
                    if (!fs.existsSync(modDstClass)) {
                        fs.mkdirSync(path.dirname(modDstClass), { recursive: true });
                        fs.writeFileSync(modDstClass, extractStubClassJsSync(modSrcClass, modId), 'utf-8');
                    }
                    scaffoldModuleTreeSync(modSrc, modDst);
                }
                const createdItem = await this._get_next_item(id, ctor);
                createdItem?.reset?.();
                this.reset();
            }
        }
        markClassesDirty();
        return log;
    }

    /** Физическое создание класса (внутренний метод). */
    async _createClass(id, type, ctor, post, p = {}) {
        const item = await this._get_next_item(id, ctor);
        const typeDir = item.real_dir + '/' + type;
        if (!fs.existsSync(typeDir))
            fs.mkdirSync(typeDir, { recursive: true });
        const strayClass = item.real_dir + '/$class';
        if (type !== '$class' && fs.existsSync(strayClass) && fs.readdirSync(strayClass).length === 0)
            fs.rmdirSync(strayClass);
        const meta = await item._get_next_item(type, FS.$folder);
        const log = await meta.save_file({
            ...p,
            filename: 'class.js',
            post,
            ignore_save_logs: true,
        });
        this.reset();
        return log;
    }

    /** Голосовой режим на уровне класса/подразделения/кабинета (до создания файла .task). */
    async voice_config(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        return (await WORK_AGENT_CORE()).voice.voiceConfig(this);
    }

    async dot_look(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        return (await WORK_AGENT_CORE()).voice.dotLook(this);
    }

    async voice_speak(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        const text = params.text ?? (typeof params.post === 'string' ? params.post : params.post?.text);
        return (await WORK_AGENT_CORE()).voice.speak(this, { text, language: params.language, instructions: params.instructions, uid: params.session?.principal?.id || params.session?.uid });
    }

    async voice_transcribe(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        const audio = Buffer.isBuffer(params.post) ? params.post : null;
        return (await WORK_AGENT_CORE()).voice.transcribe(this, { audio, language: params.language, uid: params.session?.principal?.id || params.session?.uid });
    }

    async voice_interim(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        const post = typeof params.post === 'string' ? (() => { try { return JSON.parse(params.post); } catch { return { text: params.post }; } })() : (params.post || {});
        const text = params.text ?? post.text ?? '';
        const pauseMs = Number(params.pauseMs ?? post.pauseMs ?? 0) || 0;
        return (await WORK_AGENT_CORE()).voice.checkInterim(this, { text, pauseMs, uid: params.session?.principal?.id || params.session?.uid });
    }
}

Object.assign($class, classScriptStatics);
Object.defineProperties($class.prototype, Object.getOwnPropertyDescriptors(classFeedMethods));
Object.defineProperties($class.prototype, Object.getOwnPropertyDescriptors(classSecurityMethods));
Object.defineProperties($class.prototype, Object.getOwnPropertyDescriptors(classSearchMethods));
Object.defineProperties($class.prototype, Object.getOwnPropertyDescriptors(classArchiveMethods));

$class.type_chain = Object.create(null);

// методы учётного ядра (db_create, db_query, db_journal, …): уровни — в шлюзе, права — внутри
for (const [name, m] of Object.entries(DATA_METHODS)) {
    Object.defineProperty($class.prototype, name, {
        value: function (params = {}) {
            return m.fn(this, params);
        },
        writable: true,
        configurable: true,
    });
}

// методы загрузки моделей Hugging Face и дообучения Unsloth (trainer_*)
for (const [name, m] of Object.entries(TRAINER_METHODS)) {
    Object.defineProperty($class.prototype, name, {
        value: function (params = {}) {
            return m.fn.call(this, params);
        },
        writable: true,
        configurable: true,
    });
}
Object.defineProperty($class.prototype, 'localStreamChat', {
    value: localStreamChat,
    writable: true,
    configurable: true,
});
