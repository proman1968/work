/**
 * ODA core/vnode — виртуальный DOM.
 * Вынесено из oda/oda.js без изменений логики.
 * Доступ к ODA.DIRECTIVES / ODA.EVENTS / ODA.resizeObserver /
 * ODA.intersectionObserver — через глобал на момент вызова
 * (фасад oda.js гарантирует инициализацию до первой регистрации).
 */
import {
    compileDirective,
    compileBinding,
    compileTwoWay,
    compileEvent,
    compileAttrBinding,
    compileText,
    textTemplateToExpr
} from './compiler.js';

export class VNode{
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
                        let fn = compileDirective(expr, name);
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
                            let fn = compileTwoWay(expr, name);
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
                        let fn = compileBinding(expr, prop_name);
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
                        let fn = compileEvent(expr, ('this._'+('on-' + name).toCamelCase()));
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
                            let fn = compileAttrBinding(expr);
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
            let expr = textTemplateToExpr(value);
            if (value.includes('{{') && value.includes('}}')){
                const fn = compileText(expr);
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
            // Не сбрасывать $for: cache общий у old/new, иначе ~is+~for ломает ~props
        }
        return element;
    }
}
