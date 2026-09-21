import {Reactor} from '../sources/reactor.js';
import {
    setAttribute,
    waitForCustomElement,
    loadJSON
} from './core/shared.js';
import {registerODA} from './core/component.js';
import {initObservers} from './core/observers.js';
import {EVENTS} from './core/events.js';
import {DIRECTIVES} from './core/directives.js';
document.body.style.visibility = 'hidden';

Object.defineProperty(Node, 'ignore_activation', {
    enumerable: true,
    writable: false,
    value: true
})

window.customElements.define('for-contents', class forContents extends HTMLElement{nodeType = 42});
registerODA();
ODA.waitReg = waitForCustomElement;
ODA.loadJSON = loadJSON;

initObservers();

ODA.Worker = class {
    constructor(url, props) {
        this.worker = new ((typeof SharedWorker !== 'undefined') ? SharedWorker : Worker)(url, props);
        this.worker = this.worker.port || this.worker;
        this.worker.start?.();
    }
    set onmessage(v) {
        this.worker.onmessage = v;
    }
    get onmessage() {
        return this.worker.onmessage;
    }
    set onmessageerror(v) {
        this.worker.onmessageerror = v
    }
    get onmessageerror() {
        return this.worker.onmessageerror;
    }
    postMessage(...args) {
        this.worker.postMessage(...args);
    }
}

Node:{
    Object.defineProperty(Node.prototype, 'domParent', {
        enumerable: false,
        configurable: false,
        get(){
            let parent = this[R].cache.parent || this.parentNode
            if (parent?.nodeType === 11){
                parent = parent.host;
            }
            return parent;
        }
    })

    Object.defineProperty(Node.prototype, 'host', {
        enumerable: false,
        configurable: false,
        get(){
            return (this[R].cache.host ??= this.parentElement?.host ||  this.parentNode?.host);
        },
        set(n){
            this[R].cache.host = n;
        }
    })

    Object.defineProperty(Node.prototype, '$for', {
        enumerable: false,
        configurable: false,
        get(){
            return (this[R].cache.$for || this[R].cache.parent?.$for || this.parentNode?.$for);
        },
        set(n){
            this[R].cache.$for = n;
        }
    })

    Object.defineProperty(SVGElement.prototype, '$pdp', {
        enumerable: false,
        configurable: false,
        get(){
            return this[R].cache['$pdp: '+ this.nodeName] ??= new Proxy(this, {
                set(target, p, value) {
                    let old = target.getAttribute(p) || '';
                    if (old != value){
                        setAttribute.call(target,  p, value);
                    }
                    return true;
                }
            })
        }
    })

    const PDP_EXCLUDES = ['$for', '$event', '$this'];
    /** CE-проп: в [R].props (геттеры) или на узле; для with($pdp) в директивах. */
    function pdpHasProp(node, p) {
        return !!(node[R]?.props && p in node[R].props) || Reflect.has(node, p);
    }
    function pdpOwner(node, p) {
        while (node) {
            if (pdpHasProp(node, p)) return node;
            node = node.host;
        }
        return null;
    }
    Object.defineProperty(Node.prototype, '$pdp', {
        enumerable: false,
        configurable: false,
        get() {
            const cache = this[R].cache;
            const key = '$pdp:' + this.nodeName;
            if (cache[key]) return cache[key];

            const proxy = new Proxy(this, {
                has(target, p) {
                    // Symbols (@@unscopables) — только Reflect, не Reactor / host-walk
                    if (typeof p === 'symbol')
                        return Reflect.has(target, p);
                    if (PDP_EXCLUDES.includes(p)) return false;
                    return !!pdpOwner(target, p);
                },
                get(target, p, receiver) {
                    if (typeof p === 'symbol')
                        return Reflect.get(target, p, receiver);
                    if (PDP_EXCLUDES.includes(p)) return undefined;
                    // Геттер X читает $pdp.X — не себя, иначе рекурсия. with($pdp) в шаблоне — с себя.
                    const reentering = Reactor._collectorTarget === target && Reactor._collectorKey === p;
                    const owner = pdpOwner(reentering ? target.host : target, p);
                    if (!owner) return undefined;
                    if (owner[R])
                        return Reactor.get(owner, p);
                    const value = owner[p];
                    return typeof value === 'function' ? value.bind(owner) : value;
                },
                set(target, p, value, receiver) {
                    if (target.isComponent) {
                        const domHost = pdpOwner(target, p);
                        if (domHost)
                            domHost[p] = value;
                    }
                    if (typeof value !== 'object') {
                        if (!pdpHasProp(target, p)) {
                            setAttribute.call(target, p.toKebabCase(), value);
                        } else if (target[p] !== value) {
                            target[p] = value;
                        }
                    }
                    return true;
                }
            });

            cache[key] = proxy;
            return proxy;
        }
    })


    Node.prototype.render = function (wake) {
        if (!this.__vnode__ || !this.isConnected)
            return;
        this.throttle('render', ()=>{
            this.__vnode__.render(this);
            if(!this[R].states.sleep || wake)
                if(this.nodeType === 1)
                    this.renderChildren(wake);
        })
    };
    Node.prototype.renderChildren = function (wake) {
        if(!wake)
            if (!this.isConnected || !this.__vnode__.children?.length)
                return;
        let child = this.childNodes;
        for(let idx = 0; idx<this.__vnode__.children?.length; idx++){
            let el = child[idx];
            if (!el){
                let vn = this.__vnode__.children[idx];
                if (vn.isFor){
                    el = vn.createElement('for-contents');
                    el.setAttribute('style',"display: contents !important;");
                }
                else if (vn.isComment)
                    el = vn.createElement('#comment');
                else
                    el = vn.createElement();
                this.appendChild(el);
            }
            // el.render(wake);
        }
        for(let el of child){
            el.render?.(wake);
        }
    };
}

