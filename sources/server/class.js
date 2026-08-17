import * as fs from "node:fs";
import fsp from "node:fs/promises";
import { $item } from '../core.js';
import * as mime from "mime-types";
import { FS } from './index.js';
import { $folder } from './folder.js';
import { assertClassId } from './assert-class-id.js';
import * as LOGS from './logs.js';
import { DEV_MODE } from "../host/config.js";

const ACCESS_DENIED = 'Доступ запрещён';

/** id похож на имя файла (presentation.html), а не на класс (MARKET). */
export function looksLikeFileId(id) {
    const s = String(id ?? '').trim();
    if (!s || s[0] === '$')
        return false;
    return /\.[A-Za-z0-9]{1,16}$/.test(s);
}

export class $class extends $folder{
    static sourceUrl = import.meta.url;

    /** Роли пользователей в классе. */
    static ROLES = { ADMIN: 'ADMIN', BOSS: 'BOSS', USER: 'USER', GUEST: 'GUEST' };

    /** Зоны доступа внутри класса. */
    static ZONES = { SYSTEM: 'system', MANAGEMENT: 'management', WORK: 'work', GUESTS: 'guests' };

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
            FIELDS: { id: 'FIELDS', icon: 'iconoir:input-field', fields: [] }
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
    async resolveDistributedFolder() {
        let folder = this.$folder;
        for (const step of await this.type_chain) {
            folder = await folder._get_item(step, $folder);
            if (!folder)
                break;
        }
        if (!folder)
            throw new Error('Указана несуществующая точка наследования');
        return folder;
    }

    /** uid пользователя из params.session (сессия host). */
    static resolveUid(params = {}) {
        const session = params.session;
        if (!session?.uid)
            return null;
        return session.$user?.id ?? session.uid;
    }

    /** На классе назначен хотя бы один пользователь (любая роль). */
    hasAssignments() {
        const security = this.DATA?.['#security'];
        if (!security)
            return false;
        return ['ADMINS', 'BOSSES', 'USERS', 'GUESTS']
            .some(key => Array.isArray(security[key]) && security[key].length > 0);
    }

    /**
     * Первый зарегистрированный пользователь → #security.ADMINS.
     * Не перезаписывает уже назначенных администраторов.
     */
    async ensureBootstrapAdmin(uid, params = {}) {
        if (!uid)
            return false;
        this.reset();
        await this.init;
        const security = Object.assign({}, this.DATA?.['#security']);
        security.ADMINS = Array.isArray(security.ADMINS) ? security.ADMINS.slice() : [];
        if (security.ADMINS.length)
            return false;
        security.ADMINS.add(uid);
        const post = this.constructor.toScript({ '#security': security });
        await this.save({ post, session: WORK });
        this.reset?.();
        return true;
    }

    /**
     * Получить список ролей текущего пользователя в классе.
     * Проверяет allAdmins/allBosses (наследуемые) и users (локальные).
     * @param {object} [params]
     * @param {object} [params.session] Объект пользователя из сессии
     * @returns {Promise<string[]>} Массив строк: 'ADMIN', 'BOSS', 'USER'
     */
    async roles(params = {}) {
        const uid = $class.resolveUid(params);
        if (!uid)
            return [];
        const roles = [];
        const [admins, bosses, users, guests] = await Promise.all([this.allAdmins, this.allBosses, this.users, this.guests]);
        if (admins.some(u => u?.id === uid))
            roles.push($class.ROLES.ADMIN);
        if (bosses.some(u => u?.id === uid))
            roles.push($class.ROLES.BOSS);
        if (users.some(u => u?.id === uid))
            roles.push($class.ROLES.USER);
        if (guests.some(u => u?.id === uid))
            roles.push($class.ROLES.GUEST);
        return roles;
    }

    /**
     * Рабочая зона роли — папка, куда пишутся файлы пользователя этой роли.
     * ADMIN → чат: meta_folder/$folder/$work, системные файлы: вся метапапка кроме $work
     * BOSS → управленческая зона (distributed_folder/$work)
     * USER → рабочая зона (meta_folder/$work)
     * GUEST → зона гостей (meta_folder/guests)
     */
    async work_zone(params = {}){
        const {role} = params;
        switch(role){
            case $class.ROLES.ADMIN:
                return this.$folder._get_item('work', FS.$folder);
            case $class.ROLES.BOSS:
                const dist = await this.resolveDistributedFolder();
                return dist._get_item('work', FS.$folder);
            case $class.ROLES.USER:
                return this.meta_folder._get_item('work', FS.$folder);
            case $class.ROLES.GUEST:
                return this.meta_folder._get_item('guests', FS.$folder);
        }
        return this.meta_folder
    }
    /** @deprecated используй work_zone */
    get_storage(params){
        return this.work_zone(params);
    }

