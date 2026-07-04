import * as http from "node:http";
import * as https from "node:https";
import * as fs from "node:fs";
import * as mime from "mime-types";
import * as fsp from "node:fs/promises";
import { $storage, $folder, $user } from './index.js';
import { MERGE } from '../host/babel-merge.js';
import { installPackageSpawn } from '../host/package-install.js';
import { authMethods } from '../host/auth-methods.js';
import { GEN_API_TOKEN } from '../host/config.js';
import { vapidKeys } from '../host/vapid.js';
import {
    getPublicVapid,
    storePushSubscription,
    removePushSubscription,
    sendPushNotification,
} from '../host/push.js';

export class $server extends $storage {
    parent = null;
    path = '';
    dir = '.';
    get fs(){
        return fs
    }
    get genApi(){
        if (GEN_API_TOKEN)
            genApi.setAuthToken(GEN_API_TOKEN);
        return genApi;
    }
    get exclude_for_rag(){
        return Object.keys(this.file_handlers);
    }
    get embedding_llm(){
        return getLLMModel({ name: DEFAULT_EMBEDDINGS_LLM});
    }
    get system_types(){
        return '$server, $user, $handler, $trigger, $task'
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
        return this._get_item('users', $user);
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
        while(page?.parent?.type === '$handler')
            page = page?.parent;
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

        let title = context.label;
        title += ` [${page.label}]`;
        text = text.replaceAll('{title}', title);
        return text;
    }

    get testerHTML() {
        return fs.readFileSync('tester.html', {encoding: 'utf-8'});
    }
    getIndexForTest(file){
        let text = this.testerHTML;
        text = text.replaceAll('{script_path}', file.short || '');
        let title = 'TEST';
        title += ` [${file.short}]`;
        text = text.replaceAll('{title}', title);
        return text;
    }
    static users = {};
    static get_user(ssid = '') {
        ssid ||= this.genGUID()
        return this.users[ssid] ??= {ssid, sockets: {}};
    }
    static clearUserAuth(session) {
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
        for (const session of Object.values(this.users)) {
            if (session.uid === uid)
                this.clearUserAuth(session);
        }
    }

    /** WS: смена auth (login/logout/register) — перезагрузка UI во всех вкладках сессии. */
    static broadcastAuthChanged(payload, sessions) {
        const message = JSON.stringify({ type: 'auth-changed', ...payload });
        const list = sessions ?? Object.values(this.users);
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
        const sessions = Object.values(this.users).filter(s => s.uid === uid);
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
    static mergeScripts(code1, code2) {
        return MERGE.mergeScripts(code1, code2);
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
    static async request(url, headers = {}, post){
        headers = Object.assign({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }, headers)
        url = new URL(url);
        let options = {
            method: post?'POST':'GET',
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            headers
        };
        const client = url.protocol === 'https:' ? https : http;
        return new Promise(async (resolve, reject)=>{
            const req = client.request(options, async (res) => {
                const chunks = [];
                for await (const chunk of res)
                    chunks.push(chunk);
                let buffer = Buffer.concat(chunks);
                switch(res.headers['content-type']){
                    case 'application/json':{
                        buffer = buffer.toString('utf-8');
                        buffer = JSON.parse(buffer);
                        resolve(buffer);
                    } break;
                    default:{
                        resolve({
                            buffer: buffer,
                            contentType: res.headers['content-type'],
                            contentLength: res.headers['content-length']
                        });
                    }
                }
            });
            req.on('error', reject);
            if(post)
                req.write(JSON.stringify(post));
            req.end();
        })
    }
    static async awaitRequestResult(url, headers) {
        return new Promise((resolve, reject) => {
            const checkStatus = async () => {
                try {
                    const taskInfo = await $server.request(url, headers);
                    console.log(`📊 Статус: ${taskInfo.status}`);

                    if (taskInfo.status === 'success') {
                        console.log('✅ Готово!');
                        clearInterval(interval);
                        resolve(taskInfo);
                    }
                    else if (taskInfo.status === 'failed') {
                        clearInterval(interval);
                        reject(new Error(JSON.stringify(taskInfo)));
                    }

                }
                catch (error) {
                    clearInterval(interval);
                    reject(error);
                }
            };
            checkStatus();
            const interval = setInterval(checkStatus, 5000);
        });
    }
}
$server.steps = Object.create(null);
Object.assign($server.prototype, authMethods);
globalThis.$server = $server;
