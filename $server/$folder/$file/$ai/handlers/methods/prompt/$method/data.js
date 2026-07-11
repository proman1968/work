/**
 * Серверный метод prompt для task.ai.
 *
 * Вызывается из ai-preview — при отправке сообщения внутри микрочата.
 *
 * URL: /path/to/task.ai?prompt  (POST с текстом в теле)
 *
 * Формат task.ai:
 *   {
 *     title: "Заголовок",
 *     created: ...,
 *     system: "...",
 *     model: "...",           — выбранная модель (необязательно)
 *     chat: [
 *       { role: "user", content: "...", time: ..., sender: "uid" },
 *       { role: "assistant", content: "...", time: ..., sender: "WORK" }
 *     ]
 *   }
 *
 * Что делает:
 * 1. Загружает тело task.ai
 * 2. Добавляет новое user сообщение в chat[]
 * 3. Находит провайдер $provider в /models/
 * 4. Собирает историю из chat[] (role + content напрямую)
 * 5. Вызывает streamChat handler — стримит токены через WebSocket
 * 6. Добавляет assistant сообщение с полным ответом
 * 7. Записывает обновлённое тело task.ai
 *
 * this = { $item: handlerItem, $context: taskAi }
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

export default {
    async execute(params = {}, post) {
        const taskAi = this.$context;
        if (!taskAi)
            throw new Error('task.ai не найден в контексте');

        // 0. Разобрать входящие данные — текст или JSON {text, model}
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

        // 1. Загрузить тело task.ai
        const body = await loadTaskBody(taskAi);
        if (!body)
            throw new Error('Не удалось загрузить тело task.ai');

        // Обновить модель, если передана в запросе
        if (requestModel)
            body.model = requestModel;

        // 2. Добавить новое user сообщение
        const sender = params.user?.uid || params.user?.$user?.id || 'unknown';
        const now = Date.now();

        body.chat ??= [];
        body.chat.push({
            role: 'user',
            content: text,
            time: now,
            sender: sender,
        });

        const fullPath = taskAi.path?.startsWith('/') ? taskAi.path : '/' + (taskAi.path || taskAi.short);

        // 3. Найти модель — body.model (выбранная в dropdown) или первую доступную
        const modelPath = body.model || await findModel();
        if (!modelPath) {
            console.log("[task.ai] нет модели");
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

        const messages = buildHistoryFromChat(body);

        let fullResponse = "";
        try {
            const { execItemMethod } = await import(pathToFileURL(path.join(ROOT, "sources/host/http-server.js")).href);
            const stream = await execItemMethod(model, "streamChat", { messages });
            for await (const token of stream) {
                fullResponse += token;
                WORK.wsSend?.({ type: "chat.delta", path: fullPath, token });
            }
        } catch (e) {
            console.warn("[task.ai] streamChat error:", e.message);
            body.chat.push({ role: "assistant", content: "Ошибка: " + e.message, time: Date.now(), sender: "WORK", model: body.model || model.id || "unknown", error: true });
            await writeTaskBody(fullPath, body);
            notifyChanged(fullPath);
            WORK.wsSend?.({ type: "chat.error", path: fullPath, error: e.message });
            return { ok: false, error: e.message };
        }

        body.chat.push({ role: "assistant", content: fullResponse, time: Date.now(), sender: "WORK", model: body.model || model.id || "unknown" });
        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
        WORK.wsSend?.({ type: "chat.done", path: fullPath });
        return { ok: true };
    },
};

/**
 * Загрузить тело task.ai (JSON из файла).
 */
async function loadTaskBody(taskAi) {
    try {
        const raw = await taskAi.load({ encoding: 'utf-8' });
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
        console.warn('[task.ai] loadTaskBody:', e.message);
        return null;
    }
}

/**
 * Записать тело task.ai (прямая запись через fsp).
 */
async function writeTaskBody(fullPath, body) {
    try {
        await fsp.writeFile(path.join(ROOT, fullPath), JSON.stringify(body, null, 4), 'utf-8');
    } catch (e) {
        console.warn('[task.ai] writeTaskBody:', e.message);
    }
}

/**
 * Уведомить клиентов об изменении файла.
 */
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

/**
 * Собрать историю сообщений из chat[] task.ai.
 * Формат: {role, content} — берётся напрямую.
 * Поддержка старого формата: {prompt, agent[]} — prompt→user, agent→assistant.
 */
function buildHistoryFromChat(body) {
    const messages = [];

    // System prompt
    if (body.system)
        messages.push({ role: 'system', content: body.system });

    const chat = body.chat || [];
    for (const entry of chat) {
        if (entry.role === 'user' && entry.content) {
            messages.push({ role: 'user', content: entry.content });
        } else if (entry.role === 'assistant' && entry.content) {
            messages.push({ role: 'assistant', content: entry.content });
        } else if (entry.prompt) {
            // Старый формат
            messages.push({ role: 'user', content: entry.prompt });
            for (const agentPath of (entry.agent || [])) {
                messages.push({ role: 'assistant', content: agentPath });
            }
        }
    }
    return messages;
}

/**
 * Найти первую доступную модель $ai из дерева WORK.
 * WORK.children → элемент типа $ai → info({deep:-1}) → первый крайний элемент.
 */
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

/** Рекурсивно найти первый крайний элемент в дереве info */
function findFirstLeaf(node) {
    if (!node) return null;
    const items = node.items;
    if (!items?.length) return node;
    return findFirstLeaf(items[0]);
}
