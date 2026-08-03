// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
// Линейный реестр pipe (по id = type блока); корень — pipe.thinking.
export default {
    icon: 'bootstrap:robot',

    /**
     * Вход автомата. Один вызов = один узел (think + маршрут + execute).
     * @param {object} params — { prompt?, user?, role?, answers?, model? }
     * @param {object|FormData} [post] вложения: { files?, urls? } — сохранить в папку задачи
     */
    async prompt(params = {}, post) {
        debugger
        let { prompt, role, user } = params;
        try {
            const isService = role === 'AI';
            if (!isService) {
                let block = {
                    type: 'prompt',
                    content: prompt,
                    sender: user?.$user?.id ?? user?.uid ?? '',
                    items: []
                }
                await this._push_block(user, block);
            }
            let pipe = await this.pipe;
            let active_pipe = await this._active_pipe();
            if(active_pipe?.next?.length){
                prompt = 'Исходя из текущего контекста выбери из следующего списка один, наиболее подходящий шаг:';
                for(let next of active_pipe.next){
                    let next_pipe = pipe[next];
                    prompt += '\n' + next + ' - ' + next_pipe.inject + ';'
                }
                prompt += '\n\nОтветь одним словом из списка без знаков препинания и пояснений!'
            }
            let messages = await this.context();
            messages.push({
                role: 'user',
                content: prompt
            })

            let response = await this._streamChat({ messages }, user);
            if (this._stopped) return;
            let next = response.content.trim().toLowerCase();

            let next_pipe = pipe[next];
            messages.last.content = next_pipe.prompt;
            response = await this._streamChat({ messages }, user);
            let block = next_pipe.build(response);
            await this._push_block(user, block);
            if(!block.button && !next_pipe.stop){
                this.async(()=>{
                    this.prompt({prompt: next, role: 'AI'});
                })
            }

            
            // await this._thinking(prompt || '', user);
        }
        catch (e) {
            await this._push_block(user, { type: 'error', content: e.message });
        }

        user?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
    },
    async _active_pipe(){
        let block = await this._active_block();
        let pipe = await this.pipe;
        return pipe[block.type];
    },
    async _active_block(){
        const find__active_block = (block) => {
            if(block.closed || !block.items?.length)
                return block;
            block = block.items.last;
            return find__active_block(block);
        }
        const block = await this.body;
        return find__active_block(block);
    },
    async context(){
        const body = await this.body;
        const walk = (node, out) => {
            for (const b of (node.items || [])) {
                if( b.type === 'prompt')
                    out.push({ role: 'user', content: b.content });
                else{
                    out.push({ role: 'assistant', content: '*' + b.type + '*\n\n' + b.content });
                }
                if (b.items?.length) walk(b, out);
            }
            return out;
        };
        const out = [{ role: 'system', content: body.system }];
        return walk(body, out);
    },
    /**
     * Один стрим-ход модели. context = { messages, functions? };
     * content-чанки → text + delta в WS, function_call → calls[{method, args}].
     */
    async _streamChat(context, userSession){
        const model = await this.model;
        let content = '', usage = 0;
        const calls = [];
        for await (const chunk of model.streamChat(context)) {
            if (this._stopped)
                break;
            if (chunk?.type === 'usage')
                usage = chunk;
            else if (chunk?.type === 'function_call' && chunk.name)
                calls.push({ method: chunk.name, args: chunk.arguments || {} });
            else{
                let token = chunk?.content?chunk?.content:chunk;
                if (typeof token !== 'string')
                    continue;
                content += token;
                userSession?.send?.({ type: 'chat.delta', path: this.short, token });
            }
        }
        return {content, usage, calls}
    },
    get pipe(){
        return new AsyncPromise(async () =>{
            let files = await this.tilde;
            let pipe = files.find(f => f.id === 'pipe.js');
            let raw = await pipe.load();
            this.pipe = await this.constructor.importScript(raw);
            return this.pipe;
        })
    },
    get body(){
        return new AsyncPromise(async () =>{
            let raw = await  this.load();
            this.body = JSON.parse(raw);
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
    async _push_block(userSession, block){
        let root = await this._active_block();
        block.time = Date.now();
        root.items.push(block);
        await this._save(userSession);
    },
    /** Tip-массив для записи: спуск в items последнего контейнера (в т.ч. пустой items: []). */
    async get_active_list(){
        let body = await this.body;
        if (body.closed)
            return [];
        let list = body.items ||= [];
        while (true) {
            const last = list.at(-1);
            if (last && Array.isArray(last.items) && !last.closed) {
                list = last.items;
                continue;
            }
            return list;
        }
    },
    async change_model(params = {}) {
        const {model} = params;
        const userSession = params.user;
        (await this.body).model = model;
        await this._save(userSession);
        return { ok: true, model};
    },
    async _save(userSession){
        await WORK.fsp.writeFile(this.dir, JSON.stringify(this.body, null, 4), 'utf-8');
        userSession?.send?.({ path: this.short });
    }
};
