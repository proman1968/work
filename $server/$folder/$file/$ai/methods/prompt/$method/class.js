/**
 * Серверный метод prompt для task.ai — контекстный harness цикл tool-call.
 * this = task.ai файл (передаётся через tryHandlerMethod → execute.call(item))
 *
 * Поддерживает нативный function calling:
 * - Схема методов контекста → functions (OpenAI-compatible)
 * - streamChat с functions → yield {type:'content'} / {type:'function_call'}
 * - Fallback: текстовый парсинг <tool_call> для моделей без function calling
 *
 * Подтверждение опасных действий:
 * - При trustLevel < TRUST_AUTOCONFIRM опасные методы не выполняются сразу
 * - Вызовы сохраняются в body.pendingAction, клиент получает chat.action
 * - При подтверждении ({confirm:true}) — вызовы выполняются, цикл продолжается
 * - При отказе ({confirm:false}) — tool_result "отменено", цикл продолжается
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as https from 'node:https';

const ROOT = process.cwd();
const MAX_ITERATIONS = 10;
// Опасные методы — требуют подтверждения через <action> при trustLevel < 3
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
        let answers = undefined;
        const raw = post ?? params.text ?? params.post ?? '';
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                text = String(parsed.text ?? '').trim();
                requestModel = String(parsed.model ?? '').trim();
                confirm = parsed.confirm;
                if (parsed.answers && typeof parsed.answers === 'object')
                    answers = parsed.answers;
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

        // Миграция legacy user → type:prompt
        for (const m of body.ribbon) {
            if (m.role === 'user' && !m.type) {
                m.type = 'prompt';
                delete m.role;
            }
        }

        // === 4. Загрузка модели ===
        if (requestModel)
            body.model = requestModel;

        const { findFirstModel } = await import(pathToFileURL(path.join(ROOT, 'sources/modules/ai-schema.js')).href);
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
        if (!model) throw new Error('Модель не найдена: ' + modelPath);

        const { execItemMethod } = await import(pathToFileURL(path.join(ROOT, 'sources/host/http-server.js')).href);
        const maxIter = body.maxIterations || MAX_ITERATIONS;

        // Пользователь от лица модели — для логов действий ИИ
        const modelLabel = model.label || model.path?.split('/').pop() || 'AI';
        const aiUser = { uid: modelLabel, $user: params.user?.$user || params.user, isAI: true };
        const sender = params.user?.uid || params.user?.$user?.id || 'unknown';

        // ribbonTarget: последняя активная task или основная лента
        let ribbonTarget = body.ribbon;
        const lastTask = [...body.ribbon].reverse().find(b => b.type === 'task' && b.state === 'active');
        if (lastTask)
            ribbonTarget = lastTask.ribbon;

        let currentContext = initialContext;

        // === 5. Обработка подтверждения ожидающего действия ===
        if (body.pendingAction && confirm !== undefined) {
            // Восстановить контекст из pendingAction
            if (body.pendingAction.contextPath) {
                try {
                    const target = await WORK.get_item(body.pendingAction.contextPath);
                    if (target)
                        currentContext = target;
                } catch {}
            }
            // Построить functions для выполнения вызовов
            const functions = await buildFunctionsList(currentContext);

            if (confirm === true) {
                // Выполнить отложенные вызовы
                for (const call of body.pendingAction.calls || []) {
                    const { result, newContext } = await executeToolCall(call, currentContext, initialContext, functions, params, aiUser);
                    currentContext = newContext;
                    pushToolResult(ribbonTarget, call, result, model);
                    sendToolResultWs(wsPath, call, result);
                }
            } else {
                // Отмена — добавить tool_result "отменено" для каждого вызова
                for (const call of body.pendingAction.calls || []) {
                    ribbonTarget.push({
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
            body.pendingAction = null;
            await writeTaskBody(fullPath, body);
            // Продолжаем основной цикл — модель увидит результаты и продолжит диалог
        } else if (body.pendingAction) {
            // pendingAction висит, но confirm не пришёл (обычный текстовый промпт)
            // Сбрасываем — пользователь проигнорировал подтверждение
            body.pendingAction = null;
        }

        // === 5b. Подтверждение / отказ плана (pendingPlan) — факт = prompt, не status у action ===
        {
            const open = findOpenAction(body.ribbon);
            const openAction = open?.action;
            const actionRibbon = open?.ribbon || body.ribbon;
            const acceptLabel = openAction?.button?.label || 'Начать';
            const textNorm = String(text || '').trim().toLowerCase();
            const acceptWords = ['начать', 'да', 'продолжить', 'ок', 'подтвердить', 'принять'];
            const rejectWords = ['нет', 'отмена', 'отменить', 'отказ'];
            const textIsAccept = textNorm && (
                acceptWords.some(w => textNorm.includes(w)) || textNorm === acceptLabel.toLowerCase()
            );
            const textIsReject = textNorm && rejectWords.some(w => textNorm === w || textNorm.startsWith(w));
            const isAcceptPlan = body.pendingPlan && (confirm === true || textIsAccept);
            const isFormSubmit = !body.pendingPlan && openAction?.fields?.length
                && (confirm === true || textIsAccept);
            const isAcceptFinal = !body.pendingPlan && !isFormSubmit && openAction
                && (confirm === true || textIsAccept);
            const isReject = (body.pendingPlan || openAction) && (confirm === false || textIsReject);

            if (isAcceptPlan) {
                const promptContent = text?.trim() || acceptLabel;
                // Факт согласия — в корневой ленте (перед task)
                pushClosingPrompt(body.ribbon, promptContent, sender, answers);
                text = ''; // не дублировать prompt в §7
                const plan = body.pendingPlan;
                const steps = prepareStepsForStart(plan.steps || []);
                const task = {
                    type: 'task',
                    label: body.title || plan.label || 'План',
                    content: '',
                    state: 'active',
                    steps,
                    ribbon: [],
                    time: Date.now(),
                    sender,
                };
                body.ribbon.push(task);
                ribbonTarget = task.ribbon;
                body.pendingPlan = null;
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
            } else if (isFormSubmit) {
                // Ответы на поля action — prompt с answers, продолжаем LLM
                const promptContent = text?.trim() || acceptLabel;
                pushClosingPrompt(actionRibbon, promptContent, sender, answers);
                // Зафиксировать value в fields открытого action
                if (answers && openAction.fields) {
                    for (const f of openAction.fields) {
                        if (answers[f.id] !== undefined)
                            f.value = answers[f.id];
                    }
                }
                text = '';
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
            } else if (isAcceptFinal) {
                // «Принять» по завершённому task — закрывающий prompt в той же ленте, что action
                const promptContent = text?.trim() || acceptLabel;
                pushClosingPrompt(actionRibbon, promptContent, sender, answers);
                text = '';
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, accepted: true };
            } else if (isReject) {
                const promptContent = text?.trim() || 'Нет';
                pushClosingPrompt(actionRibbon, promptContent, sender);
                text = '';
                body.pendingPlan = null;
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, rejected: true };
            } else if ((openAction || body.pendingPlan) && text && !isAcceptPlan && !isFormSubmit) {
                // Любой другой prompt закрывает открытый action; план снимаем
                body.pendingPlan = null;
            } else if ((openAction || body.pendingPlan) && !text && confirm === undefined) {
                // Открытый action / план без решения — не крутим LLM
                return { ok: true, pendingPlan: !!body.pendingPlan, pendingActionConfirm: true };
            }
        }

        // === 6. Проверка текста (только для обычного промпта) ===
        if (!text && confirm === undefined)
            throw new Error('Текст промпта пуст');

        // === 7. Добавление user-сообщения ===
        if (text) {
            const lastUser = [...body.ribbon].reverse().find(b => b.type === 'prompt' || b.role === 'user');
            const isDuplicate = lastUser && lastUser.content === text
                && (Date.now() - (lastUser.time || 0)) < 10000;
            if (!isDuplicate) {
                body.ribbon.push({ type: 'prompt', content: text, time: Date.now(), sender });
            }
        }

        // === 8. Загрузка контекста, памяти, readme ===
        const memContent = await loadMemFiles(initialContext);
        const readmeContent = await loadReadme(initialContext);
        const contextInfo = await buildContextInfo(initialContext, params.user);
        const geoInfo = await getGeoByIp();
        body.context = contextInfo + (geoInfo || '');
        body.mem = memContent;
        body.readme = readmeContent;

        // === 9. Основной цикл tool-call ===
        let iteration = 0;
        let lastResponse = '';

        while (iteration < maxIter) {
            iteration++;
            const messages = buildHistoryFromRibbon(body, model.functionCalling === true);

            // Построение functions из схемы методов контекста
            let functions = await buildFunctionsList(currentContext);

            let fullResponse = '';
            let toolCalls = [];

            {
                // Обычный режим — стриминг от модели
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
                        type: 'error',
                        content: 'Ошибка: ' + e.message,
                        time: Date.now(),
                        sender: model.path || 'WORK',
                    });
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: e.message });
                    return { ok: false, error: e.message };
                }

                lastResponse = fullResponse;

                // Разбор ответа: thinking / form / единый action(MD) / pendingPlan
                const parsed = parseResponseToRibbon(fullResponse, model.path || 'WORK');
                let blocks = parsed.blocks || [];
                const activeTask = [...body.ribbon].reverse().find(b => b.type === 'task' && b.state === 'active');
                let waitingForUser = false;

                if (parsed.pendingPlan) {
                    if (activeTask) {
                        // Do-фаза: обновляем steps, не предлагаем снова «Начать»
                        activeTask.steps = parsed.pendingPlan.steps;
                        const allDone = parsed.pendingPlan.steps.every(s => s.status === 'done');
                        if (allDone) {
                            activeTask.state = 'completed';
                            blocks = blocks.filter(b => b.type !== 'action' || b.fields?.length);
                            if (!blocks.some(b => b.type === 'action' && !b.fields?.length)) {
                                blocks.push({
                                    type: 'action',
                                    title: '',
                                    content: formatPlanMarkdown(parsed.pendingPlan.steps, 'Принять результат?'),
                                    button: { label: 'Принять', color: 'success' },
                                    time: Date.now(),
                                    sender: model.path || 'WORK',
                                });
                            }
                            waitingForUser = true;
                            WORK.wsSend?.({ type: 'chat.plan_completed', path: wsPath });
                        } else {
                            // Исполнение: убрать повторный «Начать», оставить action с fields
                            blocks = blocks.filter(b => b.type !== 'action' || b.fields?.length);
                            if (blocks.some(b => b.type === 'action' && b.fields?.length))
                                waitingForUser = true;
                        }
                    } else {
                        body.pendingPlan = parsed.pendingPlan;
                        waitingForUser = blocks.some(b => b.type === 'action') || true;
                    }
                    WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: parsed.pendingPlan.steps });
                } else if (blocks.some(b => b.type === 'action') && !activeTask) {
                    waitingForUser = true;
                } else if (blocks.some(b => b.type === 'action') && activeTask) {
                    // action в task: оставить form-fields или «Принять»; иначе убрать
                    const keep = blocks.filter(b =>
                        b.type === 'action' && (
                            b.fields?.length
                            || /принять|готово/i.test(b.button?.label || '')
                        )
                    );
                    const nonAction = blocks.filter(b => b.type !== 'action');
                    if (keep.length) {
                        blocks = [...nonAction, ...keep];
                        waitingForUser = true;
                    } else {
                        blocks = nonAction;
                    }
                }

                for (const block of blocks) {
                    if (block.function_call === true && hasNativeFunctionCall) {
                        block.function_call = nativeToolCalls.map(c => ({
                            name: c.method,
                            arguments: c.args,
                        }));
                    }
                    ribbonTarget.push(block);
                }

                // Открытый action / план — стоп до prompt пользователя
                if (waitingForUser) {
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                    return { ok: true, pendingPlan: !!body.pendingPlan, pendingActionConfirm: true };
                }

                toolCalls = nativeToolCalls;
                if (toolCalls.length === 0)
                    toolCalls = parseToolCalls(fullResponse, functions);

                if (toolCalls.length === 0)
                    break;
            }

            // === Проверка опасных методов ===
            const trustLevel = Number(model.trustLevel || 0);
            const hasDangerous = toolCalls.some(c => DANGEROUS_METHODS.includes(c.method));

            if (hasDangerous && trustLevel < TRUST_AUTOCONFIRM) {
                // Сохранить вызовы в pendingAction, запросить подтверждение
                body.pendingAction = {
                    calls: toolCalls,
                    contextPath: currentContext.path || '',
                };
                const descLines = toolCalls
                    .filter(c => DANGEROUS_METHODS.includes(c.method))
                    .map(c => '• ' + c.method + '(' + Object.keys(c.args || {}).join(', ') + ')');
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
                type: 'error',
                content: 'Превышен лимит итераций. Последний ответ:\n' + lastResponse.slice(0, 2000),
                time: Date.now(),
                sender: model.path || 'WORK',
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

/**
 * Построить список functions (OpenAI-compatible) из схемы методов контекста
 * и схем сервисов /services/*.
 * @param {object} currentContext — текущий элемент-контекст
 * @returns {Promise<Array>} — массив описаний функций
 */
