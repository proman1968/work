/**
 * Серверный метод prompt для task.ai — контекстный harness цикл tool-call.
 * this = task.ai файл (передаётся через tryHandlerMethod → execute.call(item))
 *
 * Поддерживает нативный function calling:
 * - Схема методов контекста → functions (OpenAI-compatible)
 * - streamChat с functions → yield {type:'content'} / {type:'function_call'}
 * - Fallback: текстовый парсинг <tool_call> для моделей без function calling
 *
 * Подтверждение опасных действий / планов:
 * - При trustLevel < TRUST_AUTOCONFIRM опасные методы не выполняются сразу
 * - Вызовы сохраняются в блоке type:'action' (calls/contextPath), клиент видит кнопку
 * - При подтверждении ({confirm:true}) — вызовы выполняются, цикл продолжается
 * - При отказе ({confirm:false}) — tool_result "отменено", цикл продолжается
 * - План: action (title/content MD/action/color) → confirm создаёт task { title, plan, ribbon }
 * - plan только у task; из action.content парсятся нумерованные шаги при confirm
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as https from 'node:https';

const ROOT = process.cwd();
const MAX_ITERATIONS = 10;
// Опасные методы — требуют подтверждения через action при trustLevel < 3
const DANGEROUS_METHODS = ['write_file', 'set_property', 'save_file', 'delete', 'create'];
// Уровень доверия для автоподтверждения опасных действий
const TRUST_AUTOCONFIRM = 3;

export default {
    async execute(params = {}, post) {
        const taskAi = params.$context || this;
        if (!taskAi || !taskAi.load)
            throw new Error('task.ai не найден в контексте');

        // === 1. Парсинг входных данных ===
        let text = '';
        let requestModel = '';
        let confirm = undefined;
        const raw = post ?? params.text ?? params.post ?? '';
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                text = String(parsed.text ?? '').trim();
                requestModel = String(parsed.model ?? '').trim();
                confirm = parsed.confirm;
            } catch {
                text = String(raw).trim();
            }
        } else {
            text = String(raw).trim();
        }

        // === 2. Загрузка тела task.ai ===
        const body = await loadTaskBody(taskAi);
        if (!body)
            throw new Error('Не удалось загрузить тело task.ai');

        // === 3. Базовые пути и контекст ===
        const fullPath = taskAi.path?.startsWith('/') ? taskAi.path : '/' + (taskAi.path || taskAi.short);
        const wsPath = taskAi.short || fullPath;
        const initialContext = taskAi.$class || taskAi.$parent;
        if (!initialContext)
            throw new Error('Не определено классе-контекст для task.ai');

        body.ribbon ??= [];
        // Сбросить устаревшее поле — подтверждения только через action-блоки
        delete body.pendingAction;

        // === 4. Загрузка модели ===
        if (requestModel)
            body.model = requestModel;

        const { findFirstModel } = await import(pathToFileURL(path.join(ROOT, 'sources/modules/ai-schema.js')).href);
        const modelPath = body.model || await findFirstModel();
        if (!modelPath) {
            body.ribbon.push({
                type: 'text',
                content: 'Нет доступной модели.',
                time: Date.now(),
                sender: 'WORK',
                error: true,
            });
            await writeTaskBody(fullPath, body);
            notifyChanged(fullPath);
            WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: 'Нет модели' });
            return { ok: true, model: false };
        }
        const model = await WORK.get_item(modelPath);
        if (!model) throw new Error('Модель не найдена: ' + modelPath);

        const { execItemMethod } = await import(pathToFileURL(path.join(ROOT, 'sources/host/http-server.js')).href);
        const maxIter = body.maxIterations || MAX_ITERATIONS;

        // Пользователь от лица модели — для логов действий ИИ
        const modelLabel = model.label || model.path?.split('/').pop() || 'AI';
        const aiUser = { uid: modelLabel, $user: params.user?.$user || params.user, isAI: true };
        const sender = params.user?.uid || params.user?.$user?.id || 'unknown';
        const modelSender = model.path || 'WORK';

        // ribbonTarget: последняя активная task или основная лента
        let ribbonTarget = resolveRibbonTarget(body);

        let currentContext = initialContext;

        // === 5. Обработка подтверждения: кнопка = prompt (text) + confirm ===
        // promptAlreadyAdded: text уже записан в task.ribbon / ribbonTarget — не дублировать в корень
        let promptAlreadyAdded = false;
        const pendingAction = findTrailingAction(body.ribbon);
        if (pendingAction && confirm !== undefined) {
            if (pendingAction.contextPath) {
                try {
                    const target = await WORK.get_item(pendingAction.contextPath);
                    if (target)
                        currentContext = target;
                } catch {}
            }

            const planFromContent = parsePlanFromContent(pendingAction.content);
            const isPlanStart = isPlanStartAction(pendingAction);
            const buttonText = String(text || (confirm ? (pendingAction.action || 'OK') : 'Отмена')).trim();

            if (isPlanStart && planFromContent.length) {
                if (confirm === true) {
                    const plan = planFromContent.map((s, i) => ({
                        ...s,
                        status: i === 0 ? 'in_progress' : (s.status || 'proposed'),
                    }));
                    body.ribbon.push({
                        type: 'task',
                        time: Date.now(),
                        sender,
                        title: pendingAction.title || 'Задача',
                        state: 'active',
                        plan,
                        ribbon: [],
                    });
                    ribbonTarget = body.ribbon[body.ribbon.length - 1].ribbon;
                    // Кнопка = prompt внутри task
                    ribbonTarget.push({ type: 'prompt', content: buttonText, time: Date.now(), sender });
                    promptAlreadyAdded = true;
                } else {
                    // Отмена плана — prompt в корне, task не создаём
                    body.ribbon.push({ type: 'prompt', content: buttonText || 'Отмена', time: Date.now(), sender });
                    promptAlreadyAdded = true;
                }
            } else if (pendingAction.calls?.length) {
                const functions = await buildFunctionsList(currentContext);
                ensureToolCallBlocks(ribbonTarget, pendingAction.calls, modelSender);
                if (confirm === true) {
                    for (const call of pendingAction.calls) {
                        const { result, newContext } = await executeToolCall(call, currentContext, initialContext, functions, params, aiUser);
                        currentContext = newContext;
                        pushToolResult(ribbonTarget, call, result, model);
                        sendToolResultWs(wsPath, call, result);
                    }
                } else {
                    for (const call of pendingAction.calls) {
                        ribbonTarget.push({
                            type: 'tool_result',
                            content: 'Действие отменено пользователем',
                            tool: call.method,
                            error: true,
                            time: Date.now(),
                            sender,
                        });
                    }
                }
                ribbonTarget.push({ type: 'prompt', content: buttonText, time: Date.now(), sender });
                promptAlreadyAdded = true;
            } else {
                // Простой action («Принять» и т.п.) — prompt в текущий target
                ribbonTarget.push({ type: 'prompt', content: buttonText, time: Date.now(), sender });
                promptAlreadyAdded = true;
            }

            pendingAction.resolved = true;
            delete pendingAction.calls;
            delete pendingAction.contextPath;
            delete pendingAction.plan; // legacy cleanup
            await writeTaskBody(fullPath, body);
            // Дальше всегда LLM-цикл: кнопка = prompt, модель должна ответить
        } else if (pendingAction && confirm === undefined && text) {
            pendingAction.resolved = true;
            delete pendingAction.calls;
            delete pendingAction.contextPath;
            delete pendingAction.plan;
        }

        // === 6. Проверка текста (только для обычного промпта) ===
        if (!text && confirm === undefined)
            throw new Error('Текст промпта пуст');

        // === 7. Добавление prompt + текстовое подтверждение плана ===
        if (text && !promptAlreadyAdded) {
            const lastUser = [...body.ribbon].reverse().find(b =>
                b.type === 'prompt' || b.role === 'user');
            const isDuplicate = lastUser && lastUser.content === text
                && (Date.now() - (lastUser.time || 0)) < 10000;
            if (!isDuplicate) {
                body.ribbon.push({ type: 'prompt', content: text, time: Date.now(), sender });
            }

            const planAction = findTrailingAction(body.ribbon);
            const planFromContent = planAction ? parsePlanFromContent(planAction.content) : [];
            if (planAction && isPlanStartAction(planAction) && planFromContent.length && !planAction.resolved) {
                const confirmWords = ['начать', 'да', 'продолжить', 'ок', 'подтвердить', 'принять'];
                if (confirmWords.some(w => text.toLowerCase().includes(w))) {
                    planAction.resolved = true;
                    delete planAction.plan;
                    const plan = planFromContent.map((s, i) => ({
                        ...s,
                        status: i === 0 ? 'in_progress' : (s.status || 'proposed'),
                    }));
                    // Перенести только что добавленный prompt в task.ribbon
                    const justPrompt = body.ribbon[body.ribbon.length - 1];
                    if (justPrompt?.type === 'prompt' && justPrompt.content === text)
                        body.ribbon.pop();
                    body.ribbon.push({
                        type: 'task',
                        time: Date.now(),
                        sender,
                        title: planAction.title || 'Задача',
                        state: 'active',
                        plan,
                        ribbon: [{ type: 'prompt', content: text, time: Date.now(), sender }],
                    });
                    ribbonTarget = body.ribbon[body.ribbon.length - 1].ribbon;
                }
            }
        }

        // === 8. Загрузка контекста, памяти, readme (transient — не персистятся) ===
        const memContent = await loadMemFiles(initialContext);
        const readmeContent = await loadReadme(initialContext);
        const contextInfo = await buildContextInfo(initialContext, params.user);
        const geoInfo = await getGeoByIp();
        const transient = {
            context: contextInfo + (geoInfo || ''),
            mem: memContent,
            readme: readmeContent,
        };

        // === 9. Основной цикл tool-call ===
        let iteration = 0;
        let lastResponse = '';

        while (iteration < maxIter) {
            iteration++;
            const messages = buildHistoryFromRibbon({ ...body, ...transient }, model.functionCalling === true);

            // Построение functions из схемы методов контекста
            let functions = await buildFunctionsList(currentContext);

            let fullResponse = '';
            let toolCalls = [];

            {
                let nativeToolCalls = [];
                let hasNativeFunctionCall = false;

                try {
                    const streamParams = { messages, $ai: model };
                    if (functions.length > 0) {
                        streamParams.functions = functions;
                        streamParams.function_call = 'auto';
                    }
                    const stream = await execItemMethod(model, 'streamChat', streamParams);
                    for await (const chunk of stream) {
                        if (typeof chunk === 'string') {
                            fullResponse += chunk;
                            WORK.wsSend?.({ type: 'chat.delta', path: wsPath, token: chunk });
                        } else if (chunk && typeof chunk === 'object') {
                            if (chunk.type === 'content' && chunk.content) {
                                fullResponse += chunk.content;
                                WORK.wsSend?.({ type: 'chat.delta', path: wsPath, token: chunk.content });
                            } else if (chunk.type === 'function_call') {
                                nativeToolCalls.push({
                                    method: chunk.name,
                                    args: chunk.arguments || {},
                                });
                                hasNativeFunctionCall = true;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[task.ai] streamChat error:', e.message);
                    ribbonTarget.push({
                        type: 'text',
                        content: 'Ошибка: ' + e.message,
                        time: Date.now(),
                        sender: modelSender,
                        error: true,
                    });
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: e.message });
                    return { ok: false, error: e.message };
                }

                lastResponse = fullResponse;

                // Разбор: reasoning/questions/text, затем plan→action (без plan на action)
                const blocks = parseResponseToRibbon(fullResponse, modelSender);
                const activeTask = [...body.ribbon].reverse().find(b => b.type === 'task' && b.state === 'active');
                const planBlock = blocks.find(b => b.type === 'plan');
                const textParts = blocks.filter(b => b.type === 'text').map(b => b.content).filter(Boolean);

                for (const block of blocks) {
                    if (block.type === 'plan') {
                        const plan = normalizePlanSteps(block.plan);
                        if (activeTask) {
                            activeTask.plan = plan;
                            const allDone = plan.every(s => s.status === 'done');
                            if (allDone) {
                                activeTask.state = 'completed';
                                ribbonTarget.push({
                                    type: 'action',
                                    time: Date.now(),
                                    sender: modelSender,
                                    title: 'Задача выполнена',
                                    content: 'Все шаги выполнены. Принять результат?',
                                    action: 'Принять',
                                    color: 'success',
                                });
                                WORK.wsSend?.({ type: 'chat.plan_completed', path: wsPath });
                            }
                            WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan });
                        } else {
                            // action = блок подтверждения; plan только в content как MD (и потом у task)
                            const content = [...textParts, formatPlanMarkdown(plan)]
                                .filter(Boolean).join('\n\n');
                            ribbonTarget.push({
                                type: 'action',
                                time: Date.now(),
                                sender: modelSender,
                                title: 'Есть план',
                                content,
                                action: block.actionLabel || 'Начать',
                                color: block.actionColor || 'success',
                            });
                            WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan });
                        }
                        continue;
                    }
                    // Текст уже вошёл в action.content при предложении плана
                    if (block.type === 'text' && planBlock && !activeTask)
                        continue;
                    // Do: JSON плана не должен попадать в ленту (sticky/chrome уже показывает progress)
                    if (block.type === 'text' && activeTask) {
                        const content = stripPlanJsonLeak(block.content);
                        if (!content)
                            continue;
                        ribbonTarget.push({ ...block, content });
                        continue;
                    }
                    // Дубль <action> при <plan> — не пушим
                    if (block.type === 'action' && planBlock)
                        continue;
                    ribbonTarget.push(block);
                }

                toolCalls = nativeToolCalls;
                if (toolCalls.length === 0)
                    toolCalls = parseToolCalls(fullResponse, functions);

                if (toolCalls.length === 0)
                    break;
            }

            // Записать tool_call блоки в ленту до выполнения
            pushToolCallBlocks(ribbonTarget, toolCalls, modelSender);

            // === Проверка опасных методов ===
            const trustLevel = Number(model.trustLevel || 0);
            const hasDangerous = toolCalls.some(c => DANGEROUS_METHODS.includes(c.method));

            if (hasDangerous && trustLevel < TRUST_AUTOCONFIRM) {
                const descLines = toolCalls
                    .filter(c => DANGEROUS_METHODS.includes(c.method))
                    .map(c => '• ' + c.method + '(' + Object.keys(c.args || {}).join(', ') + ')');
                ribbonTarget.push({
                    type: 'action',
                    time: Date.now(),
                    sender: modelSender,
                    title: 'Подтвердить действия',
                    content: descLines.join('\n'),
                    action: 'Подтвердить',
                    color: 'warning',
                    calls: toolCalls,
                    contextPath: currentContext.path || '',
                });
                WORK.wsSend?.({
                    type: 'chat.action',
                    path: wsPath,
                    label: 'Подтвердить действия',
                    description: descLines.join('\n'),
                });
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, pendingAction: true };
            }

            // === Выполнение вызовов ===
            for (const call of toolCalls) {
                const { result, newContext } = await executeToolCall(call, currentContext, initialContext, functions, params, aiUser);
                currentContext = newContext;
                pushToolResult(ribbonTarget, call, result, model);
                sendToolResultWs(wsPath, call, result);
            }

            await writeTaskBody(fullPath, body);
        }

        if (iteration >= maxIter && lastResponse) {
            body.ribbon.push({
                type: 'text',
                content: 'Превышен лимит итераций. Последний ответ:\n' + lastResponse.slice(0, 2000),
                time: Date.now(),
                sender: modelSender,
                error: true,
            });
        }

        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
        WORK.wsSend?.({ type: 'chat.done', path: wsPath });
        return { ok: true, iterations: iteration };
    },
};

// ============================================================================
// Вспомогательные функции
// ============================================================================

/** Активная task.ribbon или основная лента */
function resolveRibbonTarget(body) {
    const lastTask = [...(body.ribbon || [])].reverse().find(b => b.type === 'task' && b.state === 'active');
    if (lastTask) {
        lastTask.ribbon ??= [];
        return lastTask.ribbon;
    }
    return body.ribbon;
}

