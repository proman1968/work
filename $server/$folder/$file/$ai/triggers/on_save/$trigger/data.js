import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

const SYSTEM_PROMPT = `Ты — ИИ-агент в системе WORK — файло-ориентированной веб-платформе.
WORK — контекстная система. Каждое действие происходит в контексте конкретного хранилища ($storage).
Ты получаешь задачу от пользователя и действуешь от его прав.

## Принцип работы
контекст → метод → результат.
Результат может быть новым контекстом (если метод возвращает $item) или просто данными.

## Доступные инструменты
Ты вызываешь методы текущего контекста. Чтобы узнать доступные методы:
1. Вызови get_schema — получишь список методов и свойств класса.
2. Вызови info — получишь структуру элемента и его дочерние элементы.

## Формат tool-call
Для вызова метода напиши в ответе:

<tool_call>
{"method": "имя_метода", "args": {"параметр": "значение"}}
</tool_call>

Метод вызывается у текущего контекста. Не указывай path — ты работаешь там, где находишься.
Если метод возвращает элемент (папку/файл), он становится новым контекстом для следующих вызовов.

## Правила
1. Отвечай кратко, по делу, на русском.
2. Сначала изучи контекст (get_schema, info), потом действуй.
3. Не более 10 tool-call итераций на задачу.
4. Файлы .mem — твоя долговременная память.`;

export default {
    label: 'on_save (.ai)',
    icon: 'carbon:ai',
    async execute(params = {}) {
        const storage = this;
        const taskPath = params.logFullPath || params.logPath;
        if (!taskPath) return;

        let body;
        try {
            body = typeof params.post === 'string' ? JSON.parse(params.post) : params.post;
        } catch { return; }

        const title = String(body?.title ?? '').trim();
        let firstPrompt = '';
        if (body?.chat?.[0]?.role === 'user') {
            firstPrompt = String(body.chat[0].content ?? '').trim();
        } else {
            firstPrompt = String(body?.chat?.[0]?.prompt ?? title).trim();
        }
        if (!firstPrompt) return;

        const hasAssistant = body?.chat?.some?.(m => m.role === 'assistant');
        const hasOldAgent = body?.chat?.[0]?.agent?.length;
        if (hasAssistant || hasOldAgent) return;

        const now = Date.now();
        const sender = params.user?.uid || params.user?.$user?.id || params.sender || 'unknown';

        body = {
            title: title,
            created: body.created || now,
            system: body.system || SYSTEM_PROMPT,
            chat: [{ role: 'user', content: firstPrompt, time: now, sender: sender }],
        };

        const modelPath = await findModel();
        if (modelPath) {
            body.model = modelPath;
        }
        if (!modelPath) {
            console.log('[ai] нет модели');
            body.chat.push({ role: 'assistant', content: 'Нет доступной модели. Добавьте $ai в WORK.', time: Date.now(), sender: 'WORK', error: true });
            await writeTaskBody(taskPath, body);
            notifyChanged(taskPath);
            WORK.wsSend?.({ type: 'chat.error', path: taskPath, error: 'Нет модели' });
            return;
        }
        const model = await WORK.get_item(modelPath);
        if (!model) return;

        const messages = [{ role: 'system', content: body.system }, { role: 'user', content: firstPrompt }];
        let fullResponse = '';
        try {
            const { execItemMethod } = await import(pathToFileURL(path.join(ROOT, "sources/host/http-server.js")).href);
            const stream = await execItemMethod(model, 'streamChat', { messages });
            for await (const token of stream) {
                fullResponse += token;
                WORK.wsSend?.({ type: 'chat.delta', path: taskPath, token });
            }
        } catch (e) {
            body.chat.push({ role: 'assistant', content: 'Ошибка: ' + e.message, time: Date.now(), sender: 'WORK', error: true });
            await writeTaskBody(taskPath, body);
            notifyChanged(taskPath);
            WORK.wsSend?.({ type: 'chat.error', path: taskPath, error: e.message });
            return;
        }

        body.chat.push({ role: 'assistant', content: fullResponse, time: Date.now(), sender: 'WORK', model: model.id || 'unknown' });
        await writeTaskBody(taskPath, body);
        notifyChanged(taskPath);
        WORK.wsSend?.({ type: 'chat.done', path: taskPath });
    },
};

async function saveResponseFile(taskPath, filename, content) {
    try {
        const taskFile = await WORK.get_item(taskPath);
        if (!taskFile) return null;
        const sf = taskFile.storage_folder;
        if (!sf) return null;
        const log = await sf.save_file({ filename, post: content, encoding: 'utf-8', user: WORK, sender: 'AI', ignore_save_logs: true });
        return log?.logFullPath || log?.path || null;
    } catch (e) { console.warn('[ai] saveResponseFile:', e.message); return null; }
}

async function writeTaskBody(taskPath, body) {
    try {
        await fsp.writeFile(path.join(ROOT, taskPath), JSON.stringify(body, null, 4), 'utf-8');
    } catch (e) { console.warn('[ai] writeTaskBody:', e.message); }
}

function notifyChanged(taskPath) {
    try {
        WORK.get_item(taskPath).then(item => { if (item?.reset) item.reset(); else WORK.wsSend?.({ path: taskPath }); });
    } catch { WORK.wsSend?.({ path: taskPath }); }
}

/**
 * Найти модель $ai для нового task.ai.
 * WORK.children → элемент типа $ai → info({deep:-1}) → первый крайний элемент.
 */
async function findModel() {
    try {
        const children = await WORK.children;
        const aiRoot = children?.find(el => el.type === '$ai');
        if (!aiRoot) return null;
        // info({deep:-1}) — полное дерево; ищем первый крайний элемент
        const tree = await aiRoot.info({ deep: -1 });
        return findFirstLeaf(tree)?.path || null;
    } catch (e) { console.warn('[ai] findModel:', e.message); }
    return null;
}

/** Рекурсивно найти первый крайний элемент в дереве info */
function findFirstLeaf(node) {
    if (!node) return null;
    const items = node.items;
    if (!items?.length) return node;
    return findFirstLeaf(items[0]);
}
