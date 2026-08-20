// Линейный реестр PIPE (по id = type блока);
export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',
    async prompt(params = {}, post) {
        
        // debugger;
        let { prompt, role, session } = params;
        keepHere(session, params.here);
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
                    const text = String(prompt ?? '').trim();
                    if (text) {
                        params.block = {
                            type: 'prompt',
                            content: text,
                        };
                        await this._push_block(params);
                    }
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

            if (params.pipe_step.prompt && !params.block.content && !params.pipe_step.container) {
                if (await this._pipe_stream(params) && !this._stopped && !params.block.stop)
                    return { ok: true };
            }
            else {
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

                messages = await this.context({prompt: menu, session});
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

                await this._push_block(params);
                params.pipe_step = next_pipe;
                if (next_pipe.run) {
                    await this._save(session);
                    if (!params.block.stop)
                        this.async(() => this.prompt({ role: 'AI', session }));
                    return { ok: true };
                }
                if (await this._pipe_stream(params) && !this._stopped && !params.block.stop)
                    return { ok: true };
                if (next_pipe.container && !params.block.stop) {
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
        const modeLine = mode === 'do' ? 'Сейчас ты в режиме исполнения.' : 'Сейчас ты в режиме планирования.';
        const messages = [{ role: 'system', content: [...layers.map(l => l.system).filter(Boolean), hereNow(params.session), modeLine].filter(Boolean).join('\n\n') }];
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
    async _pipe_stream(params = {}) {
        const { session, block } = params;
        const pipe = params.pipe_step || PIPE[block?.type];
        const mode = containerMode(await this.body, params.container);
        const text = (pipe.close && PIPE[params.container?.type]?.close_prompt)
            || pipe[mode]?.prompt
            || pipe.prompt;
        if (!text)
            return false;
        const messages = await this.context({ prompt: text, session });
        const response = await this._streamChat({ messages, session });
        if (!this._stopped) {
            Object.assign(block, response);
            pipe.parse?.(block);
            await pipe.recalc?.(params);
            await close_up(await this.body, block, params);
            await this._save(session);
            if (!block.stop)
                this.async(() => this.prompt({ role: 'AI', session }));
        }
        return true;
    },
    _container_context(container) {
        const node = PIPE[container.type];
        const mode = container.mode || 'plan';
        let system = node?.[mode]?.system || node?.system || container.system || '';
        if (container.todo)
            system += '\n\n[todo]\n' + (container.todo.content || '');
        const messages = [];
        for (const b of (container.items || [])) {
            if (PIPE[b.type]?.close)
                continue;
            messages.push({ role: PIPE[b.type]?.role || 'assistant', content: b.content || stageOpen(b) });
            if (b.page && !b.content)
                messages.push({ role: 'user', content: b.page });
            if (b.answer != null)
                messages.push({ role: 'user', content: typeof b.answer === 'string' ? b.answer : JSON.stringify(b.answer) });
        }
        return { system, messages };
    },
    async _streamChat(params = {}) {
        const {messages, silent, session} = params;
        const model = await this.model;
        let content = '', usage = 0;
        for await (const chunk of model.streamChat({ messages })) {
            if (this._stopped)
                break;
            if (chunk?.type === 'usage')
                usage = chunk;
            else {
                let token = chunk?.content ? chunk?.content : chunk;
                if (typeof token !== 'string')
                    continue;
                content += token;
                if (!silent)
                    session?.send?.({ type: 'chat.delta', path: this.short, token });
            }
        }
        return { content, usage };
    },
    async _fc_exec(service, call, { block, session } = {}) {
        const args = call.args || {};
        if (call.method === 'search' && block?.type === 'web') {
            const result = await service.search?.(args);
            const seen = usedSiteUrls(parentOf(await this.body, block), block);
            block.sites = [];
            for (const r of result?.results || []) {
                const url = r.url;
                if (!url || seen.has(url))
                    continue;
                seen.add(url);
                block.sites.push({ url, title: r.title || '' });
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
        delete container.close_n;
        if (block.type === 'prompt')
            delete container.using_blocks;
        useBlock(container, block.type);
        PIPE[block.type]?.recalc?.({ ...params, block, container });
        await this._save(session);
    },
    async _active_block() {
        let container = await this._active_container();
        const planned = container.todo?.steps || [];
        const real = (container.items || []).filter(b => b.type === 'step');
        if (planned.length && (real.some(s => !s.content) || real.length < planned.length))
            return container.todo;
        if (container.type === 'includes') {
            const list = includePlan(container);
            const files = includeReal(container);
            const open = files.find(f => !f.content);
            if (open)
                return open;
            if (list.length && files.length < list.length)
                return container;
        }
        const items = container.items || [];
        return items.last || container;
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


const ON_TOPIC = [
    'Только факты по теме запроса. Рекламу, сайдбар, «похожие товары» и прочий шум не пиши.',
    'Цены — только если тема задачи про цены или стоимость.',
].join('\n');

const MERMAID = [
    'Схема mermaid — только если есть 2+ сущности сравнить: один блок ```mermaid, graph TD или graph LR.',
    'Id узлов только латиница (A, B, C). Подпись только A["текст"] — без пробела перед скобкой, без ;, без кириллицы в id.',
    'Стрелка --> или -->|"коротко"| на одной строке.',
    'Не вышло — таблица, не ломаный mermaid.',
].join('\n');

// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
const PIPE = {
    /** корень файла = контейнер task; меню plan/do — здесь, не у thinking */
    task: {
        container: true,
        plan: {
            next: ['thinking', 'question', 'explore', 'planning', 'activation', 'complete'],
        },
        do: {
            next: ['thinking', 'question', 'execute', 'explore', 'complete'],
        },
    },
    /** вход: блок prompt пушится вручную в prompt(); отсюда в площадку (настройка в её content) */
    prompt: {
        role: 'user',
        next: ['thinking', 'question', 'text'],
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
        inject: 'если хочешь что-то ответить или сообщить пользователю.',
        prompt: 'Ответь пользователю в свободной форме, то, что ты хотел сообщить.',
    },
    question: {
        label: 'Вопрос',
        icon: 'icons:help',
        inject: 'если нет задачи или не очень понятно, что делать, надо задать вопрос пользователю.',
        stop: true,
        prompt: 'Задай вопрос пользователю, чтобы понять, что тебе делать дальше.',
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
            if (!real.some(s => !s.content))
                dropUsed(owner, 'step');
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
        plan: {
            next: ['thinking', 'question', 'explore', 'planning', 'activation', 'complete'],
        },
        do: {
            next: ['thinking', 'question', 'explore', 'execute', 'complete'],
        },
    },

    /** площадка исполнения: файлы, сервисы, FC; субагент в mode do */
    execute: {
        label: 'Выполнение',
        icon: 'enterprise:wrench',
        inject: 'если необходимо выполнить конкретные действия над конкретными объектами, файлами, навыками',
        container: true,
        next: ['work', 'web', 'form', 'html', 'check', 'report'],
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
        inject: 'если нужно выяснить факты (обзор, справка), не меняя систему',
        system: [
            'Подумай, что именно выяснить и откуда взять факты, чтобы продолжить работу.',
        ].join('\n'),
        container: true,
        next: ['thinking', /* 'work', */ 'web', /* 'form', */ 'report'],
        recalc(params = {}) {
            params.block.mode = params.container.mode || params.block.mode || 'plan';
            params.block.state = childRollup(params.block, ['web', 'form', 'work']);
        },
    },
    work: {
        label: 'Работа c системой',
        icon: 'icons:folder',
        container: true,
        plan: {
            inject: 'если необходимо найти файлы или информацию в рабочей области',
            next: ['search', 'read', 'report'],
        },
        do: {
            inject: 'если необходимо сделать действия над файлами в рабочей области',
            next: ['search', 'read', 'write', 'report'],
        },
        system: [
            'Подумай, какие именно действия над файлами необходимо выполнить.',
        ].join('\n'),
        recalc(params = {}) {
            params.block.state = childRollup(params.block, ['search', 'read', 'write']);
        },
    },
    includes: {
        label: 'Вложения',
        icon: 'icons:attachment',
        container: true,
        next: ['file', 'report'],
        close_prompt: [
            'Кратко изложи только вложенные файлы: имя и суть содержимого.',
            'Бери факты из детей file. Не выдумывай тему, не спрашивай, не пиши отчёт по задаче.',
        ].join('\n'),
        recalc(params = {}) {
            const list = includePlan(params.block);
            const files = includeReal(params.block);
            const seen = files.filter(x => x.content).length;
            params.block.state = list.length ? `${seen}/${list.length} ${PIPE.file.label}` : '';
        },
    },
    file: {
        label: 'Файл',
        icon: 'icons:description',
        async run(params = {}) {
            const b = params.block;
            if (b.content)
                return false;
            if (!b.path) {
                const box = params.container;
                const taken = new Set(includeReal(box).filter(x => x !== b && x.path).map(x => x.path));
                const next = includePlan(box).find(f => f.path && !taken.has(f.path));
                if (!next)
                    return false;
                b.path = next.path;
                b.label = next.label || next.path;
                b.icon = next.icon || b.icon;
            }
            await fillFileContent(b);
            dropUsed(params.container, 'file');
            await close_up(await params.task.body, b, params);
            return true;
        },
    },
    search: {
        label: 'Поиск',
        icon: 'icons:search',
        inject: 'если нужно найти файлы в рабочей области',
        async run(params = {}) {
            const b = params.block;
            if (b.content)
                return false;
            const query = workQuery(b, await params.task.body);
            if (query)
                b.label = query;
            const result = await params.task._fc_exec(WORK, { method: 'semantic_search', args: { prompt: query } }, {
                block: b,
                session: params.session,
            });
            if (!b.content)
                b.content = formatFileHits(result);
            await close_up(await params.task.body, b, params);
            return true;
        },
    },
    read: {
        label: 'Файл',
        icon: 'icons:description',
        inject: 'если нужно прочитать конкретный файл по пути',
        async run(params = {}) {
            const b = params.block;
            if (b.content)
                return false;
            const path = filePath(b, await params.task.body);
            await params.task._fc_exec(WORK, { method: 'read_text', args: { path } }, {
                block: b,
                session: params.session,
            });
            await close_up(await params.task.body, b, params);
            return true;
        },
    },
    write: {
        label: 'Запись',
        icon: 'editor:mode-edit',
        inject: 'если нужно записать или поправить файл',
        prompt: [
            'Первая строка — путь файла в WORK.',
            'Дальше полный текст или блоки SEARCH/REPLACE.',
            'Не выдумывай путь.',
        ].join('\n'),
        parse(block) {
            const raw = String(block.content || '').replace(/\r\n/g, '\n');
            const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
            const head = (fence ? raw.slice(0, fence.index) : raw).trim().split('\n').find(Boolean) || '';
            block.path = head.replace(/^#+\s*/, '').trim();
            block.post = fence ? fence[1].trim() : raw.split('\n').slice(1).join('\n').trim();
        },
        async run(params = {}) {
            const b = params.block;
            if (b.done)
                return false;
            if (!b.path || b.post == null)
                return false;
            const method = /SEARCH|REPLACE/.test(b.post) ? 'edit' : 'save';
            await params.task._fc_exec(WORK, { method, args: { path: b.path, post: b.post } }, {
                block: b,
                session: params.session,
            });
            b.done = true;
            await close_up(await params.task.body, b, params);
            return true;
        },
    },
    check:{
        label: 'Проверка',
        icon: 'icons:check-circle',
        inject: 'если нужно сверить результат с целью, прежде чем закрыть ветку',
        system: [
            'Это площадка проверки, не исполнение и не план.',
            'Сверь критерий готовности (запрос / текущий пункт todo / обещание ветки) с доказательствами.',
            'Если фактов в ленте мало — смотри файлы и систему (work) или интернет (web). Не меняй систему.',
            'Когда доказательств достаточно — сверни факты отчётом. Если фактов мало — отклони отчёт: continue.',
        ].join('\n'),
        container: true,
        next: ['thinking', 'work', 'web', 'report'],
        recalc(params = {}) {
            params.block.mode = 'do';
            params.block.state = childRollup(params.block, ['work', 'web', 'site']);
        },
    },
    report: {
        label: 'Отчёт',
        icon: 'icons:assignment-turned-in',
        close: true,
        inject: 'если считаешь, что на данный этап готов к закрытию',
        prompt: [
            'Подробный отчёт этапа в markdown: факты, цифры, таблицы по теме.',
            ON_TOPIC,
            MERMAID,
            'Картинки и видео в текст не копируй — сводка допишет сама. Url не выдумывай.',
            'Общие фразы без названий — не отчёт.',
            'Не пиши имена шагов и не пиши одно слово.',
            'continue — только если в этом этапе ещё нужен поиск или работа, не потому что пользователь не уточнил тему.',
        ].join('\n'),
        recalc(params = {}) {
            const text = String(params.block.content || '').trim();
            if (!text)
                return;
            const container = params.container;
            const word = text.toLowerCase();
            const rejected = word === 'continue' || !!PIPE[word];
            if (!rejected) {
                container.content = params.block.content;
                const gallery = formatGallery(container, container.content);
                if (gallery)
                    container.content += gallery;
                const list = formatSites(container.sites);
                if (list)
                    container.content += list;
            }
            dropReport(container, params.block);
        },
    },

    web: {
        label: 'Интернет',
        icon: 'icons:language',
        service: '/SERVICES/SearXNG',
        container: true,
        next: ['site', 'report'],
        close_prompt: [
            'Подробный отчёт по посещённым страницам в markdown: факты, цифры, таблицы по теме.',
            ON_TOPIC,
            MERMAID,
            'Картинки и видео в текст не копируй — сводка допишет сама. Url не выдумывай.',
            'Общие фразы без названий — не отчёт.',
            'Не пиши имена шагов и не пиши одно слово.',
        ].join('\n'),
        async run(params = {}) {
            const b = params.block;
            if (b.content || b.sites != null) return false;
            const query = webQuery(b, await params.task.body);
            if (!query) {
                b.sites = [];
                return true;
            }
            const service = await WORK.get_item(PIPE.web.service);
            await params.task._fc_exec(service, { method: 'search', args: { query } }, {
                block: b,
                session: params.session,
            });
            b.sites ??= [];
            await webPushNext(b, params);
            await PIPE.web.recalc?.(params);
            return true;
        },
        plan: {
            inject: 'если необходимо найти информацию в интернете',
            system: [
                'Найди ссылки по текущей задаче.',
                'Не читай страницы — заход сделают блоки site.',
            ].join('\n'),
        },
        do: {
            inject: 'если необходимо выполнить конкретные действия в интернете',
            system: [
                'Найди рабочие ссылки по тому, что нужно сделать сейчас.',
                'Не читай страницы — заход сделают блоки site.',
            ].join('\n'),
        },
        recalc(params = {}) {
            const b = params.block;
            const sites = (b.items || []).filter(x => x.type === 'site');
            const ok = sites.filter(siteOk).length;
            b.state = sites.length ? `Сайты ${ok}/${sites.length}` : '';
        },
    },
    site: {
        label: 'Сайт',
        icon: 'icons:language',
        prompt: [
            'Вытащи с страницы только то, что относится к задаче: факты, таблицы, ссылки, картинки, видео.',
            ON_TOPIC,
            'Картинки — ![подпись](url) только из [images] в дампе. Видео — [подпись](url) только из [video]. Не выдумывай url.',
            'Только то, что есть в [site: …]. Не выдумывай цифры.',
            'Не пересказывай меню, футер, навигацию и рекламу.',
        ].join('\n'),
        async run(params = {}) {
            const b = params.block;
            if (b.content || b.page)
                return false;
            const web = params.container;
            if (!b.url) {
                const taken = new Set((web.items || []).filter(x => x !== b && x.url).map(x => x.url));
                const next = (web.sites || []).map(siteRef).find(s => s.url && !taken.has(s.url));
                if (!next)
                    return false;
                b.url = next.url;
                b.label = siteTitle(next);
                b.icon = siteFavicon(next.url);
            }
            const service = await WORK.get_item(PIPE.web.service);
            const result = await params.task._fc_exec(service, { method: 'fetch_url', args: { url: b.url } }, {
                block: b,
                session: params.session,
            });
            const head = '[site: ' + b.url + ']\n\n';
            const page = !result?.error && b.state !== 'error' ? clipPage(result?.content) : '';
            if (b.state === 'error' || !page || page.replace(/\s+/g, ' ').trim().length < 40) {
                b.state = 'error';
                b.content = head + shortError(result?.error || 'пусто');
                await close_up(await params.task.body, b, params);
                return true;
            }
            b.page = head + page;
            await params.task._save(params.session);
            return false;
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
    const used = new Set(container?.using_blocks || []);
    const list = options.filter(id => {
        if (container?.type === 'includes') {
            const list = includePlan(container);
            const files = includeReal(container);
            const more = list.length && files.length < list.length;
            const all = list.length && files.length >= list.length && files.every(f => f.content);
            if (id === 'file')
                return more && !used.has(id);
            if (id === 'report')
                return all && !used.has(id);
        }
        if (PIPE[id]?.close && !can_close(container))
            return false;
        return !used.has(id);
    });
    if (container?.type === 'task' && !taskAsked(container) && list.includes('question'))
        return ['question'];
    return list;
}

function taskAsked(container) {
    return (container?.items || []).some(b => b.type === 'prompt' && String(b.content || '').trim());
}

function includePlan(box) {
    if (box?.files?.length)
        return box.files;
    return includeReal(box).map(x => ({ path: x.path, label: x.label, icon: x.icon }));
}

function includeReal(box) {
    return (box?.items || []).filter(x => x.type === 'file');
}

function useBlock(container, type) {
    if (!container || !type) return;
    container.using_blocks ??= [];
    if (!container.using_blocks.includes(type))
        container.using_blocks.push(type);
}

function dropUsed(container, type) {
    const list = container?.using_blocks;
    if (!list) return;
    const i = list.indexOf(type);
    if (i >= 0)
        list.splice(i, 1);
    if (!list.length)
        delete container.using_blocks;
}

function dropReport(container, block) {
    const items = container?.items;
    if (!items) return;
    const i = items.indexOf(block);
    if (i >= 0)
        items.splice(i, 1);
    delete container.using_blocks;
}

function can_close(container) {
    return (container?.items || []).some(b =>
        b.content && b.state !== 'error' && !PIPE[b.type]?.close && b.type !== 'thinking' && b.type !== 'prompt');
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
    return types.filter(t => counts[t]).map(t => `${PIPE[t]?.label || t} ${counts[t]}`).join(', ');
}

function stageOpen(block) {
    if (!PIPE[block?.type]?.container) return '';
    const label = PIPE[block.type].label || block.label || block.type;
    return 'Текущий этап далее (' + label + ').';
}

const SITE_PAGE = 6000;
const IMAGES_MARK = '\n\n[images]\n';
const VIDEO_MARK = '\n\n[video]\n';

function siteOk(s) {
    return s?.type === 'site' && s.content && s.state !== 'error';
}

function siteRef(item) {
    if (!item) return { url: '', title: '' };
    if (typeof item === 'string') return { url: item, title: '' };
    return { url: String(item.url || ''), title: String(item.title || '') };
}

function siteTitle(item) {
    const { url, title } = siteRef(item);
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    if (t && t !== url) return t.slice(0, 80);
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function formatSites(sites) {
    const lines = (sites || []).map(siteRef).filter(s => s.url).map(s =>
        '- [' + siteTitle(s).replace(/[\[\]]/g, '') + '](' + s.url + ')'
    );
    return lines.length ? '\n\n**Источники**\n\n' + lines.join('\n') : '';
}

const IMG_EXT = /\.(?:jpe?g|png|gif|webp|avif)(?:\?|$)/i;
const VID_FILE = /\.(?:mp4|webm|ogg)(?:\?|$)/i;
const VID_HOST = /youtu(?:\.be|be\.com)|vimeo\.com|rutube\.ru/i;

function decodePct(s) {
    let t = String(s ?? '');
    for (let i = 0; i < 2; i++) {
        if (!/%[0-9A-Fa-f]{2}/.test(t)) break;
        try { t = decodeURIComponent(t.replace(/\+/g, '%20')); }
        catch { break; }
    }
    return t;
}

function fileAlt(url) {
    try {
        const name = decodePct(new URL(url).pathname.split('/').pop() || '');
        const t = name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
        if (!t || /\s0\s+1\s+[a-f0-9]{8,}$/i.test(t)) return '';
        return t.slice(0, 80);
    } catch {
        return '';
    }
}

function harvestMedia(text, into) {
    const s = String(text || '');
    const add = (kind, url, alt) => {
        url = String(url || '').trim().replace(/[.,;]+$/, '');
        if (!url || into.seen.has(url)) return;
        if (kind === 'image' && !IMG_EXT.test(url)) return;
        if (kind === 'video' && !VID_FILE.test(url) && !VID_HOST.test(url)) return;
        into.seen.add(url);
        const cap = decodePct(alt).replace(/\s+/g, ' ').trim();
        into[kind].push({ url, alt: (/\s0\s+1\s+[a-f0-9]{8,}$/i.test(cap) ? '' : cap).slice(0, 80) });
    };
    let m;
    const bang = /!\[([^\]]*)\]\((https?:[^)\s]+)\)/gi;
    while ((m = bang.exec(s)))
        add('image', m[2], m[1]);
    const link = /\[([^\]]*)\]\((https?:[^)\s]+)\)/gi;
    while ((m = link.exec(s))) {
        if (IMG_EXT.test(m[2]))
            add('image', m[2], m[1]);
        else
            add('video', m[2], m[1]);
    }
    const bare = /https?:\/\/[^\s)<>\]]+/gi;
    while ((m = bare.exec(s)))
        IMG_EXT.test(m[0]) ? add('image', m[0], fileAlt(m[0])) : add('video', m[0], '');
}

function walkMedia(node, into) {
    if (!node || PIPE[node.type]?.close) return;
    harvestMedia(node.content, into);
    for (const c of node.items || [])
        walkMedia(c, into);
}

function formatGallery(container, already) {
    const skip = { image: [], video: [], seen: new Set() };
    harvestMedia(already, skip);
    const out = { image: [], video: [], seen: skip.seen };
    for (const c of container?.items || [])
        walkMedia(c, out);
    if (!out.image.length && !out.video.length)
        return '';
    const img = out.image.map(i => '![' + (i.alt || fileAlt(i.url)).replace(/[\[\]]/g, '') + '](' + i.url + ')');
    const vid = out.video.map(v => '[' + (v.alt || 'видео').replace(/[\[\]]/g, '') + '](' + v.url + ')');
    return '\n\n' + [...img, ...vid].join('\n\n');
}

function usedSiteUrls(parent, web) {
    const used = new Set();
    for (const b of parent?.items || []) {
        if (b === web)
            continue;
        for (const u of b.sites || [])
            used.add(siteRef(u).url);
        for (const s of b.items || [])
            if (s.url)
                used.add(s.url);
    }
    return used;
}

function clipPage(text) {
    const s = String(text || '').trim();
    if (!s) return '';
    const marks = [s.indexOf(IMAGES_MARK), s.indexOf(VIDEO_MARK)].filter(i => i >= 0);
    const i = marks.length ? Math.min(...marks) : -1;
    if (i < 0)
        return s.length <= SITE_PAGE ? s : s.slice(0, SITE_PAGE);
    const body = s.slice(0, i);
    return (body.length <= SITE_PAGE ? body : body.slice(0, SITE_PAGE)) + s.slice(i);
}

async function webPushNext(web, params) {
    if (!web || web.content || web.sites == null)
        return false;
    web.items ??= [];
    if ((web.using_blocks || []).includes('site'))
        return false;
    const taken = new Set((web.items || []).filter(x => x.type === 'site').map(x => x.url));
    const next = web.sites.map(siteRef).find(s => s.url && !taken.has(s.url));
    if (!next || !params.task)
        return false;
    await params.task._push_block({
        block: { type: 'site', url: next.url, label: siteTitle(next), icon: siteFavicon(next.url) },
        container: web,
        session: params.session,
    });
    return true;
}

async function close_up(root, node, params) {
    let n = parentOf(root, node) ? node : params.container;
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

function shortError(e) {
    return String(e?.message || e || '—').split('\n')[0].slice(0, 200);
}

async function fillFileContent(block) {
    const path = String(block.path || '').trim();
    block.label = block.label || path;
    const head = '[file: ' + path + ']\n\n';
    try {
        const file = await WORK.get_item(path);
        if (!file)
            throw new Error('файл не найден: ' + path);
        if (file.icon)
            block.icon = file.icon;
        const text = await file.read_text();
        block.content = head + (typeof text === 'string' && text.trim() ? text : '—');
    } catch (e) {
        block.state = 'error';
        block.content = head + shortError(e);
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

function webAsk(s) {
    const t = String(s || '').trim();
    return t && t !== PIPE.web.label && !/^(есть вложения|task)$/i.test(t);
}

function webQuery(web, body) {
    if (webAsk(web?.label) && web.label !== PIPE.web.label)
        return web.label;
    const asked = String((body.items || []).find(b => b.type === 'prompt')?.content || '').trim();
    if (webAsk(asked))
        return asked;
    return '';
}

function workQuery(block, body) {
    const label = String(block?.label || '').trim();
    if (label && label !== PIPE.search.label)
        return label;
    return String((body.items || []).find(b => b.type === 'prompt')?.content || body.title || '').trim();
}

function filePath(block, body) {
    const own = String(block?.path || '').trim();
    if (own)
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== PIPE.read.label && label.includes('/'))
        return label;
    let found;
    const walk = (n) => {
        if (n?.type === 'search' && n.content)
            found = n;
        for (const c of n?.items || [])
            walk(c);
    };
    walk(body);
    const hit = String(found?.content || '').match(/[/][^\s:]+/);
    return hit ? hit[0] : '';
}

function keepHere(session, raw) {
    if (!session) return;
    let here = raw;
    if (typeof here === 'string') {
        try { here = JSON.parse(here); } catch { return; }
    }
    if (!here || typeof here !== 'object') return;
    const next = { ...session.here };
    if (here.tz) next.tz = String(here.tz);
    const lat = +here.lat;
    const lon = +here.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        next.lat = lat;
        next.lon = lon;
    }
    if (next.tz || (next.lat != null && next.lon != null))
        session.here = next;
}

function hereNow(session) {
    const here = session?.here;
    const tz = here?.tz;
    const now = new Date();
    const dayOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOpts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    if (tz) {
        dayOpts.timeZone = tz;
        timeOpts.timeZone = tz;
    }
    let day, clock;
    try {
        day = now.toLocaleDateString('ru-RU', dayOpts);
        clock = now.toLocaleTimeString('ru-RU', timeOpts);
    } catch {
        day = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        clock = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
    const parts = [`Сейчас: ${day}, время ${clock}${tz ? ` (${tz})` : ''}.`];
    if (here?.lat != null && here?.lon != null)
        parts.push(`Место: ${here.lat.toFixed(5)}, ${here.lon.toFixed(5)}. Если в запросе другое место — оно важнее.`);
    return parts.join(' ');
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