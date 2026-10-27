/**
 * Статические методы сериализации, сравнения (diff) и разделения self/inherit для class.js.
 */

export const classScriptStatics = {
    validateVarName(name) {
        const commonReservedWords = ['break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new', 'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'class', 'const', 'export', 'extends', 'import', 'super', 'implements', 'interface', 'let', 'package', 'private', 'protected', 'public', 'static', 'yield', 'null', 'true', 'false', 'NaN', 'Infinity', 'undefined'];
        if (commonReservedWords.includes(name))
            return false;

        const allowedCharacters = new RegExp('^[\\p{L}_$][\\p{L}\\p{N}_$]*$', 'u');
        return allowedCharacters.test(name);
    },

    _scriptSwitchValue(value, deep = 0, key) {
        switch (value?.constructor?.name) {
            case 'AsyncFunction':
            case 'Function': {
                const space = '    ';
                const tab = space.repeat(deep);
                value = value.toString().replaceAll('\n  ', '\n')
                    .replaceAll('\n', '\n' + tab);
                return value;
            }
            case 'Object': {
                value = this.toScript(value, deep + 1);
            } break;
            case 'String': {
                if (key === 'template')
                    value = '`' + String(value).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
                else
                    value = JSON.stringify(value);
            } break;
            case 'Array': {
                value = '[' + value.map(val => this._scriptSwitchValue(val, deep)) + ']';
            } break;
        }
        if (key) {
            if (!this.validateVarName(key))
                key = JSON.stringify(key);
            value = key + ': ' + value;
        }
        return value;
    },

    toScript(json, deep = 1) {
        const props = Object.getOwnPropertyDescriptors(json);
        const script = [];
        const space = '    ';
        const tab = space.repeat(deep);
        const tab_1 = space.repeat(deep - 1);
        for (let key in props) {
            const prop = props[key];
            if (prop.get || prop.set) {
                if (prop.get) {
                    const get = prop.get.toString().replaceAll('\n  ', '\n')
                        .replaceAll('  ', space)
                        .replaceAll('\n', '\n' + tab);
                    script.push(tab + get);
                }
                if (prop.set) {
                    const set = prop.set.toString().replaceAll('\n  ', '\n')
                        .replaceAll('  ', space)
                        .replaceAll('\n', '\n' + tab);
                    script.push(tab + set);
                }
            }
            else {
                const useProxy = 'value' in prop && typeof prop.value !== 'function';
                const val = this._scriptSwitchValue(useProxy ? json[key] : prop.value, deep, key);
                script.push(tab + val);
            }
        }
        return '{\n' + script.join(',\n') + '\n' + tab_1 + '}';
    },

    _isNonemptyDiff(val) {
        if (val == null)
            return false;
        if (Array.isArray(val))
            return val.length > 0;
        if (typeof val === 'object')
            return Object.keys(val).length > 0;
        return true;
    },

    _differenceSwitchValue(myval, oldval) {
        switch (myval?.constructor.name) {
            case 'Object': {
                const newval = this.getDifference(myval, oldval);
                if (newval && (Object.keys(newval).length > 0) && myval.id)
                    newval.id = myval.id;
                return newval;
            }
            case 'Array': {
                if (!Array.isArray(oldval))
                    return myval;
                const newVals = [];
                if (myval[0]?.id || myval[0]?.id === 0) {
                    myval.forEach(my => {
                        const old = oldval.find(e => e.id === my.id);
                        if (!old) {
                            newVals.push(my);
                        }
                        else {
                            const part = this._differenceSwitchValue(my, old);
                            if (this._isNonemptyDiff(part))
                                newVals.push(part);
                        }
                    });
                }
                else {
                    myval.forEach((my, i) => {
                        if (i > oldval.length) {
                            newVals.push(my);
                        }
                        else {
                            const old = oldval[i];
                            const part = this._differenceSwitchValue(my, old);
                            if (this._isNonemptyDiff(part))
                                newVals.push(part);
                        }
                    });
                }
                return newVals;
            }
            default:
                return myval;
        }
    },

    pruneFields(list, base = []) {
        if (!Array.isArray(list))
            return list;
        const byId = new Map((Array.isArray(base) ? base : [])
            .filter(f => f?.id != null).map(f => [f.id, f]));
        const out = [];
        for (const field of list) {
            if (!field || typeof field !== 'object' || field.id == null) {
                out.push(field);
                continue;
            }
            const ancestor = byId.get(field.id);
            const { fields, ...own } = field;
            const { fields: ancestorFields, ...ancestorOwn } = ancestor || {};
            const kids = this.pruneFields(fields, ancestorFields);
            const hasKids = Array.isArray(kids) && kids.length > 0;
            const ownChanged = !ancestor || Object.keys(this.getDifference(own, ancestorOwn)).length > 0;
            if (!ownChanged && !hasKids)
                continue;
            out.push(hasKids ? { ...own, fields: kids } : own);
        }
        return out;
    },

    pruneMeta(data, base) {
        const meta = data?.METADATA;
        if (!data || typeof data !== 'object' || Array.isArray(data) || !meta || typeof meta !== 'object')
            return data;
        const baseMeta = base?.METADATA || {};
        const nextMeta = { ...meta };
        for (const key of ['FIELDS', 'STATIC'])
            if (key in nextMeta)
                nextMeta[key] = this.pruneFields(nextMeta[key], baseMeta[key]);
        const out = Object.defineProperties({}, Object.getOwnPropertyDescriptors(data));
        out.METADATA = nextMeta;
        return out;
    },

    getDifference(value, old = {}) {
        if (!old)
            return value;
        const myprops = Object.getOwnPropertyDescriptors(value);
        const oldprops = Object.getOwnPropertyDescriptors(old);
        const result = {};
        for (let key in myprops) {
            const oldprop = oldprops[key];
            const myprop = myprops[key];
            if (!oldprop) {
                Object.defineProperty(result, key, myprop);
            }
            else if ('value' in myprop) {
                if ((myprop.value?.constructor.name === 'Object') || (myprop.value?.constructor.name === 'Array')) {
                    if (this._trimFunc(this.toScript(myprop.value)) !== this._trimFunc(this.toScript(oldprop.value)))
                        result[key] = this._differenceSwitchValue(myprop.value, oldprop.value);
                }
                else if (this._trimFunc(myprop.value?.toString()) !== this._trimFunc(oldprop.value?.toString())) {
                    result[key] = this._differenceSwitchValue(myprop.value, oldprop.value);
                }
            }
            else if (this._trimFunc(myprop.get?.toString()) != this._trimFunc(oldprop?.get?.toString()) || this._trimFunc(myprop.set?.toString()) != this._trimFunc(oldprop?.set?.toString())) {
                Object.defineProperty(result, key, myprop);
            }
        }
        return result;
    },

    _trimFunc(text) {
        return text?.split('\n').map(s => s.trim()).join('\n');
    },

    separateInheritData(data, dflt = false) {
        const nonEmpty = (v) => Array.isArray(v) ? v.length > 0
            : (v && (typeof v !== 'object' || Object.keys(v).length > 0));
        const schemaChild = (key) => dflt === true || (key === 'INDEXES' || key === 'POSTINGS');
        if (Array.isArray(data)) {
            const selfData = [];
            const inheritData = [];
            let hasInherit = false;
            for (const item of data) {
                if (item?.to_inherit === false) {
                    selfData.push(item);
                    continue;
                }
                const [selfItem, inheritItem, itemHasInherit] = this.separateInheritData(item, false);
                if (item?.to_inherit === true || dflt === true) {
                    inheritData.push(item);
                    hasInherit = true;
                }
                else if (itemHasInherit && inheritItem != null) {
                    if (nonEmpty(inheritItem)) {
                        const packed = item?.id != null && typeof inheritItem === 'object' && !Array.isArray(inheritItem)
                            ? Object.assign({ id: item.id }, inheritItem)
                            : inheritItem;
                        inheritData.push(packed);
                        hasInherit = true;
                    }
                }
                if (item?.to_inherit !== true && selfItem != null) {
                    if (nonEmpty(selfItem))
                        selfData.push(selfItem);
                }
            }
            return [selfData, inheritData, hasInherit];
        }
        if (data && typeof data === 'object') {
            const selfData = {};
            const inheritData = {};
            let hasInherit = false;
            for (const key of Object.keys(data)) {
                const desc = Object.getOwnPropertyDescriptor(data, key);
                if (desc.get || desc.set) {
                    Object.defineProperty(selfData, key, desc);
                    continue;
                }
                const value = desc.value;
                if (value?.to_inherit === false) {
                    selfData[key] = value;
                    continue;
                }
                const childDflt = schemaChild(key);
                const [selfValue, inheritValue, valueHasInherit] = this.separateInheritData(value, childDflt);
                if (value?.to_inherit === true || dflt === true) {
                    inheritData[key] = value;
                    hasInherit = true;
                }
                else if (valueHasInherit && inheritValue != null) {
                    if (nonEmpty(inheritValue)) {
                        inheritData[key] = inheritValue;
                        hasInherit = true;
                    }
                }
                if (value?.to_inherit !== true && selfValue != null) {
                    if (nonEmpty(selfValue))
                        selfData[key] = selfValue;
                }
            }
            return [selfData, inheritData, hasInherit];
        }
        return [data, null, false];
    },
};
