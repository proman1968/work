/**
 * Типизатор task.ai: TYPES-модель чата + метод prompt (весь harness — здесь, §1.11).
 *
 * Два вида промптов, различаются ролью:
 * - реальный (role USER|BOSS|ADMIN, всегда с клиента, default USER) → блок prompt в ленту;
 * - служебный (role ASSISTENT — самовызовы шагов плана / авто-ходы) → ТОЛЬКО на острие
 *   messages текущего вызова; в ленту и историю следующих ходов не попадает.
 *
 * prompt — ОДИН проход (single-pass), не цикл:
 * 1. реальный вход (text | answers | confirm | stop) → блок в ленту;
 * 2. system + контекст пары + ribbon (только факты) → messages;
 * 3. инъекция на острие: ASSISTENT-текст шага + TYPES[состояние].servicePrompt по роли;
 *    после реального промпта единственное действие — думать (TYPES.prompt),
 *    после thinking — развилка TYPES.thinking (ответ | ask_user | propose_plan | шаг);
 * 4. один ход модели (streamChat) → блоки TYPE + tools;
 * 5. следующий пункт плана — this.async(() => this.prompt({role:'ASSISTENT', text:'Делай пункт N'})).
 *
 * Метод наследуется файлом .ai через merge class.js (this = task.ai файл),
 * вызывается on_save-триггером, микрочатом ($item.fetch('prompt')) и самим собой.
 * Тело пишется через fsp (не this.save — иначе повторный on_save).
 */


const ROOT = process.cwd();

export default {
    icon: 'bootstrap:robot',
    TYPES,
    FIELDS,
    get body(){
        return this.load({ encoding: 'utf-8' }).then(raw => this.body = JSON.parse(raw));
    },
    /**
     * @param {object} params — { prompt?, text?, stop?, user?, role?, trustLevel?, _turn? }
     * @param {string|object} [post] JSON { text, model, role, confirm, answers, stop } | строка
     */
    async prompt(params = {}, post) {
        const body = await this.body;
        const messages = buildHistoryFromRibbon(body);
        debugger
        messages.push({
            role: 'user',
            content: params.prompt
                + '\n\n[инструкция]\n'
                + TYPES.prompt.servicePrompt,
        });        
        if (params.role !== 'ASSISTENT') {
            await push_block.call(this, {
                type: 'prompt',
                content: params.prompt, // в ленту — только чистый текст
                time: Date.now(),
                sender: params.user.uid,
            });
        }        
        const model = await WORK.get_item(body.model);
        await model.init;
        let fullResponse = '';
        for await (const chunk of model.streamChat({ messages })) {
            if (typeof chunk === 'string')
                fullResponse += chunk;
            else if (chunk.type === 'content')
                fullResponse += chunk.content;
        }
        await push_block.call(this, {
            type: 'thinking',
            content: fullResponse,
            time: Date.now(),
            sender: model.path,
        });

    },  

    async prompt_old(params = {}, post) {

// дальше - мусор

        const { text, requestModel, confirm, answers, wantStop, role: postRole } = parseInput(params, post);
        const fullPath = taskAi.path?.startsWith('/') ? taskAi.path : '/' + (taskAi.path || taskAi.short);
        const wsPath = taskAi.short || fullPath;
        let turn = Number(params._turn) || 0;

        const rawRole = String(params.role || postRole || '').toUpperCase().trim();
        const isService = rawRole === 'ASSISTENT' || rawRole === 'ASSISTANT';

        if (wantStop) {
            requestAbort(fullPath);
            return { ok: true, stopped: true };
        }
        if (turn === 0 && !isService)
            clearAbort(fullPath);
        else if (isAborted(fullPath))
            return finishStopped(fullPath, wsPath, null);

        const body = await loadTaskBody(taskAi);
        if (!body)
            throw new Error('Не удалось загрузить тело task.ai');
        body.ribbon ??= [];

        // Миграция legacy user → type:prompt
        for (const m of body.ribbon) {
            if (m.role === 'user' && !m.type) {
                m.type = 'prompt';
                delete m.role;
            }
        }

        const initialContext = taskAi.$class || taskAi.$parent;
        if (!initialContext)
            throw new Error('Не определён класс-контекст для task.ai');

        if (requestModel)
            body.model = requestModel;

        const { findFirstModel } = await import(
            pathToFileURL(path.join(ROOT, 'sources/modules/ai-schema.js')).href
        );
        const modelPath = body.model || await findFirstModel();
        if (!modelPath) {
            body.ribbon.push({
                type: 'error',
                content: 'Нет доступной модели.',
                time: Date.now(),
                sender: 'WORK',
            });
            await writeTaskBody(fullPath, body);
            notifyChanged(fullPath);
            WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: 'Нет модели' });
            return { ok: true, model: false };
        }
        const model = await WORK.get_item(modelPath);
        if (!model)
            throw new Error('Модель не найдена: ' + modelPath);

        const { execItemMethod } = await import(
            pathToFileURL(path.join(ROOT, 'sources/host/http-server.js')).href
        );

        const modelLabel = model.label || model.path?.split('/').pop() || 'AI';
        const aiUser = { uid: modelLabel, $user: params.user?.$user || params.user, isAI: true };
        const sender = params.user?.uid || params.user?.$user?.id || 'unknown';
        // Реальная роль пользователя (ACL, адаптация инъекций). ASSISTENT её не меняет.
        const role = normalizeRole(isService ? body.role : (rawRole || params.user?.role || body.role));
        body.role = role;
        // Роль для выбора варианта servicePrompt: служебный ход — ASSISTENT, иначе реальная роль
        const injRole = isService ? 'ASSISTENT' : role;

        // Контекст: navigate переживает проходы через body.contextPath
        let currentContext = initialContext;
        if (body.contextPath && body.contextPath !== initialContext.path) {
            try {
                const target = await WORK.get_item(body.contextPath);
                if (target)
                    currentContext = target;
            } catch {}
        }

        /**
         * Шаги 9–10: save + рекурсия по служебному промпту.
         * Тип только что добавленного блока решает следующий ход:
         * есть servicePrompt (или динамическая инструкция шага) → ASSISTENT-самовызов
         * с этим текстом как промптом; нет → wait, ждём пользователя.
         */
        const finishTurn = async (dynamicFollow) => {
            body.contextPath = currentContext?.path || '';
            await writeTaskBody(fullPath, body);
            notifyChanged(fullPath);

            const target = ribbonTargetOf(body);
            let last = driverEntry(target);
            // Свежая задача с пустой лентой (spawn_agent / «Начать») — состояние задаёт сама task
            if (!target.length)
                last = findActiveTask(body) || last;
            const svc = dynamicFollow || resolveServicePrompt(last, injRole);
            if (!svc) {
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, wait: last?.type || 'none', turn };
            }
            if (turn + 1 >= MAX_AUTO_TURNS) {
                target.push({
                    type: 'action',
                    title: 'Лимит ходов',
                    content: 'Превышен лимит авто-ходов (' + MAX_AUTO_TURNS + '). Продолжить задачу?',
                    button: { label: 'Продолжить', color: 'success' },
                    time: Date.now(),
                    sender: 'WORK',
                });
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, maxAutoTurns: true, turn };
            }
            taskAi.async(() => {
                taskAi.prompt({
                    user: params.user,
                    role: 'ASSISTENT',
                    trustLevel: params.trustLevel,
                    prompt: svc,
                    _turn: turn + 1,
                }).catch(e => console.warn('[task.ai] auto turn:', e.message));
            });
            return { ok: true, continued: true, turn };
        };

    // === 2–3. Вход пользователя → блоки ленты (только реальный проход, не ASSISTENT) ===
    let dynamicFollow = null; // динамическая инструкция следующего шага — уйдёт параметром рекурсии
    if (turn === 0 && !isService) {
        const applied = await applyUserInput({
            body, text, confirm, answers, sender, model, wsPath, fullPath,
            currentContext, initialContext, params, aiUser,
        });
        if (applied.early)
            return applied.early;
        if (applied.turnOverride !== null)
            turn = applied.turnOverride;
        currentContext = applied.currentContext;
        dynamicFollow = applied.dynamicFollow;
        body.contextPath = currentContext?.path || '';
        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
    }

    if (isAborted(fullPath))
        return finishStopped(fullPath, wsPath, body);

    // Вход уже дал инструкцию следующего шага («Начать», ответы clarify) — ход модели не нужен
    if (dynamicFollow)
        return finishTurn(dynamicFollow);

    const ribbon = ribbonTargetOf(body);

    // Реальный ход без нового промпта (confirm/pendingAction) — модель не зовём:
    // продолжение решает servicePrompt последнего блока (правило 10)
    if (!isService && driverEntry(ribbon).type !== 'prompt')
        return finishTurn(null);

    // === 4. Запрос модели ===
    // Реальный промпт: единственное действие — думать; к пользовательскому промпту
    // ВСЕГДА плюсуется служебный «думай» (TYPES.prompt.servicePrompt), functions не передаются.
    // ASSISTENT: служебный промпт пришёл параметром (text), functions доступны.
    const svcTip = isService
        ? (text || resolveServicePrompt(driverEntry(ribbon), 'ASSISTENT'))
        : resolveServicePrompt({ type: 'prompt' }, injRole);

    const messages = buildHistoryFromRibbon(body, model.functionCalling === true, {
        protocol: model.protocol,
        autoTurnsLeft: Math.max(0, MAX_AUTO_TURNS - turn),
    });

    // Служебный промпт ТОЛЬКО на острие текущего вызова:
    // в ленту не пишется и в историю следующих ходов не попадает.
    {
        const tipParts = [];
        if (isService) {
            const activeTask = findActiveTask(body);
            const curStep = activeTask?.steps?.find(s => s.status === 'in_progress');
            if (curStep)
                tipParts.push('Текущий пункт плана ' + curStep.step + ': «' + (curStep.description || '') + '».');
        }
        if (svcTip)
            tipParts.push('[инструкция] ' + svcTip);
        if (tipParts.length)
            messages.push({ role: 'user', content: tipParts.join('\n\n') });
    }

    let functions = isService ? await buildFunctionsList(currentContext) : [];

    WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });

    let fullResponse = '';
    let nativeToolCalls = [];
    let turnUsage = null;
    try {
        const streamed = await streamModelWithRetry(model, execItemMethod, messages, functions, wsPath, fullPath);
        fullResponse = streamed.fullResponse;
        nativeToolCalls = streamed.nativeToolCalls;
        turnUsage = streamed.turnUsage;
        functions = streamed.functions || functions;
    }
    catch (e) {
        console.warn('[task.ai] streamChat:', e.message);
        if (classifyStreamError(e) === 'transient') {
            // Ретраи исчерпаны — кнопка «Повторить» с сохранением позиции хода
            body.pendingRetry = { turn };
            ribbon.push({
                type: 'action',
                title: 'Нет связи с моделью',
                content: 'Не удалось связаться с моделью — похоже на сетевую проблему или блокировку доступа к API.\n\nТехдетали: ' + e.message,
                button: { label: 'Повторить', color: 'warning' },
                time: Date.now(),
                sender: 'WORK',
            });
        }
        else {
            const http = String(e.message || '').match(/stream error (\d{3})/);
            const code = http ? Number(http[1]) : 0;
            const hint = (code === 401 || code === 403)
                ? ' Проверьте API-ключ и права доступа модели.'
                : (code === 422 ? ' Модель отклонила формат запроса.' : '');
            ribbon.push({
                type: 'error',
                content: 'Ошибка: ' + e.message + hint,
                time: Date.now(),
                sender: model.path || 'WORK',
            });
        }
        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
        WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: e.message });
        return { ok: false, error: e.message };
    }

    if (isAborted(fullPath))
        return finishStopped(fullPath, wsPath, body);

    applyTurnUsage(body, ribbon, resolveTurnUsage(turnUsage, messages, fullResponse), model);

    // === 6. Реальный ход: каким бы ни был ответ — блок thinking (классификации нет) ===
    if (!isService) {
        const content = stripReasoningWrapper(fullResponse);
        if (!content) {
            ribbon.push({
                type: 'error',
                content: 'Модель вернула пустой ответ на ход размышлений.',
                time: Date.now(),
                sender: model.path || 'WORK',
            });
            await writeTaskBody(fullPath, body);
            notifyChanged(fullPath);
            WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: 'empty think turn' });
            return { ok: false, error: 'empty think turn' };
        }
        ribbon.push({
            type: 'thinking',
            content,
            time: Date.now(),
            sender: model.path || 'WORK',
        });
        // thinking имеет servicePrompt → action-ход уйдёт рекурсией (правило 10)
        return finishTurn(null);
    }

    // === 7. ASSISTENT: парсинг / function calling → типизированный блок ===
    const ribbonLenBefore = ribbon.length;
    // Нормализация prose-каналов слабых моделей (GigaChat <|superquote|> и т.п.)
    // до parseToolCalls / parseResponseToRibbon.
    fullResponse = normalizeModelToolProse(fullResponse);

    let toolCalls = nativeToolCalls.length
        ? nativeToolCalls
        : parseToolCalls(fullResponse, functions);

    // ACL роли: не-ADMIN не меняет типизаторы / class.js
    toolCalls = toolCalls.filter(call => {
        const err = roleBlocksTool(role, call);
        if (err) {
            pushToolResult(ribbon, call, { error: err }, model);
            sendToolResultWs(wsPath, call, { error: err });
            return false;
        }
        return true;
    });

    // Битые FC args ([object Object] / write без filename) — сразу ошибка модели
    const validCalls = [];
    for (const call of toolCalls) {
        if (isBrokenFcArgs(call.args)
            || (isFileWriteMethod(call.method) && !(call.args?.filename || call.args?.name))) {
            const msg = isBrokenFcArgs(call.args)
                ? 'Модель передала битые args FC ([object Object]). Вызови save_file({filename, post}) с валидными аргументами.'
                : 'save_file: нужен filename или name. Вызови save_file({filename, post}).';
            pushToolResult(ribbon, { ...call, args: sanitizeToolArgsForHistory(call.args) }, { error: msg }, model);
            sendToolResultWs(wsPath, call, { error: msg });
        }
        else {
            validCalls.push(call);
        }
    }
    toolCalls = validCalls;

    const parsed = parseResponseToRibbon(fullResponse, model.path || 'WORK');
    let blocks = parsed.blocks || [];

    // ask_user → блок questions (AskQuestion), не «выполнение» tool.
    // Пустой ask_user → обучающий отказ, а не сфабрикованный опрос
    let askTeach = null;
    const askCall = toolCalls.find(c => c.method === ASK_USER_METHOD);
    if (askCall) {
        toolCalls = toolCalls.filter(c => c.method !== ASK_USER_METHOD);
        const qBlock = questionsFromAskUser(askCall.args, model.path || 'WORK');
        if (qBlock) {
            blocks = [
                ...blocks.filter(b => b.type !== 'questions' && b.type !== 'form'),
                qBlock,
            ];
        }
        else {
            askTeach = ASK_USER_TEACH;
        }
    }
    // Сырой «<tool>ask_user» / голое имя канала — не мёртвый text, а teach + ретрай
    else if (!blocks.some(b => b.type === 'questions' || b.type === 'form')
        && isBareAskUserChannel(fullResponse, blocks)) {
        askTeach = ASK_USER_TEACH;
    }

    // Prose-subplan в text-блоке («{subplan}[…]» / «subplan[…]») — декомпозиция,
    // не мёртвый text; должен подняться ДО фильтра огрызков
    if (!parsed.pendingSubplan?.length) {
        const subBlock = blocks.find(b =>
            b.type === 'text' && parseSubplanTextBlock(b.content));
        if (subBlock) {
            parsed.pendingSubplan = parseSubplanTextBlock(subBlock.content);
            blocks = blocks.filter(b => b !== subBlock);
        }
    }

    // Prose propose_plan({…}) в text-блоке — ДО фильтра огрызков
    // (иначе isBareToolProseText съест весь блок до подъёма в pendingPlan)
    if (!parsed.pendingPlan?.steps?.length) {
        const planBlock = blocks.find(b =>
            b.type === 'text' && parseProposePlanTextBlock(b.content));
        if (planBlock) {
            parsed.pendingPlan = parseProposePlanTextBlock(planBlock.content);
            blocks = blocks.filter(b => b !== planBlock);
        }
    }

    // Голые tool-огрызки в прозе («ask_user», сломанный ask_user{…, «{subplan}[») —
    // всегда мусор: осев text-блоком после teach, они глушат ретрай wait-состоянием
    blocks = blocks.filter(b => !(b.type === 'text' && isBareToolProseText(b.content)));

    // propose_plan (FC-канал) → pendingPlan (приоритет над XML <plan>)
    const planCall = toolCalls.find(c => c.method === 'propose_plan');
    if (planCall) {
        toolCalls = toolCalls.filter(c => c.method !== 'propose_plan');
        parsed.pendingPlan = planFromProposeArgs(planCall.args) || parsed.pendingPlan;
    }

    // subplan (FC-канал) → pendingSubplan
    const subCall = toolCalls.find(c => c.method === 'subplan');
    if (subCall) {
        toolCalls = toolCalls.filter(c => c.method !== 'subplan');
        parsed.pendingSubplan = subplanFromArgs(subCall.args) || parsed.pendingSubplan;
    }

    // Голый JSON-массив шагов (ретрай после plan-teach) → попытка плана, не мёртвый text;
    // дальше отработают ворота качества плана
    if (!parsed.pendingPlan?.steps?.length) {
        const jsonBlock = blocks.find(b =>
            b.type === 'text' && parseJsonStepsArray(b.content));
        if (jsonBlock) {
            parsed.pendingPlan = { steps: parseJsonStepsArray(jsonBlock.content), label: 'План' };
            blocks = blocks.filter(b => b !== jsonBlock);
        }
    }

    // report (FC-канал) → text-отчёт + action «Отчёт / Принять»
    const reportCall = toolCalls.find(c => c.method === 'report');
    if (reportCall) {
        toolCalls = toolCalls.filter(c => c.method !== 'report');
        const content = String(reportCall.args?.content || '').trim();
        if (content) {
            blocks = blocks.filter(b => b.type === 'thinking');
            blocks.push({
                type: 'text',
                content,
                time: Date.now(),
                sender: model.path || 'WORK',
            });
            blocks.push({
                type: 'action',
                title: 'Отчёт',
                content: 'Принять отчёт и закрыть задачу?',
                button: { label: 'Принять', color: 'success' },
                time: Date.now(),
                sender: 'WORK',
            });
        }
    }

    // Повтор уже отвеченного опроса — не в ленту: обучающий отказ с готовыми ответами.
    // Ищем по всему стеку задач: у свежей subplan-задачи своя лента пуста,
    // а ответы лежат в лентах родителя/корня.
    let repeatTeach = null;
    const newQ = blocks.find(b => b.type === 'questions');
    if (newQ) {
        const dup = findAnsweredDuplicate(collectAnsweredInteractive(body), newQ);
        if (dup) {
            blocks = blocks.filter(b => b !== newQ);
            repeatTeach = duplicateAskTeach(body, dup);
        }
    }

    // Ворота tap-first: вопросы без вариантов → обучающий отказ (один ретрай,
    // после него открытые поля принимаются — лучше textarea, чем мёртвый цикл)
    if (!repeatTeach && !askTeach) {
        const qb = blocks.find(b => b.type === 'questions');
        const openFields = qb ? questionsFieldsWithoutOptions(qb) : [];
        if (openFields.length && !hasRecentAskOptionsTeach(ribbon)) {
            blocks = blocks.filter(b => b !== qb);
            askTeach = 'Опрос не показан: вопросы без вариантов («' + openFields.join('», «') + '»). '
                + 'Пользователь на мобильном — минимум ввода: каждому вопросу дай options '
                + '(3–5 конкретных вариантов из контекста задачи + «Другое»). '
                + 'Свободный текст уместен только как type: "textarea".';
        }
    }

    // Ворота качества плана: фабрикации и огрызки не доходят до кнопки «Начать»
    let planTeach = null;
    if (parsed.pendingPlan?.steps?.length) {
        planTeach = planQualityError(parsed.pendingPlan.steps);
        if (planTeach)
            parsed.pendingPlan = null;
    }
    else if (parsed.planRejected || planCall)
        planTeach = planQualityError([]);
    if (planTeach)
        blocks = blocks.filter(b => !(b.type === 'action' && b.title === 'План'));

    // План при активной задаче — декомпозиция текущего шага, не второй «План»+«Начать»
    if (parsed.pendingPlan?.steps?.length
        && findActiveTask(body)?.steps?.some(s => s.status === 'in_progress')) {
        parsed.pendingSubplan = parsed.pendingPlan.steps;
        parsed.pendingPlan = null;
        // action «План», собранный парсером, — мёртвая кнопка после конверсии
        blocks = blocks.filter(b => !(b.type === 'action' && b.title === 'План'));
    }

    // plan (FC или парсер) → action «План» (ждёт «Начать»)
    if (parsed.pendingPlan?.steps?.length) {
        blocks = blocks.filter(b => b.type === 'thinking');
        blocks.push(planToAction(parsed.pendingPlan, model.path || 'WORK'));
        toolCalls = [];
    }

    // Проза-обвязка рядом с опросом («Сформулирую вопрос:») → в content опроса
    blocks = foldProseIntoInteractive(blocks);

    // Шальные action-кнопки модели посреди Do → text (мёртвая кнопка не блокирует поток)
    blocks = demoteStrayDoActions(body, blocks);

    // Все пункты закрыты, ответ — текст без вызова report: кнопку «Принять» дорисовывает харнесс
    if (!reportCall) {
        const doneTask = findActiveTask(body);
        if (doneTask?.steps?.length
            && doneTask.steps.every(s => s.status === 'done')
            && blocks.some(b => b.type === 'text')
            && !blocks.some(b => b.type === 'action' && b.title === 'Отчёт')) {
            blocks.push({
                type: 'action',
                title: 'Отчёт',
                content: 'Принять отчёт и закрыть задачу?',
                button: { label: 'Принять', color: 'success' },
                time: Date.now(),
                sender: 'WORK',
            });
        }
    }

    // Обучающие отказы — ДО блоков: wait-блок (questions/action) должен остаться
    // хвостом ленты, иначе драйвером станет tool_result и опрос повиснет без ответа.
    // План не принят → tool_result с инструкцией propose_plan
    if (planTeach) {
        const fakeCall = { method: 'propose_plan', args: {} };
        pushToolResult(ribbon, fakeCall, { error: planTeach }, model);
        sendToolResultWs(wsPath, fakeCall, { error: planTeach });
    }

    // Повторный или пустой опрос → tool_result
    const askUserErr = repeatTeach || askTeach;
    if (askUserErr) {
        const fakeCall = { method: ASK_USER_METHOD, args: {} };
        pushToolResult(ribbon, fakeCall, { error: askUserErr }, model);
        sendToolResultWs(wsPath, fakeCall, { error: askUserErr });
    }

    for (const b of blocks)
        ribbon.push(b);

    // subplan (FC или <subplan>) → вложенная подзадача текущего шага (стек задач).
    // Ворота: копия родительского плана или лимит вложенности → обучающий отказ
    if (!parsed.pendingPlan?.steps?.length && parsed.pendingSubplan?.length) {
        const gateErr = subplanGateError(body, parsed.pendingSubplan);
        if (gateErr) {
            const fakeCall = { method: 'subplan', args: {} };
            pushToolResult(ribbon, fakeCall, { error: gateErr }, model);
            sendToolResultWs(wsPath, fakeCall, { error: gateErr });
        }
        else {
            const applied = applySubplan(body, parsed.pendingSubplan);
            if (applied) {
                toolCalls = [];
                dynamicFollow = applied.instruction;
            }
        }
    }

    // Опасные вызовы / system-modify → pendingAction + подтверждение
    const trustLevel = Number(model.trustLevel ?? params.trustLevel ?? 0);
    const dangerous = toolCalls.filter(c =>
        callNeedsTrustConfirm(c) || (role === 'ADMIN' && isSystemModifyCall(c)));
    if (dangerous.length && trustLevel < TRUST_AUTOCONFIRM) {
        body.pendingAction = {
            calls: toolCalls,
            contextPath: currentContext.path || '',
        };
        ribbon.push({
            type: 'action',
            title: 'Действие',
            content: 'Подтвердите: ' + dangerous
                .map(c => c.method + '(' + Object.keys(c.args || {}).join(', ') + ')')
                .join(', '),
            button: { label: 'Выполнить', color: 'warning' },
            time: Date.now(),
            sender: 'WORK',
        });
        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
        WORK.wsSend?.({ type: 'chat.done', path: wsPath });
        return { ok: true, pendingAction: true };
    }

    // Выполнение tools
    for (const call of toolCalls) {
        ribbon.push({
            type: 'tool',
            name: call.method,
            args: call.args,
            time: Date.now(),
            sender: model.path || 'WORK',
        });
        // complete_step — движок шагов (работает с body, не с контекстом)
        if (call.method === 'complete_step') {
            const { result, followPrompt } = completeTaskStep(body, call.args || {});
            pushToolResult(ribbon, call, result, model);
            sendToolResultWs(wsPath, call, result);
            // следующий пункт — параметром рекурсии (самовызов ASSISTENT), не блоком ленты
            if (followPrompt)
                dynamicFollow = followPrompt;
            continue;
        }
        const { result, newContext, spawnTask } = await executeToolCall(
            call, currentContext, initialContext, functions, params, aiUser,
        );
        if (newContext)
            currentContext = newContext;
        if (spawnTask)
            body.ribbon.push(spawnTask);
        pushToolResult(ribbon, call, result, model);
        sendToolResultWs(wsPath, call, result);
    }

    // save_file("имя") прозой (позиционный аргумент) — не вызов: обучающая ошибка вместо тишины
    if (!toolCalls.some(c => isFileWriteMethod(c.method))
        && /(?:save_file|write_file)\s*\(\s*["'«]/.test(fullResponse)) {
        const fakeCall = { method: 'save_file', args: {} };
        const teach = {
            error: 'save_file не выполнен: вызывается только как tool с объектом аргументов'
                + ' save_file({filename, post: полное содержимое файла}).'
                + ' Позиционная строка в тексте не исполняется.',
        };
        pushToolResult(ribbon, fakeCall, teach, model);
        sendToolResultWs(wsPath, fakeCall, teach);
    }

    // === 8. Ничего не распознано → «Требуется уточнение…» (wait, мёртвого цикла нет) ===
    if (ribbon.length === ribbonLenBefore && !dynamicFollow) {
        const raw = String(fullResponse || '').trim();
        ribbon.push({
            type: 'text',
            content: 'Требуется уточнение: ответ модели не распознан как действие.'
                + (raw ? '\n\n' + raw.slice(0, 2000) : ''),
            time: Date.now(),
            sender: model.path || 'WORK',
        });
    }

    // Страховка wait-порядка: незакрытый интерактив этого хода (ask_user + tool
    // в одном ответе) — в хвост ленты, чтобы ход завершился ожиданием пользователя
    hoistWaitBlock(ribbon, ribbonLenBefore);

    // === 9–10. Save + рекурсия по служебному промпту ===
    return finishTurn(dynamicFollow);
    },
};