    /**
     * Источник логов чата для текущей роли пользователя.
     * Приоритет: params.role (выбранная в UI) → фактические роли.
     * USER → личный кабинет ($user)
     * ADMIN и BOSS → текущий класс
     */
    async chatSource(params = {}) {
        const uid = $class.resolveUid(params);
        // Явно выбранная роль в UI имеет приоритет
        if (params.role === $class.ROLES.USER)
            return uid ? '/USERS//' + uid : this.path;
        if (params.role === $class.ROLES.ADMIN || params.role === $class.ROLES.BOSS || params.role === $class.ROLES.GUEST)
            return this.path;
        // Fallback: без role — по фактическим ролям
        const roles = await this.roles(params);
        if (roles.includes($class.ROLES.ADMIN) || roles.includes($class.ROLES.BOSS) || roles.includes($class.ROLES.GUEST))
            return this.path;
        return uid ? '/USERS//' + uid : this.path;
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
        const distributed_folder = await this.resolveDistributedFolder();

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
        // Логи (data.logs) — системная операция: всегда пишутся в meta_folder,
        // минуя work_zone, чтобы не попадать в зону $work по role.
        if (params.filename === 'data.logs') {
            const folder = await this.meta_folder.getFolderToSaveFile(params);
            return folder.save_file(params);
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
        return this.meta_folder?.files.find(f => f.id === 'class.js');
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
        return LOGS.loadBodies(this, LOGS.normalizeQuery(dayOrParams));
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
        return LOGS.findEntry(this, params.taskPath || params.path || params.entryPath);
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
        await this.assertAccess(params, $class.ACCESS_LEVEL.WRITE);
        const time = Date.now();
        const row = { time };
        if (params.sender)
            row.sender = params.sender;
        else if (params.session?.uid)
            row.sender = params.session.uid;
        else if (params.session?.$user === globalThis.WORK)
            row.sender = WORK.id;
        if (params.message != null)
            row.content = params.message;
        if (params.includes?.length)
            row.includes = params.includes.map(p => (p?.startsWith('/') ? p : '/' + p));
        if (typeof params.receivers === 'string')
            row.receivers = params.receivers.split(',').map(s => s.trim()).filter(Boolean);
        else if (Array.isArray(params.receivers))
            row.receivers = params.receivers.slice();
        if (params.mainContext)
            row.mainContext = params.mainContext;
        await LOGS.appendRow(this, row, params);
        return row;
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
        params = LOGS.normalizeQuery(params);
        return LOGS.buildIndex(await LOGS.loadBodies(this, params), params);
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
        params = LOGS.normalizeQuery(params);
        switch (params.mode || 'folder') {
            case 'dates':
                return LOGS.datesList(this);
            case 'bodies':
                return LOGS.loadBodies(this, params);
            case 'index':
                return LOGS.buildIndex(await LOGS.loadBodies(this, params), params);
            case 'files':
                return this.sortItems(await LOGS.filesForDays(this, params), true, false);
            case 'folder':
            default:
                return LOGS.dayFolder(this, params.day || LOGS.resolveDays(params)[0]);
        }
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
     * Определить зону элемента относительно текущего класса.
     * Обходит предков элемента внутри класса:
     * — элемент внутри distributed $work → MANAGEMENT
     * — элемент внутри meta $work → WORK
     * — элемент внутри метапапки, но вне $work → SYSTEM
     */
    resolveZone(item) {
        if (!item || typeof item !== 'object')
            return null;
        let p = item;
        while (p) {
            if (p.id === 'work') {
                // Проверяем, кто родитель work
                // distributed work → внутри цепочки наследования ($folder)
                // meta work → внутри метапапки класса
                if (p.parent && p.parent.id === '$folder')
                    return $class.ZONES.MANAGEMENT;
                return $class.ZONES.WORK;
            }
            if (p.id === 'guests')
                return $class.ZONES.GUESTS;
            // Достигли класса — стоп
            if (p instanceof $class && p !== this)
                break;
            if (p === this)
                break;
            p = p.parent;
        }
        return $class.ZONES.SYSTEM;
    }

    /**
     * Видимость элемента (чтение).
     * ADMIN/boss — видят всё от точки назначения вниз.
     * USER — видит только класс назначения (без дочерних классов).
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
        if (this.id === uid) return true;
        // WORK ADMIN видит всё
        if (globalThis.WORK && await this._isWorkAdmin(params))
            return true;
        // Системные элементы видны всем
        if (this._isSystemItem(item))
            return true;
        // Класс без назначений — pass-through к родителю
        const roles = await this.roles(params);
        if (!this.hasAssignments() && !roles.length) {
            const parent = this.$parent;
            if (parent)
                return parent.canSee(item, params);
            return false;
        }
        if (!roles.length)
            return false;
        // ADMIN и boss видят всё от точки вниз
        if (roles.includes($class.ROLES.ADMIN) || roles.includes($class.ROLES.BOSS))
            return true;
        // USER видит только свой класс
        if (roles.includes($class.ROLES.USER))
            return this._isSlaveVisible(item, params);
        // GUEST видит только свою зону guests (+ логи класса для чата)
        if (roles.includes($class.ROLES.GUEST))
            return this._isGuestVisible(item, params);
        return false;
    }

    /**
     * Право записи (требует params.role).
     * ADMIN → SYSTEM (всё в метапапке, КРОМЕ $work)
     * boss → MANAGEMENT (distributed $work, только класс назначения)
     * USER → WORK (meta $work, только класс назначения)
     */
    async canWrite(item, params = {}) {
        if (DEV_MODE) return true;
        if (!item || typeof item !== 'object') return false;
        const uid = $class.resolveUid(params);
        if (!uid) return false;
        if (this.id === uid) return true;
        if (globalThis.WORK && await this._isWorkAdmin(params))
            return true;
        if (this._isSystemItem(item))
            return false;
        const role = params.role;
        if (!role) return false;
        const roles = await this.roles(params);
        if (!roles.includes(role))
            return false;
        const zone = this.resolveZone(item);
        const allowedZone = {
            [$class.ROLES.ADMIN]: $class.ZONES.SYSTEM,
            [$class.ROLES.BOSS]: $class.ZONES.MANAGEMENT,
            [$class.ROLES.USER]: $class.ZONES.WORK,
            [$class.ROLES.GUEST]: $class.ZONES.GUESTS,
        }[role];
        return zone === allowedZone;
    }

    /**
     * Единая проверка доступа (бросает при отказе): read → canSee, write → canWrite, ADMIN → ADMIN точки.
     * Текущая params.role (UI) ограничивает эффективные права: при role≠ADMIN Work ADMIN
     * не получает bypass на ADMIN-операции.
     */
    async assertAccess(params = {}, level = $class.ACCESS_LEVEL.READ) {
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
                if (!(await this.canSee(this, params)))
                    throw new Error(ACCESS_DENIED);
                break;
            case $class.ACCESS_LEVEL.WRITE:
                if (!(await this.canWrite(this, params)))
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

    /** Slave видит элементы только своего класса (не дочерние). */
    _isSlaveVisible(item, params) {
        const itemClass = item.$class ?? item.$owner;
        return itemClass === this;
    }

    /** Гость видит свой класс, зону guests и логи класса (чат); не видит work и системное. */
    _isGuestVisible(item, params) {
        if (item === this)
            return true;
        if (this.resolveZone(item) === $class.ZONES.GUESTS)
            return true;
        // Логи гостя пишутся в класс (meta_folder/logs) — нужны для чата
        const path = item?.path ?? '';
        return path.startsWith(this.meta_folder.path + '/logs/');
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
        const secretFolder = await this.meta_folder._get_item('#secret', FS.$folder);
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
        return this.assignedUsers;
    }

    /** Пользователи роли, назначенные локально в #security (без наследования и литералов). */
    _localRole(role) {
        const key = { [$class.ROLES.ADMIN]: 'ADMINS', [$class.ROLES.BOSS]: 'BOSSES', [$class.ROLES.USER]: 'USERS', [$class.ROLES.GUEST]: 'GUESTS' }[role];
        return Promise.resolve(this.init).then(async () => {
            const ids = this.DATA['#security']?.[key];
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
    /** Гости класса из #security.GUESTS (без наследования). */
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
        const id = String(p.id ?? '').trim();
        if (!id)
            throw new Error('create: нужен id класса');
        if (looksLikeFileId(id))
            throw new Error('create создаёт только класс. Файл — save_file({ filename, post })');
        let type = p.type || '$class';
        if (type === '$file' || type === '$folder')
            throw new Error('create создаёт только класс. Файл — save_file; папки появляются при save_file');
        if (typeof type !== 'string' || type[0] !== '$')
            throw new Error('create: type должен быть $class или типизатором ($…)');
        if (type === '$class')
            assertClassId(id);

        let folder = await this._get_item(id, FS.$folder);
        await folder.save();
        folder = await folder._get_item(type, FS.$folder);
        await folder.save();
        const post = p.post ?? `export default {
    label: '${id}'
}`;
        return folder.save_file({
            ...p,
            filename: 'class.js',
            post,
            ignore_save_logs: true,
        });
    }

    /** Все назначенные пользователи класса (объединение allAdmins + allBosses + users + guests). */
    get assignedUsers(){
        return Promise.all([
            Promise.resolve(this.allAdmins),
            Promise.resolve(this.allBosses),
            Promise.resolve(this.users),
            Promise.resolve(this.guests),
        ]).then(([admins, bosses, users, guests]) => {
            const all = [...admins, ...bosses, ...users, ...guests];
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