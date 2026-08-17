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

            if (params.block.type === 'web' && !params.block.content && params.block.sites == null) {
                const query = webQuery(params.block, await this.body);
                const service = await WORK.get_item(PIPE.web.fc);
                await this._fc_exec(service, { method: 'search', args: { query } }, {
                    block: params.block,
                    session,
                });
                params.block.sites ??= [];
                await webPushNext(params.block, params);
                await PIPE.web.recalc?.(params);
                await this._save(session);
                if (!this._stopped)
                    this.async(() => this.prompt({ role: 'AI', session }));
                return { ok: true };
            }

            const web = params.container.type === 'web' ? params.container
                : (params.block.type === 'web' ? params.block : null);
            if (web && !web.content && webQueueDone(web)) {
                const messages = await this.context({ prompt: PIPE.web.done?.prompt });
                const response = await this._streamChat({ messages, session });
                if (!this._stopped) {
                    web.content = response.content;
                    if (response.usage)
                        web.usage = response.usage;
                    await close_up(await this.body, web, params);
                }
                await this._save(session);
                if (!this._stopped)
                    this.async(() => this.prompt({ role: 'AI', session }));
                return { ok: true };
            }

            if (params.container.type === 'explore' && !params.container.content && exploreReady(params.container)) {
                const messages = await this.context({ prompt: PIPE.explore.done?.prompt });
                const response = await this._streamChat({ messages, session });
                if (!this._stopped) {
                    params.container.content = response.content;
                    if (response.usage)
                        params.container.usage = response.usage;
                    await close_up(await this.body, params.container, params);
                }
                await this._save(session);
                if (!this._stopped)
                    this.async(() => this.prompt({ role: 'AI', session }));
                return { ok: true };
            }

            if (params.block.type === 'site' && params.block.url && !params.block.content) {
                const service = await WORK.get_item(PIPE.web.fc);
                await this._fc_exec(service, { method: 'fetch_url', args: { url: params.block.url } }, {
                    block: params.block,
                    session,
                });
                await webPushNext(params.container, params);
                await close_up(await this.body, params.block, params);
                await this._save(session);
                if (!this._stopped)
                    this.async(() => this.prompt({ role: 'AI', session }));
                return { ok: true };
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
                if(!next_pipe){
                    choice = 'text'
                    next_pipe = PIPE[choice];
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
        const messages = [{ role: 'system', content: [...layers.map(l => l.system).filter(Boolean), '[mode] ' + mode].join('\n\n') }];
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
        const service = await WORK.get_item(fc);
        const allow = block?.type === 'web' ? ['search'] : block?.type === 'site' ? ['fetch_url'] : null;
        const functions = Object.entries(service.SCHEMA || {})
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
                return { content, usage, calls };
            if (turn.usage)
                usage = turn.usage;
            if (!turn.calls?.length) {
                content = turn.content || content;
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
            return { content, usage, calls };
        if (last.content)
            content = last.content;
        if (last.usage)
            usage = last.usage;
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
    }
};


//-----------------------------------------------------------------------------


// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
const PIPE = {
    /** корень файла = контейнер task; меню plan/do — здесь, не у thinking */
    task: {
        container: true,
        plan: {
            next: ['thinking', 'explore', /* 'planning', 'activation' */],
        },
        do: {
            next: ['thinking','explore', /* 'execute', 'check' */],
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
            'Не ищи и не обращайся к пользователю.',
        ].join('\n'),
        container: true,
        next: ['thinking', /* 'work', */ 'web',  'form'],
        done: {
            prompt: [
                'Обобщи, что выяснено в этом обзоре.',
                'Только факты из ленты (web, site). Кратко, без выдумок и без обращения к пользователю.',
            ].join('\n'),
        },
        recalc(params = {}) {
            params.block.mode = params.container.mode || params.block.mode || 'plan';
            params.block.state = childRollup(params.block, ['web']);
        },
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
        container: true,
        next: ['site'],
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
        recalc(params = {}) {
            if (params.block.state !== 'error')
                delete params.block.state;
        },
    },

    work: {
        label: 'Рабочая область',
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
        next: ['thinking'],
    },

    form: {
        label: 'Форма',
        icon: 'icons:view-list',
        inject: 'если нужно выяснить у пользователя сразу несколько вопросов (два и больше) — не текстом',
        prompt: ['Собери HTML-форму для ввода данных по текущей задаче.',
            '[instruction]',
            'Не спрашивай, какие поля нужны — составь их сам по запросу пользователя в ленте, не по профилю и не по карточке группы.',
            'Первой строкой можно дать краткое пояснение.',
            'Далее один fenced-блок html.',
            'Все контролы только внутри fieldset + legend, в том числе radio/select. Заголовки секций (h1–h6, p, div) вместо legend запрещены.',
            'В одном fieldset можно несколько связанных полей (как в обычной форме этой цели). Fieldset в ряд не ставь.',
            'Legend — название группы или единственного поля. Label внутри — только если он не повторяет legend. Подсказка — в placeholder.',
            'Варианты: до 5 — radio, больше — select. Всегда пункт «Другое» и рядом input type="text" (своё значение).',
            'У каждого контрола обязателен name (у «другого» — свой, например name_other).',
            'Поля — максимально удобные для ввода: подходящий type (email, tel, date, number, url), inputmode, placeholder, autocomplete, min/max, maxlength, pattern; обязательность — required.',
            'Маски и ограничения — только HTML-атрибутами, без script.',
            'Форма должна быть похожа на привычный стандарт для этой цели (заявка, анкета, заказ, контакты и т.п.): состав, порядок и подписи как у обычной такой формы, не выдумывай свою схему.',
            'Без script, без html/body, без кнопки отправки.',
        ].join('\n'),
        /** после стрима: пояснение в content, разметка в html */
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
        prompt: ['Сформируй краткий итог по текущей ветке.',
            '\n\n[instruction]\n',
            'Что было сделано в рамках текущей задачи, какой получен результат. Кратко, по фактам из ленты, в формате md.'].join('\n'),
        stop: 'Завершить',
        async approve(params = {}) {
            const { container, block, prompt } = params;
            if (prompt) {
                block.state = 'to modify';
                block.content = (block.content || '') + '\n\nИТОГ ОТКЛОНЕН, ' + prompt;
                return;
            }
            block.state = 'approved';
            container.content = block.content;
        }
    },
};
function next_options(container, block, mode) {
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
    return kids.some(k => k.type === 'web');
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

/** Вырезать html-разметку формы; остаток — пояснение. script не храним (это не узел html). */
function parseFormHtml(text = '') {
    const raw = String(text ?? '');
    let html = '';
    let content = raw;
    const fence = raw.match(/```(?:html|htm)?\s*([\s\S]*?)```/i);
    if (fence) {
        html = fence[1].trim();
        content = (raw.slice(0, fence.index) + raw.slice(fence.index + fence[0].length)).trim();
    } else {
        const form = raw.match(/<form\b[\s\S]*<\/form>/i);
        if (form) {
            html = form[0].trim();
            content = (raw.slice(0, form.index) + raw.slice(form.index + form[0].length)).trim();
        } else if (/^\s*</.test(raw)) {
            html = raw.trim();
            content = '';
        }
    }
    html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').trim();
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