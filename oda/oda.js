import ODAStyles from './tools/styles/styles.js';
import {Reactor} from '../sources/reactor.js';
document.body.style.visibility = 'hidden';

const domParser = new DOMParser();
function componentCounter(){
    return componentCounter.counter++;
}
Object.defineProperty(Node, 'ignore_activation', {
    enumerable: true,
    writable: false,
    value: true
})

window.customElements.define('for-contents', class forContents extends HTMLElement{nodeType = 42});
componentCounter.counter = 0;
globalThis.ODA = async function ODA(prototype = {}){
    return ODA.telemetry[prototype.is] ??= (async () => {
        if (!window.customElements.get(prototype.is)){
            // prototype = prototype.normalize_props();
            let imports = prototype.imports;
            if (imports){
                if (typeof imports === 'string')
                    imports = imports.split(',');
                imports = prototype.imports = imports.map(i=>i.trim().toLowerCase());
                imports = imports.map(async i=>{
                    if (!i.endsWith('.js'))
                        i+='.js';
                    if (!i.startsWith('/') && !i.startsWith('./'))
                        i = '/' + i;
                    if(i.startsWith('/~/') && window.$context)
                        i = window.$context.short + i;

                    let module = await import(i);
                    let def = module?.default;
                    if(typeof def === 'object')
                        await globalThis.ODA(def, i);
                    return module;

                });
                imports = await Promise.all(imports);
            }
            let template = prototype.template;
            let props = prototype.props = Reactor.proto2props(prototype);
            let exts = prototype.extends;
            if (exts){
                if (typeof exts === 'string')
                    exts = exts.split(',');

                exts = prototype.extends = exts.map(i=>i.trim()).map(i=>{
                    if (i === 'this')
                        return prototype;
                    return ODA.telemetry[i];
                });

                exts = await Promise.all(exts);
                exts.add(prototype);
                template = exts.map(i=>i.template || '').join('\n');
                exts.remove(prototype);
                exts.add(prototype);

                props = exts.reduce((res, p) =>{
                    res = Reactor.join_props(res, p.props);
                    return res;
                }, {})
            }
            prototype.props = props;
            prototype.template = template;
            template = domParser.parseFromString(`<template>${prototype.template}</template>`, 'text/html').querySelector('template');
            const styles = Array.from(template.content.children).filter(i=>i.nodeName === 'STYLE');
            let simple_styles = []
            for (let style of styles) {
                let css = style.textContent;
                while (css.includes('@apply'))
                    css = ODAStyles.applyStyleMixins(css);
                let ss = new CSSStyleSheet();
                let has_import = css.includes('@import')
                if(!has_import)
                    ss.replaceSync(css);

                style.textContent = css;
                style.__ss__ = ss
                if (!css.includes('{{') && !has_import){
                    simple_styles.push(style);
                }
            }

            simple_styles = simple_styles.map(style=>{
                template.content.removeChild(style)
                return style.__ss__;
            })
            let vnode = new VNode(template.content);




            const restoreAttrs = Object.values(props).reduce((res, prop)=>{
                if(prop.name){
                    if(prop.$attr){
                        switch (typeof prop.$attr){
                            case 'string':
                                res[prop.name] = prop.$attr.toKebabCase();
                            default:
                                res[prop.name] = prop.name.toKebabCase();
                        }
                    }
                    else if(prop.$public){
                        res[prop.name] = prop.name.toKebabCase();
                    }
                }
                return res;
            }, {})
            const  observeAttrs = Object.keys(restoreAttrs).map(a=>a.toKebabCase())
            class odaComponent extends HTMLElement{
                __shadowRoot__;
                __id__ =  componentCounter();
                toString(){
                    return `${this.__vnode__?.id || '0'}.${this.__id__}.${this.localName}`;
                }
                constructor() {
                    super(...arguments);
                    this[R].props = props;
                    this[R].prototype = prototype;
                    this.__shadowRoot__ = this.attachShadow({ mode: 'closed' });
                    this.__shadowRoot__.adoptedStyleSheets = [...ODAStyles.adopted, ...simple_styles];
                    this.__shadowRoot__.__vnode__ = vnode;
                    queueMicrotask(() => {
                        if (this.$listeners) {
                            this.init_reactive_services(ODA.EVENTS);
                            if (this.$listeners.resize)
                                ODA.resizeObserver.observe(this);
                        }

                        const fields = Object.getOwnPropertyDescriptors(this);
                        for(let field in fields){
                            let prop = props[field];
                            if(!prop)
                                continue;
                            let val = this[field];
                            this[field] = undefined
                            delete this[field];
                            this[field] = val;
                        }
                        for(let p of Object.values(props).filter(p=>(p?.$public || p?.$attr))){
                            let val = this[p.name];
                        }
                        for (let a of Array.from(this.attributes)) {
                            if(!observeAttrs.includes(a.name))
                                observeAttrs.push(a.name);
                            this.attributeChangedCallback(a.name, undefined, a.value);
                        }
                        this.ready?.();
                        this.render();
                    })
                }
                get topHost(){
                    return this.host?.topHost || this;
                }
                get isComponent(){
                    return true;
                }
                async connectedCallback() {
                    queueMicrotask(() => {
                        // for(let p of Object.values(this[R].props)){
                        //     if(p.$attr || p.$public){
                        //         let value = await this[p.name];
                        //         setAttribute.call(this, p.attr_name, value);
                        //     }
                        // }
                        this.attached?.();
                    })
                }
                disconnectedCallback() {
                    this.detached?.();
                    Reactor.cleanupDeps(this);
                }
                static get observedAttributes() {
                    return observeAttrs;
                }
                attributeChangedCallback(name, o, value) {
                    if (o === value)
                        return;
                    if (name === 'slot') {
                        this.render();
                    }
                    else {
                        name = name.toCamelCase()
                        let type = this[R].props[name]?.$type;
                        this[name] = (value === '' && type === Boolean)?true:getTypeConverter(type)(value);
                    }
                }
                $(path, ignore_slotted = false) { //todo из слотов
                    return this.$$(path, ignore_slotted)[0];
                }
                $$(path, ignore_slotted = false) {//todo из слотов
                    if (!path) return [];
                    let result =  [...this.__shadowRoot__.querySelectorAll(path)];
                    if(!ignore_slotted){
                        let recurse_slots = (node)=>{
                            const nodes =  Array.prototype.filter.call(node.childNodes, el=>{
                                return el.__vnode__?.slotName && el[R].cache.replacer;
                            }).map((res)=>{
                                return Object.values(res[R].cache.replacer)
                                    .reduce((res, e)=>{
                                        if(e.nodeType !== 8 && e.isConnected){
                                            if(e.matches(path)){
                                                res.push(e);
                                            }
                                            res.push(...e.querySelectorAll(path));
                                        }
                                        return res;
                                    }, []);
                            }).filter(Boolean);
                            return [...nodes, ...(Array.prototype.map.call(node.childNodes, recurse_slots))].flat();
                        }
                        result.push(...recurse_slots(this.__shadowRoot__));
                    }
                    return result;
                }

                loadFromLocalStorage(key) {
                    const value = ODA.LocalStorage.create(this._savePath).getItem(key);
                    switch (value?.constructor) {
                        case Object: return { ...value };
                        case Array: return [...value];
                        case Date:
                        case Number:
                        case String:
                        case Boolean:
                        default:
                            return value;
                    }
                }
                saveToLocalStorage(key, value) {
                    if (this[R].states.sleep)
                        return;
                    ODA.LocalStorage.create(this._savePath).setItem(key, value);
                }
                clearLocalStorageData() {
                    ODA.LocalStorage.create(this._savePath).clear();
                }
                get isPopover(){
                    return this.host?.isPopover || !!this.popover;
                }
                async showContextMenu(menu = {title: 'Context menu', items:[]}){
                    await import('/oda/components/menus/menu/menu.js');
                    const element = ODA.createElement('oda-menu', menu);
                    if(this.isPopover)
                        this.__shadowRoot__.appendChild(element);
                    else
                        document.body.appendChild(element);
                }
                notify(prop, value){
                    if(prop){
                        if(prop.name === 'rendering')
                            return;
                        if(prop?.$save)
                            this.saveToLocalStorage(prop.name, value)
                        this.fire(prop.attr_name + '-changed', value);
                    }
                    this.throttle('rendering', () => {
                        this.render();
                    }, 16)
                }
                render(wake){
                    this.throttle('custom-render', () => {
                        if (!this.isConnected)
                            return;
                        // Reactor.collector = {target: this, key: 'rendering'}
                        this.__vnode__?.render(this);

                            for(let p of Object.values(this[R].props)){
                                if(p.$attr || p.$public){
                                    let value = this[p.name];
                                    if(value?.then){
                                        value?.then(res=>{
                                            setAttribute.call(this, p.attr_name, res);
                                        })
                                    }
                                    else
                                        setAttribute.call(this, p.attr_name, value);
                                }
                            }


                        this.__shadowRoot__.renderChildren(wake);
                        if(this.__vnode__){
                            this.renderChildren(wake);
                        }
                        this.onRender?.();
                    });
                }
                get _savePath() {
                    return (this.host?this.host._savePath + '/':'') + this.localName + (this.$saveKey?'['+this.$saveKey+']':'');
                }
            }

            Object.defineProperties(odaComponent.prototype, props);
            window.customElements.define(prototype.is, odaComponent);
        }
        return prototype;
    })()
}
ODA.rootPath = '/oda';
function waitForCustomElement(tagName, timeout = 30000) {
    tagName = String(tagName || '').toLowerCase();
    if (!tagName)
        return Promise.reject(new Error('waitReg: empty tag name'));
    if (typeof customElements !== 'undefined' && customElements.get(tagName))
        return Promise.resolve();
    if (typeof customElements === 'undefined')
        return Promise.reject(new Error('waitReg: customElements unavailable'));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`waitReg timeout: ${tagName}`));
        }, timeout);
        customElements.whenDefined(tagName).then(() => {
            clearTimeout(timer);
            resolve();
        }, (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
async function loadJSON(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`loadJSON failed (${response.status}): ${url}`);
    const text = await response.text();
    if (!text.trim())
        return null;
    return JSON.parse(text);
}
ODA.waitReg = waitForCustomElement;
ODA.loadJSON = loadJSON;

class VNode{
    id = VNode.counter();
    children = [];
    template;
    parent;
    #textRender;
    #attributes = Object.create(null);
    #listeners = Object.create(null);
    #directives = Object.create(null);
    #bindings = Object.create(null);
    #for;
    constructor(template, parent) {
        this.template = template;
        this.parent = parent;
        this.tag = template.nodeName.toLowerCase();
        for (let templ of template.childNodes){
            if (templ.nodeType === 3 && !templ.nodeValue.trim())    // empty text
                continue;
            this.children.push(new VNode(templ, this))
        }
        if(template.nodeType === 1){
            for (const attr of template.attributes) {
                let name = attr.name;
                let expr = attr.value;
                switch (name[0]){
                    case '~':{  //directive
                        name = name.slice(1);
                        const directive = ODA.DIRECTIVES[name];
                        if (!directive)
                            throw new Error(`unknown directive "${name}"`);
                        let fn = new Function('$this, $for', `with(this){  return (${expr || name})}`)
                        let dir_fn = el => {
                            let res = fn.call(el.host.$pdp, el, el.$for);
                            if(res?.then)
                                return res.then(res=>{
                                    return directive.call(el,  res);
                                })
                            return directive.call(el,  res);
                        }
                        if(name === 'for')
                            this.#for = dir_fn;
                        else
                            this.#directives[name] = dir_fn
                    } break;
                    case ':':{  //binding
                        name = name.slice(1);
                        if (name[0] === ':'){
                            name = name.slice(1);
                            let fn = new Function('$this, $for, $value', `with(this){ return (${expr || name.toCamelCase()} = $value)}`);
                            this.#listeners[name + '-changed'] = function (e){
                                if(!this.isConnected)
                                    return;
                                e.stopPropagation();
                                let val = e.detail?e.detail.value:(this.type === 'checkbox'?this.checked:this.value);
                                fn.call(this.host.$pdp, this, this.$for, val);
                            }
                            if(['input', 'textarea', 'select'].includes(this.tag))
                                this.#listeners['input'] = this.#listeners[name + '-changed'];
                        }
                        else if(name === 'slot'){
                            this.slotName = expr;
                        }

                        let prop_name = name.toCamelCase();
                        let fn = new AsyncFunction('$this, $for', `with(this){return (${expr || prop_name})}`);
                        this.#bindings[name] = el => {
                            let prop = el[R]?.props[prop_name]
                            if(prop?.isUpdated){
                                return;
                            }

                            let res = fn.call(el.host.$pdp, el, el.$for);
                            if(res?.then){
                                return res.then(res=>{
                                    el.$pdp[prop_name] = res;
                                })
                            }
                            el.$pdp[prop_name] = res;
                        }
                    } break;
                    case '@':{  //event
                        name = name.slice(1);
                        let modifiers = name.split('.');
                        name = modifiers.shift();
                        let fn = new Function('$event, $this, $for', `with(this){return (${expr || ('this._'+('on-' + name).toCamelCase())})}`)
                        this.#listeners[name] = (e)=>{
                            if (e.currentTarget.nodeType !== 1) //todo а может и не 1 но точно не 42
                                return;
                            for(let m of modifiers){
                                switch (m){
                                    case 'stop':
                                        e.stopPropagation();
                                        break;
                                    case 'prevent':
                                        e.preventDefault();
                                        break;
                                }
                            }
                            const result = fn.call(e.currentTarget.host.$pdp, e, e.currentTarget, e.currentTarget.$for);
                            if (typeof result === 'function')
                                result.call(e.currentTarget.host, e)
                        }
                        this.#listeners[name].modifiers = modifiers;
                    } break;
                    default:{
                        if (name ===  'slot')
                            this.slotName = expr;
                        if(expr.startsWith('{{') && expr.endsWith('}}')){
                            expr = expr.slice(2,-2);
                            let fn = new AsyncFunction('$this, $for', `with(this){return (${expr})}`);
                            this.#bindings[name] = el => {
                                let res = fn.call(el.host.$pdp, el, el.$for);
                                if(res?.then){
                                    return res.then(res=>{
                                        el.$pdp[name] = res;
                                    })
                                }
                                el.$pdp[name] = res;
                            }
                        }
                        else{
                            this.#attributes[name] = expr;
                        }
                    }
                }
            }
        }
        else if (template.nodeType === 3){
            let value = template.textContent;
            let expr = value.replace(/^|$/g, "'").replace(/{{/g, "'+(").replace(/}}/g, ")+'").replace(/\n/g, "\\n").replace(/\+\'\'/g, "").replace(/\'\'\+/g, "");
            if (value.includes('{{') && value.includes('}}')){
                const fn = new AsyncFunction('$this, $for', `with(this){ return ((${expr}) ?? '')}`);
                this.#textRender = el => {
                    let res = fn.call(el.host.$pdp, el.parentNode, el.parentNode.$for);
                    if(res?.then){
                        return res.then(res=>{
                            if (el.textContent === res) return
                            queueMicrotask(()=>{
                                el.textContent = res;
                            })
                        })
                    }
                    if (el.textContent === res) return;
                    queueMicrotask(()=>{
                        el.textContent = res;
                    })


                }
            }
            else{
                this.#textRender = el => {
                    if (el.textContent === value) return
                    queueMicrotask(()=>{
                        el.textContent = value;
                    })
                }
            }
        }
    }
    get attrs(){
        return this.#bindings;

    }
    get isComment(){
        return 'if' in this.#directives || !!this.slotName;
    }
    get isStyle(){
        return this.tag === 'style';
    }
    get isSvg(){
        return (this.parent?.isSvg || this.tag === 'svg');
    }
    get isFor(){
        return !!this.#for;
    }
    get textContent(){
        return this.template.textContent;
    }
    static __counter__ = 0;
    static counter(){
        return ++this.__counter__;
    }
    render(element) {
        if (!element.isConnected) return element;

        switch (element.nodeType) {
            case 1: {
                if (element.isForContents) {
                    this.#for?.(element);
                    break;
                }

                const dirs = this.#directives;
                for (const dir in dirs) {
                    const next = dirs[dir](element);
                    if (next?.nodeType === 1 && element.isConnected) {
                        element = next;
                    } else if (next) {
                        return next;
                    }
                }

                const binds = this.#bindings;
                for (const bind in binds) {
                    binds[bind](element);
                }
                break;
            }
            case 8: {
                if (this.slotName) {
                    const cache = element[R].cache;
                    const replacer = cache.replacer ??= { '#comment': element };
                    if (element !== replacer['#comment']) return element;

                    let el = element.__replacer__;
                    if (!el || el === element) {
                        el = replacer[this.tag];
                    }
                    if (!el) {
                        el = replacer[this.tag] ??= this.#directives.if ? this.createElement('#comment') : this.createElement();
                        el[R].cache = cache;
                        el[R].cache.parent = element.parentNode;
                        el.host = element.host;
                        el = this.render(el);
                    }

                    requestAnimationFrame(() => el.render?.());

                    const filter = `slot[name='${el.slot}']`;
                    let domHost = el.host;

                    for (const ch of domHost.$$('*', true)) {
                        if (!ch.isComment && !ch.children.length) ch.render();
                        if (ch.$?.(filter, true)) {
                            if (el.parentNode !== ch) {
                                ch?.appendChild(el);
                                domHost?.render?.();
                            }
                            return el;
                        }
                    }

                    while (domHost) {
                        for (const ch of domHost.children) {
                            if (!ch.isComment && !ch.children.length) ch.render();
                            if (ch.$?.(filter, true) || (ch.nodeName.toLowerCase() === 'slot' && ch.name === el.slot)) {
                                if (el.parentNode !== ch) {
                                    ch?.appendChild(el);
                                }
                                return el;
                            }
                        }
                        if (domHost.$(filter, true)) {
                            if (el.parentNode !== domHost) {
                                domHost?.appendChild(el);
                            }
                            return el;
                        }
                        domHost = domHost.host;
                    }
                    el.host?.render?.();
                }
                this.#directives.if?.(element);
                break;
            }
            case 42: {
                this.#for?.(element);
                break;
            }
            case 3: {
                this.#textRender?.(element);
                break;
            }
        }
        return element;
    }
    createElement(tag = this.tag){
        let element;
        if (tag === '#comment'){
            let comment = this.id + ' ' + this.tag;
            if (this.slotName)
                comment += ' slot="' + (this.slotName) + '"';
            element = document.createComment(comment);
        }
        else if (tag === '#text')
            element = document.createTextNode('');
        else {
            if (this.isSvg){
                let is_for = tag === 'for-contents'
                if(is_for)
                    tag = 'g'
                element = document.createElementNS("http://www.w3.org/2000/svg", tag.toLowerCase());
                if(is_for)
                    element.isForContents = true;

            }
            else {
                element = document.createElement(tag);
            }
            switch (tag) {
                case 'STYLE': {

                } break;
                case 'IFRAME': {
                    element.addEventListener('load', e => {
                        try {
                            if (!e.target.contentDocument.ODA) {
                                pointerDownListen(e.target.contentWindow);
                            }
                        }
                        catch (e) {
                            console.warn(e)
                        }
                    })
                } break;
                default: {
                    if (tag.startsWith('for-') || (!this.isSvg && tag !== 'slot' && !this.isStyle && element.nodeType === 1)) {
                        ODA.intersectionObserver.observe(element);
                    }
                }
            }
            for (let attr in this.#attributes)
                element.setAttribute(attr, this.#attributes[attr]);
            for (let event in this.#listeners) {
                if (event === 'resize')
                    ODA.resizeObserver.observe(element);
                let fn = this.#listeners[event];
                event = ODA.EVENTS[event] || event;
                if (typeof event === 'string'){
                    const ops = {}
                    ops.passive = fn.modifiers?.includes('passive');
                    ops.capture = fn.modifiers?.includes('capture');
                    element.addEventListener(event, fn.bind(element), ops);
                }
                else if (typeof event === 'function')
                    event(element, fn.bind(element));
            }
        }

        element.__vnode__ = this;
        return element;
    }
    replaceElement(old, tag = this.tag){
        if(!old.isConnected)
            return;
        let el_tag = old.nodeName.toLowerCase();
        if (el_tag === tag)
            return old;

        let replacer = old[R].cache.replacer ??= {[el_tag]: old};
        let comment = replacer['#comment'];
        let element = replacer[tag]
        if (!element){
            element = replacer[tag] = this.createElement(tag);
            element[R].cache = old[R].cache;
        }
        if (old.parentNode && replacer.parentNode !== old.parentNode){
            old.parentNode.replaceChild(element, old);
            if(comment)
                comment.__replacer__ = element;
            old.$for = undefined;
        }
        return element;
    }
}
ODA.telemetry  = Object.create(null);

ODA.resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
        entry.target.fire('resize');
    }
})

