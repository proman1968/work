/**
 * prompt для task.ai — TYPE-driven пайплайн.
 *
 * 1. execute(prompt | answers | confirm | stop)
 * 2. servicePrompt текущего TYPE (из $ai/TYPES)
 * 3. сборка контекста + ribbon → messages
 * 4. запрос ИИ
 * 5. ответ → блок(и) TYPE; если не ждём пользователя — снова ход с servicePrompt блока
 *
 * Хелперы (парсер, tools, history) — sources/modules/ai-prompt/legacy.js
 * (не рядом с $method: rules §1.11; import только через pathToFileURL).
 */
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const L = await import(
    pathToFileURL(path.join(ROOT, 'sources/modules/ai-prompt/legacy.js')).href
);

/** Типы, после которых ждём пользователя (tip / новый prompt). */
const WAIT_USER_TYPES = new Set(['text', 'action', 'form', 'questions']);

/** Макс. авто-ходов без пользователя за один HTTP-вызов. */
const MAX_AUTO_TURNS = 30;

function parseInput(params = {}, post) {
    let text = '';
    let requestModel = '';
    let confirm = undefined;
    let answers = undefined;
    let wantStop = false;
    const raw = post ?? params.text ?? params.post ?? '';
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(raw);
            text = String(parsed.text ?? '').trim();
            requestModel = String(parsed.model ?? '').trim();
            confirm = parsed.confirm;
            wantStop = parsed.stop === true;
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
    return { text, requestModel, confirm, answers, wantStop };
}

/** Последний блок ленты, задающий servicePrompt следующего хода. */
function driverEntry(ribbon = []) {
    for (let i = ribbon.length - 1; i >= 0; i--) {
        const b = ribbon[i];
        if (!b?.type || b.type === 'step' || b.type === 'ribbon' || b.type === 'details')
            continue;
        return b;
    }
    return { type: 'prompt' };
}

function ribbonTargetOf(body) {
    const lastTask = [...(body.ribbon || [])].reverse()
        .find(b => b.type === 'task' && b.state === 'active');
    return lastTask ? (lastTask.ribbon ??= []) : body.ribbon;
}

