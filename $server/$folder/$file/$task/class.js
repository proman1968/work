// Линейный реестр PIPE (по id = type блока);
export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',
    async prompt(params = {}, post) {
        let { prompt, role, session } = params;
        params.block = await this._active_block();
        params.container = await this._active_container();
        params.pipe_step = PIPE[params.block.type] || PIPE.thinking;
        params.task = this;

        try {
            switch (role) {
                case 'AI':{
                    // не удалять
                } break;
                case 'APPROVE':{
                    this._stopped = false;
                    params.block.answer = prompt;
                    if (params.accept === true || params.accept === 'true') {
                        params.block.state = 'approved';
                        params.block.icon = 'icons:check';
                        await params.pipe_step.approve?.(params);
                    } else {
                        params.block.state = 'rejected';
                        params.block.icon = 'icons:close';
                    }
                    delete params.block.stop;
                    await this._save(session);
                } break;
                default:{
                    this._stopped = false;
                    if (params.container?.content)
                        delete params.container.content;
                    const pending = [...(params.container?.items || [])].reverse().find(b => typeof b.stop === 'string');
                    if (pending) {
                        pending.state = 'rejected';
                        pending.icon = 'icons:close';
                        delete pending.stop;
                    }
                    params.block = {
                        type: 'prompt',
                        content: prompt,
                    };
                    await this._push_block(params);
                }
            }
            params.block = await this._active_block();
            params.container = await this._active_container();
            params.pipe_step = PIPE[params.block.type] || PIPE.thinking;
            await params.pipe_step.recalc?.(params);
            params.block = await this._active_block();
            params.container = await this._active_container();
            params.pipe_step = PIPE[params.block.type] || PIPE.thinking;

            if (await params.pipe_step.run?.(params))
                return this._continue(params);

            const place = PIPE[params.container?.type];
            if (!params.container?.content && place?.done?.prompt && place.ready?.(params.container)) {
                const messages = await this.context({ prompt: place.done.prompt });
                const response = await this._streamChat({ messages, session });
                if (!this._stopped) {
                    params.container.content = response.content;
                    if (response.usage)
                        params.container.usage = response.usage;
                    await close_up(await this.body, params.container, params);
                }
                return this._continue(params);
            }

            let mode = containerMode(await this.body, params.container);
            let options = next_options(params.container, params.block, mode);
            if (!options.length) {
                session?.send?.({ type: 'chat.done', path: this.short });
                return { ok: true };
            }
            let messages, response, choice = '';
            if(options.length === 1) {
                choice = options[0];
            }
            else {
                let menu =  options.map(id => id.toUpperCase() + ' - ' + (PIPE[id]?.[mode]?.inject || PIPE[id]?.inject || 'пропустить'));
                if(menu.length > 0) 
                    menu.unshift('Выбери следующий, наиболее подходящий тип шага, не решай задачу целиком, ответь одним словом точно из списка без знаков препинания и пояснений:');

                menu.push('Если ни один вариант не подходит — ответь по существу.');
                menu = menu.join('\n');

                messages = await this.context({prompt: menu});
                response = await this._streamChat({ messages, silent: true, session });
                if (!this._stopped)
                    choice = response.content.trim().toLowerCase();
            }
            if (!this._stopped) {
                let next_pipe = options.includes(choice) ? PIPE[choice] : null;
                if (!next_pipe) {
                    choice = Object.keys(PIPE).find(id => PIPE[id].fallback);
                    next_pipe = PIPE[choice];
                }
                if (!next_pipe) {
                    session?.send?.({ type: 'chat.done', path: this.short });
                    return { ok: true };
                }

                params.block = {
                    type: choice,
                    icon: next_pipe.icon || 'carbon:idea',
                    stop: next_pipe.stop,
                    label: next_pipe.label,
                }
                if(next_pipe.container)
                    params.block.items = [];
                const sys = next_pipe[mode]?.system || next_pipe.system;
                if (sys)
                    params.block.system = sys;

                await this._push_block(params);
                prompt = next_pipe[mode]?.prompt || next_pipe.prompt;
                if(prompt){
                    messages = await this.context({prompt});
                    response = await this._fc_chat({ messages, session, fc: next_pipe.fc, block: params.block });
                    if (!this._stopped) {
                        Object.assign(params.block, response);
                        next_pipe?.parse?.(params.block);
                        await next_pipe?.recalc?.(params);
                        await close_up(await this.body, params.block, params);
                    }
                }
                if (!this._stopped) {
                    await this._save(session);
                    if (!params.block.stop) {
                        this.async(() => this.prompt({ role: 'AI', session }));
                        return { ok: true };
                    }
                }
            }
        }
        catch (e) {
            params.block = { type: 'error', content: e.message };
            await this._push_block(params);
        }

        session?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
    },
    async context(params = {}) {
        const {prompt} = params;
        const layers = [];
        let container = await this.body;
        for (;;) {
            layers.push(this._container_context(container));
            const next = container.items?.last;
            if (next?.items && !next.content) container = next;
            else break;
        }
        const mode = containerMode(await this.body, container);
        const modeLine = mode === 'do' ? 'Сейчас режим исполнения.' : 'Сейчас режим планирования.';
        const messages = [{ role: 'system', content: [...layers.map(l => l.system).filter(Boolean), modeLine].join('\n\n') }];
        const push = (nextRole, content) => {
            if (!content) return;
            if (messages.last?.role === nextRole) {
                if (nextRole === 'assistant')
                    messages.push({ role: 'user', content: 'продолжай' });
                else {
                    messages.last.content += '\n\n' + content;
                    return;
                }
            }
            messages.push({ role: nextRole, content });
        };
        for (const layer of layers)
            for (const m of layer.messages)
                push(m.role, m.content);
        if (prompt) {
            if (messages.last?.role === 'user')
                messages.last.content += '\n\n[instruction]\n' + prompt;
            else
                messages.push({ role: 'user', content: prompt });
        }
        return messages;
    },
    _container_context(container) {
        let system = container.system || '';
        if (container.todo)
            system += '\n\n[todo]\n' + (container.todo.content || '');
        const messages = [];
        for (const b of (container.items || [])) {
            messages.push({ role: PIPE[b.type]?.role || 'assistant', content: b.content });
            if (b.answer != null)
                messages.push({ role: 'user', content: typeof b.answer === 'string' ? b.answer : JSON.stringify(b.answer) });
        }
        return { system, messages };
    },
    async _streamChat(params = {}) {
        const {messages, functions, silent, session} = params;
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
                    session?.send?.({ type: 'chat.delta', path: this.short, token });
            }
        }
        return { content, usage, calls };
    },
    async _fc_chat(params = {}) {
        const { messages, session, fc, block } = params;
        if (!fc)
            return this._streamChat({ messages, session });
        const service = (await WORK.get_item(fc)) || WORK;
        const node = PIPE[block?.type];
        const schema = node?.schema || service.SCHEMA || {};
        const allow = node?.allow;
        const functions = Object.entries(schema)
            .filter(([name]) => !allow || allow.includes(name))
            .map(([name, spec]) => ({
                name,
                description: spec.description || '',
                parameters: spec.params || { type: 'object', properties: {} },
            }));
        if (block?.type === 'web') {
            block.icon = PIPE.web.do_icon;
            await this._save(session);
        }
        const calls = [];
        let content = '', usage = 0;
        const max = 5;
        for (let i = 0; i < max; i++) {
            const turn = await this._streamChat({ messages, functions, session, silent: true });
            if (this._stopped)
                return { content: block?.content || content, usage, calls };
            if (turn.usage)
                usage = turn.usage;
            if (!turn.calls?.length) {
                content = block?.content || turn.content || content;
                if (content)
                    session?.send?.({ type: 'chat.delta', path: this.short, token: content });
                return { content, usage, calls };
            }
            for (const call of turn.calls) {
                calls.push(call);
                const result = await this._fc_exec(service, call, { block, session });
                const payload = JSON.stringify(result ?? {});
                messages.push({
                    role: 'assistant',
                    content: '',
                    function_call: { name: call.method, arguments: call.args || {} },
                });
                messages.push({ role: 'function', name: call.method, content: payload });
                if (!content)
                    content = payload;
            }
        }
        const last = await this._streamChat({ messages, session });
        if (this._stopped)
            return { content: block?.content || content, usage, calls };
        if (last.content)
            content = last.content;
        if (last.usage)
            usage = last.usage;
        if (block?.content)
            content = block.content;
        return { content, usage, calls };
    },
    async _fc_exec(service, call, { block, session } = {}) {
        const args = call.args || {};
        if (call.method === 'search' && block?.type === 'web') {
            if (args.query)
                block.label = args.query;
            const result = await service.search?.(args);
            const seen = new Set();
            block.sites = [];
            for (const url of (result?.results || []).map(r => r.url).filter(Boolean)) {
                if (seen.has(url))
                    continue;
                seen.add(url);
                block.sites.push(url);
                if (block.sites.length >= WEB_SITES)
                    break;
            }
            await this._save(session);
            return result ?? {};
        }
        if (call.method === 'fetch_url' && block?.type === 'site') {
            const url = String(block.url || args.url || '').trim();
            const result = await service.fetch_url?.({ url });
            block.icon = siteFavicon(url);
            if (result?.error)
                block.state = 'error';
            block.content = result?.content || result?.error || '—';
            await this._save(session);
            return result ?? {};
        }
        if ((call.method === 'semantic_search' || call.method === 'find_text') && block?.type === 'search') {
            const query = String(args.prompt || args.text || '').trim();
            if (query)
                block.label = query;
            const result = await service[call.method]?.(args);
            block.content = formatFileHits(result);
            await this._save(session);
            return result ?? {};
        }
        if ((call.method === 'read_text' || call.method === 'load') && block?.type === 'read') {
            const path = String(args.path || block.path || '').trim();
            block.path = path;
            block.label = path || PIPE.read.label;
            try {
                const file = await WORK.get_item(path);
                if (!file)
                    throw new Error('файл не найден: ' + path);
                const text = await file.read_text();
                block.content = typeof text === 'string' && text.trim() ? text : '—';
            } catch (e) {
                block.state = 'error';
                block.content = shortError(e);
            }
            await this._save(session);
            return { path, content: block.content, error: block.state === 'error' ? block.content : undefined };
        }
        if (['save_file', 'save', 'edit'].includes(call.method) && block?.type === 'write') {
            const path = String(args.path || block.path || '').trim();
            try {
                if (call.method === 'save_file') {
                    const folder = path ? await WORK.get_item(path) : service;
                    const dest = [(folder.path || folder.short || path || '').replace(/\/$/, ''), args.filename].filter(Boolean).join('/');
                    await folder.save_file({ filename: args.filename, post: args.post, message: args.message });
                    block.path = dest;
                    block.label = dest;
                    block.content = 'записано: ' + dest;
                } else {
                    const file = await WORK.get_item(path);
                    await file[call.method]({ post: args.post });
                    block.path = path;
                    block.label = path;
                    block.content = (call.method === 'edit' ? 'правка: ' : 'записано: ') + path;
                }
            } catch (e) {
                block.state = 'error';
                block.content = e.message || '—';
            }
            await this._save(session);
            return { path: block.path, content: block.content, error: block.state === 'error' ? block.content : undefined };
        }
        return await service[call.method]?.(args);
    },
    get body(){
        return new AsyncPromise(async () =>{
            let raw = await  this.load();
            this.body = JSON.parse(raw);
            this.body.type ??= 'task';
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
        const {block, container, session} = params;
        block.time ??= Date.now();
        container.items.push(block);
        PIPE[block.type]?.recalc?.({ ...params, block, container });
        await this._save(session);
    },
    async _active_block() {
        let container = await this._active_container();
        const planned = container.todo?.steps || [];
        const real = (container.items || []).filter(b => b.type === 'step');
        if (planned.length && (real.some(s => !s.content) || real.length < planned.length))
            return container.todo;
        const items = container.items || [];
        const open = items.find(b => !b.content && !b.items);
        return open || items.last || container;
    },
    async _active_container() {
        let next,container = await this.body;
        while (next = container.items?.last){
            if(next.items && !next.content)
                container = next;
            else
                break;
        }
        return container;
    },
    async change_model(params = {}) {
        const model = params.model || params.post?.model;
        const session = params.session;
        if (!model) return { ok: false, error: 'model required' };
        (await this.body).model = model;
        await this._save(session);
        return { ok: true, model};
    },
    async _save(session){
        await WORK.fsp.writeFile(this.dir, JSON.stringify(this.body, null, 4), 'utf-8');
        session?.send?.({ path: this.short });
    },
    async _continue(params = {}) {
        const session = params.session;
        await this._save(session);
        if (!this._stopped)
            this.async(() => this.prompt({ role: 'AI', session }));
        return { ok: true };
    }
};


//-----------------------------------------------------------------------------


// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
const PIPE = {
    /** корень файла = контейнер task; меню plan/do — здесь, не у thinking */
    task: {
        container: true,
        plan: {
            next: ['thinking', 'explore', 'complete', /* 'planning', 'activation' */],
        },
        do: {
            next: ['thinking','explore', 'complete', /* 'execute', 'check' */],
        },
    },
    /** вход: блок prompt пушится вручную в prompt(); отсюда в площадку (настройка в её content) */
    prompt: {
        role: 'user',
        next: ['thinking'],
    },
    thinking: {
        label: 'Мысли',
        icon: 'carbon:idea',
        plan:{
            inject: 'если необходимо проанализировать и обдумать дальнейшие планы',
        },
        do:{
            inject: 'если необходимо проанализировать и обдумать дальнейшие действия',
        },
        prompt: [
            'Как следует подумай над тем, что необходимо сделать, исходя из текущего контекста.',
            'Не фантазируй, не выдумывай, ничего не делай, не пиши, не обращайся к пользователю, просто анализируй.',
            'Ответь в виде размышлений  от своего лица (5-10 строк, или если надо, больше)',
        ].join('\n'),
        recalc(params = {}) {
            delete params.block.state;
        },
    },
    activation: {
        label: 'Активация',
        icon: 'icons:check-box-outline-blank',
        inject: 'если необходимо перейти из режима планирования в режим выполнения',
        prompt: [
            'После активации ты перестанешь планировать и перейдешь к конкретным действиям над системой.',
            'Ты получишь доступ к файлам, сервисам, навыкам, функциям системы и к интернету для исполнения поставленной задачи.',
            '[instruction]',
            'СТРОГО в формате markdown:',
            'Расскажи пользователю, что ты собираешься делать, и убеди его в необходимости перехода в режим исполнения, нажатием кнопки "Перейти к действиям"',
            ].join('\n'),

        stop: 'Перейти к действиям',
        next: ['thinking'],
        approve(params = {}) {
            params.container.mode = 'do';
        }
    },
    text:{
        icon: 'icons:chat',
        stop: true,
        fallback: true,
    },
    todo:{
        next: ['step'],
        async recalc(params = {}) {
            const { container, task } = params;
            const body = await task.body;
            const owner = container.todo ? container : (body.todo ? body : null);
            const todo = owner?.todo;
            if (!todo) return;
            const real = (owner.items || []).filter(b => b.type === 'step');
            const lines = (todo.steps || []).map((s, i) => {
                const st = real[i];
                s.state = st?.content ? 'done' : (st ? 'in_progress' : (s.state || 'todo'));
                if (st) {
                    st.label = `${i + 1}. ${s.description}`;
                    st.state = s.state;
                    st.icon = s.state === 'done' ? 'icons:check-circle' : 'av:play-circle-outline';
                }
                return `${i + 1}. ${s.description} [${s.state}]`;
            });
            todo.content = (todo.label || '') + (lines.length ? '\n' + lines.join('\n') : '');
            owner.mode = 'do';
            const cur = real.find(s => !s.content) || real.last;
            if (cur)
                cur.system = [
                    todo.content,
                    '\n[instruction]',
                    `Сейчас только пункт "${cur.label}". Остальные уже в плане — не делай их и не спрашивай про них.`,
                ].join('\n');
            const total = (todo.steps || []).length;
            const done = (todo.steps || []).filter(s => s.state === 'done').length;
            todo.state = total ? `${done}/${total} ${PIPE.step.label}` : '';
        },
    },

    planning: {
        label: 'План',
        icon: 'icons:assignment',
        inject: 'если необходимо сделать несколько действий подряд',
        prompt: ['Предложи план:',
            '\n\n[instruction]\n',
            'СТРОГО в формате markdown:',
            'Краткое название плана работ.',
            'Пронумерованый список пунктов плана работ.',
        ].join('\n'),
        stop: 'Принять план',
        async approve(params = {}){
            let {container, block, prompt} = params;
            block.type = 'plan';
            let plan = parsePlanMarkdown(block.content);
            container.todo = {
                type: 'todo',
                icon: 'icons:list',
                ...plan,
            };
            const n = (container.todo.steps || []).length;
            container.todo.state = n ? `0/${n} ${PIPE.step.label}` : '';
            container.mode = 'do';
        }
    },

    /** шаг плана: заголовок = «N. описание» текущего in_progress, тело = items. */
    step: {
        label: 'Шаг',
        inject: 'если необходимо выполнить один очередной пункт плана',
        container: true,
        next: ['thinking'],
    },

    /** площадка исполнения: файлы, сервисы, FC; субагент в mode do */
    execute: {
        label: 'Выполнение',
        icon: 'enterprise:wrench',
        do_icon: 'spinners:pulse',
        inject: 'если необходимо выполнить конкретные действия над конкретными объектами, файлами, навыками',
        container: true,
        // next: ['work', 'web', 'form', 'html'],
        next: ['form'],
        prompt: [
            'Подумай, как выполнить текущую задачу: какие объекты, какие действия, в каком порядке.',
            'Не делай их и не обращайся к пользователю. Размышления от своего лица в content.',
        ].join('\n'),
        recalc(params = {}) {
            params.block.mode = 'do';
            params.block.state = childRollup(params.block, ['web', 'site', 'form', 'work']);
        },
    },

    explore: {
        label: 'Обзор',
        icon: 'icons:search',
        do_icon: 'spinners:pulse',
        inject: 'если нужно выяснить факты (обзор, справка), не меняя систему',
        system: [
            'Подумай, что именно выяснить и откуда взять факты, чтобы продолжить работу.',
        ].join('\n'),
        container: true,
        next: ['thinking', /* 'work',  */'web', 'form'],
        ready: exploreReady,
        done: {
            prompt: [
                'Обобщи, что выяснено в этом обзоре.',
                'Только факты из ленты (web, site, work, search, read). Кратко, без выдумок и без обращения к пользователю.',
            ].join('\n'),
        },
        recalc(params = {}) {
            params.block.mode = params.container.mode || params.block.mode || 'plan';
            params.block.state = childRollup(params.block, ['web', 'work']);
        },
    },
    work: {
        label: 'Рабочая область',
        icon: 'icons:folder',
        container: true,
        plan: {
            inject: 'если необходимо найти файлы или информацию в рабочей области',
            next: ['search', 'read'],
        },
        do: {
            inject: 'если необходимо сделать действия над файлами в рабочей области',
            next: ['search', 'read', 'write'],
        },
        system: [
            'Подумай, какие именно действия над файлами необходимо выполнить.',
        ].join('\n'),
        ready: workReady,
        done: {
            prompt: [
                'Обобщи только то, что найдено, прочитано или записано в блоках search, read и write.',
                'Кратко, по фактам, без выдумок.',
            ].join('\n'),
        },
        recalc(params = {}) {
            params.block.state = childRollup(params.block, ['search', 'read', 'write']);
        },
    },
    includes: {
        label: 'Вложения',
        icon: 'icons:attachment',
        container: true,
        ready: includesReady,
        done: {
            prompt: [
                'Обобщи только то, что прочитано во вложениях (блоки file).',
                'Кратко, по фактам, без выдумок.',
            ].join('\n'),
        },
        recalc(params = {}) {
            const files = (params.block.items || []).filter(x => x.type === 'file');
            const seen = files.filter(x => x.content).length;
            params.block.state = files.length ? `${seen}/${files.length} ${PIPE.file.label}` : '';
        },
    },
    file: {
        label: 'Файл',
        icon: 'icons:description',
        async run(params = {}) {
            const b = params.block;
            if (!b.path || b.content) return false;
            await fillFileContent(b);
            await close_up(await params.task.body, b, params);
            return true;
        },
    },
    search: {
        label: 'Поиск',
        icon: 'icons:search',
        inject: 'если нужно найти файлы в рабочей области',
        fc: '/',
        allow: ['semantic_search', 'find_text'],
        schema: {
            semantic_search: {
                description: 'Семантический поиск файлов. Результат — список путей.',
                params: {
                    type: 'object',
                    properties: {
                        prompt: { type: 'string', description: 'О чём искать' },
                    },
                    required: ['prompt'],
                },
            },
            find_text: {
                description: 'Поиск по содержимому файлов (grep). Результат — путь, строка, фрагмент.',
                params: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: 'Текст или подстрока' },
                        ext: { type: 'string', description: 'Расширение без точки' },
                        limit: { type: 'number', description: 'Макс. число совпадений' },
                    },
                    required: ['text'],
                },
            },
        },
        system: [
            'Найди файлы одним вызовом semantic_search({prompt}) или find_text({text}).',
            'Не читай и не меняй файлы.',
        ].join('\n'),
        prompt: [
            'Вызови инструмент поиска по текущей задаче. Не выдумывай пути.',
        ].join('\n'),
    },
    read: {
        label: 'Файл',
        icon: 'icons:description',
        inject: 'если нужно прочитать конкретный файл по пути',
        fc: '/',
        allow: ['read_text'],
        schema: {
            read_text: {
                description: 'Прочитать текст файла по пути WORK (utf-8 или извлечение из office/pdf).',
                params: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Абсолютный путь файла в WORK' },
                    },
                    required: ['path'],
                },
            },
        },
        system: [
            'Прочитай один файл вызовом read_text({path}).',
            'Путь — из ленты (search) или запроса. Не выдумывай.',
        ].join('\n'),
        prompt: [
            'Вызови read_text с путём файла, который нужно прочитать.',
        ].join('\n'),
    },
    write: {
        label: 'Запись',
        icon: 'editor:mode-edit',
        inject: 'если нужно записать или поправить файл',
        fc: '/',
        allow: ['save_file', 'save', 'edit'],
        schema: {
            save_file: {
                description: 'Создать или перезаписать файл в папке. Новый файл — save_file.',
                params: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Папка, в которую писать' },
                        filename: { type: 'string', description: 'Имя файла' },
                        post: { type: 'string', description: 'Полное содержимое' },
                        message: { type: 'string', description: 'Текст для лога' },
                    },
                    required: ['filename', 'post'],
                },
            },
            save: {
                description: 'Перезаписать существующий файл целиком.',
                params: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Путь файла' },
                        post: { type: 'string', description: 'Новое содержимое' },
                    },
                    required: ['path', 'post'],
                },
            },
            edit: {
                description: 'Точечная правка SEARCH/REPLACE существующего файла.',
                params: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Путь файла' },
                        post: { type: 'string', description: 'Блоки SEARCH/REPLACE' },
                    },
                    required: ['path', 'post'],
                },
            },
        },
        system: [
            'Измени файлы одним вызовом save_file, save или edit.',
            'Не выдумывай пути. Новый файл — save_file, существующий целиком — save, фрагмент — edit.',
        ].join('\n'),
        prompt: [
            'Вызови инструмент записи для текущего шага.',
        ].join('\n'),
    },
    check:{
        label: 'Проверка',
        icon: 'icons:check-circle',
        do_icon: 'spinners:pulse',
        inject: 'если нужно сверить результат с целью, прежде чем закрыть ветку',
        system: [
            'Это площадка проверки, не исполнение и не план.',
            'Сверь критерий готовности (запрос / текущий пункт todo / обещание ветки) с доказательствами.',
            'Если фактов в ленте мало — смотри файлы и систему (work) или интернет (web). Не меняй систему.',
            'Когда доказательств достаточно — вердикт.',
        ].join('\n'),
        container: true,
        next: ['work', 'web', 'thinking', 'verdict'],
        done: { next: ['complete'] },
        recalc(params = {}) {
            params.block.mode = 'do';
            params.block.state = childRollup(params.block, ['work', 'web', 'site']);
        },
    },
    verdict: {
        label: 'Вердикт',
        icon: 'icons:assignment-turned-in',
        inject: 'если доказательств достаточно — вынести вердикт ok или fail',
        prompt: [
            'Сверь критерий готовности (запрос / текущий пункт todo / обещание ветки) с доказательствами из ленты и прочитанных файлов.',
            'Не планируй и не обращайся к пользователю.',
            '[instruction]',
            'СТРОГО:',
            'готово: …',
            'не хватает: …',
            'итог: ok  или  fail',
        ].join('\n'),
        parse(block) {
            const m = String(block.content || '').match(/итог:\s*(ok|fail)/i);
            block.verdict = m ? m[1].toLowerCase() : 'fail';
        },
        recalc(params = {}) {
            if (params.block.verdict)
                params.block.state = params.block.verdict;
            if (params.block.verdict !== 'ok') return;
            params.container.content = params.block.content;
        },
    },

    web: {
        label: 'Интернет',
        icon: 'icons:language',
        do_icon: 'spinners:pulse',
        fc: '/SERVICES/SearXNG',
        allow: ['search'],
        container: true,
        next: ['site'],
        ready: webQueueDone,
        async run(params = {}) {
            const b = params.block;
            if (b.content || b.sites != null) return false;
            const query = webQuery(b, await params.task.body);
            const service = await WORK.get_item(PIPE.web.fc);
            await params.task._fc_exec(service, { method: 'search', args: { query } }, {
                block: b,
                session: params.session,
            });
            b.sites ??= [];
            await webPushNext(b, params);
            await PIPE.web.recalc?.(params);
            return true;
        },
        done: {
            prompt: [
                'Обобщи только то, что прочитано на страницах site.',
                'Кратко, по фактам, без выдумок.',
            ].join('\n'),
        },
        plan: {
            inject: 'если необходимо найти информацию в интернете',
            system: [
                'Найди ссылки одним вызовом search({query}).',
                'Не читай страницы — заход сделают блоки site.',
            ].join('\n'),
        },
        do: {
            inject: 'если необходимо выполнить конкретные действия в интернете',
            system: [
                'Найди рабочие ссылки одним вызовом search({query}) — то, что нужно сделать сейчас.',
                'Не читай страницы — заход сделают блоки site.',
            ].join('\n'),
        },
        recalc(params = {}) {
            const b = params.block;
            const found = (b.sites || []).length;
            const seen = (b.items || []).filter(x => x.type === 'site' && x.content).length;
            b.state = found ? `${seen}/${found} ${PIPE.site.label}` : '';
            b.icon = b.content ? PIPE.web.icon : PIPE.web.do_icon;
        },
    },
    site: {
        label: 'Сайт',
        icon: 'icons:language',
        fc: '/SERVICES/SearXNG',
        allow: ['fetch_url'],
        async run(params = {}) {
            const b = params.block;
            if (!b.url || b.content) return false;
            const service = await WORK.get_item(PIPE.web.fc);
            await params.task._fc_exec(service, { method: 'fetch_url', args: { url: b.url } }, {
                block: b,
                session: params.session,
            });
            await webPushNext(params.container, params);
            await close_up(await params.task.body, b, params);
            return true;
        },
        recalc(params = {}) {
            if (params.block.state !== 'error')
                delete params.block.state;
        },
    },

    form: {
        label: 'Форма',
        icon: 'icons:view-list',
        inject: 'если нужно выяснить у пользователя сразу несколько вопросов (два и больше) — не текстом',
        prompt: [
            'Сначала один fenced-блок html (внутри form и fieldset). После блока — пояснение (1–10 слов).',
            'Пояснение — только текст после html, не legend и не fieldset. Не пересказывай эту инструкцию.',
            'Тема полей — запрос в ленте, не профиль и не рабочая группа.',
            'Только поля, без которых нельзя идти дальше. Лишнего не спрашивай.',
            'Выбор — только select: готовые варианты + пункт «Другое» и сразу input text со своим name. Не radio, не checkbox, не select multiple, не text с «например».',
            'Свободный text/textarea — только у поля «Другое» и у скаляра (число, дата, деньги).',
            'Раскладка: один legend на fieldset — человеческое имя поля, не путь и не /id. Legend группы («Общие данные») не заменяет имена полей.',
            'В fieldset один select — label не нужен, смысл в legend. Рядом input «Другое» — свой name и label. Несколько полей — вложенный fieldset со своим legend.',
            'Не дублируй legend строкой p/h1–h6. Fieldset в ряд не ставь.',
            'Подсказка и единица — в placeholder.',
            'У каждого контрола свой name. legend и label могут начинаться с эмодзи или символа. Никаких customElements. Не заменяй контрол ul/li.',
            'Домен (сначала это):',
            '- перечислимый — select + «Другое» + input, не text;',
            '- открытый — тоже select типичных ответов + «Другое» + input, не голый textarea;',
            '- скаляр — число, дата, деньги: number/date, не список названий.',
            'Вид скаляра:',
            '- целое — type=number inputmode=numeric step=1;',
            '- дробь — type=number inputmode=decimal step под единицу (0.1);',
            '- деньги — type=number inputmode=numeric step=1 или 1000, единица в placeholder (₽);',
            '- дата/время/email/tel/url — свой type + autocomplete.',
            'min/max — только реальный диапазон. maxlength на number запрещён.',
            'required — на каждом поле, без которого нельзя идти дальше.',
            'Маски — только HTML-атрибутами, без script.',
            'Без script, html/body, кнопки отправки.',
        ].join('\n'),
        /** после стрима: разметка в html, хвост — пояснение в content */
        parse(block) {
            const { content, html } = parseFormHtml(block.content);
            block.content = content;
            block.html = html;
        },
        async approve(params = {}) {
            const { block, prompt } = params;
            const answers = typeof prompt === 'string' ? JSON.parse(prompt) : (prompt || {});
            block.answer = answers;
            block.state = 'submitted';
            block.approved = formatFormAnswers(answers);
        },
        stop: 'Отправить форму',
    },

    html: {
        label: 'HTML',
        icon: 'editor:code',
        inject: 'если нужно сделать одностраничное HTML-приложение (схема, игра, виджет, интерактив)',
        prompt: [
            'Собери одностраничное HTML-приложение для запуска внутри ленты чата в iframe.',
            '[instruction]',
            'Только один fensed-блок с полным html-кодом, без дополнительных пояснений.',
        ].join('\n'),
        parse(block) {
            const fence = block.content.match(/```(?:html|htm)?\s*([\s\S]*?)```/i);
            if (fence) {
                block.content = fence[1].trim();
            }
        },
        stop: true,
    },
    complete: {
        label: 'Завершение',
        inject: 'если считаешь, что текущая задача (шаг) завершена',
        prompt: [
            'Отдай пользователю итог задачи.',
            'Не пересказывай процесс. Включи результат из ленты: факты, списки, таблицы.',
            'Не выдумывай. Формат md.',
        ].join('\n'),
        stop: 'Принять',
        async approve(params = {}) {
            const { container, block, prompt } = params;
            if (prompt) {
                block.state = 'rejected';
                block.icon = 'icons:close';
                block.content = (block.content || '') + '\n\nИТОГ ОТКЛОНЕН, ' + prompt;
                return;
            }
            block.state = 'approved';
            container.content = block.content;
        }
    },
};
function next_options(container, block, mode) {
    if (container?.content)
        return [];
    const node = PIPE[block?.type];
    const own = node?.[mode]?.next || node?.next;
    const place = PIPE[container?.type];
    const parentNext = place?.[mode]?.next || place?.next || [];
    let options;
    if (block?.content && node?.container)
        options = node.done?.next?.length ? node.done.next : parentNext;
    else if (own?.length)
        options = own;
    else
        options = parentNext;
    const prev = block?.type;
    if (prev && !PIPE[prev]?.container)
        options = options.filter(id => id !== prev);
    const items = container?.items || [];
    return options.filter(id => !PIPE[id]?.container || !items.some(s => s.type === id && s.content));
}

