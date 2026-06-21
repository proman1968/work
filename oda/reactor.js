// ===== Константы =====
const RESERVED_WORDS = ['is', 'extends', 'imports', 'template', 'constructor', '$listeners', '$observers', '$keys', '$attributes'];
const PROPERTY_ATTRIBUTES = ['$public', '$category', '$cat', '$def', '$type', '$attr', '$attribute', '$save', '$list', '$values', 'get', 'set'];

// ===== Вспомогательные функции =====
function toDate(v) { return new Date(v); }
function toString(v) { return v?.toString() || ''; }
function toNumber(v) { return (v !== undefined) ? Number(v) : undefined; }
function toBigInt(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'string') {
        const val = /^[\-\+]?[0-9]+/.exec(v);
        return val === null ? undefined : BigInt(val[0]);
    }
    const val = Math.round(Number(v));
    return isFinite(val) ? BigInt(val) : undefined;
}
function toBool(v, def = false) {
    if (v === undefined || v === null) return def;
    switch (typeof v) {
        case 'object': return true;
        case 'string': return v.toLowerCase() === 'true';
        case 'boolean': return v;
        case 'number': return v !== 0;
        case 'bigint': return v !== 0n;
    }
    return false;
}

function getTypeConverter(type) {
    switch (type) {
        case Boolean: return toBool;
        case Number: return toNumber;
        case String: return toString;
        case Date: return toDate;
        case BigInt: return toBigInt;
    }
    return (val) => val;
}

// ===== Расширение String =====
String: {
    const kebabGlossary = Object.create(null);
    function toKebab(str) {
        return kebabGlossary[str] ??= str.replace(/\B([A-Z])/g, '-$1').toLowerCase();
    }
    if (!String.toKebabCase) {
        Object.defineProperty(String.prototype, 'toKebabCase', {
            enumerable: false, value: function () {
                return toKebab(this.toString());
            }
        });
    }

    const camelGlossary = Object.create(null);
    function toCamel(str) {
        return camelGlossary[str] ??= str.replace(/-(\w)/g, function (_, c) { return c ? c.toUpperCase() : '' })
    }
    if (!String.toCamelCase) {
        Object.defineProperty(String.prototype, 'toCamelCase', {
            enumerable: false, value: function () {
                return toCamel(this.toString());
            }
        });
    }

    const capitalGlossary = Object.create(null);
    function toCapital(str) {
        if (!str) return '';
        return capitalGlossary[str] ??= str[0].toUpperCase() + str.slice(1);
    }
    if (!String.toCapitalCase) {
        Object.defineProperty(String.prototype, 'toCapitalCase', {
            enumerable: false, value: function () {
                return toCapital(this.toString());
            }
        });
    }

    if (!String.toQName) {
        Object.defineProperty(String.prototype, 'toQName', {
            enumerable: false, value: function () {
                return this.toLowerCase().split(' ')
                    .map((s, i) => {
                        if (i === 0) return (s === 'the') ? '' : s;
                        return s;
                    })
                    .join('-')
                    .replace(/-{2,}/g, '-')
                    .replace(/(^\d)/, '_$1')
                    .replace(/\./g, '');
            }
        })
    }
}

