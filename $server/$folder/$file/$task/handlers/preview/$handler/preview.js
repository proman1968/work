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

export default {
    template: /*html*/ `
        <style>
            :host {
                @apply --vertical;
            }
        </style>
        <div flex ~if="block" ~is="tag" :data="block" only-doc></div>
    `,
    get data() {
        return this.$item?.load().then(res => {
            return typeof res === 'string' ? JSON.parse(res) : res;
        }).catch(() => null);
    },
    get block() {
        return Promise.resolve(this.data).then(b => {
            if (!b) return null;
            return lastDoc(b.items) || lastTape(b.items) || (b.content ? b : null);
        });
    },
    get tag() {
        return Promise.resolve(this.block).then(b => b ? viewTag(b) : '');
    },
}
