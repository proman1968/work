import "../oda/oda.js";
import * as CORE from "./client/index.js";
import { Reactor } from "./reactor.js";
import { RTCCaller } from "./modules/call/call.js";
import "./modules/user-profile/user-profile.js";
window.RTCCaller = RTCCaller;
class WORK_ServerError extends Error{}
window.CORE = CORE;
ODA({is: 'item-control',
    $item: {
        $def: null,
        // set(n) {
        //     n?.addEventListener?.('changed', e => {
        //         // this.isChanged = true;
        //         this.render();
        //     })
        // }
    },
    get isChanged(){
        return this.$item?.isChanged;
    },
    $handler: Object,
    iconSize: 24,
    save() {
        return this.$item?.save();
    },
    $public:{
        get icon(){
            return this.$item?.icon;
        },
        get label(){
            return this.$item?.label;
        }
    },
    get $saveKey(){
        return this.$item?.short
    }
});
const _ODA = ODA;
globalThis.ODA = function(prototype, url){
    if(prototype.is)
        return _ODA(prototype);
    prototype.is = 'item-' + (prototype.id || url.split('/').pop().split('.').shift());
    return WORK(prototype)
}
for(let key in _ODA){
    globalThis.ODA[key] = _ODA[key]
}
globalThis.WORK = function (prototype = {}){
    if(!Array.isArray(prototype.extends))
        prototype.extends = (prototype.extends || '').split(',').map(i=>i.trim()).filter(Boolean);
    prototype.extends.unshift('item-control');
    return ODA(prototype);
}
WORK.genGUID = CORE.$item.genGUID;
WORK.$item = CORE.$item;
/** Контракт: get_item → всегда $item (info). Контент файла — явно 'load' или item.load(). */
WORK.get_item = function (path = '/', method = 'info', params = {}){
    method = method || 'info';
    let url = location.origin + path;
    return WORK.fetch(url, method, params).then(data=>{
        return WORK.__bind(data, path);
    }).catch(error=>{
        return null;
    });
}
let fetches = {};
WORK.fetch = function (url, method = '', params = {}, postObject) {
    let {contentType} = params;
    url = encodeURI(url + (method ? '?' + method : ''));
    url += Object.keys(params).reduce((res, p) => {
        let val = params[p];
        if(val)
            res += ((res || method) ? '&' : '?') + encodeURIComponent(p) + '=' + encodeURIComponent(val);
        return res;
    }, '');
    let options = {method: 'GET'};
    options.headers = {
        'X-WORK-WSID': WORK.wsid
    }
    if(postObject){
        if(!contentType && !(postObject instanceof FormData)){
            if(postObject instanceof ArrayBuffer)
                contentType = 'application/octet-stream';
            else if(typeof postObject === 'object'){
                postObject = JSON.stringify(postObject);
                contentType = 'application/json'
            }
            else if(typeof postObject === 'string')
                contentType = 'text/plain'
        }
        else if(postObject instanceof FormData)
            contentType = '';
        options.method = 'POST';
        options.body = postObject;

        if(contentType)
            options.headers['Content-Type'] = contentType;

    }

    return fetches[url] ??= new Promise((resolve, reject) => {
        queueMicrotask(async ()=>{
            try {
                this.timerId ??= setTimeout(()=>{
                    if(!top.document.body.contains(top.loader) && Object.keys(fetches).length){
                        top.document.body.appendChild(top.loader);
                    }
                    top.loader.render();
                }, 500)

                let response = await fetch(url, options);
                switch (response.status) {
                    case 204: {
                        // 204 No Content — нет тела для парсинга
                        resolve(null);
                    } break;
                    case 302:
                    case 200: {
                        let content_type_header = response.headers.get('Content-Type');
                        let res = content_type_header ? content_type_header.split(';')[0] : content_type_header;
                        switch (res) {
                            case 'application/x.odant.async':
                            case 'application/x.odant.async+json':
                            case 'text/x-json':
                            case 'application/json':
                                resolve(await response.json());
                                break;
                            case 'text/cmd':
                            case 'text/css':
                            case 'text/csv':
                            case 'text/javascript':
                            case 'application/javascript':
                            case 'text/php':
                            case 'text/html':
                            case 'text/plain':
                            case 'text/xml':
                            case 'text/msg':
                            case 'text/markdown':
                            case 'text/calendar':
                            case 'image/svg+xml':
                                resolve(await response.text());
                                break;
                            default: {
                                resolve(await response.blob());
                            }
                        }
                    } break;
                    default: {
                        let text = await response.text()
                        throw new WORK_ServerError(text);
                    }
                }
            }
            catch (e) {
                reject(e);
            }
            finally{
                fetches[url] = undefined;
                delete fetches[url];
                setTimeout(()=>{
                    if(!Object.keys(fetches).length){
                        clearTimeout(this.timerId);
                        this.timerId = undefined;
                        top.loader.remove();
                    }

                }, 100)
            }
        })
    })
}
ODA({is: 'work-loader',
    template: /*html*/`
        <style>
            :host{
                @apply --rainbow;
                position: fixed !important;
                top: 50%;
                left: 50%;
                z-index: 10000;
                transform: translate3d(-50%, -50%, 0);
                pointer-events: none;
                filter: drop-shadow(2px 2px 5px rgba(0,0,0,0.5));
                border-radius: 50%;
                overflow: hidden;
                align-self: center;
                width: 64px;
                aspect-ratio: 1/1;
                @apply --vertical;

                background-color: transparent;

            }
            img{
                background-color: transparent;
                padding: 8px;
                border-radius: 50%;
                animation: spin 2s linear infinite;

            }
            @keyframes spin {
                0% { transform: rotate(0deg) scale(1); }
                50% { transform: rotate(180deg) scale(.9); }
                100% { transform: rotate(360deg) scale(1); }
            }
        </style>
        <img flex src="/sources/odant.png"></img>
    `,
    attached(){
        this.render();
    }
});
top.loader ??= ODA.createElement('work-loader');