// ===== Расширение EventTarget =====
globalThis.R = Symbol.for('R');
if (!('fire' in EventTarget.prototype)) {
    Object.defineProperties(EventTarget.prototype, {
        listen: {
            configurable: false,
            enumerable: true,
            writable: false,
            value: function (event, handler, props = { target: this, once: false, useCapture: false }) {
                if (typeof handler === 'string')
                    handler = this[handler]?.bind(this);
                (props.target || this).addEventListener?.(event, handler, props);
            }
        },
        unlisten: {
            configurable: false,
            enumerable: true,
            writable: false,
            value: function (event, handler, props = { target: this, once: false, useCapture: false }) {
                if (typeof handler === 'string')
                    handler = this[handler]?.bind(this);
                (props.target || this).removeEventListener?.(event, handler, props);
            }
        },
        fire: {
            configurable: false,
            enumerable: true,
            writable: false,
            value: function (event, detail, options = {}) {
                event = new CustomEvent(event, { bubbles: true, detail: { value: detail }, composed: true, ...options });
                this.dispatchEvent(event);
            }
        },
        async: {
            configurable: false,
            enumerable: true,
            writable: false,
            value: function (handler, delay = 0) {
                if (typeof handler === 'string')
                    handler = this[handler].bind(this);
                const fn = (delay ? setTimeout : requestAnimationFrame || queueMicrotask);
                fn(handler, delay);
            }
        },
        throttle: {
            configurable: false,
            enumerable: true,
            writable: false,
            value: function (key, handler, delay = 0) {
                key += '.' + delay;
                this.__throttles__ ??= {};
                if (!this.__throttles__[key]) {
                    this.__throttles__[key] = handler;
                    const fn = (delay ? setTimeout : queueMicrotask);
                    const _key = key;
                    const self = this;
                    fn(async () => {
                        try {
                            await self.__throttles__[_key]?.();
                        } catch (e) {
                            console.warn('Throttle handler error:', e);
                        } finally {
                            self.__throttles__[_key] = undefined;
                        }
                    }, delay);
                } else {
                    this.__throttles__[key] = handler;
                }
            }
        },
        debounce: {
            configurable: false,
            enumerable: true,
            writable: false,
            value: function (key, handler, delay = 0) {
                this.__debounces__ ??= {};
                if (typeof handler === 'string')
                    handler = this[handler].bind(this);
                key += '.' + delay;
                let db = this.__debounces__[key];
                if (db) {
                    const clr = /* cancelAnimationFrame ||  */clearTimeout;
                    clr(db);
                }
                const fn = /* requestAnimationFrame ||  */setTimeout;
                const t = fn(() => {
                    delete this.__debounces__[key]
                    handler();
                }, delay);
                this.__debounces__[key] = t
            }
        },
        init_reactive_services: {
            configurable: false,
            enumerable: false,
            writable: false,
            value: function init_reactive_services(replacement = {}) {
                if (this.$listeners) {
                    let props = Object.getOwnPropertyDescriptors(this.$listeners);
                    for (let p in props) {
                        let prop = props[p];
                        if (typeof prop.value === 'string') {
                            prop.value = this[prop.value];
                        }
                        p = replacement[p] || p
                        if (typeof p === 'string')
                            this.addEventListener(p, prop.value.bind(this));
                        else if (typeof p === 'function')
                            p(this, prop.value.bind(this));
                    }
                }
                if (this.$observers) {
                    for (let name in this.$observers) {
                        this[`__observer__` + name];
                    }
                }
            }
        },
        [R]: {
            configurable: true,
            enumerable: false,
            get() {
                return this['#R'] ??= (() => {
                    if (this === this.constructor.prototype)
                        return null;
                    return Reactor.createReactiveContext(this, this.constructor?.[R]?.props || {});
                })()
            },
            set(n) {
                this['#R'] ??= n;
            }
        }
    })
}

// ===== Класс Reactor =====
export class Reactor extends EventTarget {
    constructor() {
        super();
        this.init_reactive_services();
    }

    toJSON() {
        const publics = this[R].publics;
        return publics.reduce((res, prop) => {
            res[prop] = this[prop];
            return res;
        }, {});
    }

    toString() {
        return JSON.stringify(this);
    }

    set DATA(data) {
        if (!data) return;
        let props = Reactor.proto2props(data);
        this[R].props = Reactor.join_props(this[R].props, props);
        Object.defineProperties(this, props);
        data = Object.getOwnPropertyDescriptors(data);
        delete data[R];
        this[R].__data__ ??= {};
        Object.defineProperties(this[R].__data__, data);
        this.data = undefined;
    }

    get DATA() {
        return this[R].__data__ ??= {};
    }

    static createReactiveContext(target, props = {}) {
        const context = {
            active: true,
            target: target,
            hosts: [],
            cache: {},
            states: {},
            deps: {},
            props: props,
            get publics() {
                return Object.values(this.props).filter(p => p?.$public).map(p => p.name);
            }
        };

        if (target.constructor.ignore_activation) {
            context.proxy = target;
        } else {
            context.proxy = new Proxy(target, {
                get(target, key) {
                    if (key === '__proto__' || key in Promise.prototype || key === 'constructor' || key.constructor === Symbol)
                        return target[key];
                    if (key in target) {
                        return Reactor.get(target, key);
                    }
                    else if (target._onEmpty) {
                        Reactor.collect_deps(target, key, target[R]);
                        return target._onEmpty(key);
                    }
                },
                set(target, key, value) {
                    return Reactor.set(target, key, value);
                }
            });
        }

        return context;
    }

