import * as fs from "node:fs";
import fsp from "node:fs/promises";
import { $item } from '../core.js';
import * as mime from "mime-types";
import { FS } from './index.js';
import { $folder } from './folder.js';

const ACCESS_DENIED = 'Доступ запрещён';

export class $class extends $folder{
    static sourceUrl = import.meta.url;

    /** Роли пользователей в классе. */
    static ROLES = { ADMIN: 'admin', MASTER: 'master', SLAVE: 'slave' };

    /** Зоны доступа внутри класса. */
    static ZONES = { SYSTEM: 'system', MANAGEMENT: 'management', WORK: 'work' };

    /** Уровни доступа к методам. */
    static ACCESS_LEVEL = { READ: 'read', WRITE: 'write', ADMIN: 'admin' };

    /** Dev-режим: enforcement безопасности отключён. */
    static get isDevMode() {
        const raw = process.env.WORK_DEV ?? process.env.dev;
        if (raw == null) return false;
        return String(raw).toLowerCase() !== 'false' && raw !== '0';
    }

    /** Проверить, что путь childPath находится внутри parentPath. */
    static isPathInside(childPath, parentPath) {
        if (!childPath || !parentPath) return false;
        if (childPath === parentPath) return true;
        return childPath.startsWith(parentPath + '/');
    }

    // Описания методов, специфичных для $class (наследуются от $folder)
    static TOOL_DESCRIPTIONS = {
        ...$folder.TOOL_DESCRIPTIONS,
        read_secret: 'Прочитать секрет из #system. Параметры: name (имя модуля). Требует ADMIN доступ.',
        save_secret: 'Сохранить секрет в #system. Параметры: name (имя модуля), post (данные). Требует ADMIN доступ.',
        read_log_entry: 'Получить актуальную запись лога по path. Параметры: taskPath/path/entryPath.',
        appendLogIncludes: 'Добавить пути в includes записи лога. Параметры: entryPath, includePaths.',
        task_reply: 'Продолжить диалог в существующей task.ai. Параметры: taskPath, post.',
    };

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
            FIELDS: [],
            STATIC: [],
            INDEXES: []
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
     * @ai Загрузить и объединить class.js класса из цепочки наследования
     * @ai.params {"reset": "сбросить кэш перед загрузкой"}
     * @ai.returns Объединённый объект class.js
     */
    async load(params = {}){
        await this.allowAccess(params, $class.ACCESS_LEVEL.READ);
        let files = await this.tilde;
        files = files.filter(f=>f.id === 'class.js');
        return $server.mergeFiles(files, params.reset);
    }
    /**
     * @ai Импортировать class.js класса как ES-модуль
     * @ai.returns Экспорт class.js (default)
     */
    async import(params = {}){
        let data = await this.load(params)
        return this.constructor.importScript(data);
    }
    async info(p = {deep: 0, reset: false}){
        p.deep = +p.deep;
        let data =  this[R].cache['info-data'] ??= new  AsyncPromise(async _=>{
            if(this.isType || this.isHidden)
                return null;
            let key = 'info:' + (this.ext || this.type);
            let data = this[R].cache[key] ??= new AsyncPromise( _ => this.import(p))
            data = await data;
            if(data)
                this.DATA = data;
            return data;

        })
        data = await data;
        const arg = Object.assign({}, p)
        return super.info(arg);
    }
    get steps(){
        let type = this.type;
        return this.constructor.steps[type] ??= new AsyncPromise(async ()=>{
            let folder = await WORK.$folder.find_item(type, item => item.id?.[0] === '$' && item.id !== '$file');
            if(!folder)
                return [this.constructor.name, type];
            return folder.path.split('/').slice(3);
        })
    }
    async resolveDistributedFolder() {
        let folder = this.$folder;
        for (const step of await this.steps) {
            folder = await folder._get_item(step, $folder);
            if (!folder)
                break;
        }
        if (!folder)
            throw new Error('Указана несуществующая точка наследования');
        return folder;
    }

    /** uid пользователя из params.user (сессия host). */
    static resolveUid(params = {}) {
        const user = params.user;
        if (!user?.uid)
            return null;
        return user.$user?.id ?? user.uid;
    }

