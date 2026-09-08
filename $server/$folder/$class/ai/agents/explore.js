/** Агент explore: осмотр системы WORK по слоям (карта `/`, ls одного уровня, readme, ask, meta, remote). Без записи файлов.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat, engine }). */
const MAP_ROOT_LIMIT = 40;

const ORIENTATION = [
    'Ориентация: система WORK — дерево классов. Корневые классы — прикладное наполнение этой поставки: набор любой, их может не быть.',
    'Осмотр только по слоям: карта `/` (дети корня) → выбрать узел с карты → ls одного уровня этого узла + readme → снова выбор → глубже. Не прыгай к «известному» пути из памяти.',
    'Путь — только с карты/ls в ленте (path, type, label). Нет однозначного совпадения — не угадывай корень, выбери с карты или зафиксируй в итоге.',
    'Факты — только из блоков ленты (карта, ls, readme, ask, meta, remote); не из памяти и не через web.',
    'Карта и ls — только классы (не .git, не node_modules, не обычные папки/файлы). ls узла — один уровень детей, не дерево до листьев.',
    'Устройство item — meta: class.js через meta_folder / tilde → importScript; не info/$public.',
    'Провайдер $ai: подключённые модели = дети (ls); доступные на API = remote того же пути (baseUrl из meta). «Не подключены» = remote − ls. ask «нет данных» — не итог.',
    'ask — вопрос классу (peer), не человеку.',
    'Item — readme из storage_folder (у класса = meta). Раздел readme «из чего состоит» — контракт, не инвентарь диска.',
    '«Добавь / создай» — нет узла в ls родителя = create (work), не «уже есть по readme».',
    'В отчёте только то, что есть в items. Не пиши псевдовызовы tool в content — выбирай tools меню.',
].join('\n');

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
        '/<класс с карты>',
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
    description: 'один уровень детей выбранного класса (как карта корня); путь с карты/ls в ленте',
    system: [
        '# Режим: ls',
        'Первая строка — путь класса с карты или предыдущего ls в ленте.',
        'Один уровень детей. Не выдумывай путь. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь класса с карты / ls.',
        'Пример: путь одной из строк карты.',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const query = exploreQuery(b, params.box, params.messages, lsTool.label);
        const path = classPath(b, params.box, lsTool.label)
            || pathFromMap(params.box, query);
        if (path)
            return fillLs(b, path, params.box);
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.content && b.path)
            return;
        const head = String(b.content || '').replace(/\r\n/g, '\n').trim().split('\n').find(Boolean) || '';
        const path = String(b.path || head.replace(/^#+\s*/, '').trim());
        if (!path)
            return;
        await fillLs(b, path, params.box);
    },
};

