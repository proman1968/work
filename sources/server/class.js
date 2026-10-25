import * as fs from "node:fs";
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
import * as WORKPLACES from './access/workplaces.js';
import { DATA_METHODS, classHasObjects } from '../data/api.js';
import { DATA_TYPES } from '../data/classes.js';

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
            },
            /**
             * uid пользователей, назначенных локально в #security по базовым ролям: строки дерева
             * рисуют аватары по ним, а не запросами `?users`/`?bosses` на каждую строку.
             */
            get roleIds(){
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
            /**
             * Заполнена ли #security (ROLES, LINKS или назначения ролей):
             * дерево показывает стрелку и панель item-security без лишних запросов.
             */
            get hasSecurity(){
                const sec = this.DATA?.['#security'];
                if (!sec || typeof sec !== 'object')
                    return false;
                return Object.values(sec).some(v => Array.isArray(v) && v.length > 0);
            },
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
                    // экранируем то, что исполняется в шаблонной строке: \ `
                    value = '`' + String(value).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
                else
                    value = JSON.stringify(value);
            } break;
            case 'Array': {
                value = '[' + value.map(val => this._scriptSwitchValue(val, deep)) + ']';
            } break;
        }
        if (key){
           if(!this.validateVarName(key)){
                // ключ с кавычками/кодом остаётся строкой (JSON.stringify экранирует)
                key = JSON.stringify(key);
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
                // Значения данных читаем через сам объект (то же, что видит прокси Reactor),
                // а не из дескриптора: дескриптор может хранить устаревшую копию.
                // Функции берём из дескриптора: прокси отдаёт их как bind-обёртку, её текст не код.
                const useProxy = 'value' in prop && typeof prop.value !== 'function';
                const val = this._scriptSwitchValue(useProxy ? json[key] : prop.value, deep, key);
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

    /**
     * Оставить в дереве полей только узлы, отличающиеся от предкового (по id, рекурсивно).
     * Поле без своих отличий и без изменённых детей не пишется. Поле с отличиями
     * пишется со своими свойствами и только изменёнными детьми (merge слоёв сливает
     * массивы по id, см. host/babel-merge.js deepMergeArrays).
     * @param {Array} list Поля, как их передал редактор
     * @param {Array} [base] Поля того же уровня у предка
     * @returns {Array} Изменённые поля
     */
    static pruneFields(list, base = []) {
        if (!Array.isArray(list))
            return list;
        const byId = new Map((Array.isArray(base) ? base : [])
            .filter(f => f?.id != null).map(f => [f.id, f]));
        const out = [];
        for (const field of list) {
            // элемент без id не сопоставляется с предком — сохраняем как есть
            if (!field || typeof field !== 'object' || field.id == null) {
                out.push(field);
                continue;
            }
            const ancestor = byId.get(field.id);
            const { fields, ...own } = field;
            const { fields: ancestorFields, ...ancestorOwn } = ancestor || {};
            const kids = this.pruneFields(fields, ancestorFields);
            const hasKids = Array.isArray(kids) && kids.length > 0;
            const ownChanged = !ancestor || Object.keys(this.getDifference(own, ancestorOwn)).length > 0;
            if (!ownChanged && !hasKids)
                continue;
            out.push(hasKids ? { ...own, fields: kids } : own);
        }
        return out;
    }

    /**
     * Обрезать METADATA.FIELDS и METADATA.STATIC по предку (см. pruneFields).
     * Дескрипторы объекта сохраняются (геттеры не вычисляются).
     * @param {object} data Часть class.js (self или inherit)
     * @param {object} base Merged baseline предка
     * @returns {object}
     */
    static pruneMeta(data, base) {
        const meta = data?.METADATA;
        if (!data || typeof data !== 'object' || Array.isArray(data) || !meta || typeof meta !== 'object')
            return data;
        const baseMeta = base?.METADATA || {};
        const nextMeta = { ...meta };
        for (const key of ['FIELDS', 'STATIC'])
            if (key in nextMeta)
                nextMeta[key] = this.pruneFields(nextMeta[key], baseMeta[key]);
        const out = Object.defineProperties({}, Object.getOwnPropertyDescriptors(data));
        out.METADATA = nextMeta;
        return out;
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
     * Явные флаги: to_inherit:true — только в inherit; иначе — только в self.
     * Без флагов наследуется только явно помеченное. Исключение: INDEXES/POSTINGS
     * наследуются всегда и на любой глубине (кроме явного to_inherit:false) и
     * остаются в self тоже. FIELDS наследуются только по to_inherit:true.
     * @param {object|Array} data Входящий class.js
     * @param {boolean} [dflt] Наследовать всё без флагов (по умолчанию false).
     */
    static separateInheritData(data, dflt = false) {
        const nonEmpty = (v) => Array.isArray(v) ? v.length > 0
            : (v && (typeof v !== 'object' || Object.keys(v).length > 0));
        // правила (INDEXES/POSTINGS) наследуются однотипными потомками всегда;
        // поля (FIELDS) — только помеченные to_inherit:true
        const schemaChild = (key) => dflt === true || (key === 'INDEXES' || key === 'POSTINGS');
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
                const childDflt = schemaChild(key);
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
        // Собственная схема = предки + свой слой + свой распространяемый слой.
        // Тот же путь, что у save (get_item('~/class.js')): чтение и запись видят одни слои.
        // get_item только разрешает путь и не вызывает load, зацикливания нет.
        let files = await this.get_item('~/class.js');
        files = (files || []).filter(f=>f.id === 'class.js');
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
     * @returns {Promise<Record<string, {id, label, icon, color, principals}>>}
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

    /** uid, назначенные на роль локально в #security (ключ — id роли).
     * Служебные ключи секции (LINKS, ROLES) ролями не являются. */
    _roleIds(roleId, declared = this._declaredRolesSync()) {
        if (roleId === 'LINKS' || roleId === 'ROLES')
            return [];
        const security = this.DATA?.['#security'];
        if (!security || !declared[roleId])
            return [];
        const list = security[roleId];
        return Array.isArray(list) ? list.filter(v => typeof v === 'string') : [];
    }

    /** Класс — подразделение ($structure или наследник: $base, $server). */
    async _isStructure() {
        try {
            return (await this.type_chain).includes('$structure');
        }
        catch {
            return false;
        }
    }

    /** Назначен ли uid на прикладную роль (#security.ROLES) этого подразделения. */
    async _isPlaceMember(uid) {
        if (!uid || !(await this._isStructure()))
            return false;
        return WORKPLACES.isPlaceMember(this.DATA?.['#security'], uid);
    }

    /** На классе назначен хотя бы один пользователь (любая роль или место). */
    hasAssignments() {
        const declared = this._declaredRolesSync();
        return Object.keys(declared).some(id => this._roleIds(id, declared).length > 0)
            || WORKPLACES.hasPlaceAssignments(this.DATA?.['#security']);
    }

    /**
     * Получить список ролей текущего пользователя в классе.
     * Системные роли (ADMIN, BOSS) наследуются от вышестоящих классов,
     * остальные — только локальные назначения. Назначение на прикладную
     * роль подразделения (#security.ROLES) даёт роль USER в нём.
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
            if (!POLICY.isSystemRole(id))
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
        if (!roles.includes('USER') && await this._isPlaceMember(uid))
            roles.push('USER');
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

    /** Роль назначена пользователю в этой точке (а не унаследована сверху).
     * Назначение на прикладную роль подразделения считается локальным USER. */
    async hasLocalRole(params = {}, role = params.role) {
        const uid = $class.resolveUid(params);
        if (!uid || !role)
            return false;
        await this.init;
        return this._roleIds(role).includes(uid)
            || (role === $class.ROLES.USER && await this._isPlaceMember(uid));
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
     * ADMIN, BOSS → лента текущего класса (следы всех пользователей точки);
     * остальные → своя лента в личном кабинете.
     */
    async chatSource(params = {}) {
        const uid = $class.resolveUid(params);
        const declared = await this.declared_roles;
        // кабинет субъекта: пользователь — /USERS//uid, узел сети — его класс в /NODES
        const own = params.session?.principal?.kind === 'node'
            ? params.session.$user?.path
            : (uid ? '/USERS//' + uid : null);
        const viaRole = role => {
            if (POLICY.isSystemRole(role))
                return this.path;
            return own || this.path;
        };
        // Явно выбранная роль в UI имеет приоритет
        if (params.role && declared[params.role])
            return viaRole(params.role);
        // Fallback: без role — по фактическим ролям
        const roles = await this.roles(params);
        if (roles.some(r => POLICY.isSystemRole(r)))
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
        // сначала делим по to_inherit, затем режем поля по предку своей части
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
        const storage = await this.work_zone(params);
        const folder = await storage.getFolderToSaveFile(params);
        return folder.save_file(params);
    }
    async get_write_stream(params) {
        const storage = await this.work_zone(params);
        const folder = await storage.getFolderToSaveFile(params);
        return folder.get_write_stream(params);
    }
    /**
     * Доступ пользователя к классу ('admin'|'write'|'read'|null): прямые назначения
     * плюс ссылки рабочих мест (LINKS) для прикладных классов.
     */
    async data_access(params = {}) {
        return LINKS.dataAccess(this, params);
    }
    /**
     * Цепочки ссылок подразделения для дерева: ссылки #security (общие LINKS
     * плюс LINKS прикладных ролей пользователя) и их предки до корня типа
     * (вниз и вбок — ничего). Клиент зеркалит структуру.
     * @param {object} [params]
     * @returns {Promise<Array>} [{path, label, icon, type, access, via, children}]
     */
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
        const uid = $class.resolveUid(params);
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
    }
    /**
     * Собрать цепочки ссылок от корней типов: трие эффективных ссылок
     * (id → {access, via}) плюс предки до корня типа, подписи метками классов.
     * @param {Map<string, {access: string, via: Array}>} eff
     * @returns {Promise<Array>} [{path, label, icon, type, access, via, children}]
     */
    async _linkTrie(eff) {
        const rank = { read: 1, write: 2, admin: 3 };
        const byPath = new Map();
        const roots = [];
        for (const [id, e] of eff) {
            const segs = id.split('/').filter(Boolean);
            let prefix = '', parent = null;
            segs.forEach((seg, i) => {
                prefix += '/' + seg;
                let n = byPath.get(prefix);
                if (!n) {
                    n = { path: prefix, label: seg, icon: '', type: '', access: 'read', via: [], children: [] };
                    byPath.set(prefix, n);
                    if (parent)
                        parent.children.push(n);
                    else
                        roots.push(n);
                }
                if (i === segs.length - 1 && (rank[e.access] || 0) > (rank[n.access] || 0)) {
                    n.access = e.access;
                    n.via = e.via;
                }
                parent = n;
            });
        }
        // Подписи метками классов (внутренний обход — без проверок доступа,
        // читать цепочку разрешено самим фактом членства в подразделении).
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
     * Дерево прикладных ролей подразделения с назначениями и ссылками.
     * Для дерева: свои места помечены mine, ссылки подписаны метками классов,
     * у каждого места и у общих ссылок — готовая цепочка tree от корня типа.
     * Пустые подразделения — { common: [], commonTree: [], places: [] }.
     * @param {object} [params]
     * @returns {Promise<{common: Array, commonTree: Array, places: Array}>}
     */
    async places(params = {}) {
        if (!(await this._isStructure()))
            return { common: [], commonTree: [], places: [] };
        await this.init;
        const uid = $class.resolveUid(params);
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
        /** Эффективные ссылки списка: id → {access, via} (максимум при дублях). */
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
        if (DEV_MODE)
            return uid || globalThis.WORK?.id || 'dev';
        if (!uid || !(await this.canSee(this, params)))
            throw new Error(ACCESS_DENIED);
        const level = await this.data_access(params);
        if (level !== 'write' && level !== 'admin')
            throw new Error(ACCESS_DENIED);
        return uid;
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
     * uid, если вызывающему видна только своя часть ленты точки, иначе null.
     * Лента точки целиком — системные роли (ADMIN, BOSS), WORK ADMIN, владелец кабинета.
     */
    async _feedOwnOnly(params = {}) {
        if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
            return null;
        const uid = $class.resolveUid(params);
        if (!uid || this.id === uid)
            return null;
        if (globalThis.WORK && await this._isWorkAdmin(params))
            return null;
        const roles = await this.roles(params);
        const full = roles.some(r => POLICY.isSystemRole(r));
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

    /** Для ленты точки у обычных ролей: папки ленты видны (листинг), записи — только свои. */
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
     * Системные роли (ADMIN, BOSS) — всё от точки назначения вниз (секреты — только ADMIN);
     * остальные роли — система точки + своя зона (собственная и унаследованная по `~`);
     * лента точки — системным ролям целиком, остальным — только свои записи;
     * плюс всё, на что указывают записи собственной ленты пользователя (receivers).
     */
    async canSee(item, params = {}) {
        if (DEV_MODE) return true;
        const users = this.DATA['#security']?.USER;
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
     * ADMIN — всё от точки назначения вниз;
     * остальные — только своя зона и только там, где роль назначена локально
     * (в любом слое своей метапапки: `ROLE/`, `$folder/ROLE/`, `$folder/$class/$type/ROLE/` —
     * выбор слоя определяет, куда провалится файл по наследованию).
     */
    async canWrite(item, params = {}) {
        if (DEV_MODE) return true;
        if (!item || typeof item !== 'object') return false;
        const uid = $class.resolveUid(params);
        if (!uid) return false;
        // цель записи с именем файла: у save_file проверяем фактический файл (folder + filename), не только папку
        const rel = [params.folder, params.filename].filter(Boolean).join('/');
        const target = rel && item.path ? item.path.replace(/\/+$/, '') + '/' + rel : item.path;
        const protectedTarget = POLICY.isExecutablePath(target, this.path) || POLICY.isAgentControlPath(target, this.path);
        // владелец кабинета пишет свои данные, но не системную часть: class.js/#… исполняются,
        // ai/ (кроме личной памяти), hooks, triggers загружаются движком агента как код/инструкции
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
        if (!/^[\p{L}\p{N}_.-]+$/u.test(filename) || filename.includes('..'))
            throw new Error('Имя файла секрета: буквы, цифры, точка и дефис, без обхода каталогов');
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
        if (!/^[\p{L}\p{N}_.-]+$/u.test(params.filename) || params.filename.includes('..'))
            throw new Error('Имя файла секрета: буквы, цифры, точка и дефис, без обхода каталогов');
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

    /** Пользователи роли, назначенные локально в #security (без наследования и литералов).
     * Для USER подразделения сюда же входят назначенные на прикладные роли. */
    _localRole(role) {
        return Promise.resolve(this.init).then(async () => {
            const ids = [...this._roleIds(role)];
            if (role === $class.ROLES.USER)
                for (const u of WORKPLACES.placeUserIds(this.DATA?.['#security']))
                    if (!ids.includes(u))
                        ids.push(u);
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
    /** Исполнители класса из #security.USER (без наследования). */
    get users(){
        return this._localRole($class.ROLES.USER);
    }
    /** Гости класса из #security.GUEST (без наследования). */
    get guests(){
        return this._localRole($class.ROLES.GUEST);
    }
    /** Администраторы, назначенные локально в #security.ADMIN (без наследования). */
    get admins(){
        return this._localRole($class.ROLES.ADMIN);
    }
    /** Управляющие, назначенные локально в #security.BOSS (без наследования). */
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

        // Инвариант листа: объекты учётного ядра живут только в листьях — у класса с объектами
        // нельзя создать дочерний класс того же типа (объекты оказались бы в узле).
        if (type === this.type && DATA_TYPES.includes(type) && await classHasObjects(this.path))
            throw new Error('create: у класса есть объекты — дочерний класс того же типа сделал бы его не листом');

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