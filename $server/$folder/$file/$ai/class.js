// Дерево пайплайна (конечный автомат) вынесено в pipe.json (рядом с class.js).
// Поля узла: step (имя), prompt (генерация/инъекция), inject (подсказка меню родителя),
// next (дети: 1 → прямой переход, N → выбор словом), button (wait-узел: блок + кнопка),
// fc (массив разрешённых функций | '*' все | 'readonly' только !mutates), askType ('form'|'questions').
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
                    content: prompt
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
        const walk = (block, out) => {
            for(const b of block.ribbon){
                out.push({ role: b.type === 'prompt' ? 'user' : 'assistant', content: b.content });
                if(b.ribbon) walk(b, out);
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
        const messages = await this.context();
        messages.last.content = prompt;
        let { content, usage } = await this._streamChat({ messages }, userSession);
        if(this._stopped) return;
        await this._push_block(userSession, { type: 'thinking', content, usage });
        let node = this.pipe_node;
        let inject = pipe.inject;
        let next = node.next || pipe.next;
        for(let key in next){
            inject += '\n' + key + ' - ' + next[key].inject;
        }
        messages.push({
            role: 'user',
            content: inject
        });

        ({ content, usage } = await this._streamChat({ messages }, userSession))
        if(this._stopped) return;
        content = content.trim().toLowerCase();
        this.pipe_node = next[content];
        if(this.pipe_node){

        }
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
            let pipe = files.find(f => f.id === 'pipe.json');
            let raw = await pipe.load();
            this.pipe = JSON.parse(raw);
            return this.pipe;
        })
    },
    get body(){
        return new AsyncPromise(async () =>{
            let raw = await  this.load();
            this.body = JSON.parse(raw);
            this.body.ribbon ??= [];
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
        let ribbon = await this.get_active_ribbon();
        block.time = Date.now();
        ribbon.push(block);
        await this._save(userSession);
    },
    async get_active_ribbon(){
        let body = await this.body;
        if(body.closed)
            return [];
        let ribbon;
        while(body){
            ribbon = body.ribbon;
            body = ribbon.filter(block => block.ribbon && !block.closed).last;
        }
        return ribbon;
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