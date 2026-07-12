if(!Object.prototype.normalize_props){

    Object:{
        Object.reserved_words = ['is', 'extends', 'imports', 'template', 'constructor', '$public', '$listeners', '$observers', '$keys', '$attributes'];
        Object.ptop_attributes = ['$public', '$category', '$def', '$default', '$type', '$attr', '$attribute', '$save', '$list', '$values', 'get', 'set'];
        Object.defineProperty(Object.prototype, 'normalize_props', {
            enumerable: false,
            configurable: true,
            value(category, modifier){    
                const descrs = Object.getOwnPropertyDescriptors(this);
                let result = {};
                for(let key in descrs){                  
                    let old = descrs[key];
                    if(!old.configurable)
                        continue;
                    if(Object.reserved_words.includes(key)){
                        result[key] = old;
                        continue;
                    }
                    else if(typeof old.value === 'function'){
                        switch(old.value){
                            case Object:
                            case Array:  
                            case String:   
                            case Boolean:   
                            case Number:  
                            case Date:  {
                                old = {value: {$type: old.value}}
                            } break;
                            default:{
                                result[key] = old;
                                continue;
                            }
                        }
                    }
                    if(key[0] === '@'){
                        let cat = (category?category + '/':'') + key.slice(1)
                        let p = old.value.normalize_props(cat, modifier)
                        old = Object.getOwnPropertyDescriptors(p);
                        Object.assign(result, old);
                        delete this[key];
                        continue;
                    }
                    if(old.get || old.set){
                        let prop = {value: {}}
                        old.value = {};  
                        if(old.get) {
                            let get = old.get;
                            prop.value.get = get
                        }
                        if(old.set) {
                            let set = old.set;
                            prop.value.set = set;
                        } 
                        old = prop;
                    }
                    else if(old.value && old.value.constructor === Object && Object.ptop_attributes.has(...Object.keys(old.value))){
                        if(!old.value.$type && old.value.$def !== undefined){
                            old.value.$type = old.value.$def?.constructor;
                        }
                    }
                    else if(old.value !== undefined) {
                        let $def = old.value;
                        let $type = $def?.constructor;
                        
                        switch ($type) {
                            case Object: {
                                old.value = {$type, get $def() { return Object.assign({}, $def)}};
                            } break;
                            case Array: {
                                old.value = {$type, get $def() { return Array.from($def)}};
                            } break;
                            default:{
                                old.value = {$type, $def};
                            }
                        }    
                    }
                    else
                        old.value = {}
                    if(category)
                        old.value.$category = category;
                    if(modifier){
                        old.value[modifier] = true;
                        old.value.$attr = true;
                    }
                        
                    result[key] = old;
                }
                for(let key of Object.reserved_words){
                    let prop = descrs[key];
                    if(prop?.value?.constructor !== Object){
                        if(prop?.get){
                            prop.value = prop.get();
                            delete prop.get;
                            delete prop.set;
                        }
                            
                        if(prop?.value?.constructor !== Object)
                            continue;
                    }    
                    prop = Object.getOwnPropertyDescriptors(prop.value.normalize_props(category, key));
                    result = [result, prop].reduce((res, props)=>{
                        for(let name in props){
                            let prop = props[name];
                            res[name] = Object.assign(res[name] || {}, prop);
                        }
                        return res;
                    }, {});
                    // Object.assign(result, prop);
                    // if(key === '$observers'){
    
                        
                    // }
                }
                Object.defineProperties(result, result);
                return result;
            }
        })
        function observers_updates(){
            let observers = Object.getOwnPropertyDescriptor(this.prototype, '$observers');
            if (!observers) return;
            observers = observers.value ?? observers?.get();
            if (!observers) return;
            let props = {};
            for (let name in observers){
                let func = observers[name]
                let expr;
                let args;
                if (Array.isArray(func) || typeof func === 'string') {
                    args = str2arr(func);
                    let prop = Object.getOwnPropertyDescriptor(this.prototype, name);
                    if (!prop?.value)
                        throw new Error(`Function ${name} not found`);
                    func = prop.value;
                }
                if (!args) {
                    expr = func.toString();
                    expr = expr.replace(/(\/\*[\w\s\r\n\*]*\*\/)|(\/\/.*(?=[\r\n]))/mg, ''); //remove comments
                    const argsStart = expr.indexOf('(') + 1;
                    const argsEnd = expr.indexOf(')', argsStart);
                    args = str2arr(expr.slice(argsStart, argsEnd));
                }
                const prop_name = `__observer__${name}`;
                props[prop_name] = {
                    isObserver: true,
                    configurable: true,
                    get() {
                        const props = args.map(a => this[a]);
                        if (props.every(p => p !== undefined)) {
                            this.debounce(prop_name, () => {
                                this[name](...props);
                            })
                        }
                        return true;
                    }
                }
                if (func)
                    Object.defineProperty(this.prototype, name, {
                        value: func
                    })
        
            }
            /* props =  */convert_prototype.call(this.prototype, props);
            // Object.defineProperties(this.prototype, props);
        }
    
        Object.defineProperty(Object, 'mix_props', {
            configurable: true,
            value(...exts){
                return exts.reduce((res, ext)=>{
                    let descrs = Object.getOwnPropertyDescriptors(ext);
                    for(let p in descrs){
                        if(p === '$public')
                            continue;
                        let prop = Object.assign({}, descrs[p]);
                        if(typeof prop.value === 'object'){
                            if(p in res){
                                let old = Object.getOwnPropertyDescriptor(res, p);
                                prop.value = Object.assign({}, old.value, prop.value);
                            }   
                        }   
                        Object.defineProperty(res, p, prop);    
                    }
                    return res
                }, {});
            }
        })
    }
    Array:{
        Object.defineProperty(Array.prototype, 'has', {
            enumerable: false, configurable: true, value(...val){
                return val.some(i=>this.includes(i));
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
                    index = this.findIndex(f=>Object.equal(f, i));
                    if (index>-1) continue;
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
                return this.reduce((r,v)=>r + (v || 0), 0);
            }
        });
        Object.defineProperty(Array.prototype, 'mul', {
            enumerable: false, configurable: true,
            value: function () {
                return !this.length?0:this.reduce((r,v)=>r * (v || 0), 1);
            }
        });
        Object.defineProperty(Array.prototype, 'avg', {
            enumerable: false, configurable: true,
            value: function () {
                return this.reduce((r,v)=>r + (v || 0), 0)/(this.length || 1);
            }
        });
        Object.defineProperty(Array.prototype, 'mean', {
            enumerable: false, configurable: true,
            value: function () {
                return this.reduce((r,v)=>r + (v || 0), 0)/(this.length || 1);
            }
        });
        Object.defineProperty(Array.prototype, 'unique', {
            enumerable: false, configurable: true,
            value: function () {
                return this.filter((v,i,items) => items.indexOf(v) === i);
            }
        });
        Object.defineProperty(Array.prototype, 'uniqueObject', {
            enumerable: false, configurable: true,
            value: function () {
                return this.filter((v,i,items) => items.indexOf(v) === i || typeof v !== 'object');
            }
        });
        globalThis.AsyncPromise = class AsyncPromise{
            constructor(handler) {
                return new Promise((resolve, reject)=>{
                    queueMicrotask(async ()=>{
                        try{
                            resolve(await handler());
                        }
                        catch (e){
                            console.warn(e)
                            reject(e);
                        }
                    })
                })
            }
        }
    }
    
    String:{
        if (!String.merge) {
            function parseJS(src){
                if (!src) return [];
                let pairs = { '[': ']', '{': '}', '(': ')', '`': '`' };
                let open_chars = Object.keys(pairs);
                let close_chars = Object.values(pairs);
                src = src.split(/\r\n|\r|\n/);
                let tree = [];
                let node = tree;
                for (let row of src) {
                    let s = row.trim();
                    let prev = node[Symbol.for('prev')];
                    let open_char = pairs[prev?.last];
                    if (s.startsWith(open_char) && s.replaceAll?.(' ', '').length > 2) {
                        let str = row.split(open_char)[0];
                        node.push(str + open_char);
                        node[Symbol.for('prev')] = null;
                        node = prev.prev;
                        row = row.replace(open_char, '')
                    }
                    let last = s.slice(-1);
                    if (last === '`' && s.replaceAll?.(' ', '').length <= 2) last = '';
                    node.push(row);
                    if (open_chars.includes(last)) {
                        let prev = node;
                        node = [];
                        node[Symbol.for('prev')] = { prev, last };
                        prev.push(node)
                        continue;
                    }
                    prev = node[Symbol.for('prev')];
                    if (!prev)
                        continue;
                    let first = s.trim()[0];
                    if (close_chars.includes(first)) {
                        if (pairs[prev.last] !== first)
                            continue;
                        node[Symbol.for('prev')] = null;
                        node = prev.prev;
                    }
                }
                return tree;
            }
        
            function joinJsTrees(tree1, tree2, parentBlockKey) {
                let pairs = { '[': ']', '{': '}', '(': ')', '`': '`' };
                const checkComma = (key, item) => {
                    if ((key?.endsWith(':{') || key?.endsWith('[') || key?.endsWith('default{')) && item?.length) {
                        item = item.map((i, idx) => {
                            if (Array.isArray(i)) {
                                let last = i.pop();
                                if (last.replaceAll?.(' ', '').at(-1) !== ',')
                                    last += ',';
                                i.push(last);
                            } else if (i.replaceAll?.(' ', '') && !i?.endsWith('{') && !i?.endsWith('[')) {
                                let char = i.replaceAll?.(' ', '').at(-1);
                                // console.log(idx, pairs[parentBlockKey.at(-1)], str)
                                if (char && !pairs[char] && pairs[parentBlockKey.at(-1)] !== char && char !== ',' && char !== '`')
                                    i += ',';
                            }
                            return i;
                        })
                    }
                    return item;
                }
                let res = [];
                let item1, idx2;
                while ((item1 = tree1.shift()) !== undefined) {
                    if (typeof item1 === 'string') {
                        res.push(item1);
                        let key = item1.split(/\r\n|\r|\n/).join('').replaceAll?.(' ', '');
                        let last = key.at(-1);
                        if (pairs[last] && parentBlockKey?.at(-1) !== pairs[last])
                            parentBlockKey = key;
                        idx2 = tree2.findIndex(v2 => v2.replaceAll?.(' ', '') === key);
                        if (idx2 === -1) {
                            if (key.startsWith('return') && Array.isArray(tree2)) {
                                let isOk;
                                for (let i = 0; i < tree2.length; i++) {
                                    const row = tree2[i];
                                    if (row.replaceAll?.(' ', '').startsWith('return')) {
                                        res[res.length - 1] = row;
                                        tree2.splice(i, 1);
                                        isOk = true;
                                        break;
                                    } 
                                }
                                if (isOk)
                                    continue;
                            }
                            const ss = [':', '=', '(', '`', '[', '{', '>'];
                            let s, _key;
                            while ((s = ss.shift()) !== undefined) {
                                _key = key.split(s);
                                if (_key.length < 2)
                                    continue;
                                break;
                            }
                            if (!s || _key.length < 2)
                                continue;
                            key = _key[0];
                            idx2 = tree2.findIndex(v2 => v2.replaceAll?.(' ', '')?.split(s)?.[0] === key);
                            if (idx2 === -1)
                                continue;
                            let newValue = tree2[idx2];
                            res[res.length - 1] = newValue;
                        }
                        tree2.splice(idx2, 1);
                    }
                    else if (Array.isArray(item1)) {
                        let item2 = tree2[idx2];
                        if (Array.isArray(item2)) {
                            tree2.splice(idx2, 1);
                            item1 = checkComma(parentBlockKey, item1);
                            item2 = checkComma(parentBlockKey, item2);
                            item1 = joinJsTrees(item1, item2, parentBlockKey);
                        }
                        const returnIndex = item1.findIndex(str => str.includes('return'));
                        if (returnIndex >= 0 && returnIndex < item1.length - 2) {
                            if (!item1[returnIndex].trim().endsWith('{')) {
                                const result = item1.filter((str, index) => index !== returnIndex);
                                result.splice(-1, 0, item1[returnIndex]);
                                item1 = result;
                            }
                        }
                        res.push(item1);
                        let last = item1?.at?.(-1);
                        if (Object.values(pairs).includes(last))
                            parentBlockKey = null;
                    }
                }
                if (tree2.length) {
                    if (parentBlockKey) {
                        let end = res.pop();
                        res.push(...tree2, end);
                    }
                    else {
                        res.push(...tree2);
                    }
                }
                return res;
            }
     
            function mergeJSCode(source, target) {

                // let s = source.split('\n')
                //     .map(line => line.replace(/\s+/g, ' ').trim())
                //     .filter(line => line.length > 0)
                //     .join('\n');
                // let t = target.split('\n')
                //     .map(line => line.replace(/\s+/g, ' ').trim())
                //     .filter(line => line.length > 0)
                //     .join('\n');
                // if (s === t || s.startsWith(t)) return source;
                // if (t.startsWith(s)) return target;

                let src_tree = parseJS(source);
                let tar_tree = parseJS(target);
                let result_tree = joinJsTrees(src_tree, tar_tree).flat(Infinity).join('\n');

                return result_tree;
            }
            Object.defineProperty(String.prototype, 'merge', {
                enumerable: false, 
                value: function (text) {
                    return mergeJSCode(this, text);
                }
            });
        }
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
        if (!String.prototype.hashCode) {
            const cyrb53 = (str, seed = 0) => {
                let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
                for(let i = 0, ch; i < str.length; i++) {
                    ch = str.charCodeAt(i);
                    h1 = Math.imul(h1 ^ ch, 2654435761);
                    h2 = Math.imul(h2 ^ ch, 1597334677);
                }
                h1  = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
                h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
                h2  = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
                h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    
                return 4294967296 * (2097151 & h2) + (h1 >>> 0);
            };
            String.prototype.hashCode = function (seed) {
                return cyrb53(this, seed);
            }
        }
    }
    
    function toDate(v){return new Date(v)}
    function toString(v){return v?.toString() || ''}
    function toNumber(v){return (v !== undefined)?Number(v):undefined}
    function toBigInt(v) {
        if( typeof v === 'bigint' )
            return v;
        if( typeof v === 'string' ) {
            const val = /^[\-\+]?[0-9]+/.exec(v);
            return val===null ? undefined : BigInt(val[0]);
        }
        const val = Math.round( Number(v) );
        return isFinite(val) ? BigInt(val): undefined;
    }
    const toBool = globalThis.toBool = (v, def = false) => {
        if (v === undefined || v === null)
            return def;
        switch (typeof v) {
            case 'object': return true;
            case 'string': return v.toLowerCase() === 'true';
            case 'boolean': return v;
            case 'number': return v !== 0;
            case 'bigint': return v !== 0n;
        }
        return false;
    }
    
    globalThis.getTypeConverter = function getTypeConverter(type){
        switch (type) {
            case Boolean: return toBool;
            case Number: return toNumber;
            case String: return toString;
            case Date: return toDate;
            case BigInt: return toBigInt;
        }
        return (val)=>{
            return val;
        }
    }
    
    globalThis.str2arr = function str2arr(str) {
        if (typeof str === 'string') {
            str = str.split(',').map(s => s.trim());
        }
        if (Array.isArray(str)) {
            str = str.filter(Boolean);
        }
        if (!str) {
            str = [];
        }
        return str;
    }
}