Element:{

    Element.prototype.assignProps = function (props) {
        if(!props) return;
        let descrs = Reactor.proto2props(props)
        for (let key in descrs) {
            let p = descrs[key];
            if (typeof p.value === 'function') {
                this[R].cache.__propsHandlers ??= {};
                if (this[R].cache.__propsHandlers[key]) {
                    this.removeEventListener(key, this[R].cache.__propsHandlers[key], true);
                }
                const fn = this[R].cache.__propsHandlers[key] = p.value.bind(this);
                // если не кешировать функцию после bind, то каждый раз будет новая подписка
                this.addEventListener(key, fn, true);
                Object.defineProperty(this, key, p);
            }
            else{
                if(key in ODA.DIRECTIVES){
                    ODA.DIRECTIVES[key].call(this, p.$def?.() || p.value || this.localName);
                }
                else if(p.$def){
                    p = props[key];
                    this[key] = p;
                    key = key.toKebabCase();
                    setAttribute.call(this, key, p);
                }
                else{
                    this[R].props = Object.assign({}, this[R].props)
                    Object.defineProperty(this, key, p);
                    p.isUpdated = true;
                    this[R].props[key] = p;
                }
            }
        }
    }
    Element.prototype.getClientRect = function (element) {
        let rect = this.getBoundingClientRect.call(this);
        if (element) {
            const rectHost = element.getBoundingClientRect?.() || element;
            const res = {x: 0, y: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0};
            for (let n in res)
                res[n] = rect[n];
            res.x -= rectHost.x || 0;
            res.y -= rectHost.y || 0;
            res.top -= rectHost.top || 0;
            res.left -= rectHost.left || 0;
            res.bottom -= rectHost.top || 0;
            res.right -= rectHost.left || 0;
            res.center = {x: res.left + (res.right - res.left) / 2, y: res.top + (res.bottom - res.top) / 2};
            rect = res;
            rect.element = element;
        }
        return rect;
    }
}
ODA.showFileDialog = ({ accept = '*', multiple }) => {
    return new Promise(resolve => {
        const fialog = document.createElement('input');
        fialog.setAttribute('type', 'file');
        fialog.setAttribute('accept', accept);
        fialog.setAttribute('multiple', multiple);
        fialog.onchange = (e) => {
            resolve(e.target.files);
        };
        fialog.click();
        fialog.remove();
    })
};
localStorage: {
    ODA.LocalStorage = class odaLocalStorage extends Reactor{
        _value;
        constructor(path) {
            super();
            this.path = path;
        }

        get value() {
            return this._value ??= (()=>{
                try {
                    const data = JSON.parse(globalThis.localStorage.getItem(this.path) || '{}');
                    data.$$stamp ??= Date.now();
                    return data;
                }
                catch (e) {
                    console.warn(e)
                }
                return {};
            })();
        }
        getItem(key) {
            return this.value[key];
        }
        getFromItem(key, subKey) {
            return this.value[key]?.[subKey];
        }
        getByPath(path) {
            const [key, ...subKeys] = path.split('/');
            let res = this.value[key];
            for (const subKey of subKeys) {
                if (!res) break;
                res = res[subKey];
            }
            return res;
        }
        setItem(key, value) {
            this.value[key] = value;
            this.save();
        }
        setToItem(key, subKey, value) {
            key = this.value[key] ??= {};
            key[subKey] = value;
            this.save();
        }
        setByPath(path, value) {
            const [key, ...subKeys] = path.split('/');
            if (!subKeys.length) {
                this.value[key] = value;
            }
            else {
                let res = this.value[key] ??= {};
                for (const subKey of subKeys.slice(0, -1)) {
                    res = res[subKey] ??= {};
                }
                res[subKeys.at(-1)] = value;
            }
            this.save();
        }
        save() {
            if (this._value === undefined)
                return;
            this.debounce('saveToLocalStorage',()=>{
                globalThis.localStorage.setItem(this.path, JSON.stringify(this.value));
            })
        }
        get version() {
            return this.value.$$stamp;
        }
        clear() {
            globalThis.localStorage.removeItem(this.path);
            this._value = undefined;
        }

        static items = {}
        static create(path) {
            return ODA.LocalStorage.items[path] ??= new ODA.LocalStorage(path);
        }
    }
}
ODA.createComponent = ODA.createElement = (id, props) => {
    let el = document.createElement(id);
    if (props)
        el.assignProps(props);
    return el;
}

