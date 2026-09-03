/** Агент work: файлы рабочей области. Меню = ключи tools (plan/do). */
const searchTool = {
    label: 'Ищу',
    icon: 'icons:search',
    role: 'user',
    description: 'поиск файлов в области, путь неизвестен',
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const query = workQuery(b, await params.task.body, searchTool.label);
        if (query)
            b.label = query;
        const result = await params.task._fc_exec(WORK, { method: 'semantic_search', args: { prompt: query } }, {
            block: b,
            session: params.session,
        });
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
        const path = filePath(b, await params.task.body, readTool.label);
        await params.task._fc_exec(WORK, { method: 'read_text', args: { path } }, {
            block: b,
            session: params.session,
        });
        return true;
    },
};

const writeTool = {
    label: 'Записываю файл',
    icon: 'editor:mode-edit',
    description: 'записать или править файл',
    system: [
        '# Режим: запись файла',
        'Пиши только путь и содержимое. Не выдумывай путь. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Первая строка — путь файла в WORK.',
        'Дальше полный текст или блоки SEARCH/REPLACE.',
        'Не выдумывай путь.',
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
        const method = /SEARCH|REPLACE/.test(block.post) ? 'edit' : 'save';
        await params.task._fc_exec(WORK, { method, args: { path: block.path, post: block.post } }, {
            block,
            session: params.session,
        });
        block.done = true;
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
    plan: {
        description: 'факты или файлы рабочей области, в контексте их нет',
        system: [
            'Площадка work: файлы рабочей области только читать (search, read).',
            'Чтобы писать или менять файлы — ACTIVATION (после подтверждения появится write).',
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

function workQuery(block, body, defaultLabel) {
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel)
        return label;
    return String((body.items || []).find(b => b.type === 'prompt')?.content || body.title || '').trim();
}

function filePath(block, body, defaultLabel) {
    const own = String(block?.path || '').trim();
    if (own)
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel && label.includes('/'))
        return label;
    let found;
    const walk = (n) => {
        if (n?.type === 'search' && n.content)
            found = n;
        for (const c of n?.items || [])
            walk(c);
    };
    walk(body);
    const hit = String(found?.content || '').match(/[/][^\s:]+/);
    return hit ? hit[0] : '';
}