function siteFavicon(url) {
    try {
        return 'https://icons.duckduckgo.com/ip3/' + new URL(url).hostname + '.ico';
    } catch {
        return 'icons:language';
    }
}

function childRollup(block, types) {
    const counts = {};
    const walk = (n) => {
        for (const x of n?.items || []) {
            counts[x.type] = (counts[x.type] || 0) + 1;
            walk(x);
        }
    };
    walk(block);
    return types.filter(t => counts[t]).map(t => `${counts[t]} ${PIPE[t]?.label || t}`).join(' · ');
}

const WEB_SITES = 3;

async function webPushNext(web, params) {
    if (!web || web.content || web.sites == null)
        return false;
    web.items ??= [];
    const items = web.items.filter(x => x.type === 'site');
    if (items.some(s => !s.content))
        return false;
    const next = web.sites.find(url => !items.some(s => s.url === url));
    if (!next || !params.task)
        return false;
    await params.task._push_block({
        block: { type: 'site', url: next, label: next, icon: siteFavicon(next) },
        container: web,
        session: params.session,
    });
    return true;
}

async function close_up(root, node, params) {
    let n = node;
    while (n) {
        await PIPE[n.type]?.recalc?.({ ...params, block: n, container: parentOf(root, n) || n });
        n = parentOf(root, n);
    }
}

