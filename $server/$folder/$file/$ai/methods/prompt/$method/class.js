/**
 * Серверный метод prompt для task.ai — контекстный harness цикл tool-call.
 * this = task.ai файл (передаётся через tryHandlerMethod → execute.call(item))
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const MAX_ITERATIONS = 10;

export default {
    async execute(params = {}, post) {
        const taskAi = params.$context || this;
        if (!taskAi || !taskAi.load)
            throw new Error('task.ai не найден в контексте');

        let text = '';
        let requestModel = '';
        let actMode = false;
        const raw = post ?? params.text ?? params.post ?? '';
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                text = String(parsed.text ?? '').trim();
                requestModel = String(parsed.model ?? '').trim();
                actMode = parsed.act === true;
            } catch {
                text = String(raw).trim();
            }
        } else {
            text = String(raw).trim();
        }
        if (!text)
            throw new Error('Текст промпта пуст');

        const body = await loadTaskBody(taskAi);
        if (!body)
            throw new Error('Не удалось загрузить тело task.ai');

        if (requestModel)
            body.model = requestModel;

        const sender = params.user?.uid || params.user?.$user?.id || 'unknown';
        body.chat ??= [];
        body.chat.push({
            role: 'user',
            content: text,
            time: Date.now(),
            sender: sender,
        });

        const fullPath = taskAi.path?.startsWith('/') ? taskAi.path : '/' + (taskAi.path || taskAi.short);
        // Короткий путь для WS-сообщений (клиент хранит элементы по short)
        const wsPath = taskAi.short || fullPath;
        const initialContext = taskAi.$class || taskAi.$parent;
        if (!initialContext)
            throw new Error('Не определено классе-контекст для task.ai');

        const memContent = await loadMemFiles(initialContext);
        const readmeContent = await loadReadme(initialContext);
        const contextInfo = await buildContextInfo(initialContext, params.user);
        body.context = contextInfo;
        body.mem = memContent;
        body.readme = readmeContent;

        const modelPath = body.model || await findModel();
        if (!modelPath) {
            body.chat.push({
                role: "assistant",
                content: "Нет доступной модели.",
                time: Date.now(),
                sender: "WORK",
                error: true,
            });
            await writeTaskBody(fullPath, body);
            notifyChanged(fullPath);
            WORK.wsSend?.({ type: "chat.error", path: wsPath, error: "Нет модели" });
            return { ok: true, model: false };
        }
        const model = await WORK.get_item(modelPath);
        if (!model) throw new Error("Модель не найдена: " + modelPath);

        const { execItemMethod } = await import(pathToFileURL(path.join(ROOT, "sources/host/http-server.js")).href);
        const maxIter = body.maxIterations || MAX_ITERATIONS;

        // Пользователь от лица модели — для логов действий ИИ
        const modelLabel = model.label || model.path?.split('/').pop() || 'AI';
        const aiUser = { uid: modelLabel, $user: params.user?.$user || params.user, isAI: true };

        let iteration = 0;
        let currentContext = initialContext;
        let lastResponse = '';

        while (iteration < maxIter) {
            iteration++;
            const messages = buildHistoryFromChat(body);

            let fullResponse = "";
            try {
                const stream = await execItemMethod(model, "streamChat", { messages, $ai: model });
                for await (const token of stream) {
                    fullResponse += token;
                    WORK.wsSend?.({ type: "chat.delta", path: wsPath, token });
                }
            } catch (e) {
                console.warn("[task.ai] streamChat error:", e.message);
                body.chat.push({ role: "assistant", content: "Ошибка: " + e.message, time: Date.now(), sender: model.path || 'WORK', error: true });
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
                WORK.wsSend?.({ type: "chat.error", path: wsPath, error: e.message });
                return { ok: false, error: e.message };
            }

            lastResponse = fullResponse;
            body.chat.push({ role: "assistant", content: fullResponse, time: Date.now(), sender: model.path || 'WORK' });

            // Извлекаем план из ответа ИИ
            const plan = parsePlan(fullResponse);
            if (plan) {
                body.plan = plan;
                WORK.wsSend?.({ type: "chat.plan", path: wsPath, plan });
            }

            const toolCalls = parseToolCalls(fullResponse);

            if (toolCalls.length === 0) {
                break;
            }

            // Режим Plan/Act: проверяем, есть ли опасные методы
            if (!actMode) {
                const hasDangerous = toolCalls.some(call => isDangerousMethod(call.method));
                if (hasDangerous) {
                    body.chat.push({
                        role: "assistant",
                        content: "⚠️ Для выполнения действий (создание, изменение, удаление) нажмите кнопку **run** и повторите запрос.",
                        time: Date.now(),
                        sender: model.path || 'WORK',
                    });
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    WORK.wsSend?.({ type: "chat.ready_to_act", path: wsPath });
                    WORK.wsSend?.({ type: "chat.done", path: wsPath });
                    return { ok: true, iterations: iteration, needsAct: true };
                }
            }

            for (const call of toolCalls) {
                let result;
                try {
                    if (call.method === 'get_property' && call.args?.name) {
                        const propName = call.args.name;
                        const descriptor = Object.getOwnPropertyDescriptor(currentContext.constructor.prototype, propName);
                        if (descriptor?.get) {
                            result = descriptor.get.call(currentContext);
                            if (result && typeof result === 'object' && typeof result.then === 'function') {
                                result = await result;
                            }
                        } else {
                            result = currentContext[propName];
                            if (result && typeof result === 'object' && typeof result.then === 'function') {
                                result = await result;
                            }
                        }
                    } else if (call.method === 'set_property' && call.args?.name) {
                        const propName = call.args.name;
                        const value = call.args.value;
                        const descriptor = Object.getOwnPropertyDescriptor(currentContext.constructor.prototype, propName);
                        if (descriptor?.set) {
                            descriptor.set.call(currentContext, value);
                            result = { success: true, message: `Свойство ${propName} установлено` };
                        } else {
                            currentContext[propName] = value;
                            result = { success: true, message: `Свойство ${propName} установлено` };
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

                // Специальные методы навигации — обрабатываем до сохранения результата
                if (call.method === 'navigate' && call.args?.path) {
                    const targetPath = String(call.args.path);
                    const target = await WORK.get_item(targetPath);
                    if (target && target.path) {
                        currentContext = target;
                        result = { success: true, message: 'Переход в контекст: ' + target.path };
                        // Автоматически получить схему нового контекста
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
                    currentContext = initialContext;
                    result = { success: true, message: 'Контекст сброшен к классу: ' + initialContext.path };
                }

                const resultPreview = typeof result === 'string' ? result.slice(0, 2000) : JSON.stringify(result).slice(0, 2000);
                WORK.wsSend?.({ type: "chat.tool_result", path: wsPath, tool: call.method, result: resultPreview });

                const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                const chatEntry = {
                    role: "tool_result",
                    content: resultStr.slice(0, 32000),
                    tool: call.method,
                    time: Date.now(),
                    sender: model.path || 'WORK',
                };
                // Сохраняем путь файла для показа карточки в UI
                if (result?.resultPath)
                    chatEntry.resultPath = result.resultPath;
                body.chat.push(chatEntry);

                // Авто-смена контекста, если метод вернул $item
                if (result && typeof result === 'object' && result.path && result.type && !call.method.startsWith('navigate') && call.method !== 'reset_context') {
                    currentContext = result;
                }
            }

            await writeTaskBody(fullPath, body);
        }

        if (iteration >= maxIter && lastResponse) {
            body.chat.push({
                role: "assistant",
                content: "Превышен лимит итераций. Последний ответ:\n" + lastResponse.slice(0, 2000),
                time: Date.now(),
                sender: model.path || 'WORK',
                error: true,
            });
        }

        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
        WORK.wsSend?.({ type: "chat.done", path: wsPath });
        return { ok: true, iterations: iteration };
    },
};

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
            if (item?.reset) item.reset();
            else WORK.wsSend?.({ path: fullPath });
        });
    } catch {
        WORK.wsSend?.({ path: fullPath });
    }
}

function buildHistoryFromChat(body) {
    const messages = [];
    let systemContent = body.system || '';
    if (body.context)
        systemContent += '\n\n## Текущий контекст\n' + body.context;
    if (body.mem)
        systemContent += '\n\n## Память (.mem)\n' + body.mem;
    if (body.readme)
        systemContent += '\n\n## Описание класса (readme.md)\n' + body.readme;
    if (body.plan)
        systemContent += '\n\n## Текущий план\n' + JSON.stringify(body.plan, null, 2);
    if (systemContent)
        messages.push({ role: 'system', content: systemContent });

    const chat = body.chat || [];
    for (const entry of chat) {
        if (entry.role === 'user' && entry.content) {
            messages.push({ role: 'user', content: entry.content });
        } else if (entry.role === 'assistant' && entry.content) {
            messages.push({ role: 'assistant', content: entry.content });
        } else if (entry.role === 'tool_result' && entry.content) {
            let content = entry.content;
            const hints = {
                'get_schema': '\nИспользуй список properties и methods для выбора следующего действия.',
                'get_property': '\nПолучено значение свойства. Можешь использовать set_property для изменения.',
                'navigate': '\nТы перешёл в новый контекст. Используй доступные методы и свойства для выполнения задачи.',
                'reset_context': '\nТы вернулся в домашнее классе.',
            };
            const hint = hints[entry.tool] || '';
            if (entry.tool === 'get_property' || entry.tool === 'get_schema' || entry.tool === 'navigate') {
                content = 'Результат выполнения:\n' + entry.content.slice(0, 5000);
            }
            messages.push({ role: 'user', content: content + hint });
        } else if (entry.prompt) {
            messages.push({ role: 'user', content: entry.prompt });
            for (const agentPath of (entry.agent || [])) {
                messages.push({ role: 'assistant', content: agentPath });
            }
        }
    }
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

async function findModel() {
    try {
        const children = await WORK.children;
        const aiRoot = children?.find(el => el.type === '$ai');
        if (!aiRoot) return null;
        const tree = await aiRoot.info({ deep: -1 });
        return findFirstLeaf(tree)?.path || null;
    } catch (e) {
        console.warn('[task.ai] findModel:', e.message);
    }
    return null;
}

function findFirstLeaf(node) {
    if (!node) return null;
    const items = node.items;
    if (!items?.length) return node;
    return findFirstLeaf(items[0]);
}

function parseToolCalls(text) {
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

    return calls;
}

// Методы, безопасные в режиме диалога (Plan) — только чтение и навигация
const SAFE_METHODS = new Set([
    'get_schema', 'get_property', 'navigate', 'reset_context',
    'read_file', 'info', 'children', 'files', 'folders', 'items',
]);

/**
 * Проверить, требует ли метод режим Act (создание/изменение/удаление).
 * @param {string} method — имя метода
 * @returns {boolean} — true, если метод опасный (требует подтверждения)
 */
function isDangerousMethod(method) {
    if (SAFE_METHODS.has(method))
        return false;
    // set_property, write_file, create, delete, save, edit_file и др. — опасные
    return true;
}

/**
 * Извлечь план из ответа ИИ (формат <plan>[...]</plan>).
 * Формат: <plan>[{"step": 1, "description": "...", "status": "pending"}]</plan>
 * @param {string} text — ответ ИИ
 * @returns {Array|null} — массив шагов плана или null
 */
function parsePlan(text) {
    if (!text)
        return null;
    const match = text.match(/<plan>\s*(\[[\s\S]*?\])\s*<\/plan>/);
    if (!match)
        return null;
    try {
        const plan = JSON.parse(match[1]);
        if (Array.isArray(plan))
            return plan;
    } catch {}
    return null;
}

/**
 * Загрузить readme.md из метапапки класса (если существует).
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