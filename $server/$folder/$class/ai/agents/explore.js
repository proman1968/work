/** Агент explore: осмотр площадки WORK (карта, ls/info, readme, ask, meta, remote). Без записи файлов.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat, engine }). */
const MAP_ROOT_LIMIT = 40;
const INFO_NODE_LIMIT = 200;

const ORIENTATION = [
    'Ориентация: площадка WORK — дерево классов. Карта и ls показывают только классы (не .git, не node_modules, не обычные папки/файлы).',
    'Факты о системе — только из блоков ленты (карта, ls, readme, ask, meta, remote); не из памяти и не через web.',
    'Ориентиры корня (компас, не ответ): /MODELS, /SERVICES, /USERS, зона группы/профиль, ~/ — мета текущего класса.',
    'Карта корня `/` — один уровень (компас веток).',
    'ls ветки (не `/`) — `info({ deep: -1 })`: сразу всё дерево до листьев; не останавливайся на именах контейнеров, если листья уже в блоке.',
    'Устройство item (baseUrl, protocol, …) — meta: class.js через meta_folder / tilde → importScript; не info/$public.',
    'Подключённые модели провайдера = дети /MODELS/<provider> (ls). Доступные у провайдера = remote (list_remote по baseUrl из meta), не ls и не публичный ollama.com.',
    '«Какие ещё не подключены» — ls детей + meta/remote того же провайдера, затем diff. ask «нет данных» — не итог.',
    'ask — вопрос классу (peer), не человеку; его «нет данных» ничего не решает — дальше ls + meta + remote провайдера и diff. «Недостающие модели <провайдер>» = есть в remote, нет среди детей (ls); это и есть критерий, человека не спрашивать.',
    'В отчёте (total) только то, что есть в items: не выдумывай ls/ask/readme/meta/remote, которых не было в ленте.',
].join('\n');

/** Подсказки запроса → корень с карты (компас пути, не «ответ найден»). */
const ROOT_HINTS = [
    [/модел/i, '/MODELS'],
    [/model/i, '/MODELS'],
    [/сервис/i, '/SERVICES'],
    [/service/i, '/SERVICES'],
    [/пользовател|юзер|users?/i, '/USERS'],
];

const askTool = {
    label: 'Спрашиваю класс',
    icon: 'icons:record-voice-over',
    role: 'user',
    allowReasoning: true,
    description: 'спросить $class через его prompt о своём содержимом',
    system: [
        '# Режим: ask класса',
        'Первая строка — путь класса WORK (узел домена или лист, не обязательно корень ветки).',
        'Дальше вопрос этому классу о его области.',
        'Не выдумывай ответ сам. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь класса и вопрос.',
        'Пример:',
        '/SERVICES/DuckDuckGo',
        'Что ты умеешь в этой системе?',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content && b.done)
            return false;
        const { path, question } = parseAsk(b, params.box, params.messages, askTool.label);
        if (!path || !question)
            return false;
        const target = await WORK.get_item(path);
        if (!isWorkClass(target))
            return false;
        const engine = params.engine;
        if (typeof engine?.execute !== 'function')
            return false;
        b.path = path;
        tagAgent(params.box, AGENT_TAG, 'ask ' + path);
        try {
            const result = await askClassPeer({
                target,
                engine,
                question,
                session: params.session,
                live: params.live,
            });
            b.content = formatAskResult(result, path);
            if (result?.error)
                b.error = true;
            b.done = true;
            return true;
        }
        catch (e) {
            b.error = true;
            b.content = 'ask ' + path + ': ' + String(e.message || e);
            return true;
        }
    },
};

