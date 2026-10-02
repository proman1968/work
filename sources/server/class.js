import * as fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
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
import * as LINKS from './access/links.js';

const ACCESS_DENIED = 'Доступ запрещён';

/** Кэш нормализованных ROLES по объекту DATA (DATA пересобирается при reset/init). */
const declaredRolesCache = new WeakMap();

/** День пакета DATA из штампа времени: YYYY-MM-DD (папки дня при записи). */
function _dataDay(time) {
    const dt = new Date(Number(time));
    const s = typeof dt.toISOTimezoneString === 'function' ? dt.toISOTimezoneString() : dt.toISOString();
    return String(s).slice(0, 10);
}

/** Привести значение к типу поля (как импорт: число/булево; остальное как есть). */
function coerceDataValue(value, type, id) {
    const t = String(type || '').toLowerCase();
    if (/number|int|float|money|decimal/.test(t)) {
        const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
        if (!Number.isFinite(n))
            throw new Error('поле «' + id + '» — не число: ' + value);
        return n;
    }
    if (/bool/.test(t))
        return /^(1|да|true|yes|y|истина)$/i.test(String(value).trim());
    return value;
}
/** Фильтр where из HTTP приходит JSON-строкой — разобрать; мусор — в null. */
function _parseWhere(where) {
    if (where == null || typeof where === 'object')
        return where || null;
    if (typeof where !== 'string')
        return null;
    try {
        const obj = JSON.parse(where);
        return obj && typeof obj === 'object' ? obj : null;
    }
    catch { return null; }
}
/** Фильтр where по телу объекта: равенство, [..] как $in, {gte,lte,gt,lt,ne,eq,in,like}. */
function matchDataWhere(body, where) {
    if (!where || typeof where !== 'object')
        return true;
    for (const [f, c] of Object.entries(where)) {
        const v = body?.[f];
        if (c != null && typeof c === 'object' && !Array.isArray(c)) {
            for (const [op, arg] of Object.entries(c)) {
                if (op === 'gte' && !(v >= arg)) return false;
                else if (op === 'lte' && !(v <= arg)) return false;
                else if (op === 'gt' && !(v > arg)) return false;
                else if (op === 'lt' && !(v < arg)) return false;
                else if (op === 'ne' && !(v !== arg)) return false;
                else if (op === 'eq' && !(v === arg)) return false;
                else if (op === 'in' && !(Array.isArray(arg) && arg.includes(v))) return false;
                else if (op === 'like' && !String(v ?? '').toLowerCase().includes(String(arg).toLowerCase())) return false;
            }
        }
        else if (Array.isArray(c)) {
            if (!c.includes(v)) return false;
        }
        else if (v !== c) return false;
    }
    return true;
}
/** Есть ли файлы объектов под папкой (история `.…` не считается). */
async function _hasDataFiles(dir) {
    const stack = [dir];
    while (stack.length) {
        const cur = stack.pop();
        let entries;
        try {
            entries = await fsp.readdir(cur, { withFileTypes: true });
        }
        catch { continue; }
        for (const e of entries) {
            if (e.name.startsWith('.'))
                continue;
            if (e.isDirectory())
                stack.push(path.join(cur, e.name));
            else if (e.isFile())
                return true;
        }
    }
    return false;
}
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

/** Хеш описания индекса (смена описания — пересборка). */
function _indexHash(def) {
    const s = JSON.stringify(def && typeof def === 'object' ? { ...def, builtAt: undefined } : def);
    let h = 5381;
    for (let i = 0; i < s.length; i++)
        h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
}

/** Ключ строки индекса по полям by (массив → JSON, разбор без коллизий). */
function _indexKey(def, body) {
    return JSON.stringify((def.by || []).map(f => body?.[f] ?? ''));
}

/** Разобрать ключ строки в значения полей by. */
function _indexKeyParts(def, key) {
    try {
        const parts = JSON.parse(key);
        if (Array.isArray(parts))
            return parts;
    }
    catch { /* старый формат */ }
    return [key];
}

/** Строка мер для тела объекта: {count} или суммы полей. */
function _measureRow(def, body) {
    const m = {};
    const measures = def.measures && typeof def.measures === 'object' ? def.measures : { count: 'count' };
    for (const [k, op] of Object.entries(measures)) {
        if (op === 'count')
            m[k] = 1;
        else if (op === 'sum')
            m[k] = Number(body?.[k]) || 0;
    }
    return m;
}

/** Сложить строки мер (sign=+1/-1). Нулевые строки вычищаются. */
function _addRows(into, key, row, sign) {
    const cur = into[key] || {};
    for (const [k, v] of Object.entries(row)) {
        const n = (Number(cur[k]) || 0) + sign * (Number(v) || 0);
        if (n)
            cur[k] = n;
        else
            delete cur[k];
    }
    if (Object.keys(cur).length)
        into[key] = cur;
    else
        delete into[key];
    return into;
}

