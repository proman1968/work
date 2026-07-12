/**
 * Серверный метод prompt для task.ai — контекстный harness цикл tool-call.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const MAX_ITERATIONS = 10;

export default {
    async execute(params = {}, post) {
        const taskAi = this.$context;
        if (!taskAi)
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
        const initialContext = taskAi.$storage || taskAi.$parent;
        if (!initialContext)
            throw new Error('Не определено хранилище-контекст для task.ai');

        const memContent = await loadMemFiles(initialContext);
        const contextInfo = await buildContextInfo(initialContext, params.user);
        body.system = buildSystemPrompt(contextInfo, memContent, body.system);

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
            WORK.wsSend?.({ type: "chat.error", path: fullPath, error: "Нет модели" });
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
                const stream = await execItemMethod(model, "streamChat", { messages });
                for await (const token of stream) {
                    fullResponse += token;
                    WORK.wsSend?.({ type: "chat.delta", path: fullPath, token });
                }
            } catch (e) {
                console.warn("[task.ai] streamChat error:", e.message);
                body.chat.push({ role: "assistant", content: "Ошибка: " + e.message, time: Date.now(), sender: "WORK", error: true });
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
                WORK.wsSend?.({ type: "chat.error", path: fullPath, error: e.message });
                return { ok: false, error: e.message };
            }

            lastResponse = fullResponse;
            body.chat.push({ role: "assistant", content: fullResponse, time: Date.now(), sender: "WORK" });

            const toolCalls = parseToolCalls(fullResponse);

            if (toolCalls.length === 0) {
                break;
            }

            for (const call of toolCalls) {
                let result;
                try {
                    // Обработка get_property и set_property
                    if (call.method === 'get_property' && call.args?.name) {
                        const propName = call.args.name;
                        const descriptor = Object.getOwnPropertyDescriptor(currentContext.constructor.prototype, propName);
                        if (descriptor?.get) {
                            result = descriptor.get.call(currentContext);
                        } else {
                            result = currentContext[propName];
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
                WORK.wsSend?.({ type: "chat.tool_result", path: fullPath, tool: call.method, result: resultPreview });

                const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                body.chat.push({
                    role: "tool_result",
                    content: resultStr.slice(0, 32000),
                    tool: call.method,
                    time: Date.now(),
                    sender: "WORK",
                });

                if (result && typeof result === 'object' && result.path && result.type) {
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
                sender: "WORK",
                error: true,
            });
        }

        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
        WORK.wsSend?.({ type: "chat.done", path: fullPath });
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
    if (body.system)
        messages.push({ role: 'system', content: body.system });

    const chat = body.chat || [];
    for (const entry of chat) {
        if (entry.role === 'user' && entry.content) {
            messages.push({ role: 'user', content: entry.content });
        } else if (entry.role === 'assistant' && entry.content) {
            messages.push({ role: 'assistant', content: entry.content });
        } else if (entry.role === 'tool_result' && entry.content) {
            const hints = {
                'get_schema': '\nИспользуй список properties и methods для выбора следующего действия.',
                'get_property': '\nПолучено значение свойства. Можешь использовать set_property для изменения.',
            };
            const hint = hints[entry.tool] || '';
            messages.push({ role: 'user', content: 'Результат ' + entry.tool + ':\n' + entry.content + hint });
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
    
    // Добавляем информацию о текущем пользователе
    if (user?.uid || user?.$user?.id) {
        const userId = user.uid || user.$user.id;
        const userName = user.$user?.label || user.name || userId;
        info += '\nТекущий пользователь:\n';
        info += '- ID: ' + userId + '\n';
        info += '- Имя: ' + userName + '\n';
        
        // Проверяем, является ли пользователь админом
        try {
            const isAdmin = await context.isAdmin?.({user}) || false;
            info += '- Администратор: ' + (isAdmin ? 'да' : 'нет') + '\n';
        } catch (e) {
            // Игнорируем ошибки при проверке прав
        }
    }
    
    // Добавляем информацию об админах и пользователях хранилища
    try {
        const storageContext = context.$storage || context.$parent?.$storage;
        if (storageContext) {
            info += '\nХранилище: ' + storageContext.path + '\n';
            
            try {
                const admins = await storageContext.admins;
                if (admins?.length) {
                    info += '\nАдминистраторы хранилища:\n';
                    admins.slice(0, 5).forEach(admin => {
                        const adminId = admin.id || admin.$user?.id || 'unknown';
                        const adminName = admin.label || admin.name || adminId;
                        info += '- ' + adminName + ' (' + adminId + ')\n';
                    });
                }
            } catch (e) {
                // Игнорируем ошибки
            }
            
            try {
                const users = await storageContext.users;
                if (users?.length) {
                    info += '\nПользователи хранилища:\n';
                    users.slice(0, 10).forEach(u => {
                        const userId = u.id || u.$user?.id || 'unknown';
                        const userName = u.label || u.name || userId;
                        info += '- ' + userName + ' (' + userId + ')\n';
                    });
                }
            } catch (e) {
                // Игнорируем ошибки
            }
        }
    } catch (e) {
        // Игнорируем ошибки при получении информации о хранилище
    }
    
    return info;
}

function buildSystemPrompt(contextInfo, memContent, existingSystem) {
    let prompt = existingSystem || 'Ты - ИИ в системе WORK.\n\n' +
        'Для списка папок: <tool>{"method": "folders"}```\n' +
        'Для списка файлов: <tool>{"method": "files"}```\n\n' +
        'Отвечай кратко на русском.';

    prompt += '\n\nТекущий контекст: ' + contextInfo;
    if (memContent)
        prompt += '\n\nПамять (.mem):\n' + memContent;

    return prompt;
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

    const tagRegex = /<tool\s*([\s\S]*?)\s*(?:<\/tool_call>|```)/g;
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
        } catch { /* битый JSON */ }
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
            } catch { /* битый JSON */ }
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