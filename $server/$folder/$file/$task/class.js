// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
const PIPE = {
    /** вход: блок prompt пушится вручную в prompt(); отсюда auto-переход в thought */
    prompt: {
        role: 'user',
        plan:{
            next: ['thought'],
        },
        do:{
            next: ['thought'],
        },
    },
    text:{

    },
    todo:{
        do:{
            next: ['step'],
        },
    },
    thought: {
        icon: 'carbon:idea',
        plan:{
            next: ['planning', 'show_form', 'research', 'thought'],
        },
        do:{
            next: ['do', 'complete', 'thought'],
        },
        inject: 'если необходимо обдумать дальнейшие действия',
        prompt: [
            'Как следует подумай над тем, что необходимо сделать на текущем шаге плана.',
            'Выдай свои размышления кратко (2-5 строк. если надо, больше) от своего лица.',
            'Не фантазируй. В конце реши, какое действие нужно выполнить следующим.',
        ].join(' '),
    },
    planning: {
        icon: 'icons:assignment',
        inject: 'если необходимо сделать несколько действий подряд, сначала надо согласовать план с пользователем',
        prompt: ['Исходя из размышлений выше, предложи план работ по запросу пользователя:',
            'Заголовок: Краткое название плана работ.',
            'Содерэание: пронумерованый список пунктов плана работ.',
        ].join('\n'),
        allow_approve: 'Принять план',
        async approve(params = {}){
            const {container, block, prompt} = params;
            switch(prompt){
                case 'true':{
                    const text = block.content || '';
                    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
                    const numbered = lines.filter(l => /^\d+\.\s+\S/.test(l));
                    const bullets = lines.filter(l => /^[-*•]\s+\S/.test(l));
                    const titleLine = lines.find(l => !/^\d+\.\s*/.test(l) && !/^[-*•]\s/.test(l));
                    const src = numbered.length ? numbered : bullets;
                    container.todo = {
                        type: 'todo',
                        icon:'icons:list',
                        status: 'in_progress',
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
                            let content = this.label + '\n';
                            content += this.steps.map(s => `[id: ${s.number}] ${s.description} [status: "${s.status}"]`).join('\n');
                            return content;
                        }
        
                    }
                    container.items.remove(block);
                    container.mode = 'do';
                    return container.todo;
                } break;
                return block;
            }
        },
        plan:{
            next: [],
        }
    },

    /** шаг плана: заголовок = «N. описание» текущего in_progress, тело = items. */
    step: {
        icon: 'icons:radio-button-unchecked',
        role: 'user',
        inject: 'если необходимо выполнить один пункт плана',
        prompt: ['Выполни текущий пункт плана (со статусом in_progress) из последнего task-блока в ленте.',
            'Ровно одно действие. По завершении — подтверди кнопкой «Завершить» (узел complete).'].join('\n'),
        items: [],
        do:{
            next: ['thought'],
        },
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
        next: ['thought'],
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
        let block = await this._active_block();
        let container = await this._active_container();
        let pipe_step = PIPE[block.type] || PIPE.thought;
        
        Object.assign(params, {block, container, pipe_step, task: this});
        try {
            switch (role) { 
                case 'AI':{
                    // не удалять, пока не переделаем на новый алгоритм
                } break;
                case 'APPROVE':{
                    params.block = await params.pipe_step.approve(params);  
                    await this._save(user);                    
                } break;
                default:{
                    params.block = {
                        type: 'prompt',
                        content: prompt,
                    };
                    await this._push_block(params);
                }
            }
            

            pipe_step = PIPE[params.block.type];
            let mode = container.mode || 'plan';
            let options = pipe_step?.[mode]?.next || [];
            let menu = 'Выбери следующий, наиболее подходящий тип шага, не решай задачу целиком, ответь одним словом точно из списка без знаков препинания и пояснений:';
            for (let id of options) menu += '\n' + id.toUpperCase() + ' - ' + (PIPE[id]?.inject || '') + ';';
            menu += '\nНо если пользователь перед этим просто задал вопрос, просто ответь на него, или сам задай вопрос, если что-то непонятно.';
            let messages = await this.collect_context({prompt: menu});

 

            let response = await this._streamChat({ messages, silent: true, user });
            if (this._stopped) return;
            let choice = response.content.trim().toLowerCase();
  
            let next_pipe = PIPE[choice];
            if(!next_pipe){
                choice = 'text'
                next_pipe = PIPE[choice];
            }

            params.block = {
                type: choice,
                icon: next_pipe.icon || 'carbon:idea',
                stop: !next_pipe.plan && !next_pipe.do
            }
            messages = await this.collect_context({prompt: next_pipe.prompt});
            await this._push_block(params);
            response = await this._streamChat({messages, user});
            if (this._stopped) return;
            Object.assign(params.block, response);
            params.block.items = next_pipe.items;
            await this._save(user);
            if(next_pipe.allow_approve){
                let prompt_inject = [`Требуется действие "${next_pipe.allow_approve}". Прими решение и ответь одним словом:`,
                    'YES - если для согласования необходим пользователь;',
                    'NO - если ты берешь решение самостоятельно;'].join('\n');
                messages = await this.collect_context({prompt: prompt_inject});
                response = await this._streamChat({messages, user});
                if (this._stopped) return;
                if(response.content.trim().toLowerCase() === 'yes'){
                    params.block.button = { label: next_pipe.allow_approve };       
                    await this._save(user);          
                }
               
                if(!params.block.button){
                    this.async(() => this.prompt({ role: 'APPROVE', user, prompt: 'true' }));
                }
            }
            else if (!params.block.stop) {
                this.async(() => this.prompt({ role: 'AI', user }));
            } 
        }
        catch (e) {
            params.block = { type: 'error', content: e.message };
            await this._push_block(params.block);
        }

        user?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
    },
    async collect_context(params = {}) {
        const {prompt} = params;
        const container = await this._active_container();
        let system = container.system || '';
        if (container.todo)
            system += '\n\n[todo]\n' + (container.todo.content || '');
        let role = 'system';
        const messages = [{ role, content: system }];
        for (const b of (container.items || [])) {
            role = PIPE[b.type]?.role || 'assistant';
            if (messages.last?.role === role)
                messages.last.content += '\n\n' + b.content;
            else
                messages.push({role, content: b.content });
        }
        if(prompt){
            if(messages.last?.role === 'user')
                messages.last.content += '\n\n[instruction]\n' + prompt;
            else
                messages.push({ role: 'user', content: prompt});         
        }
        return messages;
    },    
    async _streamChat(params = {}) {
        const {messages, functions, silent, user} = params;
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
    async _push_block(params = {}){
        const {block, container, user} = params;
        block.time ??= Date.now();
        container.items.push(block);
        await this._save(user);
    },
    async _active_block() {
        let container = await this._active_container();
        if(container.todo?.status === 'in_progress')
            return container.todo;
        return container.items.last || container;
    },
    async _active_container() {
        let next,container = await this.body;
        while (next = container.items?.last){
            if(next.items && !next.ready)
                container = next;
            else
                break;
        }
        return container;
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