/**
 * Action активирует кнопку только если он последний блок в целевой ленте
 * (основной ribbon или ribbon активной task).
 */
function findTrailingAction(ribbon) {
    if (!Array.isArray(ribbon) || !ribbon.length)
        return null;
    const activeTask = [...ribbon].reverse().find(b => b.type === 'task' && b.state === 'active');
    const target = (activeTask && Array.isArray(activeTask.ribbon) && activeTask.ribbon.length)
        ? activeTask.ribbon
        : ribbon;
    const last = target[target.length - 1];
    if (last?.type === 'action' && !last.resolved)
        return last;
    return null;
}

function normalizePlanSteps(steps) {
    if (!Array.isArray(steps))
        return [];
    return steps.map((s, i) => ({
        step: s.step ?? (i + 1),
        description: s.description || s.content || String(s),
        status: s.status || 'proposed',
    }));
}

/** Шаги плана → markdown-список для action.content */
function formatPlanMarkdown(plan) {
    return normalizePlanSteps(plan)
        .map(s => s.step + '. ' + s.description)
        .join('\n');
}

/** Массив объектов похож на plan steps */
function looksLikePlanSteps(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    return arr.every(s => s && typeof s === 'object'
        && (s.step != null || s.description != null || s.status != null));
}

/**
 * Вырезать из текста сырой JSON плана (вне тегов или остатки).
 * Возвращает очищенный текст.
 */
