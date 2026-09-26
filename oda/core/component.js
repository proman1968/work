/**
 * ODA core/component — реестр компонентов: ODA(prototype), odaComponent.
 * Вынесено из oda/oda.js без изменений логики.
 * Обращения к ODA.* внутри — через глобал на момент вызова
 * (DIRECTIVES/EVENTS/observers/LocalStorage ставит фасад oda.js
 * до первой регистрации компонента — как и было).
 */
import ODAStyles from '../tools/styles/styles.js';
import { Reactor } from '../../sources/reactor.js';
import { VNode } from './vnode.js';
import { domParser, componentCounter, setAttribute } from './shared.js';

/**
 * $pdp-наследование (паритет предшественника): голые чтения this.X в методах
 * резолвятся вверх по host-цепочке. При connect ставим собственные
 * делегирующие аксессоры для $pdp-имён хостов, которых нет у нас.
 * Get идёт через host (рекурсия до владельца), set пишет владельцу,
 * чтобы не плодить тени на промежуточных хостах.
 */
const PDP_DELEGATED = '$pdp-delegated';
function pdpDelegateOwner(el, name) {
    let host = el.host;
    while (host) {
        if (host[R]?.cache?.[PDP_DELEGATED]?.has(name)) {
            host = host.host;
            continue;
        }
        if (host[R]?.props?.[name] || name in host)
            return host;
        host = host.host;
    }
    return undefined;
}
function installPdpDelegates(el) {
    const delegated = el[R].cache[PDP_DELEGATED] ??= new Set();
    for (let host = el.host; host; host = host.host) {
        if (!host.isComponent)
            continue;
        for (const prop of Object.values(host[R]?.props || {})) {
            const name = prop?.name;
            if (!prop?.$pdp || !name || name in el || delegated.has(name))
                continue;
            delegated.add(name);
            Object.defineProperty(el, name, {
                configurable: true,
                enumerable: false,
                get() {
                    return pdpDelegateOwner(this, name)?.[name];
                },
                set(value) {
                    const owner = pdpDelegateOwner(this, name);
                    if (owner)
                        owner[name] = value;
                }
            });
        }
    }
}

