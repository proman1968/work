/**
 * Типизатор task.ai: TYPES-модель чата + метод prompt (весь harness — здесь, §1.11).
 *
 * Два вида промптов, различаются ролью:
 * - реальный (role USER|BOSS|ADMIN, всегда с клиента, default USER) → блок prompt в ленту;
 * - служебный (role ASSISTENT — самовызовы шагов / авто-ходы) → ТОЛЬКО на острие
 *   messages текущего вызова; в ленту и историю следующих ходов не попадает.
 *
 * prompt — конечный автомат над деревом PIPE (один движок _walk):
 * 1. узел = состояние: prompt (генерация/инъекция), inject (подсказка меню),
 *    next (дети), button (wait), fc (function-calling), askType;
 * 2. заход в узел → проход модели с prompt (с fc если есть) → блок/FC;
 * 3. маршрутизация: 1 ребёнок → переход напрямую; N → меню «step — inject»,
 *    модель выбирает слово → переход; не слово → text (wait);
 * 4. wait-узел (button) → стоп до клиента (Принять/Выполнить/Ответить);
 * 5. лист: fc → _handle_call + continue на thinking; без fc (step) →
 *    отрендеренный prompt как continue-строка (ASSISTENT → thinking);
 * 6. ворот allDone в thinking: все steps done → форс report;
 *    при active task — инъекция текущего пункта (_step_injection) на острие;
 * 7. вызовы, меняющие файлы, → body.pendingAction + кнопка «Выполнить» (wait);
 *    read-only исполняются сразу → tool / tool_result → continue;
 * 8. кнопки (confirm/answers): pendingAction — выполнить/отменить; «Принять» plan →
 *    переход к task; «Принять» report → task.closed + выход на родительский ribbon;
 * 9. продолжения — this.async(() => this.prompt({role:'ASSISTENT', prompt, _turn})),
 *    лимит MAX_AUTO_TURNS → кнопка «Продолжить».
 *
 * Служебные методы файла: stop (флаг this._stopped: инстанс — синглтон
 * parent.__items__, флаг переживает reset), change_model (body.model без on_save).
 *
 * Метод наследуется файлом .ai через merge class.js (this = task.ai файл),
 * вызывается on_save-триггером, микрочатом ($item.fetch('prompt'|'stop'|'change_model'))
 * и самим собой. Тело пишется через fsp (не this.save — иначе повторный on_save).
 */


const THINKING_PROMPT = [
    '\n\n[instruction]\n',
    'Как следует подумай, над тем, что необходимо сделать на следующем шаге,',
    'исходя из контекста и последнего промпта, по смыслу,',
    'и выдай свои размышления (от 5 до 100 строк) о том,',
    'что необходимо сделать на следующем шаге, не повторяйся и не пытайся ничего делать',
].join(' ');
const PLAN_PROMPT = ['Исходя из твоих размышлений выше, предложи план работ.',
    '\n[instruction]',
    'В плане должно быть несколько пунктов в один слой;',
].join('\n');
const REPORT_PROMPT = ['Исходя из твоих размышлений выше, сформируй итоговый отчёт.',
    '\n[instruction]',
    'Что сделано, какие получены результаты и артефакты (только реальные), в формате md.',
    'Только факты из ленты, ничего не выдумывай.',
].join('\n');
const TASK_PROMPT = ['Сделай to do список из согласованного плана.',
    '\n[instruction]',
    'Ответ — ТОЛЬКО нумерованный список: каждый пункт с новой строки,',
    '«N. описание» — одно проверяемое действие с конечным результатом.',
    'Без вступления и пояснений.',
].join('\n');
const DO_PROMPT = ['Исходя из твоих размышлений выше, выполни ровно ОДНО действие — одним вызовом функции:',
    '\n[instruction]',
    'файлы — save_file({filename, post}) | read_file({name}) | edit({filename, post});',
    'данные пользователя — ask_user({questions: [{prompt, options}]});',
    'пункт плана закрыт результатом — complete_step({step: N, summary: "что сделано"}).',
    'Если действие не требуется — дай сам результат обычным текстом.',
].join('\n');
const WEB_PROMPT = ['Найди информацию в интернете ровно ОДНИМ вызовом функции:',
    '\n[instruction]',
    'search({query: "запрос"}) — поиск; fetch_url({url: "https://…"}) — чтение страницы.',
    'Если фактов уже достаточно — изложи выводы обычным текстом.',
].join('\n');
const WORK_PROMPT = ['Найди информацию в рабочей области ровно ОДНИМ вызовом функции:',
    '\n[instruction]',
    'read_file({name}) — файл; get_schema({}) / inspect_schema({path}) — устройство класса;',
    'find_text({text}) / find_item({id}) — поиск; info({}) — состав; logs({}) — журнал.',
    'Если фактов уже достаточно — изложи выводы обычным текстом.',
].join('\n');
const QUESTION_PROMPT = ['Задай пользователю вопросы с вариантами ответов.',
    '\n[instruction]',
    'Вызови функцию ask_user({questions: [{prompt: "вопрос", options: ["вариант 1", "вариант 2", "Другое"]}]}).',
    'Каждому вопросу 2–5 конкретных вариантов из контекста задачи.',
].join('\n');
const FORM_PROMPT = ['Собери форму для ввода данных.',
    '\n[instruction]',
    'Вызови функцию ask_user({questions: [{prompt: "поле"}]}) —',
    'вопросы без options станут полями свободного ввода, с options — выбором.',
].join('\n');
const ASK_USER_PROMPT = ['Задай пользователю один уточняющий вопрос обычным текстом.',
    '\n[instruction]',
    'Только сам вопрос, коротко, без пояснений.',
].join('\n');

/**
 * Дерево пайплайна (конечный автомат). Узел = состояние.
 * Поля узла:
 *   step    — имя (для логики/блоков);
 *   prompt  — генерация/инъекция при заходе в узел (null у чистых роутеров);
 *   inject  — подсказка для меню родителя (сборка «step — inject»);
 *   next    — дети (объект имя→узел); 1 ребёнок → прямой переход, N → выбор словом;
 *   button  — wait-узел (блок + кнопка, стоп до клиента);
 *   fc      — массив разрешённых функций | '*' (все) — FC-проход;
 *   askType  — 'form' | 'questions' для ask_user.
 * Лист без next/button: fc-узел → после _handle_call продолжение на thinking;
 * без fc (только prompt, как step) → отрендеренный prompt как continue-строка.
 */