function stripPlanJsonLeak(text) {
    if (!text) return '';
    let out = String(text);
    out = out.replace(/<\/?plan>/gi, '');
    out = out.replace(/\[[\s\S]*?\]/g, (m) => {
        try {
            const parsed = JSON.parse(m);
            if (looksLikePlanSteps(parsed))
                return '';
        } catch {}
        return m;
    });
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Если в тексте «голый» JSON массива шагов — забрать как plan, остаток вернуть.
 * @returns {{ steps: array, rest: string } | null}
 */
function extractBarePlanFromText(text) {
    if (!text) return null;
    const src = String(text);
    const re = /\[[\s\S]*?\]/g;
    let m;
    while ((m = re.exec(src))) {
        try {
            const parsed = JSON.parse(m[0]);
            if (!looksLikePlanSteps(parsed)) continue;
            const rest = (src.slice(0, m.index) + src.slice(m.index + m[0].length))
                .replace(/\n{3,}/g, '\n\n').trim();
            return { steps: parsed, rest };
        } catch {}
    }
    return null;
}

/** Восстановить plan[] из нумерованного списка в action.content */
function parsePlanFromContent(content) {
    if (!content)
        return [];
    const steps = [];
    for (const line of String(content).split('\n')) {
        const m = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
        if (m)
            steps.push({ step: Number(m[1]), description: m[2].trim(), status: 'proposed' });
    }
    return steps;
}

function isPlanStartAction(action) {
    if (!action || action.calls?.length)
        return false;
    const label = String(action.action || '').toLowerCase();
    const title = String(action.title || '');
    if (title === 'Есть план' || label.includes('начать'))
        return true;
    return parsePlanFromContent(action.content).length > 0;
}

function pushToolCallBlocks(ribbonTarget, toolCalls, sender) {
    for (const call of toolCalls) {
        ribbonTarget.push({
            type: 'tool_call',
            time: Date.now(),
            sender,
            method: call.method,
            args: call.args || {},
        });
    }
}

function ensureToolCallBlocks(ribbonTarget, calls, sender) {
    for (const call of calls) {
        const exists = ribbonTarget.some(b =>
            b.type === 'tool_call' && b.method === call.method
            && JSON.stringify(b.args || {}) === JSON.stringify(call.args || {}));
        if (!exists) {
            ribbonTarget.push({
                type: 'tool_call',
                time: Date.now(),
                sender,
                method: call.method,
                args: call.args || {},
            });
        }
    }
}

/**
 * Построить список functions (OpenAI-compatible) из схемы методов контекста
 * и схем сервисов /services/*.
 */
async function buildFunctionsList(currentContext) {
    let functions = [];

    try {
        const schema = await currentContext.get_schema?.();
        if (schema?.methods) {
            const { buildFunctionsFromSchema } = await import(pathToFileURL(path.join(ROOT, 'sources/modules/ai-schema.js')).href);
            functions = buildFunctionsFromSchema(schema.methods, {
                exclude: ['delete', 'save_secret', 'read_secret'],
            });
        }
    } catch (e) {
        console.warn('[task.ai] get_schema for functions:', e.message);
    }

    try {
        const services = await WORK.get_item('/services/*');
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
    } catch (e) {
        console.warn('[task.ai] services load:', e.message);
    }

    return functions;
}

/**
 * Выполнить один tool_call — вызов метода контекста или сервиса.
 */
async function executeToolCall(call, currentContext, initialContext, functions, params, aiUser) {
    let result;

    try {
        const svcFn = functions.find(fn => fn.name === call.method && fn._servicePath);
        if (svcFn) {
            try {
                const svcItem = await WORK.get_item(svcFn._servicePath);
                const svcFnMethod = svcItem[call.method];
                if (typeof svcFnMethod === 'function') {
                    result = await svcFnMethod.call(svcItem, call.args || {});
                } else {
                    result = { error: 'Метод ' + call.method + ' не реализован' };
                }
            } catch (e) {
                result = { error: 'Ошибка сервиса: ' + e.message };
            }
        } else if (call.method === 'get_property' && call.args?.name) {
            const propName = call.args.name;
            const descriptor = Object.getOwnPropertyDescriptor(currentContext.constructor.prototype, propName);
            if (descriptor?.get) {
                result = descriptor.get.call(currentContext);
                if (result && typeof result === 'object' && typeof result.then === 'function')
                    result = await result;
            } else {
                result = currentContext[propName];
                if (result && typeof result === 'object' && typeof result.then === 'function')
                    result = await result;
            }
        } else if (call.method === 'set_property' && call.args?.name) {
            const propName = call.args.name;
            const value = call.args.value;
            const descriptor = Object.getOwnPropertyDescriptor(currentContext.constructor.prototype, propName);
            if (descriptor?.set) {
                descriptor.set.call(currentContext, value);
                result = { success: true, message: 'Свойство ' + propName + ' установлено' };
            } else {
                currentContext[propName] = value;
                result = { success: true, message: 'Свойство ' + propName + ' установлено' };
            }
        } else {
            const fn = currentContext[call.method];
            if (typeof fn === 'function') {
                result = await fn.call(currentContext, { ...call.args, user: params.user });
            } else if (fn !== undefined) {
                result = await fn;
            } else {
                throw new Error('Метод/свойство "' + call.method + '" не найден у ' + currentContext.type);
            }
        }
    } catch (e) {
        result = { error: e.message };
    }

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
            } catch {}
        } else {
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
            } else {
                result = { error: 'Файл не найден: ' + fileName };
            }
        } catch (e) {
            result = { error: 'Не удалось прочитать файл ' + fileName + ': ' + e.message };
        }
    }

    if (call.method === 'write_file' && call.args?.name) {
        const fileName = String(call.args.name);
        const content = call.args.content ?? '';
        try {
            const saveResult = await currentContext.save_file?.({
                filename: fileName,
                post: String(content),
                encoding: 'utf-8',
                user: aiUser,
            });
            const resultPath = saveResult?.path || saveResult?.logPath || '';
            result = { success: true, message: 'Файл сохранён: ' + fileName, path: resultPath, resultPath };
        } catch (e) {
            result = { error: 'Не удалось сохранить файл ' + fileName + ': ' + e.message };
        }
    }

    if (call.method === 'reset_context') {
        newContext = initialContext;
        result = { success: true, message: 'Контекст сброшен к классу: ' + initialContext.path };
    }

    if (result && typeof result === 'object' && result.path && result.type
        && call.method !== 'navigate' && call.method !== 'reset_context') {
        newContext = result;
    }

    return { result, newContext };
}