async function buildFunctionsList(currentContext) {
    let functions = [];

    // Методы контекста
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

    // Методы сервисов — автозагрузка из /services/*
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
 * @param {object} call — { method, args }
 * @param {object} currentContext — текущий контекст
 * @param {object} initialContext — домашний контекст (для reset_context)
 * @param {Array} functions — список доступных функций
 * @param {object} params — параметры запроса (с user)
 * @param {object} aiUser — пользователь от лица модели
 * @returns {Promise<{result: any, newContext: object}>}
 */
async function executeToolCall(call, currentContext, initialContext, functions, params, aiUser) {
    let result;

    try {
        // Методы сервисов — маршрутизация через _servicePath
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

    // Авто-смена контекста, если метод вернул $item
    if (result && typeof result === 'object' && result.path && result.type
        && call.method !== 'navigate' && call.method !== 'reset_context') {
        newContext = result;
    }

    return { result, newContext };
}

/**
 * Добавить результат tool_call в ленту.
 * @param {Array} ribbonTarget — целевая лента (body.ribbon или task.ribbon)
 * @param {object} call — вызов { method, args }
 * @param {any} result — результат выполнения
 * @param {object} model — объект модели
 */
function pushToolResult(ribbonTarget, call, result, model) {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    const isError = result && typeof result === 'object' && result.error;
    const chatEntry = {
        type: 'tool_result',
        label: '🔧 ' + call.method,
        content: resultStr.slice(0, 32000),
        tool: call.method,
        ok: !isError,
        time: Date.now(),
        sender: model.path || 'WORK',
    };
    if (result?.resultPath)
        chatEntry.resultPath = result.resultPath;
    ribbonTarget.push(chatEntry);
}

/**
 * Отправить результат tool_call через WebSocket.
 * @param {string} wsPath — короткий путь для WS
 * @param {object} call — вызов { method, args }
 * @param {any} result — результат выполнения
 */
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
        await fsp.writeFile(path.join(ROOT, fullPath), JSON.stringify(body, null, 4), 'utf-8');
    } catch (e) {
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
    } catch {
        WORK.wsSend?.({ path: fullPath });
    }
}