const PIPE = {
    step: 'thinking',
    prompt: THINKING_PROMPT,
    next: {
        plan: {
            inject: 'если необходимо согласовать план (новый общий план с нуля)',
            prompt: PLAN_PROMPT,
            button: { label: 'Принять' },
            next: { task: { prompt: TASK_PROMPT, next: { step: {
                prompt: 'Делай пункт {n}: «{description}». Ровно одно действие;'
                    + ' закрыв пункт результатом — complete_step({step: {n}, summary: "что сделано"}).'
            } } } }
        },
        research: {
            inject: 'если необходимо что-то исследовать',
            next: {
                search: { inject: 'если необходимо искать', next: {
                    web:  { inject: 'если необходимо найти в интернете',      prompt: WEB_PROMPT,  fc: ['search', 'fetch_url'] },
                    file: { inject: 'если необходимо найти в рабочей области', prompt: WORK_PROMPT, fc: WORK_READ_METHODS }
                } },
                ask: { inject: 'если необходимо уточнить у пользователя', next: {
                    form:      { inject: 'если необходимо заполнить форму',      prompt: FORM_PROMPT,      fc: ['ask_user'], askType: 'form',      button: { label: 'Продолжить' } },
                    questions: { inject: 'если необходимы вопросы с вариантами', prompt: QUESTION_PROMPT, fc: ['ask_user'], askType: 'questions', button: { label: 'Ответить' } },
                    text:      { inject: 'если необходимо задать один вопрос',    prompt: ASK_USER_PROMPT, button: { label: 'Ответить' } }
                } }
            }
        },
        action: { inject: 'если необходимо выполнить одно действие', prompt: DO_PROMPT, fc: '*' },
        report: { inject: 'если все пункты закрыты или пора отчитаться', prompt: REPORT_PROMPT, button: { label: 'Принять' } }
    }
};