/** Максимум авто-проходов подряд без участия пользователя. */
const MAX_AUTO_TURNS = 30;
/** Опасные методы — подтверждение при trustLevel < TRUST_AUTOCONFIRM. */
const DANGEROUS_METHODS = ['set_property', 'save_file', 'write_file', 'delete', 'create'];
const ASK_USER_METHOD = 'ask_user';
/** Обучающий отказ: пустой / сырой ask_user без questions. */
const ASK_USER_TEACH = 'ask_user не показан: вопросов нет или вызов написан текстом. '
    + 'Вызови функцию ask_user (только function call, не строкой в ответе), пример: '
    + 'ask_user({questions: [{prompt: "Какой формат?", options: ["PDF", "HTML", "Другое"]}]}) — '
    + 'сформулируй вопросы по описанию текущего шага, каждому 2–5 вариантов; '
    + 'открытый ответ — type: "textarea" без options.';
/** Уровень доверия модели для автоподтверждения опасных действий. */
const TRUST_AUTOCONFIRM = 3;
const CONTEXT_LOG_DAYS = 7;
const CONTEXT_LOG_MAX_ROWS = 60;
const CONTEXT_LOG_LINE_MAX = 160;
const TOOL_RESULT_MAX = 32000;
const SCHEMA_RESULT_MAX = 4000;
/** Повторы стрима при транзиентных сетевых сбоях (итого попыток: N+1). */
const MAX_STREAM_RETRIES = 2;

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
            'Как следует подумай, над тем, что необходимо сделать на следующем шаге, исходя их контекста и последнего промпта, по смыслу, и выдай свои размышления (от 5 до 100 строк)',
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



// ============================================================================
// Вход пользователя и лента
// ============================================================================

function parseInput(params = {}, post) {
    let text = '';
    let requestModel = '';
    let confirm = undefined;
    let answers = undefined;
    let wantStop = false;
    let role = '';
    const raw = post ?? params.prompt ?? params.text ?? params.post ?? '';
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(raw);
            text = String(parsed.text ?? parsed.prompt ?? '').trim();
            requestModel = String(parsed.model ?? '').trim();
            confirm = parsed.confirm;
            wantStop = parsed.stop === true;
            role = String(parsed.role ?? '').trim();
            if (parsed.answers && typeof parsed.answers === 'object')
                answers = parsed.answers;
        }
        catch {
            text = String(raw).trim();
        }
    }
    else {
        text = String(raw).trim();
    }
    if (params.stop === true || post?.stop === true)
        wantStop = true;
    return { text, requestModel, confirm, answers, wantStop, role };
}

/**
 * Предобработка входа реального хода (confirm / answers / retry / pendingAction / text).
 * Каждая ветка сводится к блокам ленты + опциональной динамической инструкции
 * следующего шага (dynamicFollow) — либо к раннему выходу (early).
 * @returns {{ early: object|null, dynamicFollow: string|null,
 *             turnOverride: number|null, currentContext: object }}
 */
async function applyUserInput(ctx) {
    const { body, text, confirm, answers, sender, model, wsPath, fullPath,
        initialContext, params, aiUser } = ctx;
    let currentContext = ctx.currentContext;
    let dynamicFollow = null;
    let turnOverride = null;

    if (answers) {
        applyAnswers(body, answers, sender);
        // Ответы clarify-шага закрывают шаг сами — не ждём complete_step от модели
        dynamicFollow = autoAdvanceClarifyStep(body);
        delete body.pendingAction;
    }
    else if (confirm !== undefined && body.pendingRetry) {
        // «Повторить» после сетевого сбоя: снять блок и повторить ход с той же позиции
        const retryTurn = Number(body.pendingRetry.turn) || 0;
        delete body.pendingRetry;
        const ribbon = ribbonTargetOf(body);
        const last = ribbon[ribbon.length - 1];
        const isRetryAction = last?.type === 'action' && last.button?.label === 'Повторить';
        if (confirm === true) {
            if (isRetryAction)
                ribbon.pop(); // драйвером снова станет реальный prompt/шаг до сбоя
            turnOverride = retryTurn;
        }
        else {
            if (isRetryAction)
                last.answered = true;
            await writeTaskBody(fullPath, body);
            notifyChanged(fullPath);
            WORK.wsSend?.({ type: 'chat.done', path: wsPath });
            return { early: { ok: true, retryDeclined: true }, dynamicFollow, turnOverride, currentContext };
        }
    }
    else if (confirm !== undefined && body.pendingAction) {
        const functions = await buildFunctionsList(currentContext);
        const ribbon = ribbonTargetOf(body);
        if (confirm === true) {
            for (const call of body.pendingAction.calls || []) {
                ribbon.push({
                    type: 'tool',
                    name: call.method,
                    args: call.args,
                    time: Date.now(),
                    sender: model.path || 'WORK',
                });
                if (call.method === 'complete_step') {
                    const { result, followPrompt } = completeTaskStep(body, call.args || {});
                    pushToolResult(ribbon, call, result, model);
                    sendToolResultWs(wsPath, call, result);
                    if (followPrompt)
                        dynamicFollow = followPrompt;
                    continue;
                }
                const { result, newContext, spawnTask } = await executeToolCall(
                    call, currentContext, initialContext, functions, params, aiUser,
                );
                if (newContext)
                    currentContext = newContext;
                if (spawnTask)
                    body.ribbon.push(spawnTask);
                pushToolResult(ribbon, call, result, model);
                sendToolResultWs(wsPath, call, result);
            }
        }
        else {
            for (const call of body.pendingAction.calls || []) {
                ribbon.push({
                    type: 'tool_result',
                    label: '🚫 ' + call.method,
                    content: 'Действие отменено пользователем',
                    tool: call.method,
                    ok: false,
                    time: Date.now(),
                    sender,
                });
            }
        }
        delete body.pendingAction;
    }
    else if (confirm !== undefined) {
        const applied = applyConfirm(body, confirm, sender);
        if (applied?.taskCompleted) {
            body.contextPath = currentContext?.path || '';
            await writeTaskBody(fullPath, body);
            notifyChanged(fullPath);
            WORK.wsSend?.({ type: 'chat.done', path: wsPath });
            return { early: { ok: true, taskCompleted: true }, dynamicFollow, turnOverride, currentContext };
        }
        // «Начать»: задача создана — первый пункт плана уходит самовызовом ASSISTENT
        if (applied?.instruction)
            dynamicFollow = applied.instruction;
    }
    else if (text) {
        // Текст поверх висящего подтверждения — пользователь его проигнорировал
        delete body.pendingAction;
        if (body.pendingRetry) {
            delete body.pendingRetry;
            const rb = ribbonTargetOf(body);
            const tail = rb[rb.length - 1];
            if (tail?.type === 'action' && tail.button?.label === 'Повторить')
                tail.answered = true;
        }
        await refreshPromptContext(body, initialContext, params, text);
        const ribbon = ribbonTargetOf(body);
        const last = ribbon[ribbon.length - 1];
        if (!(last?.type === 'prompt' && last.content === text && last.sender === sender)) {
            ribbon.push({
                type: 'prompt',
                content: text,
                time: Date.now(),
                sender,
            });
        }
    }

    return { early: null, dynamicFollow, turnOverride, currentContext };
}

/** Последний блок ленты, задающий servicePrompt следующего хода. */
function driverEntry(ribbon = []) {
    for (let i = ribbon.length - 1; i >= 0; i--) {
        const b = ribbon[i];
        if (!b?.type || b.type === 'step' || b.type === 'ribbon' || b.type === 'details')
            continue;
        // Отвеченный интерактив — состояние потреблено; драйвер — блок до него
        if (b.answered === true && (b.type === 'action' || b.type === 'questions' || b.type === 'form'))
            continue;
        return b;
    }
    return { type: 'prompt' };
}

/**
 * Цепочка активных задач от корневой к самой глубокой (настоящий стек).
 * Subplan регистрируется внутри ribbon родителя — спускаемся рекурсивно.
 */
function activeTaskChain(body) {
    const chain = [];
    let ribbon = body?.ribbon || [];
    for (;;) {
        const task = [...ribbon].reverse()
            .find(b => b.type === 'task' && b.state === 'active');
        if (!task)
            break;
        chain.push(task);
        ribbon = task.ribbon || [];
    }
    return chain;
}

/** Самая глубокая активная task (вершина стека вложенных задач). */
function findActiveTask(body) {
    const chain = activeTaskChain(body);
    return chain.length ? chain[chain.length - 1] : null;
}
async function push_block(block) {
    ribbonTargetOf(this.body).push(block);
    await WORK.fsp.writeFile(this.dir, JSON.stringify(this.body, null, 4), 'utf-8');
}
/** Целевая лента: активная task.ribbon или корень. */
function ribbonTargetOf(body) {
    const lastTask = findActiveTask(body);
    return lastTask ? (lastTask.ribbon ??= []) : body.ribbon ??= [] ;
}

/**
 * Служебная инструкция «Делай пункт N» — уходит самовызовом ASSISTENT
 * только на острие messages, в ленту не пишется.
 */
function makeStepInstruction(step) {
    const how = stepNeedsClarify(step)
        ? ' Данные этого пункта есть только у пользователя — начни с вызова функции'
            + ' ask_user({questions: [{prompt: "вопрос по пункту", options: ["вариант 1", "вариант 2", "Другое"]}]})'
            + ' (каждому вопросу options 3–5 вариантов), не выдумывай значения.'
        : ' Ровно один вызов функции по пункту: save_file({filename: "имя.html", post: "полное содержимое"})'
            + ' или другой подходящий tool; закрыв пункт результатом —'
            + ' complete_step({step: ' + step.step + ', summary: "что сделано"}).'
            + ' Псевдовызов в тексте не исполняется.';
    return 'Делай пункт ' + step.step + ' плана: «' + step.description + '».' + how;
}

/**
 * Доказательства работы в span'е шага (блоки ленты после старта шага, по step.startedAt):
 * answered — закрытый опрос/форма; toolOk — успешный tool (кроме complete_step).
 */
function stepEvidence(task, step) {
    const ribbon = task.ribbon || [];
    const from = Number(step?.startedAt) || 0;
    const span = from ? ribbon.filter(b => Number(b.time) >= from) : ribbon;
    return {
        answered: span.some(b => (b.type === 'questions' || b.type === 'form') && b.answered),
        toolOk: span.some(b => b.type === 'tool_result' && b.ok !== false && b.tool !== 'complete_step'),
    };
}

/**
 * Ответы на опрос clarify-шага двигают задачу детерминированно:
 * харнесс сам закрывает шаг (слабая модель не обязана вызвать complete_step).
 * @returns {string|null} инструкция следующего пункта (для ASSISTENT-самовызова) или null
 */
function autoAdvanceClarifyStep(body) {
    const task = findActiveTask(body);
    const cur = task?.steps?.find(s => s.status === 'in_progress');
    if (!cur || !stepNeedsClarify(cur))
        return null;
    const answeredQ = [...(task.ribbon || [])].reverse().find(b =>
        (b.type === 'questions' || b.type === 'form') && b.answered);
    const summary = (answeredQ?.fields || [])
        .filter(f => f.value !== undefined && f.value !== '')
        .map(f => (f.label || f.id) + ': ' + f.value)
        .join('; ');
    const { result, followPrompt } = completeTaskStep(body, { step: cur.step, summary });
    if (!result?.success)
        return null;
    return followPrompt || null;
}

/**
 * Поля опроса без вариантов (type text — неявное понижение из select):
 * кандидаты на tap-first отказ. textarea — законное открытое поле.
 */
function questionsFieldsWithoutOptions(qBlock) {
    return (qBlock?.fields || [])
        .filter(f => f?.type === 'text')
        .map(f => f.label || f.id);
}

/**
 * После последнего входа пользователя уже был отказ «нужны options».
 * Второй раз не учим — принимаем открытые поля (лучше textarea, чем мёртвый цикл).
 */
function hasRecentAskOptionsTeach(ribbon = []) {
    for (let i = ribbon.length - 1; i >= 0; i--) {
        const b = ribbon[i];
        if (b.type === 'prompt' && b.sender !== 'WORK')
            return false;
        if (b.type === 'tool_result' && b.tool === ASK_USER_METHOD
            && b.ok === false && /options/i.test(String(b.content || '')))
            return true;
    }
    return false;
}