/**
 * Построить массив messages для LLM из ленты (ribbon) блоков.
 *
 * Преобразует типизированные блоки в формат OpenAI:
 * - {type:'prompt'} / {role:'user'} → user message
 * - {type:'text'} → накапливается как assistant content
 * - {type:'thinking'|'details'} → пропускается
 * - {type:'task'|'block', steps} → <plan>[...]</plan> + рекурсия ribbon
 * - {type:'action'} → пропускается (кнопки UI)
 * - {type:'form'} → пропускается
 * - {type:'error'} → assistant error text
 * - {type:'tool_result'} → function/user message с результатом
 * - {type:'tool'} → краткая пометка assistant
 *
 * @param {object} body — тело task.ai (с ribbon, system, context и т.д.)
 * @param {boolean} useFunctionCalling — использовать нативный формат function calling
 * @returns {Array} — массив сообщений для streamChat
 */
function buildHistoryFromRibbon(body, useFunctionCalling = false) {
    const messages = [];

    // 1. System prompt: базовый + контекст + память + readme
    let systemContent = body.system || '';
    if (body.context)
        systemContent += '\n\n## Текущий контекст\n' + body.context;
    if (body.mem)
        systemContent += '\n\n## Память (.mem)\n' + body.mem;
    if (body.readme)
        systemContent += '\n\n## Описание класса (readme.md)\n' + body.readme;
    if (body.pendingPlan?.steps)
        systemContent += '\n\n## Предложенный план (ожидает подтверждения пользователем)\n' + JSON.stringify(body.pendingPlan.steps);

    const activeTask = (body.ribbon || []).slice().reverse().find(b => b.type === 'task' && b.state === 'active');
    if (activeTask) {
        const cur = activeTask.steps?.find(s => s.status === 'in_progress')
            || activeTask.steps?.find(s => s.status === 'proposed');
        systemContent += '\n\n## Исполнение задачи (Do)\n';
        systemContent += 'Активный план: «' + (activeTask.label || 'План') + '».\n';
        systemContent += 'Шаги: ' + JSON.stringify(activeTask.steps || []) + '\n';
        if (cur)
            systemContent += 'Сейчас выполняй шаг ' + cur.step + ': «' + cur.description + '».\n';
        systemContent += 'Начни с <reasoning>, затем действуй (tool calls). НЕ предлагай новый общий план и НЕ добавляй <action> «Начать».\n';
        systemContent += 'Обновляй <plan> со статусами шагов после прогресса. <action> «Принять» — только когда все steps status:"done".\n';
    }
    if (systemContent)
        messages.push({ role: 'system', content: systemContent });

    // 2. Обход блоков ленты
    const ribbon = body.ribbon || [];
    let pendingAssistant = '';

    for (const entry of ribbon) {
        // Сообщение пользователя (новая схема + legacy)
        if ((entry.type === 'prompt' || entry.role === 'user') && (entry.content || entry.answers)) {
            if (pendingAssistant) {
                messages.push({ role: 'assistant', content: pendingAssistant });
                pendingAssistant = '';
            }
            let content = entry.content || '';
            if (entry.answers && typeof entry.answers === 'object') {
                const lines = Object.entries(entry.answers).map(([k, v]) => k + ': ' + v);
                content = (content ? content + '\n' : '') + 'Ответы:\n' + lines.join('\n');
            }
            messages.push({ role: 'user', content });
            continue;
        }

        // Текстовый блок ассистента — накапливаем
        if (entry.type === 'text' && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        // Мысли — не отправляем модели
        if (entry.type === 'thinking' || entry.type === 'details')
            continue;

        // Action — UI-кнопка, в LLM не шлём
        if (entry.type === 'action')
            continue;

        // Ошибка
        if (entry.type === 'error' && entry.content) {
            if (pendingAssistant) {
                messages.push({ role: 'assistant', content: pendingAssistant });
                pendingAssistant = '';
            }
            messages.push({ role: 'assistant', content: entry.content });
            continue;
        }

        // План (task или legacy block) — <plan> + вложенная лента
        if ((entry.type === 'task' || entry.type === 'block') && entry.steps) {
            if (pendingAssistant) {
                messages.push({ role: 'assistant', content: pendingAssistant });
                pendingAssistant = '';
            }
            messages.push({ role: 'assistant', content: '<plan>' + JSON.stringify(entry.steps) + '</plan>' });
            if (entry.type === 'task' && Array.isArray(entry.ribbon) && entry.ribbon.length) {
                messages.push(...buildHistoryFromRibbon({ ribbon: entry.ribbon, system: '' }, useFunctionCalling));
            }
            continue;
        }

        // Legacy block с content без steps
        if (entry.type === 'block' && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        // Форма legacy — пропускаем (поля теперь в action)
        if (entry.type === 'form')
            continue;

        // Вызов инструмента (если сохранён в ленте)
        if (entry.type === 'tool') {
            if (pendingAssistant) {
                messages.push({ role: 'assistant', content: pendingAssistant });
                pendingAssistant = '';
            }
            pendingAssistant = 'Вызов ' + (entry.name || 'tool') + (entry.args ? ': ' + JSON.stringify(entry.args) : '');
            continue;
        }

        // Результат tool_call
        if (entry.type === 'tool_result' && entry.content) {
            if (pendingAssistant) {
                messages.push({ role: 'assistant', content: pendingAssistant });
                pendingAssistant = '';
            }
            if (useFunctionCalling) {
                messages.push({ role: 'function', name: entry.tool || 'unknown', content: entry.content });
            } else {
                messages.push({
                    role: 'user',
                    content: 'Результат ' + (entry.label || entry.tool || 'метода') + ':\n' + entry.content,
                });
            }
            continue;
        }

        // Legacy task без steps выше — только ribbon
        if (entry.type === 'task') {
            if (pendingAssistant) {
                messages.push({ role: 'assistant', content: pendingAssistant });
                pendingAssistant = '';
            }
            messages.push(...buildHistoryFromRibbon({ ribbon: entry.ribbon, system: '' }, useFunctionCalling));
        }
    }

    if (pendingAssistant)
        messages.push({ role: 'assistant', content: pendingAssistant });

    return messages;
}

function findOpenActionFlat(ribbon) {
    if (!Array.isArray(ribbon)) return null;
    for (let i = ribbon.length - 1; i >= 0; i--) {
        const b = ribbon[i];
        if (b.type === 'prompt' || b.role === 'user')
            return null;
        if (b.type === 'action')
            return b;
    }
    return null;
}

/** Открытый action = последний action, после которого нет prompt (корневая лента или ribbon task).
 *  @returns {{ action: object, ribbon: array }|null}
 */
function findOpenAction(ribbon) {
    if (!Array.isArray(ribbon)) return null;
    const lastTask = [...ribbon].reverse().find(b => b.type === 'task');
    if (lastTask?.ribbon?.length) {
        const nested = findOpenActionFlat(lastTask.ribbon);
        if (nested) return { action: nested, ribbon: lastTask.ribbon };
    }
    const root = findOpenActionFlat(ribbon);
    return root ? { action: root, ribbon } : null;
}

function pushClosingPrompt(ribbon, content, sender, answers) {
    const lastPrompt = [...ribbon].reverse().find(b => b.type === 'prompt' || b.role === 'user');
    const already = lastPrompt && lastPrompt.content === content
        && (Date.now() - (lastPrompt.time || 0)) < 10000;
    if (!already) {
        const block = { type: 'prompt', content, time: Date.now(), sender };
        if (answers && typeof answers === 'object')
            block.answers = answers;
        ribbon.push(block);
    }
}

/** Первый шаг in_progress, остальные proposed (кроме уже done) */
function prepareStepsForStart(steps) {
    if (!Array.isArray(steps)) return [];
    return steps.map((s, i) => {
        const step = { ...s };
        if (step.status === 'done') return step;
        step.status = i === 0 ? 'in_progress' : 'proposed';
        return step;
    });
}

/**
 * Markdown-оформление предложения плана для action.content.
 * При наличии steps — только список (без парафраза prose); короткий CTA («Начнём?») допускается.
 */
function formatPlanMarkdown(steps, prose) {
    const parts = [];
    const hasSteps = Array.isArray(steps) && steps.length;
    if (hasSteps) {
        parts.push('## План', '');
        for (const s of steps) {
            const n = s.step != null ? s.step : '';
            const desc = s.description || '';
            parts.push(n !== '' ? `${n}. ${desc}` : `- ${desc}`);
        }
        const cta = extractShortCta(prose);
        if (cta) {
            parts.push('', cta);
        }
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
    // Берём последнее предложение, если оно короткое и вопросительное
    const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    const last = parts[parts.length - 1] || t;
    if (last.length <= 40 && /[?？]\s*$/.test(last))
        return last.trim();
    return '';
}

/**
 * Разобрать ответ ИИ на типизированные блоки для ленты чата.
 * План + prose + <action> → один action с MD-content (кнопка только в panel).
 * @returns {{ blocks: Array, pendingPlan: object|null }}
 */
function parseResponseToRibbon(text, sender = 'WORK') {
    const blocks = [];
    let pendingPlan = null;
    let actionMeta = null;
    const time = Date.now();
    if (!text)
        return { blocks, pendingPlan };

    let remaining = text;
    const proseParts = [];

    // 1. <reasoning> → thinking
    const reasoningMatches = [...remaining.matchAll(/<reasoning>([\s\S]*?)<\/reasoning>/g)];
    for (const m of reasoningMatches) {
        blocks.push({ type: 'thinking', label: 'Мысли', content: m[1].trim(), time, sender });
    }
    remaining = remaining.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '');

    // 2. <plan> → pendingPlan; текст до плана — prose
    const planMatch = remaining.match(/<plan>\s*(\[[\s\S]*?\])\s*<\/plan>/);
    if (planMatch) {
        try {
            const steps = JSON.parse(planMatch[1]);
            if (Array.isArray(steps)) {
                const beforePlan = remaining.slice(0, planMatch.index).trim();
                if (beforePlan)
                    proseParts.push(beforePlan);
                pendingPlan = {
                    steps,
                    label: 'План',
                    content: steps.map(s => s.description).filter(Boolean).join('; '),
                };
                remaining = remaining.slice(planMatch.index + planMatch[0].length);
            }
        } catch {}
    }

    // 3. <action> → метаданные кнопки панели (не отдельный пустой блок)
    const actionMatch = remaining.match(/<action>\s*(\{[\s\S]*?\})\s*<\/action>/);
    if (actionMatch) {
        try {
            const action = JSON.parse(actionMatch[1]);
            actionMeta = {
                label: action.label || action.text || 'OK',
                color: action.color || 'info',
                title: action.title || '',
            };
        } catch {}
        remaining = remaining.replace(/<action>[\s\S]*?<\/action>/g, '');
    }

    // 4. <questions> → метамодель полей для action (не отдельный тип form)
    let formFields = null;
    const questionsMatch = remaining.match(/<questions>\s*(\[[\s\S]*?\])\s*<\/questions>/);
    if (questionsMatch) {
        try {
            const questions = JSON.parse(questionsMatch[1]);
            if (Array.isArray(questions) && questions.length)
                formFields = questions.map(normalizeFieldMeta);
        } catch {}
        remaining = remaining.replace(/<questions>[\s\S]*?<\/questions>/g, '');
    }

    // 5. tool_call — не в ленту
    remaining = remaining.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    remaining = remaining.replace(/```tool_call[\s\S]*?```/g, '');

    // 6. Остаточный текст — prose для action или отдельный text
    const cleanText = remaining.trim();
    if (cleanText)
        proseParts.push(cleanText);

    const prose = proseParts.join('\n\n').trim();

    // 7. План / action / форма → один блок action (описание + fields + button)
    if (pendingPlan || actionMeta || formFields) {
        const steps = pendingPlan?.steps || null;
        const content = formatPlanMarkdown(steps, prose);
        const block = {
            type: 'action',
            title: pendingPlan ? '' : (actionMeta?.title || ''),
            content: content || prose || (formFields ? 'Заполните поля' : 'Подтвердите действие'),
            button: {
                label: actionMeta?.label || (pendingPlan ? 'Начать' : (formFields ? 'Продолжить' : 'OK')),
                color: actionMeta?.color || 'success',
            },
            time,
            sender,
        };
        if (formFields)
            block.fields = formFields;
        blocks.push(block);
    } else if (prose) {
        blocks.push({ type: 'text', content: prose, time, sender });
    }

    return { blocks, pendingPlan };
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
    if (q.value !== undefined)
        field.value = q.value;
    return field;
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
        } catch {}
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
            } catch {}
        }
    }

    // 3. XML-теги — сверка с доступными функциями (динамически)
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

/**
 * Загрузить readme.md из метапапке класса (если существует).
 * @param {object} storage — элемент $class
 * @returns {Promise<string>} — содержимое readme.md или пустая строка
 */
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

/**
 * Получить геолокацию по IP через ip-api.com.
 * @returns {Promise<string>} — "Местоположение пользователя: Москва\n" или пустая строка
 */
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