ODA.regTool = function (name) {
    return ODA[name] || (ODA[name] = Object.create(null));
}

ODA.EVENTS = EVENTS;
ODA.DIRECTIVES = DIRECTIVES;

// Восстановим оригинальную логику начальной видимости
document.body.style.visibility = 'hidden';

// После инициализации компонента помечаем его как готовый к визуальным обновлениям
ODA.DIRECTIVES.init = function() {
    this[R].cache.initialized = true;
}
ODA.showMessage = (message) => {
    return ODA.showNotification('message', {body: message});
}

ODA.showNotification = async (title = '', options = {}) => {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        const notification = new Notification(title, {
            body: options.body || 'Новое уведомление',
            icon: options.icon || '/favicon.ico',
            badge: options.badge || '/favicon.ico',
            image: options.image,
            tag: options.tag || 'label',
            requireInteraction: options.requireInteraction ?? true,
            silent: options.silent || false,
            vibrate: options.vibrate || [200, 100, 200],
            data: options.data || {},
            actions: options.actions || []
        });
        notification.onclick = options.onclick;
        notification.onclose = options.onclose;
        return notification;
    }
};

const loadedCallback = async () => {
    // pointerDownListen();
    // document.oncontextmenu = (e) => {
    //     e.target.dispatchEvent(new MouseEvent('menu', e));
    //     return !!e.target?.use_native_menu;
    // };
    // let sleep = 0;
    if (document.body.firstElementChild) {
        if (document.body.firstElementChild.nodeName === 'ODA-TESTER') {
            document.body.style.visibility = 'hidden';
            window.tester = document.body.firstElementChild;
            document.body.firstElementChild.style.visibility = 'hidden';
            const buttons = []
            window.tester.constructor.prototype.addButton = function (e){
                buttons.push(e)
            }
            await import('./tools/tester/tester.js');
            setTimeout(() => {
                document.body.firstElementChild.style.visibility = 'visible';
                document.body.style.visibility = 'visible';
                buttons.forEach(i=>window.tester.addButton(i))
            }, 200);
        }
        else{
            setTimeout(()=>{
                document.body.style.visibility = 'visible';
            }, 200)

        }

        document.title = document.title || (document.body.firstElementChild.label || document.body.firstElementChild.name || document.body.firstElementChild.localName);

    }
};
if (document.readyState === "complete" || document.readyState === "interactive"){
    loadedCallback();
}
else {
    window.addEventListener('load', loadedCallback);
}
globalThis.ODA.states = {}
Object.defineProperty(globalThis.ODA.states, 'mobileMode', {
    enumerable: true,
    get(){
        return window.innerWidth / window.innerHeight < .7;
    }
})

Object.defineProperty(String.prototype, 'fixKeyboardLayout', {
    enumerable: true,
    value () {
        let text = this;
        // Раскладка клавиатуры: русская и английская
        const ruLayout = 'йцукенгшщзхъфывапролджэячсмитьбюёЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮЁ';
        const enLayout = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,./`QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>~';


        // Создаем объект для быстрого поиска
        const ruToEn = {};
        const enToRu = {};

        // Заполняем объекты соответствий
        for (let i = 0; i < ruLayout.length; i++) {
            ruToEn[ruLayout[i]] = enLayout[i];
            enToRu[enLayout[i]] = ruLayout[i];
        }

        // Определяем, какая раскладка используется в тексте
        let ruCount = 0;
        let enCount = 0;

        for (let char of text) {
            if (ruLayout.includes(char)) ruCount++;
            if (enLayout.includes(char)) enCount++;
        }

        // Выбираем направление конвертации
        const mapping = ruCount > enCount ? ruToEn : enToRu;

        // Конвертируем текст
        let result = '';
        for (let char of text) {
            result += mapping[char] || char;
        }

        return result;
    }
})
Reactor.activate(globalThis.ODA.states);
export default ODA;