/**
 * Action-кнопки модели посреди Do (не «Отчёт»/«План») → text:
 * контент сохраняется, мёртвая кнопка не вешает поток (action — wait-состояние).
 * WORK-блоки («Действие» pendingAction, «Лимит ходов») сюда не попадают — пушатся отдельно.
 */
function demoteStrayDoActions(body, blocks = []) {
    if (!findActiveTask(body))
        return blocks;
    return blocks.map(b => {
        if (b?.type !== 'action' || b.title === 'Отчёт' || b.title === 'План')
            return b;
        const content = [b.title, b.content].filter(Boolean).join(': ');
        return { type: 'text', content, time: b.time, sender: b.sender };
    });
}

/**
 * Незакрытый wait-блок хода (questions/form/action) — всегда хвост ленты:
 * блоки после него (tool/tool_result) сделали бы драйвером продолжение,
 * рекурсия уехала бы дальше, а опрос повис бы без ответа.
 */
function hoistWaitBlock(ribbon = [], from = 0) {
    for (let i = ribbon.length - 2; i >= from; i--) {
        const b = ribbon[i];
        if ((b?.type === 'questions' || b?.type === 'form' || b?.type === 'action')
            && !b.answered) {
            ribbon.splice(i, 1);
            ribbon.push(b);
            return;
        }
    }
}

/** Все отвеченные интерактивы (questions/form) по всем лентам стека задач. */
function collectAnsweredInteractive(body) {
    const out = [];
    const walk = (ribbon = []) => {
        for (const b of ribbon) {
            if ((b.type === 'questions' || b.type === 'form') && b.answered)
                out.push(b);
            if (b.type === 'task' && Array.isArray(b.ribbon))
                walk(b.ribbon);
        }
    };
    walk(body.ribbon || []);
    return out;
}

/** Уже отвеченный опрос с теми же вопросами (по нормализованным label) в этой ленте. */
function findAnsweredDuplicate(ribbon = [], qBlock) {
    const key = b => (b?.fields || [])
        .map(f => String(f.label || f.id || '').trim().toLowerCase().replace(/[?:.\s]+$/g, ''))
        .filter(Boolean)
        .sort()
        .join('|');
    const target = key(qBlock);
    if (!target)
        return null;
    return [...ribbon].reverse().find(b =>
        (b.type === 'questions' || b.type === 'form') && b.answered && key(b) === target) || null;
}

/**
 * Обучающий отказ при повторном ask_user с уже отвеченными label.
 * Не предлагает complete_step для уже закрытого шага (ловушка после autoAdvanceClarifyStep).
 */
function duplicateAskTeach(body, dup) {
    const facts = (dup?.fields || [])
        .map(f => (f.label || f.id) + ': ' + (f.value ?? ''))
        .join('; ');
    const task = findActiveTask(body);
    const open = task?.steps?.find(s => s.status === 'in_progress')
        || task?.steps?.find(s => s.status === 'proposed');
    let msg = 'Опрос не показан: эти вопросы уже отвечены (' + facts + '). '
        + 'Не задавай их повторно — используй готовые ответы.';
    if (open) {
        msg += ' Текущий шаг — ' + open.step + ': «' + (open.description || '') + '». '
            + 'Сделай вызов функции по шагу, пример: '
            + 'save_file({filename: "имя.html", post: "полное содержимое"}); '
            + 'новые вопросы — только с другими label. '
            + 'Не вызывай complete_step для уже закрытого шага.';
    }
    return msg;
}

/** Реальные артефакты задачи: file-блоки (save_file → history path) по всем лентам. */
function collectArtifacts(body) {
    const out = [];
    const walk = (ribbon = []) => {
        for (const b of ribbon) {
            if (b.type === 'file' && b.path && !out.includes(b.path))
                out.push(b.path);
            if (b.type === 'task' && Array.isArray(b.ribbon))
                walk(b.ribbon);
        }
    };
    walk(body.ribbon || []);
    return out;
}

/**
 * Продвижение задачи: следующий шаг → инструкция «Делай пункт N»;
 * все шаги done → у subplan-задачи закрытие + рекурсивное продвижение родителя,
 * у обычной — инструкция «сформируй Отчёт».
 * @returns {string|null} служебная инструкция для ASSISTENT-самовызова (не блок ленты)
 */
function advanceTask(body, task) {
    const next = task.steps.find(s => s.status === 'in_progress')
        || task.steps.find(s => s.status === 'proposed');
    if (next) {
        next.status = 'in_progress';
        next.startedAt = Date.now();
        return makeStepInstruction(next);
    }
    if (task.subplan) {
        task.state = 'completed';
        const parent = findActiveTask(body);
        if (parent?.steps?.length) {
            const pcur = (task.parentStep && parent.steps.find(s => s.step === task.parentStep && s.status !== 'done'))
                || parent.steps.find(s => s.status === 'in_progress');
            if (pcur) {
                pcur.status = 'done';
                pcur.summary ??= 'закрыт подзадачей: ' + (task.label || '');
            }
            return advanceTask(body, parent);
        }
        return null;
    }
    const artifacts = collectArtifacts(body);
    return 'Все пункты плана выполнены:\n'
        + task.steps.map(s => '- пункт ' + s.step + ': ' + s.description
            + (s.summary ? ' — итог: ' + s.summary : '')).join('\n')
        + (artifacts.length
            ? '\n\nАртефакты задачи (реальные пути, других нет):\n' + artifacts.map(p => '- ' + p).join('\n')
            : '\n\nАртефактов не создано — честно укажи это в отчёте, не выдумывай пути.')
        + '\n\nСформируй финальный Отчёт: что сделано, перечисли только эти артефакты.'
        + ' В конце — <action>{"title":"Отчёт","label":"Принять","color":"success"}</action>.';
}

/**
 * Движок шагов (tool complete_step): закрыть шаг активной задачи и продвинуть её.
 * followPrompt — строка-инструкция следующего пункта: уходит ASSISTENT-самовызовом на острие.
 */
function completeTaskStep(body, args = {}) {
    const task = findActiveTask(body);
    if (!task?.steps?.length)
        return { result: { error: 'Нет активной задачи с шагами' } };
    const num = Number(args.step);
    // Уже закрытый номер — явный отказ, без silent remap на in_progress
    if (num > 0) {
        const named = task.steps.find(s => s.step === num);
        if (named?.status === 'done') {
            const open = task.steps.find(s => s.status === 'in_progress')
                || task.steps.find(s => s.status === 'proposed');
            let err = 'Шаг ' + num + ' уже закрыт.';
            if (open) {
                err += ' Текущий шаг — ' + open.step + ': «' + (open.description || '') + '». '
                    + 'Сделай tool шага (save_file/{filename, post} или другой tool по задаче), '
                    + 'затем complete_step({step: ' + open.step + ', summary}).';
            }
            return { result: { error: err } };
        }
    }
    const cur = (num > 0 && task.steps.find(s => s.step === num && s.status !== 'done'))
        || task.steps.find(s => s.status === 'in_progress')
        || task.steps.find(s => s.status === 'proposed');
    if (!cur)
        return { result: { error: 'Нет открытого шага — все уже закрыты' } };

    // Ворота: шаг закрывается доказательством работы, не прозой
    const ev = stepEvidence(task, cur);
    if (stepNeedsClarify(cur) && !ev.answered) {
        return {
            result: {
                error: 'Шаг ' + cur.step + ' — уточнение у пользователя: вызови функцию'
                    + ' ask_user({questions: [{prompt: "вопрос по шагу", options: ["вариант 1", "вариант 2", "Другое"]}]}),'
                    + ' не выдумывай значения. complete_step — после ответов пользователя.',
            },
        };
    }
    if (!stepNeedsClarify(cur) && !ev.toolOk && !ev.answered) {
        return {
            result: {
                error: 'Шаг ' + cur.step + ' не закрыт: нет результата работы.'
                    + ' Сохрани артефакт вызовом функции, пример:'
                    + ' save_file({filename: "presentation.html", post: "<!DOCTYPE html>… полное содержимое"})'
                    + ' (текстовый формат html/md) — затем повтори'
                    + ' complete_step({step: ' + cur.step + ', summary: "что сделано"}).',
            },
        };
    }

    cur.status = 'done';
    if (args.summary)
        cur.summary = String(args.summary).slice(0, 500);
    const followPrompt = advanceTask(body, task);
    return {
        result: { success: true, message: 'Шаг ' + cur.step + ' закрыт' },
        followPrompt,
    };
}

/**
 * <subplan> модели → вложенная подзадача текущего шага (стек задач в body.ribbon).
 * Закрытие всех подшагов через complete_step закроет родительский шаг (advanceTask).
 */
function applySubplan(body, rawSteps = []) {
    const outer = findActiveTask(body);
    const curStep = outer?.steps?.find(s => s.status === 'in_progress');
    const steps = rawSteps
        .map((s, i) => ({
            step: i + 1,
            description: stepDescriptionOf(s),
            status: 'proposed',
        }))
        .filter(s => s.description);
    if (!steps.length)
        return null;
    steps[0].status = 'in_progress';
    steps[0].startedAt = Date.now();
    const sub = {
        type: 'task',
        label: curStep
            ? 'Шаг ' + curStep.step + ': ' + curStep.description
            : 'Декомпозиция',
        state: 'active',
        steps,
        ribbon: [],
        subplan: true,
        parentStep: curStep?.step,
        time: Date.now(),
        sender: 'WORK',
    };
    // Вложенная задача — в ribbon родителя (настоящий стек), не сосед в корне
    const target = outer ? (outer.ribbon ??= []) : body.ribbon;
    target.push(sub);
    return { sub, instruction: makeStepInstruction(steps[0]) };
}

/** Максимум одновременно активных задач в стеке (корень + вложенные subplan). */
const MAX_TASK_DEPTH = 3;

/**
 * Ворота subplan: повтор шагов родительской задачи или превышение глубины стека —
 * обучающий отказ вместо каскада вложенных задач (модель перепланирует вместо работы).
 * @returns {string|null} текст ошибки или null (subplan допустим)
 */
function subplanGateError(body, rawSteps = []) {
    const task = findActiveTask(body);
    if (!task)
        return null;
    const cur = task.steps?.find(s => s.status === 'in_progress');
    const doStep = cur
        ? ' Делай текущий шаг ' + cur.step + ': «' + (cur.description || '') + '» — '
            + 'вызови функцию по шагу: save_file({filename: "имя.html", post: "полное содержимое"}) '
            + 'или ask_user({questions: [{prompt: "вопрос", options: ["вариант 1", "вариант 2", "Другое"]}]}), '
            + 'затем complete_step({step: ' + cur.step + ', summary: "что сделано"}).'
        : '';
    const norm = s => String(s || '').trim().toLowerCase()
        .replace(/ё/g, 'е').replace(/[^\wа-я ]+/gi, '').replace(/\s+/g, ' ');
    const subKeys = rawSteps.map(s => norm(stepDescriptionOf(s))).filter(Boolean);
    if (subKeys.length < 2)
        return 'Subplan не принят: декомпозиция — минимум 2 подшага, только вызовом функции '
            + 'subplan({steps: [{description: "подшаг 1"}, {description: "подшаг 2"}]}), не текстом. '
            + 'Один пункт — не декомпозиция, subplan не нужен.' + doStep;
    const parentKeys = new Set((task.steps || []).map(s => norm(s.description)));
    if (subKeys.every(k => parentKeys.has(k)))
        return 'Subplan не принят: это повтор шагов текущего плана, не декомпозиция.' + doStep;
    const depth = activeTaskChain(body).length;
    if (depth >= MAX_TASK_DEPTH)
        return 'Subplan не принят: лимит вложенности задач (' + MAX_TASK_DEPTH + '). '
            + 'Не декомпозируй дальше.' + doStep;
    return null;
}

/** Описание шага из объекта {description|label|title} или голой строки. */
function stepDescriptionOf(s) {
    if (typeof s === 'string')
        return s.trim();
    return String(s?.description || s?.label || s?.title || '').trim();
}

/**
 * Ворота качества плана: <2 осмысленных шагов или дефолтные описания —
 * обучающий отказ вместо кнопки «Начать» (система не дорисовывает за модель).
 * @returns {string|null} текст ошибки или null, если план пригоден
 */
function planQualityError(steps = []) {
    const meaningful = steps.filter(s => {
        const d = String(s?.description || '').trim();
        return d && !/^шаг\s*\d*$/i.test(d);
    });
    if (meaningful.length >= 2)
        return null;
    return 'План не принят: нужно минимум 2 осмысленных шага. '
        + 'Вызови функцию propose_plan (только function call, не текстом), пример: '
        + 'propose_plan({steps: [{description: "Уточнить требования"}, '
        + '{description: "Собрать структуру"}, {description: "Сохранить файл"}]}) — 3–6 конкретных шагов.';
}

/** Args tool propose_plan → pendingPlan (FC-канал плана). */
function planFromProposeArgs(args = {}) {
    const steps = (Array.isArray(args?.steps) ? args.steps : [])
        .map(s => ({ description: stepDescriptionOf(s) }))
        .filter(s => s.description);
    if (!steps.length)
        return null;
    return {
        steps,
        label: 'План',
        content: String(args?.intro || '').trim()
            || steps.map(s => s.description).join('; '),
    };
}

/**
 * Text-блок целиком — prose propose_plan({…}) / propose_plan{…} → pendingPlan.
 * Страховка, если parseToolCalls не поднял call.
 */
function parseProposePlanTextBlock(content) {
    const t = String(content || '').trim();
    const m = t.match(/^propose_plan\s*/i);
    if (!m)
        return null;
    const parsed = parseJsStyleToolCallAt(t, 0, 'propose_plan');
    if (!parsed?.args)
        return null;
    return planFromProposeArgs(parsed.args);
}

/**
 * Голый JSON-массив шагов в прозе ([{description|label|title}|строка, …]) —
 * ретрай плана после teach, не text. @returns {Array|null} нормализованные шаги
 */
function parseJsonStepsArray(text) {
    const t = String(text || '').trim();
    if (!t.startsWith('[') || !t.endsWith(']'))
        return null;
    let arr;
    try { arr = JSON.parse(t); }
    catch { return null; }
    if (!Array.isArray(arr) || !arr.length)
        return null;
    const steps = arr
        .map(s => ({ description: stepDescriptionOf(s) }))
        .filter(s => s.description);
    return steps.length === arr.length ? steps : null;
}

/** Args tool subplan → массив подшагов (FC-канал декомпозиции). */
function subplanFromArgs(args = {}) {
    const steps = (Array.isArray(args?.steps) ? args.steps : [])
        .map(s => ({ description: stepDescriptionOf(s) }))
        .filter(s => s.description);
    return steps.length ? steps : null;
}

/** JSON-фрагмент subplan (массив, {steps:[…]} или одиночный {description}) → шаги. */
function subplanStepsFromJson(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return null; }
    const rawSteps = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.steps) ? parsed.steps : [parsed];
    const steps = rawSteps
        .map(s => ({ description: stepDescriptionOf(s) }))
        .filter(s => s.description);
    return steps.length ? steps : null;
}

/** Сбалансированный JSON-фрагмент ([…] или {…}) начиная с позиции start. */
function extractBalancedJsonAt(text, start) {
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;
    const open = text[i];
    if (open !== '[' && open !== '{')
        return null;
    const from = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '[' || ch === '{')
            depth++;
        else if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 0)
                return { raw: text.slice(from, i + 1), end: i + 1 };
        }
    }
    return null;
}

/**
 * Prose-форма декомпозиции «{subplan}[{description}…]» / «{subplan}{steps:[…]}» —
 * GigaChat пишет маркер в фигурных скобках вместо тега <subplan> или FC.
 * @returns {{ steps: Array, index: number, end: number } | null}
 */
function consumeBraceSubplan(text) {
    const src = String(text || '');
    const m = src.match(/\{\s*subplan\s*\}\s*/i);
    if (!m)
        return null;
    const extracted = extractBalancedJsonAt(src, m.index + m[0].length);
    if (!extracted)
        return null;
    const steps = subplanStepsFromJson(extracted.raw);
    if (!steps)
        return null;
    return { steps, index: m.index, end: extracted.end };
}

/**
 * Text-блок целиком — prose-subplan («{subplan}[…]», «subplan[…]») → шаги.
 * Страховка prompt(): если полный ответ не разобрался, огрызок в отдельном
 * блоке всё равно поднимается в pendingSubplan, а не глушит поток как text.
 */
function parseSubplanTextBlock(content) {
    const t = String(content || '').trim();
    const m = t.match(/^\{?\s*subplan\s*\}?\s*/i);
    if (!m)
        return null;
    const extracted = extractBalancedJsonAt(t, m[0].length);
    if (!extracted)
        return null;
    return subplanStepsFromJson(extracted.raw);
}

/** pendingPlan → action «План» (ждёт «Начать»). */
function planToAction(pendingPlan, sender) {
    const steps = pendingPlan?.steps || [];
    return {
        type: 'action',
        title: 'План',
        content: formatPlanMarkdown(steps, pendingPlan?.content)
            || pendingPlan?.content
            || steps.map(s => s.description).filter(Boolean).join('; '),
        button: { label: 'Начать', color: 'success' },
        steps: steps.map((s, i) => ({
            step: Number(s.step) > 0 ? Number(s.step) : i + 1,
            description: String(s.description || '').trim(),
            status: 'proposed',
        })),
        time: Date.now(),
        sender,
    };
}

/** Последний неотвеченный interactive в ленте (сначала активная task, потом корень). */
function findOpenInteractive(body) {
    // Ленты стека от глубокой к корневой + корень: ответ/кнопка может лежать
    // на любом уровне вложенной задачи
    const scopes = [];
    const seen = new Set();
    const push = (r) => {
        if (!r || seen.has(r))
            return;
        seen.add(r);
        scopes.push(r);
    };
    for (const task of [...activeTaskChain(body)].reverse())
        push(task.ribbon ??= []);
    push(body.ribbon);
    for (const r of scopes) {
        const open = [...r].reverse().find(b =>
            (b.type === 'action' || b.type === 'form' || b.type === 'questions') && !b.answered);
        if (open)
            return { open, ribbon: r };
    }
    return null;
}

/**
 * confirm по открытому action/form/questions.
 * «Начать» у action «План» → TYPE.task + step-prompt; иное — prompt-факт подтверждения.
 */
function applyConfirm(body, confirm, sender) {
    if (confirm === undefined)
        return null;
    const found = findOpenInteractive(body);
    if (!found)
        return null;
    const { open, ribbon } = found;
    open.answered = true;

    if (confirm === false) {
        ribbon.push({
            type: 'prompt',
            content: 'Отменено',
            time: Date.now(),
            sender,
        });
        return { type: 'prompt' };
    }

    if (open.type === 'action' && open.title === 'План' && open.steps?.length) {
        const task = {
            type: 'task',
            // Первая строка плана без маркера списка («- собрать…» → «собрать…»)
            label: String(open.content?.split('\n')[0] || '')
                .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
                .trim() || 'План',
            state: 'active',
            steps: open.steps.map(s => ({ ...s, status: s.status || 'proposed' })),
            ribbon: [],
            time: Date.now(),
            sender: 'WORK',
        };
        const first = task.steps.find(s => s.status === 'proposed') || task.steps[0];
        if (first) {
            first.status = 'in_progress';
            first.startedAt = Date.now();
        }
        body.ribbon.push(task);
        // Пункт плана уходит служебным ASSISTENT-самовызовом, не блоком ленты
        return { type: 'task', instruction: first ? makeStepInstruction(first) : null };
    }

    // «Принять» у Отчёта — задача закрыта, ход модели не нужен
    if (open.type === 'action' && open.title === 'Отчёт') {
        const task = findActiveTask(body);
        if (task) {
            for (const s of task.steps || [])
                if (s.status !== 'done')
                    s.status = 'done';
            task.state = 'completed';
            body.ribbon.push({
                type: 'text',
                content: 'Задача завершена: ' + (task.label || 'без названия'),
                time: Date.now(),
                sender: 'WORK',
            });
            return { type: 'text', taskCompleted: true };
        }
    }

    const label = String(open.button?.label || open.title || 'OK').trim();
    const prompt = {
        type: 'prompt',
        content: label,
        time: Date.now(),
        sender,
    };
    ribbon.push(prompt);
    return prompt;
}