WORK.__bind = function (data, path = '') {
    if (typeof data === 'object') {
        if (Array.isArray(data))
            return data.map(d => WORK.__bind(d))
        if (data?.type || data?.path) {
            if (!data.type) {
                const id = data.id || data.path?.split('/').pop() || '';
                data = {...data, id, type: id.includes('.') ? '$file' : '$folder'};
            }
            let key =  (path || data.path || (data.id + ':' + data.type)) + (data.reply?':reply':'');
            let item = CORE.$item.ITEMS[key];
            if (!item) {
                item = CORE.$item.ITEMS[key] = Reactor.activate(new (CORE[data.type] || CORE.$class)(data));
            } else {
                Object.assign(item.DATA ??= {}, data);
                delete item.body;
            }
            for (let list of CORE.$item.LISTS) {
                let items = data[list];
                if (items?.length) {
                    item[list] = WORK.__bind(items);
                }
            }
            return item;
        }
    }
    return Reactor.activate(data);
}



WORK.showModal = function (el, params = {}) {
    params.popoverType = 'modal';
    return WORK.showPopover(el, params);
}
WORK.showDialog = async function (el, params = {}) {
    // params.allowClose = true;
    params.popoverType = 'dialog';
    let result = await WORK.showPopover(el, params);
    if (!result)
        throw new Error('cancel');
    return result;
}
WORK.showMenu = function (params = {}, e) {
    params.popoverType = 'menu';
    params.menu ??= ODA.createComponent('item-menu', params);
    return WORK.showPopover(params.menu, params, e);
}

WORK.showDropdown = function (el, params = {}, e) {
    params.popoverType = 'dropdown';
    return WORK.showPopover(el, params, e);
}


WORK.showPopover = function (el, params = {}, e) {
    return new Promise(async (resolve) => {
        const pop = ODA.createComponent('item-popover', params);
        pop.setAttribute('popover', 'manual');
        pop.position = e;
        pop.listen('close', e => {
            const popovers = window.document.querySelectorAll('[popover]');
            let removeFrom = Array.prototype.indexOf.call(popovers, pop);
            if (popovers[removeFrom]?.popoverType === 'menu') {
                while ((removeFrom > 0) && (popovers[removeFrom - 1].popoverType === 'menu')) {
                    removeFrom--;
                }
            }
            if ((popovers[removeFrom]?.popoverType === 'modal') && (popovers.length - 1 > removeFrom)) {
                removeFrom++
            }
            for (let i = removeFrom; i < popovers.length; i++) {
                popovers[i]?.remove();
            }
            resolve(e.detail?.value);
        });

        for (let i = 0; i < window.frames.length; i++) {
            let frame = window.frames[i];
            frame.addEventListener('pointerdown', e => {
                const popovers = Array.prototype.reverse.call(top.document.querySelectorAll('[popover]'));
                for (let pop of popovers) {
                    pop.remove();
                }
            })
        }

        pop.control = el;
        window.document.body.appendChild(pop);
        pop.showPopover();
    })
}
WORK.clearSessionCache = function () {
    for (const item of Object.values(CORE.$item.ITEMS)) {
        Reactor.cleanupDeps(item);
        if (item[R]?.cache)
            item[R].cache = {};
        for (const list of CORE.$item.LISTS)
            delete item[list];
    }
    for (const key of Object.keys(CORE.$item.ITEMS))
        delete CORE.$item.ITEMS[key];
};