export default {
    icon: 'bootstrap:robot',
    // Лениво: const TYPES/FIELDS объявлены ниже по файлу (TDZ при прямом обращении)
    get TYPES() { return TYPES; },
    get FIELDS() { return FIELDS; },
    get body(){
        return this.load({ encoding: 'utf-8' }).then(raw => {
            this.body = JSON.parse(raw);
            this.body.ribbon ??= [];
            return this.body;
        });
    },
    /**
     * Автомат task.ai — обход дерева PIPE (конечный автомат).
     * Реальный вход (role USER|BOSS|ADMIN): text → блок prompt + _walk(PIPE);
     * confirm/answers — разбор кнопок/wait-узлов (был _confirm, свёрнут сюда).
     * Служебный вход (role ASSISTENT): без блока prompt, только острие messages;
     * продолжения самовызовами с лимитом MAX_AUTO_TURNS → кнопка «Продолжить».
     * @param {object} params — { prompt?, user?, role?, confirm?, answers?, model?, _turn? }
     * @param {object|FormData} [post] вложения: { files?, urls? } — сохранить в папку задачи
     */
    async prompt(params = {}, post) {
        let {prompt, role, user} = params;
        const turn = Number(params._turn) || 0;
        try{
            const isService = role === 'ASSISTENT';
            if(!isService){
                this._stopped = false; // новый реальный ход снимает Stop прошлого цикла
                if(params.model)
                    (await this.body).model = params.model;
                if(params.confirm !== undefined || params.answers){
                    prompt = await this._resolve_button(params, user);
                    if(prompt){
                        this.async(()=>{
                            this.prompt({
                                role: 'ASSISTENT',
                                prompt,
                                user,
                                _turn: 1
                            })
                        })
                        return {ok: true}
                    }
                    user?.send?.({ type: 'chat.done', path: this.short });
                    return {ok: true};
                }
                // Вложения из post (FormData → { files, urls }): сохранить в папку задачи,
                // показать блоками file, дополнить промпт списком путей.
                const attached = post ? await this._handle_attachments(post, user) : [];
                if(attached.length){
                    const list = attached.map(a => a.path || a.name).filter(Boolean).join('\n');
                    if(list)
                        prompt = (prompt ? prompt + '\n\n' : '') + 'Вложенные файлы:\n' + list;
                }
                await this._push_block(user,{
                    type: 'prompt',
                    content: prompt
                })
            }
            if(turn >= MAX_AUTO_TURNS){
                await this._push_block(user,{
                    type: 'action',
                    title: 'Лимит авто-ходов',
                    content: 'Достигнут лимит ' + MAX_AUTO_TURNS + ' авто-ходов подряд.',
                    button: {
                        label: 'Продолжить',
                        color: 'primary'
                    }
                })
            }
            else{
                const messages = await this.context();
                prompt = await this._walk(PIPE, messages, user, prompt);
                if(prompt && !this._stopped){
                    this.async(()=>{
                        this.prompt({
                            role: 'ASSISTENT',
                            prompt,
                            user,
                            _turn: turn + 1
                        })
                    })
                    return {ok: true}
                }
            }
        }
        catch(e){
            await this._push_block(user,{
                type: 'error',
                content: e.message
            })
        }

        user?.send?.({ type: 'chat.done', path: this.short });
        return {ok: true};
    },
    /**
     * Разбор кнопок/ответов wait-узлов (был _confirm, свёрнут).
     * pendingAction — выполнить/отменить вызовы; «Принять» plan → переход к task;
     * «Принять» report → закрыть задачу; answers → значения в поля.
     * @returns {Promise<string|undefined>} continue-строка для ASSISTENT-самовызова
     */
    async _resolve_button(params, user){
        const {confirm, answers} = params;
        const body = await this.body;
        const open = await this._open_interactive();
        if(open)
            open.answered = true;

        // Подтверждение файл-модифицирующего вызова
        if(body.pendingAction){
            const calls = body.pendingAction.calls || [];
            delete body.pendingAction;
            if(confirm === false){
                for(const call of calls){
                    await this._push_block(user, {
                        type: 'tool_result',
                        tool: call.method,
                        ok: false,
                        content: 'Действие отменено пользователем',
                    });
                }
                return 'Пользователь отменил действие.';
            }
            let follow;
            for(const call of calls)
                follow = await this._execute_call(call, user);
            return follow;
        }

        if(!open){
            await this._save(user);
            return;
        }
        if(confirm === false){
            await this._push_block(user, { type: 'prompt', content: 'Отменено' });
            return 'Пользователь отменил действие.';
        }
        // Ответы опроса/формы → значения в поля + факт в ленту
        if(answers && typeof answers === 'object'){
            for(const f of open.fields || []){
                if(answers[f.id] !== undefined)
                    f.value = answers[f.id];
            }
            const content = Object.entries(answers)
                .map(([id, v]) => (open.fields?.find(f => f.id === id)?.label || id) + ': ' + v)
                .join('\n');
            await this._push_block(user, { type: 'prompt', content });
            return 'Ответы пользователя получены — продолжай.';
        }
        const label = String(open.button?.label || open.title || 'OK');
        await this._push_block(user, { type: 'prompt', content: label });
        // «Принять» отчёта — закрыть task, всплыть на родителя (если есть)
        if(open.type === 'report' || open.title === 'Отчёт'){
            const chain = await this._task_chain();
            const task = chain[chain.length - 1];
            if(task){
                for(const s of task.steps || [])
                    if(s.status !== 'done')
                        s.status = 'done';
                task.state = 'completed';
                task.closed = true;
            }
            await this._push_block(user, {
                type: 'text',
                content: 'Задача завершена' + (task?.label ? ': ' + task.label : '.'),
            });
            const parent = chain.length >= 2 ? chain[chain.length - 2] : null;
            if(!parent)
                return; // корень — chat.done
            const cur = parent.steps?.find(s => s.status === 'in_progress')
                || parent.steps?.find(s => s.status === 'proposed');
            if(cur){
                return 'Подзадача «' + (task?.label || '') + '» закрыта отчётом. Продолжай пункт '
                    + cur.step + ' плана: «' + cur.description + '».'
                    + ' Закрыв пункт результатом — complete_step({step: ' + cur.step
                    + ', summary: "что сделано"}).';
            }
            return 'Подзадача закрыта отчётом — продолжай.';
        }
        // «Принять» плана → переход к task-узлу дерева PIPE
        if(open.type === 'plan' || open.title === 'План'){
            const messages = await this.context();
            return this._walk(PIPE.next.plan.next.task, messages, user);
        }
        return 'Пользователь подтвердил: «' + label + '». Продолжай.';
    },
    /**
     * Единый движок обхода дерева PIPE (конечный автомат).
     * Заход в узел → генерация/инъекция (prompt, опционально fc) → маршрутизация
     * (1 ребёнок напрямую, N — выбор словом из inject) → переход. Wait-узел (button)
     * стоп. Лист: fc → _handle_call + continue на thinking; без fc (step) →
     * отрендеренный prompt как continue-строка. Ворот allDone в thinking → форс report.
     * @returns {Promise<string|undefined>} continue-строка для ASSISTENT-самовызова
     */
    async _walk(node, messages, user, lead){
        // 0. continue-лист (step): отрендеренный prompt как continue-строка, без прохода модели
        if(node.prompt && !node.next && !node.fc && !node.button){
            const task0 = await this._active_task();
            const cur0 = task0?.steps?.find(s => s.status === 'in_progress')
                || task0?.steps?.find(s => s.status === 'proposed');
            return String(node.prompt)
                .replace(/\{n\}/g, String(cur0?.step ?? ''))
                .replace(/\{description\}/g, String(cur0?.description ?? ''));
        }
        // 1. Генерация / инъекция
        if(node.prompt){
            const task = await this._active_task();
            const cur = task?.steps?.find(s => s.status === 'in_progress')
                || task?.steps?.find(s => s.status === 'proposed');
            const render = s => String(s)
                .replace(/\{n\}/g, String(cur?.step ?? ''))
                .replace(/\{description\}/g, String(cur?.description ?? ''));
            // thinking: lead (continue/user-текст) + инъекция пункта + THINKING мерджится
            // в последний user-промпт (REPLACE — как старый _thinking); прочие узлы — push.
            if(node.step === 'thinking'){
                const full = String(lead ?? '') + (await this._step_injection()) + render(node.prompt);
                if(messages.last?.role === 'user')
                    messages.last.content = full;
                else
                    messages.push({ role: 'user', content: full });
                const { content, usage } = await this.streamChat({ messages }, user);
                if(this._stopped)
                    return;
                await this._push_block(user, { type: 'thinking', content, usage });
                // перестроить messages: теперь thinking — assistant, маршрутизация идёт после него
                messages = await this.context();
            }
            else if(node.fc){
                // FC-проход
                let functions = await this.functions();
                if(node.fc !== '*')
                    functions = functions.filter(f => node.fc.includes(f.name));
                messages.push({ role: 'user', content: render(node.prompt) });
                const { content, usage, calls } = await this.streamChat({ messages, functions }, user);
                if(this._stopped)
                    return;
                if(calls[0])
                    return this._handle_call(calls[0], user, node.askType);
                await this._push_block(user, { type: 'text', content, usage });
                return; // wait
            }
            else{
                // plain-генерация: новое user-сообщение
                messages.push({ role: 'user', content: render(node.prompt) });
                const { content, usage } = await this.streamChat({ messages }, user);
                if(this._stopped)
                    return;
                const block = { type: node.step, content, usage };
                if(node.step === 'plan' || node.step === 'report'){
                    block.title = node.step === 'plan' ? 'План' : 'Отчёт';
                    block.button = node.button;
                }
                else if(node.step === 'task'){
                    // to-do из плана → steps
                    const steps = [];
                    for(const m of String(content).matchAll(/^\s*\d+[.)]\s*(.+)$/gm)){
                        const description = m[1].replace(/\*\*/g, '').trim();
                        if(description)
                            steps.push({ step: steps.length + 1, description, status: 'proposed' });
                    }
                    if(!steps.length){
                        await this._push_block(user, { type: 'text', content, usage });
                        return; // to-do не распознан — ждём пользователя
                    }
                    steps[0].status = 'in_progress';
                    block.label = steps[0].description.slice(0, 120);
                    block.content = steps.map(s => s.step + '. ' + s.description).join('\n');
                    block.state = 'active';
                    block.steps = steps;
                    block.ribbon = [];
                }
                await this._push_block(user, block);
                if(node.button)
                    return; // wait-узел
                // task → прямой переход к step (1 ребёнок) отдаёт continue-строку
                if(node.step === 'task'){
                    const child = Object.values(node.next)[0];
                    return this._walk(child, messages, user);
                }
            }
        }
        // 2. Маршрутизация
        const next = node.next;
        const keys = next ? Object.keys(next) : [];
        if(node.button)
            return; // wait после генерации
        if(!keys.length){
            // лист без next: step-узел отдаёт отрендеренный prompt как continue-строку
            return node.prompt ? undefined : undefined;
        }
        if(keys.length === 1)
            return this._walk(next[keys[0]], messages, user); // прямой переход
        // N детей → меню из inject
        const menu = 'Ответь ровно ОДНИМ словом, без знаков препинания и пояснений:\n'
            + keys.map(k => k + ' — ' + next[k].inject).join('\n');
        messages.push({ role: 'user', content: menu });
        const { content, usage } = await this.streamChat({ messages }, user);
        if(this._stopped)
            return;
        let route = String(content).trim().replace(/[.!]+$/, '').toLowerCase();
        // Ворот allDone (только thinking): все шаги закрыты → форс report
        if(node.step === 'thinking'){
            const t = await this._active_task();
            if(t?.steps?.length && t.steps.every(s => s.status === 'done')
                && route !== 'report' && route !== 'cancel')
                route = 'report';
        }
        if(next[route]){
            messages.pop();
            return this._walk(next[route], messages, user);
        }
        // не слово-маршрут — ответ пользователю, wait
        await this._push_block(user, { type: 'text', content, usage });
    },
    /**
     * Один стрим-ход модели. context = { messages, functions? };
     * content-чанки → text + delta в WS, function_call → calls[{method, args}].
     */
    async streamChat(context, userSession){
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
    /**
     * Один вызов функции модели: ask_user → опрос/форма (wait);
     * complete_step → движок шагов; файл-модифицирующий → pendingAction +
     * кнопка «Выполнить» (wait); read-only → немедленное исполнение.
     * @returns {Promise<string|undefined>} промпт продолжения
     */
    async _handle_call(call, userSession, askType){
        if(call.method === 'ask_user')
            return this._push_questions(call.args, userSession, askType || 'questions');
        if(call.method === 'complete_step')
            return this._complete_step(call.args, userSession);
        if(WRITE_METHODS.includes(call.method)){
            (await this.body).pendingAction = { calls: [call] };
            await this._push_block(userSession, {
                type: 'action',
                title: 'Действие',
                content: call.method + ' ' + JSON.stringify(call.args || {}).slice(0, 300),
                button: {
                    label: 'Выполнить',
                    color: 'warning'
                },
            });
            return; // wait: подтверждение пользователя
        }
        return this._execute_call(call, userSession);
    },
    /** Исполнить вызов: блоки tool / tool_result (+ карточка file при записи). */
    async _execute_call(call, userSession){
        await this._push_block(userSession, {
            type: 'tool',
            name: call.method,
            args: call.args || {},
            content: call.method + ' ' + JSON.stringify(call.args || {}).slice(0, 300),
        });
        let result;
        try{
            result = await this._run_tool(call, userSession);
        }
        catch(e){
            result = { error: e.message };
        }
        const ok = !(result && typeof result === 'object' && result.error);
        await this._push_block(userSession, {
            type: 'tool_result',
            tool: call.method,
            ok,
            content: (typeof result === 'string'
                ? result
                : JSON.stringify(result, null, 2) ?? '').slice(0, 32000),
        });
        if(ok && result?.path && WRITE_METHODS.includes(call.method)){
            await this._push_block(userSession, {
                type: 'file',
                path: result.path,
                name: result.name || call.args?.filename || '',
                content: result.path,
            });
        }
        return ok
            ? 'Результат ' + call.method + ' получен — продолжай.'
            : 'Вызов ' + call.method + ' завершился ошибкой — исправь вызов или сообщи пользователю.';
    },
    /**
     * Вложения из post (FormData → { files, urls }): сохранить в папку задачи,
     * показать блоками file в ленте. Возвращает список { name, path }.
     * @param {object} post — { files?: object[], urls?: string[] }
     * @param {object} userSession
     * @returns {Promise<Array<{name:string,path:string}>>}
     */
    async _handle_attachments(post, userSession){
        if(!post || typeof post !== 'object')
            return [];
        const files = Array.isArray(post.files) ? post.files : post.files ? [post.files] : [];
        const urls = Array.isArray(post.urls) ? post.urls : post.urls ? [post.urls] : [];
        if(!files.length && !urls.length)
            return [];
        const folder = this.parent;
        const saved = [];
        for(const f of files){
            try{
                const filename = f.originalFilename || f.name || ('file_' + Date.now());
                const log = await folder.save_file({
                    filename,
                    post: f,
                    encoding: 'utf-8',
                    user: userSession,
                    ignore_save_logs: true,
                });
                const path = log?.path || log?.logFullPath || log?.logPath || '';
                saved.push({ name: filename, path });
                await this._push_block(userSession, {
                    type: 'file',
                    path,
                    name: filename,
                    content: path,
                });
            }
            catch(e){
                await this._push_block(userSession, {
                    type: 'error',
                    content: 'Вложение не сохранено: ' + e.message,
                });
            }
        }
        if(urls.length){
            try{
                const logs = await folder.save_files({
                    post: { urls },
                    user: userSession,
                    ignore_save_logs: true,
                });
                const arr = Array.isArray(logs) ? logs : logs ? [logs] : [];
                for(const log of arr){
                    const path = log?.path || log?.logFullPath || log?.logPath || '';
                    const name = log?.name || (path ? String(path).split('/').pop() : 'url');
                    saved.push({ name, path });
                    await this._push_block(userSession, {
                        type: 'file',
                        path,
                        name,
                        content: path,
                    });
                }
            }
            catch(e){
                await this._push_block(userSession, {
                    type: 'error',
                    content: 'URL не загружен: ' + e.message,
                });
            }
        }
        return saved;
    },
    /** Диспетчер tool: файлы — папка задачи; сервисы /SERVICES/*; иначе метод класса. */
    async _run_tool(call, userSession){
        const args = call.args && typeof call.args === 'object' ? call.args : {};
        const folder = this.parent;
        if(call.method === 'save_file' || call.method === 'write_file'){
            const filename = args.filename || args.name;
            if(!filename)
                return { error: 'save_file: нужен filename' };
            const log = await folder.save_file({
                filename: String(filename),
                post: String(args.post ?? args.content ?? ''),
                encoding: 'utf-8',
                user: userSession,
            });
            return {
                success: true,
                message: 'Файл сохранён: ' + filename,
                name: String(filename),
                path: log?.path || '',
            };
        }
        if(call.method === 'edit' || call.method === 'edit_file'){
            const filename = String(args.filename || args.name || '');
            const file = filename && await folder._get_item(filename);
            if(!file?.edit)
                return { error: 'Файл не найден: ' + filename };
            const text = await file.edit({ post: String(args.post ?? args.diff ?? ''), user: userSession });
            return {
                success: true,
                message: 'Файл изменён: ' + filename,
                name: filename,
                path: file.path || '',
                content: String(text ?? '').slice(0, 4000),
            };
        }
        if(call.method === 'read_file'){
            const name = String(args.name || args.filename || '');
            const file = name && await folder._get_item(name);
            if(!file?.load)
                return { error: 'Файл не найден: ' + name };
            const content = await file.load({ encoding: 'utf-8' });
            return { name, content: String(content).slice(0, 32000) };
        }
        // Сервисные tools (/SERVICES/*: search, fetch_url, …)
        const service = await this._service_with_method(call.method);
        if(service)
            return service[call.method](args);
        // Метод / свойство контекстного класса
        const context = await this.context_item();
        const fn = context[call.method];
        if(typeof fn === 'function')
            return fn.call(context, { ...args, user: userSession });
        if(fn !== undefined)
            return fn;
        return { error: 'Метод «' + call.method + '» не найден у ' + (context.type || context.path || '?') };
    },
    /** Движок шагов: закрыть пункт активной задачи и прислать следующий. */
    async _complete_step(args = {}, userSession){
        const task = await this._active_task();
        if(!task?.steps?.length){
            await this._push_block(userSession, {
                type: 'tool_result',
                tool: 'complete_step',
                ok: false,
                content: 'Нет активной задачи с шагами',
            });
            return 'Активной задачи нет — продолжай по смыслу.';
        }
        const num = Number(args.step);
        const cur = (num > 0 && task.steps.find(s => s.step === num && s.status !== 'done'))
            || task.steps.find(s => s.status === 'in_progress')
            || task.steps.find(s => s.status === 'proposed');
        if(!cur){
            await this._save(userSession);
            return 'Все пункты плана выполнены — сформируй отчёт (ответь словом report).';
        }
        cur.status = 'done';
        if(args.summary)
            cur.summary = String(args.summary).slice(0, 500);
        const next = task.steps.find(s => s.status !== 'done');
        if(next){
            next.status = 'in_progress';
            await this._save(userSession);
            return 'Пункт ' + cur.step + ' закрыт. Делай пункт ' + next.step + ' плана: «' + next.description + '».'
                + ' Ровно одно действие; закрыв пункт результатом —'
                + ' complete_step({step: ' + next.step + ', summary: "что сделано"}).';
        }
        await this._save(userSession);
        return 'Все пункты плана выполнены — сформируй отчёт (ответь словом report).';
    },
    /** ask_user({questions}) → блок questions|form (select при options, иначе textarea). */
    async _push_questions(args = {}, userSession, type = 'questions'){
        const src = Array.isArray(args.questions) ? args.questions
            : Array.isArray(args.fields) ? args.fields : [];
        const fields = src.map((q, i) => {
            const label = String(q?.prompt || q?.label || '').trim();
            if(!label)
                return null;
            const options = (Array.isArray(q?.options) ? q.options : []).filter(Boolean).map(String);
            return {
                id: String(q?.id || 'q' + (i + 1)),
                label,
                type: options.length ? 'select' : 'textarea',
                ...(options.length ? { options } : {}),
                value: '',
            };
        }).filter(Boolean);
        if(!fields.length){
            await this._push_block(userSession, {
                type: 'text',
                content: 'Уточнение не сформулировано.',
            });
            return;
        }
        await this._push_block(userSession, {
            type,
            title: String(args.title || 'Уточнение'),
            content: fields.map(f => '- ' + f.label).join('\n'),
            fields,
            button: {
                label: type === 'form' ? 'Продолжить' : 'Ответить',
                color: 'primary'
            },
        });
    },
    /** Functions (OpenAI-compatible): схема контекстного класса + /SERVICES/* + harness. */
    async functions(){
        const context = await this.context_item();
        let functions = [];
        const schema = await context.get_schema?.();
        if(schema?.methods){
            const { pathToFileURL } = await import('node:url');
            const { buildFunctionsFromSchema } = await import(
                pathToFileURL(process.cwd() + '/sources/modules/ai-schema.js').href
            );
            functions = buildFunctionsFromSchema(schema.methods, {
                exclude: ['delete', 'save_secret', 'read_secret'],
            });
        }
        const services = await WORK.get_item('/SERVICES/*');
        const list = Array.isArray(services) ? services : services ? [services] : [];
        for(const svc of list){
            if(svc.type !== '$service' || !svc.SCHEMA)
                continue;
            for(const [name, info] of Object.entries(svc.SCHEMA)){
                if(!functions.find(f => f.name === name)){
                    functions.push({
                        name,
                        description: info.description || name,
                        parameters: info.params || { type: 'object', properties: {} },
                    });
                }
            }
        }
        for(const fn of HARNESS_FUNCTIONS){
            if(!functions.find(f => f.name === fn.name))
                functions.push({ ...fn });
        }
        return functions;
    },
    /** Контекст tools: домашний класс задачи (файловые операции — папка задачи). */
    async context_item(){
        return this.$owner || this.parent;
    },
    /**
     * Цепочка незакрытых task от корня к самой глубокой.
     * Вложенность: subplan лежит в ribbon родителя.
     */
    async _task_chain(){
        let body = await this.body;
        const chain = [];
        while(body){
            if(Array.isArray(body.steps) && !body.closed)
                chain.push(body);
            body = (body.ribbon || []).filter(b => b.ribbon && !b.closed).last;
        }
        return chain;
    },
    /** Самая глубокая незакрытая задача (блок со steps по цепочке активных ribbon). */
    async _active_task(){
        const chain = await this._task_chain();
        return chain.length ? chain[chain.length - 1] : null;
    },
    /**
     * Инъекция текущего пункта / прогресса на острие _walk(thinking) (не в ленту).
     * @returns {Promise<string>}
     */
    async _step_injection(){
        const task = await this._active_task();
        if(!task?.steps?.length)
            return '';
        const done = task.steps.filter(s => s.status === 'done').length;
        const total = task.steps.length;
        const label = task.label || '';
        if(done === total){
            return '\n\n[context]\nАктивная задача: «' + label + '»; прогресс ' + done + '/' + total
                + '. Все пункты закрыты — сформируй отчёт (маршрут report).';
        }
        const cur = task.steps.find(s => s.status === 'in_progress')
            || task.steps.find(s => s.status === 'proposed');
        if(!cur)
            return '';
        return '\n\n[context]\nАктивная задача: «' + label + '»; прогресс ' + done + '/' + total
            + '; сейчас пункт ' + cur.step + ': «' + cur.description + '».'
            + ' Не начинай новый общий план с нуля; закрой пункт через complete_step,'
            + ' когда результат есть. Все пункты закрыты → report.';
    },
    /** Сервис /SERVICES/* с методом name, либо null. */
    async _service_with_method(name){
        const services = await WORK.get_item('/SERVICES/*');
        const list = Array.isArray(services) ? services : services ? [services] : [];
        for(const svc of list){
            if(svc.type === '$service' && typeof svc[name] === 'function')
                return svc;
        }
        return null;
    },
    /** Последний неотвеченный интерактив (plan/report/action/questions/form) активной ленты. */
    async _open_interactive(){
        const ribbon = await this.get_active_ribbon();
        return [...ribbon].reverse().find(b =>
            (b.type === 'plan' || b.type === 'report' || b.type === 'action'
                || b.type === 'questions' || b.type === 'form')
            && b.button && !b.answered);
    },
    async context(){
        let body = await this.body;
        const walk_ribbon = (block, out)=>{
            for (const b of block.ribbon){
                out.push({
                    role: b.type === 'prompt' ? 'user' : 'assistant',
                    content: b.type === 'prompt'? b.content :b.type + ':\n\n' + b.content,
                });
                if(b.ribbon)
                    walk_ribbon(b, out);
            }
            return out;
        }
        let out = [];
        out.push({
            role: 'system',
            content: body.system,
        });
        return walk_ribbon(body, out);
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
        let ribbon = await this.get_active_ribbon();
        block.time = Date.now();
        ribbon.push(block);
        await this._save(userSession);
    },
    async get_active_ribbon(){
        let body = await this.body;
        if(body.closed)
            return [];
        let ribbon;
        while(body){
            ribbon = body.ribbon;
            body = ribbon.filter(block => block.ribbon && !block.closed).last;
        }
        return ribbon;
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

/** Максимум авто-проходов подряд без участия пользователя. */
const MAX_AUTO_TURNS = 30;
/** Методы, меняющие файлы/систему, — только через pendingAction + «Выполнить». */
const WRITE_METHODS = [
    'save_file', 'write_file', 'edit', 'edit_file',
    'create', 'delete', 'set_property', 'save_secret',
];
/** Read-only набор ветки work (поиск в рабочей области). */
const WORK_READ_METHODS = [
    'read_file', 'get_schema', 'inspect_schema',
    'find_item', 'find_text', 'semantic_search', 'info', 'logs',
];
/** Tools harness: только то, чего может не быть в схеме класса. */
const HARNESS_FUNCTIONS = [
    {
        name: 'save_file',
        description: 'Создать или перезаписать файл. filename — конечное имя артефакта; перезаписывай ТО ЖЕ имя — history пишется сама.',
        parameters: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: 'Конечное имя файла (одно на артефакт)' },
                post: { type: 'string', description: 'Полное содержимое файла (текущая версия)' },
            },
            required: ['filename', 'post'],
        },
    },
    {
        name: 'read_file',
        description: 'Прочитать файл задачи по имени.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Имя файла' },
            },
            required: ['name'],
        },
    },
    {
        name: 'edit',
        description: 'Точечная правка файла SEARCH/REPLACE (не полный rewrite). Полная перезапись — save_file.',
        parameters: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: 'Имя файла' },
                post: { type: 'string', description: 'Diff SEARCH/REPLACE' },
            },
            required: ['filename', 'post'],
        },
    },
    {
        name: 'ask_user',
        description: 'Уточняющие вопросы пользователю. Каждый вопрос — options: 2–5 конкретных вариантов + «Другое»; свободный ответ — вопрос без options.',
        parameters: {
            type: 'object',
            properties: {
                questions: {
                    type: 'array',
                    description: 'Вопросы: id, prompt, options',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            prompt: { type: 'string', description: 'Текст вопроса' },
                            options: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['prompt'],
                    },
                },
                title: { type: 'string', description: 'Заголовок опроса' },
            },
            required: ['questions'],
        },
    },
    {
        name: 'complete_step',
        description: 'Закрыть текущий пункт активной задачи (status: done), когда его результат получен. Система сама пришлёт следующий пункт или запросит отчёт.',
        parameters: {
            type: 'object',
            properties: {
                step: { type: 'number', description: 'Номер пункта; по умолчанию текущий in_progress' },
                summary: { type: 'string', description: 'Краткий итог (1–2 фразы, пути артефактов)' },
            },
        },
    },
];