/** Ответы формы/опроса → prompt с answers. */
function applyAnswers(body, answers, sender) {
    const found = findOpenInteractive(body);
    const open = found?.open?.type === 'form' || found?.open?.type === 'questions'
        ? found.open
        : null;
    const ribbon = found?.ribbon || ribbonTargetOf(body);
    if (open) {
        open.answered = true;
        if (Array.isArray(open.fields)) {
            for (const f of open.fields) {
                if (answers[f.id] !== undefined)
                    f.value = answers[f.id];
            }
        }
    }
    const content = formatPromptWithAnswers(open?.button?.label || 'Ответ', answers, open?.fields);
    const prompt = {
        type: 'prompt',
        content,
        answers,
        time: Date.now(),
        sender,
    };
    ribbon.push(prompt);
    return prompt;
}

/** Ответы формы: только «вопрос: ответ» (без label кнопки). Без answers — label как есть. */
function formatPromptWithAnswers(label, answers, fields) {
    const head = String(label || '').trim();
    if (!answers || typeof answers !== 'object')
        return head;
    const byId = Array.isArray(fields)
        ? Object.fromEntries(fields.map(f => [f.id, String(f.label || f.id).replace(/[?？]*[:：]*\s*$/, '')]))
        : {};
    const lines = [];
    for (const [id, v] of Object.entries(answers)) {
        if (v === undefined || v === null || String(v).trim() === '')
            continue;
        lines.push((byId[id] || id) + ': ' + v);
    }
    if (!lines.length)
        return head;
    return lines.join('\n');
}

// ============================================================================
// Stop / abort (stop приходит отдельным HTTP prompt {stop:true})
// ============================================================================

const abortByPath = new Map();

function requestAbort(path) {
    const p = String(path || '').trim();
    if (p)
        abortByPath.set(p, true);
}

function clearAbort(path) {
    const p = String(path || '').trim();
    if (p)
        abortByPath.delete(p);
}

function isAborted(path) {
    const p = String(path || '').trim();
    return !!(p && abortByPath.get(p));
}

async function finishStopped(fullPath, wsPath, body) {
    clearAbort(fullPath);
    if (body) {
        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
    }
    WORK.wsSend?.({ type: 'chat.done', path: wsPath, stopped: true });
    return { ok: true, stopped: true };
}

// ============================================================================
// IO тела task.ai
// ============================================================================

async function loadTaskBody(taskAi) {
    try {
        const raw = await taskAi.load({ encoding: 'utf-8' });
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
    catch (e) {
        console.warn('[task.ai] loadTaskBody:', e.message);
        return null;
    }
}

async function writeTaskBody(fullPath, body) {
    try {
        await fsp.writeFile(path.join(ROOT, fullPath), JSON.stringify(body, null, 4), 'utf-8');
    }
    catch (e) {
        console.warn('[task.ai] writeTaskBody:', e.message);
    }
}

function notifyChanged(fullPath) {
    try {
        WORK.get_item(fullPath).then(item => {
            if (item?.reset)
                item.reset();
            else
                WORK.wsSend?.({ path: fullPath });
        });
    }
    catch {
        WORK.wsSend?.({ path: fullPath });
    }
}

// ============================================================================
// Стрим модели
// ============================================================================

const TRANSIENT_ERROR_CODES = new Set([
    'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE',
]);

/**
 * Классификация ошибки стрима: transient (сеть/429/5xx — повтор поможет)
 * или fatal (ключ/доступ/схема — повтор бесполезен).
 * HTTP-код парсится из текста streamChat: «LLM <model> stream error <code>: …».
 * @param {Error|{code?: string, message?: string}} e
 * @returns {'transient'|'fatal'}
 */
function classifyStreamError(e) {
    if (TRANSIENT_ERROR_CODES.has(e?.code))
        return 'transient';
    const msg = String(e?.message || '');
    const http = msg.match(/stream error (\d{3})/);
    if (http) {
        const code = Number(http[1]);
        return (code === 429 || code >= 500) ? 'transient' : 'fatal';
    }
    if (/socket disconnected|socket hang up|\bTLS\b|network|timeout/i.test(msg))
        return 'transient';
    return 'fatal';
}

/**
 * streamModel с авто-retry транзиентных сбоев (backoff + джиттер).
 * Дублей в ленте нет: накопленный fullResponse пишется только после успеха,
 * частичный UI-стрим сбрасывается через chat.clear_stream.
 */
async function streamModelWithRetry(model, execItemMethod, messages, functions, wsPath, fullPath) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await streamModel(model, execItemMethod, messages, functions, wsPath, fullPath);
        }
        catch (e) {
            if (attempt >= MAX_STREAM_RETRIES
                || classifyStreamError(e) !== 'transient'
                || isAborted(fullPath))
                throw e;
            const delay = Math.round(600 * 2 ** attempt * (1 + Math.random() * 0.4));
            console.warn('[task.ai] stream retry', (attempt + 1) + '/' + MAX_STREAM_RETRIES,
                'in', delay + 'ms:', e.message);
            WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });
            await new Promise(r => setTimeout(r, delay));
            if (isAborted(fullPath))
                throw e;
        }
    }
}

async function streamModel(model, execItemMethod, messages, functions, wsPath, fullPath) {
    let fullResponse = '';
    const nativeToolCalls = [];
    let turnUsage = null;
    const streamParams = { messages, $ai: model };
    let fns = functions;
    if (fns?.length) {
        ensureHarnessFunctions(fns);
        const prepared = prepareFunctionsForStream(fns, messages, 'auto');
        streamParams.functions = prepared.functions;
        streamParams.function_call = prepared.function_call;
        fns = prepared.functions;
    }
    const stream = await execItemMethod(model, 'streamChat', streamParams);
    for await (const chunk of stream) {
        if (isAborted(fullPath))
            break;
        if (typeof chunk === 'string') {
            fullResponse += chunk;
            WORK.wsSend?.({ type: 'chat.delta', path: wsPath, token: chunk });
        }
        else if (chunk && typeof chunk === 'object') {
            if (chunk.type === 'content' && chunk.content) {
                fullResponse += chunk.content;
                WORK.wsSend?.({ type: 'chat.delta', path: wsPath, token: chunk.content });
            }
            else if (chunk.type === 'function_call') {
                nativeToolCalls.push({
                    method: chunk.name,
                    args: chunk.arguments || {},
                });
            }
            else if (chunk.type === 'usage') {
                turnUsage = {
                    prompt: Number(chunk.prompt_tokens) || 0,
                    completion: Number(chunk.completion_tokens) || 0,
                    total: Number(chunk.total_tokens) || 0,
                    source: 'api',
                };
            }
        }
    }
    return { fullResponse, nativeToolCalls, turnUsage, functions: fns };
}

// ============================================================================
// Functions (схема контекста + сервисы + harness)
// ============================================================================

/** Tools: только то, чего нет в get_schema (@ai). ask_user — всегда harness. */
const HARNESS_FUNCTIONS = [
    {
        name: 'read_file',
        description: 'Прочитать файл в текущем контексте по name.',
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
        description: 'Точечная правка файла SEARCH/REPLACE (не полный rewrite). filename + post с блоками ------- SEARCH / ======= / +++++++ REPLACE. Полная перезапись — save_file.',
        parameters: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: 'Имя файла в текущем контексте' },
                post: { type: 'string', description: 'Diff SEARCH/REPLACE' },
            },
            required: ['filename', 'post'],
        },
    },
    {
        name: 'navigate',
        description: 'Перейти в элемент по абсолютному path.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Путь элемента WORK' },
            },
            required: ['path'],
        },
    },
    {
        name: 'reset_context',
        description: 'Вернуться в домашний класс текущей задачи.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'list_skills',
        description: 'Список доступных $skill в /skills (path + label).',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'run_skill',
        description: 'Выполнить скилл по path (skills-as-tools).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Путь к $skill' },
                data: { type: 'object', description: 'Параметры скилла' },
            },
            required: ['path'],
        },
    },
    {
        name: 'spawn_agent',
        description: 'Создать последовательного подагента (вложенный task в ribbon). Не параллелит — следующие ходы выполняй в его шагах.',
        parameters: {
            type: 'object',
            properties: {
                goal: { type: 'string', description: 'Цель подагента' },
                brief: { type: 'string', description: 'Краткое ТЗ' },
                steps: {
                    type: 'array',
                    items: { type: 'object', properties: { description: { type: 'string' } } },
                    description: 'Шаги подагента',
                },
            },
            required: ['goal'],
        },
    },
    {
        name: 'inspect_schema',
        description: 'Инспекция get_schema текущего контекста или path (методы/свойства класса).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Опционально: путь элемента; иначе текущий контекст' },
            },
        },
    },
    {
        name: 'complete_step',
        description: 'Закрыть текущий шаг активной задачи (status: done), когда его результат получен. Система сама пришлёт следующий шаг или запросит Отчёт.',
        parameters: {
            type: 'object',
            properties: {
                step: { type: 'number', description: 'Номер шага; по умолчанию текущий in_progress' },
                summary: { type: 'string', description: 'Краткий итог шага (1–2 фразы, пути артефактов)' },
            },
        },
    },
    {
        name: 'propose_plan',
        description: 'Предложить план задачи (3–6 шагов). Платформа покажет план с кнопкой «Начать». Вызывай вместо текстового <plan>.',
        parameters: {
            type: 'object',
            properties: {
                steps: {
                    type: 'array',
                    description: 'Шаги плана по порядку',
                    items: {
                        type: 'object',
                        properties: {
                            description: { type: 'string', description: 'Что сделать на шаге' },
                        },
                        required: ['description'],
                    },
                },
                intro: { type: 'string', description: 'Краткое вступление к плану (1–2 фразы)' },
            },
            required: ['steps'],
        },
    },
    {
        name: 'report',
        description: 'Финальный отчёт по задаче, когда все пункты плана закрыты. Платформа покажет отчёт с кнопкой «Принять». Перечисляй только реальные артефакты.',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Текст отчёта: что сделано, пути артефактов' },
            },
            required: ['content'],
        },
    },
    {
        name: 'subplan',
        description: 'Декомпозиция текущего шага активной задачи на подшаги (вложенная подзадача). Вызывай вместо текстового <subplan>.',
        parameters: {
            type: 'object',
            properties: {
                steps: {
                    type: 'array',
                    description: 'Подшаги по порядку',
                    items: {
                        type: 'object',
                        properties: {
                            description: { type: 'string', description: 'Что сделать на подшаге' },
                        },
                        required: ['description'],
                    },
                },
            },
            required: ['steps'],
        },
    },
];

/** Fallback save_file, если schema не отдала @ai-method */
const HARNESS_SAVE_FILE = {
    name: 'save_file',
    description: 'Создать или перезаписать файл. filename — конечное имя артефакта; перезаписывай ТО ЖЕ имя — history пишется сама. Возвращает history path снимка.',
    parameters: {
        type: 'object',
        properties: {
            filename: { type: 'string', description: 'Конечное имя файла (одно на артефакт)' },
            post: { type: 'string', description: 'Полное содержимое файла (текущая версия)' },
        },
        required: ['filename', 'post'],
    },
};

/** Functions (OpenAI-compatible) из схемы методов контекста + сервисов + harness. */
async function buildFunctionsList(currentContext) {
    let functions = [];

    try {
        const schema = await currentContext.get_schema?.();
        if (schema?.methods) {
            const { buildFunctionsFromSchema } = await import(
                pathToFileURL(path.join(ROOT, 'sources/modules/ai-schema.js')).href
            );
            functions = buildFunctionsFromSchema(schema.methods, {
                exclude: ['delete', 'save_secret', 'read_secret'],
            });
        }
    }
    catch (e) {
        console.warn('[task.ai] get_schema for functions:', e.message);
    }

    try {
        const services = await WORK.get_item('/SERVICES/*');
        const svcList = Array.isArray(services) ? services : (services ? [services] : []);
        for (const svcItem of svcList) {
            if (svcItem.type !== '$service')
                continue;
            const schema = svcItem.SCHEMA;
            if (!schema)
                continue;
            for (const [name, info] of Object.entries(schema)) {
                if (!functions.find(fn => fn.name === name)) {
                    functions.push({
                        name,
                        description: info.description || name,
                        parameters: info.params || { type: 'object', properties: {} },
                        _servicePath: svcItem.path,
                    });
                }
            }
        }
    }
    catch (e) {
        console.warn('[task.ai] services load:', e.message);
    }

    ensureHarnessFunctions(functions);
    return functions;
}

/** Upsert функции по точному имени (write_file ≠ save_file). */
function ensureNamedFunction(functions = [], name, template, opts = {}) {
    if (!Array.isArray(functions) || !name || !template)
        return functions;
    const idx = functions.findIndex(f => f?.name === name);
    if (idx >= 0) {
        if (opts.prepend && idx > 0) {
            const [existing] = functions.splice(idx, 1);
            functions.unshift(existing);
        }
        return functions;
    }
    const copy = { ...template, name };
    if (opts.prepend)
        functions.unshift(copy);
    else
        functions.push(copy);
    return functions;
}

/** Имена FC из messages (assistant.function_call / role:function). */
function collectFunctionNamesFromMessages(messages = []) {
    const names = new Set();
    for (const m of messages || []) {
        if (!m || typeof m !== 'object')
            continue;
        if (m.role === 'function' && m.name)
            names.add(String(m.name));
        const fc = m.function_call;
        if (fc?.name)
            names.add(String(fc.name));
        if (Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) {
                const n = tc?.function?.name || tc?.name;
                if (n)
                    names.add(String(n));
            }
        }
    }
    return [...names];
}

/** Stub для имени из history, которого нет в schema. */
function stubFunctionForHistory(name) {
    if (name === 'save_file')
        return { ...HARNESS_SAVE_FILE };
    return {
        name,
        description: name,
        parameters: { type: 'object', properties: {} },
    };
}

/**
 * Подготовить functions к stream: имена из history + канон save_file при force.
 * @returns {{ functions: Array, function_call: 'auto'|{name:string} }}
 */
function prepareFunctionsForStream(functions = [], messages = [], functionCall = 'auto') {
    const list = Array.isArray(functions) ? [...functions] : [];
    for (const name of collectFunctionNamesFromMessages(messages)) {
        if (!list.some(f => f?.name === name))
            list.push(stubFunctionForHistory(name));
    }
    let mode = functionCall;
    if (mode && typeof mode === 'object' && mode.name === 'save_file') {
        // Канон harness-схемы (schema save_file иногда даёт 422 у GigaChat)
        const rest = list.filter(f => f?.name !== 'save_file');
        rest.unshift({ ...HARNESS_SAVE_FILE });
        return { functions: rest, function_call: { name: 'save_file' } };
    }
    return { functions: list, function_call: mode };
}

/** Гарантировать ask_user + недостающие harness-helpers. */
function ensureHarnessFunctions(functions = []) {
    for (const fn of HARNESS_FUNCTIONS) {
        if (!functions.find(f => f.name === fn.name))
            functions.push({ ...fn });
    }
    ensureNamedFunction(functions, 'save_file', HARNESS_SAVE_FILE);
    if (!functions.find(fn => fn.name === ASK_USER_METHOD)) {
        functions.push({
            name: ASK_USER_METHOD,
            description: 'Уточняющие вопросы с вариантами ответа (AskQuestion). Каждый вопрос — options: 3–5 конкретных вариантов из контекста задачи + «Другое» (пользователь на мобильном, тапы вместо ввода). Свободный текст — только type: "textarea".',
            parameters: {
                type: 'object',
                properties: {
                    questions: {
                        type: 'array',
                        description: 'Вопросы: id, prompt, options (строки, 2–5)',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                prompt: { type: 'string', description: 'Текст вопроса' },
                                options: { type: 'array', items: { type: 'string' } },
                                allow_multiple: { type: 'boolean' },
                            },
                            required: ['id', 'prompt', 'options'],
                        },
                    },
                    fields: {
                        type: 'array',
                        description: 'Legacy: id, label, options (обязательны). Вопрос без options будет отклонён.',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                label: { type: 'string' },
                                type: { type: 'string' },
                                options: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['id', 'label', 'options'],
                        },
                    },
                    label: { type: 'string', description: 'Текст кнопки (Уточнить)' },
                },
                required: ['questions'],
            },
        });
    }
    return functions;
}

// ============================================================================
// Выполнение tools
// ============================================================================

function isFileWriteMethod(method) {
    return method === 'save_file' || method === 'write_file'
        || method === 'edit' || method === 'edit_file';
}

/** Битые args после ""+object → "[object Object]" в streamChat */
function isBrokenFcArgs(args) {
    if (!args || typeof args !== 'object')
        return false;
    return args.raw === '[object Object]';
}

/** id похож на имя файла (presentation.html), а не на класс (MARKET). */
function looksLikeFileId(id) {
    const s = String(id ?? '').trim();
    if (!s || s[0] === '$')
        return false;
    return /\.[A-Za-z0-9]{1,16}$/.test(s);
}

/** Args для history/API: без мусора raw:"[object Object]" */
function sanitizeToolArgsForHistory(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args))
        return {};
    if (args.raw === '[object Object]') {
        const { raw, ...rest } = args;
        return Object.keys(rest).length ? rest : {};
    }
    return args;
}

/** Хвост битого FC в конце post (`}\n</function>` и т.п.) — не писать в файл */
function stripFcTrailer(text) {
    let s = String(text ?? '');
    // Только явный мусор FC, не голый «}» (иначе ломается JSON body)
    s = s.replace(/(?:\r?\n)?\}\s*<\/function>\s*$/i, '');
    s = s.replace(/(?:\r?\n)?<\/function>\s*$/i, '');
    s = s.replace(/(?:\r?\n)?\}\s*<\/tool_call>\s*$/i, '');
    s = s.replace(/(?:\r?\n)?<\/tool_call>\s*$/i, '');
    return s;
}

/**
 * Нужен ли trust/confirm gate для вызова.
 * Обычный save_file — сразу; system-modify write и прочие DANGEROUS — да.
 */
function callNeedsTrustConfirm(call) {
    if (!call?.method)
        return false;
    if (isFileWriteMethod(call.method))
        return isSystemModifyCall(call);
    return DANGEROUS_METHODS.includes(call.method);
}

/** Params для вызова метода из tool_call: ACL role как у пользователя. */
function buildToolMethodParams(call, params, opts = {}) {
    const args = (call && call.args && typeof call.args === 'object') ? call.args : {};
    const out = { ...args, role: params?.role };
    if (opts.aiUser)
        out.user = opts.aiUser;
    else
        out.user = params?.user;
    return out;
}

/**
 * Выполнить один tool_call — вызов метода контекста или сервиса.
 * @returns {Promise<{result: any, newContext: object, spawnTask?: object}>}
 */
