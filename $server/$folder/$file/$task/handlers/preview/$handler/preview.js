import { viewTag } from '/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/views.js';

function lastDoc(items) {
    let found = null;
    const walk = (list) => {
        for (const b of list || []) {
            if (!b || b.hidden) continue;
            walk(b.items);
            if (b.doc && b.content && !b.error)
                found = b;
        }
    };
    walk(items);
    return found;
}

function lastTape(items) {
    let found = null;
    const walk = (list) => {
        for (const b of list || []) {
            if (!b || b.hidden) continue;
            walk(b.items);
            if (b.type === 'thinking' || b.error) continue;
            if (String(b.content || '').trim())
                found = b;
        }
    };
    walk(items);
    return found;
}

function readTask(raw) {
    if (raw == null || raw === '')
        return null;
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s || s === '[object Object]')
            return null;
        return JSON.parse(s);
    }
    return raw;
}

function lastBlock(task) {
    if (!task)
        return null;
    return lastDoc(task.items) || lastTape(task.items) || (task.content ? task : null);
}

function asTag(b) {
    return b ? viewTag(b) : '';
}

function fromFile(file) {
    if (!file)
        return null;
    if (Array.isArray(file.items))
        return file;
    if (file.body)
        return Promise.resolve(file.body).then(readTask);
    if (typeof file.load === 'function')
        return file.load().then(readTask);
    return readTask(file);
}

export default {
    template: /*html*/ `
        <style>
            :host {
                @apply --vertical;
            }
        </style>
        <div flex ~if="block" ~is="tag" :data="block" only-doc></div>
    `,
    log: {
        $def: null,
        set(n) {
            if (!Array.isArray(n?.items))
                return;
            this._task = n;
            this._block = undefined;
            this._tag = undefined;
        },
    },
    get task() {
        if (this._task !== undefined)
            return this._task;
        if (Array.isArray(this.log?.items))
            return this._task = this.log;
        const file = this.$item;
        if (!file)
            return;
        if (typeof file.then === 'function')
            return this._task = file.then(fromFile);
        return this._task = fromFile(file);
    },
    get block() {
        if (this._block !== undefined)
            return this._block;
        const t = this.task;
        if (t === undefined)
            return;
        this._block = (t && typeof t.then === 'function') ? t.then(lastBlock) : lastBlock(t);
        return this._block;
    },
    get tag() {
        if (this._tag !== undefined)
            return this._tag;
        const b = this.block;
        if (b === undefined)
            return '';
        this._tag = (b && typeof b.then === 'function') ? b.then(asTag) : asTag(b);
        return this._tag;
    },
}
