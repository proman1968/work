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
                    params.block.answer = prompt;
                    if (params.accept === true || params.accept === 'true') {
                        params.block.status = 'approved';
                        params.block.icon = 'icons:check';
                        await params.pipe_step.approve?.(params);
                    } else {
                        params.block.status = 'rejected';
                        params.block.icon = 'icons:close';
                    }
                    delete params.block.stop;
                    await this._save(session);
                } break;
                default:{
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
            params.pipe_step.actualize?.(params);

            let mode = params.container.mode || 'plan';
            let options = next_options(params.container, params.block, mode);
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
                if (this._stopped) return;
                choice = response.content.trim().toLowerCase();
            }
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

            await this._push_block(params);
            prompt = next_pipe[mode]?.prompt || next_pipe.prompt;
            if(prompt){
                messages = await this.context({prompt});
                response = await this._fc_chat({ messages, session, fc: next_pipe.fc, block: params.block });
                if (this._stopped) return;
                Object.assign(params.block, response);
                next_pipe?.parse?.(params.block);
                next_pipe?.actualize?.(params);
            }
            await this._save(session);
            if (!params.block.stop) {
                this.async(() => this.prompt({ role: 'AI', session }));
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
            if (next?.items && !next.ready) container = next;
            else break;
        }
        const mode = container.mode || 'plan';
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
        const functions = Object.entries(service.SCHEMA || {}).map(([name, spec]) => ({
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
        if (call.method === 'search' && args.query && block) {
            block.label = args.query;
            await this._save(session);
        }
        if (call.method === 'fetch_url' && block?.items) {
            const url = String(args.url || '').trim();
            const n = block.items.filter(b => b.type === 'site').length;
            if (n >= WEB_SITES) {
                return { error: 'Лимит: не больше ' + WEB_SITES + ' сайтов за один web', url };
            }
            const site = {
                type: 'site',
                url,
                label: url,
                icon: 'spinners:3-dots-scale',
            };
            await this._push_block({ block: site, container: block, session });
            const result = await service.fetch_url?.(args);
            site.icon = siteFavicon(url);
            if (result?.title)
                site.label = result.title;
            if (result?.error)
                site.status = result.error;
            await this._save(session);
            return result ?? {};
        }
        return await service[call.method]?.(args);
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
        const {block, container, session} = params;
        block.time ??= Date.now();
        container.items.push(block);
        await this._save(session);
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
    /** вход: блок prompt пушится вручную в prompt(); отсюда в площадку (настройка в её content) */
    prompt: {
        role: 'user',
        next: ['research'],
    },
    thinking: {
        icon: 'carbon:idea',
        plan:{
            next: ['research', /* 'planning', 'activation' */],
            inject: 'если необходимо проанализировать и обдумать дальнейшие планы',
        },
        do:{
            next: ['research', /* 'execute', 'check' */],
            inject: 'если необходимо проанализировать и обдумать дальнейшие действия',
        },
        prompt: [
            'Как следует подумай над тем, что необходимо сделать, исходя из текущего контекста.',
            'Не фантазируй, не выдумывай, ничего не делай, не пиши, не обращайся к пользователю, просто анализируй.',
            'Ответь в виде размышлений  от своего лица (5-10 строк, или если надо, больше)',
        ].join('\n'),
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
        async actualize(params = {}) {
            const { container, task } = params;
            const body = await task.body;
            const owner = container.todo ? container : (body.todo ? body : null);
            const todo = owner?.todo;
            if (!todo) return;
            const real = (owner.items || []).filter(b => b.type === 'step');
            const lines = (todo.steps || []).map((s, i) => {
                const st = real[i];
                s.status = st?.ready ? 'done' : (st ? 'in_progress' : (s.status || 'todo'));
                if (st) {
                    st.label = `${i + 1}. ${s.description}`;
                    st.status = s.status;
                    st.icon = s.status === 'done' ? 'icons:check-circle' : 'av:play-circle-outline';
                }
                return `${i + 1}. ${s.description} [${s.status}]`;
            });
            todo.content = (todo.label || '') + (lines.length ? '\n' + lines.join('\n') : '');
            owner.mode = 'do';
            const cur = real.find(s => !s.ready) || real.last;
            if (cur)
                cur.system = [
                    todo.content,
                    '\n[instruction]',
                    `Сейчас только пункт "${cur.label}". Остальные уже в плане — не делай их и не спрашивай про них.`,
                ].join('\n');
        },
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
        stop: 'Принять план',
        async approve(params = {}){
            let {container, block, prompt} = params;
            block.type = 'plan';
            let plan = parsePlanMarkdown(block.content);
            container.todo = {
                type: 'todo',
                icon: 'icons:list',
                status: 'in_progress',
                ...plan,
            };
            container.mode = 'do';
        }
    },

    /** шаг плана: заголовок = «N. описание» текущего in_progress, тело = items. */
    step: {
        inject: 'если необходимо выполнить один очередной пункт плана',
        container: true,
        next: ['thinking'],
    },

    /** площадка исполнения: файлы, сервисы, FC; субагент в mode do */
    execute: {
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
        actualize(params = {}) {
            params.block.mode = 'do';
        },
    },

    research: {
        icon: 'icons:search',
        do_icon: 'spinners:pulse',
        inject: 'если нужно выяснить факты (обзор, справка), не меняя систему',
        prompt: [
            'Подумай, что именно исследовать и откуда взять факты, чтобы продолжить работу.',
            'Не ищи и не обращайся к пользователю. Размышления от своего лица в content.',
        ].join('\n'),
        container: true,
        next: [/* 'work', */ 'web', /* 'form' */],
        actualize(params = {}) {
            params.block.mode = params.container.mode || params.block.mode || 'plan';
        },
    },
    check:{
        icon: 'icons:check-circle',
        do_icon: 'spinners:pulse',
        inject: 'если нужно сверить результат с целью, прежде чем закрыть ветку',
        prompt: [
            'Это площадка проверки, не исполнение и не план.',
            'Сверь критерий готовности (запрос / текущий пункт todo / обещание ветки) с доказательствами.',
            'Если фактов в ленте мало — смотри файлы и систему (work) или интернет (web). Не меняй систему.',
            'Когда доказательств достаточно — вердикт.',
        ].join('\n'),
        container: true,
        next: ['work', 'web', 'thinking', 'verdict'],
        done: { next: ['complete'] },
        actualize(params = {}) {
            params.block.mode = 'do';
        },
    },
    verdict: {
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
        actualize(params = {}) {
            if (params.block.verdict !== 'ok') return;
            params.container.ready = true;
            params.container.content = params.block.content;
        },
    },

    web: {
        icon: 'icons:language',
        do_icon: 'spinners:pulse',
        inject: 'если необходимо найти информацию в интернете',
        fc: '/SERVICES/SearXNG',
        container: true,
        prompt: [
            'Найди факты в интернете: сначала search({query}), затем fetch_url({url}) по 1–2 подходящим ссылкам.',
            'Пиши только то, что прочитал на страницах. Не выдумывай цены и факты из сниппетов.',
        ].join('\n'),
        next: ['thinking'],
        done: { next: ['complete'] },
        plan:{
            inject: 'если необходимо найти информацию в интернете',
        },
        do:{
            inject: 'если необходимо выполнить конкретные действия в интернете',
        },
        actualize(params = {}) {
            const b = params.block;
            b.ready = true;
            b.icon = PIPE.web.icon;
        },
    },
    site: {
        icon: 'icons:language',
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
        next: ['thinking'],
    },

    form: {
        icon: 'icons:view-list',
        inject: 'если нужно выяснить у пользователя сразу несколько вопросов (два и больше) — не текстом',
        next: ['thinking'],
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
            block.status = 'submitted';
            block.approved = formatFormAnswers(answers);
        },
        stop: 'Отправить форму',
    },

    html: {
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
        inject: 'если считаешь, что текущая задача (шаг) завершена',
        prompt: ['Сформируй краткий итог по текущей ветке.',
            '\n\n[instruction]\n',
            'Что было сделано в рамках текущей задачи, какой получен результат. Кратко, по фактам из ленты, в формате md.'].join('\n'),
        stop: 'Завершить',
        async approve(params = {}) {
            const { container, block, prompt } = params;
            if (prompt) {
                block.status = 'to modify';
                block.content = (block.content || '') + '\n\nИТОГ ОТКЛОНЕН, ' + prompt;
                return;
            }
            block.status = 'approved';
            container.ready = true;
            container.content = block.content;
        }
    },
};
function next_options(container, block, mode) {
    const node = PIPE[block?.type];
    if (block?.ready && node?.container && node.done?.next)
        return node.done.next;
    const place = PIPE[container?.type];
    if (place?.container)
        return place.next || [];
    return node?.[mode]?.next || node?.next || [];
}

const WEB_SITES = 2;

function siteFavicon(url) {
    try {
        return 'https://icons.duckduckgo.com/ip3/' + new URL(url).hostname + '.ico';
    } catch {
        return 'icons:language';
    }
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
            status: 'todo',
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