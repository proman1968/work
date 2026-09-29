import * as fs from "node:fs";
import fsp from "node:fs/promises";
import { $item } from '../core.js';
import * as mime from "mime-types";
import { FS } from './index.js';
import { $folder } from './folder.js';
import { assertClassId } from './assert-class-id.js';
import { safeNodeName } from './safe-node-name.js';
import * as LOGS from './logs.js';
import { DEV_MODE } from "../host/config.js";
import * as POLICY from './access/policy.js';
import * as REFS from './access/refs.js';

const ACCESS_DENIED = 'Доступ запрещён';

/** Кэш нормализованных ROLES по объекту DATA (DATA пересобирается при reset/init). */
const declaredRolesCache = new WeakMap();

/** id похож на имя файла (readme.md), а не на класс (MARKET, Exaone3.5 7.8b). */
export function looksLikeFileId(id) {
    const s = String(id ?? '').trim();
    if (!s || s[0] === '$')
        return false;
    // пробел — имя узла/класса; .8b и т.п. — не расширение файла
    if (/\s/.test(s))
        return false;
    return /\.[A-Za-z][A-Za-z0-9]{0,15}$/.test(s);
}

export class $class extends $folder{
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

    get $public(){
        return {
            get icon(){
                return this.DATA.icon;
            },
            get isCustom(){
                return !WORK.types.includes(this.type)
            }
        }
    }
    get size(){
        return this.meta_folder.size;
    }
    get METADATA(){
        return this.DATA.METADATA ?? {
            FIELDS: []
        }
    }
    static validateVarName(name) {
        const commonReservedWords = ['break','case','catch','continue','debugger','default','delete','do','else','finally','for','function','if','in','instanceof','new','return','switch','this','throw','try','typeof','var','void','while','with','class','const','export','extends','import','super','implements','interface','let','package','private','protected','public','static','yield','null','true','false','NaN','Infinity','undefined'];
        if (commonReservedWords.includes(name))
            return false;

        const allowedCharacters = new RegExp('^[\\p{L}_$][\\p{L}\\p{N}_$]*$', 'u');
        return allowedCharacters.test(name);
    }

    static _scriptSwitchValue(value, deep = 0, key){
        switch (value?.constructor?.name) {
            case 'AsyncFunction':
            case 'Function': {
                const space = '    ';
                const tab = space.repeat(deep);
                value = value.toString().replaceAll('\n  ', '\n')
                                        .replaceAll('\n', '\n' + tab);
                return value;
            }
            case 'Object': {
                value = this.toScript(value, deep + 1);
            } break;
            case 'String': {
                if (key === 'template')
                    value = '`' + value + '`';
                else
                    value = JSON.stringify(value);
            } break;
            case 'Array': {
                value = '[' + value.map(val => this._scriptSwitchValue(val, deep)) + ']';
            } break;
        }
        if (key){
           if(!this.validateVarName(key)){
                key = '"'+key+'"'
           }
           value = key + ': ' + value;
        }

        return value;
    }

    static toScript(json, deep = 1){
        const props = Object.getOwnPropertyDescriptors(json);
        const script = [];
        const space = '    ';
        const tab   = space.repeat(deep);
        const tab_1 = space.repeat(deep - 1);
        for (let key in props) {
            const prop = props[key];
            if (prop.get || prop.set) {
                if (prop.get) {
                    const get = prop.get.toString().replaceAll('\n  ', '\n')
                                                   .replaceAll('  ', space)
                                                   .replaceAll('\n', '\n' + tab);
                    script.push(tab + get);
                }
                if (prop.set) {
                    const set = prop.set.toString().replaceAll('\n  ', '\n')
                                                   .replaceAll('  ', space)
                                                   .replaceAll('\n', '\n' + tab);
                    script.push(tab + set);
                }
            }
            else {
                const val = this._scriptSwitchValue(prop.value, deep, key);
                script.push(tab + val)
            }
        }
        return '{\n' + script.join(',\n') + '\n' + tab_1 + '}';
    }

    static _isNonemptyDiff(val) {
        if (val == null)
            return false;
        if (Array.isArray(val))
            return val.length > 0;
        if (typeof val === 'object')
            return Object.keys(val).length > 0;
        return true;
    }

    static _differenceSwitchValue(myval, oldval){
        switch (myval?.constructor.name) {
            case 'Object': {
                const newval = this.getDifference(myval, oldval);
                if (newval && (Object.keys(newval).length > 0) && myval.id) {
                    newval.id = myval.id;
                }
                return newval;
            } break;
            case 'Array': {
                if (!Array.isArray(oldval)) {
                    return myval;
                }
                else {
                    const newVals = [];
                    if (myval[0]?.id || myval[0]?.id === 0) {
                        myval.forEach(my => {
                            const old = oldval.find(e => e.id === my.id);
                            if (!old) {
                                newVals.push(my);
                            }
                            else {
                                const part = this._differenceSwitchValue(my, old);
                                if (this._isNonemptyDiff(part))
                                    newVals.push(part);
                            }
                        });
                    }
                    else {
                        myval.forEach((my, i) => {
                            if (i > oldval.length) {
                                newVals.push(my);
                            }
                            else {
                                const old = oldval[i];
                                const part = this._differenceSwitchValue(my, old);
                                if (this._isNonemptyDiff(part))
                                    newVals.push(part);
                            }
                        });
                    }
                    return newVals;
                }

            } break;
            default: {
                return myval
            }
        }
    }