const TYPES = {
    /**
     * Автомат «одно действие за ход». Состояние = тип последнего блока ленты.
     * servicePrompt — инъекция ТОЛЬКО на острие messages (не в ленту, не в историю).
     * Строка — один текст для всех ролей; объект — варианты по роли
     * ({ default, USER, BOSS, ADMIN, ASSISTENT }).
     * После реального промпта единственное действие — думать (thinking);
     * после thinking — развилка из TYPES.thinking.servicePrompt.
     */
    prompt: {
        // Think-ход: functions в запрос не передаются, весь ответ целиком
        // харнесс фиксирует блоком thinking — никакие теги не нужны.
        servicePrompt: [
            'Как следует подумай, над тем, что необходимо сделать на следующем шаге,',
            'исходя из контекста и последнего промпта, по смыслу,',
            'и выдай свои размышления (от 5 до 100 строк) о том,',
            'что необходимо сделать на следующем шаге, не повторяйся и не пытайся ничего делать',
        ].join(' '),
        fields: [
            { id: 'type', type: 'string' },
            { id: 'content', type: 'string' },
            { id: 'time', type: 'number' },
            { id: 'sender', type: 'string' },
            {
                id: 'usage',
                fields: [
                    { id: 'prompt', type: 'number' },
                    { id: 'completion', type: 'number' },
                    { id: 'total', type: 'number' },
                    { id: 'contextPct', type: 'number' },
                    { id: 'contextWindow', type: 'number' },
                ],
            },
        ],
    },
    thinking: {
        extends: 'TYPES.prompt',
        // Action-ход: ровно одно действие — либо ответ обычным текстом,
        // либо вызов ОДНОЙ функции по точному имени (function calling).
        servicePrompt: {
            default: [
                '- если это вопрос, то ответить на него',
                '- если это задача, и что-то непонятно, то задать уточняющие вопросы (text, queries, form)',
                '- если это простая задача, и все абсолютно понятно, то выполнить её',
                '- если это сложная задача, и все абсолютно понятно, создать план из 3-6 шагов (или столько, сколько надо, возможно с вложениями) и предоставить пользователю на согласование',


                'Размышления зафиксированы — не повторяй их. Сделай ровно ОДНО действие:',
                '• это вопрос/справка → ответь обычным текстом;',
                '• не хватает данных пользователя → вызови функцию ask_user, пример:',
                'ask_user({questions: [{prompt: "Какой формат?", options: ["PDF", "HTML", "Другое"]}]});',
                '• это задача «сделай X» → вызови функцию propose_plan с 3–6 шагами, пример:',
                'propose_plan({steps: [{description: "Уточнить требования"}, {description: "Собрать структуру"}, {description: "Сохранить файл"}]});',
                '• нужны внешние факты → вызови функцию search({query: "запрос"}).',
                'Либо текст, либо один вызов функции — не оба сразу.',
                'Имя функции в тексте ответа не исполняется — только настоящий вызов.',
            ].join(' '),
            USER: [
                'Размышления зафиксированы — не повторяй их. Сделай ровно ОДНО действие:',
                'вопрос → ответь обычным текстом;',
                'нужны данные → вызови функцию ask_user (каждому вопросу options 3–5 + «Другое», пользователь на мобильном), пример:',
                'ask_user({questions: [{prompt: "Какой формат презентации?", options: ["PDF", "HTML", "Другое"]}]});',
                'задача → вызови функцию propose_plan с 3–6 шагами, пример:',
                'propose_plan({steps: [{description: "Уточнить тему"}, {description: "Собрать структуру"}, {description: "Сохранить presentation.html"}]});',
                'результат каждого шага — файл через save_file (текстовый html/md).',
                'Либо текст, либо один вызов функции.',
                'Имя функции в тексте ответа не исполняется — только настоящий вызов.',
            ].join(' '),
            BOSS: [
                'Размышления зафиксированы — не повторяй их. Сделай ровно ОДНО действие:',
                'вопрос → ответь обычным текстом; нужны данные → вызови функцию ask_user({questions: [{prompt, options}]});',
                'задача → вызови функцию propose_plan({steps: [{description}, …]}): шаги — поручения и контрольные точки, крупные направления — spawn_agent.',
                'Либо текст, либо один вызов функции.',
                'Имя функции в тексте ответа не исполняется — только настоящий вызов.',
            ].join(' '),
            ADMIN: [
                'Размышления зафиксированы — не повторяй их. Сделай ровно ОДНО действие:',
                'вопрос → ответь обычным текстом; нужны данные → вызови функцию ask_user({questions: [{prompt, options}]});',
                'задача по классу → вызови функцию propose_plan({steps: [{description}, …]}): сначала inspect_schema/read_file, правки точечным edit (diff), затем проверка и обновление readme.md.',
                'Либо текст, либо один вызов функции.',
                'Имя функции в тексте ответа не исполняется — только настоящий вызов.',
            ].join(' '),
            ASSISTENT: [
                'Размышления зафиксированы — не повторяй их. Выполни текущий пункт плана ровно ОДНИМ вызовом функции:',
                'артефакт → save_file({filename: "presentation.html", post: "<!DOCTYPE html>… полное содержимое"});',
                'внешние факты → search({query: "запрос"}), затем fetch_url({url: "https://…"});',
                'данные пользователя → ask_user({questions: [{prompt: "вопрос", options: ["вариант 1", "вариант 2", "Другое"]}]});',
                'пункт закрыт результатом → complete_step({step: N, summary: "что сделано"}).',
                'Если все пункты уже закрыты → вызови функцию report({content: "итог по реальным артефактам"}).',
                'Не отвечай прозой вместо вызова функции, не предлагай новый план.',
                'Псевдовызовы в тексте («subplan <…>», «{subplan}[…]», «ask_user(…)» строкой) не исполняются — только настоящий function call.',
            ].join(' '),
        },
    },
    // text / action / form / questions — wait-состояния (без servicePrompt):
    // автомат остановлен, следующего хода модели нет.
    text: {
        extends: 'TYPES.prompt',
    },
    /** Tip: План/Начать | Отчёт/Принять | Выполнить */
    action: {
        extends: 'TYPES.prompt',
        fields: [
            { id: 'title', type: 'string', options: ['План', 'Отчёт', 'Действие'] },
            { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
        ],
    },
    form: {
        extends: 'TYPES.prompt',
        fields: [
            { id: 'title', type: 'string' },
            { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
            {
                id: 'fields',
                type: 'array',
                fields: [
                    { id: 'id', type: 'string' },
                    { id: 'label', type: 'string' },
                    { id: 'type', options: ['text', 'textarea', 'select', 'checkbox', 'number', 'email', 'date'] },
                    { id: 'options', type: 'array' },
                    { id: 'value' },
                ],
            },
        ],
    },
    questions: {
        extends: 'TYPES.prompt',
        fields: [
            { id: 'title', type: 'string' },
            { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
            {
                id: 'fields',
                type: 'array',
                fields: [
                    { id: 'id', type: 'string' },
                    { id: 'label', type: 'string' },
                    { id: 'type', options: ['text', 'textarea', 'select', 'checkbox', 'number', 'email', 'date'] },
                    { id: 'options', type: 'array' },
                    { id: 'value' },
                ],
            },
            { id: 'step', type: 'number' },
        ],
    },
    step: {
        fields: [
            { id: 'step', type: 'number' },
            { id: 'description', type: 'string' },
            { id: 'status', options: ['proposed', 'in_progress', 'done'] },
        ],
    },
    task: {
        extends: 'TYPES.prompt',
        servicePrompt: [
            'Задача активна: пункты плана присылает система («Делай пункт N»).',
            'Пункт закрыт результатом → complete_step({step: N, summary: "что сделано"}).',
            'Декомпозиция текущего пункта — только вызов функции subplan({steps: [{description: "подшаг 1"}, {description: "подшаг 2"}]}), не текстом.',
            'Не предлагай новый общий план. completed — только после «Принять».',
        ].join(' '),
        fields: [
            { id: 'label', type: 'string' },
            { id: 'state', options: ['active', 'completed', 'cancelled'] },
            { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
            {
                id: 'steps',
                type: 'array',
                fields: [
                    { id: 'step', type: 'number' },
                    { id: 'description', type: 'string' },
                    { id: 'status', options: ['proposed', 'in_progress', 'done'] },
                ],
            },
            { id: 'ribbon', type: 'TYPES.ribbon' },
        ],
    },
    file: {
        extends: 'TYPES.prompt',
        servicePrompt: [
            'Вложение {path} ({name}) в контексте. Учти файл; при необходимости вызови функцию read_file({path}).',
            'Дальше ровно одно действие: следующий вызов функции по текущему пункту или ответ текстом.',
        ].join(' '),
        fields: [
            { id: 'path', type: 'string' },
            { id: 'name', type: 'string' },
        ],
    },
    tool: {
        extends: 'TYPES.prompt',
        servicePrompt: [
            'Вызов tool отправлен. Дождись tool_result. Не повторяй тот же вызов без результата.',
        ].join(' '),
        fields: [
            { id: 'name', type: 'string' },
            { id: 'args' },
        ],
    },
    tool_result: {
        extends: 'TYPES.prompt',
        servicePrompt: {
            default: [
                'Результат tool (ok={ok}, tool={tool}). Ровно ОДНО действие:',
                'если ok и текущий пункт плана закрыт этим результатом → complete_step({step: N, summary: "что сделано"});',
                'если ok, но пункт не закрыт → следующий вызов функции пункта (например save_file({filename: "имя.html", post: "полное содержимое"}));',
                'если ошибка — в её тексте сказано, что делать: исправленный вызов функции, не тот же и не псевдовызов в тексте.',
                'Не объявляй completed — это делает «Принять». Не отвечай прозой.',
            ].join(' '),
        },
        fields: [
            { id: 'tool', type: 'string' },
            { id: 'ok', type: 'boolean' },
        ],
    },
    error: {
        extends: 'TYPES.prompt',
        servicePrompt: [
            'Ошибка в истории. Ровно одно действие: исправленный вызов функции, ask_user({questions}) или ответ текстом.',
            'Не повторяй тот же failing вызов без изменений.',
        ].join(' '),
        fields: [
            { id: 'code', type: 'string' },
        ],
    },
    // Маршруты двухтактного цикла (второй такт выбирает состояние одним словом).
    // servicePrompt — инъекция expect-хода: уходит ASSISTENT-самовызовом на острие messages.
    research: {
        extends: 'TYPES.prompt',
        // FC-ход с read-only набором функций (RESEARCH_METHODS), авто-цепочка без кнопок
        servicePrompt: [
            'Выбран маршрут research. Проведи исследование ровно ОДНИМ вызовом функции:',
            'search({query: "запрос"}) — поиск в интернете; fetch_url({url: "https://…"}) — чтение страницы;',
            'read_file({name}) / get_schema({}) / find_text({text}) — поиск в системе.',
            'Если фактов уже достаточно — изложи выводы обычным текстом.',
        ].join(' '),
    },
    plan: {
        extends: 'TYPES.prompt',
        // Результат — md-блок plan + кнопка «Принять» (wait); confirm запускает task
        servicePrompt: [
            'Выбран маршрут plan. Опиши подробно свой план, по пунктам,',
            'в формате md в красивой рамочке.',
            'Только план, без вопросов и лишних пояснений.',
        ].join(' '),
        fields: [
            { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
        ],
    },
    do: {
        extends: 'TYPES.prompt',
        // FC-ход: файл-модифицирующие вызовы уходят на подтверждение (pendingAction)
        servicePrompt: [
            'Выбран маршрут do. Выполни задачу ровно ОДНИМ вызовом функции:',
            'устройство класса — get_schema({}); файлы — save_file({filename, post}) |',
            'edit({filename, post}) | read_file({name}); данные пользователя — ask_user({questions}).',
            'Если действие не требуется — дай сам результат обычным текстом.',
        ].join(' '),
    },
    report: {
        extends: 'TYPES.prompt',
        // Результат — md-блок report + кнопка «Принять» (wait); confirm закрывает задачу
        servicePrompt: [
            'Выбран маршрут report. Сформируй итоговый отчёт по реально сделанному:',
            'что сделано, какие получены результаты и артефакты (только реальные пути), в формате md.',
            'Только факты из ленты, ничего не выдумывай.',
        ].join(' '),
        fields: [
            { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
        ],
    },
    ribbon: {
        type: 'array',
    },
};

const FIELDS = [
    { id: 'title', type: 'string' },
    { id: 'created', type: 'number' },
    { id: 'model', type: 'string' },
    { id: 'system', type: 'string' },
    { id: 'ribbon', type: 'TYPES.ribbon' },
    {
        id: 'usage',
        fields: [
            { id: 'prompt', type: 'number' },
            { id: 'completion', type: 'number' },
            { id: 'total', type: 'number' },
            { id: 'contextPct', type: 'number' },
            { id: 'contextWindow', type: 'number' },
        ],
    },
];