const lsTool = {
    label: 'Смотрю каталог',
    icon: 'icons:folder-open',
    role: 'user',
    description: 'ветка: info deep=-1 (всё дерево); корень `/` — один уровень компаса',
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const query = exploreQuery(b, params.box, params.messages, lsTool.label);
        const path = classPath(b, params.box, lsTool.label)
            || pathFromMap(params.box, query)
            || await providerPathByName(query);
        if (!path)
            return false;
        b.path = path;
        const isRoot = path === '/' || path === '';
        tagAgent(params.box, AGENT_TAG, isRoot ? 'ls /' : 'info ' + path);
        const text = isRoot
            ? await listChildrenMap('/')
            : await listInfoDeep(path);
        if (!text)
            return false;
        b.content = text;
        return true;
    },
};

const readTool = {
    label: 'Читаю readme',
    icon: 'icons:description',
    role: 'user',
    description: 'readme.md класса по пути (компас узла)',
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const query = exploreQuery(b, params.box, params.messages, readTool.label);
        let path = classPath(b, params.box, readTool.label)
            || pathFromMap(params.box, query)
            || readmePathFromMap(params.box, query);
        if (!path)
            return false;
        let file = await resolveFile(path);
        if (!file) {
            const readme = path.replace(/\/$/, '') + '/readme.md';
            file = await resolveFile(readme);
            if (file)
                path = readme;
        }
        if (!file)
            return false;
        b.path = path;
        tagAgent(params.box, AGENT_TAG, 'readme ' + path);
        await params.exec(file, {
            method: 'read_text',
            args: { session: params.session },
        }, { block: b });
        return true;
    },
};

/** Устройство WORK item: meta_folder/class.js или tilde class.js → importScript (не info). */
const metaTool = {
    label: 'Устройство item',
    icon: 'icons:settings',
    role: 'user',
    description: 'метаданные class.js любого WORK item (класс или файл по типу): importScript; не info и не содержимое файла',
    system: [
        '# Режим: meta / устройство',
        'Первая строка — путь WORK item ($class или $file).',
        'Класс: meta_folder → class.js → importScript. Файл: tilde class.js типа (расширение) → importScript.',
        'Не путай с readme и с содержимым файла. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь item.',
        'Пример:',
        '/MODELS/BIS-Ollama',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const query = exploreQuery(b, params.box, params.messages, metaTool.label);
        let path = itemPath(b, params.box, metaTool.label, query);
        if (!path || path === '/')
            path = await providerPathByName(query);
        if (!path)
            return false;
        const target = await WORK.get_item(path);
        if (!target)
            return false;
        b.path = path;
        tagAgent(params.box, AGENT_TAG, 'meta ' + path);
        try {
            const device = await loadItemDevice(target);
            b.content = formatMetaResult(device, path);
            if (!device || device.error)
                b.error = true;
            return true;
        }
        catch (e) {
            b.error = true;
            b.content = 'meta ' + path + ': ' + String(e.message || e);
            return true;
        }
    },
};

/** Живой список моделей у $ai-провайдера (baseUrl → API), не дети WORK. */
const remoteTool = {
    label: 'Список у провайдера',
    icon: 'icons:cloud-circle',
    role: 'user',
    description: 'list_remote у $ai: модели на API провайдера по baseUrl (из meta/устройства); не ls детей WORK и не web',
    system: [
        '# Режим: remote провайдера',
        'Первая строка — путь класса провайдера $ai (например /MODELS/BIS-Ollama), не лист модели и не /MODELS.',
        'baseUrl берётся из устройства класса (meta), не из info. Не выдумывай URL. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь провайдера $ai.',
        'Пример:',
        '/MODELS/BIS-Ollama',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const path = resolveRemotePath(b, params.box, params.messages)
            || await providerPathByName(exploreQuery(b, params.box, params.messages, remoteTool.label));
        if (!path)
            return false;
        const target = await WORK.get_item(path);
        if (!isWorkClass(target))
            return false;
        if (typeof target.list_remote !== 'function')
            return false;
        b.path = path;
        tagAgent(params.box, AGENT_TAG, 'remote ' + path);
        try {
            let baseUrl = '';
            try {
                const device = await loadItemDevice(target);
                baseUrl = String(device?.baseUrl || '').trim();
            }
            catch { /* list_remote сам проверит */ }
            const result = await params.exec(target, {
                method: 'list_remote',
                args: baseUrl ? { baseUrl } : {},
            }, { block: b });
            b.content = formatRemoteResult(result, path, { baseUrl: baseUrl || target.baseUrl });
            if (result?.error)
                b.error = true;
            return true;
        }
        catch (e) {
            b.error = true;
            b.content = 'remote ' + path + ': ' + String(e.message || e);
            return true;
        }
    },
};