    static getDifference(value, old = {}) {
        if (!old)
            return value;
        let myprops = Object.getOwnPropertyDescriptors(value);
        let oldprops = Object.getOwnPropertyDescriptors(old);
        let result = {}
        for (let key in myprops) {
            let oldprop = oldprops[key];
            let myprop = myprops[key];
            if (!oldprop) {
                Object.defineProperty(result, key, myprop);
            }
            else if ('value' in myprop) {
                if ((myprop.value?.constructor.name === 'Object') || (myprop.value?.constructor.name === 'Array')) {
                    if (this._trimFunc(this.toScript(myprop.value)) !== this._trimFunc(this.toScript(oldprop.value))) {
                        result[key] = this._differenceSwitchValue(myprop.value, oldprop.value);
                    }
                }
                else if (this._trimFunc(myprop.value?.toString()) !== this._trimFunc(oldprop.value?.toString())) {
                    result[key] = this._differenceSwitchValue(myprop.value, oldprop.value);
                }
            }
            else if (this._trimFunc(myprop.get?.toString()) != this._trimFunc(oldprop?.get?.toString()) || this._trimFunc(myprop.set?.toString()) != this._trimFunc(oldprop?.set?.toString())) {
                Object.defineProperty(result, key, myprop);
            }
        }
        return result;
    }

    static _trimFunc(text){
        return text?.split('\n').map(s=>s.trim()).join('\n');
    }
    static separateInheritData(data) {
        if (Array.isArray(data)) {
            const selfData = [];
            const inheritData = [];
            let hasInherit = false;
            for (const item of data) {
                if (item?.to_inherit === false) {
                    selfData.push(item);
                    continue;
                }
                const [selfItem, inheritItem, itemHasInherit] = this.separateInheritData(item);
                if (item?.to_inherit === true) {
                    inheritData.push(item);
                    hasInherit = true;
                }
                else if (itemHasInherit && inheritItem != null) {
                    if (Array.isArray(inheritItem) ? inheritItem.length
                        : (inheritItem && typeof inheritItem === 'object' && Object.keys(inheritItem).length)) {
                        const packed = item?.id != null && typeof inheritItem === 'object' && !Array.isArray(inheritItem)
                            ? Object.assign({ id: item.id }, inheritItem)
                            : inheritItem;
                        inheritData.push(packed);
                        hasInherit = true;
                    }
                }
                if (item?.to_inherit !== true && selfItem != null) {
                    if (Array.isArray(selfItem) ? selfItem.length
                        : (selfItem && (typeof selfItem !== 'object' || Object.keys(selfItem).length))) {
                        selfData.push(selfItem);
                    }
                }
            }
            return [selfData, inheritData, hasInherit];
        }
        if (data && typeof data === 'object') {
            const selfData = {};
            const inheritData = {};
            let hasInherit = false;
            for (const key of Object.keys(data)) {
                const desc = Object.getOwnPropertyDescriptor(data, key);
                if (desc.get || desc.set) {
                    Object.defineProperty(selfData, key, desc);
                    continue;
                }
                const value = desc.value;
                if (value?.to_inherit === false) {
                    selfData[key] = value;
                    continue;
                }
                const [selfValue, inheritValue, valueHasInherit] = this.separateInheritData(value);
                if (value?.to_inherit === true) {
                    inheritData[key] = value;
                    hasInherit = true;
                }
                else if (valueHasInherit && inheritValue != null) {
                    if (Array.isArray(inheritValue) ? inheritValue.length
                        : (inheritValue && typeof inheritValue === 'object' && Object.keys(inheritValue).length)) {
                        inheritData[key] = inheritValue;
                        hasInherit = true;
                    }
                }
                if (value?.to_inherit !== true && selfValue != null) {
                    if (Array.isArray(selfValue) ? selfValue.length
                        : (typeof selfValue !== 'object' || Object.keys(selfValue).length)) {
                        selfData[key] = selfValue;
                    }
                }
            }
            return [selfData, inheritData, hasInherit];
        }
        return [data, null, false];
    }

    /**
     * Загрузить и объединить class.js класса из цепочки наследования.
     * @param {object} [params]
     * @param {boolean} [params.reset] Сбросить кэш перед загрузкой
     * @returns {Promise<object>} Объединённый объект class.js
     */
    async load(params = {}){
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        let files = await this.tilde;
        files = files.filter(f=>f.id === 'class.js');
        return $server.mergeFiles(files, params.reset);
    }
    /**
     * Импортировать class.js класса как ES-модуль.
     * @param {object} [params]
     * @returns {Promise<*>} Экспорт class.js (default)
     */
    async import(params = {}){
        let data = await this.load(params)
        return this.constructor.importScript(data);
    }
    async info(p = {deep: 0, reset: false}){
        p.deep = +p.deep;
        if (p.reset)
            this.reset();
        await this.init; // после get_item уже собран (кэш) — чтение чистое
        const arg = Object.assign({}, p)
        return super.info(arg);
    }
    get type_chain(){
        let type = this.type;
        return this.constructor.type_chain[type] ??= new AsyncPromise(async ()=>{
            let folder = await WORK.$folder.find_item(type, item => item.id?.[0] === '$' && item.id !== '$file');
            if(!folder)
                return [this.constructor.name, type];
            return folder.path.split('/').slice(3);
        })
    }
    get $distr_folder(){
        return new AsyncPromise(async ()=>{
            let folder = await this.$folder;
            for (const step of await this.type_chain) {
                folder = await folder._get_next_item(step, $folder);
                if (!folder)
                    break;
            }
            return folder;
        })
    }

    /** uid пользователя из params.session (сессия host). */
    static resolveUid(params = {}) {
        const session = params?.session;
        if (!session)
            return null;
        // Субъект сессии задаётся только после проверки (signIn / подпись узла);
        // внутренние сессии ядра ({uid}, {uid, $user}) — по uid
        if (session.principal?.id)
            return session.principal.id;
        return typeof session.uid === 'string' && session.uid ? session.uid : null;
    }

