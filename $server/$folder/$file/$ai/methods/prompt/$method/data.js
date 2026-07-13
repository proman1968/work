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
        const raw = post ?? params.text ?? params.post ?? '';
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                text = String(parsed.text ?? '').trim();
                requestModel = String(parsed.model ?? '').trim();
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
        const initialContext = taskAi.$storage || taskAi.$parent;
        if (!initialContext)
            throw new Error('Не определено хранилище-контекст для task.ai');

        const memContent = await loadMemFiles(initialContext);
        const contextInfo = await buildContextInfo(initialContext, params.user);
        body.context = contextInfo;
        body.mem = memContent;

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

            const toolCalls = parseToolCalls(fullResponse);

            if (toolCalls.length === 0) {
                break;
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

                const resultPreview = typeof result === 'string' ? result.slice(0, 2000) : JSON.stringify(result).slice(0, 2000);
                WORK.wsSend?.({ type: "chat.tool_result", path: wsPath, tool: call.method, result: resultPreview });

                const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                body.chat.push({
                    role: "tool_result",
                    content: resultStr.slice(0, 32000),
                    tool: call.method,
                    time: Date.now(),
                    sender: model.path || 'WORK',
                });

                if (result && typeof result === 'object' && result.path && result.type) {
                    currentContext = result;
                }

                if (call.method === 'reset_context') {
                    currentContext = initialContext;
                    result = { success: true, message: 'Контекст сброшен к хранилищу: ' + initialContext.path };
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
            };
            const hint = hints[entry.tool] || '';
            if (entry.tool === 'get_property' || entry.tool === 'get_schema') {
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