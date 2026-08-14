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
            next: ['planning', 'form', 'html', 'thought'],
        },
        do:{
            next: ['do', 'complete', 'html', 'thought'],
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
            block.type = 'plan';
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
                            let real_steps = (container.items || []).filter(b => b.type === 'step');
                            const lines = real_steps.map((real_step, i)=>{
                                real_step.mode = 'do';
                                let step = this.steps[i];
                                real_step.label = `${i + 1}. ${step.description}`;
                                step.status = real_step.status = (real_step.ready) ? 'done' : 'in_progress';
                                step.icon = real_step.icon = step.status === 'done' ? 'icons:check-circle' : 'av:play-circle-outline';
                                return real_step.label + ` [${step.status}]`;
                            });
                            let content = this.label + '\n' + lines.join('\n');
                            if(real_steps.length > 0)
                                real_steps.last.system = [
                                    content, 
                                    '\n[instruction]',
                                    `Сейчас твоя задача только выполнить этот пункта плана "${real_steps.last.label}".`,
                                    `Для этого ты можешь общаться с пользователем, искать информацию, выполнять действия и т.д.`,
                                ].join('\n');
                            return content;
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
        inject: 'если необходимо выяснить у пользователя несколько параметров одновременно',
        prompt: ['Собери форму для ввода данных.',
            '[instruction]',
            'Первой строкой обычного текста (до вызова) можно дать краткое пояснение к форме.',
            'далее идет массив объектов с полями СТРОГО в формате json как код:',
            '[{id, label, type, options}]',
            'id - уникальный идентификатор поля;',
            'label - текст лейбла поля;',
            'type - тип поля (text, number, checkbox, radio, select, textarea);',
            'options - массив вариантов для выбора (только для типа select и radio);',
            'пример:',
            '{id: "name", type: "text", options: []}',
            '{id: "age", type: "number", options: []}',
            '{id: "gender", type: "radio", options: ["male", "female"]}',
            '{id: "email", type: "text", options: []}',
            '{id: "phone", type: "text", options: []}',
            '{id: "address", type: "text", options: []}',
            '{id: "city", type: "text", options: []}',
            '{id: "country", type: "text", options: []}',
        ].join('\n'),
        /** после стрима: content → пояснение + fields[]; ui опционален (кастомный слот в preview) */
        parse(block) {
            const { content, fields } = parseFormContent(block.content);
            block.content = content;
            block.fields = fields;
            block.values ??= {};
            // block.ui — если задан (модель/харнесс): preview рисует microchat-form-{ui} или CE-имя
        },
        async approve(params = {}) {
            const { block, prompt } = params;
            delete block.button;
            if (prompt === 'false') {
                block.status = 'rejected';
                block.content = (block.content || '') + '\n\nФорма отменена';
                return block;
            }
            let answers = {};
            if (prompt && prompt !== 'true' && typeof prompt === 'string') {
                try { answers = JSON.parse(prompt); } catch { answers = block.values || {}; }
            } else if (prompt && typeof prompt === 'object') {
                answers = prompt;
            } else {
                answers = block.values || {};
            }
            block.answers = answers;
            block.values = answers;
            block.status = 'submitted';
            block.content = (block.content || '') + '\n\n' + formatFormAnswers(block.fields, answers);
            return block;
        },
        plan:{
            next: ['planning'],
        },
        do:{
            next: ['thought'],
        },
        allow_approve: 'Отправить форму',
    },

    /**
     * SPA в sandbox-iframe. Не wait, не продолжение FSM (нет plan/do → stop).
     * Тело: block.html; пояснение — block.content.
     */
    html: {
        icon: 'editor:code',
        inject: 'если нужно сделать одностраничное HTML-приложение (схема, игра, виджет, интерактив)',
        prompt: [
            'Собери одностраничное HTML-приложение для показа в ленте внутри iframe.',
            '[instruction]',
            'Первой строкой обычного текста можно дать краткое пояснение.',
            'Далее — полный документ или самодостаточный фрагмент СТРОГО в fenced-блоке:',
            '```html',
            '…приложение (html/css/js)…',
            '```',
            'Требования:',
            '- самодостаточное SPA: всё нужное внутри fence (style/script/canvas ок);',
            '- резиновая вёрстка под ширину iframe (100% / flex/grid), без фиксированной «под 800px»;',
            '- не обращайся к parent/top; не жди кнопок approve снаружи — это финальный экран ветки;',
            '- внешние script/src только https при необходимости;',
            '- один fenced-блок, без markdown вокруг.',
        ].join('\n'),
        parse(block) {
            const { content, html } = parseHtmlContent(block.content);
            block.content = content;
            block.html = html;
        },
    },

    complete: {
        inject: 'если считаешь, что текущая задача (шаг) завершена',
        prompt: ['Сформируй краткий итог по текущей ветке.',
            '\n\n[instruction]\n',
            'Что было сделано в рамках текущей задачи, какой получен результат. Кратко, по фактам из ленты, в формате md.'].join('\n'),
        allow_approve: 'Завершить',
        async approve(params = {}) {
            const { container, block, prompt, task } = params;
            delete block.button;
            if (prompt === 'false') {
                block.status = 'rejected';
                block.content = (block.content || '') + '\n\nИтог отклонён, продолжаем';
                return block;
            }
            block.status = 'approved';
            block.content = (block.content || '') + '\n\nЗАВЕРШЕНО';
            // закрыть вышестоящий step (= текущий container, если мы внутри него)
            if (container?.type === 'step') {
                container.ready = true;
                const body = await task.body;
                if (body.todo?.status === 'in_progress')
                    return body.todo;
            }
            return block;
        },
        plan: {
            next: ['thought'],
        },
        do: {
            next: ['thought'],
        },
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
                    // после close step контейнер меняется — не пушить в закрытый
                    params.container = await this._active_container();
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


            pipe_step = PIPE[params.block.type];
            let mode = container.mode || 'plan';
            let options = pipe_step?.[mode]?.next || [];
            let messages, response, choice = '';
            if(options.length === 1) {
                choice = options[0];
            }
            else {
                let menu =  ''
                options = options.filter(id => id !== params.block.type);
                if(options.length > 0) {
                    menu += 'Выбери следующий, наиболее подходящий тип шага, не решай задачу целиком, ответь одним словом точно из списка без знаков препинания и пояснений:';
                    for (let id of options) {
                        menu += '\n' + id.toUpperCase() + ' - ' + (PIPE[id]?.inject || '') + ';';
                    }
                    
                }
                menu += '\nЕсли пользователь перед этим просто задал вопрос, просто ответь на него, или сам задай вопрос, если что-то непонятно.';
                
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
                response = await this._streamChat({messages, session});
                if (this._stopped) return;
                Object.assign(params.block, response);
                next_pipe?.parse?.(params.block);
                
            }
            else if(response) {
                params.block.content = response.content;
            }
            this._save(session);
            if (!params.block.stop && !params.block.button) {
                this.async(() => this.prompt({ role: 'AI', session }));
            }
        }
        catch (e) {
            params.block = { type: 'error', content: e.message };
            await this._push_block(params.block);
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
        for (const b of (container.items || [])) {
            if(!b.content) continue;
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
        const session = params.session;
        (await this.body).model = model;
        await this._save(session);
        return { ok: true, model};
    },
    async _save(session){
        await WORK.fsp.writeFile(this.dir, JSON.stringify(this.body, null, 4), 'utf-8');
        session?.send?.({ path: this.short });
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

const FORM_FIELD_TYPES = new Set(['text', 'number', 'checkbox', 'radio', 'select', 'textarea']);

/** Вырезать JSON-массив полей из ответа модели; остаток — пояснение. */
function parseFormContent(text = '') {
    const raw = String(text ?? '');
    let jsonText = '';
    let content = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
        jsonText = fence[1].trim();
        content = (raw.slice(0, fence.index) + raw.slice(fence.index + fence[0].length)).trim();
    } else {
        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');
        if (start >= 0 && end > start) {
            jsonText = raw.slice(start, end + 1);
            content = (raw.slice(0, start) + raw.slice(end + 1)).trim();
        }
    }
    const parsed = tryParseJsonLoose(jsonText);
    const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : []);
    const fields = list
        .filter(f => f && typeof f === 'object' && f.id != null && String(f.id).trim())
        .map(f => {
            const type = FORM_FIELD_TYPES.has(f.type) ? f.type : 'text';
            const options = Array.isArray(f.options) ? f.options.map(o => String(o)) : [];
            return {
                id: String(f.id).trim(),
                label: String(f.label ?? f.id).trim(),
                type,
                options: (type === 'select' || type === 'radio') ? options : [],
            };
        });
    return { content, fields };
}