export function registerODA() {
    globalThis.ODA = async function ODA(prototype = {}) {
        return ODA.telemetry[prototype.is] ??= (async () => {
            if (!window.customElements.get(prototype.is)) {
                // prototype = prototype.normalize_props();
                let imports = prototype.imports;
                if (imports) {
                    if (typeof imports === 'string')
                        imports = imports.split(',');
                    imports = prototype.imports = imports.map(i => i.trim().toLowerCase());
                    imports = imports.map(async i => {
                        if (!i.endsWith('.js'))
                            i += '.js';
                        if (!i.startsWith('/') && !i.startsWith('./'))
                            i = '/' + i;
                        if (i.startsWith('/~/') && window.$context)
                            i = window.$context.short + i;

                        let module = await import(i);
                        let def = module?.default;
                        if (typeof def === 'object')
                            await globalThis.ODA(def, i);
                        return module;

                    });
                    imports = await Promise.all(imports);
                }
                let template = prototype.template;
                let props = prototype.props = Reactor.proto2props(prototype);
                let exts = prototype.extends;
                if (exts) {
                    if (typeof exts === 'string')
                        exts = exts.split(',');

                    exts = prototype.extends = exts.map(i => i.trim()).map(i => {
                        if (i === 'this')
                            return prototype;
                        return ODA.telemetry[i];
                    });

                    exts = await Promise.all(exts);
                    exts.add(prototype);
                    template = exts.map(i => i.template || '').join('\n');
                    exts.remove(prototype);
                    exts.add(prototype);

                    props = exts.reduce((res, p) => {
                        res = Reactor.join_props(res, p.props);
                        return res;
                    }, {})
                }
                prototype.props = props;
                prototype.template = template;
                template = domParser.parseFromString(`<template>${prototype.template}</template>`, 'text/html').querySelector('template');
                const styles = Array.from(template.content.children).filter(i => i.nodeName === 'STYLE');
                let simple_styles = []
                for (let style of styles) {
                    let css = style.textContent;
                    while (css.includes('@apply'))
                        css = ODAStyles.applyStyleMixins(css);
                    let ss = new CSSStyleSheet();
                    let has_import = css.includes('@import')
                    if (!has_import)
                        ss.replaceSync(css);

                    style.textContent = css;
                    style.__ss__ = ss
                    if (!css.includes('{{') && !has_import) {
                        simple_styles.push(style);
                    }
                }

                simple_styles = simple_styles.map(style => {
                    template.content.removeChild(style)
                    return style.__ss__;
                })
                let vnode = new VNode(template.content);




                const restoreAttrs = Object.values(props).reduce((res, prop) => {
                    if (prop.name) {
                        if (prop.$attr) {
                            switch (typeof prop.$attr) {
                                case 'string':
                                    res[prop.name] = prop.$attr.toKebabCase();
                                default:
                                    res[prop.name] = prop.name.toKebabCase();
                            }
                        }
                        else if (prop.$public) {
                            res[prop.name] = prop.name.toKebabCase();
                        }
                    }
                    return res;
                }, {})
                const observeAttrs = Object.keys(restoreAttrs).map(a => a.toKebabCase())
                class odaComponent extends HTMLElement {
                    __shadowRoot__;
                    __id__ = componentCounter();
                    toString() {
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
                            for (let field in fields) {
                                let prop = props[field];
                                if (!prop)
                                    continue;
                                let val = this[field];
                                this[field] = undefined
                                delete this[field];
                                this[field] = val;
                            }
                            for (let p of Object.values(props).filter(p => (p?.$public || p?.$attr))) {
                                let val = this[p.name];
                            }
                            for (let a of Array.from(this.attributes)) {
                                if (!observeAttrs.includes(a.name))
                                    observeAttrs.push(a.name);
                                this.attributeChangedCallback(a.name, undefined, a.value);
                            }
                            this.ready?.();
                            this.render();
                        })
                    }
                    get topHost() {
                        return this.host?.topHost || this;
                    }
                    get isComponent() {
                        return true;
                    }
                    async connectedCallback() {
                        installPdpDelegates(this);
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
                            this[name] = (value === '' && type === Boolean) ? true : getTypeConverter(type)(value);
                        }
                    }
                    $(path, ignore_slotted = false) { //todo из слотов
                        return this.$$(path, ignore_slotted)[0];
                    }
                    $$(path, ignore_slotted = false) {//todo из слотов
                        if (!path) return [];
                        let result = [...this.__shadowRoot__.querySelectorAll(path)];
                        if (!ignore_slotted) {
                            let recurse_slots = (node) => {
                                const nodes = Array.prototype.filter.call(node.childNodes, el => {
                                    return el.__vnode__?.slotName && el[R].cache.replacer;
                                }).map((res) => {
                                    return Object.values(res[R].cache.replacer)
                                        .reduce((res, e) => {
                                            if (e.nodeType !== 8 && e.isConnected) {
                                                if (e.matches(path)) {
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
                    get isPopover() {
                        return this.host?.isPopover || !!this.popover;
                    }
                    async showContextMenu(menu = { title: 'Context menu', items: [] }) {
                        await import('/oda/components/menus/menu/menu.js');
                        const element = ODA.createElement('oda-menu', menu);
                        if (this.isPopover)
                            this.__shadowRoot__.appendChild(element);
                        else
                            document.body.appendChild(element);
                    }
                    notify(prop, value) {
                        if (prop) {
                            if (prop.name === 'rendering')
                                return;
                            if (prop?.$save)
                                if (!(value instanceof Promise)) {
                                    this.saveToLocalStorage(prop.name, value)
                                }
                            this.fire(prop.attr_name + '-changed', value);
                        }
                        this.throttle('rendering', () => {
                            this.render();
                        }, 16)
                    }
                    render(wake) {
                        this.throttle('custom-render', () => {
                            if (!this.isConnected)
                                return;
                            // Reactor.collector = {target: this, key: 'rendering'}
                            this.__vnode__?.render(this);

                            for (let p of Object.values(this[R].props)) {
                                if (p.$attr || p.$public) {
                                    let value = this[p.name];
                                    if (value?.then) {
                                        value?.then(res => {
                                            setAttribute.call(this, p.attr_name, res);
                                        })
                                    }
                                    else
                                        setAttribute.call(this, p.attr_name, value);
                                }
                            }


                            this.__shadowRoot__.renderChildren(wake);
                            if (this.__vnode__) {
                                this.renderChildren(wake);
                            }
                            this.onRender?.();
                        });
                    }
                    get _savePath() {
                        return (this.host ? this.host._savePath + '/' : '') + this.localName + (this.$saveKey ? '[' + this.$saveKey + ']' : '');
                    }
                }

                Object.defineProperties(odaComponent.prototype, props);
                window.customElements.define(prototype.is, odaComponent);
            }
            return prototype;
        })()
    }
    ODA.telemetry = Object.create(null);
    ODA.rootPath = '/oda';
    return globalThis.ODA;
}