    /** На классе назначен хотя бы один пользователь (любая роль). */
    hasAssignments() {
        const security = this.DATA?.['#security'];
        if (!security)
            return false;
        return Boolean(security.admin) || Boolean(security.master)
            || (Array.isArray(security.slaves) && security.slaves.length > 0);
    }

    /**
     * Первый зарегистрированный пользователь → #security.admin.
     * Не перезаписывает уже заданного admin.
     */
    async ensureBootstrapAdmin(uid, params = {}) {
        if (!uid)
            return false;
        await this.info({ reset: true });
        if (this.DATA?.['#security']?.admin)
            return false;
        const security = Object.assign({}, this.DATA?.['#security'], { admin: uid });
        const post = this.constructor.toScript({ '#security': security });
        await this.save({ post, user: WORK });
        this.reset?.();
        return true;
    }

    /**
     * Все роли пользователя в данном классе.
     * Проверяет геттеры admins/masters/slaves (наследуемые/локальные).
     * @ai Получить список ролей текущего пользователя в классе
     * @ai.params {"user": "объект пользователя из сессии"}
     * @ai.returns Массив строк: 'admin', 'master', 'slave'
     */
    async roles(params = {}) {
        const uid = $class.resolveUid(params);
        if (!uid)
            return [];
        const roles = [];
        const [admins, masters, slaves] = await Promise.all([this.admins, this.masters, this.slaves]);
        if (admins.some(u => u?.id === uid))
            roles.push($class.ROLES.ADMIN);
        if (masters.some(u => u?.id === uid))
            roles.push($class.ROLES.MASTER);
        if (slaves.some(u => u?.id === uid))
            roles.push($class.ROLES.SLAVE);
        return roles;
    }

