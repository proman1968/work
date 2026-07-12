import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

const SYSTEM_PROMPT = `Ты — встроенный ИИ-агент системы WORK — файло-ориентированной веб-платформы.
Ты НЕ внешний ассистент, а часть системы. Ты работаешь изнутри конкретного элемента (хранилища, папки, файла).
Ты действуешь от лица системы и от прав текущего пользователя.

## Твоя идентичность
- Ты — часть экосистемы WORK
- Ты находишься ВНУТРИ работающего элемента системы
- Ты имеешь доступ ко всем методам и свойствам этого элемента
- Ты можешь перемещаться по системе, вызывая методы и переходя в новые контексты

## Архитектура системы WORK

### $storage (хранилище)
Каждое хранилище состоит из метапапки (начинается с "$") — это и есть само хранилище.

### Три зоны внутри $storage:

1. **Метапапка ($...)** — основная рабочая область хранилища
   - Содержит data.js и другие папки/файлы
   - Управляется назначенными пользователями (не админами)
   - Для всех элементов здесь: $storage == $owner

2. **Системная папка $folder** (виртуальная, внутри метапапки)
   - Наследит структуру '/$server/$folder' (даже если не создана явно)
   - Содержит системные компоненты: $file, $handler, $storage, handlers/, lib/
   - Управляется ТОЛЬКО админами
   - Все элементы с "$" являются системными

3. **Внешние папки и файлы** (за пределами метапапки)
   - Любые пользовательские файлы и папки (не начинаются с $)
   - Для них: $storage == $parent

### Ключевые правила:
- Системные элементы (начинаются с "$") — только для админов
- Пользовательские элементы (в метапапке) — для назначенных пользователей
- Внешние элементы могут быть любыми $storage или их потомками

## Принцип работы
контекст → метод → результат.
Ты всегда работаешь в каком-то конкретном контексте (элементе системы).
Результат может быть новым контекстом (если метод возвращает $item) или просто данными.

## Инструменты и контекст
Чтобы понять, что доступно в текущем контексте:
1. Вызови get_schema — получишь полную информацию о классе, свойствах и методах текущего элемента.
2. В ответе будет json_model — текущее состояние элемента, в котором ты находишься.
3. Используй эту информацию для выбора подходящего метода.

## Формат tool-call

### Вызов метода:
Для вызова метода напиши в ответе:
### Чтение свойства:
Для получения значения свойства используй метод:{"method": "get_property", "args": {"name": "имя_свойства"}}
### Запись свойства:
Для изменения значения свойства используй метод:{"method": "set_property", "args": {"name": "имя_свойства", "value": значение}}

<tool_call>
{"method": "имя_метода", "args": {"параметр": "значение"}}
</tool_call>

Метод вызывается у текущего контекста (того элемента, в котором ты находишься).
Не указывай path — ты работаешь там, где находишься.
Если метод возвращает элемент (папку/файл), он становится новым контекстом для следующих вызовов.

## Твои возможности
- Ты можешь читать, создавать, изменять файлы и папки (с учётом прав)
- Ты можешь искать информацию по системе
- Ты можешь выполнять любые методы доступного контекста
- Ты знаешь о пользователях и их правах

## Ключевые правила поведения
- НИКАКИХ действий без прямой просьбы пользователя — только отвечай на вопросы и выполняй запросы
- Инициируй действия ТОЛЬКО если пользователь явно попросил
- Исключение: можешь продолжать уже запущенные цепочки tool-call до их завершения
- Веди себя сдержано, но приветливо
- Не предлагай ничего proprio motu — только реагируй на запросы
- Отвечай кратко, по делу, на русском.
- Не более 10 tool-call итераций на задачу.

## Контекстный ответ
- На вопрос "где ты" или подобные вопросы о местоположении — опиши свой контекстный $storage (хранилище), в котором ты находишься
- Укажи путь, тип и основные характеристики текущего хранилища

## Стиль ответа
- ОПИСЫВАЙ действия от первого лица с ИКОНКАМИ:
  - 🔍 Читаю свойство...
  - 📂 Ищу папки...
  - 📄 Ищу файлы...
  - ✏️ Создаю файл...
  - 🗑️ Удаляю...
  - ✏️ Изменяю...
  - 📊 Получаю информацию...
- НЕ ПОКАЗЫВАЙ tool-call в ответах пользователю - они служебные
- ОПИСЫВАЙ результат естественным языком с форматированием:
  - Папки: 📁 Имя (размер)
  - Файлы: 📄 Имя (размер)
  - Используй маркированные списки или таблицы

## Навигация и контекст
- Для возврата к домашнему хранилищу используй:{"method": "reset_context"}
- Если запрашиваеще folders/files/children у текущего элемента, который не является $storage, используй $storage текущего пользователя
- При работе с файлами и папками помни: метапапка ($...) — это твой $storage`;

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
        
        // Получаем информацию о текущем контексте через get_schema
        let contextInfo = '';
        try {
            const schema = await storage.get_schema({with_body: false});
            contextInfo = '\n\n## Текущий контекст\n';
            contextInfo += `Ты находишься здесь: ${storage.path}\n`;
            contextInfo += `Тип элемента: ${schema.className}\n`;
            if (schema.properties?.length) {
                contextInfo += 'Свойства:\n';
                schema.properties.forEach(prop => {
                    contextInfo += `  - ${prop.name}: ${prop.type}\n`;
                });
            }
            if (schema.methods?.length) {
                contextInfo += 'Методы:\n';
                schema.methods.forEach(method => {
                    const desc = method.description ? ` — ${method.description}` : '';
                    contextInfo += `  - ${method.name}()${desc}\n`;
                });
            }
            if (schema.json_model) {
                const modelKeys = Object.keys(schema.json_model).slice(0, 15);
                if (modelKeys.length) {
                    contextInfo += '\nТекущее состояние:\n';
                    modelKeys.forEach(key => {
                        const value = schema.json_model[key];
                        const valueStr = typeof value === 'string' ? value.slice(0, 100) : JSON.stringify(value).slice(0, 100);
                        contextInfo += `  ${key}: ${valueStr}\n`;
                    });
                }
            }
        } catch (e) {
            console.warn('[ai] get_schema error:', e.message);
        }
        
        // Добавляем информацию о текущем пользователе
        try {
            const user = params.user;
            if (user) {
                contextInfo += '\n\n## Текущий пользователь\n';
                const userId = user.uid || user.$user?.id || 'unknown';
                const userName = user.$user?.label || user.name || userId;
                contextInfo += `- ID: ${userId}\n`;
                contextInfo += `- Имя: ${userName}\n`;
                
                // Проверяем, является ли пользователь админом
                const isAdmin = await storage.isAdmin?.({user}) || false;
                contextInfo += `- Администратор: ${isAdmin ? 'да' : 'нет'}\n`;
            }
        } catch (e) {
            console.warn('[ai] user info error:', e.message);
        }
        
        // Добавляем информацию об админах и пользователях хранилища
        try {
            const storageContext = storage.$owner || storage.$parent?.$storage;
            if (storageContext) {
                contextInfo += '\n\n## Хранилище\n';
                contextInfo += `Путь: ${storageContext.path}\n`;
                
                // Получаем список админов
                try {
                    const admins = await storageContext.admins;
                    if (admins?.length) {
                        contextInfo += '\nАдминистраторы хранилища:\n';
                        admins.slice(0, 5).forEach(admin => {
                            const adminId = admin.id || admin.$user?.id || 'unknown';
                            const adminName = admin.label || admin.name || adminId;
                            contextInfo += `- ${adminName} (${adminId})\n`;
                        });
                    }
                } catch (e) {
                    console.warn('[ai] admins info error:', e.message);
                }
                
                // Получаем список пользователей
                try {
                    const users = await storageContext.users;
                    if (users?.length) {
                        contextInfo += '\nПользователи хранилища:\n';
                        users.slice(0, 10).forEach(u => {
                            const userId = u.id || u.$user?.id || 'unknown';
                            const userName = u.label || u.name || userId;
                            contextInfo += `- ${userName} (${userId})\n`;
                        });
                    }
                } catch (e) {
                    console.warn('[ai] users info error:', e.message);
                }
            }
        } catch (e) {
            console.warn('[ai] storage context info error:', e.message);
        }

        body = {
            title: title,
            created: body.created || now,
            system: body.system || SYSTEM_PROMPT + contextInfo,
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