async function executeToolCall(call, currentContext, initialContext, functions, params, aiUser) {
    let result;

    // create с id-файлом — до dispatch (иначе $folder.create / ошибочный класс)
    if (call.method === 'create') {
        const id = String(call.args?.id ?? call.args?.name ?? '').trim();
        const type = call.args?.type;
        if (looksLikeFileId(id) || type === '$file' || type === '$folder') {
            return {
                result: {
                    error: 'create создаёт только класс. Файл — save_file({ filename, post }); папки появляются при save_file',
                },
                newContext: currentContext,
            };
        }
    }

    // edit (алиас edit_file) — точечный SEARCH/REPLACE в контексте
    if (call.method === 'edit' || call.method === 'edit_file') {
        const fileName = call.args?.filename || call.args?.name;
        const diff = call.args?.post ?? call.args?.diff ?? '';
        if (!fileName)
            return { result: { error: 'edit: нужен filename' }, newContext: currentContext };
        if (!String(diff).trim())
            return { result: { error: 'edit: нужен post (SEARCH/REPLACE)' }, newContext: currentContext };
        try {
            const file = await currentContext._get_item?.(String(fileName));
            if (!file?.edit && !file?.edit_file)
                return { result: { error: 'Файл не найден / нет edit: ' + fileName }, newContext: currentContext };
            const text = await file.edit(buildToolMethodParams(
                { method: 'edit', args: { post: String(diff) } },
                params,
                { aiUser },
            ));
            return {
                result: {
                    success: true,
                    message: 'Файл изменён: ' + fileName,
                    name: fileName,
                    path: file.path || '',
                    content: String(text ?? '').slice(0, 4000),
                },
                newContext: currentContext,
            };
        }
        catch (e) {
            return { result: { error: 'edit: ' + e.message }, newContext: currentContext };
        }
    }

    // list_skills / run_skill — skills-as-tools
    if (call.method === 'list_skills') {
        try {
            const root = await WORK.get_item('/skills');
            const tree = await root?.info?.({ deep: -1 });
            const leaves = [];
            const walk = (n) => {
                if (!n) return;
                if (!n.items?.length) {
                    if (n.path && /\$skill|skill/i.test(n.type || n.path))
                        leaves.push({ path: n.path, label: n.label || n.id || n.path });
                    else if (n.path && String(n.path).includes('/skills/'))
                        leaves.push({ path: n.path, label: n.label || n.id || n.path });
                    return;
                }
                for (const c of n.items || [])
                    walk(c);
            };
            walk(tree);
            const uniq = [];
            const seen = new Set();
            for (const leaf of leaves) {
                if (seen.has(leaf.path)) continue;
                seen.add(leaf.path);
                uniq.push(leaf);
            }
            return { result: { skills: uniq.slice(0, 80) }, newContext: currentContext };
        }
        catch (e) {
            return { result: { error: 'list_skills: ' + e.message }, newContext: currentContext };
        }
    }
    if (call.method === 'run_skill') {
        const skillPath = String(call.args?.path || '').trim();
        if (!skillPath)
            return { result: { error: 'run_skill: нужен path' }, newContext: currentContext };
        try {
            const skill = await WORK.get_item(skillPath);
            if (!skill)
                return { result: { error: 'Скилл не найден: ' + skillPath }, newContext: currentContext };
            const data = call.args?.data && typeof call.args.data === 'object' ? call.args.data : {};
            let out;
            if (typeof skill.execute === 'function')
                out = await skill.execute({ data, ...data }, { context: currentContext, user: params?.user });
            else
                out = { ok: false, error: 'У скилла нет execute()' };
            return { result: out, newContext: currentContext };
        }
        catch (e) {
            return { result: { error: 'run_skill: ' + e.message }, newContext: currentContext };
        }
    }

    // spawn_agent — вложенный последовательный task
    if (call.method === 'spawn_agent') {
        const goal = String(call.args?.goal || '').trim();
        if (!goal)
            return { result: { error: 'spawn_agent: нужен goal' }, newContext: currentContext };
        const rawSteps = Array.isArray(call.args?.steps) ? call.args.steps : [];
        const steps = (rawSteps.length ? rawSteps : [{ description: goal }]).map((s, i) => ({
            step: i + 1,
            description: String(s?.description || s?.label || goal),
            status: i === 0 ? 'in_progress' : 'proposed',
        }));
        const spawnTask = {
            type: 'task',
            label: goal,
            content: String(call.args?.brief || ''),
            state: 'active',
            steps,
            ribbon: [],
            spawned: true,
            time: Date.now(),
            sender: 'WORK',
        };
        return {
            result: {
                success: true,
                message: 'Подагент создан: ' + goal,
                note: 'Sequential: выполняй шаги этого task в следующих ходах harness.',
            },
            newContext: currentContext,
            spawnTask,
        };
    }

    // inspect_schema — trust/self-mod подготовка
    if (call.method === 'inspect_schema') {
        try {
            let target = currentContext;
            const p = String(call.args?.path || '').trim();
            if (p)
                target = await WORK.get_item(p);
            if (!target)
                return { result: { error: 'Элемент не найден' }, newContext: currentContext };
            const schema = await target.get_schema?.();
            return {
                result: {
                    path: target.path,
                    type: target.type,
                    trustLevel: target.trustLevel ?? null,
                    schema: schema ? {
                        className: schema.className,
                        properties: schema.properties,
                        methods: schema.methods,
                    } : null,
                },
                newContext: currentContext,
            };
        }
        catch (e) {
            return { result: { error: 'inspect_schema: ' + e.message }, newContext: currentContext };
        }
    }

    // save_file / write_file (алиас) — до generic dispatch (у $user нет write_file)
    if (isFileWriteMethod(call.method)) {
        if (isBrokenFcArgs(call.args)) {
            return {
                result: { error: 'Модель передала битые args FC ([object Object]). Вызови save_file({filename, post}).' },
                newContext: currentContext,
            };
        }
        const fileName = call.args?.filename || call.args?.name;
        const content = stripFcTrailer(call.args?.post ?? call.args?.content ?? '');
        if (!fileName)
            return { result: { error: 'save_file: нужен filename или name' }, newContext: currentContext };
        try {
            const saved = await currentContext.save_file?.(buildToolMethodParams(
                { method: 'save_file', args: { filename: String(fileName), post: String(content), encoding: 'utf-8' } },
                params,
                { aiUser },
            ));
            // Канон: history-файл из return save_file (log.path), не context/filename
            const resultPath = saved?.path || saved?.logFullPath;
            if (!resultPath) {
                return {
                    result: { error: 'save_file: нет history path в ответе' },
                    newContext: currentContext,
                };
            }
            return {
                result: {
                    success: true,
                    message: 'Файл сохранён: ' + fileName,
                    path: resultPath,
                    resultPath,
                    name: fileName,
                },
                newContext: currentContext,
            };
        }
        catch (e) {
            return {
                result: { error: 'Не удалось сохранить файл ' + fileName + ': ' + e.message },
                newContext: currentContext,
            };
        }
    }

    try {
        if (call.method === ASK_USER_METHOD)
            return { result: { ok: true, deferred: 'ask_user' }, newContext: currentContext };

        // Методы сервисов — маршрутизация через _servicePath
        const svcFn = functions.find(fn => fn.name === call.method && fn._servicePath);
        if (svcFn) {
            try {
                const svcItem = await WORK.get_item(svcFn._servicePath);
                const svcFnMethod = svcItem[call.method];
                if (typeof svcFnMethod === 'function') {
                    result = await svcFnMethod.call(svcItem, buildToolMethodParams(call, params));
                }
                else {
                    result = { error: 'Метод ' + call.method + ' не реализован' };
                }
            }
            catch (e) {
                result = { error: 'Ошибка сервиса: ' + e.message };
            }
        }
        else if (call.method === 'get_property' && call.args?.name) {
            const propName = call.args.name;
            const descriptor = Object.getOwnPropertyDescriptor(currentContext.constructor.prototype, propName);
            if (descriptor?.get) {
                result = descriptor.get.call(currentContext);
                if (result && typeof result === 'object' && typeof result.then === 'function')
                    result = await result;
            }
            else {
                result = currentContext[propName];
                if (result && typeof result === 'object' && typeof result.then === 'function')
                    result = await result;
            }
        }
        else if (call.method === 'set_property' && call.args?.name) {
            const propName = call.args.name;
            const value = call.args.value;
            const descriptor = Object.getOwnPropertyDescriptor(currentContext.constructor.prototype, propName);
            if (descriptor?.set) {
                descriptor.set.call(currentContext, value);
                result = { success: true, message: 'Свойство ' + propName + ' установлено' };
            }
            else {
                currentContext[propName] = value;
                result = { success: true, message: 'Свойство ' + propName + ' установлено' };
            }
        }
        else {
            const fn = currentContext[call.method];
            if (typeof fn === 'function') {
                result = await fn.call(currentContext, buildToolMethodParams(call, params));
            }
            else if (fn !== undefined) {
                result = await fn;
            }
            else {
                throw new Error('Метод/свойство "' + call.method + '" не найден у ' + currentContext.type);
            }
        }
    }
    catch (e) {
        result = { error: e.message };
    }

    // Специальные методы навигации
    let newContext = currentContext;

    if (call.method === 'navigate' && call.args?.path) {
        const targetPath = String(call.args.path);
        const target = await WORK.get_item(targetPath);
        if (target && target.path) {
            newContext = target;
            result = { success: true, message: 'Переход в контекст: ' + target.path };
            try {
                const schema = await target.get_schema?.();
                if (schema) {
                    result.context = target.path;
                    result.type = target.type;
                    result.label = target.label;
                    result.schema = {
                        className: schema.className,
                        properties: schema.properties,
                        methods: schema.methods,
                    };
                }
            }
            catch {}
        }
        else {
            result = { error: 'Элемент не найден: ' + targetPath };
        }
    }

    if (call.method === 'read_file' && call.args?.name) {
        const fileName = String(call.args.name);
        try {
            const file = await currentContext._get_item?.(fileName);
            if (file && file.load) {
                const content = await file.load({ encoding: 'utf-8' });
                result = { name: fileName, content: String(content).slice(0, 32000), size: content?.length || 0 };
            }
            else {
                result = { error: 'Файл не найден: ' + fileName };
            }
        }
        catch (e) {
            result = { error: 'Не удалось прочитать файл ' + fileName + ': ' + e.message };
        }
    }

    if (call.method === 'reset_context') {
        newContext = initialContext;
        result = { success: true, message: 'Контекст сброшен к классу: ' + initialContext.path };
    }

    // Авто-смена контекста, если метод вернул $item
    if (result && typeof result === 'object' && result.path && result.type
        && call.method !== 'navigate' && call.method !== 'reset_context') {
        newContext = result;
    }

    return { result, newContext };
}

/** Компактный content для ленты / LLM history (get_schema без params tree). */
function summarizeToolResultForRibbon(method, result) {
    if (method === 'get_schema' && result && typeof result === 'object' && !result.error) {
        const props = (result.properties || []).map(p => (typeof p === 'string' ? p : p?.name)).filter(Boolean);
        const methods = (result.methods || []).map(m => (typeof m === 'string' ? m : m?.name)).filter(Boolean);
        const jm = result.json_model;
        const compact = {
            className: result.className,
            properties: props.slice(0, 80),
            methods: methods.slice(0, 80),
            json_model: jm ? {
                id: jm.id,
                name: jm.name,
                type: jm.type,
                path: jm.path,
            } : undefined,
            _truncated: true,
        };
        return JSON.stringify(compact, null, 2).slice(0, SCHEMA_RESULT_MAX);
    }
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return String(resultStr || '').slice(0, TOOL_RESULT_MAX);
}

/** Сжать уже записанный tool_result (старые жирные get_schema). */
function compactToolResultContentForHistory(entry) {
    let content = String(entry?.content || '');
    if (entry?.tool !== 'get_schema' || content.length <= SCHEMA_RESULT_MAX)
        return content;
    try {
        return summarizeToolResultForRibbon('get_schema', JSON.parse(content));
    }
    catch {
        return content.slice(0, SCHEMA_RESULT_MAX) + '\n…';
    }
}

/** Результат tool_call в ленту (+ карточка файла при ok write). */
function pushToolResult(ribbonTarget, call, result, model) {
    const resultStr = summarizeToolResultForRibbon(call.method, result);
    const isError = result && typeof result === 'object' && result.error;
    const sender = model.path || 'WORK';
    const time = Date.now();
    const chatEntry = {
        type: 'tool_result',
        label: '🔧 ' + call.method,
        content: resultStr,
        tool: call.method,
        args: call.args || {},
        ok: !isError,
        time,
        sender,
    };
    if (result?.resultPath)
        chatEntry.resultPath = result.resultPath;
    ribbonTarget.push(chatEntry);
    // Карточка файла = history path из save_file (канон §1.6), не прокси filename
    const filePath = result?.resultPath || (isFileWriteMethod(call.method) ? result?.path : '');
    if (isFileWriteMethod(call.method) && !isError && filePath) {
        ribbonTarget.push({
            type: 'file',
            path: filePath,
            name: result.name || call.args?.filename || call.args?.name || '',
            time,
            sender,
        });
    }
}

/** Результат tool_call через WebSocket. */
function sendToolResultWs(wsPath, call, result) {
    const resultPreview = typeof result === 'string'
        ? result.slice(0, 2000)
        : JSON.stringify(result).slice(0, 2000);
    WORK.wsSend?.({ type: 'chat.tool_result', path: wsPath, tool: call.method, result: resultPreview });
}

// ============================================================================
// История для LLM (ribbon → messages)
// ============================================================================

/**
 * Инъекция текущего хода: TYPES[type].servicePrompt по паре (состояние, роль).
 * servicePrompt — строка (для всех ролей) или объект { default, USER, BOSS, ADMIN, ASSISTENT }.
 * Порядок выбора варианта: роль инъекции → default → строка.
 * Результат уходит ТОЛЬКО на острие messages текущего вызова (не в ленту, не в историю).
 */
function resolveServicePrompt(entry, role) {
    const type = entry?.type;
    if (!type || type === 'step' || type === 'ribbon' || type === 'details')
        return '';
    const raw = TYPES[type]?.servicePrompt;
    let tpl = '';
    if (typeof raw === 'string')
        tpl = raw;
    else if (raw && typeof raw === 'object') {
        const r = String(role || '').toUpperCase();
        tpl = raw[r] || raw.default || '';
    }
    if (!tpl)
        return '';
    const vars = {
        title: entry.title != null ? String(entry.title) : '',
        button: entry.button?.label != null ? String(entry.button.label) : '',
        path: entry.path != null ? String(entry.path) : '',
        name: entry.name != null ? String(entry.name) : '',
        tool: entry.tool != null ? String(entry.tool) : (entry.name != null ? String(entry.name) : ''),
        ok: entry.ok != null ? String(entry.ok) : '',
        label: entry.label != null ? String(entry.label) : '',
        step: entry.step != null ? String(entry.step) : '',
    };
    return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
}

function formatInteractiveFieldsFact(entry) {
    const title = entry.title ? ' «' + entry.title + '»' : '';
    const fields = Array.isArray(entry.fields) ? entry.fields : [];
    const lines = fields.map(f => {
        const opts = Array.isArray(f.options) ? ' (' + f.options.length + ' options)' : '';
        return '- ' + (f.id || '') + ': ' + (f.label || '') + ' [' + (f.type || 'text') + ']' + opts;
    });
    return 'UI ' + (entry.type || 'form') + title + ':\n'
        + (lines.length ? lines.join('\n') : '(нет полей)');
}

/** Фаза текущего шага Do: clarify без ответов → propose, иначе execute. */
function getDoStepPhase(activeTask) {
    if (!activeTask?.steps?.length) return 'done';
    if (activeTask.steps.every(s => s.status === 'done')) return 'done';
    const cur = activeTask.steps.find(s => s.status === 'in_progress')
        || activeTask.steps.find(s => s.status === 'proposed');
    if (cur && stepNeedsClarify(cur) && !stepEvidence(activeTask, cur).answered)
        return 'propose';
    return 'execute';
}

/**
 * Шаг уточнения данных у пользователя (ask_user), не исполнение tools.
 * Глаголы вопроса — всегда clarify; «определить/выбрать X» — clarify,
 * если X знает только пользователь (тема, цель, аудитория, формат…).
 * \b не работает с кириллицей — матчим словоформы по основам.
 */
function stepNeedsClarify(step) {
    const d = String(step?.description || '').toLowerCase();
    if (/уточн|спрос|опрос|запрос|выясн|согласу|согласов/.test(d))
        return true;
    // Разрыв — только целыми словами, чтобы «сис|темы» не давало ложный матч
    return /(определ|выбер|выбр|подобр)[а-яё]*\s+(?:[а-яё«»-]+[\s,]+){0,3}?(тем[аеуы]|цел[ьеия]|аудитор|адресат|получател|формат|стил|требован|критери|параметр|исходн|данн)/.test(d);
}

/**
 * ribbon → messages для streamChat: только факты диалога (system + история блоков).
 * Инъекция servicePrompt в историю НЕ пишется — она добавляется на острие в prompt().
 */
