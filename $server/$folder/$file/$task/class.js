export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',
    async prompt(params = {}) {
        
        // debugger;
        let { prompt, role, session } = params;
        session?.send?.({ type: 'chat.start', path: this.short });
        await this._init(params);
    
        try {
            switch (role) {
                case 'AI':{
                } break;
                case 'APPROVE':{
                    params.block.answer = prompt; //todo убрать
                    if (params.accept === true || params.accept === 'true') {
                        await params.pipe_step.approve?.(params);
                        params.block.state = 'принято';                      
                    } else {
                        params.block.state = 'отклонено';
                    }
                    
                    delete params.block.stop;
                    delete params.box.using_blocks;
                    await this._save(session);
                    this._stopped = false;
                } break;
                default:{
                    const text = String(prompt ?? '').trim();
                    if (text) {
                        params.block = {
                            type: 'prompt',
                            content: text,
                        };
                        await this._push_block(params);
                    }
                    if (params.includes) {
                        params.block = this._build_block('includes');
                        params.block.files = JSON.parse(params.includes);
                        await this._push_block(params);
                    }
                    delete params.box.using_blocks;
                    this._stopped = false;
                }
            }

            await this._init(params);
            await this.pipe[params.box.type]?.recalc?.(params);
            let mode = this.body.mode || 'plan';

            let node = this.pipe[params.block.type];
            let next = node?.[mode]?.next || node?.next;
            if(!next || node.box){
                node = this.pipe[params.box.type];
                next = node?.[mode]?.next || node?.next;
            }
                

            let using_blocks = params.box.using_blocks ??= [];
            next = next.filter(id => !using_blocks.includes(id));  

            let choice;
            if (!next.length) {
                choice = 'total';
            }
            else if (next.length === 1) {
                choice = next[0];
            }
            else {
                const lines = next.map(id => id.toUpperCase() + ' - ' + (this.pipe[id]?.[mode]?.inject || this.pipe[id]?.inject) + ';');
                let menu = [
                    'Найди и выбери в menu вариант, наиболее подходящий и логичный для твоего следующего шага или действия.',
                    'Выбирай не по порядку, а по смыслу. Ответь одним словом строго из списка, без знаков и пояснений.',
                    '\n\n[menu]\n',
                    ...lines,
                    'Если ни один вариант не подходит, просто отвечай или уточняй.',
                ].join('\n');
                let messages = await this.context({session, prompt: menu});

                let response = await this._streamChat({ messages, silent: true, session });
                const word = response.content.trim().toLowerCase();
                if (next.includes(word))
                    choice = word;
                else{
                    params.block = this._build_block('answer');
                    params.block.content = word;
                    await this._push_block(params);
                }
            }
            if (choice) {
                let next_pipe = this.pipe[choice];
            
                params.block = this._build_block(choice);
                if (await this._push_block(params)) {
                    if (!params.block.box && !params.block.content) {
                        prompt = next_pipe.prompt || this.pipe[params.box.type].prompt;
                        let messages = await this.context({prompt, session});
                        if(params.block.draft){
                            const draft = params.block.draft;
                            const head = prompt + `\n\n[${params.block.type}: ${params.block.label}]\n`;
                            const content = draft.type === 'image_url'
                                ? [{ type: 'text', text: head }, draft]
                                : head + (draft.type === 'text' ? draft.text : draft);
                            messages = [{ role: 'system', content: this.body.system }, { role: 'user', content }];
                            delete params.block.draft;
                        }
                      
                        let response = await this._streamChat({ messages, session });
                        if (params.block.title)
                            response.content = params.block.title + '\n\n' + response.content;
                        Object.assign(params.block, response);
                    }
                    await this.pipe[params.block.type]?.recalc?.(params);

                    const kind = this.pipe[params.block.type];
                    const src = String(params.block.html || params.block.content || '').trim();
                    if (params.block.stop !== true && !this._stopped && src && kind?.label && params.block.label === kind.label) {
                        const cap = await this._streamChat({
                            messages: [{ role: 'user', content: src + '\n\n[instruction]\n Сделай заголовок для этого блока. 2-3 слова. Без знаков и пояснений.' }],
                            silent: true,
                            session,
                        });
                        const words = String(cap.content || '').trim().replace(/^["«']+|["»'.]+$/g, '').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
                        if (words)
                            params.block.label = words;
                    }
                    
                }
                await this._save(session);
                if (!this._stopped && /* !params.box.content && */ (params.block.box || !params.block.stop)) {
                    this.async(() => this.prompt({ role: 'AI', session }));
                    return { ok: true };
                }
            }

        }
        catch (e) {
            params.block = { type: 'error', content: e.message };
            await this._push_block(params);
        }

        session?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
    },

    async _init(params = {}) {
        params.block = await this._active_block();
        params.box = await this._active_box();
        const pipe = await this.pipe;
        params.pipe_step = pipe[params.block.type] || pipe.thinking;
        params.task = this;
    },
    async context(params = {}) {
        const {prompt} = params;
        const layers = [];
        const body = await this.body;
        let box = body;
        for (;;) {
            layers.push(this._box_context(box));
            const next = box.items?.last;
            if (next?.box && !next.content) box = next;
            else break;
        }
        const focus = box;
        const mode = body.mode || 'plan';
        const modeLine = mode === 'do' ? 'Сейчас ты в режиме исполнения.' : 'Сейчас ты в режиме планирования.';
        const messages = [{ role: 'system', content: [...layers.map(l => l.system).filter(Boolean), timeNow(body.tz), modeLine].filter(Boolean).join('\n\n') }];
        const push = (nextRole, content) => {
            if (!content) return;
            if (messages.last?.role === nextRole) {
                messages.last.content += '\n\n' + content;
                return;
            }
            messages.push({ role: nextRole, content });
        };
        for (const layer of layers)
            for (const m of layer.messages)
                push(m.role, m.content);
        if (focus !== body)
            push('user', stageOpen(focus, this.pipe[focus.type]));
        if (prompt) {
            if (messages.last?.role === 'user')
                messages.last.content += '\n\n[instruction]\n' + prompt;
            else
                messages.push({ role: 'user', content: prompt });
        }
        return messages;
    },
    _box_context(box) {
        const node = this.pipe[box.type];
        const mode = this.body.mode || 'plan';
        let system = node?.[mode]?.system || node?.system || box.system || '';
        if (box.todo)
            system += '\n\n[todo]\n' + (box.todo.content || '');
        const messages = [];
        for (const b of (box.items || [])) {
            if (this.pipe[b.type]?.close || (b.box && !b.content))
                continue;
            messages.push({ role: this.pipe[b.type]?.role || 'assistant', content: b.content });
            if (b.page && !b.content)
                messages.push({ role: 'user', content: b.page });
            if (b.answer != null)
                messages.push({ role: 'user', content: typeof b.answer === 'string' ? b.answer : JSON.stringify(b.answer) });
        }
        return { system, messages };
    },
    async _streamChat(params = {}) {
        const {messages, silent, session} = params;
        const model = await this.model;
        const effort = (await this.body).effort;
        let content = '', usage = 0;
        for await (const chunk of model.streamChat({ messages, effort })) {
            if (this._stopped){
                content = '';
                break;
            }
                
            if (chunk?.type === 'usage')
                usage = chunk;
            else {
                let token = chunk?.content ? chunk?.content : chunk;
                if (typeof token !== 'string')
                    continue;
                content += token;
                if (!silent)
                    session?.send?.({ type: 'chat.delta', path: this.short, token });
            }
        }
        return { content, usage };
    },
    get pipe() {
        return this._pipe ??= new AsyncPromise(async () => {
            const files = await this.tilde;
            const file = files.find(f => f.id === 'pipe.js');
            const raw = await file.load();
            const script = this.constructor.stripAbsoluteImports(raw);
            const b64 = Buffer.from(script, 'utf-8').toString('base64');
            this._pipe = await import('data:text/javascript;base64,' + b64);
            return this._pipe;
        });
    },
    get body(){
        return new AsyncPromise(async () =>{
            await this.pipe;
            let raw = await  this.load();
            this.body = JSON.parse(raw);
            this.body.type ??= 'task';
            this.body.items ??= [];
            return this.body;
        })
    },
    get model(){
        return Promise.resolve(this.body).then(body => {
            return WORK.get_item(body.model)
        })
    },
    /** Stop: прервать текущий стрим и не планировать самовызовы. Ленту не трогает. */
    async stop(params = {}) {
        this._stopped = true;
        return { ok: true, stopped: true };
    },
    _build_block(type) {
        const node = this.pipe[type];
        const block = {
            type,
            box: node.box,
            icon: node.icon,
            stop: node.stop,
            label: node.label,
        };
        if (block.box)
            block.items = [];
        return block;
    },    
    async _push_block(params = {}){
        const {block, box, session} = params;
        box.items ??= [];
        box.using_blocks ??= [];
        box.using_blocks.add(block.type);
        const init = this.pipe[block.type]?.init;
        if (init && !await init(params))
            return false;

        block.time ??= Date.now();
        if (block.box)
            block.items ??= [];
        box.items.push(block);
        await this._save(session);
        return true;
    },
    async _active_block() {
        let box = await this._active_box();
        const planned = box.todo?.steps || [];
        const real = (box.items || []).filter(b => b.type === 'step');
        if (planned.length && (real.some(s => !s.content) || real.length < planned.length))
            return box.todo;
        if (box.type === 'includes') {
            const pipe = await this.pipe;
            const list = pipe.includePlan(box);
            const files = pipe.includeReal(box);
            const open = files.find(f => !f.content);
            if (open)
                return open;
            if (list.length && files.length < list.length)
                return box;
        }
        const items = box.items || [];
        return items.last || box;
    },
    async _active_box() {
        let next, box = await this.body;
        while (next = box.items?.last){
            if(next.box && !next.content)
                box = next;
            else
                break;
        }
        return box;
    },
    async change_model(params = {}) {
        const model = params.model || params.post?.model;
        const session = params.session;
        if (!model) return { ok: false, error: 'model required' };
        (await this.body).model = model;
        await this._save(session);
        return { ok: true, model};
    },
    async change_effort(params = {}) {
        const effort = params.effort ?? params.post?.effort;
        const session = params.session;
        if (!effort) return { ok: false, error: 'effort required' };
        (await this.body).effort = effort;
        await this._save(session);
        return { ok: true, effort };
    },
    async remove_block(params = {}) {
        const block = params.block || params.post?.block || {
            time: params.time ?? params.post?.time,
            type: params.type ?? params.post?.type,
        };
        const body = await this.body;
        const box = parentOfBlock(body, block);
        if (!box) return { ok: false, error: 'block not found' };
        const i = box.items.findIndex(b => sameBlock(b, block));
        if (i < 0) return { ok: false, error: 'block not found' };
        const type = box.items[i].type;
        box.items.splice(i, 1);
        const used = box.using_blocks;
        if (used) {
            const j = used.indexOf(type);
            if (j >= 0) used.splice(j, 1);
            if (!used.length)
                delete box.using_blocks;
        }
        await this._save(params.session);
        return { ok: true };
    },
    async _save(session){
        await WORK.fsp.writeFile(this.dir, JSON.stringify(this.body, null, 4), 'utf-8');
        session?.send?.({ path: this.short });
    },
};

function sameBlock(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.time && b.time)
        return Number(a.time) === Number(b.time) && a.type === b.type;
    return a.type === b.type && a.label === b.label && a.content === b.content;
}

function parentOfBlock(root, block) {
    if (!root || !block) return null;
    for (const b of (root.items || [])) {
        if (sameBlock(b, block)) return root;
        const p = parentOfBlock(b, block);
        if (p) return p;
    }
    return null;
}

function stageOpen(block, node) {
    if (!node?.box) return '';
    const label = node.label || block.label || block.type;
    return 'Текущий этап далее (' + label + ').';
}

function timeNow(tz) {
    const now = new Date();
    const dayOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOpts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    if (tz) {
        dayOpts.timeZone = tz;
        timeOpts.timeZone = tz;
    }
    try {
        return `Сейчас: ${now.toLocaleDateString('ru-RU', dayOpts)}, время ${now.toLocaleTimeString('ru-RU', timeOpts)}${tz ? ` (${tz})` : ''}.`;
    } catch {
        return `Сейчас: ${now.toLocaleDateString('ru-RU')}, время ${now.toLocaleTimeString('ru-RU')}.`;
    }
}