function containerMode(root, node) {
    let n = node;
    while (n) {
        if (n.mode)
            return n.mode;
        n = parentOf(root, n);
    }
    return 'plan';
}

function webQueueDone(b) {
    if (!b || b.sites == null)
        return false;
    const items = (b.items || []).filter(x => x.type === 'site');
    if (items.some(s => !s.content))
        return false;
    return !b.sites.some(url => !items.some(s => s.url === url));
}

function exploreReady(b) {
    const kids = b?.items || [];
    if (!kids.length || kids.some(k => !k.content))
        return false;
    return kids.some(k => k.type === 'web' || k.type === 'work');
}

function workReady(b) {
    const kids = b?.items || [];
    if (!kids.length || kids.some(k => !k.content))
        return false;
    return kids.some(k => k.type === 'read' || k.type === 'write');
}

function includesReady(b) {
    const kids = (b?.items || []).filter(x => x.type === 'file');
    return kids.length > 0 && kids.every(k => k.content);
}

function shortError(e) {
    return String(e?.message || e || '—').split('\n')[0].slice(0, 200);
}

async function fillFileContent(block) {
    const path = String(block.path || '').trim();
    block.label = block.label || path;
    try {
        const file = await WORK.get_item(path);
        if (!file)
            throw new Error('файл не найден: ' + path);
        const text = await file.read_text();
        block.content = typeof text === 'string' && text.trim() ? text : '—';
    } catch (e) {
        block.state = 'error';
        block.content = shortError(e);
    }
}

