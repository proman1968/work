// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
// Линейный реестр pipe (по id = type блока); 
export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',

    /**
     * Вход автомата. Один вызов = один узел (think + маршрут + execute).
     * @param {object} params — { prompt?, user?, role?, answers?, model? }
     * @param {object|FormData} [post] вложения: { files?, urls? } — сохранить в папку задачи
     */
    async prompt(params = {}, post) {
        debugger
        let { prompt, role, user } = params;
        let pipe = await this.pipe;
        let active_block = await this._active_block();
        let active_pipe = pipe[active_block.type];
        try {
            switch (role) { 
                case 'AI':{
                } break;
                case 'BUTTON':{
                    switch(prompt){ 
                        case 'true':{
                            active_pipe.convert(active_block);  
                        } break;
                        case 'false':{
                            active_block.rejected = true; 
                        } break;       
                    }
                    await this._save(user);
                } break;
                default:{
                    let block = {
                        type: 'prompt',
                        content: prompt,
                    };
                    if(!active_block?.type)
                        block.items = [];
                    active_block = block;
                    await this._push_block(user, active_block);
                }
            }
            let messages = await this.context();
            if(active_block.rejected){
                messages[0].content = "Твое последнее предложение отклонено пользователем, выясни, что именно не его понравилось."
            }
            else{
                active_pipe = pipe[active_block.type];
                let options = [...active_pipe.next];
                let menu = 'Выбери следующий тип шага, не решай задачу целиком, ответь одним словом точно из списка без знаков препинания и пояснений:';
                for (let id of options) menu += '\n' + id + ' - ' + (pipe[id]?.inject || '') + ';';
                if(messages.last?.role === 'user')
                    messages.last.content += '\n\n[instruction]\n' + menu;
                else
                    messages.push({ role: 'user', content: menu});
            }
   
            
            


            let response = await this._streamChat({ messages, silent: true, user });
            if (this._stopped) return;
            let choice = response.content.trim().toLowerCase();
  
            let next_pipe = pipe[choice];
            if(!next_pipe){
                choice = 'text'
                next_pipe = pipe[choice];
            }

            let block = {
                type: choice,
                icon: next_pipe.icon || 'carbon:idea',
            }
            await this._push_block(user, block);


            messages = await this.context();
            if(messages.last?.role === 'user')
                messages.last.content += '\n\n[instruction]\n\n' + next_pipe.prompt;
            else
                messages.push({ role: 'user', content: next_pipe.prompt });

            response = await this._streamChat({ messages, user });
            if (this._stopped) return;
            Object.assign(block, response);
            block.button = next_pipe.button;
            block.stop = next_pipe.stop;
            await this._save(user);
            if (!block.button && !block.stop) {
                this.async(() => this.prompt({ role: 'AI', user }));
            }
        }
        catch (e) {
            await this._push_block(user, { type: 'error', content: e.message });
        }

        user?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
    },
    async context(){
        const body = await this.body;
        const pipe = await this.pipe;
        const walk = (node, out) => {
            for (const b of (node.items || [])) {
                let content = (b.content || '');
                // if (b.type === 'task' && Array.isArray(b.steps)) {
                //     content += '\n\nШаги:\n' + b.steps
                //         .map(s => `${s.number}. [${s.status}] ${s.description}`)
                //         .join('\n');
                // }
                switch(pipe[b.type]?.role){
                    case 'user':{
                        out.push({ role: pipe[b.type]?.role, content });
                    } break;
                    default:{
                        out.push({ role: 'assistant', content: `<${b.type}>${content}</${b.type}>`});
                    }
                }
                
                if (b.items?.length) walk(b, out);
            }
            return out;
        };
        const out = [{ role: 'system', content: body.system }];
        return walk(body, out);
    },
    async _streamChat(params = {}) {
        const { messages, functions, silent, user } = params;
        const model = await this.model;
        let content = '', usage = 0;
        const calls = [];
        for await (const chunk of model.streamChat({ messages, functions })) {
            if (this._stopped)
                break;
            if (chunk?.type === 'usage')
                usage = chunk;
            else if (chunk?.type === 'function_call' && chunk.name)
                calls.push({ method: chunk.name, args: chunk.arguments || {} });
            else {
                let token = chunk?.content ? chunk?.content : chunk;
                if (typeof token !== 'string')
                    continue;
                content += token;
                if (!silent)
                    user?.send?.({ type: 'chat.delta', path: this.short, token });
            }
        }
        return { content, usage, calls };
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
        let root = await this._active_block(true);
        block.time ??= Date.now();
        root.items.push(block);
        await this._save(userSession);
    },
    async _active_block(only_container = false) {
        let active_block = await this.body;
        while (active_block?.items?.length && !active_block.closed) {
            if(only_container &&  !active_block.items.last?.items)
                break;
            active_block = active_block.items.last;
        }
        return active_block;
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
