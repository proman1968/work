// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
const PIPE = {
    /** вход: блок prompt пушится вручную в prompt(); отсюда auto-переход в thought */
    prompt: {
        role: 'user',
        next: ['thought'],
    },
    text:{
        icon: 'icons:chat',
        inject: 'если нужно задать пользователю ровно один вопрос',
        prompt: [
            'Задай пользователю ровно один вопрос по текущей задаче.',
            '[instruction]',
            'Только один вопрос. Без нумерованного списка, без второго уточнения в том же сообщении.',
            'Если уточнений несколько — это не text, нужна форма.',
        ].join('\n'),
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
    thought: {
        icon: 'carbon:idea',
        plan:{
            next: ['planning', 'form', 'research', 'thought'],
        },
        do:{
            next: ['form', 'execute', 'complete', 'html', 'thought'],
        },
        inject: 'если необходимо проанализировать и обдумать дальнейшие действия',
        prompt: [
            'Как следует подумай над тем, что необходимо сделать, исходя из текущего контекста.',
            'Не фантазируй, не выдумывай, ничего не делай, не пиши, не обращайся к пользователю, просто анализируй.',
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
        stop: 'Принять план',
        async approve(params = {}){
            let {container, block, prompt} = params;
            block.type = 'plan';
            delete block.stop;
            switch(prompt){
                case 'ok':{
                    if (!canPlantTodo(container, await params.task?.body)) {
                        block.status = 'rejected';
                        block.content += '\n\nПлан не назначен: слот todo занят или это шаг чужого плана.';
                        break;
                    }
                    let plan = parsePlanMarkdown(block.content);
                    container.todo = {
                        type: 'todo',
                        icon: 'icons:list',
                        status: 'in_progress',
                        ...plan,
                    };
                    container.mode = 'do';
                    block.content += '\n\nПЛАН ПРИНЯТ! НАЧИНАЕМ ВЫПОЛЕНИЕ';
                    block.status = 'approved';
                } break;
                case 'cancel':{
                    block.status = 'rejected';
                    block.content += '\n\nПЛАН ОТВЕРГНУТ, ТРЕБУЕТСЯ ПЕРЕПЛАНИРОВКА';
                } break;
                default:{
                    block.status = 'to modify';
                    block.content += '\n\nПЛАН ОТВЕРГНУТ, ' + prompt;
                }
            }
            return block;
        }
    },

    /** шаг плана: заголовок = «N. описание» текущего in_progress, тело = items. */
    step: {
        inject: 'если необходимо выполнить один пункт плана',
        container: true,
        next: ['thought'],
    },

    /** площадка исполнения: файлы, сервисы, FC; субагент в mode do */
    execute: {
        icon: 'enterprise:wrench',
        do_icon: 'spinners:pulse',
        inject: 'если план не нужен — сразу выполнять текущий пункт (файлы, сервисы, действия)',
        container: true,
        next: ['thought'],
        do: {
            next: ['work', 'web', 'form', 'complete', 'html', 'thought'],
        },
        actualize(params = {}) {
            const node = [params.container, params.block].find(n => n?.type === 'execute');
            if (!node) return;
            node.mode = 'do';
            node.icon = node.ready ? this.icon : this.do_icon;
            const parent = parentOf(params.root, node);
            if (parent && (parent.mode || 'plan') === 'plan')
                parent.mode = 'do';
        },
    },

    research: {
        icon: 'icons:search',
        inject: 'если нужно выяснить факты (обзор, справка), прежде чем планировать',
        container: true,
        next: ['thought'],
        do: {
            next: ['work', 'web', 'form', 'complete', 'thought'],
        },
        actualize(params = {}) {
            const node = [params.container, params.block].find(n => n?.type === 'research');
            if (node) node.mode = 'do';
        },
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
        inject: 'если нужно выяснить у пользователя сразу несколько вопросов (два и больше) — не текстом',
        next: ['thought'],
        prompt: ['Собери HTML-форму для ввода данных по текущей задаче.',
            '[instruction]',
            'Не спрашивай, какие поля нужны — составь их сам по запросу пользователя в ленте, не по профилю и не по карточке группы.',
            'Первой строкой можно дать краткое пояснение.',
            'Далее один fenced-блок html.',
            'Каждый вопрос — свой fieldset + legend. Не группируй вопросы и не ставь fieldset в ряд.',
            'Варианты: до 5 — radio, больше — select. Всегда пункт «Другое» и рядом input type="text" (своё значение).',
            'У каждого контрола обязателен name (у «другого» — свой, например name_other).',
            'Без script, без html/body, без кнопки отправки.',
        ].join('\n'),
        /** после стрима: пояснение в content, разметка в html */
        parse(block) {
            const { content, html } = parseFormHtml(block.content);
            block.content = content;
            block.html = html;
            block.values ??= {};
        },
        async approve(params = {}) {
            const { block, prompt } = params;
            delete block.stop;
            if (prompt === 'cancel') {
                block.status = 'rejected';
                block.content = (block.content || '') + '\n\nФорма отменена';
                return block;
            }
            let answers = {};
            if (prompt && prompt !== 'ok' && typeof prompt === 'string') {
                try { answers = JSON.parse(prompt); } catch { answers = block.values || {}; }
            } else if (prompt && typeof prompt === 'object') {
                answers = prompt;
            } else {
                answers = block.values || {};
            }
            block.answers = answers;
            block.values = answers;
            block.status = 'submitted';
            block.content = (block.content || '') + '\n\n' + formatFormAnswers(answers);
            return block;
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
            delete block.stop;
            switch (prompt) {
                case 'ok': {
                    block.status = 'approved';
                    container.ready = true;
                    container.content = block.content;
                } break;
                case 'cancel': {
                    block.status = 'rejected';
                    block.content = (block.content || '') + '\n\nИТОГ ОТКЛОНЕН, ПРОДОЛЖАЕМ';
                } break;
                default: {
                    block.status = 'to modify';
                    block.content = (block.content || '') + '\n\nИТОГ ОТКЛОНЕН, ' + prompt;
                }
            }
        }
    },
};

// Линейный реестр PIPE (по id = type блока);
export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',

    /**
     * Вход автомата. Один вызов = один узел (think + маршрут + execute).
     * @param {object} params — { prompt?, session?, role?, answers?, model? }
     * @param {object|FormData} [post] вложения: { files?, urls? } — сохранить в папку задачи
     */
    async prompt(params = {}, post) {
        // debugger
        let { prompt, role, session } = params;
        params.block = await this._active_block();
        params.container = await this._active_container();
        params.pipe_step = PIPE[params.block.type] || PIPE.thought;
        params.task = this;
        params.root = await this.body;
        await this._actualize(params);

        try {
            switch (role) {
                case 'AI':{
                    // не удалять, пока не переделаем на новый алгоритм
                } break;
                case 'APPROVE':{
                    params.block.approved = prompt;
                    await params.pipe_step.approve(params);
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
            params.pipe_step = PIPE[params.block.type] || PIPE.thought;
            params.root = await this.body;
            await this._actualize(params);
            let mode = params.container.mode || 'plan';
            let options = routeNext(params);
            let messages, response, choice = '';
            if(options.length === 1) {
                choice = options[0];
            }
            else {
                let menu =  ''
                options = options.filter(id => id !== params.block.type);
                if (mode === 'plan' && !canPlantTodo(params.container, params.root))
                    options = options.filter(id => id !== 'planning');
                if(options.length > 0) {
                    menu += 'Выбери следующий, наиболее подходящий тип шага, не решай задачу целиком, ответь одним словом точно из списка без знаков препинания и пояснений:';
                    for (let id of options) {
                        menu += '\n' + id.toUpperCase() + ' - ' + (PIPE[id]?.inject || '') + ';';
                    }
                    
                }
                menu += '\nЕсли ни один тип не подходит — ответь по существу. Несколько вопросов — FORM.';
                
                messages = await this.collect_context({prompt: menu});

                response = await this._streamChat({ messages, silent: true, session });
                if (this._stopped) return;
                choice = response.content.trim().toLowerCase();
            }
            let next_pipe = PIPE[choice];
            if(!next_pipe){
                choice = 'text'
                next_pipe = PIPE[choice];
            }

            params.block = {
                type: choice,
                icon: next_pipe.icon || 'carbon:idea',
            }
            if (next_pipe.stop)
                params.block.stop = next_pipe.stop;
            if(next_pipe.container)
                params.block.items = [];

            await this._push_block(params);
            if(next_pipe.prompt){
                messages = await this.collect_context({prompt: next_pipe.prompt});
                response = await this._streamChat({messages, session});
                if (this._stopped) return;
                Object.assign(params.block, response);
                next_pipe?.parse?.(params.block);
                
            }
            else if(response) {
                params.block.content = response.content;
            }
            this._save(session);
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
    async collect_context(params = {}) {
        const {prompt} = params;
        const container = await this._active_container();
        let system = container.system || '';
        if (container.todo)
            system += '\n\n[todo]\n' + (container.todo.content || '');
        let role = 'system';
        const messages = [{ role, content: system }];
        const push = (nextRole, content) => {
            if (!content) return;
            if (messages.last?.role === nextRole) {
                if (nextRole === 'assistant')
                    messages.push({ role: 'user', content: 'дальше' });
                else {
                    messages.last.content += '\n\n' + content;
                    return;
                }
            }
            messages.push({ role: nextRole, content });
        };
        for (const b of (container.items || [])) {
            push(PIPE[b.type]?.role || 'assistant', b.content);
            if (b.approved != null)
                push('user', typeof b.approved === 'string' ? b.approved : JSON.stringify(b.approved));
        }
        if (prompt) {
            if (messages.last?.role === 'user')
                messages.last.content += '\n\n[instruction]\n' + prompt;
            else
                messages.push({ role: 'user', content: prompt });
        }
        return messages;
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
    async _actualize(params = {}) {
        params.root ??= await this.body;
        const seen = new Set();
        for (const node of [params.container, params.block]) {
            if (!node || seen.has(node)) continue;
            seen.add(node);
            await PIPE[node.type]?.actualize?.(params);
        }
        if (![params.container, params.block].some(n => n?.type === 'todo'))
            await PIPE.todo.actualize?.(params);
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

function parentOf(root, node) {
    if (!root || !node || root === node) return null;
    for (const b of (root.items || [])) {
        if (b === node) return root;
        const p = parentOf(b, node);
        if (p) return p;
    }
    return null;
}

/** один слот todo; step чужого плана свой не сажает (replan — позже) */
function canPlantTodo(container, root) {
    if (!container || container.todo) return false;
    if (container.type === 'step') {
        let p = parentOf(root, container);
        while (p) {
            if (p.todo) return false;
            p = parentOf(root, p);
        }
    }
    return true;
}

/** thought — меню контейнера-исполнителя, иначе свой next */
function routeNext(params = {}) {
    const mode = params.container?.mode || 'plan';
    const host = PIPE[params.container?.type];
    const step = params.pipe_step;
    if (params.block?.type === 'thought')
        return host?.[mode]?.next || step?.[mode]?.next || step?.next || [];
    return step?.[mode]?.next || step?.next || [];
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
