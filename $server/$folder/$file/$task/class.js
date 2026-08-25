// Линейный реестр PIPE (по id = type блока);
export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',
    async prompt(params = {}) {
        
        // debugger;
        let { prompt, role, session } = params;
        await this._init(params);
        

        try {
            switch (role) {
                case 'AI':{
                } break;
                case 'APPROVE':{
                    params.block.answer = prompt;
                    if (params.accept === true || params.accept === 'true') {
                        params.block.state = 'approved';
                        await params.pipe_step.approve?.(params);
                    } else {
                        params.block.state = 'rejected';
                    }
                    delete params.block.stop;
                    delete params.container.using_blocks;
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
                    delete params.container.using_blocks;
                    this._stopped = false;
                }
            }

            await this._init(params);
            await PIPE[params.container.type]?.recalc?.(params);

 
            // Находим список следующих шагов
            let mode = (await this.body).mode || 'plan';
            const node = PIPE[params.block.type];
            const place = PIPE[params.container.type];
            let next = (params.block.container && params.block.content)
                ? (place?.[mode]?.next || place?.next || [])
                : (node?.[mode]?.next || node?.next || place?.[mode]?.next || place?.next || []);

            
            // Убираем использованные блоки из списка next
            let using_blocks = params.container.using_blocks ??= [];
            next = next.filter(id => !using_blocks.includes(id));

            let choice;
            if(!next.length){
                if(!params.container.content)
                    choice = 'report';
            } 
            if (next.length === 1)
                choice = next[0];
            else {
                let menu = next.map(id => id.toUpperCase() + ' - ' + (PIPE[id]?.[mode]?.inject || PIPE[id]?.inject) + ';');
                menu.unshift('Выбери строго один вариант из списка. Ответь одним словом, без знаков и пояснений. Выберай шаг или действие, которое необходимо сделать дальше:');
                menu = menu.join('\n');
                let messages = await this.context({prompt: menu, session});
                let response = await this._streamChat({ messages, silent: true, session });
                if (!this._stopped) {
                    const word = response.content.trim().toLowerCase();
                    if (next.includes(word))
                        choice = word;
                }
            }
            if (choice) {
                let next_pipe = PIPE[choice];
                
                params.block = this._build_block(choice);
                if(await this._push_block(params)){
                    prompt = next_pipe.prompt;
                    if(!params.block.container && !params.block.content && prompt){
                        let messages = await this.context({prompt, session});
                        let response = await this._streamChat({ messages, session });
                        Object.assign(params.block, response);
                    }
                }
                await this._save(session);
                if (!this._stopped && (params.block.container || !params.block.stop)) {
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
        params.container = await this._active_container();
        params.pipe_step = PIPE[params.block.type] || PIPE.thinking;
        params.task = this;
    },
    async context(params = {}) {
        const {prompt} = params;
        const layers = [];
        const body = await this.body;
        let container = body;
        for (;;) {
            layers.push(this._container_context(container));
            const next = container.items?.last;
            if (next?.container && !next.content) container = next;
            else break;
        }
        const mode = body.mode || 'plan';
        const modeLine = mode === 'do' ? 'Сейчас ты в режиме исполнения.' : 'Сейчас ты в режиме планирования.';
        const messages = [{ role: 'system', content: [...layers.map(l => l.system).filter(Boolean), timeNow(body.tz), modeLine].filter(Boolean).join('\n\n') }];
        const push = (nextRole, content) => {
            if (!content) return;
            if (messages.last?.role === nextRole) {
                if (nextRole === 'assistant')
                    messages.push({ role: 'user', content: 'продолжай' });
                else {
                    messages.last.content += '\n\n' + content;
                    return;
                }
            }
            messages.push({ role: nextRole, content });
        };
        for (const layer of layers)
            for (const m of layer.messages)
                push(m.role, m.content);
        if (prompt) {
            if (messages.last?.role === 'user')
                messages.last.content += '\n\n[instruction]\n' + prompt;
            else
                messages.push({ role: 'user', content: prompt });
        }
        return messages;
    },
    _container_context(container) {
        const node = PIPE[container.type];
        const mode = this.body.mode || 'plan';
        let system = node?.[mode]?.system || node?.system || container.system || '';
        if (container.todo)
            system += '\n\n[todo]\n' + (container.todo.content || '');
        const messages = [];
        for (const b of (container.items || [])) {
            if (PIPE[b.type]?.close)
                continue;
            messages.push({ role: PIPE[b.type]?.role || 'assistant', content: b.content || stageOpen(b) });
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
        let content = '', usage = 0;
        for await (const chunk of model.streamChat({ messages })) {
            if (this._stopped)
                break;
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
    get pipe(){    ;
        return globalThis.PIPE ??= new AsyncPromise(async () =>{
            let files = await this.tilde;
            let pipe = files.find(f => f.id === 'pipe.js');
            let raw = await pipe.load();
            globalThis.PIPE = await this.constructor.importScript(raw);
            return globalThis.PIPE;
        })
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
        let block = PIPE[type];
        block = {
            type,
            container: block.container,
            icon: block.icon,
            stop: block.stop,
            label: block.label,            
        };
        if(block.container)
            block.items = [];
        return block;
    },    
    async _push_block(params = {}){
        const {block, container, session} = params;
        container.items ??= [];
        container.using_blocks ??= [];
        container.using_blocks.push(block.type);
        let init = PIPE[block.type]?.init;
        if(init && !await init(params)){
            return false;
        }
        block.time ??= Date.now();
        if (block.container)
            block.items ??= [];
        container.items.push(block);   
        await this._save(session);
        return true;
    },
    async _active_block() {
        let container = await this._active_container();
        const planned = container.todo?.steps || [];
        const real = (container.items || []).filter(b => b.type === 'step');
        if (planned.length && (real.some(s => !s.content) || real.length < planned.length))
            return container.todo;
        if (container.type === 'includes') {
            const list = PIPE.includePlan(container);
            const files = PIPE.includeReal(container);
            const open = files.find(f => !f.content);
            if (open)
                return open;
            if (list.length && files.length < list.length)
                return container;
        }
        const items = container.items || [];
        return items.last || container;
    },
    async _active_container() {
        let next,container = await this.body;
        while (next = container.items?.last){
            if(next.container && !next.content)
                container = next;
            else
                break;
        }
        return container;
    },
    async change_model(params = {}) {
        const model = params.model || params.post?.model;
        const session = params.session;
        if (!model) return { ok: false, error: 'model required' };
        (await this.body).model = model;
        await this._save(session);
        return { ok: true, model};
    },
    async _save(session){
        await WORK.fsp.writeFile(this.dir, JSON.stringify(this.body, null, 4), 'utf-8');
        session?.send?.({ path: this.short });
    },
};

function stageOpen(block) {
    if (!PIPE[block?.type]?.container) return '';
    const label = PIPE[block.type].label || block.label || block.type;
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