const AGENT_TAG = 'Осмотр';

export default {
    label: 'Осматриваю площадку',
    icon: 'icons:explore',
    doc: true,
    /** в контекст идут листья-факты (map/ls/meta/remote/ask, role user), не пересказ total — work.create проверяет model по ним */
    expand: true,
    allowReasoning: true,
    description: 'строение WORK: ls, meta (устройство class.js), remote у $ai; карта, readme, ask; не файлы и не интернет',
    system: [
        '# Агент: explore',
        'Осмотр площадки WORK. Карта корня уже в ленте.',
        ORIENTATION,
        'Не пиши файлы и не ходи в интернет — это work / web.',
        'Нет операнда (путь) — не выдумывай; зафиксируй в итоге. Имя провайдера в реплике (напр. bis-ollama) — это путь /MODELS/<провайдер> с карты.',
        'Вопрос про состав ветки — ls этой ветки (info deep=-1), не ask контейнера и не plan из пяти одинаковых ls.',
        'Неподключённые модели провайдера — meta/remote того же пути + diff с ls; не SERVICES и не web.',
    ].join('\n'),
    prompt: [
        'Отчёт об осмотре только по фактам из items ленты (карта, ls, readme, ask, meta, remote).',
        'Не описывай шаги, которых не было. Если в ls уже дерево deep=-1 — итог по листьям, не по одним контейнерам.',
        'Есть remote и ls одного провайдера — в итоге явный diff (на API, но нет в WORK).',
    ].join('\n'),
    /** Карта корня `/` в ленту и messages — компас до выбора tool. */
    async init(params = {}) {
        const { block, messages } = params;
        block.items ??= [];
        const brief = String(block.brief || '').trim();
        if (brief)
            tagAgent(block, AGENT_TAG, clip(brief, 48));
        else
            tagAgent(block, AGENT_TAG, 'карта /');
        if (block.items.some(b => b.type === 'map'))
            return;
        const text = await listRootMap();
        if (!text)
            return;
        const map = {
            type: 'map',
            label: 'Карта площадки',
            icon: 'icons:map',
            role: 'user',
            time: Date.now(),
            content: text,
        };
        block.items.push(map);
        if (messages)
            messages.push({ role: 'user', content: text });
    },
    tools: {
        ask: askTool,
        ls: lsTool,
        read: readTool,
        meta: metaTool,
        remote: remoteTool,
    },
};

/** Шапка бокса: type в block.type; итог — state. */
function tagAgent(box, _role, detail) {
    if (!box)
        return;
    const d = String(detail || '').trim();
    if (d)
        box.state = d;
}

