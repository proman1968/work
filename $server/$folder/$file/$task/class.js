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
            'Как следует подумай над тем, что необходимо сделать, исходя из текущего контекста.',            
            'Не фантазируй, не выдумывай, просто планируй дальнейшие действия.',
            'Ответь в виде размышлений  от своего лица (5-10 строк, или если надо, больше)',
        ].join('\n'),
    },
    planning: {
        icon: 'icons:assignment',
        inject: 'если необходимо сделать несколько действий подряд',
        prompt: ['Предложи план:',
            '\n\n[instruction]\n',
            'СТРОГО в формате markdown:',
            'Краткое название плана работ.',
            'Пронумерованый список пунктов плана работ.',
        ].join('\n'),
        allow_approve: 'Принять план',
        async approve(params = {}){
            let {container, block, prompt} = params;
            block.type = 'thought';
            delete block.button;
            switch(prompt){
                case 'true':{
                    let plan = parsePlanMarkdown(block.content);
                    container.todo = {
                        type: 'todo',
                        icon:'icons:list',
                        status: 'in_progress',
                        ...plan,
                        get content() {
                            let steps = (container.items || []).filter(b => b.type === 'step');
                            const lines = this.steps.map((s, i) => {
                                let step = steps[i];
                                let label = `${i + 1}. ${s.description}`;
                                if(step){
                                    step.label = label;
                                    s.status = step.status = (step.ready) ? 'done' : 'in_progress';
                                    s.icon = step.icon = step.status === 'done' ? 'icons:check-circle' : 'av:play-circle-outline';
                                    return label + ` [${step.status}]`;

                                }
                                return label + ' [todo]';
                            });
                            return this.label + '\n' + lines.join('\n');
                        }
        
                    }
                    container.mode = 'do';
                    block.content += '\n\nПЛАН ПРИНЯТ! НАЧИНАЕМ ВЫПОЛЕНИЕ';
                    block.status = 'approved';
                    block = container.todo;
                } break;
                case 'false':{
                    block.status = 'rejected';
                    block.content += '\n\nПЛАН ОТВЕРГНУТ, ТРЕБУЕТСЯ ПЕРЕПЛАНИРОВКА';
                } break;
                default:{
                    block.status = 'to modify';
                    block.content += '\n\nПЛАН ОТВЕРГНУТ, ' + prompt;
                }
            }
            return block;
        },
        plan:{
            next: [],
        }
    },

    /** шаг плана: заголовок = «N. описание» текущего in_progress, тело = items. */
    step: {
        inject: 'если необходимо выполнить один пункт плана',
        container: true,
        plan:{
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
            let messages, response, choice = '';
            if(options.length === 1) {
                choice = options[0];
            }
            else {
                let menu = 'Выбери следующий, наиболее подходящий тип шага, не решай задачу целиком, ответь одним словом точно из списка без знаков препинания и пояснений:';
                for (let id of options) menu += '\n' + id.toUpperCase() + ' - ' + (PIPE[id]?.inject || '') + ';';
                menu += '\nНо если пользователь перед этим просто задал вопрос, просто ответь на него, или сам задай вопрос, если что-то непонятно.';
                messages = await this.collect_context({prompt: menu});
    
                response = await this._streamChat({ messages, silent: true, user });
                if (this._stopped) return;
                choice = response.content.trim().toLowerCase();  
            }
            let next_pipe = PIPE[choice];
            if(!next_pipe){
                choice = 'text'
                next_pipe = PIPE[choice];
            }

            block = {
                type: choice,
                icon: next_pipe.icon || 'carbon:idea',
                stop: !next_pipe.plan && !next_pipe.do,
            }  
            if(next_pipe.allow_approve){
                block.button = { label: next_pipe.allow_approve };
            }
            if(next_pipe.container){
                block.items = [];
            }    
            params.block = block; 
            await this._push_block(params);                           
            if(next_pipe.prompt){
                messages = await this.collect_context({prompt: next_pipe.prompt});
                response = await this._streamChat({messages, user});
                if (this._stopped) return;
                Object.assign(params.block, response);
                this._save(user);
            }
            
            if (!params.block.stop && !params.block.button) {
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
function parsePlanMarkdown(text = '') {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    // заголовок: первый ATX (#..) или жирная строка, иначе первая не-списочная
    let label = '';
    for (const raw of lines) {
        const t = raw.trim();
        if (!t) continue;
        const h = t.match(/^#{1,6}\s+(.+)$/);
        if (h) { label = h[1]; break; }
        const b = t.match(/^\*\*(.+?)\*\*\s*$/);
        if (b) { label = b[1]; break; }
        if (!/^(\d+[.)]\s+|[-*•]\s+)/.test(t)) { label = t; break; }
    }
    label = label.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
    // пункты: только top-level (без ведущих пробелов), numbered предпочтительнее bullets
    const itemRe = /^(?:(\d+)[.)]\s+|([-*•])\s+)(.+?)\s*$/;
    const numbered = [], bullets = [];
    for (const raw of lines) {
        if (/^\s/.test(raw) && raw.trim()) continue; // вложенные — пропуск
        const m = raw.trim().match(itemRe);
        if (!m || !m[3]) continue;
        const description = m[3].replace(/\*\*/g, '').trim();
        if (!description) continue;
        (m[1] ? numbered : bullets).push(description);
    }
    const descriptions = numbered.length ? numbered : bullets;
    return {
        label: label || descriptions[0] || '',
        steps: descriptions.map((description, i) => ({
            number: i + 1,
            description,
            status: 'todo',
            icon: 'icons:radio-button-unchecked',
        })),
    };
}