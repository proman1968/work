// Дерево пайплайна (конечный автомат) вынесено в pipe.js (рядом с class.js).
// Поля узла: step (имя), icon (иконка типа для UI), prompt (генерация/инъекция),
// inject (подсказка меню родителя), next (дети: 1 → прямой переход, N → выбор словом),
// button (wait-узел: блок + кнопка), fc (массив | '*' | 'readonly'), askType ('form'|'questions').
// Лист без next/button: fc-узел → после _handle_call продолжение на thinking;
// без fc (только prompt, как step) → отрендеренный prompt как continue-строка.

export default {
    icon: 'bootstrap:robot',

    /**
     * Автомат task.ai — обход дерева PIPE (конечный автомат).
     * Реальный вход (role USER|BOSS|ADMIN): text → блок prompt + _walk(PIPE);
     * confirm/answers — разбор кнопок/wait-узлов (был _confirm, свёрнут сюда).
     * Служебный вход (role ASSISTENT): без блока prompt, только острие messages;
     * продолжения самовызовами с лимитом MAX_AUTO_TURNS → кнопка «Продолжить».
     * @param {object} params — { prompt?, user?, role?, confirm?, answers?, model?, _turn? }
     * @param {object|FormData} [post] вложения: { files?, urls? } — сохранить в папку задачи
     */
    async prompt(params = {}, post) {
        let {prompt, role, user} = params;
        try{
            const isService = role === 'ASSISTENT';
            if(!isService){
                this._stopped = false; // новый реальный ход снимает Stop прошлого цикл
                await this._push_block(user,{
                    type: 'prompt',
                    content: prompt,
                    sender: user?.$user?.id ?? user?.uid ?? '',
                    items: []
                })
            }
            prompt = await this._thinking(prompt, user);
            if(prompt){
                this.async(()=>{
                    this.prompt({
                        role: 'ASSISTENT',
                        prompt,
                        user
                    })
                })
                return {ok: true}
            }
        }
        catch(e){
            await this._push_block(user,{
                type: 'error',
                content: e.message
            })
        }

        user?.send?.({ type: 'chat.done', path: this.short });
        return {ok: true};
    },
    async context(){
        const body = await this.body;
        const walk = (node, out) => {
            for (const b of (node.items || [])) {
                out.push({ role: b.type === 'prompt' ? 'user' : 'assistant', content: b.content });
                if (b.items?.length) walk(b, out);
            }
            return out;
        };
        const out = [{ role: 'system', content: body.system }];
        return walk(body, out);
    },
    async _thinking(prompt, userSession){
        debugger
        let pipe = await this.pipe;
        prompt += pipe.prompt;
        let messages = await this.context();
        messages.last.content = prompt;
        let { content, usage } = await this._streamChat({ messages }, userSession);
        if(this._stopped) return;
        await this._push_block(userSession, { type: 'thinking', content, usage, icon: pipe.icon });
        messages = await this.context();
        // messages.push({role: 'assistant', content});
        let node = this.pipe_node;
        let next = node.next || pipe.next;
        let keys = Object.keys(next);
        let next_type = keys[0];
        if(keys.length > 1){
            let inject = pipe.inject;
            for(let key of keys){
                inject += '\n' + key + ' - ' + next[key].inject + ';';
            }
            messages.push({role: 'user', content: inject});
    
            ({ content, usage } = await this._streamChat({ messages }, userSession))
            if(this._stopped) return;
            messages = await this.context();
            next_type = content.trim().toLowerCase();
        }
        this.pipe_node = next[next_type];
        messages.push({
            role: 'user',
            content: this.pipe_node.prompt
        });
        let response = { content, usage } = await this._streamChat({ messages }, userSession);
        if(this._stopped) return;
        // await this._push_block(userSession, {
        //     type: next_type,
        //     content,
        //     usage,
        //     button: this.pipe_node.button,
        //     icon: this.pipe_node.icon,
        // });
        const block = this.pipe_node.build(response);
        if (block?.type === 'task' && !block.label)
            block.label = (await this.body).title || 'Задача';
        await this._push_block(userSession, block);
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
    get pipe_node(){
        return this.pipe;
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
        let list = await this.get_active_list();
        block.time = Date.now();
        list.push(block);
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