function clip(s, n) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Путь класса + вопрос для ask. */
function parseAsk(block, box, messages, defaultLabel) {
    const raw = String(block?.content || '').replace(/\r\n/g, '\n').trim();
    let path = String(block?.path || '').trim();
    let question = '';
    if (raw) {
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const head = lines[0] || '';
        if (!path && head.startsWith('/')) {
            path = head.replace(/^#+\s*/, '').trim();
            question = lines.slice(1).join('\n').trim();
        }
        else if (path)
            question = raw;
        else
            question = raw;
    }
    if (!path) {
        const label = String(block?.label || '').trim();
        if (label && label !== defaultLabel && label.includes('/'))
            path = label;
    }
    const brief = String(box?.brief || lastUserContent(messages) || '').trim();
    if (!path)
        path = pathFromMap(box, brief) || pathFromMap(box, question);
    if (!question)
        question = brief;
    if ((!path || !question) && brief) {
        const m = brief.match(/^(\/[^\s]+)\s+([\s\S]+)$/);
        if (m) {
            path = path || m[1];
            question = question || m[2].trim();
        }
    }
    return { path: String(path || '').trim(), question: String(question || '').trim() };
}

/**
 * Peer-класс: движок вызывающего (engine) + Object.create + $context = target.
 * Агенты — из пакета движка; peer не обязан иметь ~/ai. Без live.wait.
 */
async function askClassPeer({ target, engine, question, session, live } = {}) {
    const eng = Object.create(engine);
    eng.$context = target;
    const peerLive = {
        path: live?.path || target.short,
        mode: 'plan',
        send: e => {
            if (live?.send)
                live.send(e);
            else
                session?.send?.(e);
        },
    };
    return eng.execute({
        prompt: question,
        session,
        agent: 'answer',
        live: peerLive,
    });
}

function formatAskResult(result, path) {
    if (!result)
        return 'ask ' + path + ': пустой ответ';
    const text = String(result.content || '').trim();
    if (result.error && !text)
        return 'ask ' + path + ': ошибка';
    const head = '[ask ' + path + ']';
    return text ? head + '\n' + text : head + '\n(пусто)';
}

function formatRemoteResult(result, path, target) {
    const head = '[remote ' + path + ']';
    const baseUrl = result?.baseUrl || target?.baseUrl || '';
    if (!result)
        return head + '\n(пусто)';
    if (result.error) {
        const tried = Array.isArray(result.tried) && result.tried.length
            ? '\ntried:\n- ' + result.tried.join('\n- ')
            : '';
        return head + '\nbaseUrl: ' + (baseUrl || '—') + '\n' + result.error + tried;
    }
    const models = Array.isArray(result.models) ? result.models : [];
    const lines = [
        head,
        'baseUrl: ' + (baseUrl || '—'),
        'source: ' + (result.source || '—'),
        'models (' + models.length + '):',
        ...models.map(m => '- ' + m),
    ];
    return lines.join('\n');
}

function formatMetaResult(device, path) {
    const head = '[meta ' + path + ']';
    if (!device)
        return head + '\n(пусто)';
    if (device.error)
        return head + '\n' + device.error;
    try {
        return head + '\n```json\n' + JSON.stringify(device, null, 2) + '\n```';
    }
    catch {
        return head + '\n(не сериализуется)';
    }
}

const SECRET_KEY = /^(apiKey|token|accessToken|password|secret|authorization|privateKey)$/i;

/** class: meta_file.importScript; file: tilde class.js типа → DATA после init. */
async function loadItemDevice(item) {
    if (!item)
        throw new Error('нет item');
    let data;
    const metaFile = await item.meta_file;
    if (metaFile && typeof metaFile.importScript === 'function') {
        data = await metaFile.importScript();
    }
    else if (typeof item.import === 'function' && isWorkClass(item)) {
        data = await item.import();
    }
    else {
        await item.init;
        data = item.DATA;
        if ((!data || typeof data !== 'object' || !Object.keys(data).length)
            && typeof item.tilde !== 'undefined') {
            const layers = ((await item.tilde) || []).filter(f => f?.id === 'class.js');
            if (layers.length && typeof $server?.mergeFiles === 'function') {
                const script = await $server.mergeFiles(layers);
                data = await item.constructor.importScript(script);
            }
        }
    }
    if (!data || typeof data !== 'object')
        throw new Error('пустые метаданные');
    return sanitizeDevice(data);
}

function sanitizeDevice(data, depth = 0) {
    if (!data || typeof data !== 'object' || depth > 4)
        return data;
    if (Array.isArray(data))
        return data.map(x => (x && typeof x === 'object' ? sanitizeDevice(x, depth + 1) : x));
    const out = {};
    for (const [k, v] of Object.entries(data)) {
        if (SECRET_KEY.test(k))
            continue;
        if (typeof v === 'function')
            continue;
        if (v && typeof v === 'object')
            out[k] = sanitizeDevice(v, depth + 1);
        else
            out[k] = v;
    }
    return out;
}

/** Путь для meta: свой / label / ls / карта / провайдер из запроса. */
function itemPath(block, box, defaultLabel, query) {
    const own = String(block?.path || '').trim();
    if (own && own !== '/')
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel && label.includes('/'))
        return label;
    const fromProvider = providerPathFromMap(box, query);
    if (fromProvider)
        return fromProvider;
    const fromMap = pathFromMap(box, query);
    if (fromMap && fromMap !== '/')
        return fromMap;
    return classPath(block, box, defaultLabel);
}

