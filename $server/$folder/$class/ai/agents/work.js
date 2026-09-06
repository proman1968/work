/** Агент work: файлы рабочей области. Меню = ключи tools (plan/do).
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat }).
 *  approve стоп-блока выполняет владелец ленты (task) — там доступен params.task. */
const searchTool = {
    label: 'Ищу',
    icon: 'icons:search',
    role: 'user',
    description: 'поиск файлов в области, путь неизвестен',
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const query = workQuery(b, params.box, params.messages, searchTool.label);
        if (query)
            b.label = query;
        const result = await params.exec(WORK, { method: 'semantic_search', args: { prompt: query } }, { block: b });
        if (!b.content)
            b.content = formatFileHits(result);
        return true;
    },
};

const readTool = {
    label: 'Читаю файл',
    icon: 'icons:description',
    role: 'user',
    description: 'текст файла по известному пути',
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const path = filePath(b, params.box, readTool.label);
        const file = await resolveFile(path);
        if (!file)
            throw new Error('read: файл не найден: ' + path);
        await params.exec(file, {
            method: 'read_text',
            args: { session: params.session },
        }, { block: b });
        return true;
    },
};

const writeTool = {
    label: 'Записываю файл',
    icon: 'editor:mode-edit',
    description: 'записать или править файл',
    system: [
        '# Режим: запись файла',
        'Пиши только путь и содержимое из контекста ленты (сообщения пользователя, уже прочитанные файлы).',
        'Не выдумывай путь и не выдумывай тело файла. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Первая строка — путь файла в WORK.',
        'Дальше полный текст или блоки SEARCH/REPLACE — только из контекста, без заглушек.',
        'Не выдумывай путь и содержимое.',
    ].join('\n'),
    async recalc(params = {}) {
        const { block } = params;
        const raw = String(block.content || '').replace(/\r\n/g, '\n');
        const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
        const head = (fence ? raw.slice(0, fence.index) : raw).trim().split('\n').find(Boolean) || '';
        block.path = head.replace(/^#+\s*/, '').trim();
        block.post = fence ? fence[1].trim() : raw.split('\n').slice(1).join('\n').trim();
        if (block.done || !block.path || block.post == null)
            return;
        try {
            const edit = /SEARCH|REPLACE/.test(block.post);
            const session = params.session;
            const file = await resolveFile(block.path);
            if (file) {
                // существующий $file: save/edit на элементе (не WORK.save — это class.js)
                await params.exec(file, {
                    method: edit ? 'edit' : 'save',
                    args: { post: block.post, session },
                }, { block });
            }
            else if (edit) {
                throw new Error('write/edit: файл не найден: ' + block.path);
            }
            else {
                // новый файл: parent.save_file({ filename, post })
                const { parent, filename } = await resolveParent(block.path);
                await params.exec(parent, {
                    method: 'save_file',
                    args: { filename, post: block.post, session },
                }, { block });
            }
            block.done = true;
        }
        catch (e) {
            if (!block.error) {
                block.error = true;
                block.content = (block.content || '') + String(e.message || e);
            }
            throw e;
        }
    },
    async init(params = {}) {
        if (params.block.done)
            return false;
        return true;
    },
};

const activationTool = {
    label: 'Требуется режим исполнения',
    icon: 'icons:check-box-outline-blank',
    description: 'нужен write файлов области; html в ленте и обзор — без этого',
    prompt: `После активации появится право менять файлы рабочей области (write).
Обзор, html в ленте и чтение файлов доступны и без активации.
[instruction]
Расскажи, какие файлы собираешься изменить. Ничего не пиши, пока пользователь не подтвердит.
`,
    stop: 'Перейти к действиям',
    async approve(params = {}) {
        (await params.task.body).mode = 'do';
        params.block.icon = 'icons:check-circle';
    },
};

export default {
    label: 'Работаю c системой',
    icon: 'icons:folder',
    description: 'факты или файлы рабочей области',
    system: 'Подумай, какие именно действия над файлами необходимо выполнить.',
    prompt: `Проведи анализ текущего этапа работы с файлами и сформируй подробный отчёт о его результатах.`,
    /** После итога — обратно в plan (право write разовое); успешный write закрывает goal сессии. */
    finish(params = {}) {
        const live = params.live;
        if (live && live.mode === 'do')
            live.mode = 'plan';
        const items = params.block?.items || [];
        if (items.some(b => b.type === 'write' && b.done && !b.error))
            live?.goalDone?.();
    },
    plan: {
        description: 'факты или файлы рабочей области, в контексте их нет',
        system: [
            'Площадка work: файлы рабочей области только читать (search, read).',
            'Чтобы писать или менять файлы — ACTIVATION (после подтверждения появится write).',
            'Нет операнда для действия (путь, содержимое) — не выдумывай и не собирай его репликой внутри work.',
            'Недостающий факт у человека — зафиксируй в итоге; спросит оркестратор (question). Иначе действуй по данным из ленты.',
            'Подумай, какие именно действия над файлами необходимы.',
        ].join('\n'),
        tools: {
            activation: activationTool,
            search: searchTool,
            read: readTool,
        },
    },
    do: {
        description: 'действия над файлами области',
        system: [
            'Площадка work: можно менять файлы рабочей области (write).',
            'write только с путём и содержимым из контекста ленты — без заглушек и выдуманного текста.',
            'Нет операнда — не выдумывай; недостающее у человека выносится наружу (question оркестратора), не answer.',
            'Подумай, какие именно действия над файлами необходимы.',
        ].join('\n'),
        tools: {
            search: searchTool,
            read: readTool,
            write: writeTool,
        },
    },
};

function formatFileHits(result) {
    const items = Array.isArray(result) ? result : [];
    if (!items.length)
        return 'Ничего не найдено';
    return items.map(r => {
        const path = r.path || r.name || '';
        const extra = r.line != null ? ':' + r.line : '';
        const snip = r.text ? ' — ' + String(r.text).trim().slice(0, 200) : '';
        return '- ' + path + extra + snip;
    }).join('\n');
}

function workQuery(block, box, messages, defaultLabel) {
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel)
        return label;
    return String(box?.brief || lastUserContent(messages) || '').trim();
}

function filePath(block, box, defaultLabel) {
    const own = String(block?.path || '').trim();
    if (own)
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel && label.includes('/'))
        return label;
    const found = (box?.items || []).findLast?.(b => b.type === 'search' && b.content)
        || [...(box?.items || [])].reverse().find(b => b.type === 'search' && b.content);
    const hit = String(found?.content || '').match(/[/][^\s:]+/);
    return hit ? hit[0] : '';
}

/** $file по пути WORK; не файл / нет — null. */
async function resolveFile(path) {
    path = String(path || '').trim();
    if (!path)
        return null;
    const item = await WORK.get_item(path);
    return item && typeof item.read_text === 'function' ? item : null;
}

/** Родитель + имя файла для save_file (создание). */
async function resolveParent(path) {
    path = String(path || '').trim();
    const i = path.lastIndexOf('/');
    const filename = (i >= 0 ? path.slice(i + 1) : path).trim();
    const parentPath = i > 0 ? path.slice(0, i) : '/';
    if (!filename)
        throw new Error('write: нет имени файла в пути: ' + path);
    const parent = await WORK.get_item(parentPath);
    if (!parent || typeof parent.save_file !== 'function')
        throw new Error('write: нельзя создать файл в ' + parentPath);
    return { parent, filename };
}

function lastUserContent(messages) {
    if (!messages?.length)
        return '';
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user' && typeof messages[i].content === 'string' && messages[i].content)
            return String(messages[i].content);
    }
    return '';
}
