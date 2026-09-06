/** Агент work: файлы рабочей области. Меню = ключи tools (plan/do).
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat }).
 *  Строение WORK — explore; интернет — web. approve стоп-блока — владелец ленты (task).
 *  search — только внутри уже выбранного класса (не корень WORK). */

const AGENT_TAG = 'Файлы';

const searchTool = {
    label: 'Ищу',
    icon: 'icons:search',
    role: 'user',
    allowReasoning: true,
    description: 'semantic_search внутри уже выбранного класса; не корень WORK и не строение площадки',
    system: [
        '# Режим: поиск файлов в классе',
        'Первая строка — путь класса WORK (не «/», не корень площадки).',
        'Дальше текст запроса для поиска внутри этого класса.',
        'Без выбранного класса не выдумывай корень WORK — строение площадки делает explore.',
        'Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь класса и запрос.',
        'Пример:',
        '/USERS/CA4E097FF6C1D387',
        'конфиг моделей в задаче',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        tagAgent(params.box, AGENT_TAG, 'поиск…');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done)
            return;
        const { path, query } = parseSearch(b, params.box, params.messages, searchTool.label);
        if (!path || !query || isWorkRootPath(path)) {
            if (!String(b.content || '').trim())
                return;
            b.error = true;
            b.content = 'search: нужен путь класса (не корень WORK) и запрос';
            return;
        }
        const target = await WORK.get_item(path);
        if (!target || typeof target.semantic_search !== 'function' || isWorkRootItem(target)) {
            b.error = true;
            b.content = 'search: класс не найден или это корень WORK: ' + path;
            return;
        }
        b.path = path;
        b.label = path + (query ? ': ' + clip(query, 40) : '');
        tagAgent(params.box, AGENT_TAG, 'ищу в ' + path);
        const result = await params.exec(target, {
            method: 'semantic_search',
            args: { prompt: query },
        }, { block: b });
        b.content = formatFileHits(result);
        b.done = true;
    },
};

const readTool = {
    label: 'Читаю файл',
    icon: 'icons:description',
    role: 'user',
    description: 'текст файла по пути из ленты',
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const path = filePath(b, params.box, readTool.label);
        if (!path)
            return false;
        const file = await resolveFile(path);
        if (!file)
            return false;
        b.path = path;
        b.label = path;
        tagAgent(params.box, AGENT_TAG, 'читаю ' + path);
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
    allowReasoning: true,
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
        if (block.path)
            tagAgent(params.box, AGENT_TAG, 'запись ' + block.path);
        if (block.done || !block.path || block.post == null)
            return;
        try {
            const edit = /SEARCH|REPLACE/.test(block.post);
            const session = params.session;
            const file = await resolveFile(block.path);
            if (file) {
                await params.exec(file, {
                    method: edit ? 'edit' : 'save',
                    args: { post: block.post, session },
                }, { block });
            }
            else if (edit) {
                throw new Error('write/edit: файл не найден: ' + block.path);
            }
            else {
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
        tagAgent(params.box, AGENT_TAG, 'запись…');
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
    async init(params = {}) {
        tagAgent(params.box, AGENT_TAG, 'нужен режим do');
        return true;
    },
    async approve(params = {}) {
        (await params.task.body).mode = 'do';
        params.block.icon = 'icons:check-circle';
    },
};

export default {
    label: 'Работаю с файлами',
    icon: 'icons:folder',
    allowReasoning: true,
    description: 'файлы по пути: read/write; search только внутри уже выбранного класса; не строение WORK, не журнал (history/.logs — агент logs), не список моделей/сервисов',
    system: [
        '# Агент: work',
        'Файлы рабочей области. Строение площадки (модели, сервисы, классы) — explore; интернет — web; журнал класса — logs.',
        'Не читай …/logs/.data.logs/history/… через read/search — это logs ($class.logs / read_log_entry).',
        'search — только внутри выбранного класса (путь + запрос); не semantic_search по корню WORK.',
        'Подумай, какие именно действия над файлами необходимы.',
    ].join('\n'),
    prompt: `Проведи анализ текущего этапа работы с файлами и сформируй подробный отчёт о его результатах.`,
    async init(params = {}) {
        const brief = String(params.block?.brief || '').trim();
        if (brief)
            tagAgent(params.block, AGENT_TAG, clip(brief, 48));
    },
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
        description: 'чтение и поиск файлов внутри класса; write — после activation',
        system: [
            'Площадка work: search (путь класса + запрос) и read файлов.',
            'search не по корню WORK — сначала класс (часто через explore).',
            'Activation только если нужен write.',
            'Нет операнда для действия (путь, содержимое) — не выдумывай.',
            'Недостающий факт у человека — зафиксируй в итоге; спросит оркестратор (question).',
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
            'search — внутри выбранного класса, не корень WORK.',
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

/** Шапка бокса агента: «Файлы: /path» — чем и где. */
function tagAgent(box, role, detail) {
    if (!box)
        return;
    const d = String(detail || '').trim();
    box.label = d ? role + ': ' + d : role;
}

function clip(s, n) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

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

/** Путь класса + запрос для search (не корень WORK). */
function parseSearch(block, box, messages, defaultLabel) {
    const raw = String(block?.content || '').replace(/\r\n/g, '\n').trim();
    let path = String(block?.path || '').trim();
    let query = '';
    if (raw) {
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const head = (lines[0] || '').replace(/^#+\s*/, '').trim();
        if (!path && head.startsWith('/')) {
            path = head;
            query = lines.slice(1).join('\n').trim();
        }
        else if (path)
            query = raw;
        else
            query = raw;
    }
    if (!path) {
        const label = String(block?.label || '').trim();
        if (label && label !== defaultLabel && label.startsWith('/')) {
            const cut = label.indexOf(':');
            path = (cut > 0 ? label.slice(0, cut) : label).trim();
            if (!query && cut > 0)
                query = label.slice(cut + 1).trim();
        }
    }
    const brief = String(box?.brief || lastUserContent(messages) || '').trim();
    if (!query)
        query = brief;
    if ((!path || !query) && brief) {
        const m = brief.match(/^(\/[^\s]+)\s+([\s\S]+)$/);
        if (m) {
            path = path || m[1];
            query = query || m[2].trim();
        }
    }
    return { path: String(path || '').trim(), query: String(query || '').trim() };
}

function isWorkRootPath(path) {
    const p = String(path || '').trim().replace(/\/+$/, '') || '/';
    return p === '/' || p === '' || p === String(WORK?.path || '').replace(/\/+$/, '');
}

function isWorkRootItem(item) {
    if (!item || !WORK)
        return false;
    if (item === WORK)
        return true;
    try {
        return typeof Reactor?.equal === 'function' && Reactor.equal(item, WORK);
    }
    catch {
        return false;
    }
}

function filePath(block, box, defaultLabel) {
    const own = String(block?.path || '').trim();
    if (own)
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel && label.includes('/'))
        return label.split(':')[0].trim();
    const found = (box?.items || []).findLast?.(b => b.type === 'search' && b.content)
        || [...(box?.items || [])].reverse().find(b => b.type === 'search' && b.content);
    const hit = String(found?.content || '').match(/[/][^\s:]+/);
    return hit ? hit[0] : '';
}

async function resolveFile(path) {
    path = String(path || '').trim();
    if (!path)
        return null;
    const item = await WORK.get_item(path);
    return item && typeof item.read_text === 'function' ? item : null;
}

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