/** Провайдер для remote: не голый /MODELS; после ls — матч по имени/токену (ollama → BIS-Ollama). */
function resolveRemotePath(block, box, messages) {
    const query = exploreQuery(block, box, messages, remoteTool.label);
    const own = String(block?.path || '').trim();
    if (isModelsProviderPath(own) && providerRoot(own) !== '/MODELS')
        return providerRoot(own);
    const fromProvider = providerPathFromMap(box, query);
    if (fromProvider)
        return fromProvider;
    const fromClass = classPath(block, box, remoteTool.label);
    if (isModelsProviderPath(fromClass) && providerRoot(fromClass) !== '/MODELS')
        return providerRoot(fromClass);
    const fromMap = pathFromMap(box, query);
    if (isModelsProviderPath(fromMap) && providerRoot(fromMap) !== '/MODELS')
        return providerRoot(fromMap);
    return '';
}

function isModelsProviderPath(p) {
    const parts = String(p || '').split('/').filter(Boolean);
    return parts.length >= 2 && parts[0].toUpperCase() === 'MODELS';
}

function providerRoot(p) {
    const parts = String(p || '').split('/').filter(Boolean);
    if (parts.length < 2 || parts[0].toUpperCase() !== 'MODELS')
        return '';
    return '/' + parts[0] + '/' + parts[1];
}

async function listRootMap() {
    return listChildrenMap('/');
}

function isWorkClass(item) {
    if (!item)
        return false;
    if (typeof FS !== 'undefined' && FS.$class && item instanceof FS.$class)
        return true;
    return item.constructor?.name === '$class'
        || item.constructor?.name?.endsWith?.('$class') === true;
}

async function formatClassEntry(child, childPath) {
    let type = child.type || '';
    let label = '';
    let note = '';
    try {
        const info = typeof child.info === 'function' ? await child.info({ deep: 0 }) : null;
        if (info && typeof info === 'object') {
            type = info.type || type;
            label = info.label || info.name || '';
            note = String(info.description || info.about || info.title || '').trim().slice(0, 120);
        }
    }
    catch { /* ignore */ }
    if (!label && child.label && child.label !== child.id)
        label = child.label;
    let readme = 'readme: нет';
    try {
        const r = typeof child.get_item === 'function'
            ? await child.get_item('readme.md')
            : await WORK.get_item(childPath.replace(/\/$/, '') + '/readme.md');
        if (r && typeof r.read_text === 'function')
            readme = 'readme: ' + childPath.replace(/\/$/, '') + '/readme.md';
    }
    catch { /* ignore */ }
    const typeBit = type ? ' (' + type + ')' : '';
    const labelBit = label && label !== child.id ? ' — ' + label : '';
    const noteBit = note ? '\n  ' + note : '';
    return '- ' + childPath + typeBit + labelBit + noteBit + '\n  ' + readme;
}