function formatFileHits(result) {
    const items = Array.isArray(result) ? result : [];
    if (!items.length)
        return 'Ничего не найдено';
    return items.map(r => {
        const path = r.path || r.name || '';
        const extra = r.line != null ? ':' + r.line : '';
        const snip = r.text ? ' — ' + String(r.text).trim().slice(0, 200) : '';
        return '- ' + path + extra + snip;
    }).join('\n');
}

function webQuery(web, body) {
    if (web?.label && web.label !== PIPE.web.label)
        return web.label;
    const asked = String((body.items || []).find(b => b.type === 'prompt')?.content || body.title || '').trim();
    if (asked)
        return asked;
    const parent = parentOf(body, web) || body;
    const think = [...(parent.items || [])].reverse().find(b => b.type === 'thinking' && b.content);
    const line = String(think?.content || '').split('\n').map(s => s.trim()).find(Boolean);
    return (line || '').slice(0, 160);
}

function parentOf(root, node) {
    if (!root || !node || root === node) return null;
    for (const b of (root.items || [])) {
        if (b === node) return root;
        const p = parentOf(b, node);
        if (p) return p;
    }
    return null;
}


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
            state: 'todo',
            icon: 'icons:radio-button-unchecked',
        })),
    };
}

/** Разметка сначала → html; хвост после неё → пояснение. script / oda-icon / button / submit не храним. */
function parseFormHtml(text = '') {
    const raw = String(text ?? '');
    let html = '';
    let content = '';
    const fence = raw.match(/```(?:html|htm)?\s*([\s\S]*?)```/i);
    if (fence) {
        html = fence[1].trim();
        content = raw.slice(fence.index + fence[0].length).trim();
    } else {
        const form = raw.match(/<form\b[\s\S]*<\/form>/i);
        if (form) {
            html = form[0].trim();
            content = raw.slice(form.index + form[0].length).trim();
        } else {
            const start = raw.search(/<fieldset\b/i);
            if (start >= 0) {
                const from = raw.slice(start);
                const close = from.toLowerCase().lastIndexOf('</fieldset>');
                html = (close >= 0 ? from.slice(0, close + 11) : from).trim();
                content = (close >= 0 ? from.slice(close + 11) : '').trim();
            } else if (/^\s*</.test(raw)) {
                html = raw.trim();
            } else {
                content = raw.trim();
            }
        }
    }
    html = html
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<oda-icon\b[^>]*(?:\/>|>[\s\S]*?<\/oda-icon>)/gi, '')
        .replace(/<button\b[\s\S]*?<\/button>/gi, '')
        .replace(/<input\b[^>]*\btype\s*=\s*["']?(?:submit|button|reset)["']?[^>]*>/gi, '')
        .trim();
    content = content
        .replace(/^\s*\[(?:mode|instruction)\][^\n]*\n?/gim, '')
        .split('\n')
        .filter(line => !/собрать?\s+html-форму/i.test(line))
        .join('\n')
        .trim();
    return { content, html };
}

function formatFormAnswers(answers = {}) {
    const lines = ['[form answers]'];
    for (const id of Object.keys(answers || {})) {
        const v = answers[id];
        lines.push(`${id}: ${v == null || v === '' ? '—' : String(v)}`);
    }
    return lines.join('\n');
}