ODA.intersectionObserver = new IntersectionObserver(entries => {
    let wake;
    for (let i = 0, entry, l = entries.length; i < l; i++) {
        entry = entries[i];
        if(!entry.target.isConnected) continue;
        entry.target[R].states.sleep = !entry.isIntersecting;
        if (!entry.target[R].states.sleep) {
            wake ??= [];
            wake.add(entry.target)
        }
    }
    if (!wake) return;
    for (let t of wake){
        t.fire('wake');
        t.render?.(true);
    }

}, { rootMargin: '20%', threshold: 0 })


function setAttribute(name, value) {
    if (typeof value !== 'object') {
        try {
            // name = name.toKebabCase();
            if (value || value === 0) {
                this.setAttribute(name, value === true ? '' : value);
            } else {
                this.removeAttribute(name);
            }
        } catch (e) {
            console.warn('setAttribute error:', e);
        }
    }
}

function removeElement(){
    for (let el of Object.values(this[R].cache.replacer || {})){
        el.remove();
    }
    this.remove();
}

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

function styleToObject(style = ''){
    if (typeof style !== 'string')
        return style;
    style = style.split(';');
    style = style.reduce((resolve, val)=>{
        val = val.split(':');
        if (val.length === 2){
            let name = val.shift().trim().toKebabCase();
            val = val.shift().trim();
            resolve[name] = val
        }
        return resolve;
    }, {});
    return style;
}