    /**
     * Папка зоны действия по роли.
     * admin → системная зона (meta_folder)
     * master → управленческая зона (distributed_folder/$work)
     * slave → рабочая зона (meta_folder/$work)
     */
    async get_storage(params = {}){
        const {role} = params;
        switch(role){
            case $class.ROLES.MASTER:
                const dist = await this.resolveDistributedFolder();
                return dist._get_item('$work', FS.$folder);
            case $class.ROLES.SLAVE:
                return this.meta_folder._get_item('$work', FS.$folder);
        }
        return this.meta_folder
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
     * @ai Сохранить class.js класса с разделением на собственные и наследуемые данные
     * @ai.params {"post": "строка class.js (export default {...})"}
     * @ai.returns true при успешном сохранении
     */
    async save(params = {}){
        await this.allowAccess(params, $class.ACCESS_LEVEL.ADMIN);
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

        // todo: при повторном использовании вынести в отдельный метод
        delete this[R].cache['info-data'];
        delete this[R].cache['info:' + (this.ext || this.type)];
        this.reset();
        this.DATA = await this.import();

        return true;
    }
    async save_file(params = {}){
        const storage = await this.get_storage(params);
        const folder = await storage.getFolderToSaveFile(params);
        return folder.save_file(params);
    }
    async get_write_stream(params) {
        const storage = await this.get_storage(params);
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
    get logs_dates(){
        return new AsyncPromise(async ()=>{
            let history = await this.meta_folder.get_item('/logs/.data.logs/history');
            let dates = [];
            try{
                if(history){
                    dates = await history.folders;
                    dates = dates.map(f=>f.name);
                    dates.sort((a, b) => b.localeCompare(a));
                }
            }
            catch (e) {
                if (e?.code !== 'ENOENT') {
                    console.warn('[WORK] logs_dates:', e.message);
                }
            }
            let day = new Date().toISOString().slice(0, 10);
            if(dates.indexOf(day) === -1) dates.unshift(day);
            return dates;
        })
    }
    /** Список .logs файлов дня (без load) — для инкрементального чата */
    log_files(day){
        day ??= new Date().toISOString().slice(0, 10);
        return this.meta_folder.get_item('/logs/.data.logs/history/' + day + '/*.logs');
    }

    /** Расширение history-файла из записи лога (поле ext или path) */
    static log_ext(row){
        if (row?.ext)
            return String(row.ext).replace(/^\./, '').toLowerCase();
        const id = row?.path?.split('/').pop() || '';
        const dot = id.lastIndexOf('.');
        return dot > 0 ? id.slice(dot + 1).toLowerCase() : '';
    }

    static _normalizeLogQuery(params = {}){
        if (typeof params === 'string')
            params = { day: params };
        params = {...params};
        params.exts ??= params.ext != null
            ? (Array.isArray(params.ext) ? params.ext : [params.ext])
            : null;
        if (params.exts)
            params.exts = params.exts.map(e => String(e).replace(/^\./, '').toLowerCase());
        return params;
    }

    _logMatchesFilter(row, params){
        if (!params.exts?.length)
            return true;
        return params.exts.includes($class.log_ext(row));
    }

    _resolveLogDays(params = {}){
        if (params.day)
            return [params.day];
        if (params.days?.length)
            return params.days.slice();
        if (params.from) {
            const to = params.to || params.from;
            const days = [];
            const cur = new Date(params.from + 'T12:00:00');
            const end = new Date(to + 'T12:00:00');
            while (cur <= end) {
                days.push(cur.toISOString().slice(0, 10));
                cur.setDate(cur.getDate() + 1);
            }
            return days;
        }
        return [new Date().toISOString().slice(0, 10)];
    }

    async _logsHistory(){
        return this.meta_folder.get_item('/logs/.data.logs/history');
    }

    async _logsDayFolder(day){
        day ??= new Date().toISOString().slice(0, 10);
        let history = await this._logsHistory();
        if (!history)
            return null;
        let folder = await history._get_item(day, FS.$folder);
        await folder.save();
        return folder;
    }

    async _loadLogBodiesForDays(params = {}){
        const days = this._resolveLogDays(params);
        let rows = [];
        for (const day of days) {
            let files = await this.log_files(day);
            if (!Array.isArray(files))
                files = files ? [files] : [];
            for (const f of files) {
                try {
                    const raw = await f.load();
                    const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (row?.time == null)
                        continue;
                    if (!this._logMatchesFilter(row, params))
                        continue;
                    rows.push(Object.assign({ day, logsFilePath: f.path }, row));
                }
                catch (e) {
                    console.warn('[WORK] log load', day, e.message);
                }
            }
        }
        rows.sort((a, b) => (b.time || 0) - (a.time || 0));
        return rows;
    }

    /**
     * JSON-тела записей за день или диапазон.
     * params: { day } | { from, to } | { days[] }, опционально ext / exts: 'ics' | ['ics','eml']
     */
    /**
     * @ai Получить тела записей логов за день или диапазон дат
     * @ai.params {"day": "дата YYYY-MM-DD", "from": "начало диапазона", "to": "конец диапазона", "ext": "фильтр по расширению"}
     * @ai.returns Массив записей логов с содержимым
     */
    async read_log_bodies(dayOrParams = {}){
        const params = $class._normalizeLogQuery(dayOrParams);
        return this._loadLogBodiesForDays(params);
    }

    /** Найти JSON-запись лога по path history-файла (task.ai и т.п.). */
    async _findLogEntry(entryPath) {
        if (!entryPath)
            return null;
        const target = entryPath.startsWith('/') ? entryPath : '/' + entryPath;
        const shortTarget = $item.toShortPath(target);
        const days = await this.logs_dates;
        for (const day of days) {
            let files = await this.log_files(day);
            if (!Array.isArray(files))
                files = files ? [files] : [];
            for (const f of files) {
                try {
                    const raw = await f.load();
                    const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (!row?.path)
                        continue;
                    const rowPath = row.path.startsWith('/') ? row.path : '/' + row.path;
                    const shortRow = $item.toShortPath(rowPath);
                    if (shortRow !== shortTarget && rowPath !== target && !rowPath.endsWith(target) && !target.endsWith(rowPath))
                        continue;
                    return row;
                }
                catch { /* skip */ }
            }
        }
        return null;
    }

    /** Актуальная JSON-запись лога по path history-файла (для микрочата task.ai). */
    async read_log_entry(params = {}) {
        return this._findLogEntry(params.taskPath || params.path || params.entryPath);
    }

    /** Добавить пути в includes записи лога (например, шаги task.ai). */
    async appendLogIncludes(entryPath, includePaths = [], params = {}) {
        if (entryPath && typeof entryPath === 'object' && entryPath.entryPath) {
            params = includePaths?.user ? includePaths : (params?.user ? params : {});
            includePaths = entryPath.includePaths;
            entryPath = entryPath.entryPath;
        }
        if (typeof includePaths === 'string')
            includePaths = includePaths.split(',').map(s => s.trim()).filter(Boolean);
        if (!Array.isArray(includePaths))
            includePaths = includePaths ? [includePaths] : [];
        if (!entryPath || !includePaths.length)
            return null;
        const target = entryPath.startsWith('/') ? entryPath : '/' + entryPath;
        const days = await this.logs_dates;
        for (const day of days) {
            let files = await this.log_files(day);
            if (!Array.isArray(files))
                files = files ? [files] : [];
            for (const f of files) {
                try {
                    const raw = await f.load();
                    const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (!row?.path)
                        continue;
                    const rowPath = row.path.startsWith('/') ? row.path : '/' + row.path;
                    const shortTarget = $item.toShortPath(target);
                    const shortRow = $item.toShortPath(rowPath);
                    if (shortRow !== shortTarget && rowPath !== target && !rowPath.endsWith(target) && !target.endsWith(rowPath))
                        continue;
                    row.includes ??= [];
                    for (const p of includePaths) {
                        const path = p.startsWith('/') ? p : '/' + p;
                        if (!row.includes.includes(path))
                            row.includes.push(path);
                    }
                    await f.save({
                        post: JSON.stringify(row, null, 2),
                        encoding: 'utf-8',
                        user: params.user || globalThis.WORK,
                    });
                    this.reset();
                    return row;
                }
                catch (e) {
                    console.warn('[WORK] appendLogIncludes', e.message);
                }
            }
        }
        return null;
    }

    /** Развернуть includes: pack / message.txt → вложенные файлы. */
    async _expandLogIncludes(includePaths = []) {
        const seen = new Set();
        const out = [];
        const add = (p) => {
            if (!p)
                return;
            const key = p.startsWith('/') ? p : '/' + p;
            if (seen.has(key))
                return;
            seen.add(key);
            out.push(key);
        };
        for (const p of includePaths) {
            add(p);
            const path = String(p);
            if (path.includes('.pack')) {
                const row = await this._findLogEntry(p);
                if (row?.includes?.length) {
                    for (const inc of row.includes)
                        add(inc);
                }
                else {
                    try {
                        const file = await WORK.get_item(p.startsWith('/') ? p : '/' + p);
                        const pack = JSON.parse(await file.load());
                        for (const inc of pack.includes || [])
                            add(inc);
                    }
                    catch { /* no nested includes */ }
                }
            }
            else if (path.includes('.message.txt')) {
                const row = await this._findLogEntry(p);
                if (row?.includes?.length)
                    for (const inc of row.includes)
                        add(inc);
            }
        }
        return out;
    }

    async _runTaskAiQueue(taskPath, job) {
        const key = taskPath?.startsWith('/') ? taskPath : taskPath ? '/' + taskPath : '';
        if (!key || !globalThis.WORK)
            return job();
        globalThis.WORK._taskAiQueue ??= new Map();
        const previous = globalThis.WORK._taskAiQueue.get(key) || Promise.resolve();
        const next = previous.catch(() => {}).then(job);
        globalThis.WORK._taskAiQueue.set(key, next);
        try {
            return await next;
        }
        finally {
            if (globalThis.WORK._taskAiQueue.get(key) === next)
                globalThis.WORK._taskAiQueue.delete(key);
        }
    }

    /** Продолжение диалога в существующей task.ai (микрочат). */
    /**
     * @ai Продолжить диалог в существующей task.ai (отправка повторного промпта)
     * @ai.params {"taskPath": "путь к task.ai", "post": "текст или FormData с файлами"}
     * @ai.returns Обновлённая запись лога task.ai
     */
    async task_reply(params = {}, post) {
        post ??= params.post;
        const taskPath = params.taskPath;
        if (!taskPath)
            throw new Error('taskPath обязателен');
        return this._runTaskAiQueue(taskPath, () => this._task_reply_queued(params, post));
    }

    async _task_reply_queued(params = {}, post) {
        const taskPath = params.taskPath;
        const logAuthor = params.user;
        let text = '';
        let stepPath = null;

        const isMultipart = post && typeof post === 'object' && !Buffer.isBuffer(post)
            && (post.files || post.message);

        if (isMultipart) {
            const packLog = await this.save_files({
                post,
                encoding: params.encoding || 'utf-8',
                user: globalThis.WORK,
                logAuthor,
                ignore_save_logs: true,
                taskPath,
            });
            stepPath = packLog?.logFullPath || packLog?.path;
            if (!stepPath)
                throw new Error('Нужен текст или файлы');
            try {
                const file = await WORK.get_item(stepPath);
                const pack = JSON.parse(await file.load());
                text = String(pack.content ?? '').trim();
            }
            catch {
                const row = await this._findLogEntry(stepPath);
                text = String(row?.content ?? '').trim();
            }
        }
        else if (typeof post === 'string') {
            text = post.trim();
            if (text) {
                const msgLog = await this.save_file({
                    filename: 'message.txt',
                    post: text,
                    encoding: 'utf-8',
                    user: logAuthor || globalThis.WORK,
                    logAuthor,
                    ignore_save_logs: true,
                });
                stepPath = msgLog?.logFullPath || msgLog?.path;
            }
        }
        else
            throw new Error('Нужен текст или файлы');

        if (!text && !stepPath)
            throw new Error('Нужен текст или файлы');

        let row = null;
        if (stepPath)
            row = await this.appendLogIncludes(taskPath, [stepPath], { user: globalThis.WORK });

        const includes = row?.includes || (stepPath ? [stepPath] : []);
        
        let entry = await this._findLogEntry(taskPath) ?? row;
        const normPath = p => (p?.startsWith('/') ? p : '/' + p);
        const hasInclude = (list, p) => {
            const target = normPath(p);
            return Array.isArray(list) && list.some(x => normPath(x) === target);
        };
        if (entry && aiResult?.responsePath) {
            const p = normPath(aiResult.responsePath);
            if (!hasInclude(entry.includes, p)) {
                const updated = await this.appendLogIncludes(taskPath, [p], { user: globalThis.WORK });
                if (updated)
                    entry = updated;
                else {
                    entry.includes = Array.isArray(entry.includes) ? [...entry.includes] : [];
                    entry.includes.push(p);
                }
            }
            if (aiResult.responseText != null)
                entry.replyText = aiResult.responseText;
            if (aiResult.errorText != null)
                entry.errorText = aiResult.errorText;
        }
        return entry;
    }

    /**
     * Лёгкий срез для calendar / списков — без content и без load history-файлов.
     * params: как read_log_bodies + flat, perDay (default true для диапазона)
     */
    async log_index(params = {}){
        params = $class._normalizeLogQuery(params);
        const rows = await this._loadLogBodiesForDays(params);
        const pick = row => ({
            day: row.day,
            time: row.time,
            sender: row.sender,
            ext: $class.log_ext(row),
            path: row.path,
            logsFilePath: row.logsFilePath,
        });
        if (params.flat || params.day)
            return rows.map(pick);
        const byDay = Object.create(null);
        for (const row of rows) {
            let bucket = byDay[row.day];
            if (!bucket) {
                bucket = byDay[row.day] = {
                    day: row.day,
                    count: 0,
                    firstTime: row.time,
                    lastTime: row.time,
                    exts: [],
                    items: [],
                };
            }
            bucket.count++;
            bucket.firstTime = Math.min(bucket.firstTime, row.time);
            bucket.lastTime = Math.max(bucket.lastTime, row.time);
            const ext = $class.log_ext(row);
            if (ext && !bucket.exts.includes(ext))
                bucket.exts.push(ext);
            if (params.items)
                bucket.items.push(pick(row));
        }
        return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
    }

    /**
     * Универсальный доступ к логам.
     * mode:
     *   folder — $folder дня (чат, WS-подписка), только params.day
     *   bodies — read_log_bodies(params)
     *   index  — log_index(params)
     *   files  — список $file (*.logs) за день или диапазон без load JSON
     * Фильтры: day | from+to | days[], ext | exts
     */
    /**
     * @ai Универсальный доступ к логам класса
     * @ai.params {"mode": "folder|bodies|index|files", "day": "дата", "from": "начало", "to": "конец", "ext": "расширение"}
     * @ai.returns Зависит от mode: папку дня, тела записей, индекс или список файлов
     */
    async logs(params = {}){
        params = $class._normalizeLogQuery(params);
        const mode = params.mode || 'folder';
        switch (mode) {
            case 'bodies':
                return this.read_log_bodies(params);
            case 'index':
                return this.log_index(params);
            case 'files': {
                const days = this._resolveLogDays(params);
                let files = [];
                for (const day of days) {
                    let list = await this.log_files(day);
                    if (!Array.isArray(list))
                        list = list ? [list] : [];
                    if (!params.exts?.length) {
                        files.push(...list);
                        continue;
                    }
                    for (const f of list) {
                        try {
                            const raw = await f.load();
                            const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                            if (this._logMatchesFilter(row, params))
                                files.push(f);
                        }
                        catch { /* skip */ }
                    }
                }
                return this.sortItems(files, true, false);
            }
            case 'folder':
            default: {
                const day = params.day || this._resolveLogDays(params)[0];
                return this._logsDayFolder(day);
            }
        }
    }
    get structure(){
        return new AsyncPromise(async ()=>{
            let item = await this.info();
            let result = {
                id: item.id,
                label: item.label,
                type: item.type,
                path: item.path,
                description: item.description
            }
            result.items = await this.items;
            result.items = result.items.filter(item=>item.constructor === FS.$file).map(file=>{
                if(this !== WORK || file instanceof FS.$class)
                    return file.structure;
                return {
                    id: file.id,
                    label: file.label,
                    type: file.type,
                    description: file.description
                }
            })
            result.items = await Promise.all(result.items);
            if(!result.items.length)
                delete result.items;
            return result;
        })
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

    _secretPath(name){
        if (!this.meta_folder)
            return null;
        return this.meta_folder.dir + '/#system/' + name + '.json';
    }

    async _ensureSystemDir(){
        const dir = this.meta_folder?.dir + '/#system';
        if (dir)
            fs.mkdirSync(dir, { recursive: true });
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
            if (p.id === '$work') {
                // Проверяем, кто родитель $work
                // distributed $work → внутри цепочки наследования ($folder)
                // meta $work → внутри метапапки класса
                if (p.parent && p.parent.id === '$folder')
                    return $class.ZONES.MANAGEMENT;
                return $class.ZONES.WORK;
            }
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
     * admin/master — видят всё от точки назначения вниз.
     * slave — видит только класс назначения (без дочерних классов).
     */
    async canSee(item, params = {}) {
        if ($class.isDevMode) return true;
        if (!item || typeof item !== 'object') return true;
        const uid = $class.resolveUid(params);
        if (!uid) {
            // Системные пути без пользователя
            return this._isSystemPath(item);
        }
        // WORK admin видит всё
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
        // admin и master видят всё от точки вниз
        if (roles.includes($class.ROLES.ADMIN) || roles.includes($class.ROLES.MASTER))
            return true;
        // slave видит только свой класс
        if (roles.includes($class.ROLES.SLAVE))
            return this._isSlaveVisible(item, params);
        return false;
    }

    /**
     * Право записи (требует params.role).
     * admin → SYSTEM (всё в метапапке, КРОМЕ $work)
     * master → MANAGEMENT (distributed $work, только класс назначения)
     * slave → WORK (meta $work, только класс назначения)
     */
    async canWrite(item, params = {}) {
        if ($class.isDevMode) return true;
        if (!item || typeof item !== 'object') return false;
        const uid = $class.resolveUid(params);
        if (!uid) return false;
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
            [$class.ROLES.MASTER]: $class.ZONES.MANAGEMENT,
            [$class.ROLES.SLAVE]: $class.ZONES.WORK,
        }[role];
        return zone === allowedZone;
    }

    /**
     * Единая проверка доступа: read → canSee, write → canWrite, admin → admin точки.
     */
    async allowAccess(params = {}, level = $class.ACCESS_LEVEL.READ) {
        if ($class.isDevMode) return;
        if (!params?.user) return;
        if (params.user === globalThis.WORK) return;
        const uid = $class.resolveUid(params);
        if (!uid && level !== $class.ACCESS_LEVEL.READ)
            throw new Error(ACCESS_DENIED);
        if (globalThis.WORK && await this._isWorkAdmin(params))
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
                if (globalThis.WORK && await this._isWorkAdmin(params))
                    return;
                throw new Error(ACCESS_DENIED);
            default:
                throw new Error(ACCESS_DENIED);
        }
    }

    /** Проверка admin на корневом WORK. */
    async _isWorkAdmin(params = {}) {
        if (!globalThis.WORK) return false;
        return globalThis.WORK !== this && await globalThis.WORK.roles?.(params).then(r => r.includes($class.ROLES.ADMIN));
    }

    /** Системный путь ($server, sources, oda, корень WORK). */
    _isSystemPath(item) {
        const path = item?.path ?? '';
        if (!path) return true;
        if (path === '/$server' || path.startsWith('/$server/')) return true;
        if (path.startsWith('/sources') || path.startsWith('/oda')) return true;
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

    async read_secret(params = {}){
        await this.allowAccess(params, $class.ACCESS_LEVEL.ADMIN);
        const name = params.name;
        if (!name)
            throw new Error('Не указано имя модуля');
        const path = this._secretPath(name);
        if (path && fs.existsSync(path)) {
            try {
                return JSON.parse(fs.readFileSync(path, { encoding: 'utf-8' }));
            }
            catch (e) {
                console.warn('[WORK] read_secret:', e.message);
            }
        }
        return {};
    }

    async save_secret(params = {}){
        await this.allowAccess(params, $class.ACCESS_LEVEL.ADMIN);
        const name = params.name;
        if (!name)
            throw new Error('Не указано имя модуля');
        let data = params.post;
        if (typeof data === 'string')
            data = JSON.parse(data);
        if (!data || typeof data !== 'object')
            throw new Error('Некорректные данные секрета');
        await this._ensureSystemDir();
        fs.writeFileSync(this._secretPath(name), JSON.stringify(data, null, 2), { encoding: 'utf-8' });
        this.meta_folder?.reset();
        if (name === 'email') {
            const { ensureMailboxFolders } = await import('../../../$server/$folder/lib/email/settings.js');
            await ensureMailboxFolders(this, data.mailboxes || {});
        }
        return data;
    }

    /** Администраторы класса: наследуемые + собственный #security.admin. */
    get admins(){
        return new AsyncPromise(async () =>{
            let admins = Array.isArray(await this.$parent?.admins) ? [...(await this.$parent?.admins)] : [];
            await this.info();
            let adminId = this.DATA['#security']?.admin;
            if(adminId){
                let usersRoot = await WORK.$users;
                let admin = await usersRoot.get_item('//' + adminId);
                if (admin){
                    await admin.info();
                    if (!admins.find(a => a?.id === admin.id))
                        admins.push(admin);
                }
            }
            return admins;
        })
    }
    /** Управляющие класса: наследуемые + собственный #security.master. */
    get masters(){
        return new AsyncPromise(async ()=>{
            let masters = Array.isArray(await this.$parent?.masters) ? [...(await this.$parent?.masters)] : [];
            await this.info();
            let masterId = this.DATA['#security']?.master;
            if(masterId){
                let usersRoot = await WORK.$users;
                let master = await usersRoot.get_item('//' + masterId);
                if (master){
                    await master.info();
                    if (!masters.find(m => m?.id === master.id))
                        masters.push(master);
                }
            }
            return masters;
        })
    }
    /** Исполнители класса: только собственные #security.slaves (НЕ наследуются). */
    get slaves(){
        return new AsyncPromise(async ()=>{
            await this.info();
            let slaveIds = this.DATA['#security']?.slaves;
            if(!slaveIds?.length)
                return [];
            let usersRoot = await WORK.$users;
            let slaves = [];
            for (const id of slaveIds) {
                let slave = await usersRoot.get_item('//' + id);
                if (slave){
                    await slave.info();
                    if (!slaves.find(s => s?.id === slave.id))
                        slaves.push(slave);
                }
            }
            return slaves;
        })
    }
    /** Все назначенные пользователи класса (объединение admin + master + slaves). */
    get users(){
        return new AsyncPromise(async ()=>{
            const [admins, masters, slaves] = await Promise.all([
                this.admins,
                this.masters,
                this.slaves,
            ]);
            const all = [...admins, ...masters, ...slaves];
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
$class.steps = Object.create(null);