function pushToolResult(ribbonTarget, call, result, model) {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    const chatEntry = {
        type: 'tool_result',
        content: resultStr.slice(0, 32000),
        tool: call.method,
        time: Date.now(),
        sender: model.path || 'WORK',
        error: !!(result && typeof result === 'object' && result.error),
    };
    if (result?.resultPath)
        chatEntry.resultPath = result.resultPath;
    ribbonTarget.push(chatEntry);
}

function sendToolResultWs(wsPath, call, result) {
    const resultPreview = typeof result === 'string'
        ? result.slice(0, 2000)
        : JSON.stringify(result).slice(0, 2000);
    WORK.wsSend?.({ type: 'chat.tool_result', path: wsPath, tool: call.method, result: resultPreview });
}

async function loadTaskBody(taskAi) {
    try {
        const raw = await taskAi.load({ encoding: 'utf-8' });
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
        console.warn('[task.ai] loadTaskBody:', e.message);
        return null;
    }
}

async function writeTaskBody(fullPath, body) {
    try {
        // Transient-поля и legacy pendingAction не хранятся в файле
        const { context, mem, readme, pendingAction, ...persist } = body;
        stripPlanFromActions(persist.ribbon);
        await fsp.writeFile(path.join(ROOT, fullPath), JSON.stringify(persist, null, 4), 'utf-8');
    } catch (e) {
        console.warn('[task.ai] writeTaskBody:', e.message);
    }
}