function tryParseJsonLoose(s) {
    if (!s?.trim()) return null;
    try { return JSON.parse(s); } catch { /* fallthrough */ }
    try {
        // модели часто отдают ключи без кавычек / одинарные кавычки
        const fixed = s
            .replace(/'/g, '"')
            .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":');
        return JSON.parse(fixed);
    } catch {
        return null;
    }
}

function formatFormAnswers(fields = [], answers = {}) {
    const lines = ['[form answers]'];
    const ids = fields.length ? fields.map(f => f.id) : Object.keys(answers || {});
    for (const id of ids) {
        const label = fields.find(f => f.id === id)?.label || id;
        const v = answers?.[id];
        lines.push(`${label}: ${v == null || v === '' ? '—' : String(v)}`);
    }
    return lines.join('\n');
}

/** Вырезать HTML из ответа модели (```html … ``` или сырой фрагмент с <…>). */
function parseHtmlContent(text = '') {
    const raw = String(text ?? '');
    let html = '';
    let content = raw;
    const fence = raw.match(/```(?:html|htm)?\s*([\s\S]*?)```/i);
    if (fence) {
        html = fence[1].trim();
        content = (raw.slice(0, fence.index) + raw.slice(fence.index + fence[0].length)).trim();
    } else {
        const start = raw.search(/<[a-z][\s\S]*>/i);
        if (start >= 0) {
            html = raw.slice(start).trim();
            content = raw.slice(0, start).trim();
        }
    }
    return { content, html };
}