    static activate(target, host) {
        if (target?.[R]?.active) {
            if (host)
                target[R].hosts.add(host);
            return target[R].proxy;
        }

        if (!Object.isExtensible(target) || target instanceof Promise)
            return target;

        if (target.constructor !== Object && target.constructor !== Array && !(target instanceof Reactor))
            return target;

        if (target.constructor.ignore_activation)
            return target;

        let props = {}
        if (target.constructor !== Array) {
            props = Reactor.proto2props(target);
            props = Reactor.join_props(target.constructor?.[R]?.props || {}, props);
        }

        const context = Reactor.createReactiveContext(target, props);
        Object.defineProperty(target, R, {
            enumerable: false,
            configurable: false,
            writable: false,
            value: context
        });

        if (host) {
            context.hosts.push(host);
        }

        return context.proxy;
    }

    static collect_deps(target, key, actor) {
        if (!Reactor._collectorTarget)
            return;
        if (Reactor._collectorTarget === target && Reactor._collectorKey === key)
            return;
        const deps = actor.deps;
        let keys = deps[key] ??= new Map();
        let values = keys.get(Reactor._collectorTarget);
        if (!values) {
            values = new Set();
            deps[key].set(Reactor._collectorTarget, values);
        }
        values.add(Reactor._collectorKey);
    }

    static reset_deps = function (target, key = '', keep_notify = false) {
        const actor = target[R];
        if (!actor) return;
        
        if (key) {
            let deps = actor.deps[key];
            if (deps) {
                for (let dep of deps) {
                    let host = dep[0];
                    for (let k of dep[1]) {
                        if (host[R].cache[k] === undefined)
                            continue;
                        host[R].cache[k] = undefined;
                        this.reset_deps(host, k);
                    }
                }
            }
        }
        else {
            let deps = actor.deps
            if (deps) {
                for (let key in deps) {
                    this.reset_deps(target, key);
                }
            }
            return;
        }

        target?.notify?.()
        let hosts = actor.hosts;
        if (!hosts) return;
        for (let h of hosts)
            h.notify?.()
    }

    static get [R]() {
        return this['#' + this.name] ??= (() => {
            let parent = Object.getPrototypeOf(this)[R] || { props: {} }
            let props = Reactor.proto2props(this.prototype);
            props = Reactor.join_props(parent.props, props);
            Object.defineProperties(this.prototype, props);
            return {
                target: this,
                props
            }
        })()
    }

    static get(target, key) {
        const actor = target[R];
        if (!actor) {
            let value = target[key];
            if (typeof value === 'function')
                return value.bind(target);
            return value;
        }
        Reactor.collect_deps(target, key, actor);
        let value = actor.cache[key];
        if (value === undefined) {
            const prop = actor.props[key];
            if (!prop?.get) {
                let value = target[key];
                if (typeof value === 'function')
                    return value.bind(target);
                return value;
            }
            if (prop?.$save) {
                value = target.loadFromLocalStorage?.(key);
            }
            if (value === undefined && prop.get.getter) {
                const beforeTarget = Reactor._collectorTarget;
                const beforeKey = Reactor._collectorKey;
                Reactor._collectorTarget = target;
                Reactor._collectorKey = key;
                value = prop.get.getter.call(target);
                Reactor._collectorTarget = beforeTarget;
                Reactor._collectorKey = beforeKey;
            }
            if (value === undefined && '$def' in prop) {
                value = prop.$def();
            }
            if (value !== undefined) {
                if (value?.then) {
                    // value.then(res=>{
                    //     target[key] = res;
                    // }).catch(err=>{
                    //     target[key] = undefined;
                    // })
                }
                else
                    value = getTypeConverter(prop?.$type)(value);
                value = actor.cache[key] = Reactor.activate(value, target);
                Reactor.reset_deps(target, key);
                target.notify?.(prop, value);
            }

        }
        return value;
    }