/** plan из парсера → action «План» (ждёт «Начать»). */
function planToAction(pendingPlan, sender) {
    const steps = pendingPlan?.steps || [];
    return {
        type: 'action',
        title: 'План',
        content: pendingPlan?.content
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

/**
 * Подтверждение «Начать» у action План → TYPE.task + step-prompt.
 */
function applyConfirm(body, confirm, sender) {
    if (confirm === undefined)
        return null;
    const ribbon = body.ribbon || [];
    const open = [...ribbon].reverse().find(b =>
        b.type === 'action' || b.type === 'form' || b.type === 'questions');
    if (!open)
        return null;

    if (confirm === false) {
        ribbon.push({
            type: 'text',
            content: 'Отменено.',
            time: Date.now(),
            sender,
        });
        delete body.pendingAction;
        return { type: 'text' };
    }

    if (open.type === 'action' && open.title === 'План' && open.steps?.length) {
        const task = {
            type: 'task',
            label: open.content || 'План',
            state: 'active',
            steps: open.steps.map(s => ({ ...s, status: s.status || 'proposed' })),
            ribbon: [],
            time: Date.now(),
            sender: 'WORK',
        };
        const first = task.steps.find(s => s.status === 'proposed') || task.steps[0];
        if (first)
            first.status = 'in_progress';
        ribbon.push(task);
        const stepPrompt = {
            type: 'prompt',
            content: `Выполни шаг ${first.step}: ${first.description}`,
            time: Date.now(),
            sender: 'WORK',
            step: first.step,
        };
        task.ribbon.push(stepPrompt);
        delete body.pendingAction;
        return stepPrompt;
    }

    delete body.pendingAction;
    return open;
}

function applyAnswers(body, answers, sender) {
    const ribbon = ribbonTargetOf(body);
    const open = [...ribbon].reverse().find(b => b.type === 'form' || b.type === 'questions');
    if (!open)
        return null;
    const content = L.formatPromptWithAnswers(open.button?.label || 'Ответ', answers, open.fields);
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

async function streamModel(model, execItemMethod, messages, functions, wsPath, fullPath) {
    let fullResponse = '';
    const nativeToolCalls = [];
    let turnUsage = null;
    const streamParams = { messages, $ai: model };
    let fns = functions;
    if (fns?.length) {
        L.ensureHarnessFunctions(fns);
        const prepared = L.prepareFunctionsForStream(fns, messages, 'auto');
        streamParams.functions = prepared.functions;
        streamParams.function_call = prepared.function_call;
        fns = prepared.functions;
    }
    const stream = await execItemMethod(model, 'streamChat', streamParams);
    for await (const chunk of stream) {
        if (L.isAborted(fullPath))
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

export default {
    /**
     * @param {object} params
     * @param {string} [params.text]
     * @param {boolean} [params.stop]
     * @param {object} [params.$context] task.ai файл
     * @param {string|object} [post] JSON { text, model, confirm, answers, stop } | строка
     */
    async execute(params = {}, post) {
        const taskAi = params.$context || this;
        if (!taskAi?.load)
            throw new Error('task.ai не найден в контексте');

        const { text, requestModel, confirm, answers, wantStop } = parseInput(params, post);
        const fullPath = taskAi.path?.startsWith('/') ? taskAi.path : '/' + (taskAi.path || taskAi.short);
        const wsPath = taskAi.short || fullPath;

        if (wantStop) {
            L.requestAbort(fullPath);
            return { ok: true, stopped: true };
        }
        L.clearAbort(fullPath);

        const body = await L.loadTaskBody(taskAi);
        if (!body)
            throw new Error('Не удалось загрузить тело task.ai');
        body.ribbon ??= [];

        for (const m of body.ribbon) {
            if (m.role === 'user' && !m.type) {
                m.type = 'prompt';
                delete m.role;
            }
        }

        const initialContext = taskAi.$class || taskAi.$parent;
        if (!initialContext)
            throw new Error('Не определено классе-контекст для task.ai');

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
            await L.writeTaskBody(fullPath, body);
            L.notifyChanged(fullPath);
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
        let currentContext = initialContext;
        const role = L.normalizeRole(params.role || params.user?.role);
        body.role = role;

        if (answers) {
            applyAnswers(body, answers, sender);
        }
        else if (confirm !== undefined) {
            applyConfirm(body, confirm, sender);
        }
        else if (text) {
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

        await L.writeTaskBody(fullPath, body);
        L.notifyChanged(fullPath);

        let turns = 0;
        while (turns < MAX_AUTO_TURNS) {
            if (L.isAborted(fullPath))
                return await L.finishStopped(fullPath, wsPath, body);
            turns++;

            const ribbon = ribbonTargetOf(body);
            const driver = driverEntry(ribbon);
            const svc = L.resolveServicePrompt(driver);

            const messages = L.buildHistoryFromRibbon(body, model.functionCalling === true, {
                protocol: model.protocol,
            });
            if (svc) {
                const tag = '[инструкция] ' + svc;
                const lastMsg = messages[messages.length - 1];
                if (!(lastMsg?.role === 'user' && lastMsg.content === tag))
                    messages.push({ role: 'user', content: tag });
            }

            let functions = await L.buildFunctionsList(currentContext);
            L.ensureHarnessFunctions(functions);

            WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });

            let fullResponse = '';
            let nativeToolCalls = [];
            let turnUsage = null;
            try {
                const streamed = await streamModel(
                    model, execItemMethod, messages, functions, wsPath, fullPath,
                );
                fullResponse = streamed.fullResponse;
                nativeToolCalls = streamed.nativeToolCalls;
                turnUsage = streamed.turnUsage;
                functions = streamed.functions || functions;
            }
            catch (e) {
                console.warn('[task.ai] streamChat:', e.message);
                ribbon.push({
                    type: 'error',
                    content: 'Ошибка: ' + e.message,
                    time: Date.now(),
                    sender: model.path || 'WORK',
                });
                await L.writeTaskBody(fullPath, body);
                L.notifyChanged(fullPath);
                WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: e.message });
                return { ok: false, error: e.message };
            }

            if (L.isAborted(fullPath))
                return await L.finishStopped(fullPath, wsPath, body);

            const usage = L.resolveTurnUsage(turnUsage, L.estimateMessagesTokens(messages), fullResponse);
            L.applyTurnUsage(body, usage);

            let toolCalls = nativeToolCalls.length
                ? nativeToolCalls
                : L.parseToolCalls(fullResponse);

            toolCalls = toolCalls.filter(call => {
                const err = L.roleBlocksTool(role, call);
                if (err) {
                    ribbon.push({
                        type: 'tool_result',
                        tool: call.method,
                        ok: false,
                        content: err,
                        time: Date.now(),
                        sender: 'WORK',
                    });
                    return false;
                }
                return true;
            });

            const needsConfirm = toolCalls.filter(c => L.callNeedsTrustConfirm(c));
            if (needsConfirm.length && !(params.trustLevel >= 3)) {
                body.pendingAction = {
                    calls: needsConfirm,
                    contextPath: currentContext.path,
                };
                ribbon.push({
                    type: 'action',
                    title: 'Действие',
                    content: 'Подтвердите: ' + needsConfirm.map(c => c.method).join(', '),
                    button: { label: 'Выполнить', color: 'warning' },
                    time: Date.now(),
                    sender: 'WORK',
                });
                await L.writeTaskBody(fullPath, body);
                L.notifyChanged(fullPath);
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, pendingConfirm: true };
            }

            const parsed = L.parseResponseToRibbon(fullResponse, model.path || 'WORK');
            let blocks = parsed.blocks || [];

            if (parsed.pendingPlan?.steps?.length) {
                blocks = blocks.filter(b => b.type === 'thinking');
                blocks.push(planToAction(parsed.pendingPlan, model.path || 'WORK'));
            }

            for (const b of blocks)
                ribbon.push(b);

            if (toolCalls.length) {
                for (const call of toolCalls) {
                    ribbon.push({
                        type: 'tool',
                        name: call.method,
                        args: call.args,
                        time: Date.now(),
                        sender: model.path || 'WORK',
                    });
                    const { result, newContext } = await L.executeToolCall(
                        call, currentContext, initialContext, functions, params, aiUser,
                    );
                    if (newContext)
                        currentContext = newContext;
                    L.pushToolResult(ribbon, call, result, model.path || 'WORK');
                }
            }

            await L.writeTaskBody(fullPath, body);
            L.notifyChanged(fullPath);

            const last = driverEntry(ribbon);
            if (WAIT_USER_TYPES.has(last.type)) {
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, wait: last.type, turns };
            }

            WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });
        }

        WORK.wsSend?.({ type: 'chat.done', path: wsPath });
        return { ok: true, maxAutoTurns: true, turns };
    },
};

