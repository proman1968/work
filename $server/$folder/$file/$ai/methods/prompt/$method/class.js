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

        // === 4. Загрузка модели ===
        if (requestModel)
            body.model = requestModel;

        const { findFirstModel } = await import(pathToFileURL(path.join(ROOT, 'sources/modules/ai-schema.js')).href);
        const modelPath = body.model || await findFirstModel();
        if (!modelPath) {
            body.ribbon.push({
                role: 'assistant',
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

        // === 6. Проверка текста (только для обычного промпта) ===
        if (!text && confirm === undefined)
            throw new Error('Текст промпта пуст');

        // === 7. Добавление user-сообщения и обработка плана ===
        if (text) {
            // Проверка дублирования: если последний user-блок содержит тот же текст — не добавляем
            const lastUser = [...body.ribbon].reverse().find(b => b.role === 'user');
            const isDuplicate = lastUser && lastUser.content === text
                && (Date.now() - (lastUser.time || 0)) < 10000;
            if (!isDuplicate) {
                body.ribbon.push({ role: 'user', content: text, time: Date.now(), sender });
            }

            // Подтверждение плана через текст → создать task
            const lastBlock = [...body.ribbon].reverse().find(b => b.type === 'block' && b.steps && b.action);
            if (lastBlock && !lastBlock.confirmed) {
                const confirmWords = ['начать', 'да', 'продолжить', 'ок', 'подтвердить', 'принять'];
                if (confirmWords.some(w => text.toLowerCase().includes(w))) {
                    lastBlock.confirmed = true;
                    body.ribbon.push({ type: 'task', label: lastBlock.content || 'Задача', steps: lastBlock.steps, state: 'active', ribbon: [], time: Date.now(), sender });
                    ribbonTarget = body.ribbon[body.ribbon.length - 1].ribbon;
                }
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
                    ribbonTarget.push({ role: 'assistant', content: 'Ошибка: ' + e.message, time: Date.now(), sender: model.path || 'WORK', error: true });
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: e.message });
                    return { ok: false, error: e.message };
                }

                lastResponse = fullResponse;

                // Разбор ответа на типизированные блоки
                const blocks = parseResponseToRibbon(fullResponse, model.path || 'WORK');
                for (const block of blocks) {
                    if (block.function_call === true && hasNativeFunctionCall) {
                        block.function_call = nativeToolCalls.map(c => ({
                            name: c.method,
                            arguments: c.args,
                        }));
                    }
                    ribbonTarget.push(block);
                }

                // Обновление плана: блок с шагами от модели
                const planBlock = blocks.find(b => b.type === 'block' && b.steps);
                if (planBlock) {
                    // Если есть активная задача — обновляем шаги в ней
                    const activeTask = [...body.ribbon].reverse().find(b => b.type === 'task' && b.state === 'active');
                    if (activeTask) {
                        activeTask.steps = planBlock.steps;
                        // Проверка завершения: все шаги выполнены
                        const allDone = planBlock.steps.every(s => s.status === 'done');
                        if (allDone) {
                            activeTask.state = 'completed';
                            // Кнопка «Принять» для итогового результата
                            ribbonTarget.push({
                                type: 'action',
                                label: 'Принять',
                                color: 'success',
                                time: Date.now(),
                                sender: model.path || 'WORK',
                            });
                            WORK.wsSend?.({ type: 'chat.plan_completed', path: wsPath });
                        }
                    }
                    WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: planBlock.steps });
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
                role: 'assistant',
                content: 'Превышен лимит итераций. Последний ответ:\n' + lastResponse.slice(0, 2000),
                time: Date.now(),
                sender: model.path || 'WORK',
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
    const chatEntry = {
        type: 'tool_result',
        label: '🔧 ' + call.method,
        content: resultStr.slice(0, 32000),
        tool: call.method,
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
 * - {role:'user'} → user message
 * - {type:'text'} → накапливается как assistant content
 * - {type:'details'} → пропускается (мысли не отправляются)
 * - {type:'block', steps} → <plan>[...]</plan>
 * - {type:'form'} → пропускается (форма уже отправлена как user)
 * - {type:'tool_result'} → function/user message с результатом
 * - {type:'task'} → рекурсивный обход вложенной ленты
 *
 * @param {object} body — тело task.ai (с ribbon, system, context и т.д.)
 * @param {boolean} useFunctionCalling — использовать нативный формат function calling
 * @returns {Array} — массив сообщений для streamChat
 */
function buildHistoryFromRibbon(body, useFunctionCalling = false) {
    const messages = [];

    // 1. System prompt: базовый + контекст + память + readme + план
    let systemContent = body.system || '';
    if (body.context)
        systemContent += '\n\n## Текущий контекст\n' + body.context;
    if (body.mem)
        systemContent += '\n\n## Память (.mem)\n' + body.mem;
    if (body.readme)
        systemContent += '\n\n## Описание класса (readme.md)\n' + body.readme;
    if (systemContent)
        messages.push({ role: 'system', content: systemContent });

    // 2. Обход блоков ленты
    const ribbon = body.ribbon || [];
    let pendingAssistant = '';

    for (const entry of ribbon) {
        // Сообщение пользователя
        if (entry.role === 'user' && entry.content) {
            if (pendingAssistant) {
                messages.push({ role: 'assistant', content: pendingAssistant });
                pendingAssistant = '';
            }
            messages.push({ role: 'user', content: entry.content });
            continue;
        }

        // Текстовый блок ассистента — накапливаем
        if (entry.type === 'text' && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        // Мысли (details) — пропускаем, не отправляем модели
        if (entry.type === 'details')
            continue;

        // План (block + steps) — отправляем как <plan>...</plan>
        if (entry.type === 'block' && entry.steps) {
            if (pendingAssistant) {
                messages.push({ role: 'assistant', content: pendingAssistant });
                pendingAssistant = '';
            }
            messages.push({ role: 'assistant', content: '<plan>' + JSON.stringify(entry.steps) + '</plan>' });
            continue;
        }

        // Блок с контентом (block + content) — накапливаем
        if (entry.type === 'block' && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        // Форма (form) — пропускаем, ответы уже отправлены как user
        if (entry.type === 'form')
            continue;

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

        // Вложенная задача (task) — рекурсивный обход
        if (entry.type === 'task') {
            if (pendingAssistant) {
                messages.push({ role: 'assistant', content: pendingAssistant });
                pendingAssistant = '';
            }
            messages.push(...buildHistoryFromRibbon({ ribbon: entry.ribbon, system: '' }, useFunctionCalling));
        }
    }

    // Остаточный накапливаемый текст
    if (pendingAssistant)
        messages.push({ role: 'assistant', content: pendingAssistant });

    return messages;
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
 * Извлекает: reasoning, plan, action, questions, tool_call, текст.
 * @param {string} text — полный ответ ИИ
 * @param {string} sender — идентификатор модели
 * @returns {Array} — массив блоков { type, content, time, sender, ... }
 */
function parseResponseToRibbon(text, sender = 'WORK') {
    const blocks = [];
    const time = Date.now();
    if (!text)
        return blocks;

    let remaining = text;

    // 1. <reasoning>...</reasoning> → details
    const reasoningMatches = [...remaining.matchAll(/<reasoning>([\s\S]*?)<\/reasoning>/g)];
    for (const m of reasoningMatches) {
        blocks.push({ type: 'details', label: 'Мысли', content: m[1].trim(), time, sender });
    }
    remaining = remaining.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '');

    // 2. <plan>[...]</plan> → block с steps
    const planMatch = remaining.match(/<plan>\s*(\[[\s\S]*?\])\s*<\/plan>/);
    if (planMatch) {
        try {
            const steps = JSON.parse(planMatch[1]);
            if (Array.isArray(steps)) {
                const beforePlan = remaining.slice(0, planMatch.index).trim();
                if (beforePlan)
                    blocks.push({ type: 'text', content: beforePlan, time, sender });
                blocks.push({ type: 'block', steps, action: true, content: steps[0]?.description || 'План', time, sender });
                remaining = remaining.slice(planMatch.index + planMatch[0].length);
            }
        } catch {}
    }

    // 3. <action>{...}</action> → action (кнопка да/нет)
    const actionMatch = remaining.match(/<action>\s*(\{[\s\S]*?\})\s*<\/action>/);
    if (actionMatch) {
        try {
            const action = JSON.parse(actionMatch[1]);
            blocks.push({ type: 'action', label: action.label || 'OK', color: action.color || 'info', time, sender });
        } catch {}
        remaining = remaining.replace(/<action>[\s\S]*?<\/action>/g, '');
    }

    // 4. <questions>[...]</questions> → form
    const questionsMatch = remaining.match(/<questions>\s*(\[[\s\S]*?\])\s*<\/questions>/);
    if (questionsMatch) {
        try {
            const questions = JSON.parse(questionsMatch[1]);
            if (Array.isArray(questions))
                blocks.push({ type: 'form', questions, time, sender });
        } catch {}
        remaining = remaining.replace(/<questions>[\s\S]*?<\/questions>/g, '');
    }

    // 5. <tool_call>...</tool_call> — не сохраняем в блоки (вызываются отдельно)
    remaining = remaining.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    remaining = remaining.replace(/```tool_call[\s\S]*?```/g, '');

    // 6. Очистка и остаточный текст
    const cleanText = remaining.trim();
    if (cleanText)
        blocks.push({ type: 'text', content: cleanText, time, sender });

    return blocks.length ? blocks : [{ type: 'text', content: '', time, sender }];
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