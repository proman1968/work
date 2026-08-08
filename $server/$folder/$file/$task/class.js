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
     
        let { prompt, role, user } = params;
        try {
            switch (role) { 
                case 'AI':{
                    debugger
                } break;
                case 'BUTTON':{
                    debugger
                } break;
                default:{
                    let block = {
                        type: 'prompt',
                        content: prompt,
                        sender: user?.$user?.id ?? user?.uid ?? '',
                        items: []
                    }
                    await this._push_block(user, block);
                }
            }
     
            let pipe = await this.pipe;
            let active_pipe = await this._active_pipe();
            
            let container = await this._active_container();
   
            let options = [...active_pipe.next];
            let menu = 'Выбери следующий тип шага, не решай задачу целиком.';
            menu += '\n\nОтветь одним словом точно из списка без знаков препинания и пояснений:';
            for (let id of options) menu += '\n\n' + id + ' - ' + (pipe[id]?.inject || '') + ';';
            

            let messages = await this.context();
            if(messages.last?.role === 'user')
                messages.last.content += '\n\n[instruction]\n\n' + menu;
            else
                messages.push({ role: 'user', content: menu });

            let response = await this._streamChat({ messages, silent: true, user });
            if (this._stopped) return;
            let choice = response.content.trim().toLowerCase();
  
            let next_pipe = pipe[choice];
            if(!next_pipe){
                await this._push_block(user, { content: response.content});
            }
            else{
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
        }
        catch (e) {
            await this._push_block(user, { type: 'error', content: e.message });
        }

        user?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
    },
    /** Последний не-hidden в массиве. */
    _lastVisible(items) {
        if (!Array.isArray(items)) return undefined;
        for (let i = items.length - 1; i >= 0; i--)
            if (!items[i]?.hidden) return items[i];
        return undefined;
    },
    async _active_pipe(){
        let block = await this._active_block();
        let pipe = await this.pipe;
        return pipe[block.type];
    },
    /** Позиция автомата: лист; hidden в items не участвуют. */
    async _active_block(){
        const find__active_block = (block) => {
            if (block.closed) return block;
            const last = this._lastVisible(block.items);
            if (!last) return block;
            if (last.closed) return block;
            if (!last.items?.length) return last;
            return find__active_block(last);
        }
        return find__active_block(await this.body);
    },
    /** Контейнер (родитель листа) — куда пушить; hidden пропускаем. */
    async _active_container(){
        const find = (block) => {
            if (block.closed) return block;
            const last = this._lastVisible(block.items);
            if (!last || last.closed || !Array.isArray(last.items)) return block;
            return find(last);
        }
        return find(await this.body);
    },
    /** Закрыт step → найти родительский task, отметить шаг done, следующий pending → in_progress. */
    async _advance_steps(container){
        if (container?.type !== 'step') return;
        const body = await this.body;
        const findParent = (node) => {
            for (const b of (node.items || [])) {
                if (b === container) return node;
                if (b.items?.length) {
                    const r = findParent(b);
                    if (r) return r;
                }
            }
            return null;
        };
        const task = findParent(body);
        if (task?.type !== 'task' || !Array.isArray(task.steps)) return;
        const cur = task.steps.find(s => s.status === 'in_progress');
        if (cur) cur.status = 'done';
        const next = task.steps.find(s => s.status === 'pending');
        if (next) next.status = 'in_progress';
        else task.closed = true;  // все шаги done — закрыть task
    },
    async context(){
        const body = await this.body;
        const pipe = await this.pipe;
        const walk = (node, out) => {
            for (const b of (node.items || [])) {
                let content = (b.content || '');
                if (b.type === 'task' && Array.isArray(b.steps)) {
                    content += '\n\nШаги:\n' + b.steps
                        .map(s => `${s.number}. [${s.status}] ${s.description}`)
                        .join('\n');
                }
                out.push({ role: pipe[b.type]?.role || 'assistant', content });
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
    /** time на блоке и вложенных items (build часто не ставит). */
    _stamp_time(block) {
        if (!block || typeof block !== 'object') return;
        if (block.time == null) block.time = Date.now();
        if (Array.isArray(block.items))
            for (const b of block.items) this._stamp_time(b);
    },
    async _push_block(userSession, block){
        let root = await this._active_container();
        this._stamp_time(block);
        root.items.push(block);
        await this._save(userSession);
    },
    /** Tip-массив для записи: спуск в items последнего видимого контейнера. */
    async get_active_list(){
        let body = await this.body;
        if (body.closed)
            return [];
        let list = body.items ||= [];
        while (true) {
            const last = this._lastVisible(list);
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
