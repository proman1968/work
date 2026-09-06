import * as http from "node:http";
import * as https from "node:https";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
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
    get https(){
        return https
    }
    get exclude_for_rag(){
        // папки/имена верхнего уровня + все скрытые id (`.…`) режутся в folder.rag
        return ['.git', 'node_modules', '.cursor', '.vscode'];
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
    async proxy(params = {url: '', meta: false}) {
        if(params.meta){
            const result = await fetch(params.url);
            const html = await result.text();
            return html;
        }
    }
    get $folder(){
        return $folder.build('$folder', this.meta_folder);
    }
    get $users(){
        return this._get_next_item('USERS', $user);
    }
    get id(){
        return 'WORK';
    }
    get label(){
        return 'WORK';
    }
    get icon(){
        return '/sources/odant.png';
    }

    async npm(p = {module: ""}){
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
        return storePushSubscription(params);
    }
    async remove_push_subscription(params) {
        return removePushSubscription(params);
    }
    async send_push_notification(params) {
        return sendPushNotification(params, (o) => this.remove_push_subscription(o));
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
    static sessions = {};
    static get_session(ssid = '') {
        ssid ||= this.genGUID();
        return this.sessions[ssid] ??= Object.assign(Object.create(sessionProto), { ssid, sockets: {} });
    }
    static clearSessionAuth(session) {
        if (!session)
            return;
        delete session.uid;
        delete session.$user;
        delete session.credentials;
        delete session.challenge;
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
    static get https(){
        return https;
    }
    static get mime(){
        return mime;
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