const readTool = {
    label: 'Читаю readme',
    icon: 'icons:description',
    role: 'user',
    description: 'readme.md узла из storage_folder (путь с карты/ls)',
    system: [
        '# Режим: readme',
        'Первая строка — путь класса с карты или ls в ленте.',
        'Не выдумывай путь. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь класса с карты / ls.',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const query = exploreQuery(b, params.box, params.messages, readTool.label);
        let path = classPath(b, params.box, readTool.label)
            || pathFromMap(params.box, query)
            || readmePathFromMap(params.box, query);
        if (path)
            return fillReadme(b, path, params);
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done || (b.content && b.path && !/^\/\S+$/.test(String(b.content).trim())))
            return;
        const head = String(b.content || '').replace(/\r\n/g, '\n').trim().split('\n').find(Boolean) || '';
        const path = String(b.path || head.replace(/^#+\s*/, '').trim());
        if (!path)
            return;
        await fillReadme(b, path, params);
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
        'Пример: путь класса с карты.',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const query = exploreQuery(b, params.box, params.messages, metaTool.label);
        let path = itemPath(b, params.box, metaTool.label, query);
        if (!path || path === '/')
            return true;
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
        'Первая строка — путь класса провайдера $ai с карты или ls (узел, у которого есть list_remote).',
        'baseUrl — из устройства класса (meta). Не выдумывай URL и не угадывай корень. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь провайдера $ai с карты / ls.',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const path = resolveRemotePath(b, params.box, params.messages);
        if (!path)
            return true;
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
    label: 'Осматриваю систему',
    icon: 'icons:explore',
    doc: true,
    /** в контекст идут листья-факты (map/ls/meta/remote/ask, role user), не пересказ total — work.create проверяет model по ним */
    expand: true,
    allowReasoning: true,
    description: 'строение WORK: ls, readme (storage_folder), meta, remote у $ai; карта, ask; не файлы и не интернет',
    system: [
        '# Агент: explore',
        'Осмотр системы WORK. Карта корня уже в ленте.',
        ORIENTATION,
        'Не пиши файлы и не ходи в интернет — это work / web.',
        'Нет пути с карты/ls — не выдумывай; выбери узел из уже показанного слоя.',
        'Выбран узел — readme этого узла и ls его детей (один уровень). Сравнение A и B — readme и meta каждого.',
        'Провайдер $ai: ls детей + remote того же пути, затем diff. Не web.',
    ].join('\n'),
    prompt: [
        'Отчёт только по фактам из items (карта, ls, readme, ask, meta, remote).',
        'Не описывай шаги, которых не было. ls — один уровень: итог по этим детям, не по выдуманной глубине.',
        'Есть remote и ls одного провайдера — явный diff (на API, нет в WORK).',
    ].join('\n'),
    /** Итог бокса = склейка фактов items (ls/meta/remote/readme/ask), не пересказ модели: LLM-total выдумывал meta. */
    enrichTotal(_content, block) {
        const facts = (block?.items || []).filter(b =>
            b?.content && !b.error && b.type !== 'map');
        if (!facts.length)
            return 'Осмотр неполный: в items нет readme/ls/meta/remote/ask — только карта или пусто. Выбери tools, не пиши план в total.';
        return facts.map(b => String(b.content).trim()).filter(Boolean).join('\n\n');
    },
    /** Карта корня `/`; если brief однозначно совпал с узлом карты — слой: readme + ls детей. */
    async init(params = {}) {
        const { block, messages } = params;
        block.items ??= [];
        const brief = String(block.brief || '').trim();
        if (brief)
            tagAgent(block, AGENT_TAG, clip(brief, 48));
        else
            tagAgent(block, AGENT_TAG, 'карта /');
        if (!block.items.some(b => b.type === 'map')) {
            const text = await listRootMap();
            if (text) {
                const map = {
                    type: 'map',
                    label: 'Карта системы',
                    icon: 'icons:map',
                    role: 'user',
                    time: Date.now(),
                    content: text,
                };
                block.items.push(map);
                if (messages)
                    messages.push({ role: 'user', content: text });
            }
        }
        const target = pathFromMap(block, brief || lastUserContent(messages));
        if (target && target !== '/')
            await seedTargetFacts(block, target, params);
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

async function fillLs(b, path, box) {
    path = String(path || '').replace(/\/$/, '') || '/';
    b.path = path;
    tagAgent(box, AGENT_TAG, path === '/' ? 'ls /' : 'ls ' + path);
    const text = await listChildrenMap(path);
    if (!text)
        return false;
    b.content = text;
    return true;
}

async function fillReadme(b, path, params) {
    path = String(path || '').trim();
    if (!path)
        return false;
    let file = await resolveFile(path);
    if (!file) {
        try {
            const item = await WORK.get_item(path);
            file = await resolveReadme(item);
            if (file)
                path = file.path || path;
        }
        catch { /* ignore */ }
    }
    if (!file) {
        const readme = path.replace(/\/$/, '') + '/readme.md';
        file = await resolveFile(readme);
        if (file)
            path = readme;
    }
    b.path = path;
    tagAgent(params.box, AGENT_TAG, 'readme ' + path);
    if (!file) {
        b.content = 'readme: нет';
        return true;
    }
    await params.exec(file, {
        method: 'read_text',
        args: { session: params.session },
    }, { block: b });
    b.done = true;
    return true;
}

function markUsed(box, type) {
    if (!box || !type)
        return;
    const used = box.using_blocks ??= [];
    if (!used.includes(type))
        used.push(type);
}

/** После карты: readme + ls целевой ветки без pick (иначе read/ls сгорают init=false). */
async function seedTargetFacts(box, path, params = {}) {
    path = String(path || '').replace(/\/$/, '');
    if (!path || path === '/')
        return;
    box.items ??= [];
    const messages = params.messages;
    const run = async (type, tool) => {
        if (box.items.some(b => b.type === type && b.content && !b.error))
            return;
        const child = {
            type,
            label: tool.label,
            icon: tool.icon,
            role: tool.role || 'user',
            time: Date.now(),
            path,
        };
        box.items.push(child);
        markUsed(box, type);
        const ok = await tool.init({
            ...params,
            block: child,
            box,
        });
        if (ok === false) {
            box.items.pop();
            return;
        }
        if (child.content && messages)
            messages.push({ role: 'user', content: String(child.content) });
    };
    await run('read', readTool);
    await run('ls', lsTool);
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

/** Путь для meta: свой / label / карта / последний ls. */
function itemPath(block, box, defaultLabel, query) {
    const own = String(block?.path || '').trim();
    if (own && own !== '/')
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel && label.includes('/'))
        return label;
    const fromMap = pathFromMap(box, query);
    if (fromMap && fromMap !== '/')
        return fromMap;
    return classPath(block, box, defaultLabel);
}

/** Путь для remote — только с карты/ls/блока, без прыжка к корню из памяти. */
function resolveRemotePath(block, box, messages) {
    const query = exploreQuery(block, box, messages, remoteTool.label);
    const own = String(block?.path || '').trim();
    if (own && own !== '/')
        return own;
    const fromClass = classPath(block, box, remoteTool.label);
    if (fromClass && fromClass !== '/')
        return fromClass;
    const fromMap = pathFromMap(box, query);
    if (fromMap && fromMap !== '/')
        return fromMap;
    return '';
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
        const r = await resolveReadme(child);
        if (r && (typeof r.read_text === 'function' || r.path))
            readme = 'readme: ' + (r.path || childPath.replace(/\/$/, '') + '/readme.md');
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

function readmePathFromMap(box, query) {
    const path = pathFromMap(box, query);
    if (!path)
        return '';
    const map = (box?.items || []).findLast?.(b => (b.type === 'map' || b.type === 'ls') && b.content)
        || [...(box?.items || [])].reverse().find(b => (b.type === 'map' || b.type === 'ls') && b.content);
    if (!map)
        return path;
    const re = new RegExp(
        path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*\\n\\s+readme:\\s*(\\S+)',
        'i',
    );
    const hit = String(map.content).match(re);
    return hit && hit[1] && !/^нет$/i.test(hit[1]) ? hit[1] : path;
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
    const rows = [...String(map.content).matchAll(/^\s*\- (\/[^\s(]+)([^\n]*)/gm)].map(m => ({
        path: m[1],
        rest: m[2] || '',
    }));
    if (!rows.length)
        return '';
    const paths = rows.map(r => r.path);
    const q = String(query || '').toLowerCase();
    const hits = [];
    const ordered = [...paths].sort((a, b) => b.length - a.length);
    for (const p of ordered) {
        const token = p.replace(/^\//, '').toLowerCase();
        if (token.length >= 3 && q.includes(token))
            hits.push(p);
        else {
            const leaf = p.split('/').filter(Boolean).pop()?.toLowerCase() || '';
            if (leaf.length >= 3 && q.includes(leaf))
                hits.push(p);
        }
    }
    for (const { path, rest } of rows) {
        const type = (rest.match(/\(\$([^)]+)\)/) || [])[1];
        if (type && q.includes(type.toLowerCase()))
            hits.push(path);
        const label = ((rest.match(/[—–-]\s*(.+)$/) || [])[1] || '').trim().toLowerCase();
        const words = label.split(/[^a-z0-9а-яё]+/i).filter(w => w.length >= 4);
        if (words.some(w => q.includes(w)))
            hits.push(path);
    }
    const uniq = [...new Set(hits)];
    return uniq.length === 1 ? uniq[0] : '';
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

/** readme.md в storage_folder (класс = meta; папка = сама). */
async function resolveReadme(item) {
    if (!item)
        return null;
    const storage = item.storage_folder || item;
    if (typeof storage.get_item === 'function') {
        const file = await storage.get_item('readme.md');
        if (file)
            return file;
    }
    return null;
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
