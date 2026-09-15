import { viewTag } from '/$server/$folder/$file/$data/$task/handlers/pages/form/file/$handler/ui/views.js';

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
    if (typeof file.load === 'function')
        return file.load().then(readTask);
    if (Array.isArray(file.items))
        return file;
    if (file.body)
        return Promise.resolve(file.body).then(readTask);
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
    /** ~if/~is возвращает тот же узел — снимок _task не перечитывать сам. */
    _reload() {
        this._task = undefined;
        this._block = undefined;
        this._tag = undefined;
        this.render();
    },
    _bindFile(n) {
        this._offFile?.();
        this._offFile = null;
        if (!n?.listen)
            return;
        const onChanged = () => this._reload();
        n.listen('changed', onChanged);
        this._offFile = () => n.unlisten('changed', onChanged);
    },
    $item: {
        $def: null,
        set(n) {
            this._bindFile(n);
            this._reload();
        },
    },
    log: {
        $def: null,
        set() {
            this._task = undefined;
            this._block = undefined;
            this._tag = undefined;
        },
    },
    attached() {
        this._bindFile(this.$item);
        this._reload();
    },
    detached() {
        this._offFile?.();
        this._offFile = null;
    },
    get task() {
        if (this._task !== undefined)
            return this._task;
        const file = this.$item;
        if (file)
            return this._task = (typeof file.then === 'function') ? file.then(fromFile) : fromFile(file);
        if (Array.isArray(this.log?.items))
            return this._task = this.log;
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