WORK.syncAuthUI = async function () {
    WORK.USER = WORK.uid ? await WORK.get_$user(WORK.uid) : undefined;
    const explorer = window.explorer;
    if (!explorer)
        return;
    explorer.left_buttons = undefined;
    explorer.render?.();
};

/** Событие auth для подписчиков в той же вкладке + BroadcastChannel для других. */
WORK.authEvents ??= (typeof EventTarget !== 'undefined') ? new EventTarget() : null;
WORK.notifyAuth = function (payload = {}) {
    try { WORK.AUTH_CHANNEL?.postMessage(payload); } catch {}
    try {
        WORK.authEvents?.dispatchEvent(new CustomEvent('auth', { detail: payload }));
    } catch {}
};

WORK.onAuthChanged = function (payload = {}) {
    if (WORK._authReloading)
        return;
    const credUid = WORK.credentials?.uid || '';
    const newUid = payload.uid || '';
    if ((payload.reason === 'login' || payload.reason === 'register') && newUid && (!credUid || newUid === credUid)) {
        WORK.uid = newUid;
        WORK.syncAuthUI();
        try {
            WORK.authEvents?.dispatchEvent(new CustomEvent('auth', { detail: payload }));
        } catch {}
        return;
    }
    if (payload.reason === 'logout' && !newUid && !credUid) {
        WORK.uid = '';
        WORK.USER = undefined;
        WORK.syncAuthUI();
        try {
            WORK.authEvents?.dispatchEvent(new CustomEvent('auth', { detail: { uid: '', reason: 'logout' } }));
        } catch {}
        return;
    }
    WORK._authReloading = true;
    WORK.clearSessionCache();
    WORK.uid = newUid;
    WORK.USER = undefined;
    location.reload();
};

if (typeof BroadcastChannel !== 'undefined') {
    WORK.AUTH_CHANNEL ??= new BroadcastChannel('work-auth');
    WORK.AUTH_CHANNEL.addEventListener('message', (e) => {
        if (e.data)
            WORK.onAuthChanged(e.data);
    });
}

