// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
// Линейный реестр pipe.nodes (по id = type блока); корень pipe.root.
// Движок: _thinking — think + маршрут из this.pipe_node + execute одного узла, пишет this.pipe_node.
// prompt() — вход: реальный (push блока prompt) / служебный (role ASSISTENT, без блока). Self-call'ов НЕТ —
// продолжение цикла идёт снаружи через prompt({role:'ASSISTENT'}) от кнопки клиента; состояние живёт в this.pipe_node.
// Поля узла: prompt, inject, next (массив id), build, button, fc, askType. Router — без prompt/build (только next).

export default {
    icon: 'bootstrap:robot',

    /**
     * Вход автомата. Один вызов = один узел (think + маршрут + execute).
     * Реальный вход (role USER|BOSS|ADMIN): text → блок prompt → _thinking.
     * Служебный вход (role ASSISTENT): без блока — продолжение по кнопке, состояние в this.pipe_node.
     * @param {object} params — { prompt?, user?, role?, answers?, model? }
     * @param {object|FormData} [post] вложения: { files?, urls? } — сохранить в папку задачи
     */
    async prompt(params = {}, post) {
        let { prompt, role, user } = params;
        try {
            const isService = role === 'ASSISTENT';
            if (!isService) {
                this._stopped = false; // новый реальный ход снимает Stop прошлого цикла
                await this._push_block(user, {
                    type: 'prompt',
                    content: prompt,
                    sender: user?.$user?.id ?? user?.uid ?? '',
                    items: []
                });
            }
            await this._thinking(prompt || '', user);
        }
        catch (e) {
            await this._push_block(user, { type: 'error', content: e.message });
        }

        user?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
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
    /**
     * Один ход автомата: think + маршрут из this.pipe_node + execute одного выбранного узла.
     * Пишет this.pipe_node = выбранный узел (persisted между вызовами). Self-call'ов нет.
     * thinking мерджит root.prompt в последний user-промпт (реальный вход); иначе — новое user-сообщение.
     */
    async _thinking(prompt, userSession){
        const pipe = await this.pipe;
        const root = pipe.nodes[pipe.root];
        prompt += root.prompt;
        let messages = await this.context();
        messages.last.content = prompt;
        let { content, usage } = await this._streamChat({ messages }, userSession);
        if (this._stopped) return;
        await this._push_block(userSession, { type: 'thinking', content, usage, icon: root.icon });
        messages = await this.context();

        // маршрут из persisted-состояния (или root на первом ходе)
        const node = this.pipe_node || root;
        const nextIds = node.next || root.next || [];
        if (!nextIds.length) return; // терминал

        let next_id = nextIds[0];
        if (nextIds.length > 1) {
            let inject = root.inject;
            for (const id of nextIds) {
                inject += '\n' + id + ' - ' + (pipe.nodes[id]?.inject || '') + ';';
            }
            messages.push({ role: 'user', content: inject });
            ({ content, usage } = await this._streamChat({ messages }, userSession));
            if (this._stopped) return;
            next_id = content.trim().toLowerCase();
            if (!pipe.nodes[next_id]) return; // мусор от модели
        }

        const nextNode = pipe.nodes[next_id];
        this.pipe_node = nextNode; // persist для следующего вызова

        // исполняем выбранный узел (если есть prompt)
        if (nextNode.prompt) {
            messages = await this.context();
            if (next_id === 'thinking' && messages.last?.role === 'user') {
                messages.last.content = (messages.last.content || '') + nextNode.prompt;
            } else {
                messages.push({ role: 'user', content: nextNode.prompt });
            }
            const response = await this._streamChat({ messages }, userSession);
            if (this._stopped) return;
            const block = nextNode.build?.(response);
            if (block) {
                if (block.type === 'task' && !block.label)
                    block.label = (await this.body).title || 'Задача';
                await this._push_block(userSession, block);
            }
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
        return null;
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