/** Реэкспорт хелперов для тестов (канон — sources/modules/ai-prompt). */
export const {
    requestAbort,
    clearAbort,
    isAborted,
    resolveServicePrompt,
    buildHistoryFromRibbon,
    parseResponseToRibbon,
    parseToolCalls,
    executeToolCall,
    pushToolResult,
    callNeedsTrustConfirm,
    roleBlocksTool,
    normalizeRole,
    formatPromptWithAnswers,
    applyTurnUsage,
    resolveTurnUsage,
    estimateMessagesTokens,
    normalizeStepStatus,
    normalizeProposedSteps,
    ensureMinimumPlanSteps,
    extractBalancedJsonArray,
    planLooksLikeArtifactWork,
    normalizePlanSteps,
    prepareStepsForStart,
    shouldContinueDo,
    normalizeFieldMeta,
    nextIdleDoAction,
    getDoStepPhase,
    stepNeedsClarify,
    artifactFilenameFromStep,
    stepNeedsForcedSaveFile,
    resolveFunctionCallMode,
    taskHasClarifyAnswers,
    makeClarifyQuestions,
    questionsFromAskUser,
    defaultOptionsForAskField,
    mapAskQuestionToField,
    ensureHarnessFunctions,
    ensureNamedFunction,
    collectFunctionNamesFromMessages,
    prepareFunctionsForStream,
    advanceAfterClarifyAnswers,
    advanceAfterSuccessfulSave,
    countDoneSteps,
    applyHarnessDoneCap,
    stepIsAcceptOnly,
    finalizeAcceptOnlySteps,
    pushStepAnnounce,
    expandStepWithSubplan,
    workPathFromHistoryPath,
    getFillCountFromTask,
    isStubWriteContent,
    lastSuccessfulWriteWasStub,
    ensureFillSubplan,
    allContentWorkDone,
    currentStepDescription,
    formatToolResultMessages,
    formatPlanMarkdown,
    keepDoAction,
    keepDoInteractive,
    normalizeActionBlocks,
    normalizeInteractiveBlocks,
    dropTextBlocksBesidePlanAction,
    dropTextBlocksBesideDoInteractive,
    isInteractiveBlock,
    findOpenAction,
    pushStepPrompt,
    formatStepPromptContent,
    buildToolMethodParams,
    formatLogSummary,
    formatPairContextForSystem,
    normalizeLogWindow,
    formatRoleAclForSystem,
    isSystemModifyCall,
    summarizeToolResultForRibbon,
    compactToolResultContentForHistory,
    commitDurableBlocks,
    commitIdleContent,
    taskHasSuccessfulSave,
    stripFcTrailer,
    isBrokenFcArgs,
    sanitizeToolArgsForHistory,
    stripRawActionJsonFromProse,
    makeIdleExecuteResumeAction,
    appendDoForceNudge,
    appendPlanForceNudge,
    synthesizePlanAfterIdle,
    looksLikeDeliverableRequest,
    parseJsObjectLiteral,
    parseJsStyleToolCallAt,
    parseXmlToolCallAt,
    parseXmlTagAttrs,
    estimateTokens,
    MAX_IDLE_DO,
    MAX_IDLE_PROPOSE,
    ASK_USER_METHOD,
    TRUST_AUTOCONFIRM,
    CONTEXT_LOG_DAYS,
    CONTEXT_LOG_MAX_ROWS,
} = L;