/** plan только у task — с action убираем (legacy / ошибки записи) */
function stripPlanFromActions(ribbon) {
    if (!Array.isArray(ribbon)) return;
    for (const b of ribbon) {
        if (b?.type === 'action' && b.plan)
            delete b.plan;
        if (b?.type === 'task' && Array.isArray(b.ribbon))
            stripPlanFromActions(b.ribbon);
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
    } catch {
        WORK.wsSend?.({ path: fullPath });
    }
}

/**
 * Построить массив messages для LLM из ленты (ribbon) блоков.
 *
 * Новый формат (type-only) + legacy fallback (role / details / form / block).
 */
function buildHistoryFromRibbon(body, useFunctionCalling = false) {
    const messages = [];

    let systemContent = body.system || '';
    if (body.context)
        systemContent += '\n\n## Текущий контекст\n' + body.context;
    if (body.mem)
        systemContent += '\n\n## Память (.mem)\n' + body.mem;
    if (body.readme)
        systemContent += '\n\n## Описание класса (readme.md)\n' + body.readme;
    if (systemContent)
        messages.push({ role: 'system', content: systemContent });

    appendRibbonMessages(messages, body.ribbon || [], useFunctionCalling);
    return messages;
}

function appendRibbonMessages(messages, ribbon, useFunctionCalling) {
    let pendingAssistant = '';

    const flushAssistant = () => {
        if (pendingAssistant) {
            messages.push({ role: 'assistant', content: pendingAssistant });
            pendingAssistant = '';
        }
    };

    for (const entry of ribbon) {
        // prompt (new) или role:user (legacy)
        if ((entry.type === 'prompt' || entry.role === 'user') && entry.content) {
            flushAssistant();
            messages.push({ role: 'user', content: entry.content });
            continue;
        }

        // legacy role:assistant без type
        if (entry.role === 'assistant' && !entry.type && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        if (entry.type === 'text' && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        // reasoning (new) / details (legacy) — не отправляем
        if (entry.type === 'reasoning' || entry.type === 'details')
            continue;

        // questions (new) / form (legacy) — ответы уже как prompt
        if (entry.type === 'questions' || entry.type === 'form')
            continue;

        // action / file — UI-элементы
        if (entry.type === 'action' || entry.type === 'file')
            continue;

        // legacy block с steps → <plan>
        if (entry.type === 'block' && entry.steps) {
            flushAssistant();
            messages.push({ role: 'assistant', content: '<plan>' + JSON.stringify(entry.steps) + '</plan>' });
            continue;
        }
        if (entry.type === 'block' && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        // tool_call
        if (entry.type === 'tool_call' && entry.method) {
            flushAssistant();
            if (useFunctionCalling) {
                messages.push({
                    role: 'assistant',
                    content: null,
                    function_call: {
                        name: entry.method,
                        arguments: typeof entry.args === 'string' ? entry.args : JSON.stringify(entry.args || {}),
                    },
                });
            } else {
                messages.push({
                    role: 'assistant',
                    content: '<tool_call>' + JSON.stringify({ method: entry.method, args: entry.args || {} }) + '</tool_call>',
                });
            }
            continue;
        }

        // tool_result
        if (entry.type === 'tool_result' && entry.content) {
            flushAssistant();
            if (useFunctionCalling) {
                messages.push({ role: 'function', name: entry.tool || 'unknown', content: entry.content });
            } else {
                messages.push({
                    role: 'user',
                    content: 'Результат ' + (entry.tool || 'метода') + ':\n' + entry.content,
                });
            }
            continue;
        }

        // task — plan как контекст + рекурсия ribbon
        if (entry.type === 'task') {
            flushAssistant();
            const plan = entry.plan || entry.steps;
            if (plan?.length) {
                messages.push({
                    role: 'assistant',
                    content: '<plan>' + JSON.stringify(plan) + '</plan>',
                });
            }
            appendRibbonMessages(messages, entry.ribbon || [], useFunctionCalling);
        }
    }

    flushAssistant();
}

async function buildContextInfo(context, user) {
    let info = '';
    try {
        await context.info();
        info = 'Ты находишься здесь: ' + (context.path || context.short || '?') + '\n';
        info += 'Тип элемента: ' + context.type + '\n';
        if (context.label)
            info += 'Название: ' + context.label + '\n';
    } catch (e) {
        info = 'Контекст: ' + (context.path || '?') + '\n';
    }
    return info;
}

/**
 * Разобрать ответ ИИ на типизированные блоки для ленты чата.
 * Порядок: reasoning → text → [plan|action] ИЛИ trailing questions (гейт).
 * Если есть <questions> — текст складывается в questions.content, plan игнорируется.
 * Если есть и <plan>, и <action> — action-тег вливается в plan (без дубля).
 */
function parseResponseToRibbon(text, sender = 'WORK') {
    const blocks = [];
    const time = Date.now();
    if (!text)
        return blocks;

    let remaining = text;
    let planSteps = null;
    let actionMeta = null;
    let questionsBlock = null;
    const textParts = [];

    // 1. <reasoning>
    const reasoningMatches = [...remaining.matchAll(/<reasoning>([\s\S]*?)<\/reasoning>/g)];
    for (const m of reasoningMatches) {
        blocks.push({ type: 'reasoning', label: 'Мысли', content: m[1].trim(), time, sender });
    }
    remaining = remaining.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '');

    // 2. <questions> — массив fields или объект { title, content, action, fields }
    const questionsMatch = remaining.match(/<questions>\s*([\s\S]*?)\s*<\/questions>/);
    if (questionsMatch) {
        const beforeQ = remaining.slice(0, questionsMatch.index).trim();
        if (beforeQ)
            textParts.push(beforeQ);
        remaining = remaining.slice(questionsMatch.index + questionsMatch[0].length);
        try {
            const parsed = JSON.parse(questionsMatch[1].trim());
            let fields = null;
            let meta = {};
            if (Array.isArray(parsed)) {
                fields = parsed;
            } else if (parsed && typeof parsed === 'object') {
                fields = Array.isArray(parsed.fields) ? parsed.fields
                    : (Array.isArray(parsed.questions) ? parsed.questions : null);
                meta = parsed;
            }
            if (Array.isArray(fields) && fields.length) {
                questionsBlock = {
                    type: 'questions',
                    time,
                    sender,
                    title: meta.title || 'Уточните',
                    content: meta.content || '',
                    action: meta.action || meta.label || 'Заполнить',
                    color: meta.color || 'info',
                    fields: normalizeQuestionFields(fields),
                };
                if (meta.layout)
                    questionsBlock.layout = meta.layout;
            }
        } catch {}
    }

    // 3. <plan> — пропускаем, если уже есть questions (гейт формы первым)
    const planMatch = remaining.match(/<plan>\s*(\[[\s\S]*?\])\s*<\/plan>/);
    if (planMatch && !questionsBlock) {
        try {
            const steps = JSON.parse(planMatch[1]);
            if (Array.isArray(steps)) {
                const beforePlan = remaining.slice(0, planMatch.index).trim();
                if (beforePlan)
                    textParts.push(beforePlan);
                planSteps = steps;
                remaining = remaining.slice(planMatch.index + planMatch[0].length);
            }
        } catch {}
    } else if (planMatch && questionsBlock) {
        remaining = remaining.replace(/<plan>[\s\S]*?<\/plan>/g, '');
    }

    // 4. <action> — с закрывающим тегом или без (модели часто обрывают </action>)
    const actionMatch = remaining.match(/<action>\s*(\{[^{}]*\})\s*(?:<\/action>)?/)
        || remaining.match(/<action>\s*(\{[\s\S]*?\})\s*<\/action>/);
    if (actionMatch) {
        if (!questionsBlock) {
            try {
                const action = JSON.parse(actionMatch[1]);
                // title — только явный; label не копировать в title (иначе мусор title:"Да" action:"Да")
                actionMeta = {
                    content: action.content || action.description || '',
                    action: action.action || action.label || action.text || 'OK',
                    color: action.color || 'info',
                };
                if (action.title)
                    actionMeta.title = String(action.title);
            } catch {}
        }
        remaining = remaining.replace(/<action>[\s\S]*?(?:<\/action>|$)/g, '');
        remaining = remaining.replace(/<\/action>/g, '');
    }

    // 5. tool_call — не в блоки парсера
    remaining = remaining.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    remaining = remaining.replace(/```tool_call[\s\S]*?```/g, '');

    // 6. Остаточный текст + «голый» plan-JSON без тегов
    let cleanText = remaining.trim();
    if (!planSteps && !questionsBlock && cleanText) {
        const bare = extractBarePlanFromText(cleanText);
        if (bare) {
            planSteps = bare.steps;
            cleanText = bare.rest;
        }
    }
    if (cleanText) {
        cleanText = stripPlanJsonLeak(cleanText);
        if (cleanText)
            textParts.push(cleanText);
    }

    if (questionsBlock) {
        // Поясняющий текст — в карточку questions, не отдельным пузырём
        const folded = stripPlanJsonLeak(textParts.join('\n\n').trim());
        if (folded) {
            questionsBlock.content = questionsBlock.content
                ? (questionsBlock.content + '\n\n' + folded)
                : folded;
        }
        blocks.push(questionsBlock);
        return blocks;
    }

    if (textParts.length) {
        const joined = stripPlanJsonLeak(textParts.join('\n\n'));
        if (joined)
            blocks.push({ type: 'text', content: joined, time, sender });
    }

    // 7. plan / action в конце (кнопка всегда последней)
    if (planSteps) {
        blocks.push({
            type: 'plan',
            plan: planSteps,
            time,
            sender,
            actionLabel: actionMeta?.action || 'Начать',
            actionColor: actionMeta?.color || 'success',
        });
    } else if (actionMeta) {
        const block = {
            type: 'action',
            time,
            sender,
            content: actionMeta.content,
            action: actionMeta.action,
            color: actionMeta.color,
        };
        if (actionMeta.title)
            block.title = actionMeta.title;
        blocks.push(block);
    }

    return blocks;
}

/** METADATA-like fields + legacy text/textarea/checkbox → String/Text/Boolean… */
function normalizeQuestionFields(fields) {
    const typeMap = {
        text: 'String', string: 'String', email: 'String',
        textarea: 'Text', text_area: 'Text',
        number: 'Number',
        checkbox: 'Boolean', boolean: 'Boolean', bool: 'Boolean',
        date: 'DateTime', datetime: 'DateTime', 'date-time': 'DateTime',
        select: 'Select',
    };
    return fields.map(f => {
        if (!f || typeof f !== 'object') return null;
        const id = f.id || f.name;
        if (!id) return null;
        const rawType = String(f.type || 'String');
        const type = typeMap[rawType.toLowerCase()] || (/^[A-Z]/.test(rawType) ? rawType : 'String');
        const out = {
            id: String(id),
            type,
            label: f.label || f.name || String(id),
        };
        if (f.placeholder != null) out.placeholder = f.placeholder;
        if (f.required != null) out.required = !!f.required;
        if (Array.isArray(f.options)) out.options = f.options.map(o => typeof o === 'string' ? o : (o?.label || o?.text || o?.value || String(o)));
        if (Array.isArray(f.fields)) out.fields = normalizeQuestionFields(f.fields);
        return out;
    }).filter(Boolean);
}

function parseToolCalls(text, functions = []) {
    const calls = [];
    if (!text)
        return calls;

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
        } catch {}
    }

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
            } catch {}
        }
    }

    if (calls.length === 0 && functions.length > 0) {
        const knownNames = new Set(functions.map(fn => fn.name));
        const xmlRegex = /<(\w+)\s+([^>]+)\/?>/g;
        while ((match = xmlRegex.exec(text)) !== null) {
            const tagName = match[1];
            const attrsStr = match[2];
            if (!knownNames.has(tagName))
                continue;
            const args = {};
            const attrRegex = /(\w+)=["']([^"']*)["']/g;
            let am;
            while ((am = attrRegex.exec(attrsStr)) !== null) {
                args[am[1]] = am[2];
            }
            if (Object.keys(args).length > 0) {
                calls.push({ method: tagName, args });
            }
        }
    }

    return calls;
}

