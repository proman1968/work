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
    role: 'user',
    /** несколько write в одном work — не жечь тип в using_blocks */
    ignore: true,
    allowReasoning: true,
    description: 'записать или править файл (не новый класс — для класса create)',
    system: [
        '# Режим: запись файла',
        'Пиши только путь и содержимое из контекста ленты (сообщения пользователя, уже прочитанные файлы).',
        'Новый класс WORK (ребёнок провайдера $ai и т.п.) — tool create, не write и не save_file в несуществующий $ai/.',
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

/** Новый дочерний класс у родителя: $class.create (не save_file). */
const createTool = {
    label: 'Создаю класс',
    icon: 'icons:create-new-folder',
    role: 'user',
    /** несколько create в одном work (оставшиеся модели) — не жечь тип в using_blocks */
    ignore: true,
    allowReasoning: true,
    description: 'дочерний класс у родителя ($class.create): тип, id, class.js; не write файла',
    system: [
        '# Режим: create класса',
        'Строки: путь родителя; тип ($ai / $class / …); id узла; опционально label; затем class.js в fence.',
        'id — имя узла WORK без «:» и без пути (тег API — поле model внутри class.js).',
        'Подключение модели к провайдеру: родитель /MODELS/<Provider>, тип $ai, class.js по образцу соседа (read), не новый файл с двоеточием в имени.',
        'Не выдумывай post — бери из эталона в ленте. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь родителя, тип, id, [label], class.js.',
        'Пример:',
        '/MODELS/BIS-Ollama',
        '$ai',
        'Llama3.2 3b',
        'Llama3.2 3b',
        '```js',
        'export default {',
        "    icon: 'ai:llama3',",
        "    label: 'Llama3.2 3b',",
        "    model: 'llama3.2:3b',",
        '    maxTokens: 131072,',
        "    capabilities: ['chat', 'stream', 'functions'],",
        '}',
        '```',
    ].join('\n'),
    async init(params = {}) {
        if (params.block.done)
            return false;
        tagAgent(params.box, AGENT_TAG, 'create…');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done)
            return;
        const parsed = parseCreate(b);
        if (!parsed.parent || !parsed.type || !parsed.id) {
            if (!String(b.content || '').trim())
                return;
            b.error = true;
            b.content = 'create: нужны путь родителя, тип ($…) и id класса';
            return;
        }
        if (parsed.id.includes(':') || parsed.id.includes('/')) {
            b.error = true;
            b.content = 'create: id без «:» и «/» (тег API — в class.js как model), сейчас: ' + parsed.id;
            return;
        }
        if (!parsed.post) {
            b.error = true;
            b.content = 'create: нужен class.js (fence или тело после заголовка)';
            return;
        }
        const parent = await WORK.get_item(parsed.parent);
        if (!parent || typeof parent.create !== 'function') {
            b.error = true;
            b.content = 'create: родитель не класс или нет create: ' + parsed.parent;
            return;
        }
        b.path = parsed.parent.replace(/\/$/, '') + '/' + parsed.id;
        b.label = b.path;
        const prior = (params.box?.items || []).some(x =>
            x !== b && x.type === 'create' && x.done && !x.error && x.path === b.path);
        if (prior) {
            b.content = '[create ' + b.path + ']\nalready in this work — stop или агент check';
            b.done = true;
            tagAgent(params.box, AGENT_TAG, 'create skip ' + b.path);
            return;
        }
        const exists = await WORK.get_item(b.path);
        if (exists) {
            b.content = '[create ' + b.path + ']\nalready exists — агент check, не create';
            b.done = true;
            tagAgent(params.box, AGENT_TAG, 'create exists ' + b.path);
            return;
        }
        tagAgent(params.box, AGENT_TAG, 'create ' + b.path);
        try {
            const args = {
                type: parsed.type,
                id: parsed.id,
                post: parsed.post,
                session: params.session,
            };
            if (parsed.label)
                args.label = parsed.label;
            await params.exec(parent, { method: 'create', args }, { block: b });
            b.content = formatCreateResult(parsed);
            b.done = true;
        }
        catch (e) {
            b.error = true;
            b.content = 'create: ' + String(e.message || e);
            throw e;
        }
    },
};