WORK.login = async function(){
        let secure = ODA.LocalStorage.create('work-secure');
        WORK.credentials = secure.getItem('credentials');
        let KEY = secure.getItem('KEY');
        let uid = WORK.credentials?.uid;
        if(uid && KEY){
            let challengeId = crypto.randomUUID();
            const challenge = await WORK.fetch("/", 'user_login_start', { uid, challengeId});
            KEY = Uint8Array.from(atob(KEY), c => c.charCodeAt(0));
            let privateKey = await crypto.subtle.importKey("pkcs8", KEY, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["sign"]);
            let signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, new TextEncoder().encode(challenge));
            signature = WORK.arrayBufferToBase64(signature);
            const res = await WORK.fetch("/", 'user_login_finish' ,  { uid, time: WORK.credentials.time, challengeId}, {signature});
            WORK.uid = uid;
            await WORK.syncAuthUI();
            WORK.notifyAuth?.({ uid, reason: 'login' });
            return res;
        }
        WORK.uid = '';
        WORK.USER = undefined;
        await WORK.fetch("/", 'user_exit', {}, {}).catch(() => {});
        await WORK.syncAuthUI();
        WORK.notifyAuth?.({ uid: '', reason: 'logout' });
}
WORK.requestNotificationPermission = async function () {
    let result = false;
    switch (Notification.permission) {
        case 'granted': { result = true; } break;
        case 'default': {
            const permission = await Notification.requestPermission();
            result = permission === 'granted';
        } break;
    }
    return result;
}
WORK.getPublicVapid = async function () {
    let key = await WORK.fetch("/", 'get_public_vapid');
    key = WORK.urlBase64ToUint8Array(key);
    return WORK.arrayBufferToBase64(key);
}
WORK.storePushSubscription = function (subscription) {
    return WORK.fetch("/", 'store_push_subscription', {}, subscription);
}
WORK.removePushSubscription = function (subscription) {
    return WORK.fetch("/", 'remove_push_subscription', {}, subscription);
}
WORK.urlBase64ToUint8Array = function(base64String){
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
WORK.arrayBufferToBase64 = function(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}
window.addEventListener('pointerdown', e => {
    let h = e.target;
    while (h && !h.hasAttribute?.('popover')) {
        h = h.host || h.parentElement;
    }

    const removePopovers = window => {
        const popovers = window.document.querySelectorAll('[popover]');
        for (let p of popovers) {
            if (h) {
                if (h === p) {
                    h = undefined;
                }
                continue;
            }
            if (p.allowClose) {
                p.close();
            }
            else {
                p.remove();
            }
        }
    }
    removePopovers(window);
    for (let i = 0; i < window?.length; i++) {
        removePopovers(window[i]);
    }
})



class WebSocketEvents {
    id = '';
    constructor() {
        try{
            let ws = window.location.protocol === 'http:'?'ws://':'wss://'
            this.socket = new WebSocket(ws + window.location.host + '/ws');
            this.socket.onopen = this.onopen.bind(this.socket);
            this.socket.onclose = this.onclose;
            this.socket.onerror = this.onerror.bind(this.socket);
            this.socket.onmessage = this.onmessage;

        }
        catch(e){
            console.error(e)
        }
    }
    onopen(e) {
        this.send(JSON.stringify(Object.keys(CORE.$item.ITEMS)));
        WORK.connected = true;
        WORK.login();
    }
    onclose(e) {
        WORK.connected = false;
        WORK.wsid = '';
        delete this;
        setTimeout(() => {
            new WebSocketEvents();
        }, 3000);
        // console.log('Close webSocket connection');
    }
    onerror(e) {
        // console.error('Error in webSocket connection', e);
        this.close();
    }
    async onmessage(e) {
        let data = e.data;
        try{
            data = JSON.parse(data);
        }
        catch {
            // non-JSON websocket payload — ignore
        }
        switch(data?.type){
            case 'connect':{
                WORK.wsid = this.id = data.wsid
            } break;
            case 'auth-changed': {
                WORK.onAuthChanged(data);
            } break;
            case 'phone.call': {
                if (window === WORK.top)
                    RTCCaller.onmessage(JSON.parse(data.message))
            } break;
            case 'push':{
                ODA.showMessage(data.message);
            } break;
            case 'chat.delta':
            case 'chat.done':
            case 'chat.error':
            case 'chat.clear_stream': {
                if(!data.path)
                    return;
                let item = CORE.$item.ITEMS[data.path];
                if(!item)
                    item = Object.values(CORE.$item.ITEMS).find(i=>i.short === data.path);
                if(item)
                    item.fire(data.type, data);
            } break;
            default:{
                if(!("path" in data)){
                    console.log('web-socket-event', data)
                    return;
                }

                let item = CORE.$item.ITEMS[data.path];
                if(!item)
                    item = Object.values(CORE.$item.ITEMS).find(i=>i.short === data.path);
                if(item){
                    const LISTS = item.constructor.LISTS || CORE.$item.LISTS;
                    for(let key of LISTS){
                        if (key in item)
                            item[key] = undefined;
                            delete item[key];
                    }
                    // item[R].cache = {};
                    item.fire('changed', data);
                    item.increaseVersion();
                }
            }
        }
    }
}

WORK.get_$user = function (uid = WORK.uid){
    return WORK.get_item('/USERS//' + uid);
}

WORK.$users = function (){
    return WORK.get_item('/USERS/*');
}


WORK.top = (() => {
    let top = window;
    let parent = window.parent;
    while (parent && parent.WORK && parent !== top) {
        top = parent;
        parent = parent.parent;
    }
    return top;
})();
if (WORK.top === window) {
    setTimeout(async () => {
        const swRegistration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const pushPermission = await WORK.requestNotificationPermission();
        if (pushPermission) {
            try {
                const vapidPublicKey = await WORK.getPublicVapid();
                let pushSubscription = await swRegistration.pushManager.getSubscription();
                const subscriptionIsValid = (() => {
                    if (pushSubscription) {
                        return (!pushSubscription.expirationTime || Date.now() < pushSubscription.expirationTime) &&
                            WORK.arrayBufferToBase64(pushSubscription.options.applicationServerKey) === vapidPublicKey
                    }
                    return false;
                })();
                if(!subscriptionIsValid){
                    if(pushSubscription){
                        await WORK.removePushSubscription(pushSubscription);
                        await pushSubscription.unsubscribe();
                    }
                    pushSubscription = await swRegistration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: WORK.urlBase64ToUint8Array(vapidPublicKey)
                    });
                    await WORK.storePushSubscription(pushSubscription);
                }
            }
            catch (err) {
                console.warn(err);
            }
        }
        RTCCaller.init();
    }, 3000);
}
let _renderCanvas = null;
function getRenderCanvas()  {
    return _renderCanvas ??= document.createElement('canvas');
}
WORK.renderText = async (element, backgroundColor) => {
    const LINE_HEIGHT_COEF = 0.15;
    const canvas = getRenderCanvas();
    const offset = {
        x: element.offsetLeft,
        y: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight
    };
    const rect = element.getBoundingClientRect();
    const coef = Math.min(offset.width / rect.width, offset.height / rect.height);
    const el_x = rect.x * coef;
    const el_y = rect.y * coef;
    const el_w = rect.width * coef;
    const el_h = rect.height * coef;
    canvas.width = el_w;
    canvas.height = el_h;
    const ctx = canvas.getContext('2d');
    if (backgroundColor) {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (node.textContent.trim().length === 0) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const styles = window.getComputedStyle(node.parentElement);

        ctx.font = `${styles.fontWeight} ${styles.fontSize} /${styles.lineHeight} ${styles.fontFamily}`;
        ctx.fillStyle = styles.color;
        ctx.textBaseline = 'top';

        const text = node.textContent;

        let lastTop = null;
        let lineText = '';
        let lineRects = [];

        for (let i = 0; i < text.length; i++) {
            const charRange = document.createRange();
            charRange.setStart(node, i);
            charRange.setEnd(node, i + 1);

            const rawCharRect = charRange.getBoundingClientRect();
            const charRect = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
            for (const k in rawCharRect) {
                charRect[k] = rawCharRect[k] * coef;
            }

            if (charRect.width > 0 && charRect.height > 0) {
                if (lastTop !== null && Math.abs(charRect.top - lastTop) > 1) {
                    if (lineText && lineRects[0]) {
                        const x = lineRects[0].left - el_x;
                        const y = lineRects[0].top - el_y + lineRects[0].height * LINE_HEIGHT_COEF;
                        ctx.fillText(lineText, x, y);
                    }

                    lineText = text[i];
                    lineRects = [charRect];
                } else {
                    lineText += text[i];
                    lineRects.push(charRect);
                }

                lastTop = charRect.top;
            }
        }

        if (lineText && lineRects[0]) {
            const x = lineRects[0].left - el_x;
            const y = lineRects[0].top - el_y + lineRects[0].height * LINE_HEIGHT_COEF;
            ctx.fillText(lineText, x, y);
        }
        const img = new Image();
        const promise = new Promise((resolve, reject) => {
            img.onload = () => {
                resolve(img);
            };
            img.onerror = (err) => {
                reject(err);
            }
        });
        img.src = canvas.toDataURL();
        return promise;
    }
}
WORK.renderSVG = async (svg) => {
    const svgClone = svg.cloneNode(true);
    const useEl = svgClone.querySelector('use');
    if (useEl) {
        const [href, iconId] = useEl.href.baseVal.split('#');
        if (iconId) {
            const response = await fetch(href);
            const libText = await response.text();

            const parser = new DOMParser();
            const libDoc = parser.parseFromString(libText, 'image/svg+xml');

            const iconNode = libDoc.getElementById(iconId);

            const importedIconNode = svgClone.ownerDocument.importNode(iconNode, true);

            let defs = svgClone.querySelector('defs');
            if (!defs) {
                defs = svgClone.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svgClone.insertBefore(defs, svgClone.firstChild);
            }
            defs.appendChild(importedIconNode);

            useEl.href.baseVal = `#${iconId}`;
        }
    }
    const imageEl = svgClone.querySelector('image');
    if (imageEl) {
        const src = imageEl.href.baseVal;
        const response = await fetch(src);
        const blob = await response.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        imageEl.href.baseVal = dataUrl;
        await new Promise((resolve, reject) => {
            imageEl.onload = () => resolve(imageEl);
            imageEl.onerror = (err) => reject(err);
        });
    }
    const dataUrl = 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(svgClone));
    const img = new Image();
    img.style.objectFit = 'cover';
    const promise = new Promise((resolve, reject) => {
        img.onload = () =>  resolve(img);
        img.onerror = (err) => reject(err);
    });
    img.src = dataUrl;
    return promise;
}
Object.defineProperty(WORK, 'users', {
    get(){ //todo надо сбрасывать при появлении новых пользователей на сервере
        return WORK._users ??= new AsyncPromise(async _=>{
            let res = await WORK.get_item('/USERS');
            return res.children;
        });
    }
})



new WebSocketEvents();