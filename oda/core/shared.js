/**
 * ODA core/shared — чистые хелперы без зависимости от globalThis.ODA.
 * Вынесено из oda/oda.js byte-for-byte, поведение то же.
 * Совместимость: имена и семантика сохранены, только место жизни сменилось.
 */

export const domParser = new DOMParser();

export function componentCounter() {
    return componentCounter.counter++;
}
componentCounter.counter = 0;
componentCounter.counter = 0;

export function setAttribute(name, value) {
    if (typeof value !== 'object') {
        try {
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

export function removeElement() {
    for (let el of Object.values(this[R].cache.replacer || {})) {
        el.remove();
    }
    this.remove();
}

export function styleToObject(style = '') {
    if (typeof style !== 'string')
        return style;
    style = style.split(';');
    style = style.reduce((resolve, val) => {
        val = val.split(':');
        if (val.length === 2) {
            let name = val.shift().trim().toKebabCase();
            val = val.shift().trim();
            resolve[name] = val;
        }
        return resolve;
    }, {});
    return style;
}

export function objectToStyle(obj = {}) {
    let style = [];
    for (let key in obj) {
        let val = obj[key];
        if (typeof val === 'object') continue;
        style.push(key.toKebabCase() + ': ' + val);
    }
    return style.join('; ');
}

export const AsyncFunction = (async function () { }).constructor;

export function waitForCustomElement(tagName, timeout = 30000) {
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

export async function loadJSON(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`loadJSON failed (${response.status}): ${url}`);
    const text = await response.text();
    if (!text.trim())
        return null;
    return JSON.parse(text);
}