const activationTool = {
    label: 'Требуется режим исполнения',
    icon: 'icons:check-box-outline-blank',
    description: 'нужен write файлов или create классов; html в ленте и обзор — без этого',
    prompt: `После активации появится право менять область: write файлов и create дочерних классов.
Обзор, html в ленте и чтение доступны и без активации.
[instruction]
Кратко: что изменишь (пути файлов и/или какие классы создашь). Ничего не пиши и не создавай, пока пользователь не подтвердит.
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
    description: 'файлы и классы области: read/write/create; search внутри выбранного класса; строение WORK — explore; журнал — logs',
    system: [
        '# Агент: work',
        'Файлы и классы рабочей области. Строение площадки (модели, сервисы) — explore; интернет — web; журнал класса — logs.',
        'Не читай …/logs/.data.logs/history/… через read/search — это logs ($class.logs / read_log_entry).',
        'search — только внутри выбранного класса (путь + запрос); не semantic_search по корню WORK.',
        'Список моделей у провайдера (API/baseUrl) — explore meta+remote, не search в /SERVICES и не web.',
        'Подключить модель / новый класс у провайдера — create ($ai + class.js по образцу), не write «файла модели».',
        'Один id — один create в этом work; проверка что класс есть — агент check, не повторный create.',
        'Подумай, какие именно действия необходимы.',
    ].join('\n'),
    prompt: `Проведи анализ текущего этапа работы с файлами/классами и сформируй подробный отчёт о его результатах.`,
    async init(params = {}) {
        const brief = String(params.block?.brief || '').trim();
        if (brief)
            tagAgent(params.block, AGENT_TAG, clip(brief, 48));
    },
    /** После итога — обратно в plan. Закрытие goal — у check (постусловие). */
    finish(params = {}) {
        const live = params.live;
        if (live && live.mode === 'do')
            live.mode = 'plan';
    },
    plan: {
        description: 'чтение и поиск; write/create — после activation',
        system: [
            'Площадка work: search (путь класса + запрос) и read файлов.',
            'search не по корню WORK — сначала класс (часто через explore).',
            'Activation если нужен write или create класса.',
            'Подключение модели к провайдеру — create, не «новый файл».',
            'Нет операнда для действия — не выдумывай.',
            'Недостающий факт у человека — зафиксируй в итоге; спросит оркестратор (question).',
            'Подумай, какие именно действия необходимы.',
        ].join('\n'),
        tools: {
            activation: activationTool,
            search: searchTool,
            read: readTool,
        },
    },
    do: {
        description: 'write файлов и create классов области',
        system: [
            'Площадка work: write файлов и create дочерних классов.',
            'write — путь и содержимое из контекста; create — родитель + тип + id + class.js (не save_file вместо класса).',
            'Подключение модели: read sibling class.js → create $ai у провайдера (id без «:», model = тег API).',
            'Несколько недостающих классов — create каждого id по разу, затем stop; тот же path повторно — нельзя.',
            'После create цель не закрывай «на глаз» — оркестратор вызовет check.',
            'search — внутри выбранного класса, не корень WORK.',
            'Нет операнда — не выдумывай; недостающее у человека выносится наружу (question оркестратора), не answer.',
            'Подумай, какие именно действия необходимы.',
        ].join('\n'),
        tools: {
            search: searchTool,
            read: readTool,
            write: writeTool,
            create: createTool,
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

/** parent / type / id / [label] + post (fence или хвост). */
function parseCreate(block) {
    const raw = String(block?.content || '').replace(/\r\n/g, '\n');
    const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    const head = (fence ? raw.slice(0, fence.index) : raw).trim();
    const post = fence ? fence[1].trim() : '';
    const lines = head.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    let parent = '', type = '', id = '', label = '';
    for (const line of lines) {
        if (!parent && line.startsWith('/')) {
            parent = line.replace(/\/$/, '') || '/';
            continue;
        }
        if (!type && line.startsWith('$') && !line.includes(' ')) {
            type = line;
            continue;
        }
        if (!id) {
            id = line;
            continue;
        }
        if (!label && !line.startsWith('export') && !line.startsWith('{')) {
            label = line;
            continue;
        }
        break;
    }
    let body = post;
    if (!body && lines.length) {
        const start = lines.findIndex(l => l.startsWith('export') || l.startsWith('{'));
        if (start >= 0)
            body = lines.slice(start).join('\n').trim();
    }
    return { parent, type, id, label, post: body };
}

function formatCreateResult(parsed) {
    const path = String(parsed.parent || '').replace(/\/$/, '') + '/' + parsed.id;
    return [
        '[create ' + path + ']',
        'type: ' + parsed.type,
        parsed.label ? 'label: ' + parsed.label : '',
        'class.js: ok',
    ].filter(Boolean).join('\n');
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
