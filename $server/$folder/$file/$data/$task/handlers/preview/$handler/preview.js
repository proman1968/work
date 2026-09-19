import '/$server/$folder/$file/$data/$task/handlers/pages/form/file/$handler/ui/views.js';

export default {
    template: /*html*/ `
        <style>
            :host {
                @apply --vertical;
            }
        </style>
        <div flex ~if="block" ~is="tag" :data="block" only-doc></div>
    `,
    $item: {
        async set(n) {
            if(n){
                // let views = await n.handlers;//get_item('~/handlers/pages/form/file/$handler/ui/views.js');
                n?.listen('changed', () => { this.task = undefined; });
            }
           
        },
    },
    get tag() {
        return Promise.resolve(this.block).then(block => {
            if (!block?.type)
                return 'microchat-view';
            const name = 'microchat-view-' + block.type;
            return (customElements.get(name) || ODA.telemetry?.[name]) ? name : 'microchat-view';
        });
    },    
    get block() {
        return Promise.resolve(this.task).then(task => {
            if (!task)
                return null;
            let doc = null, tape = null;
            const walk = list => {
                for (const b of list || []) {
                    if (!b || b.hidden)
                        continue;
                    walk(b.items);
                    if (b.doc && b.content && !b.error)
                        doc = b;
                    else if (!b.error && String(b.content || '').trim())
                        tape = b;
                }
            };
            walk(task.items);
            return doc || tape || (task.content ? task : null);
        });
    },
    get task() {
        // if(this._task)
            // return this._task;
        if(this.$item)
            return this._task = this.$item.load();
    },
};
