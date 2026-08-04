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
        // debugger
        let { prompt, role, user } = params;
        try {
            const isService = role === 'AI';
            // подтверждение complete: служебный ход с label кнопки → закрыть контейнер complete-блока (отказ «нет» — мимо)
            if (isService) {
                let leaf = await this._active_block();
                if (leaf?.type === 'complete' && prompt === leaf.button?.label) {
                    let container = await this._active_container();
                    container.closed = true;
                    await this._advance_steps(container);
                    await this._save(user);
                    user?.send?.({ type: 'chat.done', path: this.short });
                    this.async(() => this.prompt({ role: 'AI', user }));
                    return { ok: true };
                }
            }
            if (!isService) {
                let block = {
                    type: 'prompt',
                    content: prompt,
                    sender: user?.$user?.id ?? user?.uid ?? '',
                    // items: []
                }
                await this._push_block(user, block);
            }
            let pipe = await this.pipe;
            let active_pipe = await this._active_pipe();
            let messages = await this.context();

            if (active_pipe?.next?.length) {
                let container = await this._active_container();
                // let next_id;
                // if (active_pipe.next.length === 1) {
                //     // единственный маршрут — детерминированный переход, модель не спрашиваем
                //     next_id = active_pipe.next[0];
                //     // messages.push({ role: 'user', content: '' });
                // } else {
                    let options = [...active_pipe.next];
                    // complete: только если есть дети и последний завершён (лист или closed)
                    if (container.items?.length && (container.items.last.items === undefined || container.items.last.closed))
                        options.push('complete');
                    let menu = 'Выбери из списка один, наиболее подходящий следующий шаг:';
                    for (let id of options) menu += '\n' + id + ' - ' + (pipe[id]?.inject || '') + ';';
                    menu += '\n\nОтветь одним словом из списка без знаков препинания и пояснений!';
                    console.warn(container.type)
                    console.log(menu)
                    messages.push({ role: 'user', content: menu });

                    let choice = await this._streamChat({ messages }, user);
                    if (this._stopped) return;
                    console.warn('choice', choice)
                    choice = choice.content.trim().toLowerCase();
                    // let next_id = words.find(w => pipe[w] && options.includes(w)) || options[0];
                // }
                let next_pipe = pipe[choice];

                // нет prompt — узел без генерации, модель не вызываем
                let response;
                if (!next_pipe.prompt) {
                    response = { content: '', usage: 0, calls: [] };
                } else {
                    messages.last.content = next_pipe.prompt;
                    response = await this._streamChat({ messages }, user);
                    if (this._stopped) return;
                }

                // ctx для build: currentStep — in_progress-шаг активного task (для step.build)
                let ctx = {};
                if (container?.type === 'task' && Array.isArray(container.steps))
                    ctx.currentStep = container.steps.find(s => s.status === 'in_progress');

                let block = next_pipe.build(response, ctx);
                if (block) {
                    // autocomplete = complete без кнопки
                    const auto = choice === 'complete' && pipe[container.type]?.autocomplete;
                    if (auto) delete block.button;
                    await this._push_block(user, block);
                    if (auto) {
                        container.closed = true;
                        await this._advance_steps(container);
                        await this._save(user);
                    }
                    if (!block.button && !block.stop) {
                        this.async(() => this.prompt({ role: 'AI', user }));
                    }
                }
            }
            // терминал (active_pipe без next) — маршрут не нужен; подтверждение кнопок/complete отдельно
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
    /** Позиция автомата для маршрута: лист дерева; если последний ребёнок закрыт — сам контейнер. */
    async _active_block(){
        const find__active_block = (block) => {
            if (block.closed || !block.items?.length)
                return block;
            const last = block.items.at(-1);
            if (last.closed) return block;
            return find__active_block(last);
        }
        return find__active_block(await this.body);
    },
    /** Контейнер (родитель листа) — куда пушить новый блок. */
    async _active_container(){
        const find = (block) => {
            if (block.closed) return block;
            const last = block.items?.at(-1);
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
        const walk = (node, out) => {
            for (const b of (node.items || [])) {
                if (b.type === 'prompt' || b.type === 'step') {
                    out.push({ role: 'user', content: b.content });
                } else {
                    let content = (b.content || '');
                    if (b.type === 'task' && Array.isArray(b.steps)) {
                        content += '\n\nШаги:\n' + b.steps
                            .map(s => `${s.number}. [${s.status}] ${s.description}`)
                            .join('\n');
                    }
                    out.push({ role: 'assistant', content });
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
        let root = await this._active_container();
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
