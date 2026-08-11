// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
// Линейный реестр PIPE (по id = type блока); 
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
        let active_block = await this._active_block();
        let container = await this._active_block(true);
        let active_pipe = PIPE[active_block.type];
        try {
            switch (role) { 
                case 'AI':{
                } break;
                case 'BUTTON':{
                    switch(prompt){ 
                        case 'true':{
                            active_block = await active_pipe.convert(container, active_block);  
                        } break;
                        case 'false':{
                            active_block.rejected = true; 
                        } break;       
                    }
                    await this._save(user);
                } break;
                default:{

                    active_block = {
                        type: 'prompt',
                        content: prompt,
                    };
                    // if(!container.items?.length)
                    //     active_block.items = [];
                    await this._push_block(user, active_block);
                }
            }
            let messages = await this.context();
            if(active_block.rejected){
                messages[0].content = "Твое последнее предложение отклонено пользователем, выясни, что именно ему не понравилось, и предложи новый вариант."
            }
            else {
                active_pipe = PIPE[active_block.type];
                let options = [...active_pipe.next];
                let menu = 'Выбери следующий тип шага, не решай задачу целиком, ответь одним словом точно из списка без знаков препинания и пояснений:';
                for (let id of options) menu += '\n' + id + ' - ' + (PIPE[id]?.inject || '') + ';';
                if(messages.last?.role === 'user')
                    messages.last.content += '\n\n[instruction]\n' + menu;
                else
                    messages.push({ role: 'user', content: menu});
            }
   
            
            


            let response = await this._streamChat({ messages, silent: true, user });
            if (this._stopped) return;
            let choice = response.content.trim().toLowerCase();
  
            let next_pipe = PIPE[choice];
            if(!next_pipe){
                choice = 'text'
                next_pipe = PIPE[choice];
            }

            let block = {
                type: choice,
                icon: next_pipe.icon || 'carbon:idea',
                stop: !next_pipe.next
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
            block.items = next_pipe.items;
            await this._save(user);
            if (!block.button && next_pipe.next?.length > 0) {
                this.async(() => this.prompt({ role: 'AI', user }));
            }
        }
        catch (e) {
            await this._push_block(user, { type: 'error', content: e.message });
        }

        user?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
    },
    async context() {
        const active = await this._active_block(true);
        let system = active.system || '';
        if (active.task)
            system += '\n\n[task]\n' + (active.task.content || '');
        const out = [{ role: 'system', content: system }];
        for (const b of (active.items || [])) {
            const role = PIPE[b.type]?.role || 'assistant';
            const chunk = role === 'user'
                ? (b.content || '')
                : `<${b.type}>${b.content || ''}</${b.type}>`;
            if (out.last?.role === role)
                out.last.content += (out.last.content ? '\n' : '') + chunk;
            else
                out.push({ role, content: chunk });
        }
        return out;
    },    
    // async context(){
    //     const body = await this.body;
    //     const walk = (node, out) => {
    //         for (const b of (node.items || [])) {
    //             let content = (b.content || '');
    //             switch(PIPE[b.type]?.role){
    //                 case 'user':{
    //                     out.push({ role: PIPE[b.type]?.role, content });
    //                 } break;
    //                 default:{
    //                     out.push({ role: 'assistant', content: `<${b.type}>${content}</${b.type}>`});
    //                 }
    //             }
                
    //             if (b.items?.length) walk(b, out);
    //         }
    //         return out;
    //     };
    //     const out = [{ role: 'system', content: body.system }];
    //     return walk(body, out);
    // },
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
const PIPE = {
    /** вход: блок prompt пушится вручную в prompt(); отсюда auto-переход в thought */
    prompt: {
        role: 'user',
        next: ['plan'],
    },

    /** размышление над следующим шагом; мерджит инструкцию в последний user-промпт */
    thought: {
        icon: 'carbon:idea',
        inject: 'если необходимо обдумать дальнейшие действия',
        prompt: [
            'Как следует подумай, над тем, что необходимо сделать на следующем шаге ',
            'исходя из контекста, и выдай свои размышления от 5 до 100 строк (от своего лица).',
            'Не повторяйся внутри размышлений, не фантазируй, не выдумывай и не пытайся ничего делать сам.',
            'Не обращайся к пользвателю, т.к. это твои размышления, только для тебя.',
            ].join(' '),
        next: ['answer', 'plan'],
    },
    text: {
        icon: 'icons:text',
        prompt: 'Просто ответь пользователю, не выполняя никаких действий.',
    },

    plan: {
        icon: 'icons:assignment',
        inject: 'если необходимо сделать несколько действий подряд, сначала надо согласовать план с пользователем',
        prompt: ['Исходя из размышлений выше, предложи план работ по запросу пользователя.',
            '\n\n[instruction]\n',
            'Первая строка — короткий заголовок будущей задачи (без нумерации, без слова task).',
            'Далее — нумерованный список пунктов в один слой. Без вступления и пояснений.',
        ].join('\n'),
        button: { label: 'Принять'},
        async convert(container, block){
            const text = block.content || '';
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            const numbered = lines.filter(l => /^\d+\.\s+\S/.test(l));
            const bullets = lines.filter(l => /^[-*•]\s+\S/.test(l));
            const titleLine = lines.find(l => !/^\d+\.\s*/.test(l) && !/^[-*•]\s/.test(l));
            const src = numbered.length ? numbered : bullets;
            container.task = {
                type: 'task',
                icon:'icons:list',
                label: (titleLine || '').replace(/\*\*/g, '').trim()
                || src[0]?.replace(/^\d+\.\s*/, '').replace(/^[-*•]\s+/, '').trim()
                || '',
                steps: src.map(line => line
                .replace(/^\d+\.\s*/, '')
                .replace(/^[-*•]\s+/, '')
                .replace(/\*\*/g, '')
                .trim()).filter(Boolean).map((description, i) => ({
                    number: i + 1,
                    description,
                    status: i === 0 ? 'in_progress' : 'todo',
                })),
                get content(){
                    return this.steps.map(s => `[id: ${s.number}] ${s.description} [status: "${s.status}"]`).join('\n');
                }

            }
            container.items.remove(block);
            return container.task;
        },
        next: ['text'],
    },
        // /** Согласованный plan: без LLM, build из ctx.from (блок plan). */
    task: {
        next: ['step']
    },

    /** шаг плана: заголовок = «N. описание» текущего in_progress, тело = items. */
    step: {
        role: 'user',
        inject: 'если необходимо выполнить один пункт плана',
        prompt: ['Выполни текущий пункт плана (со статусом in_progress) из последнего task-блока в ленте.',
            'Ровно одно действие. По завершении — подтверди кнопкой «Завершить» (узел complete).'].join('\n'),
        items: [],
        next: ['thought'],
    },

    research: {
        icon: 'icons:search',
        inject: 'если тебе что-то непонятно, или неизвестно, и необходимо провести исследование, но только, если уже есть конкретный план.',
        autocomplete: true,
        next: ['work', 'web', 'question', 'form'],
    },

    web: {
        icon: 'icons:language',
        inject: 'если необходимо найти информацию в интернете',
        prompt: ['Найди информацию в интернете ровно ОДНИМ вызовом функции:'].join('\n'),
        fc: ['search', 'fetch_url'],
        next: ['thought'],
    },

    work: {
        icon: 'icons:folder',
        inject: 'если необходимо найти файлы или информацию в рабочей области',
        prompt: ['Найди информацию в рабочей области ровно ОДНИМ вызовом функции:',
            '\n\n[instruction]\n',
            'read_file({name}) — файл;',
            'get_schema({}) / inspect_schema({path}) — устройство класса;',
            'find_text({text}) / find_item({id}) — поиск;',
            'info({}) — состав;',
            'logs({}) — журнал.',
            'Если фактов уже достаточно — изложи выводы обычным текстом.'].join('\n'),
        fc: 'readonly',
        build: (r) => ({
            type: 'work',
            content: r.content,
            usage: r.usage,
            icon: 'icons:folder',
        }),
        next: ['thought'],
    },


    form: {
        icon: 'icons:view-list',
        inject: 'если необходимо запросить у пользователя данные формой (поля ввода и/или выбор из вариантов)',
        prompt: ['Собери форму для ввода данных.',
            '\n\n[instruction]\n',
            'Вызови функцию ask_user({questions: [{prompt: "поле"|"вопрос", options?: ["вариант 1", "вариант 2"]}]}).',
            'Без options — свободный ввод; с options — выбор.',
            'Первой строкой обычного текста (до вызова) можно дать краткое пояснение к форме.'].join('\n'),
        fc: ['ask_user'],
        build: (r) => {
            const call = r.calls?.find(c => c.method === 'ask_user');
            if (!call) return null;
            const fields = (call.args.questions || []).map((q, i) => {
                const id = q.id || `f${i + 1}`;
                const label = q.prompt || q.label || id;
                const field = { id, type: 'String', label, placeholder: label };
                if (q.options?.length) field.options = q.options;
                return field;
            });
            const block = {
                type: 'form',
                fields,
                button: { label: 'Продолжить' },
                icon: 'icons:view-list',
            };
            if (r.content?.trim()) block.content = r.content.trim();
            return block;
        },
        next: ['thought'],
    },

    actions: {
        inject: 'если необходимо выполнить одно или несколько действий, над системой или в интернете',
        prompt: 'Как следует подумай, что ты собираешься сделать',
        autocomplete: true,
        build: (r) => ({
            type: 'action',
            content: r.content,
            usage: r.usage,
            icon: 'icons:build',
            items: []
        }),
    },

    report: {
        icon: 'icons:description',
        inject: 'если все пункты закрыты или пора отчитаться',
        prompt: ['Исходя из твоих размышлений выше, сформируй итоговый отчёт.',
            '\n\n[instruction]\n',
            'Что сделано, какие получены результаты и артефакты (только реальные), в формате md. Только факты из ленты, ничего не выдумывай.'].join('\n'),
        build: (r) => ({
            type: 'report',
            content: r.content,
            usage: r.usage,
            button: { label: 'Принять' },
            icon: 'icons:description',
        }),
    },

    complete: {
        inject: 'если считаешь, что текущая задача завершена',
        prompt: ['Сформируй краткий итог по текущей ветке.',
            '\n\n[instruction]\n',
            'Что было сделано в рамках текущей задачи, какой получен результат. Кратко, по фактам из ленты, в формате md.'].join('\n'),
        build: (r) => ({
            type: 'complete',
            content: r.content,
            usage: r.usage,
            button: { label: 'Завершить' },
        }),
    },
};