    /**
     * Объявленные роли точки: базовые (ADMIN, BOSS, USER, GUEST) + `ROLES` из class.js,
     * собранного по `~` (прикладные роли — в слое своего типа или класса).
     * @returns {Promise<Record<string, {id, key, label, scope, feed, write}>>}
     */
    get declared_roles() {
        return Promise.resolve(this.init).then(() => this._declaredRolesSync());
    }

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
    }

    /** uid, назначенные роли локально в #security (поле key роли; для прикладных — ещё и по id роли). */
    _roleIds(roleId, declared = this._declaredRolesSync()) {
        const security = this.DATA?.['#security'];
        const decl = declared[roleId];
        if (!security || !decl)
            return [];
        const ids = [];
        for (const key of new Set([decl.key, roleId])) {
            const list = security[key];
            if (Array.isArray(list))
                ids.push(...list.filter(v => typeof v === 'string'));
        }
        return ids;
    }

    /** На классе назначен хотя бы один пользователь (любая роль). */
    hasAssignments() {
        const declared = this._declaredRolesSync();
        return Object.keys(declared).some(id => this._roleIds(id, declared).length > 0);
    }

    /**
     * Получить список ролей текущего пользователя в классе.
     * Роли со scope=subtree (ADMIN, BOSS) наследуются от вышестоящих классов,
     * остальные — только локальные назначения.
     * @param {object} [params]
     * @param {object} [params.session] Объект пользователя из сессии
     * @returns {Promise<string[]>} Роли по убыванию силы: 'ADMIN', 'BOSS', 'USER', 'GUEST', прикладные
     */
    async roles(params = {}) {
        const uid = $class.resolveUid(params);
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
            if (declared[id].scope !== 'subtree')
                continue;
            for (let p = this.$parent; p; p = p.$parent) {
                if (!(p instanceof $class))
                    continue;
                await p.init;
                const pd = p._declaredRolesSync();
                if (pd[id] && p._roleIds(id, pd).includes(uid)) {
                    roles.push(id);
                    break;
                }
            }
        }
        // субъект-узел сети: только роли, допускающие узлы, и только заявленные его представителем
        const principal = params.session?.principal;
        if (principal?.kind === 'node') {
            const claimed = principal.roles?.length ? new Set(principal.roles) : null;
            return POLICY.orderRoles(roles.filter(r =>
                (declared[r]?.principals || []).includes('node') && (!claimed || claimed.has(r))), declared);
        }
        return POLICY.orderRoles(roles, declared);
    }

    /** Идентификатор субъекта, которым является этот класс ($user — uid, $node — id сервера). */
    get principalId() {
        return this.id;
    }

    /** Роль назначена пользователю в этой точке (а не унаследована сверху). */
    async hasLocalRole(params = {}, role = params.role) {
        const uid = $class.resolveUid(params);
        if (!uid || !role)
            return false;
        await this.init;
        return this._roleIds(role).includes(uid);
    }

    /**
     * Рабочая зона роли — папка в метапапке, куда save_file пишет файлы этой роли.
     * Имя папки = params.role || 'GUEST' (ADMIN | BOSS | USER | GUEST | прикладная роль).
     */
    async work_zone(params = {}){
        const role = params.role || 'GUEST';
        if (!POLICY.isRoleId(role))
            throw new Error('work_zone: недопустимое имя роли «' + role + '»');
        return this.meta_folder._get_next_item(role, FS.$folder);
    }
    /** @deprecated используй work_zone */
    get_storage(params){
        return this.work_zone(params);
    }

    /**
     * Источник логов чата для текущей роли пользователя.
     * Приоритет: params.role (выбранная в UI) → фактические роли.
     * feed=point (ADMIN, BOSS) → лента текущего класса (следы всех пользователей точки);
     * feed=own (USER, прикладные) → своя лента в личном кабинете;
     * GUEST — лента класса (кабинета может не быть), записи фильтруются до своих.
     */
    async chatSource(params = {}) {
        const uid = $class.resolveUid(params);
        const declared = await this.declared_roles;
        // кабинет субъекта: пользователь — /USERS//uid, узел сети — его класс в /NODES
        const own = params.session?.principal?.kind === 'node'
            ? params.session.$user?.path
            : (uid ? '/USERS//' + uid : null);
        const viaRole = role => {
            if (role === $class.ROLES.GUEST || declared[role]?.feed === 'point')
                return this.path;
            return own || this.path;
        };
        // Явно выбранная роль в UI имеет приоритет
        if (params.role && declared[params.role])
            return viaRole(params.role);
        // Fallback: без role — по фактическим ролям
        const roles = await this.roles(params);
        if (roles.some(r => r === $class.ROLES.GUEST || declared[r]?.feed === 'point'))
            return this.path;
        return own || this.path;
    }
    /**
     * Элемент-источник логов для текущей роли (this или $user).
     * USER → личный кабинет, ADMIN/BOSS → текущий класс.
     */
    async _logSource(params = {}) {
        const path = await this.chatSource(params);
        if (path === this.path)
            return this;
        return globalThis.WORK.get_item(path);
    }
    async loadMergedBaseline(tailSkip, files) {
        files ??= await this.get_item('~/class.js');
        files = files.slice(0, -tailSkip);
        if (!files.length)
            return {};
        const script = await $server.mergeFiles(files);
        return this.constructor.importScript(script);
    }
    /**
     * Сохранить class.js этого класса (слои self/inherit).
     * Не путать с save_file (файл в зоне роли) и save_message (лог без файла).
     * @param {object} [params]
     * @param {string} params.post Строка class.js (export default {...})
     * @returns {Promise<boolean>} true при успешном сохранении
     */
    async save(params = {}){
        await this.assertAccess(params, $class.ACCESS_LEVEL.ADMIN);
        let { post } = params;

        const self_folder = this.meta_folder;
        const distributed_folder = await this.$distr_folder;

        const incoming = await this.constructor.importScript('export default ' + post);
        const [self_data, inherit_data] = this.constructor.separateInheritData(incoming);

        const dataJsFiles = await this.get_item('~/class.js');
        const self_to_save = this.constructor.getDifference(
            self_data,
            await this.loadMergedBaseline(2, dataJsFiles)
        );

        const fileParams = Object.assign({}, params, { filename: 'class.js' });
        const toDataScript = data => 'export default ' + this.constructor.toScript(data);

        const writes = [
            self_folder.save_file(Object.assign({}, fileParams, { post: toDataScript(self_to_save) })),
        ];
        const hasInherit = Array.isArray(inherit_data)
            ? inherit_data.length > 0
            : inherit_data && Object.keys(inherit_data).length > 0;
        if (hasInherit) {
            const dist_to_save = this.constructor.getDifference(
                inherit_data,
                await this.loadMergedBaseline(1, dataJsFiles)
            );
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

        return true;
    }
    async save_file(params = {}){
        // Лента — системная операция: всегда запись дня `<мета>/logs/ГГГГ-ММ-ДД/{время}.{автор}.logs`
        // (одна запись — один файл: права, RAG и индекс лент работают по записям),
        // независимо от того, объявлен ли тип $data/$logs в дереве.
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
    get type(){
        return this.meta_folder.id;
    }
    get $folder(){
        return this.constructor.inherit(WORK.$folder, this.meta_folder);
    }

    /**
     * Типы файлов данных класса: дети `$folder/$file/$data` (через children, не inherit_children).
     * Builder и save_file смотрят сюда, не в глобальный `$file.isDataFile`.
     */
    get data_types() {
        return this.meta_folder.get_item('$folder/$file/$data/*')
            .then(async list => {
                const types = (Array.isArray(list) ? list : []).filter(f => f.isType);
                await Promise.all(types.map(t => t.init));
                return types;
            });
    }

    /** Расширение (или имя файла) — файл данных этого класса? */
    async is_data_type(extOrName) {
        const ext = FS.$file.fileExt(extOrName)
            || String(extOrName || '').replace(/^\$/, '').toLowerCase();
        if (!ext)
            return false;
        const types = await this.data_types;
        const id = '$' + ext;
        return (types || []).some(t => t.id === id);
    }

    get meta_folder(){
        try{
            if(!fs.existsSync(this.real_dir)){
                fs.mkdirSync(this.real_dir + '/' + this.constructor.name, {recursive: true});
            }
            return FS.$folder.build(fs.readdirSync(this.real_dir).find(f=>f[0] === '$'), this);
        }
        catch (e) {
            console.warn('[WORK] meta_folder:', e.message);
        }
    }

    get meta_file(){
        return new AsyncPromise(async () => {
            const folder = this.meta_folder;
            if (!folder)
                return null;
            const files = await folder.files;
            return (files || []).find(f => f.id === 'class.js') || null;
        });
    }
    get storage_folder(){
        return this.meta_folder;
    }
    /** @deprecated используй logs({ mode: 'dates' }) */
    async logs_dates(params = {}){
        return this.logs({ ...params, mode: 'dates' });
    }
    /** @deprecated используй logs({ mode: 'files', day }) — здесь сырой список без сортировки */
    async log_files(day, params = {}){
        const source = await this._logSource(params);
        if (source !== this)
            return source.log_files(day, params);
        return LOGS.dayFiles(this, day);
    }

    /**
     * Тела записей логов за день или диапазон дат.
     * @param {object} [dayOrParams]
     * @param {string} [dayOrParams.day] Дата YYYY-MM-DD
     * @param {string} [dayOrParams.from] Начало диапазона
     * @param {string} [dayOrParams.to] Конец диапазона
     * @param {string|Array} [dayOrParams.ext] Фильтр по расширению
     * @returns {Promise<Array>} Массив записей логов с содержимым
     */
    async read_log_bodies(dayOrParams = {}){
        const params = typeof dayOrParams === 'string' ? { day: dayOrParams } : dayOrParams;
        const ownOnly = await this._feedOwnOnly(params);
        const rows = await LOGS.loadBodies(this, LOGS.normalizeQuery(params));
        return ownOnly ? rows.filter(r => POLICY.isOwnLogRow(r, ownOnly)) : rows;
    }

    /**
     * Актуальная JSON-запись лога по path history-файла (для микрочата ai.task).
     * @param {object} [params]
     * @param {string} [params.path] Путь записи (history-файла)
     * @param {string} [params.taskPath] Альтернативное имя параметра пути
     * @param {string} [params.entryPath] Альтернативное имя параметра пути
     * @returns {Promise<object|null>} Запись лога или null
     */
    async read_log_entry(params = {}) {
        const row = await LOGS.findEntry(this, params.taskPath || params.path || params.entryPath);
        const ownOnly = row && await this._feedOwnOnly(params);
        return ownOnly && !POLICY.isOwnLogRow(row, ownOnly) ? null : row;
    }

    /**
     * Право писать в ленту точки (сообщение, поручение, отчёт): это не изменение системы,
     * а запись в траекторию — доступно любой назначенной в точке роли и владельцу кабинета.
     */
    async _assertCanPost(params = {}) {
        if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
            return;
        const uid = $class.resolveUid(params);
        if (!uid)
            throw new Error(ACCESS_DENIED);
        const node = params.session.principal?.kind === 'node';
        if (!node && this.id === uid)
            return;
        if (globalThis.WORK && !node && await this._isWorkAdmin(params))
            return;
        if ((await this.roles(params)).length)
            return;
        throw new Error(ACCESS_DENIED);
    }

    /**
     * Чистая лог-запись (сообщение) без физического файла.
     * @param {object} [params]
     * @param {string} [params.message] Текст сообщения → content
     * @param {Array<string>} [params.includes] Пути вложенных файлов (history)
     * @param {string|Array} [params.receivers] Получатели
     * @returns {Promise<object>} Запись лога
     */
    async save_message(params = {}) {
        await this._assertCanPost(params);
        const time = Date.now();
        const row = { time };
        // автор — только из проверенной сессии; явный sender — лишь для внутренних вызовов ядра
        const internal = !params.session || params.session.$user === globalThis.WORK;
        const uid = $class.resolveUid(params);
        if (uid)
            row.sender = uid;
        else if (internal && params.sender)
            row.sender = String(params.sender);
        else if (params.session?.$user === globalThis.WORK)
            row.sender = WORK.id;
        const principal = params.session?.principal;
        if (principal?.actor) {
            row.actor = principal.actor;
            if (principal.actorLabel)
                row.actorLabel = principal.actorLabel;
        }
        if (params.message != null)
            row.content = params.message;
        const includes = LOGS.normalizeIncludes(params.includes);
        await LOGS.assertIncludesVisible(includes, params);
        if (includes.length)
            row.includes = includes;
        if (typeof params.receivers === 'string')
            row.receivers = params.receivers.split(',').map(s => s.trim()).filter(Boolean);
        else if (Array.isArray(params.receivers))
            row.receivers = params.receivers.slice();
        if (params.mainContext)
            row.mainContext = params.mainContext;
        // поручения: вид записи, срок, ответ на запись (контроль исполнения по ленте)
        if (['message', 'order', 'done', 'reject', 'remind'].includes(params.kind))
            row.kind = params.kind;
        if (params.due && /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/.test(String(params.due)))
            row.due = String(params.due);
        // ссылка на запись: id вида «автор:время» (см. row.id) или WORK-путь
        if (typeof params.reply_to === 'string' && (/^[\w.@-]{1,80}:\d{10,16}$/.test(params.reply_to) || /^\/[^\0]{1,1000}$/.test(params.reply_to)))
            row.reply_to = params.reply_to;
        await LOGS.appendRow(this, row, params);
        return { ...row, id: (row.sender || 'system') + ':' + row.time };
    }

    /**
     * Добавить пути в includes записи лога (например, шаги ai.task).
     * @param {object} params
     * @param {string} params.entryPath Путь записи лога (history-файла)
     * @param {Array|string} params.includePaths Пути для добавления в includes
     * @returns {Promise<object|null>} Обновлённая запись или null
     */
    async append_log_includes(params = {}) {
        return LOGS.appendIncludes(this, params.entryPath, params.includePaths, { session: params.session });
    }

    /** @deprecated используй append_log_includes({ entryPath, includePaths }) */
    async appendLogIncludes(entryPath, includePaths = [], params = {}) {
        if (entryPath && typeof entryPath === 'object' && entryPath.entryPath) {
            params = includePaths?.session ? includePaths : (params?.session ? params : {});
            includePaths = entryPath.includePaths;
            entryPath = entryPath.entryPath;
        }
        return this.append_log_includes({ entryPath, includePaths, session: params.session });
    }

    /** @deprecated используй logs({ mode: 'index' }) */
    async log_index(params = {}){
        return this.logs({ ...params, mode: 'index' });
    }

    /**
     * Универсальный доступ к логам класса — единая точка чтения.
     * @param {object} [params]
     * @param {string} [params.mode] folder — папка дня (default) | bodies — тела записей | index — лёгкий индекс без content | files — .logs файлы | dates — список дат с логами
     * @param {string} [params.day] Дата YYYY-MM-DD
     * @param {string} [params.from] Начало диапазона
     * @param {string} [params.to] Конец диапазона
     * @param {string|Array} [params.ext] Фильтр по расширению записей
     * @param {boolean} [params.flat] Для index: плоский список вместо агрегатов по дням
     * @returns {Promise<*>} Зависит от mode
     */
    async logs(params = {}){
        const source = await this._logSource(params);
        if (source !== this)
            return source.logs(params);
        const ownOnly = await this._feedOwnOnly(params);
        params = LOGS.normalizeQuery(params);
        const bodies = async () => {
            const rows = await LOGS.loadBodies(this, params);
            return ownOnly ? rows.filter(r => POLICY.isOwnLogRow(r, ownOnly)) : rows;
        };
        switch (params.mode || 'folder') {
            case 'dates':
                return LOGS.datesList(this);
            case 'bodies':
                return bodies();
            case 'index':
                return LOGS.buildIndex(await bodies(), params);
            case 'files':
                return this.sortItems(await LOGS.filesForDays(this, params), true, false);
            case 'folder':
            default:
                return LOGS.dayFolder(this, params.day || LOGS.resolveDays(params)[0]);
        }
    }
    /**
     * uid, если вызывающему видна только своя часть ленты точки (feed=own), иначе null.
     * Лента точки целиком — роли с feed=point / scope=subtree, WORK ADMIN, владелец кабинета.
     */
    async _feedOwnOnly(params = {}) {
        if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
            return null;
        const uid = $class.resolveUid(params);
        if (!uid || this.id === uid)
            return null;
        if (globalThis.WORK && await this._isWorkAdmin(params))
            return null;
        const declared = await this.declared_roles;
        const roles = await this.roles(params);
        const full = roles.some(r => declared[r]?.feed === 'point' || declared[r]?.scope === 'subtree');
        return full ? null : uid;
    }
    get settings(){
        if(this.meta_folder){
            let dir = this.meta_folder.dir + '/#system/settings.json';
            if(fs.existsSync(dir)){
                let data = fs.readFileSync(dir, {encoding: 'utf-8'});
                data = JSON.parse(data)
                return data;
            }
        }
        return null;
    }

    _secretPath(filename){
        if (!this.meta_folder || !filename)
            return null;
        return this.meta_folder.dir + '/#secret/' + filename;
    }

    /** Legacy: секреты раньше лежали в #system/. */
    _legacySecretPath(filename){
        if (!this.meta_folder || !filename)
            return null;
        return this.meta_folder.dir + '/#system/' + filename;
    }

    /**
     * Область элемента внутри этой точки (access/policy.js):
     * зона роли | лента (logs) | секреты | система | элемент вложенного класса.
     * Считается по виртуальному пути, поэтому для унаследованных по `~` файлов
     * результат тот же, что для собственных.
     * @param {object} item Элемент или дескриптор `{path, $class?}`
     * @returns {{kind: string, role?: string}}
     */
    areaOf(item) {
        if (!item || typeof item !== 'object' || item === this)
            return { kind: POLICY.AREA.SYSTEM };
        const itemClass = item.$class ?? item.$owner;
        if (itemClass && itemClass !== this && itemClass.path !== this.path)
            return { kind: POLICY.AREA.NESTED };
        return POLICY.areaOfPath(item.path, this.path, Object.keys(this._declaredRolesSync()));
    }

    /**
     * Зона элемента: имя роли для зоны, иначе SYSTEM | LOGS | SECRET | NESTED.
     */
    resolveZone(item) {
        if (!item || typeof item !== 'object')
            return null;
        const area = this.areaOf(item);
        return area.kind === POLICY.AREA.ZONE ? area.role : area.kind.toUpperCase();
    }

    /** Для ленты точки при feed=own: папки ленты видны (листинг), записи — только свои. */
    _logOwnership(item, uid) {
        // дескриптор из RAG: {path, $class, descriptor: true, logRow}
        if (item?.descriptor)
            return { ownEntry: POLICY.isOwnLogRow(item.logRow, uid) };
        if (!(item instanceof FS.$file))
            return { logsContainer: true };
        try {
            const row = JSON.parse(fs.readFileSync(item.real_dir, 'utf-8'));
            return { ownEntry: POLICY.isOwnLogRow(row, uid) };
        }
        catch {
            return { ownEntry: false };
        }
    }

    /** Видимость по ролям пользователя в этой точке (без ленты). */
    _readableByRoles(item, roles, uid) {
        if (!roles?.length)
            return false;
        const declared = this._declaredRolesSync();
        const area = this.areaOf(item);
        const opts = area.kind === POLICY.AREA.LOGS ? this._logOwnership(item, uid) : {};
        return roles.some(r => POLICY.canRead(declared[r], area, opts));
    }

    /**
     * Видимость элемента (чтение).
     * scope=subtree (ADMIN, BOSS) — всё от точки назначения вниз (секреты — только ADMIN);
     * остальные роли — система точки + своя зона (собственная и унаследованная по `~`);
     * лента точки — роли с feed=point, остальным — только свои записи;
     * плюс всё, на что указывают записи собственной ленты пользователя (receivers).
     */
    async canSee(item, params = {}) {
        if (DEV_MODE) return true;
        const users = this.DATA['#security']?.USERS;
        if (Array.isArray(users) && users.includes('GUEST')) return true;

        if (!item || typeof item !== 'object') return true; // ???

        const uid = $class.resolveUid(params);
        if (!uid) {
            return this._isSystemPath(item);
        }
        if (params.session?.principal?.kind === 'node') {
            // узел сети в своём классе реестра видит только свою ленту (отношения с нами),
            // а не наши внутренние зоны и назначения представителей
            if (this.principalId === uid)
                return item === this || this.areaOf(item).kind === POLICY.AREA.LOGS;
        }
        else if (this.id === uid) return true;
        // WORK ADMIN видит всё
        if (globalThis.WORK && await this._isWorkAdmin(params))
            return true;
        // Системные элементы видны всем
        if (this._isSystemItem(item))
            return true;
        const roles = await this.roles(params);
        // Класс без назначений — pass-through к родителю
        if (!this.hasAssignments() && !roles.length) {
            const parent = this.$parent;
            if (parent && await parent.canSee(item, params))
                return true;
            return this._visibleViaFeed(uid, item);
        }
        if (this._readableByRoles(item, roles, uid))
            return true;
        return this._visibleViaFeed(uid, item);
    }

    /** Показано пользователю записью в его ленте (path/includes). */
    async _visibleViaFeed(uid, item) {
        try {
            return await REFS.visible(uid, item?.path);
        }
        catch {
            return false;
        }
    }

    /**
     * Право записи (требует params.role).
     * write=all (ADMIN) — всё от точки назначения вниз;
     * остальные — только своя зона и только там, где роль назначена локально
     * (в любом слое своей метапапки: `ROLE/`, `$folder/ROLE/`, `$folder/$class/$type/ROLE/` —
     * выбор слоя определяет, куда провалится файл по наследованию).
     */
    async canWrite(item, params = {}) {
        if (DEV_MODE) return true;
        if (!item || typeof item !== 'object') return false;
        const uid = $class.resolveUid(params);
        if (!uid) return false;
        if (this.id === uid && params.session?.principal?.kind !== 'node') return true;
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
        return POLICY.canWrite(declared[role], this.areaOf(item), {
            local,
            executable: POLICY.isExecutablePath(item.path, this.path),
        });
    }

    /**
     * Единая проверка доступа (бросает при отказе): read → canSee, write → canWrite, ADMIN → ADMIN точки.
     * Текущая params.role (UI) ограничивает эффективные права: при role≠ADMIN Work ADMIN
     * не получает bypass на ADMIN-операции.
     */
    async assertAccess(params = {}, level = $class.ACCESS_LEVEL.READ, folder) {
        if (DEV_MODE) return;
        if (!params?.session) return;
        if (params.session?.$user === globalThis.WORK) return;
        const uid = $class.resolveUid(params);
        if (!uid && level !== $class.ACCESS_LEVEL.READ)
            throw new Error(ACCESS_DENIED);
        const roleIsAdmin = !params.role || params.role === $class.ROLES.ADMIN;
        if (roleIsAdmin && globalThis.WORK && await this._isWorkAdmin(params))
            return;
        switch (level) {
            case $class.ACCESS_LEVEL.READ:
                if (!(await this.canSee(folder || this, params)))
                    throw new Error(ACCESS_DENIED);
                break;
            case $class.ACCESS_LEVEL.WRITE:
                if (!(await this.canWrite(folder || this, params)))
                    throw new Error(ACCESS_DENIED);
                break;
            case $class.ACCESS_LEVEL.ADMIN:
                if (params.role && params.role !== $class.ROLES.ADMIN)
                    throw new Error(ACCESS_DENIED);
                if (globalThis.WORK && await this._isWorkAdmin(params))
                    return;
                throw new Error(ACCESS_DENIED);
            default:
                throw new Error(ACCESS_DENIED);
        }
    }

    async allowAccess(params) {
        let result = await this.canSee(this, params);
        if (!result) {
            const items = await this.items;
            for (const i of items) {
                if (i instanceof $class && await i.allowAccess(params)) {
                    result = true;
                    break;
                }
            }
        }
        return result;
    }

    /** Проверка ADMIN на корневом WORK. */
    async _isWorkAdmin(params = {}) {
        if (!globalThis.WORK) return false;
        return globalThis.WORK !== this && await globalThis.WORK.roles?.(params).then(r => r.includes($class.ROLES.ADMIN));
    }

    /** Системный путь ($server, sources, oda, корень WORK). */
    _isSystemPath(item) {
        const path = item?.path ?? '';
        if (!path) return true;
        if (['/$server', '/sources', '/oda'].some(s => path.startsWith(s))) return true;
        return false;
    }

    _isSystemItem(item) {
        if (!item) return false;
        if (item === globalThis.WORK) return true;
        return this._isSystemPath(item);
    }

    /**
     * Прочитать секрет из #secret (fallback: #system). Требует ADMIN.
     * @param {object} [params]
     * @param {string} params.filename Имя файла секрета (например email.json)
     * @returns {Promise<object>} Данные секрета или {}
     */
    async read_secret(params = {}){
        await this.assertAccess(params, $class.ACCESS_LEVEL.ADMIN);
        const filename = params.filename;
        if (!filename)
            throw new Error('Не указано имя файла');
        for (const path of [this._secretPath(filename), this._legacySecretPath(filename)]) {
            if (!path || !fs.existsSync(path))
                continue;
            try {
                return JSON.parse(fs.readFileSync(path, { encoding: 'utf-8' }));
            }
            catch (e) {
                console.warn('[WORK] read_secret:', e.message);
            }
        }
        return {};
    }

    /**
     * Сохранить секрет в #secret через save_file (файл + history; лог как обычно).
     * Требует ADMIN. Caller передаёт готовые filename и post.
     * @param {object} [params]
     * @param {string} params.filename Имя файла секрета (например email.json)
     * @param {string|Buffer} params.post Тело файла
     * @returns {Promise<object>} Запись лога (path = history-снимок)
     */
    async save_secret(params = {}){
        await this.assertAccess(params, $class.ACCESS_LEVEL.ADMIN);
        if (!params.filename)
            throw new Error('Не указано имя файла');
        if (params.post == null)
            throw new Error('Не указано тело файла');
        if (!this.meta_folder)
            throw new Error('Нет метапапки класса');
        const secretFolder = await this.meta_folder._get_next_item('#secret', FS.$folder);
        return secretFolder.save_file({ ...params });
    }

    /**
     * Назначенные пользователи класса по роли.
     * @param {object} [params]
     * @param {string} [params.role] ADMIN | BOSS | USER | GUEST; без роли — все назначенные
     * @param {boolean} [params.inherited] Включить вышестоящие классы (для ADMIN и BOSS)
     * @returns {Promise<Array>} Массив пользователей ($user)
     */
    async members(params = {}) {
        const { role, inherited } = params;
        switch (role) {
            case $class.ROLES.ADMIN:
                return inherited ? this.allAdmins : this.admins;
            case $class.ROLES.BOSS:
                return inherited ? this.allBosses : this.bosses;
            case $class.ROLES.USER:
                return this.users;
            case $class.ROLES.GUEST:
                return this.guests;
        }
        if (role && (await this.declared_roles)[role])
            return this._localRole(role);
        return this.assignedUsers;
    }

    /** Пользователи роли, назначенные локально в #security (без наследования и литералов). */
    _localRole(role) {
        return Promise.resolve(this.init).then(async () => {
            const ids = this._roleIds(role);
            if (!ids?.length) return [];
            const usersRoot = await WORK.$users;
            const result = [];
            for (const id of ids) {
                if (id === 'GUEST') continue;
                const user = await usersRoot.get_item('//' + id);
                if (user)
                    result.push(user);
            }
            return result;
        })
    }
    /** Исполнители класса из #security.USERS (без наследования). */
    get users(){
        return this._localRole($class.ROLES.USER);
    }
    /** Гости класса из #security.GUEST (без наследования). */
    get guests(){
        return this._localRole($class.ROLES.GUEST);
    }
    /** Администраторы, назначенные локально в #security.ADMINS (без наследования). */
    get admins(){
        return this._localRole($class.ROLES.ADMIN);
    }
    /** Управляющие, назначенные локально в #security.BOSSES (без наследования). */
    get bosses(){
        return this._localRole($class.ROLES.BOSS)
    }
    /** Все администраторы: вышестоящие allAdmins + собственные ADMINS. */
    get allAdmins() {
        return Promise.all([Promise.resolve(this.$parent?.allAdmins), this._localRole($class.ROLES.ADMIN)])
            .then(([parents, local]) => {
                const seen = new Set((parents || []).map(u => u?.id));
                return [...(parents || []), ...local.filter(u => !seen.has(u.id))];
            })
    }
    /** Все управляющие: вышестоящие allBosses + собственные BOSSES. */
    get allBosses() {
        return Promise.all([Promise.resolve(this.$parent?.allBosses), this._localRole($class.ROLES.BOSS)])
        .then(([parents, local]) => {
            const seen = new Set((parents || []).map(u => u?.id));
            return [...(parents || []), ...local.filter(u => !seen.has(u.id))];
        })
    }
    /**
     * Создать дочерний класс (только класс). Файлы — save_file; папки появляются при save_file.
     * @param {object} [p]
     * @param {string} [p.type] $class или другой типизатор ($paas, …); по умолчанию $class
     * @param {string} p.id Имя класса (для $class — целиком ЗАГЛАВНЫМИ)
     * @param {string} [p.post] Содержимое class.js
     * @returns {Promise<object>} Снимок class.js (history path)
     */
    async create(p = {}) {
        await this.assertAccess(p, $class.ACCESS_LEVEL.WRITE);
        const rawId = String(p.id ?? '').trim();
        const id = safeNodeName(rawId);
        if (!id)
            throw new Error('create: пустое имя узла после нормализации');
        if (looksLikeFileId(id))
            throw new Error('create создаёт только класс. Файл — save_file({ filename, post })');
        let type = p.type || '$class';
        if (type === '$file' || type === '$folder')
            throw new Error('create создаёт только класс. Файл — save_file; папки появляются при save_file');
        if (typeof type !== 'string' || type[0] !== '$')
            throw new Error('create: type должен быть $class или типизатором ($…)');
        if (type.length < 2)
            throw new Error('create: type должен быть $class или типизатором с именем ($…), не «$»');
        if (type === '$class')
            assertClassId(id);

        let post = p.post ?? `export default {
    label: '${p.label || id}'
}`;
        if (type === '$ai' && rawId && rawId !== id) {
            const early = await parseCreateDevice(post);
            if (!early?.model)
                post = ensureModelField(post, rawId);
        }
        // Тело обязано разбираться как модуль до записи: битый class.js убивает merge
        // всего дерева (Babel) и кладет сервер. Проверяет сам класс, не агент.
        try {
            const script = /export\s+default/.test(String(post)) ? String(post) : ('export default ' + String(post));
            await this.constructor.importScript(script);
        }
        catch (e) {
            throw new Error('create: class.js не разбирается: ' + String(e.message || e).split('\n')[0]);
        }
        // Инвариант: поле model в class.js уникально среди детей родителя (один remote → один класс).
        const device = await parseCreateDevice(post);
        const modelKey = device?.model != null && device.model !== ''
            ? String(device.model)
            : '';
        if (modelKey) {
            const dup = await findChildWithModel(this, modelKey);
            if (dup)
                throw new Error('create: model «' + modelKey + '» уже у ' + (dup.path || dup.id));
        }

        const ctor = FS[type] || FS.$class;
        const item = await this._get_next_item(id, ctor);
        // meta = type, до обращения к meta_folder: иначе constructor.name ($class) mkdir лишнюю $
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
        // meta.reset();
        // item.reset();
        this.reset();
        return log;
    }

    /** Все назначенные пользователи класса (allAdmins + allBosses + users + guests + прикладные роли). */
    get assignedUsers(){
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
        })
    }
}
$class.type_chain = Object.create(null);