async function loadReadme(storage) {
    try {
        const meta = storage.meta_folder || storage;
        const file = await meta._get_item?.('readme.md');
        if (file && file.load) {
            const content = await file.load({ encoding: 'utf-8' });
            if (content)
                return typeof content === 'string' ? content : String(content);
        }
    } catch (e) {
        console.warn('[task.ai] loadReadme:', e.message);
    }
    return '';
}

async function getGeoByIp() {
    try {
        const geo = await new Promise((resolve, reject) => {
            const req = https.get('https://ip-api.com/json/?lang=ru&fields=city,regionName,lat,lon', {
                headers: { 'User-Agent': 'WORK-AI/1.0' },
                timeout: 5000,
            }, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); } catch (e) { reject(e); } });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        });
        if (geo?.city) {
            let info = 'Местоположение пользователя: ' + geo.city;
            if (geo.regionName && geo.regionName !== geo.city)
                info += ', ' + geo.regionName;
            if (geo.lat && geo.lon)
                info += ' (' + geo.lat + ', ' + geo.lon + ')';
            return info + '\n';
        }
    } catch (e) {
        console.warn('[task.ai] getGeoByIp:', e.message);
    }
    return '';
}

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
                if (content) {
                    parts.push('### ' + file.id + '\n' + (typeof content === 'string' ? content : String(content)));
                }
            } catch (e) {
                console.warn('[task.ai] loadMemFiles:', file.id, e.message);
            }
        }
        return parts.join('\n\n');
    } catch (e) {
        console.warn('[task.ai] loadMemFiles:', e.message);
        return '';
    }
}