function objectToStyle(obj = {}){
    let style = [];
    for (let key in obj){
        let val = obj[key];
        if (typeof val === 'object') continue;
        style.push(key.toKebabCase() + ': ' + val);
    }
    return style.join('; ');
}
const AsyncFunction = (async function () { }).constructor;
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
    Object.defineProperty(Node.prototype, '$pdp', {
        enumerable: false,
        configurable: false,
        get() {
            const cache = this[R].cache;
            const key = '$pdp:' + this.nodeName;
            if (cache[key]) return cache[key];

            const proxy = new Proxy(this, {
                has(target, p) {
                    if (p === '$for' || p === '$event' || p === '$this') return false;
                    while (target) {
                        if (p in target) return true;
                        target = target.host;
                    }
                    return false;
                },
                get(target, p, receiver) {
                    if (p in target) {
                        const value = target[p];
                        return typeof value === 'function' ? value.bind(target) : value;
                    }
                    return target.host?.$pdp[p];
                },
                set(target, p, value, receiver) {
                    if (target.isComponent) {
                        let domHost = target;
                        while (domHost) {
                            if (p in domHost) {
                                domHost[p] = value;
                                break;
                            }
                            domHost = domHost.host;
                        }
                    }
                    if (typeof value !== 'object') {
                        if (!(p in target)) {
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

ODA.EVENTS = {
    'tap': 'click',
    'down': 'mousedown',
    'up': 'mouseup',
    'm_down': 'mousedown',
    'm_up': 'mouseup',
    'p_down': 'pointerdown',
    'p_up': 'pointerup',
    'k_down': 'keydown',
    'k_up': 'keyup',
    'track': function regTrack(target, handler){

        if (!('__trackHandlers' in target)) {
            Object.defineProperty(target, '__trackHandlers', {
                enumerable: false,
                configurable: true,
                writable: true,
                value: new Map()
            });
        }
        const info = { target: {}, window: {} };
        if (target.__trackHandlers.has(handler)) {
            __unlisten.call(target, handler);
        }
        target.__trackHandlers.set(handler, info);
        let detail;
        target.addEventListener('pointerdown', pointerDown);
        function pointerDown(e) {
            if ((target !== e.target && !(target.contains(e.target))) || e.buttons !== 1) return;
            detail = {
                start: {
                    x: e.clientX,
                    y: e.clientY
                }, ddx: 0, ddy: 0, dx: 0, dy: 0,
                target,
                startButton: e.button
            };
            window.addEventListener('pointermove', moveHandler);
            window.addEventListener('dragstart', upHandler);
            window.addEventListener('pointerup', upHandler);
            target.addEventListener('pointerleave', leave, { once: true });
            info.window.pointermove = moveHandler;
            info.window.dragstart = upHandler;
            info.window.pointerup = upHandler;
            info.target.pointerleave = leave;
        }
        function leave(e) {
            if ((target === e.target || target.contains(e.target)) && detail && !detail.state)
                start(e);
        }
        function start(e) {
            target.removeEventListener('pointerleave', leave);
            delete info.target.pointerleave;
            target.setPointerCapture(e.pointerId);
            detail.state = 'start';
            fireTrack(e);
        }
        function moveHandler(e) {
            if (detail && !detail.state) {
                const x = Math.abs(detail.start.x - e.clientX);
                const y = Math.abs(detail.start.y - e.clientY);
                if (Math.max(x, y) > 2)
                    start(e);
            }
            else if (detail) {
                detail.state = 'track';
                detail.x = e.clientX;
                detail.y = e.clientY;
                detail.ddx = -(detail.dx - (e.clientX - detail.start.x));
                detail.ddy = -(detail.dy - (e.clientY - detail.start.y));
                detail.dx = e.clientX - detail.start.x;
                detail.dy = e.clientY - detail.start.y;
                fireTrack(e);
            }
        }
        function fireTrack(e) {
            const ce = new odaCustomEvent('track', { detail: Object.assign({}, detail)}, e);
            handler(ce, ce.detail);
        }
        function upHandler(e) {
            window.removeEventListener('pointermove', moveHandler);
            window.removeEventListener('pointerup', upHandler);
            target.removeEventListener('pointerleave', leave);
            delete info.window.pointermove;
            delete info.window.pointerup;
            delete info.target.pointerleave;
            if (detail?.state) {
                detail.ddx = 0;
                detail.ddy = 0;
                detail.state = 'end';
                fireTrack(e);
            }
        }
        class odaCustomEvent extends CustomEvent {
            constructor(name, params, source) {
                super(name, params);
                if (source) {
                    const props = {
                        path: {
                            value: source.composedPath()
                        },
                        currentTarget: {
                            value: source.currentTarget
                        },
                        target: {
                            value: source.target
                        },
                        stopPropagation: {
                            value: () => source.stopPropagation()
                        },
                        preventDefault: {
                            value: () => source.preventDefault()
                        },
                        sourceEvent: {
                            value: source
                        }
                    };
                    Object.defineProperties(this, props);
                }
            }
        }
    }
}
const KEY = Symbol.for('KEY')
ODA.DIRECTIVES = {
    if(value){
        if (!value && this.nodeType !== 8){
            return this.__vnode__.replaceElement(this, '#comment')
        }
        else if (value && this.nodeType === 8){
            return this.__vnode__.replaceElement(this)
        }
    },
    is(tag = this.__vnode__?.tag){
        if (tag && this.nodeType === 1 && tag !== this.nodeName.toLowerCase()){
            return this.__vnode__.replaceElement(this, tag)
        }
    },
    for(items = []) {
        if (typeof items === 'object' && !Array.isArray(items)) {
            const keys = Object.keys(items);
            const array = new Array(keys.length);
            for (let i = 0; i < keys.length; i++) {
                array[i] = { item: items[keys[i]], key: keys[i] };
            }
            items = array;
        } else if (!Number.isNaN(+items)) {
            const len = Math.floor(+items);
            items = new Array(len);
            for (let i = 0; i < len; i++) items[i] = i;
        }

        const prevFor = this.$for;
        const childs = this.childNodes;
        const itemsLen = items.length;
        const currentLen = childs.length;

        // Обновляем существующие или создаём новые
        for (let i = 0; i < itemsLen; i++) {
            const item = items[i];
            if (item === undefined || item === null) {
                while (this.firstChild) this.removeChild(this.firstChild);
                return;
            }

            let el = childs[i];
            if (!el) {
                el = this.__vnode__.isComment ? this.__vnode__.createElement('#comment') : this.__vnode__.createElement();
                this.appendChild(el);
            }

            let target = el;
            if (prevFor) {
                target = el.$for = Object.assign({}, prevFor);
                while (target.$for) {
                    target = target.$for = Object.assign({}, target.$for);
                }
            }

            const $for = { item, index: i, items, key: item.key ?? i };
            if (!Reactor.equal(target.$for, $for, 2)) {
                target.$for = $for;
            }
            el.render();
        }

        // Удаляем лишние
        for (let i = currentLen - 1; i >= itemsLen; i--) {
            const el = childs[i];
            if (el) removeElement.call(el);
        }
    },
    show(value){
        this.hidden = !value;
    },
    style(style){
        if (this.nodeType !== 1 || Reactor.equal(this[R].cache.style, style, 1))
            return
        this[R].cache.style = style;
        let def_style = this[R].cache.def_style ??= styleToObject(this.getAttribute('style') || '');
        style = styleToObject(style);
        Object.assign(style, def_style);
        style = objectToStyle(style);
        this.setAttribute('style', style);
    },
    class(classes){
        if (this.nodeType !== 1 || Reactor.equal(this[R].cache.classes, classes, 1))
            return
        this[R].cache.classes = classes;
        let def_classes = this[R].cache.def_classes ??= (this.getAttribute('class') || '').split(' ').filter(Boolean);
        if (typeof classes === 'string'){
            classes = classes.split(' ').filter(Boolean);
        }
        let list = []
        if (typeof classes === 'object'){
            if (Array.isArray(classes)){
                list.push(...classes)
                for (let cls of def_classes){
                    list.add(cls);
                }
            }
            else{
                for (let cls of def_classes){
                    if(classes[cls] !== false)
                        list.add(cls);
                }
                for(let cls in classes){
                    if(classes[cls] === true)
                        list.add(cls);
                }
            }
        }
        list = list.join(' ')
        this.setAttribute('class', list);
    },
    text(text = '') {
        if (this[R].cache.textContent === text) return;
        this[R].cache.textContent = text;
        if (!this[R].cache.pendingText) {
            this[R].cache.pendingText = text;
            queueMicrotask(() => {
                this.textContent = this[R].cache.pendingText;
                this[R].cache.pendingText = null;
            });
        }
    },
    html(html = '') {
        if (this[R].cache.innerHTML === html) return;
        if(typeof html !== 'string') return;
        this[R].cache.innerHTML = html;
        if (!this[R].cache.pendingHTML) {
            this[R].cache.pendingHTML = html;
            queueMicrotask(() => {
                this.innerHTML = this[R].cache.pendingHTML;
                this[R].cache.pendingHTML = null;
            });
        }
    },
    props(props){
        if (props === undefined)
            return;
        if (Reactor.equal(this[R].cache.props,  props))
            return;
        this[R].cache.props = props
        this.assignProps(props);
    }
}


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