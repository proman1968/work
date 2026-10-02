import * as http from "node:http";
import * as https from "node:https";
import * as fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import * as mime from "mime-types";
import * as fsp from "node:fs/promises";
import { $class, $folder, $user } from './index.js';
import { MERGE } from '../host/babel-merge.js';
import { installPackageSpawn } from '../host/package-install.js';
import { authMethods } from '../host/auth-methods.js';
import { vapidKeys } from '../host/vapid.js';
import {
    getPublicVapid,
    storePushSubscription,
    removePushSubscription,
    sendPushNotification,
} from '../host/push.js';
import { DEV_MODE, setDevMode } from "../host/config.js";
import { serverId } from "../host/server-id.js";
import { guardedGet } from "../host/net-guard.js";

/**
 * Ядро агента (sources/modules/agent) для слоёв дерева: class.js грузятся как data:-модули
 * и не могут импортировать относительные пути — берут ядро отсюда.
 */
globalThis.WORK_AGENT ??= () => import('../modules/agent/session.js');
globalThis.WORK_AGENT_CORE ??= () => import('../modules/agent/index.js');
globalThis.WORK_MCP ??= () => import('../modules/agent/mcp-pool.js');
/** Коннекторы LAN для методов class.js (data:-модули не поддерживают относительные импорты). */
globalThis.WORK_LAN ??= () => import('../modules/lan/connectors.js');
/** Триггеры агента на сохранение файлов (ai/triggers/*.md); WORK_TRIGGERS=0 — выключить. */
globalThis.WORK_AGENT_TRIGGERS ??= process.env.WORK_TRIGGERS === '0' ? null
    : (file, params) => import('../modules/agent/triggers.js').then(m => m.onSave(file, params)).catch(e => console.warn('[trigger]', e.message));

/** Прототип HTTP/WS-сессии (`$server.sessions[ssid]` / `params.session`). */
const sessionProto = {
    /** Отправить JSON только в сокеты этой сессии. */
    send(data) {
        const payload = JSON.stringify(data);
        for (const sock of Object.values(this.sockets || {})) {
            try {
                if (sock?.ws?.readyState === 1)
                    sock.ws.send(payload);
            } catch (e) {
                console.warn('[user.send]', e.message);
            }
        }
    },
};

export class $server extends $class {
    parent = null;
    path = '';
    dir = '.';
    get fs(){
        return fs
    }
    get fsp(){
        return fsp
    }
    get http(){
        return http
    }
    get https(){
        return https
    }
    get system_types(){
        return '$server, $user, $handler, $trigger, $task'
    }
    /**
     * Отправить WebSocket сообщение всем подключённым сокетам.
     * @param {object} data — объект, который будет сериализован в JSON
     */
    wsSend(data) {
        const payload = JSON.stringify(data);
        for (const session of Object.values(this.constructor.sessions)) {
            for (const id in session.sockets) {
                const socket = session.sockets[id];
                try {
                    socket.ws.send(payload);
                } catch (e) {
                    console.warn('[wsSend]', e.message);
                }
            }
        }
    }