function buildHistoryFromRibbon(body, useFunctionCalling = false, opts = {}) {
    const messages = [];
    const historyOnly = !!opts.historyOnly;
    const protocol = opts.protocol || '';
    const fcStyle = protocol === 'gigachat' ? 'gigachat' : 'openai';
    let toolCallSeq = opts._toolCallSeq || { n: 0 };
    const childOpts = { ...opts, historyOnly: true, protocol, _toolCallSeq: toolCallSeq };

    // 1. System (не для вложенной ленты task — иначе дубли ACL mid-history)
    if (!historyOnly) {
        let systemContent = body.system || '';
        if (body.context)
            systemContent += '\n\n## Текущий контекст\n' + body.context;
        systemContent += formatRoleAclForSystem(body.role);
        systemContent += formatPairContextForSystem(body.classBundle, body.userBundle, {
            mem: body.mem,
            readme: body.readme,
        });

        const activeTask = findActiveTask(body);
        if (activeTask) {
            const cur = activeTask.steps?.find(s => s.status === 'in_progress')
                || activeTask.steps?.find(s => s.status === 'proposed');
            const phase = getDoStepPhase(activeTask);
            systemContent += '\n\n## Исполнение задачи (Do)\n';
            systemContent += 'Активный план: «' + (activeTask.label || 'План') + '».\n';
            systemContent += 'Шаги: ' + JSON.stringify(activeTask.steps || []) + '\n';
            if (cur) {
                systemContent += 'Сейчас шаг ' + cur.step + ': «' + cur.description + '».\n';
                const ev = stepEvidence(activeTask, cur);
                systemContent += 'Доказательства шага: опрос '
                    + (ev.answered ? 'есть' : 'нет') + ', успешный tool '
                    + (ev.toolOk ? 'есть' : 'нет')
                    + '; complete_step примется только при их наличии.\n';
            }
            const artifacts = collectArtifacts(body);
            systemContent += artifacts.length
                ? 'Артефакты (реальные пути): ' + artifacts.join(', ') + '\n'
                : 'Артефактов ещё нет — не упоминай несуществующие файлы.\n';
            if (Number.isFinite(opts.autoTurnsLeft))
                systemContent += 'Остаток авто-ходов: ' + opts.autoTurnsLeft + '.\n';
            if (phase === 'execute')
                systemContent += 'Фаза: EXECUTE.\n';
            else if (phase === 'propose')
                systemContent += 'Фаза: PROPOSE.\n';
        }
        if (systemContent)
            messages.push({ role: 'system', content: systemContent });
    }

    // 2. Обход блоков ленты — ТОЛЬКО факты диалога.
    // Никаких [инструкция]: инъекция текущего хода добавляется на острие в prompt().
    const ribbon = body.ribbon || [];
    let pendingAssistant = '';

    const flushPending = () => {
        if (!pendingAssistant)
            return;
        messages.push({ role: 'assistant', content: pendingAssistant });
        pendingAssistant = '';
    };

    for (const entry of ribbon) {
        if ((entry.type === 'prompt' || entry.role === 'user') && (entry.content || entry.answers)) {
            flushPending();
            let content = entry.content || '';
            if (entry.answers && typeof entry.answers === 'object') {
                const lines = Object.entries(entry.answers).map(([k, v]) => k + ': ' + v);
                content = (content ? content + '\n' : '') + 'Ответы:\n' + lines.join('\n');
            }
            messages.push({ role: 'user', content });
            continue;
        }

        if (entry.type === 'text' && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        if ((entry.type === 'thinking' || entry.type === 'details') && entry.content) {
            flushPending();
            messages.push({ role: 'assistant', content: entry.content });
            continue;
        }
        if (entry.type === 'thinking' || entry.type === 'details')
            continue;

        if (entry.type === 'action') {
            flushPending();
            const title = entry.title || '';
            const button = entry.button?.label || '';
            messages.push({
                role: 'user',
                content: 'UI action «' + title + '» / кнопка «' + button + '» — ожидает ответа пользователя.',
            });
            continue;
        }
        if (entry.type === 'form' || entry.type === 'questions') {
            flushPending();
            messages.push({ role: 'user', content: formatInteractiveFieldsFact(entry) });
            continue;
        }

        if (entry.type === 'file') {
            flushPending();
            messages.push({
                role: 'user',
                content: 'Вложение: ' + (entry.path || '') + ' (' + (entry.name || '') + ')',
            });
            continue;
        }

        if (entry.type === 'error' && entry.content) {
            flushPending();
            messages.push({ role: 'assistant', content: entry.content });
            continue;
        }

        if ((entry.type === 'task' || entry.type === 'block') && entry.steps) {
            flushPending();
            messages.push({ role: 'assistant', content: '<plan>' + JSON.stringify(entry.steps) + '</plan>' });
            if (entry.type === 'task' && Array.isArray(entry.ribbon) && entry.ribbon.length) {
                messages.push(...buildHistoryFromRibbon(
                    { ribbon: entry.ribbon },
                    useFunctionCalling,
                    childOpts,
                ));
            }
            continue;
        }

        if (entry.type === 'block' && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        if (entry.type === 'tool') {
            if (useFunctionCalling)
                continue;
            flushPending();
            pendingAssistant = 'Вызов ' + (entry.name || 'tool') + (entry.args ? ': ' + JSON.stringify(entry.args) : '');
            continue;
        }

        if (entry.type === 'tool_result' && entry.content) {
            flushPending();
            if (useFunctionCalling) {
                const id = 'call_' + (entry.tool || 'fn') + '_' + (toolCallSeq.n++);
                messages.push(...formatToolResultMessages(entry, fcStyle, id));
            }
            else {
                messages.push({
                    role: 'user',
                    content: 'Результат ' + (entry.label || entry.tool || 'метода') + ':\n'
                        + compactToolResultContentForHistory(entry),
                });
            }
            continue;
        }

        if (entry.type === 'task') {
            flushPending();
            messages.push(...buildHistoryFromRibbon(
                { ribbon: entry.ribbon || [] },
                useFunctionCalling,
                childOpts,
            ));
        }
    }

    if (pendingAssistant)
        messages.push({ role: 'assistant', content: pendingAssistant });

    return messages;
}

/**
 * Сообщения LLM для одного tool_result: gigachat legacy vs OpenAI tools.
 * @param {'gigachat'|'openai'} style
 */
function formatToolResultMessages(entry, style, callId) {
    const fnName = entry.tool || 'unknown';
    const fnArgs = sanitizeToolArgsForHistory(entry.args);
    const argsStr = typeof fnArgs === 'string' ? fnArgs : JSON.stringify(fnArgs || {});
    const resultContent = compactToolResultContentForHistory(entry);
    if (style === 'gigachat') {
        return [
            {
                role: 'assistant',
                content: '',
                function_call: { name: fnName, arguments: fnArgs },
            },
            { role: 'function', name: fnName, content: resultContent },
        ];
    }
    const id = callId || ('call_' + fnName + '_0');
    return [
        {
            role: 'assistant',
            content: null,
            tool_calls: [{
                id,
                type: 'function',
                function: { name: fnName, arguments: argsStr },
            }],
        },
        { role: 'tool', tool_call_id: id, content: resultContent },
    ];
}

// ============================================================================
// Роли / ACL
// ============================================================================

/** Канонические роли WORK */
function normalizeRole(role) {
    const r = String(role || 'USER').toUpperCase().trim();
    if (r === 'ADMIN' || r === 'BOSS' || r === 'USER')
        return r;
    return 'USER';
}

/** Политика роли для system prompt (USER / BOSS / ADMIN). */
function formatRoleAclForSystem(role) {
    const r = normalizeRole(role);
    let out = '\n\n## Права роли (' + r + ')\n';
    out += 'Действуй строго в зоне роли. Tools вызываются с role=' + r + '. Не повышай роль.\n';
    if (r === 'ADMIN') {
        out += 'ADMIN: можно наращивать класс (class.js, handlers, methods, triggers, структура метапапки).\n';
        out += 'MODIFY-PATH: при изменении типизаторов/системы сначала <plan> + «Начать», затем tools; опасные/system-modify ждут confirm пользователя.\n';
        out += 'Не правь sources/ ядра без явного запроса и отдельного подтверждения.\n';
    }
    else if (r === 'BOSS') {
        out += 'BOSS: цели и процессы узла, рабочие артефакты управленческой зоны. Запрещено: class.js, handlers/triggers типизаторов, #secret.\n';
        out += 'Изменение системы класса — только через ADMIN.\n';
    }
    else {
        out += 'USER: зона `$user` (папки `work`, `text`, …), свои файлы и логи. Запрещено: типизаторы класса, class.js, handlers, системные $-элементы.\n';
    }
    return out;
}

/**
 * Вызов меняет типизатор / class.js / handlers (нужен ADMIN + confirm).
 * Не путать с navigate/read в `$user/…` (ложный match на любой `/$`).
 */
function isSystemModifyCall(call) {
    if (!call?.method)
        return false;
    // Чтение / смена контекста — не system-modify
    if (/^(navigate|read_file|reset_context|info|get_schema|ask_user)$/i.test(call.method))
        return false;
    if (call.method === 'save')
        return true;
    const p = String(
        call.args?.name || call.args?.filename || call.args?.path || call.args?.target || '',
    );
    if (!p)
        return false;
    if (/class\.js$/i.test(p))
        return true;
    if (/(^|\/)(handlers|triggers|methods)(\/|$)/i.test(p))
        return true;
    // $-мета кроме личной `$user`
    if (/(^|\/)\$(?!user\b)[\w.-]+/i.test(p))
        return true;
    return false;
}

/** Блок для не-ADMIN при попытке system-modify. @returns {string|null} */
function roleBlocksTool(role, call) {
    const r = normalizeRole(role);
    if (r === 'ADMIN')
        return null;
    if (isSystemModifyCall(call))
        return 'Роль ' + r + ': изменение типизаторов/class.js/handlers только для ADMIN';
    return null;
}

// ============================================================================
// Usage (токены хода и задачи)
// ============================================================================

/** Эвристика токенов: кириллица ≈ 1/2.5 символа, иначе ≈ 1/4. */
function estimateTokens(text) {
    const s = text == null ? '' : String(text);
    if (!s)
        return 0;
    const cyr = /[\u0400-\u04FF]/.test(s);
    return Math.max(1, Math.ceil(s.length / (cyr ? 2.5 : 4)));
}

/** Оценка prompt-токенов по полному messages[]. */
function estimateMessagesTokens(messages) {
    if (!Array.isArray(messages) || !messages.length)
        return 0;
    let n = 0;
    for (const m of messages) {
        if (!m || typeof m !== 'object')
            continue;
        if (m.content != null)
            n += estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
        if (m.name)
            n += estimateTokens(m.name);
        if (m.tool_calls)
            n += estimateTokens(JSON.stringify(m.tool_calls));
        if (m.function_call)
            n += estimateTokens(JSON.stringify(m.function_call));
        n += 4;
    }
    return n;
}

/** Usage хода: API если есть, иначе оценка по messages + completion. */
function resolveTurnUsage(turnUsage, messages, completionText) {
    const hasApi = turnUsage
        && turnUsage.source === 'api'
        && (turnUsage.total || turnUsage.prompt || turnUsage.completion);
    if (hasApi) {
        const prompt = Number(turnUsage.prompt) || 0;
        const completion = Number(turnUsage.completion) || 0;
        const total = Number(turnUsage.total) || (prompt + completion);
        return { prompt, completion, total, source: 'api' };
    }
    if (turnUsage && (turnUsage.total || turnUsage.prompt || turnUsage.completion)
        && turnUsage.source !== 'estimate') {
        const prompt = Number(turnUsage.prompt) || 0;
        const completion = Number(turnUsage.completion) || 0;
        const total = Number(turnUsage.total) || (prompt + completion);
        if (prompt || completion || total)
            return { prompt, completion, total, source: 'api' };
    }
    const prompt = estimateMessagesTokens(messages);
    const completion = estimateTokens(completionText || '');
    const total = prompt + completion;
    if (!total)
        return null;
    return { prompt, completion, total, source: 'estimate' };
}

/** Usage хода → последний AI-блок + накопление в body.usage. */
function applyTurnUsage(body, ribbonTarget, turnUsage, model) {
    if (!turnUsage || !(turnUsage.total || turnUsage.prompt || turnUsage.completion))
        return;
    const ctxWin = Number(model?.contextWindow || model?.context_window || model?.maxContext || 128000) || 128000;
    const prompt = Number(turnUsage.prompt) || 0;
    const completion = Number(turnUsage.completion) || 0;
    const total = Number(turnUsage.total) || (prompt + completion);
    const contextPct = ctxWin > 0 ? Math.min(100, Math.round((prompt / ctxWin) * 100)) : 0;
    const source = turnUsage.source === 'estimate' ? 'estimate' : 'api';
    const usage = { prompt, completion, total, contextPct, contextWindow: ctxWin, source };

    if (Array.isArray(ribbonTarget)) {
        const prefer = ['thinking', 'text', 'tool_result', 'error', 'action'];
        let placed = false;
        for (const t of prefer) {
            for (let i = ribbonTarget.length - 1; i >= 0; i--) {
                const b = ribbonTarget[i];
                if (b?.type === t) {
                    b.usage = usage;
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }
    }

    body.usage = body.usage || { prompt: 0, completion: 0, total: 0, turns: 0 };
    body.usage.prompt = (Number(body.usage.prompt) || 0) + prompt;
    body.usage.completion = (Number(body.usage.completion) || 0) + completion;
    body.usage.total = (Number(body.usage.total) || 0) + total;
    body.usage.contextPct = contextPct;
    body.usage.contextWindow = ctxWin;
    body.usage.turns = (Number(body.usage.turns) || 0) + 1;
    body.usage.lastSource = source;
}

// ============================================================================
// Контекст пары class + user (readme, .mem, логи) + @path (канон §1.7)
// ============================================================================

/** На новый user prompt: пересобрать body.context / classBundle / userBundle. */
async function refreshPromptContext(body, initialContext, params, text) {
    try {
        const logWindow = normalizeLogWindow(body.logWindow);
        const classBundle = await loadContextBundle(initialContext, logWindow);
        const userStorage = await resolveUserStorage(params);
        const userBundle = userStorage && userStorage !== initialContext
            ? await loadContextBundle(userStorage, logWindow)
            : { readme: '', mem: '', logs: '', path: '' };
        const contextInfo = await buildContextInfo(initialContext);
        const atPathBlock = await loadAtPathMentions(text);
        body.context = 'Роль: ' + normalizeRole(body.role) + '\n' + contextInfo
            + (atPathBlock ? '\n\n## Упомянутые @path\n' + atPathBlock : '');
        body.classBundle = classBundle;
        body.userBundle = userBundle;
        // legacy поля класса (совместимость старых task.ai)
        body.mem = classBundle.mem || '';
        body.readme = classBundle.readme || '';
    }
    catch (e) {
        console.warn('[task.ai] refreshPromptContext:', e.message);
    }
}

async function buildContextInfo(context) {
    try {
        await context.info();
        let info = 'Ты находишься здесь: ' + (context.path || context.short || '?') + '\n';
        info += 'Тип элемента: ' + context.type + '\n';
        if (context.label)
            info += 'Название: ' + context.label + '\n';
        return info;
    }
    catch {
        return 'Контекст: ' + (context.path || '?') + '\n';
    }
}

/** Окно логов для контекста пары. */
function normalizeLogWindow(raw = {}) {
    const d = raw?.days != null && raw.days !== '' ? Number(raw.days) : CONTEXT_LOG_DAYS;
    const m = raw?.maxRows != null && raw.maxRows !== '' ? Number(raw.maxRows) : CONTEXT_LOG_MAX_ROWS;
    const days = Math.min(30, Math.max(1, Number.isFinite(d) ? d : CONTEXT_LOG_DAYS));
    const maxRows = Math.min(200, Math.max(5, Number.isFinite(m) ? m : CONTEXT_LOG_MAX_ROWS));
    return { days, maxRows };
}

/** Сжать записи логов в текст для system prompt. */
function formatLogSummary(rows, opts = {}) {
    const maxRows = opts.maxRows ?? CONTEXT_LOG_MAX_ROWS;
    const lineMax = opts.lineMax ?? CONTEXT_LOG_LINE_MAX;
    if (!Array.isArray(rows) || !rows.length)
        return '';
    const slice = rows.slice(0, maxRows);
    const lines = [];
    for (const row of slice) {
        const t = row.time ? new Date(row.time).toISOString().slice(0, 16).replace('T', ' ') : '';
        const who = row.user || row.sender || row.uid || '';
        const rowPath = row.path || row.short || row.id || '';
        const ext = row.ext || '';
        let label = [t, who, ext, rowPath].filter(Boolean).join(' | ');
        if (label.length > lineMax)
            label = label.slice(0, lineMax - 1) + '…';
        lines.push('- ' + label);
    }
    if (rows.length > maxRows)
        lines.push('- … ещё ' + (rows.length - maxRows) + ' записей');
    return lines.join('\n');
}

/** Блоки ## Класс / ## Пользователь для system (с legacy mem/readme класса). */
function formatPairContextForSystem(classBundle, userBundle, legacy = {}) {
    let out = '';
    const cls = classBundle && typeof classBundle === 'object' ? classBundle : null;
    const usr = userBundle && typeof userBundle === 'object' ? userBundle : null;
    const classReadme = (cls && cls.readme) || legacy.readme || '';
    const classMem = (cls && cls.mem) || legacy.mem || '';
    const classLogs = (cls && cls.logs) || '';
    const classPath = (cls && cls.path) || '';

    if (classPath || classReadme || classMem || classLogs) {
        out += '\n\n## Класс';
        if (classPath)
            out += '\nПуть: ' + classPath;
        if (classReadme)
            out += '\n\n### readme.md\n' + classReadme;
        if (classMem)
            out += '\n\n### Память (.mem)\n' + classMem;
        if (classLogs)
            out += '\n\n### Логи класса\n' + classLogs;
    }

    if (usr && (usr.path || usr.readme || usr.mem || usr.logs)) {
        out += '\n\n## Пользователь';
        if (usr.path)
            out += '\nПуть: ' + usr.path;
        if (usr.readme)
            out += '\n\n### readme.md\n' + usr.readme;
        if (usr.mem)
            out += '\n\n### Память (.mem)\n' + usr.mem;
        if (usr.logs)
            out += '\n\n### Логи пользователя\n' + usr.logs;
    }
    return out;
}

/** $user storage по params.user. */
async function resolveUserStorage(params = {}) {
    const uid = params.user?.uid || params.user?.$user?.id || params.user?.id;
    if (!uid || typeof WORK?.get_item !== 'function')
        return null;
    try {
        let item = await WORK.get_item('/USERS/' + uid);
        if (!item)
            item = await WORK.get_item('/USERS//' + uid);
        return item || null;
    }
    catch (e) {
        console.warn('[task.ai] resolveUserStorage:', e.message);
        return null;
    }
}

/** Бандл контекста storage: readme + mem + сжатые логи. */
async function loadContextBundle(storage, windowOpts = {}) {
    const { days, maxRows } = normalizeLogWindow(windowOpts);
    if (!storage)
        return { path: '', readme: '', mem: '', logs: '' };
    const storagePath = storage.path || storage.short || '';
    const readme = await loadReadme(storage);
    const mem = await loadMemFiles(storage);
    let logs = '';
    try {
        logs = await loadLogSummary(storage, { days, maxRows });
    }
    catch (e) {
        console.warn('[task.ai] loadContextBundle logs:', e.message);
    }
    return { path: storagePath, readme, mem, logs };
}

/** Сжатые логи storage за N дней (напрямую, без _logSource). */
async function loadLogSummary(storage, opts = {}) {
    const { days, maxRows } = normalizeLogWindow(opts);
    if (!storage)
        return '';
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (days - 1));
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    let rows = [];
    if (typeof storage.read_log_bodies === 'function')
        rows = await storage.read_log_bodies({ from: fromStr, to: toStr });
    else if (typeof storage.logs === 'function')
        rows = await storage.logs({ mode: 'bodies', from: fromStr, to: toStr });
    if (!Array.isArray(rows))
        rows = rows ? [rows] : [];
    return formatLogSummary(rows, { maxRows });
}

/** readme.md из метапапки класса (если существует). */
async function loadReadme(storage) {
    try {
        const meta = storage.meta_folder || storage;
        const file = await meta._get_item?.('readme.md');
        if (file && file.load) {
            const content = await file.load({ encoding: 'utf-8' });
            if (content)
                return typeof content === 'string' ? content : String(content);
        }
    }
    catch (e) {
        console.warn('[task.ai] loadReadme:', e.message);
    }
    return '';
}

/** Все *.mem storage → блоки текста. */
async function loadMemFiles(storage) {
    try {
        const children = await storage.children;
        if (!Array.isArray(children))
            return '';
        const memFiles = children.filter(f => f.id?.endsWith('.mem'));
        if (!memFiles.length)
            return '';
        const parts = [];
        for (const file of memFiles) {
            try {
                const content = await file.load({ encoding: 'utf-8' });
                if (content)
                    parts.push('### ' + file.id + '\n' + (typeof content === 'string' ? content : String(content)));
            }
            catch (e) {
                console.warn('[task.ai] loadMemFiles:', file.id, e.message);
            }
        }
        return parts.join('\n\n');
    }
    catch (e) {
        console.warn('[task.ai] loadMemFiles:', e.message);
        return '';
    }
}

/** Cursor-like @/path mentions в тексте пользователя → сниппеты в system context. */
async function loadAtPathMentions(text) {
    if (!text || typeof text !== 'string')
        return '';
    const re = /@(\/[^\s"'<>]+)/g;
    const paths = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        const p = m[1].replace(/[.,;:!?)]+$/, '');
        if (p && !paths.includes(p))
            paths.push(p);
        if (paths.length >= 8)
            break;
    }
    if (!paths.length)
        return '';
    const parts = [];
    for (const p of paths) {
        try {
            const item = await WORK.get_item(p);
            if (!item)
                continue;
            if (typeof item.load === 'function') {
                const content = await item.load({ encoding: 'utf-8' });
                parts.push('### ' + p + '\n```\n' + String(content ?? '').slice(0, 12000) + '\n```');
            }
            else {
                const schema = await item.get_schema?.();
                parts.push('### ' + p + '\n(type: ' + (item.type || '?') + '; methods: '
                    + Object.keys(schema?.methods || {}).slice(0, 40).join(', ') + ')');
            }
        }
        catch (e) {
            parts.push('### ' + p + '\n(ошибка: ' + e.message + ')');
        }
    }
    return parts.join('\n\n');
}

// ============================================================================
// Парсер ответа модели (теги → блоки TYPE)
// ============================================================================

/**
 * Markdown-оформление плана для action.content.
 * При наличии steps — только список (без парафраза prose); короткий CTA допускается.
 */
function formatPlanMarkdown(steps, prose) {
    const parts = [];
    const hasSteps = Array.isArray(steps) && steps.length;
    if (hasSteps) {
        for (const s of steps) {
            const n = s.step != null ? s.step : '';
            const desc = s.description || '';
            parts.push(n !== '' ? `${n}. ${desc}` : `- ${desc}`);
        }
        const cta = extractShortCta(prose);
        if (cta)
            parts.push('', cta);
        return parts.join('\n').trim();
    }
    if (prose)
        return String(prose).trim();
    return '';
}

/** Короткая фраза-вопрос в конце prose (не парафраз плана) */
function extractShortCta(prose) {
    if (!prose) return '';
    const t = String(prose).trim();
    const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    const last = parts[parts.length - 1] || t;
    if (last.length <= 40 && /[?？]\s*$/.test(last))
        return last.trim();
    return '';
}

/**
 * Разобрать ответ ИИ на типизированные блоки.
 * @returns {{ blocks: Array, pendingPlan: object|null, pendingSubplan: Array|null }}
 */
function parseResponseToRibbon(text, sender = 'WORK') {
    const blocks = [];
    let pendingPlan = null;
    let pendingSubplan = null;
    let planRejected = false; // тег <plan> был, но пригодных шагов не извлечь
    let actionMeta = null;
    const time = Date.now();
    if (!text)
        return { blocks, pendingPlan, pendingSubplan, planRejected };

    let remaining = normalizeChannelTags(text);
    const proseParts = [];

    // 1. <reasoning> → thinking. Каналы внутри reasoning не глотаем:
    // thinking обрезается на первом теге канала, хвост возвращается в обычный разбор
    const CHANNEL_TAG_RE = /<(?:plan|propose_plan|subplan|questions|form|action|tool_call)\b/i;
    const splitReasoningBody = (inner) => {
        const m = inner.match(CHANNEL_TAG_RE);
        return m
            ? { head: inner.slice(0, m.index), tail: inner.slice(m.index) }
            : { head: inner, tail: '' };
    };
    remaining = remaining.replace(/<reasoning>([\s\S]*?)<\/reasoning>/g, (_, inner) => {
        const { head, tail } = splitReasoningBody(inner);
        if (head.trim())
            blocks.push({ type: 'thinking', label: 'Мысли', content: head.trim(), time, sender });
        return tail;
    });
    // Незакрытый <reasoning> в конце стрима — голова в «Мысли», хвост с каналами — в разбор
    const unclosedReasoning = remaining.match(/<reasoning>([\s\S]*)$/i);
    if (unclosedReasoning) {
        const { head, tail } = splitReasoningBody(unclosedReasoning[1]);
        if (head.trim())
            blocks.push({ type: 'thinking', label: 'Мысли', content: head.trim(), time, sender });
        remaining = (remaining.slice(0, unclosedReasoning.index) + tail).trimEnd();
    }

    // 1b. <subplan> → декомпозиция текущего шага
    const subExtract = extractBalancedJsonArray(remaining, '<subplan>', '</subplan>');
    if (subExtract) {
        try {
            const steps = JSON.parse(subExtract.raw);
            if (Array.isArray(steps) && steps.length) {
                pendingSubplan = steps;
                remaining = remaining.slice(0, subExtract.index) + remaining.slice(subExtract.end);
            }
        }
        catch {}
    }

    // 1c. Prose-форма «{subplan}[…]» / «{subplan}{…}» — GigaChat пишет маркер
    // в фигурных скобках вместо тега <subplan> или FC
    if (!pendingSubplan) {
        const braceSub = consumeBraceSubplan(remaining);
        if (braceSub) {
            pendingSubplan = braceSub.steps;
            remaining = remaining.slice(0, braceSub.index) + remaining.slice(braceSub.end);
        }
    }

    // 2. <plan> / <propose_plan> → pendingPlan (JSON, нумерованный список, bullet YAML)
    for (const tagName of ['plan', 'propose_plan']) {
        if (pendingPlan)
            break;
        const consumed = consumePlanXmlTag(remaining, tagName);
        if (consumed.before)
            proseParts.push(consumed.before);
        remaining = consumed.remaining;
        if (consumed.pendingPlan) {
            pendingPlan = consumed.pendingPlan;
            planRejected = false;
        }
        else if (consumed.planRejected) {
            planRejected = true;
        }
    }

    // 3. <action> → метаданные кнопки подтверждения (канон — JSON внутри тега)
    const actionMatch = remaining.match(/<action>\s*(\{[\s\S]*?\})\s*<\/action>/);
    if (actionMatch) {
        try {
            const action = JSON.parse(actionMatch[1]);
            actionMeta = {
                label: action.label || action.text || 'OK',
                color: action.color || 'success',
                title: action.title || '',
            };
        }
        catch {}
        remaining = remaining.replace(/<action>[\s\S]*?<\/action>/g, '');
    }
    else {
        // Атрибутная форма слабых моделей: <action title="…" label="…" color="…">текст</action>
        const attrMatch = remaining.match(/<action\s+([^>]*?)\/?>(?:\s*([\s\S]*?)\s*<\/action>)?/i);
        if (attrMatch) {
            const attrs = parseXmlTagAttrs(attrMatch[1]);
            if (attrs.label || attrs.title || attrs.text) {
                actionMeta = {
                    label: attrs.label || attrs.text || attrs.title || 'OK',
                    color: attrs.color || 'success',
                    title: attrs.title || '',
                };
            }
            // Внутренний текст тега — в prose, сам тег — вон
            remaining = remaining.slice(0, attrMatch.index)
                + (attrMatch[2] || '')
                + remaining.slice(attrMatch.index + attrMatch[0].length);
        }
    }

    // 4. <questions> → опросник (balanced array; без </questions> тоже)
    let questionFields = null;
    const questionsExtract = extractBalancedJsonArray(remaining, '<questions>', '</questions>', {
        allowMissingClose: true,
    });
    if (questionsExtract) {
        try {
            const questions = JSON.parse(questionsExtract.raw);
            if (Array.isArray(questions) && questions.length) {
                questionFields = questions
                    .map(q => mapAskQuestionToField(q))
                    .filter(isAskQuestionField)
                    .map(normalizeFieldMeta);
                if (!questionFields.length)
                    questionFields = null;
            }
        }
        catch {}
        remaining = remaining.slice(0, questionsExtract.index) + remaining.slice(questionsExtract.end);
    }
    else if (/<questions\b/i.test(remaining)) {
        remaining = remaining.replace(/<questions\b[\s\S]*?(?:<\/questions>|$)/i, '');
    }

    // 5. <form> → форма ввода данных
    let formFields = null;
    const formMatch = remaining.match(/<form>\s*(\[[\s\S]*?\])\s*<\/form>/);
    if (formMatch) {
        try {
            const fields = JSON.parse(formMatch[1]);
            if (Array.isArray(fields) && fields.length)
                formFields = fields.map(normalizeFieldMeta);
        }
        catch {}
        remaining = remaining.replace(/<form>[\s\S]*?<\/form>/g, '');
    }

    // 5b. <ask_user>…</ask_user> — модель пишет tool текстом; → questions, не prose
    let askUserFields = null;
    const askUserMatch = remaining.match(/<ask_user>\s*([\s\S]*?)\s*<\/ask_user>/i);
    if (askUserMatch) {
        try {
            const raw = askUserMatch[1].trim();
            const parsedAsk = JSON.parse(raw);
            const args = Array.isArray(parsedAsk)
                ? { questions: parsedAsk }
                : (parsedAsk && typeof parsedAsk === 'object' ? parsedAsk : {});
            const qBlock = questionsFromAskUser(args, sender);
            if (qBlock?.fields?.length)
                askUserFields = qBlock.fields;
        }
        catch {}
        remaining = remaining.replace(/<ask_user>[\s\S]*?<\/ask_user>/gi, '');
    }

    // 6. tool_call / мусор FC в prose — не в ленту
    // Закрытый и незакрытый <tool>name — иначе «<tool>ask_user» оседает мёртвым text
    remaining = remaining.replace(/<tool>\s*[\w.-]+\s*(?:<\/tool>)?/gi, '');
    remaining = remaining.replace(/<\/tool>/gi, '');
    remaining = remaining.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    remaining = remaining.replace(/```tool_call[\s\S]*?```/g, '');
    remaining = remaining.replace(/```ask_user[\s\S]*?```/gi, '');
    remaining = remaining.replace(/<function(?:\s+|_)calling>[\s\S]*?<\/function(?:\s+|_)calling>/gi, '');
    remaining = remaining.replace(/<function(?:\s[^>]*)?>[\s\S]*?<\/function>/gi, '');
    remaining = remaining.replace(/<\/?function_caller>/gi, '');
    remaining = remaining.replace(/<\/?function\s+caller[^>]*>/gi, '');
    // Сырые теги каналов, не разобранные выше, — вырезать, текст внутри оставить
    remaining = remaining.replace(/<\/?(?:action|plan|propose_plan|subplan|questions|form|reasoning)\b[^>]*>/gi, '');
    remaining = stripJsStyleToolProse(remaining);
    remaining = stripRawActionJsonFromProse(remaining);

    const cleanText = remaining.trim();
    if (cleanText)
        proseParts.push(cleanText);
    const prose = stripRawActionJsonFromProse(proseParts.join('\n\n').trim());

    // Prefer <questions>; иначе поля из <ask_user>
    if (!questionFields?.length && askUserFields?.length)
        questionFields = askUserFields;

    // 7. Разнести типы: plan/action confirm vs questions vs form
    if (pendingPlan) {
        blocks.push({
            type: 'action',
            title: 'План',
            content: formatPlanMarkdown(pendingPlan.steps, prose) || prose || '',
            button: {
                label: 'Начать',
                color: actionMeta?.color || 'success',
            },
            time,
            sender,
        });
        // questions/form на фазе плана — не в тот же ход (уточнение после Начать)
    }
    else if (questionFields?.length) {
        blocks.push({
            type: 'questions',
            title: stripBoilerplateContent(actionMeta?.title),
            content: stripBoilerplateContent(prose),
            fields: questionFields,
            button: {
                label: actionMeta?.label || 'Уточнить',
                color: actionMeta?.color || 'success',
            },
            time,
            sender,
        });
    }
    else if (formFields?.length) {
        blocks.push({
            type: 'form',
            title: stripBoilerplateContent(actionMeta?.title),
            content: stripBoilerplateContent(prose),
            fields: formFields,
            button: {
                label: actionMeta?.label || 'Продолжить',
                color: actionMeta?.color || 'success',
            },
            time,
            sender,
        });
    }
    else if (actionMeta) {
        // Голый «Уточнить»/«Продолжить» без полей — не action confirm
        const label = String(actionMeta.label || '');
        if (!/^(уточнить|продолжить)$/i.test(label.trim())) {
            let title = actionMeta.title || '';
            if (!title) {
                if (/принять|готово/i.test(label)) title = 'Отчёт';
                else title = 'Действие';
            }
            blocks.push({
                type: 'action',
                title,
                content: prose || 'Подтвердите действие',
                button: {
                    label: actionMeta.label,
                    color: actionMeta.color || 'success',
                },
                time,
                sender,
            });
        }
        else if (prose) {
            blocks.push({ type: 'text', content: prose, time, sender });
        }
    }
    else if (prose) {
        blocks.push({ type: 'text', content: prose, time, sender });
    }

    return { blocks, pendingPlan, pendingSubplan, planRejected };
}

/**
 * Ответ think-хода целиком становится thinking-блоком.
 * Если модель по привычке обернула его в <reasoning> — снимаем обёртку (лат/кир, парная и висячая).
 */
function stripReasoningWrapper(text) {
    let out = String(text || '').trim();
    out = out.replace(/<\/?\s*(?:reasoning|мысли|размышления)\s*>/gi, '');
    return out.trim();
}

/**
 * Кириллические теги каналов слабых моделей → канонические латинские.
 * Толерантность парсера; канон в servicePrompt остаётся латиницей.
 */
function normalizeChannelTags(text) {
    const ALIASES = [
        ['план', 'plan'],
        ['подплан', 'subplan'],
        ['вопросы', 'questions'],
        ['форма', 'form'],
        ['действие', 'action'],
        ['мысли', 'reasoning'],
        ['рассуждение', 'reasoning'],
    ];
    let out = String(text);
    for (const [cyr, lat] of ALIASES)
        out = out.replace(new RegExp('<(/?)' + cyr + '\\s*>', 'gi'), '<$1' + lat + '>');
    return out;
}

/** Fallback-разбор плана: строки «1. …» → шаги (когда JSON внутри <plan> невалиден). */
function parseNumberedListSteps(text = '') {
    const steps = [];
    for (const m of String(text).matchAll(/^\s*\d+[.)]\s*(?:шаг:?\s*)?(.+)$/gim)) {
        const description = m[1].replace(/\*\*/g, '').trim();
        if (description)
            steps.push({ step: steps.length + 1, description, status: 'proposed' });
    }
    return steps;
}

/** Bullet/YAML-список: «- …» → шаги (GigaChat <propose_plan> prose). */
function parseBulletListSteps(text = '') {
    const steps = [];
    for (const m of String(text).matchAll(/^\s*-\s+(.+)$/gim)) {
        const description = m[1].replace(/\*\*/g, '').trim();
        if (!description || /^(steps|intro)\s*:/i.test(description))
            continue;
        steps.push({ step: steps.length + 1, description, status: 'proposed' });
    }
    return steps;
}

/**
 * Тело <plan>/<propose_plan>: JSON, нумерованный список, bullet YAML.
 * @returns {{ steps: Array, intro: string }}
 */
function parsePlanBodySteps(body = '') {
    const raw = String(body || '').trim();
    let intro = '';
    const introM = raw.match(/^\s*intro\s*:\s*(.+)$/im);
    if (introM)
        intro = introM[1].trim();

    if (raw.startsWith('[')) {
        try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length) {
                const steps = arr.map((s, i) => ({
                    step: Number(s?.step) > 0 ? Number(s.step) : i + 1,
                    description: stepDescriptionOf(s),
                    status: 'proposed',
                })).filter(s => s.description);
                if (steps.length)
                    return { steps, intro };
            }
        }
        catch { /* fall through */ }
    }
    if (raw.startsWith('{')) {
        try {
            const obj = JSON.parse(raw);
            const steps = (Array.isArray(obj.steps) ? obj.steps : [obj])
                .map((s, i) => ({
                    step: Number(s?.step) > 0 ? Number(s.step) : i + 1,
                    description: stepDescriptionOf(s),
                    status: 'proposed',
                }))
                .filter(s => s.description);
            if (steps.length) {
                return {
                    steps,
                    intro: intro || String(obj.intro || obj.content || '').trim(),
                };
            }
        }
        catch { /* fall through */ }
    }

    const numbered = parseNumberedListSteps(raw);
    if (numbered.length)
        return { steps: numbered, intro };

    const bullets = parseBulletListSteps(raw);
    if (bullets.length)
        return { steps: bullets, intro };

    return { steps: [], intro };
}