/** Корень `/` — один уровень классов (компас). */
async function listChildrenMap(path) {
    path = String(path || '/').trim() || '/';
    try {
        const root = await WORK.get_item(path);
        const kids = ((await root?.children) || []).filter(isWorkClass);
        const title = path === '/' ? '[классы /]' : '[классы ' + path + ']';
        if (!kids.length)
            return title + '\n(нет дочерних классов)';
        const lines = [title];
        const slice = kids.slice(0, MAP_ROOT_LIMIT);
        for (const child of slice) {
            const id = child.id || child.name || '';
            if (!id)
                continue;
            const childPath = path === '/'
                ? (id.startsWith('/') ? id : '/' + id)
                : (path.replace(/\/$/, '') + '/' + id.replace(/^\//, ''));
            lines.push(await formatClassEntry(child, childPath));
        }
        if (kids.length > MAP_ROOT_LIMIT)
            lines.push('- … ещё ' + (kids.length - MAP_ROOT_LIMIT) + ' классов');
        return lines.join('\n');
    }
    catch {
        return '';
    }
}

/**
 * Ветка (не `/`): `info({ deep: -1 })` — компактное дерево path/type/label до листьев.
 * Не сырой json_model.
 */
async function listInfoDeep(path) {
    path = String(path || '').trim();
    if (!path || path === '/')
        return listChildrenMap('/');
    try {
        const root = await WORK.get_item(path);
        if (!root || typeof root.info !== 'function')
            return '';
        const tree = await root.info({ deep: -1 });
        const lines = ['[info ' + path + ' deep=-1]'];
        const state = { count: 0, limit: INFO_NODE_LIMIT };
        formatInfoTree(tree, lines, 0, state);
        if (state.count >= state.limit)
            lines.push('… обрезано (лимит ' + state.limit + ' узлов)');
        const kids = Array.isArray(tree?.items) ? tree.items : [];
        if (state.count <= 1 && !kids.length)
            lines.push('(нет вложенных items)');
        return lines.join('\n');
    }
    catch {
        return '';
    }
}

function formatInfoTree(node, lines, depth, state) {
    if (!node || typeof node !== 'object' || state.count >= state.limit)
        return;
    const id = String(node.id || node.name || '').trim();
    if (id?.[0] === '.')
        return;
    state.count++;
    const pad = '  '.repeat(depth);
    const p = String(node.path || node.short || '').trim();
    const pathBit = p || id || '?';
    const type = node.type ? ' (' + node.type + ')' : '';
    const labelRaw = String(node.label || '').trim();
    const labelBit = labelRaw && labelRaw !== id && labelRaw !== pathBit
        ? ' — ' + labelRaw
        : '';
    lines.push(pad + '- ' + pathBit + type + labelBit);
    const kids = Array.isArray(node.items) ? node.items : [];
    for (const child of kids) {
        if (state.count >= state.limit)
            break;
        formatInfoTree(child, lines, depth + 1, state);
    }
}

function readmePathFromMap(box, query) {
    const path = pathFromMap(box, query);
    if (!path)
        return '';
    const map = (box?.items || []).findLast?.(b => (b.type === 'map' || b.type === 'ls') && b.content)
        || [...(box?.items || [])].reverse().find(b => (b.type === 'map' || b.type === 'ls') && b.content);
    if (!map)
        return path + '/readme.md';
    const re = new RegExp('readme:\\s*(' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/readme\\.md)', 'i');
    const hit = String(map.content).match(re);
    return hit ? hit[1] : path + '/readme.md';
}

function exploreQuery(block, box, messages, defaultLabel) {
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel)
        return label;
    return String(box?.brief || lastUserContent(messages) || '').trim();
}

function pathFromMap(box, query) {
    const map = (box?.items || []).find(b => b.type === 'map' && b.content)
        || (box?.items || []).findLast?.(b => (b.type === 'map' || b.type === 'ls') && b.content)
        || [...(box?.items || [])].reverse().find(b => (b.type === 'map' || b.type === 'ls') && b.content);
    if (!map)
        return '';
    // карта и info-дерево: строки вида «- /path» с отступом
    const paths = [...String(map.content).matchAll(/^\s*\- (\/[^\s(]+)/gm)].map(m => m[1]);
    if (!paths.length)
        return '';
    const q = String(query || '').toLowerCase();
    // длинные пути раньше — точнее матч по токену
    const ordered = [...paths].sort((a, b) => b.length - a.length);
    for (const p of ordered) {
        const token = p.replace(/^\//, '').toLowerCase();
        if (token.length >= 3 && q.includes(token))
            return p;
        const leaf = p.split('/').filter(Boolean).pop()?.toLowerCase() || '';
        if (leaf.length >= 3 && q.includes(leaf))
            return p;
    }
    for (const [re, root] of ROOT_HINTS) {
        if (re.test(query) && paths.includes(root))
            return root;
    }
    return '';
}

/** Токены запроса (ollama, bis, …) — до склейки; короткие отброс. */
function queryTokens(query) {
    return String(query || '').toLowerCase()
        .split(/[^a-z0-9а-яё]+/i)
        .map(t => t.trim())
        .filter(t => t.length >= 3);
}

/**
 * Выбор /MODELS/<id> по brief.
 * 1) полное имя провайдера ∈ query (bis-ollama → BIS-Ollama);
 * 2) токен query ∈ имени (ollama → единственный *ollama*);
 * несколько кандидатов — '' (не гадать).
 */
function pickProviderPath(providerPaths, query) {
    const list = (providerPaths || []).filter(Boolean);
    if (!list.length)
        return '';
    const qFlat = String(query || '').toLowerCase().replace(/[-\s_]/g, '');
    const tokens = queryTokens(query).map(t => t.replace(/[-\s_]/g, '')).filter(t => t.length >= 3);
    const strong = [];
    const soft = [];
    for (const p of list) {
        const nameFlat = (String(p).split('/').pop() || '').toLowerCase().replace(/[-\s_]/g, '');
        if (nameFlat.length < 3)
            continue;
        if (qFlat.includes(nameFlat)) {
            strong.push(p);
            continue;
        }
        if (tokens.some(t => nameFlat.includes(t)))
            soft.push(p);
    }
    if (strong.length === 1)
        return strong[0];
    if (strong.length > 1)
        return '';
    if (soft.length === 1)
        return soft[0];
    if (!strong.length && !soft.length && list.length === 1)
        return list[0];
    return '';
}

/** Имя/токен в реплике → /MODELS/<id> по живым детям /MODELS. */
async function providerPathByName(query) {
    if (!String(query || '').trim())
        return '';
    const root = await WORK.get_item('/MODELS');
    const kids = ((await root?.children) || []).filter(isWorkClass);
    const paths = kids.map(k => String(k.path || ('/MODELS/' + k.id)));
    return pickProviderPath(paths, query);
}

/** Провайдеры из map/ls: /MODELS/<Name> (bis-ollama | ollama → BIS-Ollama). */
function providerPathFromMap(box, query) {
    const map = (box?.items || []).findLast?.(b => (b.type === 'map' || b.type === 'ls') && b.content)
        || [...(box?.items || [])].reverse().find(b => (b.type === 'map' || b.type === 'ls') && b.content);
    if (!map)
        return '';
    const paths = [...String(map.content).matchAll(/^\s*\- (\/[^\s(]+)/gm)].map(m => m[1]);
    const providers = paths.filter(p => {
        const parts = p.split('/').filter(Boolean);
        return parts.length === 2 && parts[0].toUpperCase() === 'MODELS';
    });
    return pickProviderPath(providers, query);
}

function classPath(block, box, defaultLabel) {
    const own = String(block?.path || '').trim();
    if (own)
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel && label.includes('/'))
        return label;
    const ls = (box?.items || []).findLast?.(b => b.type === 'ls' && b.path)
        || [...(box?.items || [])].reverse().find(b => b.type === 'ls' && b.path);
    return ls?.path ? String(ls.path) : '';
}

async function resolveFile(path) {
    path = String(path || '').trim();
    if (!path)
        return null;
    const item = await WORK.get_item(path);
    return item && typeof item.read_text === 'function' ? item : null;
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