    get types(){
        const type_scan = (dir)=>{
            let children = fs.readdirSync(dir);
            children = children.filter(f=>f[0] === '$' && f !== '$file');
            children = [...children, ...children.map(f=>type_scan(dir + '/' + f))]
            return children;
        }

        let types = type_scan(this.$folder.dir).flat(Infinity);
        types.unshift('$folder')
        return types;
    }
    /**
     * Получить HTML публичной страницы (превью ссылок). Только для вошедших; внутренние адреса запрещены.
     * @param {object} params
     * @param {string} params.url Адрес страницы (http/https)
     * @param {boolean} [params.meta] Вернуть HTML страницы
     * @returns {Promise<string|undefined>} HTML
     */
    async proxy(params = {url: '', meta: false}) {
        if (!$class.resolveUid(params) && params.session?.$user !== this)
            throw new Error('Доступ запрещён');
        if(params.meta){
            const res = await guardedGet(params.url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 10_000 });
            return res.body.toString('utf-8');
        }
    }
    get $folder(){
        return $folder.build('$folder', this.meta_folder);
    }
    get $users(){
        return this._get_next_item('USERS', $user);
    }
    get id(){
        return serverId;
    }
    get label(){
        return 'WORK';
    }
    get icon(){
        return '/sources/odant.png';
    }

    async npm(p = {module: ""}){
        await this.assertAccess(p, $class.ACCESS_LEVEL.ADMIN);
        if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*-]+)?$/i.test(String(p.module || '')))
            throw new Error('npm: недопустимое имя пакета');
        try{
            const result = await installPackageSpawn(p.module, './node_modules', {
                save: true
            });
            return `Installation "${p.module}" completed successfully!`;
        }
        catch(e){
            return e;
        }
    }
    async get_public_vapid() {
        return getPublicVapid(vapidKeys);
    }
    async store_push_subscription(params) {
        this._assertPushSubject(params);
        const endpoint = params.post?.endpoint;
        if (typeof endpoint !== 'string' || !/^https:\/\//i.test(endpoint))
            throw new Error('push: endpoint должен быть https');
        return storePushSubscription(params);
    }
    async remove_push_subscription(params) {
        this._assertPushSubject(params);
        return removePushSubscription(params);
    }
    async send_push_notification(params) {
        // только вошедший пользователь (или ядро); получатели — корректные uid
        if (!$class.resolveUid(params) && params.session?.$user !== this)
            throw new Error('Доступ запрещён');
        const list = typeof params.receivers === 'string' ? params.receivers.split(',') : (params.receivers || []);
        if (list.some(r => !/^[\w.-]{1,64}$/.test(String(r?.id || r).trim())))
            throw new Error('push: недопустимый получатель');
        return sendPushNotification(params, (o) => this.remove_push_subscription({ ...o, session: { uid: o.session.uid } }));
    }
    _assertPushSubject(params) {
        const uid = params?.session?.uid;
        if (!uid || !/^[\w.-]{1,64}$/.test(uid))
            throw new Error('push: требуется вход');
    }

    get pageHTML() {
        return fs.readFileSync('./sources/page.html', {encoding: 'utf-8'});
    }
    getIndexForPage(folder, context){
        let handler = folder;
        let page = handler;
        // Поднимаемся к корневому handler внутри pages (структура handlers/pages/<page>[/<view>]).
        // Проверка parent.id !== 'pages' надёжнее проверки type === '$handler',
        // потому что промежуточные папки (например form) при наследовании могут
        // иметь тип $folder, если у них нет собственной метапапки $handler.
        while (page?.parent && page.parent.id !== 'pages')
            page = page.parent;
        context ??= page.parent?.$parent;
        if(!context)
            throw new Error('Context not found')
        let text = this.pageHTML;
        text = text.replaceAll('{item_path}', context.short || '/');
        text = text.replaceAll('{item_icon_path}', `${context.path}/~/icon.png`);
        text = text.replaceAll('{handler}', page.id);
        text = text.replaceAll('{view_name}', page === handler?'':handler.id);
        text = text.replaceAll('{handler-type}', page.parent.id);
        text = text.replaceAll('{server-label}', this.label);
        text = text.replaceAll('{server-icon}', this.icon);
        text = text.replaceAll('{dev_mode}', DEV_MODE ? 'true' : 'false');

        let title = context.label;
        title += ` [${page.label}]`;
        text = text.replaceAll('{title}', title);
        return text;
    }

    get testerHTML() {
        return fs.readFileSync('./sources/tester.html', {encoding: 'utf-8'});
    }
    getIndexForTest(file){
        let text = this.testerHTML;
        text = text.replaceAll('{script_path}', file.short || '');
        let title = 'TEST';
        title += ` [${file.short}]`;
        text = text.replaceAll('{title}', title);
        return text;
    }
    /** Сессии по ssid. Без прототипа: ssid из cookie не может попасть в Object.prototype. */
    static sessions = Object.create(null);
    /** Сессия без активности дольше этого срока (и без открытых сокетов) удаляется. */
    static SESSION_IDLE_MS = 14 * 24 * 3600_000;
    static #gcAt = 0;

    /** Криптостойкий идентификатор сессии (192 бита). */
    static newSessionId() {
        return randomBytes(24).toString('base64url');
    }

    /** Строка — идентификатор формата newSessionId (32 символа base64url). */
    static isSessionId(ssid) {
        return typeof ssid === 'string' && /^[A-Za-z0-9_-]{32}$/.test(ssid);
    }

    /**
     * Сессия по ssid из cookie.
     * Неизвестный ssid в формате сервера (после перезапуска сессии в памяти пропали) принимается как
     * анонимная сессия: параллельные запросы открытой страницы попадают в одну сессию, и двухшаговый
     * вход (login_start → login_finish) не рвётся. От фиксации защищает signIn: при входе ssid меняется.
     * Иной ssid (не нашего формата) — новая сессия с серверным идентификатором.
     */
    static get_session(ssid = '') {
        let session = ssid && Object.hasOwn(this.sessions, ssid) ? this.sessions[ssid] : null;
        if (!session) {
            const id = this.isSessionId(ssid) ? ssid : this.newSessionId();
            session = this.sessions[id] = Object.assign(Object.create(sessionProto), { ssid: id, sockets: {}, created: Date.now() });
        }
        session.lastSeen = Date.now();
        this.#gcSessions();
        return session;
    }

    static #gcSessions() {
        const now = Date.now();
        if (now - this.#gcAt < 10 * 60_000)
            return;
        this.#gcAt = now;
        for (const [id, s] of Object.entries(this.sessions)) {
            const idle = now - (s.lastSeen || s.created || 0);
            if (idle > this.SESSION_IDLE_MS && !Object.keys(s.sockets || {}).length)
                delete this.sessions[id];
        }
    }

    /**
     * Вход в сессию после успешной проверки (подпись ключа / регистрация):
     * субъект сессии + новый ssid (старый, известный до входа, больше не действует).
     */
    static signIn(session, $user) {
        const old = session.ssid;
        const id = this.newSessionId();
        if (old && this.sessions[old] === session)
            delete this.sessions[old];
        session.ssid = id;
        this.sessions[id] = session;
        session.uid = $user.id;
        session.id = $user.id;
        session.$user = $user;
        session.principal = Object.freeze({ kind: 'user', id: $user.id });
        return session;
    }

    static clearSessionAuth(session) {
        if (!session)
            return;
        delete session.uid;
        delete session.id;
        delete session.$user;
        delete session.principal;
        delete session.credentials;
        delete session.challenge;
        delete session.registration;
    }
    /** Сброс аутентификации во всех HTTP-сессиях с данным uid. */
    static clearAllSessionsForUid(uid) {
        if (!uid)
            return;
        for (const session of Object.values(this.sessions)) {
            if (session.uid === uid)
                this.clearSessionAuth(session);
        }
    }

    /** WS: смена auth (login/logout/register) — перезагрузка UI во всех вкладках сессии. */
    static broadcastAuthChanged(payload, sessions) {
        const message = JSON.stringify({ type: 'auth-changed', ...payload });
        const list = sessions ?? Object.values(this.sessions);
        for (const session of list) {
            if (!session?.sockets)
                continue;
            for (const sock of Object.values(session.sockets)) {
                if (sock?.ws?.readyState === 1)
                    sock.ws.send(message);
            }
        }
    }

    static broadcastAuthChangedToSession(session, payload) {
        if (session)
            this.broadcastAuthChanged(payload, [session]);
    }

    static broadcastAuthChangedForUid(uid, payload) {
        if (!uid) {
            this.broadcastAuthChanged(payload);
            return;
        }
        const sessions = Object.values(this.sessions).filter(s => s.uid === uid);
        this.broadcastAuthChanged(payload, sessions);
    }
    static merges = {};
    /**
     * Сборка наследных readme.md по ~ (как class.js, но конкатенацией, без babel):
     * свой слой первым, дальше маркер и предки от ближнего к корню.
     * Без кэша: readme правятся часто, сборка обязана видеть правку сразу.
     * @param {Array} [files] Слои readme.md из ~ (корень→SELF)
     * @returns {Promise<string>} Собранный текст
     */
    static async mergeTextFiles(files = []){
        const layers = [];
        const seen = new Set();
        for (const f of files || []) {
            const key = f?.real_dir || f?.path;
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            if (typeof f.read_text !== 'function')
                continue;
            const text = String(await f.read_text() || '').trim();
            if (text)
                layers.push(text);
        }
        if (!layers.length)
            return '';
        if (layers.length === 1)
            return layers[0];
        const self = layers[layers.length - 1];
        const ancestors = layers.slice(0, -1).reverse();
        const mark = '\n\n---\n\nНАСЛЕДУЕТСЯ ОТ\n===\n\n---\n\n';
        return self + mark + ancestors.join(mark);
    }
    static async mergeFiles(files = [], reset = false){
        const {dirs, unique_files} = files.reduce((res, file) => {
            if (!res.dirs.includes(file.real_dir)) {
                res.unique_files.push(file);
                res.dirs.push(file.real_dir);
            }
            return res;
        }, {dirs:[], unique_files: []});
        let key = dirs.join(';');

        return this.merges[key] ??= new AsyncPromise(async () => {
            let body = '';
            if (!files?.length || !files[0])
                return body;
            switch(files[0].ext){
                case 'js':{
                    for (const file of unique_files) {
                        let next = await fsp.readFile(file.real_dir, {encoding: 'utf-8'});
                        if (body)
                            next = this.mergeScripts(body, next);
                        body = next;
                    }
                } break;
                case 'json':{

                } break;
                case 'docx':{

                } break;
                case 'pptx':{

                } break;
                case 'xlsx':{

                } break;
            }
            return body;
        })

    }
    /**
     * Кэш попарных merge по хэшам содержимого.
     * Цепочки разных классов делят общий префикс глобальных слоёв —
     * с кэшем пар babel-парсинг префикса выполняется один раз,
     * для конкретного класса парсится только финальная пара (префикс + SELF).
     */
    static __merge_pairs__ = new Map();
    static mergeScripts(code1, code2) {
        const key = createHash('sha1').update(code1).update('\u0000').update(code2).digest('base64');
        let result = this.__merge_pairs__.get(key);
        if (result === undefined) {
            result = MERGE.mergeScripts(code1, code2);
            this.__merge_pairs__.set(key, result);
        }
        return result;
    }
    static getSettings(item){
        let mata_folder = item.meta_folder;
        let data = fs.readFileSync(mata_folder.dir + '/#system/settings.json', {encoding: 'utf-8'});
        data = JSON.parse(data)
        return data;
    }
    static get http(){
        return http;
    }
    static get https(){
        return https;
    }
    static get mime(){
        return mime;
    }
    /**
     * Назначения запрашивающего узла сети на нашем сервере: точки и роли (для его реестра).
     * Доступно только подписанному запросу узла.
     * @param {object} params
     * @returns {Promise<Array<{point, label, role, roleLabel}>>} Назначения
     */
    async node_grants(params = {}) {
        const principal = params.session?.principal;
        if (principal?.kind !== 'node')
            throw new Error('Доступ запрещён');
        const store = await import('../modules/rag/store.js');
        if (!await store.open())
            return [];
        const out = [];
        for (const row of store.assignmentsOf(principal.id)) {
            try {
                let cls = row.class_path === '/' ? this : await this.get_item(row.class_path);
                if (Array.isArray(cls))
                    cls = cls[0];
                if (!cls?.declared_roles)
                    continue;
                const declared = await cls.declared_roles;
                const role = declared[row.role];
                if (!role?.principals?.includes('node') || !cls._roleIds(row.role, declared).includes(principal.id))
                    continue;
                out.push({ point: cls.path || '/', label: cls.label, role: row.role, roleLabel: role.label });
            }
            catch { /* точка удалена */ }
        }
        return out;
    }
    /**
     * Журнал безопасности за день: входы, отказы в доступе, действия ADMIN, запросы узлов.
     * @param {object} [params]
     * @param {string} [params.day] Дата YYYY-MM-DD (по умолчанию сегодня, UTC)
     * @param {number} [params.limit] Максимум записей
     * @returns {Promise<Array>} Записи по убыванию времени
     */
    async security_log(params = {}){
        await this.assertAccess(params, $server.ACCESS_LEVEL.ADMIN);
        const { readAudit } = await import('./access/audit.js');
        return readAudit(params.day || undefined, Math.min(5000, Number(params.limit) || 500));
    }
    async devModeToggle(params){
        await this.assertAccess(params, $server.ACCESS_LEVEL.ADMIN)
        await setDevMode(params.post.value);
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    }
}
$server.type_chain = Object.create(null);
Object.assign($server.prototype, authMethods);
globalThis.$server = $server;