/**
 * Вырезать <tag>…</tag> (или unclosed) и собрать pendingPlan / planRejected.
 * @returns {{ pendingPlan: object|null, planRejected: boolean, remaining: string, before: string }}
 */
function consumePlanXmlTag(text, tagName) {
    const openRe = new RegExp('<' + tagName + '\\b', 'i');
    if (!openRe.test(text))
        return { pendingPlan: null, planRejected: false, remaining: text, before: '' };

    // JSON-массив сразу после тега: <plan>[…]</plan>
    const arrExtract = extractBalancedJsonArray(
        text,
        '<' + tagName + '>',
        '</' + tagName + '>',
    );
    if (arrExtract) {
        try {
            const arr = JSON.parse(arrExtract.raw);
            if (Array.isArray(arr)) {
                const { steps, intro } = parsePlanBodySteps(arrExtract.raw);
                if (steps.length) {
                    return {
                        pendingPlan: {
                            steps,
                            label: 'План',
                            content: intro || steps.map(s => s.description).join('; '),
                        },
                        planRejected: false,
                        remaining: text.slice(0, arrExtract.index) + text.slice(arrExtract.end),
                        before: text.slice(0, arrExtract.index).trim(),
                    };
                }
            }
        }
        catch { /* fall through */ }
    }

    const rawMatch = text.match(
        new RegExp('<' + tagName + '\\b[^>]*>([\\s\\S]*?)(?:</' + tagName + '>|$)', 'i'),
    );
    if (!rawMatch) {
        return {
            pendingPlan: null,
            planRejected: true,
            remaining: text.replace(new RegExp('<' + tagName + '\\b[\\s\\S]*$', 'i'), ''),
            before: '',
        };
    }
    const { steps, intro } = parsePlanBodySteps(rawMatch[1]);
    if (steps.length) {
        return {
            pendingPlan: {
                steps,
                label: 'План',
                content: intro || steps.map(s => s.description).join('; '),
            },
            planRejected: false,
            remaining: text.slice(0, rawMatch.index)
                + text.slice(rawMatch.index + rawMatch[0].length),
            before: text.slice(0, rawMatch.index).trim(),
        };
    }
    return {
        pendingPlan: null,
        planRejected: true,
        remaining: text.slice(0, rawMatch.index)
            + text.slice(rawMatch.index + rawMatch[0].length),
        before: text.slice(0, rawMatch.index).trim(),
    };
}

/**
 * JSON-массив между тегами: скобки с учётом строк (не non-greedy до первого ]).
 * @returns {{ raw: string, index: number, end: number } | null}
 */
function extractBalancedJsonArray(text, openTag = '<plan>', closeTag = '</plan>', opts = {}) {
    if (!text) return null;
    const allowMissingClose = !!opts.allowMissingClose;
    const openIdx = text.indexOf(openTag);
    if (openIdx < 0) return null;
    let i = openIdx + openTag.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '[') return null;
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"')
                inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '[')
            depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) {
                const closeIdx = text.indexOf(closeTag, i + 1);
                if (closeIdx < 0) {
                    if (!allowMissingClose)
                        return null;
                    return {
                        raw: text.slice(start, i + 1),
                        index: openIdx,
                        end: i + 1,
                    };
                }
                return {
                    raw: text.slice(start, i + 1),
                    index: openIdx,
                    end: closeIdx + closeTag.length,
                };
            }
        }
    }
    return null;
}

/** Нормализация поля формы (метамодель) */
function normalizeFieldMeta(q) {
    if (!q || typeof q !== 'object') return q;
    const field = {
        id: q.id || q.name || String(Math.random()).slice(2, 8),
        label: q.label || q.id || '',
        type: q.type || 'text',
    };
    if (Array.isArray(q.options)) {
        field.options = q.options.map(opt => {
            if (typeof opt === 'string') return opt;
            if (opt && typeof opt === 'object') return opt.label || opt.text || opt.value || String(opt);
            return String(opt);
        });
    }
    if (field.type === 'checkbox')
        field.value = q.value !== undefined && q.value !== null ? !!q.value : false;
    else if (q.value !== undefined && q.value !== null)
        field.value = q.value;
    else
        field.value = '';
    return field;
}

/** Boilerplate prose/title опросника — не показывать */
function stripBoilerplateContent(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    if (/^(уточнение|уточните параметры|заполните поля|уточните данные)\.?$/i.test(t))
        return '';
    if (/^сформулирую [^\n]{0,80}[:.]?$/i.test(t))
        return '';
    return t;
}

/**
 * Короткая проза-обвязка рядом с опросом/формой — в content интерактива,
 * не отдельным text-блоком: два блока на один ход шумят в UI,
 * а text перед questions ломает представление «один ход — одно действие».
 */