    static set(target, key, value) {
        const actor = target[R];
        const old = actor.cache[key];
        if (!Reactor.equal(old, value)) {
            const prop = actor.props[key];
            if (value !== undefined) {
                value = getTypeConverter(prop?.$type)(value);
            }
            value = Reactor.activate(value, target);
            value = actor.cache[key] = value;
            if (prop?.set?.setter)
                prop?.set?.setter?.call(target, value, old);
            else
                Reflect.set(target, key, value)
            Reactor.reset_deps(target, key);
            target.notify?.(prop, value);
        }
        return true;
    }

    static proto2props(proto = {}, extention = '') {
        const descrs = Object.getOwnPropertyDescriptors(proto);
        let prop, extentions, props = {};
        for (let key in descrs) {
            if (RESERVED_WORDS.includes(key)) {
                props[key] = descrs[key];
                continue;
            }
            if (key.constructor === Symbol)
                continue;

            prop = Object.assign({}, descrs[key]);
            prop.$freeze = true;
            if (!prop.configurable)
                continue;

            if (key[0] === '@' || key === '$public') {
                prop = proto[key];
                extentions = this.proto2props(prop, extention + '/' + key);
                props = Reactor.join_props(props, extentions);
                delete descrs[key];
                continue;
            }
            prop.name = key;
            prop.attr_name = key.toKebabCase();
            if (extention) {
                for (let ext of extention.split('/')) {
                    if (!ext.trim()) continue;
                    if (ext[0] === '@')
                        if (!prop.$cat)
                            prop.$cat = ext.slice(1);
                        else
                            prop.$cat += '/' + ext.slice(1);
                    else
                        prop[ext] = true;
                }

            }

            if ('value' in prop) {
                const value = prop.value;
                if (value?.constructor === Object && !value.$freeze && Object.keys(value).some(a => PROPERTY_ATTRIBUTES.includes(a))) {
                    Object.assign(prop, value);
                    if (prop.$def !== undefined) {
                        prop.$type = prop.$def?.constructor;
                        let val = prop.$def;
                        prop.$def = function () {
                            return val;
                        }
                    }

                }
                else if (typeof value === 'function') {
                    props[key] = prop;
                    prop.$type = value?.constructor
                    switch (value) {
                        case Object:
                        case Array:
                        case String:
                        case Boolean:
                        case Number:
                        case Date: {

                        } break;
                        default: {
                            continue;
                        }
                    }
                }
                else if (Array.isArray(value)) {
                    prop.$type = Array;
                    prop.$def = function () {
                        return [...value]
                    }
                }
                else if (typeof value === 'object') {
                    prop.$type = Object;
                    if (value) {
                        prop.$def = function () {
                            return Object.assign({}, value);
                        }
                    }
                    else {
                        prop.$def = function () {
                            return null;
                        }
                    }
                }
                else {
                    if (value !== undefined) {
                        prop.$type = value.constructor;
                        prop.$def = function () {
                            return value;
                        }
                    }
                }
                delete prop.value;
            }

            let getter = prop.get || prop.getter;
            prop.get = function () { return Reactor.get(this, key) }
            prop.get.getter = getter;

            let setter = prop.set || prop.setter;
            prop.set = function (value) { Reactor.set(this, key, value) }
            prop.set.setter = setter;

            prop.enumerable = true;
            prop.configurable = true;
            delete prop.writable;

            props[key] = Object.assign(props[key] || {}, prop);
        }
        return props;
    }
}

// ===== Статические методы и утилиты =====
Object.equal = Reactor.equal = function (a, b, recurse = 1) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    
    if (a[R]) {
        if (a[R]?.target === b[R]?.target)
            return true;
    }
    if (a instanceof Function && a.constructor === b.constructor)
        return a.toString() === b.toString();
    if (a instanceof Date && a.constructor === b.constructor)
        return a.valueOf() === b.valueOf();
    if (recurse > 0) {
        const keys = Object.keys(a);
        keys.add(...Object.keys(b));
        for (let key of keys)
            if (!Reactor.equal(b[key], a[key], recurse - 1))
                return false;
        return true;
    }
    return false;
}