/** Вставить model в export default, если поля ещё нет. */
function ensureModelField(post, tag) {
    const raw = String(post || '');
    if (!tag || /\bmodel\s*:/.test(raw))
        return raw;
    const m = raw.match(/export\s+default\s*\{/);
    if (m)
        return raw.slice(0, m.index + m[0].length) + '\n    model: ' + JSON.stringify(tag) + ',' + raw.slice(m.index + m[0].length);
    if (/^\s*\{/.test(raw))
        return raw.replace(/^\s*\{/, '{ model: ' + JSON.stringify(tag) + ', ');
    return raw;
}

/** class.js post → device object (или null). */
async function parseCreateDevice(post) {
    const raw = String(post || '').trim();
    if (!raw)
        return null;
    try {
        const script = /export\s+default/.test(raw) ? raw : ('export default ' + raw);
        return await $class.importScript(script);
    }
    catch {
        return null;
    }
}

/** Ребёнок с тем же model в meta/class.js. */
async function findChildWithModel(parent, modelKey) {
    const key = String(modelKey || '');
    if (!key || !parent)
        return null;
    const kids = (await parent.children) || [];
    for (const child of kids) {
        try {
            const mf = await child.meta_file;
            let data = null;
            if (mf && typeof mf.importScript === 'function')
                data = await mf.importScript();
            else if (typeof child.import === 'function')
                data = await child.import();
            if (data && String(data.model || '') === key)
                return child;
        }
        catch { /* следующий */ }
    }
    return null;
}