function foldProseIntoInteractive(blocks = []) {
    const q = blocks.find(b => b.type === 'questions' || b.type === 'form');
    if (!q)
        return blocks;
    const isWrapper = b => b.type === 'text'
        && String(b.content || '').trim().length < 200
        && !/\n\s*(?:[-*•]|\d+[.)])/.test(String(b.content || ''));
    const texts = blocks.filter(isWrapper);
    if (!texts.length)
        return blocks;
    if (!q.content) {
        q.content = stripBoilerplateContent(
            texts.map(t => String(t.content || '').trim()).join('\n\n'));
    }
    return blocks.filter(b => !texts.includes(b));
}

/**
 * Cursor AskQuestion item → field meta.
 * Options даёт только модель: без ≥2 вариантов поле становится открытым
 * (text/textarea), система не фабрикует «Вариант A/B/Другое» и доменные пресеты.
 */
function mapAskQuestionToField(q) {
    if (!q || typeof q !== 'object') return null;
    // Вопрос без формулировки и без id — пустой сигнал, не поле
    const rawLabel = String(q.prompt || q.label || q.question || '').trim();
    const id = q.id || q.name || String(Math.random()).slice(2, 8);
    const label = rawLabel || String(q.id || q.name || '').trim();
    if (!label)
        return null;
    let options = Array.isArray(q.options) ? q.options : undefined;
    if (options) {
        options = options.map(opt => {
            if (typeof opt === 'string') return opt;
            if (opt && typeof opt === 'object') return opt.label || opt.text || opt.value || String(opt);
            return String(opt);
        }).filter(Boolean);
    }
    if (!options || options.length < 2) {
        const wantedType = String(q.type || '').toLowerCase();
        return { id, label, type: wantedType === 'textarea' ? 'textarea' : 'text' };
    }
    return { id, label, type: 'select', options };
}

/** Поле пригодно для AskQuestion UI: select с ≥2 опциями или открытое textarea/text */
function isAskQuestionField(f) {
    if (!f) return false;
    if (f.type === 'textarea' || f.type === 'text')
        return true;
    return f.type === 'select' && Array.isArray(f.options) && f.options.length >= 2;
}

/** Tool ask_user.args → блок type questions; без вопросов → null (обучающий отказ у вызывающего). */
function questionsFromAskUser(args = {}, sender = 'WORK') {
    let fields = [];
    if (Array.isArray(args.questions) && args.questions.length)
        fields = args.questions.map(mapAskQuestionToField).filter(Boolean);
    else if (Array.isArray(args.fields) && args.fields.length)
        fields = args.fields.map(mapAskQuestionToField).filter(Boolean);
    fields = fields.filter(isAskQuestionField);
    if (!fields.length)
        return null;
    const btn = String(args.label || args.button || 'Уточнить').trim() || 'Уточнить';
    return {
        type: 'questions',
        title: stripBoilerplateContent(args.title),
        content: stripBoilerplateContent(args.content),
        fields: fields.map(normalizeFieldMeta),
        button: { label: btn, color: 'success' },
        time: Date.now(),
        sender,
    };
}

/** Текст — только мусор канала ask_user (теги + имя / сломанный ask_user{…}). */
/** Префикс-мусор перед именем tool («подагент=ask_user…») — срезать перед детектом. */
function stripToolCallPrefix(text) {
    return String(text || '').trim().replace(/^[\wа-яё.-]+\s*=\s*/i, '');
}

/** Несбалансированные {}/() — сломанная попытка вызова, парсер её не возьмёт. */
function hasUnbalancedBrackets(text) {
    let depth = 0;
    for (const ch of String(text || '')) {
        if (ch === '{' || ch === '(') depth++;
        else if (ch === '}' || ch === ')') depth--;
    }
    return depth !== 0;
}

function isBareAskUserText(content) {
    const t = stripToolCallPrefix(content);
    if (!t) return false;
    if (/^(?:<\/?tool\b[^>]*>\s*)*ask_user\s*(?:<\/?tool\b[^>]*>\s*)*$/i.test(t))
        return true;
    if (/^ask_user\s*[\({]/i.test(t))
        return true;
    return /\bask_user\s*[\({]/i.test(t) && hasUnbalancedBrackets(t);
}

/**
 * Text-блок — голый tool-огрызок: имя известного канала без аргументов
 * либо сломанная ask_user-форма. Такой text всегда мусор — ни в одном пути
 * не полезен, а осев в ленте, становится wait-состоянием и глушит ретрай.
 */
function isBareToolProseText(content) {
    const t = stripToolCallPrefix(content);
    if (!t)
        return false;
    if (/^(?:ask_user|propose_plan|subplan|complete_step|save_file|report|search)\s*$/i.test(t))
        return true;
    // Огрызок prose-subplan («{subplan}[…», «subplan[…») — если parseSubplanTextBlock
    // не поднял его в pendingSubplan (битый JSON), в ленте он не нужен
    if (/^\{?\s*subplan\s*\}?\s*[\[{]/i.test(t))
        return true;
    // Неразобранный prose-вызов канала («propose_plan({…», «ask_user({…») —
    // не wait-text: иначе глушит ретрай после teach
    if (/^(?:ask_user|propose_plan|subplan|complete_step|save_file|report|search)\s*[\({]/i.test(t))
        return true;
    return isBareAskUserText(content);
}

/**
 * Ответ модели — попытка канала ask_user без валидного FC/args
 * («<tool>ask_user», голое ask_user, «подагент=ask_user{…», сломанный ask_user{…}).
 */
function isBareAskUserChannel(fullResponse, blocks = []) {
    const raw = stripToolCallPrefix(fullResponse);
    if (/<tool>\s*ask_user\b/i.test(raw))
        return true;
    if (/^ask_user\s*$/i.test(raw))
        return true;
    if (/^ask_user\s*[\({]/i.test(raw))
        return true;
    if (/\bask_user\s*[\({]/i.test(raw) && hasUnbalancedBrackets(raw))
        return true;
    return blocks.some(b => b.type === 'text' && isBareAskUserText(b.content));
}

/**
 * Нормализация prose tool-вызовов слабых моделей перед парсом.
 * GigaChat Light подставляет <|superquote|> вместо кавычек и отзеркаливает
 * маркер служебного промпта «[инструкция] …» строкой в начале ответа.
 */
function normalizeModelToolProse(text) {
    if (!text)
        return text;
    return String(text)
        .replace(/<\|superquote\|>/gi, '"')
        .replace(/^\s*\[инструкция\][^\n]*\n?/gim, '');
}

// ============================================================================
// Парсер tool-calls из текста (fallback без native FC)
// ============================================================================

function parseToolCalls(text, functions = []) {
    const calls = [];
    if (!text)
        return calls;

    // 1. Формат <tool_call>{"method":"...","args":{...}}</tool_call>
    const tagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            if (parsed?.method) {
                calls.push({
                    method: String(parsed.method),
                    args: parsed.args || {},
                });
            }
        }
        catch {}
    }

    // 2. Формат ```tool_call ... ```
    if (calls.length === 0) {
        const fenceRegex = /```tool_call\s*([\s\S]*?)\s*```/g;
        while ((match = fenceRegex.exec(text)) !== null) {
            try {
                const parsed = JSON.parse(match[1].trim());
                if (parsed?.method) {
                    calls.push({
                        method: String(parsed.method),
                        args: parsed.args || {},
                    });
                }
            }
            catch {}
        }
    }

    // 3. XML-теги — quote-aware (multiline post / вложенные " в HTML)
    if (calls.length === 0 && functions.length > 0) {
        const knownNames = new Set(functions.map(fn => fn.name));
        for (const name of knownNames) {
            if (!name || !/^\w+$/.test(name)) continue;
            const startRe = new RegExp('<' + name + '(?=\\s|/|>)', 'gi');
            let sm;
            while ((sm = startRe.exec(text)) !== null) {
                const parsed = parseXmlToolCallAt(text, sm.index, name);
                if (parsed && Object.keys(parsed.args).length > 0)
                    calls.push({ method: parsed.method, args: parsed.args });
            }
        }
    }

    // 4. Prose: <function calling>save_file({…})</function calling>
    if (calls.length === 0) {
        const wrapRe = /<function(?:\s+|_)calling>\s*(\w+)\s*\(/gi;
        let wm;
        while ((wm = wrapRe.exec(text)) !== null) {
            const method = wm[1];
            const rel = wm[0].lastIndexOf(method);
            if (rel < 0)
                continue;
            const parsed = parseJsStyleToolCallAt(text, wm.index + rel, method);
            if (parsed)
                calls.push({ method: parsed.method, args: parsed.args });
        }
    }

    // 5. Голый save_file({…}) / ask_user{…} для известных tools (если ещё пусто)
    if (calls.length === 0 && functions.length > 0) {
        const knownNames = new Set(functions.map(fn => fn.name));
        for (const name of knownNames) {
            if (!name || !/^\w+$/.test(name)) continue;
            const startRe = new RegExp('\\b' + name + '\\s*[\\({]', 'g');
            let sm;
            while ((sm = startRe.exec(text)) !== null) {
                if (sm.index > 0 && text[sm.index - 1] === '<')
                    continue;
                const parsed = parseJsStyleToolCallAt(text, sm.index, name);
                if (parsed)
                    calls.push({ method: parsed.method, args: parsed.args });
            }
        }
    }

    return calls;
}

/**
 * Разобрать JS-object literal args: {filename:"a.html", post:"…", steps:[{…}]}
 * (ключи без кавычек, массивы и вложенные объекты).
 * @returns {object|null}
 */
function parseJsObjectLiteral(src) {
    const s = String(src ?? '').trim();
    if (!s.startsWith('{') || !s.endsWith('}'))
        return null;
    try {
        const asJson = JSON.parse(s);
        if (asJson && typeof asJson === 'object' && !Array.isArray(asJson))
            return asJson;
    }
    catch { /* JS-style keys */ }
    const out = {};
    let i = 1;
    while (i < s.length - 1) {
        while (i < s.length && /[\s,]/.test(s[i])) i++;
        if (i >= s.length - 1 || s[i] === '}')
            break;
        let key = '';
        if (s[i] === '"' || s[i] === "'") {
            const q = s[i++];
            let esc = false;
            while (i < s.length) {
                const c = s[i++];
                if (esc) { key += c; esc = false; continue; }
                if (c === '\\') { esc = true; continue; }
                if (c === q) break;
                key += c;
            }
            while (i < s.length && /\s/.test(s[i])) i++;
            if (s[i] !== ':')
                return null;
            i++;
        }
        else {
            const m = s.slice(i).match(/^([A-Za-z_]\w*)\s*:/);
            if (!m)
                return null;
            key = m[1];
            i += m[0].length;
        }
        while (i < s.length && /\s/.test(s[i])) i++;
        if (i >= s.length)
            return null;
        const val = parseJsLiteralValue(s, i);
        if (!val)
            return null;
        out[key] = val.value;
        i = val.end;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Один JS-literal value начиная с позиции i: строка / число / bool / null / {…} / […].
 * @returns {{ value: *, end: number }|null}
 */
function parseJsLiteralValue(s, i) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length)
        return null;
    if (s[i] === '"' || s[i] === "'") {
        const q = s[i++];
        let val = '';
        let esc = false;
        while (i < s.length) {
            const c = s[i++];
            if (esc) { val += c; esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === q) break;
            val += c;
        }
        return { value: val, end: i };
    }
    if (s[i] === '{') {
        const nested = extractBalancedObject(s, i);
        if (!nested)
            return null;
        const nestedObj = parseJsObjectLiteral(nested.literal);
        if (!nestedObj)
            return null;
        return { value: nestedObj, end: nested.end };
    }
    if (s[i] === '[') {
        const nested = extractBalancedArray(s, i);
        if (!nested)
            return null;
        const arr = parseJsArrayLiteral(nested.literal);
        if (!arr)
            return null;
        return { value: arr, end: nested.end };
    }
    const m = s.slice(i).match(/^(true|false|null|-?\d+(?:\.\d+)?)/);
    if (!m)
        return null;
    const raw = m[1];
    const value = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : Number(raw);
    return { value, end: i + raw.length };
}

/**
 * Разобрать JS-array literal: [{description:"…"}, …] / ["a","b"] / вложенные массивы.
 * @returns {Array|null}
 */
function parseJsArrayLiteral(src) {
    const s = String(src ?? '').trim();
    if (!s.startsWith('[') || !s.endsWith(']'))
        return null;
    try {
        const asJson = JSON.parse(s);
        if (Array.isArray(asJson))
            return asJson;
    }
    catch { /* JS-style */ }
    const out = [];
    let i = 1;
    while (i < s.length - 1) {
        while (i < s.length && /[\s,]/.test(s[i])) i++;
        if (i >= s.length - 1 || s[i] === ']')
            break;
        const val = parseJsLiteralValue(s, i);
        if (!val)
            return null;
        out.push(val.value);
        i = val.end;
    }
    return out;
}

/**
 * Вырезать `{…}` с учётом строк и вложенности, начиная с индекса `{`.
 * @returns {{ literal: string, end: number }|null} end — индекс после `}`
 */
function extractBalancedObject(text, startIdx) {
    return extractBalancedBrackets(text, startIdx, '{', '}');
}

/**
 * Вырезать `[…]` с учётом строк и вложенности, начиная с индекса `[`.
 * @returns {{ literal: string, end: number }|null}
 */
function extractBalancedArray(text, startIdx) {
    return extractBalancedBrackets(text, startIdx, '[', ']');
}

/** Общий балансер скобок { } или [ ] с учётом строк. */
function extractBalancedBrackets(text, startIdx, openCh, closeCh) {
    if (!text || text[startIdx] !== openCh)
        return null;
    let depth = 0;
    let inStr = false;
    let quote = '';
    let escape = false;
    for (let i = startIdx; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (escape) { escape = false; continue; }
            if (c === '\\') { escape = true; continue; }
            if (c === quote) inStr = false;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = true;
            quote = c;
            continue;
        }
        if (c === openCh)
            depth++;
        else if (c === closeCh) {
            depth--;
            if (depth === 0)
                return { literal: text.slice(startIdx, i + 1), end: i + 1 };
        }
    }
    return null;
}

/** Найти call `name({…})` или `name{…}` начиная с индекса имени; вернуть { method, args, end }. */
function parseJsStyleToolCallAt(text, nameStart, method) {
    if (!text || nameStart < 0 || !method)
        return null;
    let i = nameStart + method.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    let needCloseParen = false;
    if (text[i] === '(') {
        needCloseParen = true;
        i++;
        while (i < text.length && /\s/.test(text[i])) i++;
    }
    if (text[i] !== '{')
        return null;
    const bal = extractBalancedObject(text, i);
    if (!bal)
        return null;
    i = bal.end;
    if (needCloseParen) {
        while (i < text.length && /\s/.test(text[i])) i++;
        if (text[i] !== ')')
            return null;
        i++;
    }
    const args = parseJsObjectLiteral(bal.literal);
    if (!args || !Object.keys(args).length)
        return null;
    return { method, args, end: i };
}

/** Убрать голые tool-вызовы name({…}) / name{…} из prose ленты. */
function stripJsStyleToolProse(text) {
    if (!text)
        return text;
    const names = ['save_file', 'write_file', 'create', 'ask_user', 'navigate', 'read_file',
        'reset_context', 'propose_plan', 'subplan', 'complete_step', 'report'];
    let out = String(text);
    for (const name of names) {
        const re = new RegExp('\\b' + name + '\\s*[\\({]', 'g');
        const ranges = [];
        let sm;
        while ((sm = re.exec(out)) !== null) {
            if (sm.index > 0 && out[sm.index - 1] === '<')
                continue;
            const parsed = parseJsStyleToolCallAt(out, sm.index, name);
            if (parsed)
                ranges.push([sm.index, parsed.end]);
        }
        for (let r = ranges.length - 1; r >= 0; r--) {
            const [a, b] = ranges[r];
            out = out.slice(0, a) + out.slice(b);
        }
    }
    return out;
}

/** Вырезать нераспарсенные action-JSON ({"title","label","color"}) из prose. */
function stripRawActionJsonFromProse(text) {
    if (!text)
        return text;
    let out = String(text);
    const re = /\{[^{}]*"(?:title|label|color)"[^{}]*\}/g;
    out = out.replace(re, (m) => {
        try {
            const o = JSON.parse(m);
            if (o && typeof o === 'object'
                && ('title' in o || 'label' in o)
                && ('label' in o || 'color' in o || 'title' in o))
                return '';
        }
        catch {}
        return m;
    });
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Конец значения attr: next attr / self-close / простой `>` (без HTML внутри value).
 */
function isXmlAttrValueEnd(after, valueSoFar) {
    if (/^\s+\w+=/.test(after)) return true;
    if (/^\s*\/>/.test(after)) return true;
    if (/^\s*>/.test(after) && !String(valueSoFar).includes('<')) return true;
    return false;
}

/**
 * Разобрать XML tool-call начиная с индекса `<tagName`.
 * Поддерживает multiline attrs и вложенные кавычки в HTML-значениях (post).
 * @returns {{ method: string, args: object, end: number }|null}
 */
function parseXmlToolCallAt(text, startIdx, tagName) {
    if (!text || startIdx < 0 || !tagName) return null;
    const prefix = '<' + tagName;
    if (text.slice(startIdx, startIdx + prefix.length).toLowerCase() !== prefix.toLowerCase())
        return null;
    let i = startIdx + prefix.length;
    const args = {};
    while (i < text.length) {
        while (i < text.length && /\s/.test(text[i])) i++;
        if (i >= text.length) return null;
        if (text[i] === '/' && text[i + 1] === '>')
            return { method: tagName, args, end: i + 2 };
        if (text[i] === '>')
            return { method: tagName, args, end: i + 1 };
        const nameMatch = text.slice(i).match(/^(\w+)=/);
        if (!nameMatch) return null;
        const attrName = nameMatch[1];
        i += nameMatch[0].length;
        const q = text[i];
        if (q !== '"' && q !== "'") return null;
        i++;
        let value = '';
        while (i < text.length) {
            if (text[i] === q) {
                const after = text.slice(i + 1);
                if (isXmlAttrValueEnd(after, value)) {
                    i++;
                    break;
                }
                value += text[i];
                i++;
            }
            else {
                value += text[i];
                i++;
            }
        }
        args[attrName] = value;
    }
    return null;
}

/** Парсинг attrs из строки (unit-тесты / отладка). */
function parseXmlTagAttrs(attrsStr) {
    const fake = '<' + '_x' + ' ' + (attrsStr || '') + ' />';
    const parsed = parseXmlToolCallAt(fake, 0, '_x');
    return parsed?.args || {};
}

// Именованные экспорты для юнит-тестов
// (tests/prompt-pipeline.test.js, tests/fc-args.test.js, tests/role-acl.test.js)
export {
    hoistWaitBlock,
    collectAnsweredInteractive,
    findAnsweredDuplicate,
    subplanGateError,
    applySubplan,
    findActiveTask,
    activeTaskChain,
    advanceTask,
    normalizeModelToolProse,
    foldProseIntoInteractive,
    stripBoilerplateContent,
    isBareAskUserText,
    isBareAskUserChannel,
    isBareToolProseText,
    parseJsonStepsArray,
    parseResponseToRibbon,
    consumeBraceSubplan,
    parseSubplanTextBlock,
    parseProposePlanTextBlock,
    parseJsObjectLiteral,
    parseJsStyleToolCallAt,
    isBrokenFcArgs,
    sanitizeToolArgsForHistory,
    stripFcTrailer,
    formatToolResultMessages,
    ensureNamedFunction,
    collectFunctionNamesFromMessages,
    prepareFunctionsForStream,
    normalizeRole,
    formatRoleAclForSystem,
    isSystemModifyCall,
    roleBlocksTool,
};