/** Очередь записи по файлу индекса (один процесс — цепочки промисов). */
const _indexLocks = new Map();
async function _lockedJson(abs, fn) {
    const prev = _indexLocks.get(abs) || Promise.resolve();
    let release;
    const cur = new Promise(r => { release = r; });
    _indexLocks.set(abs, prev.then(() => cur));
    await prev;
    try {
        let doc = {};
        try {
            doc = JSON.parse(await fsp.readFile(abs, 'utf-8'));
        }
        catch { /* нет файла */ }
        const next = await fn(doc && typeof doc === 'object' ? doc : {});
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, JSON.stringify(next), 'utf-8');
        return next;
    }
    finally {
        release();
        if (_indexLocks.get(abs) === cur)
            _indexLocks.delete(abs);
    }
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
        return Object.assign({ FIELDS: [], STATIC: [] }, this.DATA?.METADATA || {})
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
    /**
     * Разделить входящий class.js на собственную часть (meta/class.js)
     * и наследуемую однотипными потомками ($distr_folder/class.js).
     * Явные флаги: to_inherit:true — только в inherit; false — только в self.
     * Без флагов в inherit уходит только явно помеченное, КРОМЕ содержимого
     * METADATA.FIELDS/INDEXES/POSTINGS: схема и правила наследуются всегда
     * (кроме явного отказа) — и остаются в self тоже.
     * @param {object|Array} data Входящий class.js
     * @param {boolean|'schema'} [dflt] Поведение потомков без флагов: false — только self;
     * true — в inherit целиком и в self; 'schema' — как true для FIELDS/INDEXES/POSTINGS.
     */
    static separateInheritData(data, dflt = false) {
        const nonEmpty = (v) => Array.isArray(v) ? v.length > 0
            : (v && (typeof v !== 'object' || Object.keys(v).length > 0));
        if (Array.isArray(data)) {
            const selfData = [];
            const inheritData = [];
            let hasInherit = false;
            for (const item of data) {
                if (item?.to_inherit === false) {
                    selfData.push(item);
                    continue;
                }
                const [selfItem, inheritItem, itemHasInherit] = this.separateInheritData(item, false);
                if (item?.to_inherit === true || dflt === true) {
                    inheritData.push(item);
                    hasInherit = true;
                }
                else if (itemHasInherit && inheritItem != null) {
                    if (nonEmpty(inheritItem)) {
                        const packed = item?.id != null && typeof inheritItem === 'object' && !Array.isArray(inheritItem)
                            ? Object.assign({ id: item.id }, inheritItem)
                            : inheritItem;
                        inheritData.push(packed);
                        hasInherit = true;
                    }
                }
                if (item?.to_inherit !== true && selfItem != null) {
                    if (nonEmpty(selfItem)) {
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
            const schemaKeys = dflt === 'schema' ? new Set(['FIELDS', 'INDEXES', 'POSTINGS']) : null;
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
                const childDflt = dflt === true || schemaKeys?.has(key) ? true : false;
                const [selfValue, inheritValue, valueHasInherit] = this.separateInheritData(value, childDflt);
                if (value?.to_inherit === true || dflt === true) {
                    inheritData[key] = value;
                    hasInherit = true;
                }
                else if (valueHasInherit && inheritValue != null) {
                    if (nonEmpty(inheritValue)) {
                        inheritData[key] = inheritValue;
                        hasInherit = true;
                    }
                }
                if (value?.to_inherit !== true && selfValue != null) {
                    if (nonEmpty(selfValue)) {
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
     * DATA/INDEX/logs — не роли: их зоной не объявить.
     */
    async work_zone(params = {}){
        const role = params.role || 'GUEST';
        if (!POLICY.isRoleId(role) || POLICY.RESERVED_ZONE_NAMES.includes(role))
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
        if (this.type === '$group')
            LINKS.reset();

        return true;
    }
    async save_file(params = {}){
        // Лента — системная операция: всегда запись дня `<мета>/logs/ГГГГ-ММ-ДД/{время}.{автор}.logs`
        // (одна запись — один файл: права, RAG и индекс лент работают по записям),
        // независимо от того, объявлен ли тип $file/$logs в дереве.
        if (params.filename === 'data.logs') {
            if (params.session && params.session.$user !== globalThis.WORK)
                throw new Error(ACCESS_DENIED);
            const folder = await this.meta_folder._get_next_item('logs', FS.$folder);
            return folder.save_data_file(params);
        }
        // Объекты общей зоны — в <мета>/DATA/<дата>/, а не в зону роли.
        // Прямая запись доступна только write=all (ADMIN, см. POLICY.canWrite);
        // остальные пишут через метод-владелец create_object.
        if (params.filename && await this.is_data_zone_type(params.filename)) {
            const storage = await this.data_zone(params);
            return storage.save_file(params);
        }
        const storage = await this.work_zone(params);
        const folder = await storage.getFolderToSaveFile(params);
        return folder.save_file(params);
    }
    async get_write_stream(params) {
        if (params.filename && await this.is_data_zone_type(params.filename)) {
            const storage = await this.data_zone(params);
            return storage.get_write_stream(params);
        }
        const storage = await this.work_zone(params);
        const folder = await storage.getFolderToSaveFile(params);
        return folder.get_write_stream(params);
    }
    /** Расширения объектов, живущие в общей зоне DATA (не в зонах ролей).
     * Почта/календарь/задачи (.eml/.ics/.task/.call) остаются в зонах ролей
     * до миграции их читателей — см. docs/storage-architecture.md. */
    static DATA_EXTS = ['data'];
    /** Расширение (или имя файла) — объект общей зоны DATA этого класса? */
    async is_data_zone_type(extOrName) {
        const ext = FS.$file.fileExt(extOrName)
            || String(extOrName || '').replace(/^\$/, '').toLowerCase();
        if (!ext || !this.constructor.DATA_EXTS.includes(ext))
            return false;
        return this.is_data_type(extOrName);
    }
    /** Общая зона DATA метапапки: объекты всех ролей. */
    async data_zone(params = {}) {
        return this.meta_folder._get_next_item('DATA', FS.$folder);
    }
    /**
     * Создать объект в общей зоне DATA. Метод-владелец для записи объектов:
     * ADMIN (write=all, локально или сверху) — всё; USER с локальным назначением
     * в точке — свои объекты; остальные — только чтение.
     * Прямая запись в DATA через save_file доступна только write=all.
     * @param {object} [params] {filename | name, type | ext, post | body, session}
     */
    async create_object(params = {}) {
        await this._assertDataWrite(params);
        await this._assertLeaf();
        const ext = String(params.type || params.ext || FS.$file.fileExt(params.filename || '') || 'data')
            .replace(/^\$/, '').toLowerCase();
        if (!this.constructor.DATA_EXTS.includes(ext) || !(await this.is_data_type('x.' + ext)))
            throw new Error('create_object: нет типа данных $' + ext);
        const stem = String(params.filename || params.name || 'obj').split('/').pop().replace(/\.[a-z0-9]+$/i, '').trim() || 'obj';
        const body = await this._validateObject(this._readDataBody(params.post ?? params.body));
        body.name ??= stem;
        await this._checkUnique(this._indexDefs(), body, null);
        const zone = await this.data_zone(params);
        const res = await zone.save_data_file({ ...params, filename: stem + '.' + ext, post: body });
        await this._indexWrite(null, { ...body, time: res.time }, res.id);
        return res;
    }
    /**
     * Доступ пользователя к классу ('admin'|'write'|'read'|null): прямые назначения
     * плюс ссылки рабочих мест (LINKS) для прикладных классов.
     */
    async data_access(params = {}) {
        return LINKS.dataAccess(this, params);
    }
    /**
     * Цепочки ссылок рабочего места для дерева: LINKS группы и их предки
     * до корня типа (вниз и вбок — ничего). Клиент зеркалит структуру.
     * @param {object} [params]
     * @returns {Promise<Array>} [{path, label, icon, type, access, children}]
     */
    async link_tree(params = {}) {
        if (this.type !== '$group')
            return [];
        await this.init;
        const raw = Array.isArray(this.DATA?.LINKS) ? this.DATA.LINKS : [];
        const roles = await this.roles(params).catch(() => []);
        const admin = roles.includes('ADMIN') || await this._isWorkAdmin(params).catch(() => false);
        if (!roles.length && !admin)
            return [];
        const rank = { read: 1, write: 2, admin: 3 };
        const eff = new Map();
        for (const l of raw) {
            const id = String(l?.id || '').trim();
            const access = String(l?.access || '').trim();
            if (!id.startsWith('/') || (access !== 'read' && access !== 'write'))
                continue;
            const level = admin ? (access === 'write' ? 'admin' : 'read')
                : roles.includes('USER') ? access : 'read';
            if ((rank[level] || 0) > (rank[eff.get(id)] || 0))
                eff.set(id, level);
        }
        const byPath = new Map();
        const roots = [];
        for (const [id, level] of eff) {
            const segs = id.split('/').filter(Boolean);
            let prefix = '', parent = null;
            segs.forEach((seg, i) => {
                prefix += '/' + seg;
                let n = byPath.get(prefix);
                if (!n) {
                    n = { path: prefix, label: seg, icon: '', type: '', access: 'read', children: [] };
                    byPath.set(prefix, n);
                    if (parent)
                        parent.children.push(n);
                    else
                        roots.push(n);
                }
                if (i === segs.length - 1 && (rank[level] || 0) > (rank[n.access] || 0))
                    n.access = level;
                parent = n;
            });
        }
        // Подписи метками классов (внутренний обход — без проверок доступа,
        // читать цепочку разрешено самим фактом членства в группе).
        for (const n of byPath.values()) {
            try {
                let t = await globalThis.WORK.get_item(n.path);
                if (Array.isArray(t))
                    t = t.at(-1);
                if (!t)
                    continue;
                await t.init;
                n.label = t.DATA?.label || t.name || n.label;
                n.icon = t.DATA?.icon || '';
                n.type = t.type || '';
            }
            catch { /* сегмент как есть */ }
        }
        const sort = (arr) => {
            arr.sort((a, b) => String(a.label).localeCompare(String(b.label), 'ru'));
            arr.forEach(n => sort(n.children));
        };
        sort(roots);
        return roots;
    }
    /**
     * Право писать объекты точки (create/update/delete): системная сессия
     * или доступ уровня write/admin (назначения либо ссылки рабочих мест).
     * @returns {Promise<string>} uid автора
     */
    async _assertDataWrite(params = {}) {
        if (params.session?.$user === globalThis.WORK)
            return globalThis.WORK?.id || 'system';
        const uid = this.constructor.resolveUid(params);
        if (!uid || !(await this.canSee(this, params)))
            throw new Error(ACCESS_DENIED);
        const level = await this.data_access(params);
        if (level !== 'write' && level !== 'admin')
            throw new Error(ACCESS_DENIED);
        return uid;
    }
    /** Тело объекта из params.post|body: объект — как есть, строка — JSON. */
    _readDataBody(post) {
        if (post && typeof post === 'object' && !Buffer.isBuffer(post) && post.path == null)
            return { ...post };
        if (typeof post === 'string' && post.trim()) {
            const obj = JSON.parse(post);
            if (obj && typeof obj === 'object' && !Array.isArray(obj))
                return { ...obj };
        }
        throw new Error('тело объекта — JSON-объект');
    }
    /**
     * Прочитать объект по id `{time}.{uid}` (адрес вычисляется из id: DATA/день/файл).
     * @returns {Promise<{abs, leaf, stem, ext, date, body}|null>}
     */
    async _readById(id, ext = 'data') {
        let stem = String(id ?? '').split('/').pop().trim();
        if (stem.endsWith('.' + ext))
            stem = stem.slice(0, -(ext.length + 1));
        const time = Number(stem.split('.')[0]);
        if (!stem || !Number.isFinite(time))
            return null;
        const date = _dataDay(time);
        const abs = this.meta_folder.dir + '/DATA/' + date + '/' + stem + '.' + ext;
        if (!fs.existsSync(abs))
            return null;
        let body;
        try {
            body = JSON.parse(await fsp.readFile(abs, 'utf-8'));
        }
        catch { return null; }
        return { abs, leaf: stem + '.' + ext, stem, ext, date, body };
    }
    /**
     * Проверить тело объекта по METADATA.FIELDS класса: обязательные поля,
     * приведение типов (число/булево), ссылки Link на объекты справочников.
     * Лишние поля разрешены.
     */
    async _validateObject(body) {
        const fields = (this.METADATA?.FIELDS || []).filter(f => f?.id);
        for (const f of fields) {
            // name/time ставит хранилище — обязательность не проверяем
            if ((f.id === 'name' || f.id === 'time') && (body[f.id] == null || body[f.id] === ''))
                continue;
            if (f.required && (body[f.id] == null || body[f.id] === ''))
                throw new Error('нет обязательного поля «' + f.id + '»');
        }
        for (const f of fields) {
            if (body[f.id] == null || body[f.id] === '')
                continue;
            body[f.id] = coerceDataValue(body[f.id], f.type, f.id);
        }
        for (const f of fields.filter(f => f.type === 'Link' && f.catalog)) {
            const v = body[f.id];
            if (v == null || v === '')
                continue;
            if (!(await this.constructor._linkExists(f.catalog, String(v))))
                throw new Error('поле «' + f.id + '»: нет объекта ' + v + ' в ' + f.catalog);
        }
        return body;
    }
    /**
     * Есть ли объект с id в справочнике (или его подклассах).
     * @param {string} catalogPath Путь класса справочника
     * @param {string} id id объекта `{time}.{uid}`
     */
    static async _linkExists(catalogPath, id) {
        let cat;
        try {
            cat = await globalThis.WORK.get_item(catalogPath);
        }
        catch { return false; }
        if (Array.isArray(cat))
            cat = cat.at(-1);
        if (!(cat instanceof FS.$class))
            return false;
        const sys = { session: { $user: globalThis.WORK }, skipAccess: true };
        for (const pt of await cat._subtreeDataPoints(sys)) {
            if (await pt.cls._readById(id))
                return true;
        }
        return false;
    }
    /**
     * Прочитать объект справочника для показа ссылки: `{ id, name, path }`.
     * @param {object} [params] {catalog, id, session}
     */
    async read_link(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        const catalogPath = String(params.catalog || '');
        const id = String(params.id || '');
        if (!catalogPath || !id)
            throw new Error('read_link: нужны catalog и id');
        let cat = await globalThis.WORK.get_item(catalogPath);
        if (Array.isArray(cat))
            cat = cat.at(-1);
        if (!(cat instanceof FS.$class))
            throw new Error('read_link: нет справочника ' + catalogPath);
        if (!(await cat.canSee(cat, params)))
            throw new Error(ACCESS_DENIED);
        for (const pt of await cat._subtreeDataPoints(params)) {
            const found = await pt.cls._readById(id);
            if (found)
                return { id: found.stem, name: found.body?.name ?? found.stem, path: pt.path + '/' + found.leaf };
        }
        throw new Error('read_link: нет объекта ' + id);
    }
    /** Собственные дочерние классы того же типа (без унаследованных). */
    async _ownSameTypeChildren() {
        let entries;
        try {
            entries = await fsp.readdir(this.real_dir, { withFileTypes: true });
        }
        catch { return []; }
        const out = [];
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('$'))
                continue;
            let item;
            try {
                item = await globalThis.WORK.get_item(this.path + '/' + e.name);
            }
            catch { continue; }
            const cls = Array.isArray(item) ? item.at(-1) : item;
            if (cls instanceof FS.$class && cls.type === this.type)
                out.push(cls);
        }
        return out;
    }
    /** Объекты — только в листьях: нет однотипных детей. */
    async _assertLeaf() {
        const kids = await this._ownSameTypeChildren();
        if (kids.length)
            throw new Error('объекты — только в листьях: есть дочерние классы (' + kids.map(k => k.id).join(', ') + ')');
    }
    /**
     * Убрать текущую версию объекта в историю: `.{leaf}/history/<дата>/{now}.{uid}.data`.
     * @returns {Promise<{time, date}>} Метка снимка
     */
    async _archiveDataVersion(found, prevText, uid) {
        const now = Date.now();
        const dt = new Date(now);
        const stamp = typeof dt.toISOTimezoneString === 'function' ? dt.toISOTimezoneString() : dt.toISOString();
        const date = stamp.slice(0, 10).split('.').toReversed().join('-');
        const hdir = path.join(path.dirname(found.abs), '.' + found.leaf, 'history', date);
        fs.mkdirSync(hdir, { recursive: true });
        let t = now;
        for (let i = 0; i < 1000; i++, t++) {
            try {
                await fsp.writeFile(path.join(hdir, t + '.' + uid + '.' + found.ext), prevText, { encoding: 'utf-8', flag: 'wx' });
                break;
            }
            catch (e) {
                if (e.code !== 'EEXIST')
                    throw e;
            }
        }
        return { time: t, date };
    }
    /**
     * Записать лог-факт о файле объекта (создание/правка/удаление) и сбросить кэши.
     * @returns {Promise<object>} Строка лога (logFullPath — путь файла)
     */
    async _logDataFile(found, json, params, uid) {
        const zone = await this.data_zone();
        const folder = await zone._get_next_item(found.date, FS.$folder);
        const file = await folder._get_next_item(found.leaf, FS.$file);
        const now = Date.now();
        const session = params.session?.$user === globalThis.WORK ? params.session : {
            uid,
            $user: params.session?.$user || params.session,
            ...(params.session?.principal ? { principal: params.session.principal } : {}),
        };
        const res = await FS.$file.save_to_log.call(file, {
            ...params,
            post: json,
            message: json,
            time: now,
            dateTime: new Date(now),
            session,
        });
        folder.reset();
        zone.reset();
        this.reset();
        return res;
    }
    /**
     * Править объект: новая версия на месте (имя файла стабильно — ссылки `{time}.{uid}` не рвутся),
     * прежняя — в историю. Удалённый правится только с `restore: true`.
     * @param {object} [params] {filename | name, post | body, restore?, session}
     */
    async update_object(params = {}) {
        const uid = await this._assertDataWrite(params);
        const ext = String(params.type || params.ext || 'data')
            .replace(/^\$/, '').toLowerCase();
        if (!this.constructor.DATA_EXTS.includes(ext))
            throw new Error('update_object: только объекты DATA (сейчас: ' + this.constructor.DATA_EXTS.join(', ') + ')');
        const found = await this._readById(params.id, ext);
        if (!found)
            throw new Error('update_object: нет объекта ' + params.id);
        if (found.body.deleted && !params.restore)
            throw new Error('update_object: объект удалён (restore: true — восстановить)');
        const patch = this._readDataBody(params.post ?? params.body);
        const body = await this._validateObject({ ...found.body, ...patch, time: found.body.time });
        if (params.restore) {
            delete body.deleted;
            delete body.deleted_at;
        }
        await this._checkUnique(this._indexDefs(), body, found.stem);
        const json = JSON.stringify(body);
        await this._archiveDataVersion(found, JSON.stringify(found.body), uid);
        await fsp.writeFile(found.abs, json, 'utf-8');
        await this._indexWrite(found.body, body, found.stem);
        return this._logDataFile(found, json, params, uid);
    }
    /**
     * Удалить объект: отметка `deleted` (файл физически остаётся, прежняя версия — в истории).
     * @param {object} [params] {filename | name, session}
     */
    async delete_object(params = {}) {
        const uid = await this._assertDataWrite(params);
        const ext = String(params.type || params.ext || 'data')
            .replace(/^\$/, '').toLowerCase();
        if (!this.constructor.DATA_EXTS.includes(ext))
            throw new Error('delete_object: только объекты DATA (сейчас: ' + this.constructor.DATA_EXTS.join(', ') + ')');
        const found = await this._readById(params.id, ext);
        if (!found)
            throw new Error('delete_object: нет объекта ' + params.id);
        if (found.body.deleted)
            throw new Error('delete_object: объект уже удалён');
        const body = { ...found.body, deleted: true, deleted_at: Date.now() };
        const json = JSON.stringify(body);
        await this._archiveDataVersion(found, JSON.stringify(found.body), uid);
        await fsp.writeFile(found.abs, json, 'utf-8');
        await this._indexWrite(found.body, body, found.stem);
        return this._logDataFile(found, json, params, uid);
    }
    /**
     * Прочитать текущую версию объекта (включая удалённый — по флагу `deleted` в теле).
     * @param {object} [params] {filename | name, session}
     */
    async read_object(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        const ext = String(params.type || params.ext || 'data')
            .replace(/^\$/, '').toLowerCase();
        const found = await this._readById(params.id, ext);
        if (!found)
            throw new Error('read_object: нет объекта ' + params.id);
        return { path: found.abs, name: found.body?.name ?? found.stem, body: found.body };
    }
    /**
     * Выборка объектов поддерева того же типа (сам класс + потомки): источник правды — файлы,
     * не индекс. Открываются только пакеты дней из [from, to]. Удалённые скрыты без `include_deleted`.
     * @param {object} [params] {where, from?, to?, ext?, include_deleted?, limit?, order?, session}
     */
    async query(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        const ext = String(params.ext || params.type || 'data').replace(/^\$/, '').toLowerCase();
        const limit = Math.max(1, Math.min(500, Number(params.limit) || 50));
        const desc = String(params.order || 'desc').toLowerCase() !== 'asc';
        const dayOf = (v) => {
            const t = new Date(v).getTime();
            return Number.isFinite(t) ? _dataDay(t) : null;
        };
        const from = params.from != null ? dayOf(params.from) : null;
        const to = params.to != null ? dayOf(params.to) : null;
        const where = _parseWhere(params.where);
        const out = [];
        for (const pt of await this._subtreeDataPoints(params)) {
            const root = pt.dataDir;
            if (!fs.existsSync(root))
                continue;
            for (const d of await fsp.readdir(root, { withFileTypes: true })) {
                if (!d.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(d.name))
                    continue;
                if ((from && d.name < from) || (to && d.name > to))
                    continue;
                for (const leaf of await fsp.readdir(path.join(root, d.name))) {
                    if (!leaf.endsWith('.' + ext))
                        continue;
                    let body;
                    try {
                        body = JSON.parse(await fsp.readFile(path.join(root, d.name, leaf), 'utf-8'));
                    }
                    catch { continue; }
                    if (body?.deleted && !params.include_deleted)
                        continue;
                    if (!matchDataWhere(body, where))
                        continue;
                    out.push({ point: pt.path, path: pt.virtual + '/' + d.name + '/' + leaf, name: body?.name ?? leaf.slice(0, -(ext.length + 1)), time: body?.time ?? 0, body });
                }
            }
        }
        out.sort((a, b) => desc ? b.time - a.time : a.time - b.time);
        return out.slice(0, limit);
    }
    /**
     * Суммы числовых полей объектов поддерева за период — прямо из файлов (без индекса и лимита).
     * Для внутренних отчётов, когда у класса нет подходящего индекса. Доступ проверяет вызывающий.
     * @param {object} [params] {from?, to?, fields?: ['debit','credit'], ext?}
     * @returns {Promise<Record<string, number>>}
     */
    async _sumData(params = {}) {
        const ext = String(params.ext || 'data').replace(/^\$/, '').toLowerCase();
        const fields = Array.isArray(params.fields) && params.fields.length ? params.fields : ['debit', 'credit'];
        const dayOf = (v) => {
            const t = new Date(v).getTime();
            return Number.isFinite(t) ? _dataDay(t) : null;
        };
        const from = params.from != null ? dayOf(params.from) : null;
        const to = params.to != null ? dayOf(params.to) : null;
        const sums = Object.fromEntries(fields.map(f => [f, 0]));
        for (const pt of await this._subtreeDataPoints({ skipAccess: true })) {
            if (!fs.existsSync(pt.dataDir))
                continue;
            for (const d of await fsp.readdir(pt.dataDir, { withFileTypes: true })) {
                if (!d.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(d.name))
                    continue;
                if ((from && d.name < from) || (to && d.name > to))
                    continue;
                for (const leaf of await fsp.readdir(path.join(pt.dataDir, d.name))) {
                    if (!leaf.endsWith('.' + ext))
                        continue;
                    let body;
                    try {
                        body = JSON.parse(await fsp.readFile(path.join(pt.dataDir, d.name, leaf), 'utf-8'));
                    }
                    catch { continue; }
                    if (body?.deleted)
                        continue;
                    for (const f of fields)
                        sums[f] += Number(body?.[f]) || 0;
                }
            }
        }
        return sums;
    }
    /**
     * Прочитать индекс: turnover/state/table/lookup — из файлов;
     * balance — сальдо на дату (сумма оборотов с начала истории).
     * @param {object} [params] {id, from?, to?|at?, where?, group?, limit?, session}
     */
    async index(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        // Предок по ссылке виден как страница (grants SYSTEM), но его INDEX —
        // агрегат всего поддерева с чужими ветками. Итоги — только при data_access
        // (назначения + ссылки вниз); обходы ядра — как в assertAccess.
        if (params?.session && !DEV_MODE && params.session?.$user !== globalThis.WORK
            && !(await this._isWorkAdmin(params).catch(() => false))
            && !this.DATA?.['#security']?.USERS?.includes('GUEST')) {
            if ((await this.data_access(params).catch(() => null)) == null)
                throw new Error(ACCESS_DENIED);
        }
        const defs = this._indexDefs();
        const def = defs.find(d => d.id === params.id);
        if (!def)
            throw new Error('index: нет индекса «' + params.id + '» (есть: ' + defs.map(d => d.id).join(', ') + ')');
        await this._assertIndexFresh(def);
        const limit = Math.max(1, Math.min(2000, Number(params.limit) || 500));
        const where = _parseWhere(params.where);
        if (def.kind === 'balance') {
            const target = defs.find(d => d.id === (def.from || 'turnover'));
            if (!target || target.kind === 'balance')
                throw new Error('index: balance без оборотов (from: ' + (def.from || 'turnover') + ')');
            const at = params.at ?? params.to ?? Date.now();
            const rows = await this._readTurnover(target, null, _dataDay(new Date(at).getTime()), where, params.group);
            return { def: def.id, kind: 'balance', at, ...this._packRows(target, rows, params.group, limit) };
        }
        if (def.kind === 'turnover' || def.kind === 'state') {
            const dayOf = (v) => {
                const t = new Date(v).getTime();
                return Number.isFinite(t) ? _dataDay(t) : null;
            };
            const rows = def.kind === 'state'
                ? await this._readState(def, where, params.group)
                : await this._readTurnover(def, params.from != null ? dayOf(params.from) : null, params.to != null ? dayOf(params.to) : null, where, params.group);
            return { def: def.id, kind: def.kind, ...this._packRows(def, rows, params.group, limit) };
        }
        if (def.kind === 'table') {
            const dayOf = (v) => {
                const t = new Date(v).getTime();
                return Number.isFinite(t) ? _dataDay(t) : null;
            };
            const rows = await this._readTable(def, params.from != null ? dayOf(params.from) : null, params.to != null ? dayOf(params.to) : null, where);
            rows.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
            return { def: def.id, kind: 'table', rows: rows.slice(0, limit), total: { count: rows.length }, truncated: rows.length > limit };
        }
        if (def.kind === 'lookup') {
            const rows = await this._readLookup(def, where);
            return { def: def.id, kind: 'lookup', rows: rows.slice(0, limit), total: { count: rows.length }, truncated: rows.length > limit };
        }
        throw new Error('index: вид «' + def.kind + '» — этап 5б');
    }
    /** Собрать строки в ответ: фильтр where, группировка, total. */
    _packRows(def, rows, group, limit) {
        let list = Object.entries(rows).map(([key, measures]) => ({
            key,
            fields: Object.fromEntries((def.by || []).map((f, i) => [f, _indexKeyParts(def, key)[i] ?? ''])),
            ...measures,
        }));
        if (group && Array.isArray(group) && group.length) {
            const by = (def.by || []).filter(f => group.includes(f));
            const merged = {};
            for (const r of list) {
                const key = JSON.stringify(by.map(f => r.fields[f] ?? ''));
                merged[key] = merged[key] || { key, fields: Object.fromEntries(by.map(f => [f, r.fields[f] ?? ''])), };
                for (const [k, v] of Object.entries(r)) {
                    if (k === 'key' || k === 'fields')
                        continue;
                    merged[key][k] = (Number(merged[key][k]) || 0) + (Number(v) || 0);
                }
            }
            list = Object.values(merged);
        }
        list.sort((a, b) => String(a.key) < String(b.key) ? -1 : 1);
        const total = {};
        for (const r of list)
            for (const [k, v] of Object.entries(r)) {
                if (k === 'key' || k === 'fields')
                    continue;
                total[k] = (Number(total[k]) || 0) + (Number(v) || 0);
            }
        return { rows: list.slice(0, limit), total, truncated: list.length > limit };
    }
    /** Файлы пирамиды turnover, покрывающие [from, to] (дни — YYYY-MM-DD или null). */
    async _indexPieces(def, from, to) {
        const dir = this.meta_folder.dir + '/INDEX/' + def.id;
        if (!fs.existsSync(dir))
            return { years: [], months: [], days: [] };
        const years = new Set(), months = new Set(), days = new Set();
        for (const f of await fsp.readdir(dir)) {
            let m = f.match(/^(\d{4})\.json$/);
            if (m) {
                years.add(m[1]);
                continue;
            }
            m = f.match(/^(\d{4}-\d{2})\.json$/);
            if (m) {
                months.add(m[1]);
                continue;
            }
            m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
            if (m)
                days.add(m[1]);
        }
        // кусок берётся целиком, только если лежит внутри периода; иначе спуск к более мелким
        // (год → месяцы → дни): иначе частично пересекающийся год/месяц завышал бы итог
        const within = (a, b) => (from == null || a >= from) && (to == null || b <= to);
        const lastDay = (ym) => String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, '0');
        const take = { years: [], months: [], days: [] };
        for (const y of years) {
            if (within(y + '-01-01', y + '-12-31'))
                take.years.push(y);
        }
        const coveredYear = (m) => take.years.includes(m.slice(0, 4));
        for (const m of months) {
            if (coveredYear(m))
                continue;
            if (within(m + '-01', m + '-' + lastDay(m)))
                take.months.push(m);
        }
        const coveredMonth = (d) => coveredYear(d.slice(0, 4)) || take.months.includes(d.slice(0, 7));
        for (const d of days) {
            if (coveredMonth(d))
                continue;
            if (within(d, d))
                take.days.push(d);
        }
        return take;
    }
    /** Сумма оборотов по кускам пирамиды. */
    async _readTurnover(def, from, to, where, group) {
        const take = await this._indexPieces(def, from, to);
        const rows = {};
        const load = async (name) => {
            let doc;
            try {
                doc = JSON.parse(await fsp.readFile(this._indexFile(def, name), 'utf-8'));
            }
            catch { return; }
            for (const [key, row] of Object.entries(doc))
                _addRows(rows, key, row, +1);
        };
        for (const y of take.years)
            await load(y);
        for (const m of take.months)
            await load(m);
        for (const d of take.days)
            await load(d);
        if (!where && !group)
            return rows;
        const byOnly = {};
        if (where && typeof where === 'object') {
            for (const [f, c] of Object.entries(where)) {
                if ((def.by || []).includes(f))
                    byOnly[f] = c;
            }
        }
        const out = {};
        for (const [key, row] of Object.entries(rows)) {
            const probe = Object.fromEntries((def.by || []).map((f, i) => [f, _indexKeyParts(def, key)[i] ?? '']));
            if (!matchDataWhere(probe, byOnly))
                continue;
            _addRows(out, key, row, +1);
        }
        return out;
    }
    /** Текущее состояние: один файл. */
    async _readState(def, where, group) {
        let doc = {};
        try {
            doc = JSON.parse(await fsp.readFile(this._indexFile(def, 'current'), 'utf-8'));
        }
        catch { /* пусто */ }
        if (!where)
            return doc;
        const out = {};
        for (const [key, row] of Object.entries(doc)) {
            const probe = { ...row, ...Object.fromEntries((def.by || []).map((f, i) => [f, _indexKeyParts(def, key)[i] ?? ''])) };
            if (matchDataWhere(probe, where))
                out[key] = row;
        }
        return out;
    }
    /** Плоский список строк таблицы за период. */
    async _readTable(def, from, to, where) {
        const dir = this.meta_folder.dir + '/INDEX/' + def.id;
        const rows = [];
        if (!fs.existsSync(dir))
            return rows;
        for (const f of await fsp.readdir(dir)) {
            const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
            if (!m)
                continue;
            if ((from && m[1] < from) || (to && m[1] > to))
                continue;
            let doc;
            try {
                doc = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf-8'));
            }
            catch { continue; }
            for (const row of Object.values(doc)) {
                if (row && typeof row === 'object' && !matchDataWhere(row, where))
                    continue;
                rows.push(row);
            }
        }
        return rows;
    }
    /** Пары ключ→id за всю историю индекса. */
    async _readLookup(def, where) {
        const dir = this.meta_folder.dir + '/INDEX/' + def.id;
        const rows = [];
        if (!fs.existsSync(dir))
            return rows;
        for (const f of await fsp.readdir(dir)) {
            if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f))
                continue;
            let doc;
            try {
                doc = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf-8'));
            }
            catch { continue; }
            for (const [key, v] of Object.entries(doc)) {
                const ids = Array.isArray(v) ? v : [v];
                const row = { key, ids };
                if (where && !matchDataWhere(row, where))
                    continue;
                rows.push(row);
            }
        }
        rows.sort((a, b) => String(a.key) < String(b.key) ? -1 : 1);
        return rows;
    }
    /**
     * Пересобрать индекс из файлов (лист — из DATA, узел — суммой детей снизу вверх).
     * Только write=all. После смены описания — обязательно.
     */
    async rebuild_index(params = {}) {
        if (params.session?.$user !== globalThis.WORK && await this.data_access(params) !== 'admin')
            throw new Error(ACCESS_DENIED);
        const def = this._indexDefs().find(d => d.id === params.id);
        if (!def)
            throw new Error('rebuild_index: нет индекса «' + params.id + '»');
        if (def.kind === 'balance')
            return { def: def.id, kind: 'balance', rebuilt: false, note: 'у сальдо нет файлов' };
        const kids = await this._ownSameTypeChildren();
        const dir = this.meta_folder.dir + '/INDEX/' + def.id;
        if (kids.length) {
            for (const kid of kids)
                await kid.rebuild_index({ ...params });
            fs.rmSync(dir, { recursive: true, force: true });
            for (const kid of kids)
                await this._mergeChildIndex(def, kid);
        }
        else {
            fs.rmSync(dir, { recursive: true, force: true });
            await this._replayOwnData(def);
        }
        await this._indexMeta(def, true);
        this.reset();
        return { def: def.id, kind: def.kind, rebuilt: true };
    }
    /** Пересчитать индекс листа из собственной DATA по дням, затем свернуть месяцы и годы. */
    async _replayOwnData(def) {
        const root = this.meta_folder.dir + '/DATA';
        const days = {};
        if (fs.existsSync(root)) {
            for (const d of await fsp.readdir(root, { withFileTypes: true })) {
                if (!d.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(d.name))
                    continue;
                for (const leaf of await fsp.readdir(path.join(root, d.name))) {
                    if (!leaf.endsWith('.data'))
                        continue;
                    let body;
                    try {
                        body = JSON.parse(await fsp.readFile(path.join(root, d.name, leaf), 'utf-8'));
                    }
                    catch { continue; }
                    (days[d.name] = days[d.name] || []).push({ leaf, body });
                }
            }
        }
        const idOf = (leaf) => leaf.endsWith('.data') ? leaf.slice(0, -'.data'.length) : leaf;
        if (def.kind === 'table' || def.kind === 'lookup') {
            for (const [day, bodies] of Object.entries(days)) {
                const doc = {};
                for (const { leaf, body } of bodies) {
                    if (body?.deleted)
                        continue;
                    if (def.kind === 'table') {
                        const row = { id: idOf(leaf), time: body.time };
                        const fields = Array.isArray(def.fields) && def.fields.length ? def.fields
                            : (this.METADATA?.FIELDS || []).filter(f => f?.id && !f.secret).map(f => f.id);
                        for (const fid of fields) {
                            if (fid !== 'id' && fid !== 'time' && body[fid] !== undefined)
                                row[fid] = body[fid];
                        }
                        doc[idOf(leaf)] = row;
                    }
                    else {
                        const key = String(body[def.key] ?? '');
                        if (!key)
                            continue;
                        const oid = idOf(leaf);
                        if (def.unique)
                            doc[key] = oid;
                        else
                            doc[key] = [...(Array.isArray(doc[key]) ? doc[key] : []), oid].filter((x, i, a) => a.indexOf(x) === i);
                    }
                }
                if (Object.keys(doc).length) {
                    fs.mkdirSync(path.dirname(this._indexFile(def, day)), { recursive: true });
                    await fsp.writeFile(this._indexFile(def, day), JSON.stringify(doc), 'utf-8');
                }
            }
            return;
        }
        if (def.kind === 'turnover' || def.kind === 'state') {
            const doc = {};
            for (const pairs of Object.values(days)) {
                for (const { body } of pairs) {
                    const c = this._indexContrib(def, body);
                    if (!c)
                        continue;
                    const key = _indexKey(def, c);
                    _addRows(doc, key, _measureRow(def, c), +1);
                    if (def.kind === 'turnover') {
                        const day = _dataDay(c.time ?? Date.now());
                        const dayDoc = {};
                        _addRows(dayDoc, key, _measureRow(def, c), +1);
                        const abs = this._indexFile(def, day);
                        let prev = {};
                        try {
                            prev = JSON.parse(await fsp.readFile(abs, 'utf-8'));
                        }
                        catch { /* новый день */ }
                        _addRows(prev, key, _measureRow(def, c), +1);
                        fs.mkdirSync(path.dirname(abs), { recursive: true });
                        await fsp.writeFile(abs, JSON.stringify(prev), 'utf-8');
                    }
                }
            }
            if (def.kind === 'state') {
                if (Object.keys(doc).length) {
                    fs.mkdirSync(path.dirname(this._indexFile(def, 'current')), { recursive: true });
                    await fsp.writeFile(this._indexFile(def, 'current'), JSON.stringify(doc), 'utf-8');
                }
                return;
            }
            await this._rollupIndex(def);
            return;
        }
        throw new Error('rebuild_index: вид «' + def.kind + '» — этап 5б');
    }
    /** Свернуть месяцы из дней, годы из месяцев (turnover). */
    async _rollupIndex(def) {
        const dir = this.meta_folder.dir + '/INDEX/' + def.id;
        if (!fs.existsSync(dir))
            return;
        const months = {};
        for (const f of await fsp.readdir(dir)) {
            const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
            if (!m)
                continue;
            let doc;
            try {
                doc = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf-8'));
            }
            catch { continue; }
            const month = m[1].slice(0, 7);
            months[month] = months[month] || {};
            for (const [key, row] of Object.entries(doc))
                _addRows(months[month], key, row, +1);
        }
        for (const [month, doc] of Object.entries(months))
            await fsp.writeFile(path.join(dir, month + '.json'), JSON.stringify(doc), 'utf-8');
        const years = {};
        for (const [month, doc] of Object.entries(months)) {
            const y = month.slice(0, 4);
            years[y] = years[y] || {};
            for (const [key, row] of Object.entries(doc))
                _addRows(years[y], key, row, +1);
        }
        for (const [y, doc] of Object.entries(years))
            await fsp.writeFile(path.join(dir, y + '.json'), JSON.stringify(doc), 'utf-8');
    }
    /** Влить индекс ребёнка в свой (суммы — сложить, таблицы/ключи — объединить). */
    async _mergeChildIndex(def, kid) {
        const src = kid.meta_folder.dir + '/INDEX/' + def.id;
        if (!fs.existsSync(src))
            return;
        if (def.kind === 'turnover' || def.kind === 'state') {
            for (const f of await fsp.readdir(src)) {
                if (!/\.json$/.test(f) || f === '.meta.json')
                    continue;
                let doc;
                try {
                    doc = JSON.parse(await fsp.readFile(path.join(src, f), 'utf-8'));
                }
                catch { continue; }
                const abs = path.join(this.meta_folder.dir + '/INDEX/' + def.id, f);
                await _lockedJson(abs, prev => {
                    for (const [key, row] of Object.entries(doc))
                        _addRows(prev, key, row, +1);
                    return prev;
                });
            }
            return;
        }
        if (def.kind === 'table' || def.kind === 'lookup') {
            for (const f of await fsp.readdir(src)) {
                if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f))
                    continue;
                let doc;
                try {
                    doc = JSON.parse(await fsp.readFile(path.join(src, f), 'utf-8'));
                }
                catch { continue; }
                const abs = path.join(this.meta_folder.dir + '/INDEX/' + def.id, f);
                await _lockedJson(abs, prev => {
                    for (const [key, v] of Object.entries(doc)) {
                        if (def.kind === 'table') {
                            prev[key] = v;
                        }
                        else {
                            const cur = Array.isArray(prev[key]) ? prev[key] : (prev[key] != null ? [prev[key]] : []);
                            const add = Array.isArray(v) ? v : [v];
                            prev[key] = [...new Set([...cur, ...add])];
                            if (def.unique)
                                prev[key] = prev[key][0];
                        }
                    }
                    return prev;
                });
            }
            return;
        }
        throw new Error('rebuild_index: вид «' + def.kind + '» — этап 5б');
    }
    /**
     * Точки поддерева того же типа с зоной DATA: сам класс + потомки.
     * Спуск — только по дочерним классам того же типа (зоны ролей, logs, history не читаются).
     * @param {object} [params] сессия; {skipAccess: true} — только для внутренних проверок ядра
     * @returns {Promise<Array<{cls, path, virtual, dataDir}>>}
     */
    async _subtreeDataPoints(params = {}) {
        const pts = [];
        const seen = new Set();
        const push = async (cls) => {
            if (!cls || seen.has(cls.path))
                return;
            seen.add(cls.path);
            if (!params.skipAccess && !(await cls.canSee(cls, params)))
                return;
            pts.push({
                cls,
                path: cls.path,
                virtual: cls.path + '/' + cls.meta_folder.id + '/DATA',
                dataDir: cls.meta_folder.dir + '/DATA',
            });
        };
        await push(this);
        const walk = async (cls) => {
            for (const kid of await cls._ownSameTypeChildren()) {
                await push(kid);
                await walk(kid);
            }
        };
        await walk(this);
        return pts;
    }
    /**
     * Разделить класс: перенести DATA в существующий пустой дочерний класс того же типа.
     * После split у класса нет объектов — можно строить поддерево. Только write=all.
     * @param {object} [params] {child (id или путь), session}
     */
    async split(params = {}) {
        if (params.session?.$user !== globalThis.WORK && await this.data_access(params) !== 'admin')
            throw new Error(ACCESS_DENIED);
        const target = String(params.child ?? params.to ?? '').trim();
        if (!target)
            throw new Error('split: укажи child (id или путь класса)');
        let cls = await globalThis.WORK.get_item(target.startsWith('/') ? target : this.path + '/' + target)
            .catch(() => null);
        if (Array.isArray(cls))
            cls = cls.at(-1);
        if (!cls) {
            // потомка нет — создаём того же типа (leaf-правило здесь не действует:
            // DATA сразу переезжает в нового потомка)
            if (target.startsWith('/') || target.includes('/'))
                throw new Error('split: нет класса ' + target);
            const id = safeNodeName(target);
            if (!id)
                throw new Error('split: пустое имя класса');
            const ctor = FS[this.type] || FS.$class;
            await this._createClass(id, this.type, ctor, `export default {\n    label: '${target}'\n}`, { ...params, ignore_save_logs: true });
            cls = await globalThis.WORK.get_item(this.path + '/' + id);
            if (Array.isArray(cls))
                cls = cls.at(-1);
        }
        if (!(cls instanceof FS.$class))
            throw new Error('split: нет класса ' + target);
        if (cls.path === this.path)
            throw new Error('split: это тот же класс');
        if (!cls.path.startsWith(this.path + '/'))
            throw new Error('split: ' + cls.path + ' — не потомок');
        if (cls.type !== this.type)
            throw new Error('split: тип ' + cls.type + ' ≠ ' + this.type);
        const src = this.meta_folder.dir + '/DATA';
        if (!fs.existsSync(src))
            throw new Error('split: в классе нет DATA');
        const dst = cls.meta_folder.dir + '/DATA';
        if (fs.existsSync(dst)) {
            if (await _hasDataFiles(dst))
                throw new Error('split: в ' + cls.path + ' уже есть DATA');
            fs.rmSync(dst, { recursive: true, force: true });
        }
        fs.mkdirSync(cls.meta_folder.dir, { recursive: true });
        fs.renameSync(src, dst);
        this.reset();
        cls.reset();
        globalThis.WORK_RAG?.invalidate?.(src);
        globalThis.WORK_RAG?.invalidate?.(dst);
        for (const def of cls._indexDefs()) {
            if (def.kind === 'balance')
                continue;
            await cls.rebuild_index({ ...params, id: def.id });
        }
        for (const def of this._indexDefs()) {
            if (def.kind === 'balance')
                continue;
            await this.rebuild_index({ ...params, id: def.id });
        }
        return this.save_message({ message: 'split: DATA → ' + cls.path, session: params.session });
    }
    // ---------- INDEX ----------
    /**
     * Описания индексов точки: системный `table` + METADATA.INDEXES (слияние по id).
     * Виды: turnover (обороты, пирамида день→месяц→год), state (текущее, current.json),
     * table (плоский список по дням), lookup (ключ→id), balance (вид без файлов, из оборотов).
     * cascade/stats — этап 5б.
     */
    _indexDefs() {
        const map = new Map([['table', { id: 'table', kind: 'table' }]]);
        for (const d of this.METADATA?.INDEXES || []) {
            if (!d || !d.id)
                continue;
            if (d.off) {
                map.delete(d.id);
                continue;
            }
            map.set(d.id, { kind: 'turnover', by: [], ...d });
        }
        const out = [...map.values()];
        for (const d of out) {
            if (!['turnover', 'state', 'table', 'lookup', 'balance'].includes(d.kind))
                throw new Error('индекс «' + d.id + '»: вид «' + d.kind + '» — этап 5б (cascade/stats)');
            if (d.by != null && !Array.isArray(d.by))
                throw new Error('индекс «' + d.id + '»: by — массив полей');
            if (d.kind === 'lookup' && !d.key)
                throw new Error('индекс «' + d.id + '»: lookup без key');
        }
        return out;
    }
    /** Путь файла индекса: `<мета>/INDEX/<id>/<день|месяц|год|current>.json`, meta — `.meta.json`. */
    _indexFile(def, name) {
        return this.meta_folder.dir + '/INDEX/' + def.id + '/' + (name === '.meta' ? '.meta.json' : name + '.json');
    }
    /** Мета индекса (вид, хеш описания). write — записать заново. */
    async _indexMeta(def, write) {
        const abs = this._indexFile(def, '.meta');
        if (!write) {
            try {
                return JSON.parse(await fsp.readFile(abs, 'utf-8'));
            }
            catch { return null; }
        }
        const meta = { kind: def.kind, defHash: _indexHash(def), by: def.by || [], builtAt: Date.now() };
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, JSON.stringify(meta), 'utf-8');
        return meta;
    }
    /** Описание индекса не менялось после сборки (иначе — rebuild_index). */
    async _assertIndexFresh(def) {
        const meta = await this._indexMeta(def, false);
        if (meta && meta.defHash && meta.defHash !== _indexHash(def))
            throw new Error('индекс «' + def.id + '» устарел (описание изменилось): rebuild_index');
    }
    /** Вклад тела в индекс (null — тело не участвует: нет, удалено или мимо where). */
    _indexContrib(def, body) {
        if (!body || body.deleted)
            return null;
        if (def.kind === 'table' || def.kind === 'lookup' || def.kind === 'balance')
            return body;
        if (!matchDataWhere(body, def.where))
            return null;
        return body;
    }
    /**
     * Применить вклад тела к файлам индекса класса (без подъёма к предкам).
     * turnover — день/месяц/год; state — current.json; table/lookup — файл дня.
     */
    async _applyIndexOne(def, body, sign) {
        const day = _dataDay(body.time ?? Date.now());
        if (def.kind === 'turnover') {
            const key = _indexKey(def, body);
            const row = _measureRow(def, body);
            for (const name of [day, day.slice(0, 7), day.slice(0, 4)])
                await _lockedJson(this._indexFile(def, name), doc => _addRows(doc, key, row, sign));
        }
        else if (def.kind === 'state') {
            const key = _indexKey(def, body);
            const row = _measureRow(def, body);
            await _lockedJson(this._indexFile(def, 'current'), doc => _addRows(doc, key, row, sign));
        }
        else if (def.kind === 'table') {
            const fields = Array.isArray(def.fields) && def.fields.length ? def.fields
                : (this.METADATA?.FIELDS || []).filter(f => f?.id && !f.secret).map(f => f.id);
            const row = { id: body._id, time: body.time };
            for (const fid of fields) {
                if (fid !== 'id' && fid !== 'time' && body[fid] !== undefined)
                    row[fid] = body[fid];
            }
            await _lockedJson(this._indexFile(def, day), doc => {
                if (sign > 0)
                    doc[body._id] = row;
                else if (doc[body._id])
                    delete doc[body._id];
                return doc;
            });
        }
        else if (def.kind === 'lookup') {
            const key = String(body[def.key] ?? '');
            if (!key)
                return;
            await _lockedJson(this._indexFile(def, day), doc => {
                if (sign > 0) {
                    if (def.unique)
                        doc[key] = body._id;
                    else {
                        const arr = Array.isArray(doc[key]) ? doc[key] : (doc[key] != null ? [doc[key]] : []);
                        if (!arr.includes(body._id))
                            arr.push(body._id);
                        doc[key] = arr;
                    }
                }
                else if (doc[key] !== undefined) {
                    if (def.unique) {
                        if (doc[key] === body._id)
                            delete doc[key];
                    }
                    else {
                        const arr = (Array.isArray(doc[key]) ? doc[key] : [doc[key]]).filter(x => x !== body._id);
                        if (arr.length)
                            doc[key] = arr;
                        else
                            delete doc[key];
                    }
                }
                return doc;
            });
        }
    }
    /** Найти ключ lookup в файлах дней класса → id (первое совпадение). */
    async _lookupKey(def, key) {
        const dir = this.meta_folder.dir + '/INDEX/' + def.id;
        if (!fs.existsSync(dir))
            return null;
        for (const f of await fsp.readdir(dir)) {
            if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f))
                continue;
            let doc;
            try {
                doc = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf-8'));
            }
            catch { continue; }
            const v = doc?.[key];
            if (v == null)
                continue;
            return Array.isArray(v) ? v[0] ?? null : v;
        }
        return null;
    }
    /** Проверка unique lookup до записи объекта. */
    async _checkUnique(defs, body, id) {
        for (const def of defs) {
            if (def.kind !== 'lookup' || !def.unique || !body || body.deleted)
                continue;
            const key = String(body[def.key] ?? '');
            if (!key)
                continue;
            const dup = await this._lookupKey(def, key);
            if (dup != null && dup !== id)
                throw new Error('дубль ключа «' + key + '» в индексе «' + def.id + '»');
        }
    }
    /**
     * Обновить индексы точки и предков того же типа (пока описание индекса совпадает).
     * before — прежнее тело (null при создании), after — новое (deleted при удалении).
     */
    async _indexWrite(before, after, id) {
        const defs = this._indexDefs();
        await this._checkUnique(defs, after, id);
        for (const def of defs) {
            if (def.kind === 'balance')
                continue;
            const b = before && this._indexContrib(def, before) ? { ...before, _id: id } : null;
            const a = after && this._indexContrib(def, after) ? { ...after, _id: id } : null;
            if (b)
                await this._applyIndexOne(def, b, -1);
            if (a)
                await this._applyIndexOne(def, a, +1);
            for (let p = this.$parent; p && p instanceof FS.$class && p.type === this.type; p = p.$parent) {
                const pd = p._indexDefs().find(d => d.id === def.id);
                if (!pd || _indexHash(pd) !== _indexHash(def))
                    break;
                if (b)
                    await p._applyIndexOne(def, b, -1);
                if (a)
                    await p._applyIndexOne(def, a, +1);
            }
        }
    }
    get type(){
        return this.meta_folder.id;
    }
    get $folder(){
        return this.constructor.inherit(WORK.$folder, this.meta_folder);
    }

    /**
     * Типы файлов данных класса: сам `$folder/$file/$data` (единый тип `.data`).
     * Точечные типы (`point: true` в `$file/$ext/class.js`: почта, календарь,
     * звонки, задачи, логи) резолвятся глобально, см. is_data_type.
     * Builder и save_file смотрят сюда, не в глобальный `$file.isDataFile`.
     */
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
        // точечный тип ($file/$ext с point: true) — тот же способ записи
        try {
            const td = await FS.$file.typeData(ext);
            return td?.point === true;
        }
        catch { return false; }
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
     * зона роли | DATA | INDEX | лента (logs) | секреты | система | элемент вложенного класса.
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
     * Зона элемента: имя роли для зоны, иначе SYSTEM | DATA | INDEX | LOGS | SECRET | NESTED.
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
        // Ссылки рабочих мест — доступ к прикладным классам (до pass-through и ленты)
        if (await LINKS.grants(this, item, params))
            return true;
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
        if (POLICY.canWrite(declared[role], this.areaOf(item), {
            local,
            executable: POLICY.isExecutablePath(item.path, this.path),
        }))
            return true;
        return LINKS.grantsWrite(this, params);
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

        // Инвариант листа: у класса с объектами DATA нельзя создать дочерний класс
        // того же типа — сначала split (перенос DATA в потомка). Иначе объекты «переедут»
        // молча, как в старой версии ODANT.
        if (type === this.type) {
            const dataDir = this.meta_folder.dir + '/DATA';
            if (fs.existsSync(dataDir) && await _hasDataFiles(dataDir))
                throw new Error('create: в классе есть объекты DATA — сначала split в дочерний класс');
        }

        const ctor = FS[type] || FS.$class;
        return this._createClass(id, type, ctor, post, p);
    }
    /**
     * Физическое создание класса (без проверок доступа и инвариантов — их делает вызывающий:
     * create() или split()). Не вызывать извне напрямую.
     */
    async _createClass(id, type, ctor, post, p = {}) {
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