Reactor.join_props = function (parent, child) {
    const result = {};
    const keys = new Set([...Object.keys(parent), ...Object.keys(child)]);
    
    for (let key of keys) {
        const p = parent[key] || {};
        const c = child[key] || {};
        const res = Object.assign({}, p, c);
        
        if (res.get) {
            res.get.getter = c?.get?.getter || p?.get?.getter;
        }
        if (res.set) {
            res.set.setter = c?.set?.setter || p?.set?.setter;
        }
        if (res.value && typeof res.value === 'object') {
            Object.assign(res.value, p.value);
        }
        result[key] = res;
    }
    return result;
}

// ===== Глобальные объекты =====
globalThis.getTypeConverter = getTypeConverter;

globalThis.AsyncPromise = class AsyncPromise {
    constructor(handler) {
        return new Promise((resolve, reject) => {
            queueMicrotask(async () => {
                try {
                    resolve(await handler());
                }
                catch (e) {
                    console.warn(e)
                    reject(e);
                }
            })
        })
    }
}

// ===== Расширение Array =====
Array: {
    const push = Array.prototype.push;
    Array.prototype.push = function (...item) {
        const res = push.call(this, ...item);
        Reactor.reset_deps(this);
        return res;
    }
    const unshift = Array.prototype.unshift;
    Array.prototype.unshift = function (...item) {
        const res = unshift.call(this, ...item);
        Reactor.reset_deps(this);
        return res;
    }
    const splice = Array.prototype.splice;
    Array.prototype.splice = function (...item) {
        const res = splice.call(this, ...item);
        Reactor.reset_deps(this);
        return res;
    }

    Object.defineProperty(Array.prototype, 'has', {
        enumerable: false, configurable: true, value(...val) {
            return val.some(i => this.includes(i));
        }
    });
    Object.defineProperty(Array.prototype, 'clear', {
        enumerable: false, configurable: true, value: function () {
            this.splice(0);
        }
    });
    Object.defineProperty(Array.prototype, 'last', {
        enumerable: false, configurable: true, get() {
            return this[this.length - 1];
        }
    });
    Object.defineProperty(Array.prototype, 'first', {
        enumerable: false, configurable: true, get() {
            return this[0];
        }
    });
    Object.defineProperty(Array.prototype, 'add', {
        enumerable: false, configurable: true, value: function (...item) {
            let index = -1;
            for (let i of item) {
                index = this.findIndex(f => Reactor.equal(f, i));
                if (index > -1) continue;
                index = this.push(i);
                index--;
            }
            return index;
        }
    });
    Object.defineProperty(Array.prototype, 'remove', {
        enumerable: false, configurable: true, value: function (...items) {
            for (const item of items) {
                let idx = this.indexOf(item);
                if (~idx)
                    this.splice(idx, 1);
            }
        }
    });
    Object.defineProperty(Array.prototype, 'swap', {
        enumerable: false, configurable: true,
        value: function (i1, i2) {
            return [this[i1], this[i2]] = [this[i2], this[i1]];
        }
    });
    Object.defineProperty(Array.prototype, 'sum', {
        enumerable: false, configurable: true,
        value: function () {
            return this.reduce((r, v) => r + (v || 0), 0);
        }
    });
    Object.defineProperty(Array.prototype, 'mul', {
        enumerable: false, configurable: true,
        value: function () {
            return !this.length ? 0 : this.reduce((r, v) => r * (v || 0), 1);
        }
    });
    Object.defineProperty(Array.prototype, 'avg', {
        enumerable: false, configurable: true,
        value: function () {
            return this.reduce((r, v) => r + (v || 0), 0) / (this.length || 1);
        }
    });
    Object.defineProperty(Array.prototype, 'rms', {
        enumerable: false, configurable: true,
        value: function () {
            return this.reduce((r, v) => r + (v || 0) ** 2, 0) / (this.length || 1);
        }
    });
    Object.defineProperty(Array.prototype, 'mean', {
        enumerable: false, configurable: true,
        value: function () {
            return this.reduce((r, v) => r + (v || 0), 0) / (this.length || 1);
        }
    });
    Object.defineProperty(Array.prototype, 'unique', {
        enumerable: false, configurable: true,
        value: function () {
            return this.filter((v, i, items) => items.indexOf(v) === i);
        }
    });
    Object.defineProperty(Array.prototype, 'uniqueObject', {
        enumerable: false, configurable: true,
        value: function () {
            return this.filter((v, i, items) => items.indexOf(v) === i || typeof v !== 'object');
        }
    });
}

globalThis.Reactor = Reactor;