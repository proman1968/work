/** Агент explore: осмотр системы WORK по слоям (карта `/`, ls: корень=1 уровень / ветка=info deep=2, readme, ask, meta, remote). Без записи файлов.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat, engine }). */
const MAP_ROOT_LIMIT = 40;
const INFO_NODE_LIMIT = 200;
/** Секции обычных папок/файлов в карте. */
const FS_LIST_LIMIT = 40;
/** Первый уровень тяжёлых каталогов (имена без readme/info). */
const FS_SHALLOW_LIMIT = 200;
/** Никогда не показывать. */
const FS_HIDE_IDS = ['.RAG'];
/** Виден в карте, раскрывается только первым уровнем имён, без рекурсии. */
const FS_SHALLOW_IDS = ['node_modules'];
/** Ветка: два уровня вниз. Не unlimited deep=-1. */
const LS_BRANCH_DEEP = 2;

const ORIENTATION = [
    'Ориентация: дерево классов. Корневые классы — прикладное наполнение этой поставки: набор любой, их может не быть.',
    'Осмотр по слоям: карта `/` (дети корня) → выбрать узел с карты → readme узла → ls ветки. Путь — только с карты/ls в ленте.',
    'Карта `/` — один уровень. ls ветки (не `/`) — `info({ deep: 2 })`: два уровня детей (path/type/label).',
    'Факты — только из блоков ленты (карта, ls, readme, ask, meta, remote, fs); не из памяти и не через web.',
    'Карта и ls — три списка: классы, обычные папки, файлы (секции [папки]/[файлы]; скрыт только точечный мусор). Классы — классами, папки — папками, не смешивать.',
    'node_modules виден в карте, раскрывается только первым уровнем имён (до 200, без readme); вглубь пакетов не ходить.',
    'Путь осмотра — класс с карты; хвост /$… — метапапка, не класс: поднимись к родительскому классу.',
    'Скобки ($base) в карте — тип узла, не часть пути. Путь — только токен после «- ».',
    'Устройство item — полное class.js через $class.import() (tilde-merge); не один meta_file. Не info/$public как замена readme.',
    'remote — list_remote у узла, у которого есть метод (не ls детей). Закон «кого спрашивать» — в readme места.',
    'Item — readme из storage_folder (у класса = meta). Раздел readme «из чего состоит» — контракт слоёв, не инвентарь диска.',
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
        await target.init;
        if (typeof target.prompt !== 'function')
            return false;
        b.path = path;
        tagAgent(params.box, AGENT_TAG, 'ask ' + path);
        try {
            const result = await askClassPeer({
                target,
                question,
                session: params.session,
                live: params.live,
            });
            b.content = formatAskResult(result, path);
            if (result?.error) {
                b.error = true;
                b.state = 'ошибка';
            }
            else {
                b.state = 'ok';
            }
            b.done = true;
            return true;
        }
        catch (e) {
            b.error = true;
            b.state = 'ошибка';
            b.content = 'ask ' + path + ': ' + String(e.message || e);
            return true;
        }
    },
};

const lsTool = {
    label: 'Смотрю каталог',
    icon: 'icons:folder-open',
    role: 'user',
    description: 'ветка: info deep=2 (два уровня); корень `/` — один уровень компаса; путь с карты/ls',
    system: [
        '# Режим: ls',
        'Первая строка — путь класса с карты или предыдущего ls в ленте.',
        'Ветка (не `/`) — info deep=2 (два уровня детей). Корень `/` — один уровень.',
        'Не выдумывай путь. Не обращайся к пользователю.',
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
        'Заголовок `[read <запрошен> ← <источник, слой>]` ставит код; цитируй источник из заголовка, слой не скрывай.',
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
        'Класс: meta → $class.import() (tilde class.js). Файл: tilde class.js типа → importScript.',
        'Заголовок `[meta <путь>]` ставит код; устройство — всегда tilde-merge слоёв, не один файл; цитируй путь из заголовка.',
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
        if (!path.startsWith('/')) {
            b.error = true;
            b.content = 'meta: нужен путь /…, не «' + path + '»';
            return true;
        }
        const norm = toClassPath(path);
        if (norm.redirected) {
            path = norm.path;
            tagAgent(params.box, AGENT_TAG, 'мета → родитель ' + path);
        }
        const target = await WORK.get_item(path);
        if (!target)
            return false;
        // meta — только классы: файл читается через read, папка смотрится через ls (подсказка, не ошибка).
        if (!isWorkClass(target)) {
            b.path = path;
            const isFile = typeof target.read_text === 'function';
            b.state = isFile ? 'файл → read' : 'папка → ls';
            b.content = 'meta: ' + path + ' — это ' + (isFile ? 'файл, читай через read ' + path : 'папка, смотри через ls ' + path);
            tagAgent(params.box, AGENT_TAG, 'meta: не класс');
            return true;
        }
        b.path = path;
        tagAgent(params.box, AGENT_TAG, 'meta ' + path);
        try {
            const device = await loadItemDevice(target);
            b.content = formatMetaResult(device, path);
            if (!device || device.error) {
                b.error = true;
                b.state = 'ошибка';
            }
            else {
                b.state = 'ok';
            }
            return true;
        }
        catch (e) {
            b.error = true;
            b.content = 'meta ' + path + ': ' + String(e.message || e);
            return true;
        }
    },
};

/** Живой список с API узла (list_remote), не дети дерева. */
const remoteTool = {
    label: 'Список у узла',
    icon: 'icons:cloud-circle',
    role: 'user',
    description: 'list_remote у класса, у которого есть метод; не ls детей и не web. Сначала capability (list_remote + baseUrl из meta), нет — skip без error-попытки',
    system: [
        '# Режим: remote',
        'Первая строка — путь класса с list_remote (с карты / ls). Не выдумывай URL. Не обращайся к пользователю.',
        'Сначала capability: метод list_remote у цели + baseUrl из meta. Нет capability — skip без error-попытки, не трать ход.',
    ].join('\n'),
    prompt: [
        'Путь класса с карты / ls.',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const path = resolveRemotePath(b, params.box, params.messages);
        if (!path) {
            // Нет узла с capability в ленте — тихий пропуск (тип уходит в using_blocks),
            // не error: жечь errorStreak попыткой без операнда запрещено.
            return false;
        }
        const target = await WORK.get_item(path);
        if (!isWorkClass(target))
            return false;
        if (typeof target.list_remote !== 'function') {
            b.path = path;
            b.state = 'нет capability → skip';
            b.content = '[remote]\nу «' + (target.type || '?') + '» ' + path + ' нет list_remote — нужен путь узла $provider с карты/ls (напр. /MODELS/odant), не каталог';
            return true;
        }
        b.path = path;
        tagAgent(params.box, AGENT_TAG, 'remote ' + path);
        try {
            let baseUrl = '';
            try {
                const device = await loadItemDevice(target);
                baseUrl = String(device?.baseUrl || '').trim();
            }
            catch { /* list_remote сам проверит */ }
            if (!baseUrl) {
                b.content = formatRemoteResult({
                    error: 'нет baseUrl у ' + path + ' — remote только на узле $provider (напр. /MODELS/odant), не на каталоге',
                    baseUrl: '',
                }, path, { baseUrl: '' });
                b.state = 'нет capability → skip';
                return true;
            }
            const result = await params.exec(target, {
                method: 'list_remote',
                args: { baseUrl },
            }, { block: b });
            b.content = formatRemoteResult(result, path, { baseUrl });
            if (result?.error) {
                b.error = true;
                b.state = 'ошибка';
            }
            else {
                b.state = 'ok';
            }
            return true;
        }
        catch (e) {
            b.error = true;
            b.state = 'ошибка';
            b.content = 'remote ' + path + ': ' + String(e.message || e);
            return true;
        }
    },
};

const AGENT_TAG = 'Осмотр';

export default {
    label: 'Осматриваю систему',
    icon: 'icons:explore',
    /** в контекст идут листья-факты (map/ls/meta/remote/ask, role user), не пересказ total */
    expand: true,
    allowReasoning: true,
    description: 'строение дерева: карта `/` тремя списками (классы/папки/файлы); ls ветки = info deep=2; readme; meta; remote (list_remote); ask. Звать когда нужны факты дерева и их нет в ленте; факт — блок items, не пересказ промпта',
    system: [
        '# Агент: explore',
        'Осмотр дерева классов. Карта корня уже в ленте.',
        'Факт — только блок items (map/ls/readme/meta/remote/ask); пересказ системного промпта запрещён.',
        ORIENTATION,
        'Не пиши файлы и не ходи в интернет — это work / web.',
        'Нет пути с карты/ls — не выдумывай; выбери узел из уже показанного слоя.',
        'Выбран узел — readme этого узла и ls ветки (deep=2). Сравнение A и B — readme и meta каждого.',
        'remote — у узла с list_remote. Кого спрашивать — readme места.',
    ].join('\n'),
    prompt: [
        'Отчёт только по фактам из items (карта, ls, readme, ask, meta, remote).',
        'В итоге различай классы и обычные папки/файлы; сужение «папки» до «классы» без пометы запрещено.',
        'Не описывай шаги, которых не было. Если в ls уже дерево deep=2 — итог по видимым детям/внукам, не выдумывай глубже.',
        'Есть remote и ls одного узла — явный diff (на API, нет в дереве).',
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
    if (path !== '/' && !path.startsWith('/')) {
        b.error = true;
        b.content = 'ls: нужен путь /…, не «' + path + '»';
        return true;
    }
    const norm = toClassPath(path);
    if (norm.redirected) {
        path = norm.path;
        tagAgent(box, AGENT_TAG, 'мета → родитель ' + path);
    }
    // ls — только каталоги: файл читается через read (подсказка, не ошибка).
    try {
        const target = await WORK.get_item(path);
        if (target && typeof target.read_text === 'function') {
            b.path = path;
            b.state = 'файл → read';
            b.content = 'ls: ' + path + ' — это файл, читай через read ' + path;
            return true;
        }
    }
    catch { /* ниже — штатный путь */ }
    b.path = path;
    const isRoot = path === '/';
    tagAgent(box, AGENT_TAG, isRoot ? 'ls /' : 'info ' + path);
    const text = isRoot
        ? await listChildrenMap('/')
        : await listInfoDeep(path);
    if (!text)
        return false;
    b.content = text;
    b.state = 'ok';
    return true;
}

async function fillReadme(b, path, params) {
    path = String(path || '').trim();
    if (!path)
        return false;
    if (!path.startsWith('/')) {
        b.error = true;
        b.content = 'read: нужен путь /…, не «' + path + '»';
        return true;
    }
    const norm = toClassPath(path);
    if (norm.redirected) {
        path = norm.path;
        tagAgent(params.box, AGENT_TAG, 'мета → родитель ' + path);
    }
    const requested = path;
    // Явный запрос файла readme.md: прямой файл → свой; тильда-путь (…/~/readme.md)
    // → склейка слоёв как readme_merged; иначе честное «нет» (чужой слой — не улика).
    if (/\/readme\.md$/i.test(requested)) {
        const direct = await resolveFile(requested);
        b.path = requested;
        if (direct) {
            tagAgent(params.box, AGENT_TAG, 'readme ' + requested);
            await params.exec(direct, {
                method: 'read_text',
                args: { session: params.session },
            }, { block: b });
            b.content = provenanceHead('read', requested, b.path, 'свой')
                + '\n' + String(b.content || '');
            b.done = true;
            b.state = 'ok';
            return true;
        }
        const merged = await mergeTildeReadme(requested);
        if (merged) {
            b.content = provenanceHead('read', requested, requested, 'сводный merge ~')
                + '\n' + merged;
            b.done = true;
            b.state = 'ok';
            return true;
        }
        b.state = 'нет';
        b.content = 'readme: нет';
        return true;
    }
    let layer = 'свой';
    let file = await resolveFile(path);
    if (!file) {
        layer = 'наследованный';
        try {
            const item = await WORK.get_item(path);
            if (item && typeof item.readme_merged === 'function') {
                const merged = await item.readme_merged();
                if (merged?.text) {
                    b.path = merged.path || path;
                    tagAgent(params.box, AGENT_TAG, 'readme ' + b.path);
                    b.content = provenanceHead('read', requested, b.path, 'сводный merge ~')
                        + '\n' + merged.text;
                    b.done = true;
                    b.state = 'ok';
                    return true;
                }
            }
            file = await resolveReadme(item);
            if (file)
                path = file.path || path;
        }
        catch { /* ignore */ }
    }
    if (!file) {
        const readme = path.replace(/\/$/, '') + '/readme.md';
        file = await resolveFile(readme);
        if (file) {
            path = readme;
            layer = 'свой';
        }
    }
    b.path = path;
    tagAgent(params.box, AGENT_TAG, 'readme ' + path);
    if (!file) {
        b.state = 'нет';
        b.content = 'readme: нет';
        return true;
    }
    await params.exec(file, {
        method: 'read_text',
        args: { session: params.session },
    }, { block: b });
    b.content = provenanceHead('read', requested, b.path, layer)
        + '\n' + String(b.content || '');
    b.done = true;
    b.state = 'ok';
    return true;
}

/** Склейка тильда-слоёв readme (как readme_merged): текст + пути слоёв. Пусто — ''. */
async function mergeTildeReadme(requested) {
    try {
        const found = await WORK.get_item(requested);
        const list = (Array.isArray(found) ? found : (found ? [found] : []))
            .filter(f => f && typeof f.read_text === 'function');
        if (!list.length)
            return '';
        if (typeof $server?.mergeTextFiles === 'function') {
            const text = await $server.mergeTextFiles(list);
            if (String(text || '').trim())
                return String(text).trim()
                    + '\n\n[слои]\n' + list.map(f => '- ' + (f.path || '')).join('\n');
            return '';
        }
        const bits = [];
        for (const f of list) {
            try {
                bits.push('--- ' + (f.path || '') + '\n' + String(await f.read_text() || '').trim());
            }
            catch { /* слой не читается */ }
        }
        return bits.join('\n\n').trim();
    }
    catch {
        return '';
    }
}

/** Заголовок провенанса улики: что просили, откуда взяли, чей слой. */
function provenanceHead(kind, requested, actual, layer) {
    return '[' + kind + ' ' + requested + ' ← ' + actual + ', ' + layer + ']';
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
    const brief = String(box?.brief || lastUserContent(messages) || '').trim();
    path = resolveExplorePath(block, box, messages, defaultLabel, {
        path,
        allowLsFallback: false,
        query: brief || question,
    });
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
 * Peer-класс: `target.prompt(params)`. Агенты — пакет `~/ai/prompt` этого класса.
 * Без live.wait.
 */
async function askClassPeer({ target, question, session, live } = {}) {
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
    return target.prompt({
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

/**
 * Полное устройство $class: import() = tilde-merge class.js (не один meta_file).
 * Нет baseUrl у узла — дополнить каналом meta/$folder/$class/<type> (шаблон детей провайдера).
 */
async function loadItemDevice(item) {
    if (!item)
        throw new Error('нет item');
    let data = null;
    if (isWorkClass(item) && typeof item.import === 'function') {
        try {
            data = await item.import();
        }
        catch { /* fallback */ }
    }
    if (!data || typeof data !== 'object') {
        try {
            await item.init;
            data = item.DATA;
        }
        catch { data = null; }
    }
    if ((!data || typeof data !== 'object' || !Object.keys(data).length)
        && typeof item.tilde !== 'undefined') {
        try {
            const layers = ((await item.tilde) || []).filter(f => f?.id === 'class.js');
            if (layers.length && typeof $server?.mergeFiles === 'function') {
                const script = await $server.mergeFiles(layers);
                data = await item.constructor.importScript(script);
            }
        }
        catch { /* */ }
    }
    if ((!data || typeof data !== 'object')) {
        try {
            const metaFile = await item.meta_file;
            if (metaFile && typeof metaFile.importScript === 'function')
                data = await metaFile.importScript();
        }
        catch { /* */ }
    }
    if (!data || typeof data !== 'object')
        throw new Error('пустые метаданные');
    if (isWorkClass(item) && !String(data.baseUrl || '').trim()) {
        const channel = await loadTypeChannelDevice(item);
        if (channel && typeof channel === 'object')
            data = { ...channel, ...data };
    }
    return sanitizeDevice(data);
}

/**
 * Канал API: у $provider — meta/$folder/$class/$ai (шаблон моделей);
 * иначе meta/$folder/$class/<type>.
 */
async function loadTypeChannelDevice(item) {
    try {
        const meta = await Promise.resolve(item.meta_folder);
        if (!meta || typeof meta.get_item !== 'function')
            return null;
        const typeId = item.type || meta.id;
        if (!typeId)
            return null;
        const channelType = typeId === '$provider' ? '$ai' : typeId;
        const proto = await meta.get_item('$folder/$class/' + channelType);
        if (!proto)
            return null;
        if (typeof proto.import === 'function')
            return await proto.import();
        if (typeof proto.get_item === 'function') {
            const file = await proto.get_item('class.js');
            if (file && typeof file.importScript === 'function')
                return await file.importScript();
        }
    }
    catch { /* нет канала типа */ }
    return null;
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

/**
 * Путь remote/ask: явный path → pathFromMap(brief) → (опц.) ls.
 * Если brief однозначно указывает потомка текущего path — берём потомка (не pickProviderPath).
 * Remote/ask: без дефолта на ls.path каталога.
 */
function resolveExplorePath(block, box, messages, defaultLabel, opts = {}) {
    const allowLsFallback = opts.allowLsFallback !== false;
    const query = opts.query || exploreQuery(block, box, messages, defaultLabel);
    let path = String(opts.path ?? block?.path ?? '').trim();
    if (path === '/')
        path = '';
    const label = String(block?.label || '').trim();
    if (!path && label && label !== defaultLabel && label.includes('/'))
        path = label;
    const fromMap = pathFromMap(box, query);
    if (!path && fromMap)
        path = fromMap;
    else if (path && fromMap) {
        const base = path.replace(/\/$/, '');
        if (fromMap.startsWith(base + '/'))
            path = fromMap;
    }
    if (!path && allowLsFallback) {
        const ls = (box?.items || []).findLast?.(b => b.type === 'ls' && b.path)
            || [...(box?.items || [])].reverse().find(b => b.type === 'ls' && b.path);
        if (ls?.path && String(ls.path) !== '/')
            path = String(ls.path);
    }
    return path && path !== '/' ? path : '';
}

/** Путь для remote — capability-узел (brief/карта), не последний ls каталога. */
function resolveRemotePath(block, box, messages) {
    return resolveExplorePath(block, box, messages, remoteTool.label, { allowLsFallback: false });
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
    const typeBit = type ? ' [тип: ' + type + ']' : '';
    const labelBit = label && label !== child.id ? ' — ' + label : '';
    const noteBit = note ? '\n  ' + note : '';
    return '- ' + childPath + labelBit + typeBit + noteBit + '\n  ' + readme;
}

/** Путь осмотра — класс с карты. Хвост-метапапка (/$…) — не класс: поднимаемся к родителю. */
function toClassPath(path) {
    const p = String(path || '').replace(/\/$/, '') || '/';
    const segs = p.split('/').filter(Boolean);
    if (segs.length && segs[segs.length - 1].startsWith('$')) {
        segs.pop();
        return { path: '/' + segs.join('/'), redirected: true };
    }
    return { path: p, redirected: false };
}

/** Корень `/` — один уровень тремя списками: классы, обычные папки, файлы (компас). */
async function listChildrenMap(path) {
    path = String(path || '/').trim() || '/';
    try {
        const root = await WORK.get_item(path);
        const kids = (await root?.children) || [];
        const classes = kids.filter(isWorkClass);
        const seen = new Set(classes.map(c => c.id || c.name));
        const plain = ((await root?.items) || [])
            .filter(c => !seen.has(c.id || c.name) && !FS_HIDE_IDS.includes(c.id || c.name));
        const folders = plain.filter(c => typeof c.read_text !== 'function');
        const files = plain.filter(c => typeof c.read_text === 'function');
        const tag = path === '/' ? '/' : ' ' + path;
        const lines = [];
        lines.push('[классы' + tag + ']');
        if (!classes.length)
            lines.push('(нет дочерних классов)');
        for (const child of classes.slice(0, MAP_ROOT_LIMIT)) {
            const id = child.id || child.name || '';
            if (!id)
                continue;
            const childPath = path === '/'
                ? (id.startsWith('/') ? id : '/' + id)
                : (path.replace(/\/$/, '') + '/' + id.replace(/^\//, ''));
            lines.push(await formatClassEntry(child, childPath));
        }
        if (classes.length > MAP_ROOT_LIMIT)
            lines.push('- … ещё ' + (classes.length - MAP_ROOT_LIMIT) + ' классов');
        lines.push('[папки' + tag + ']');
        if (!folders.length)
            lines.push('(нет)');
        for (const child of folders.slice(0, FS_LIST_LIMIT)) {
            const id = child.id || child.name || '';
            if (!id)
                continue;
            const childPath = path === '/'
                ? (id.startsWith('/') ? id : '/' + id)
                : (path.replace(/\/$/, '') + '/' + id.replace(/^\//, ''));
            lines.push(await formatPlainEntry(child, childPath, 'папка'));
        }
        if (folders.length > FS_LIST_LIMIT)
            lines.push('- … ещё ' + (folders.length - FS_LIST_LIMIT) + ' папок');
        lines.push('[файлы' + tag + ']');
        if (!files.length)
            lines.push('(нет)');
        for (const child of files.slice(0, FS_LIST_LIMIT)) {
            const id = child.id || child.name || '';
            if (!id)
                continue;
            const childPath = path === '/'
                ? (id.startsWith('/') ? id : '/' + id)
                : (path.replace(/\/$/, '') + '/' + id.replace(/^\//, ''));
            lines.push(await formatPlainEntry(child, childPath, 'файл'));
        }
        if (files.length > FS_LIST_LIMIT)
            lines.push('- … ещё ' + (files.length - FS_LIST_LIMIT) + ' файлов');
        return lines.join('\n');
    }
    catch {
        return '';
    }
}

/** Строка обычной папки/файла: `- /oda [папка]` + readme, если есть. Тяжёлые каталоги — без readme. */
async function formatPlainEntry(child, childPath, kind) {
    let readme = '';
    if (!FS_SHALLOW_IDS.includes(child.id || child.name)) {
        try {
            const r = await resolveReadme(child);
            if (r && (typeof r.read_text === 'function' || r.path))
                readme = '\n  readme: ' + (r.path || childPath.replace(/\/$/, '') + '/readme.md');
        }
        catch { /* нет readme */ }
    }
    return '- ' + childPath + ' [' + kind + ']' + readme;
}

/**
 * Ветка (не `/`): `info({ deep: LS_BRANCH_DEEP })` — два уровня (провайдер→модели и аналоги).
 * Не сырой json_model. Не unlimited deep=-1.
 */
async function listInfoDeep(path) {
    path = String(path || '').trim();
    if (!path || path === '/')
        return listChildrenMap('/');
    try {
        const root = await WORK.get_item(path);
        if (!root || typeof root.info !== 'function')
            return '';
        // Тяжёлый каталог — только первый уровень, без рекурсии внутрь пакетов.
        const shallow = FS_SHALLOW_IDS.includes(path.split('/').filter(Boolean).pop());
        const tree = await root.info({ deep: shallow ? 1 : LS_BRANCH_DEEP });
        const lines = ['[info ' + path + ' deep=' + (shallow ? 1 : LS_BRANCH_DEEP) + ']'];
        const state = { count: 0, limit: INFO_NODE_LIMIT };
        formatInfoTree(tree, lines, 0, state, shallow);
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

/** Класс — тип $…, кроме базовых $folder/$file. Пустой тип — обычная папка. */
function isClassType(t) {
    return !!t && t[0] === '$' && t !== '$folder' && t !== '$file';
}

function formatInfoTree(node, lines, depth, state, shallowKids = false) {
    if (!node || typeof node !== 'object' || state.count >= state.limit)
        return;
    const id = String(node.id || node.name || '').trim();
    if (id?.[0] === '.')
        return;
    if (FS_HIDE_IDS.includes(id))
        return;
    if (FS_SHALLOW_IDS.includes(id) && depth > 0)
        return;
    state.count++;
    const pad = '  '.repeat(depth);
    const p = String(node.path || node.short || '').trim();
    const pathBit = p || id || '?';
    const type = node.type ? ' [тип: ' + node.type + ']' : '';
    const labelRaw = String(node.label || '').trim();
    const labelBit = labelRaw && labelRaw !== id && labelRaw !== pathBit
        ? ' — ' + labelRaw
        : '';
    lines.push(pad + '- ' + pathBit + type + labelBit);
    // Тяжёлый каталог в корне осмотра — дети именами, внутрь не идём.
    if (shallowKids && depth === 0)
        return printShallowKids(node, lines, state);
    const kids = Array.isArray(node.items) ? node.items : [];
    // Порядок: классы → папки → файлы; blacklist-поддеревья не раскрываем.
    const ordered = [...kids].sort((a, b) => kindRank(a) - kindRank(b));
    for (const child of ordered) {
        if (state.count >= state.limit)
            break;
        formatInfoTree(child, lines, depth + 1, state, false);
    }
}

/** Дети тяжёлого каталога: имена первым уровнем, лимит FS_SHALLOW_LIMIT. */
function printShallowKids(node, lines, state) {
    const kids = Array.isArray(node.items) ? node.items : [];
    const ordered = [...kids].sort((a, b) => kindRank(a) - kindRank(b));
    const slice = ordered.slice(0, FS_SHALLOW_LIMIT);
    for (const child of slice) {
        if (state.count >= state.limit)
            break;
        state.count++;
        const id = String(child.id || child.name || '').trim();
        if (id?.[0] === '.' || FS_HIDE_IDS.includes(id))
            continue;
        const p = String(child.path || child.short || '').trim();
        lines.push('  - ' + (p || id));
    }
    if (kids.length > FS_SHALLOW_LIMIT)
        lines.push('  - … ещё ' + (kids.length - FS_SHALLOW_LIMIT) + ' записей');
}

/** 0 класс, 1 папка, 2 файл — для группировки детей уровня. */
function kindRank(node) {
    const t = node?.type || '';
    if (t === '$file')
        return 2;
    if (isClassType(t))
        return 0;
    return 1;
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

/** Путь с карты/ls: имя папки или label в query. Слово типа ($provider) не матчит все узлы. Неясно — пусто. */
/** Нормализация для мэппинга: транслит + без пробелов/дефисов («о Дант» → odant). */
export function normMap(s) {
    return translit(s).replace(/[\s\-_]+/g, '');
}

/** Кириллица→латиница для мэппинга: «одант» в brief находит /MODELS/odant на карте. */
export function translit(s) {
    const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
    return String(s || '').toLowerCase().split('').map(c => map[c] ?? c).join('');
}

function pathFromMap(box, query) {
    const blocks = (box?.items || []).filter(b =>
        (b.type === 'map' || b.type === 'ls') && b.content);
    if (!blocks.length)
        return '';
    const rows = [];
    for (const b of blocks) {
        for (const m of String(b.content).matchAll(/^\s*\- (\/[^\s(]+)([^\n]*)/gm))
            rows.push({ path: m[1], rest: m[2] || '' });
    }
    if (!rows.length)
        return '';
    const paths = [...new Set(rows.map(r => r.path))];
    const q = normMap(query);
    const hits = [];
    const ordered = [...paths].sort((a, b) => b.length - a.length);
    for (const p of ordered) {
        const token = normMap(p.replace(/^\//, ''));
        if (token.length >= 3 && q.includes(token))
            hits.push(p);
        else {
            const leaf = normMap(p.split('/').filter(Boolean).pop() || '');
            if (leaf.length >= 3 && q.includes(leaf))
                hits.push(p);
        }
    }
    for (const { path, rest } of rows) {
        const label = ((rest.match(/[—–-]\s*(.+)$/) || [])[1] || '').trim().toLowerCase();
        const words = label.split(/[^a-z0-9а-яё]+/i).filter(w => w.length >= 4);
        if (words.some(w => { w = normMap(w); return w.length >= 3 && q.includes(w); }))
            hits.push(path);
    }
    const uniq = [...new Set(hits)];
    if (uniq.length === 1)
        return uniq[0];
    if (uniq.length > 1) {
        const leafHits = uniq.filter(p => {
            const leaf = normMap(p.split('/').filter(Boolean).pop() || '');
            return leaf.length >= 3 && q.includes(leaf);
        });
        if (leafHits.length === 1)
            return leafHits[0];
        // цепочка предок→потомок — самый специфичный (длинный), не корень «модели»
        const sorted = [...uniq].sort((a, b) => b.length - a.length || a.localeCompare(b));
        const nested = sorted.every(o => sorted[0] === o || sorted[0].startsWith(o + '/') || o.startsWith(sorted[0] + '/'));
        if (nested)
            return sorted[0];
    }
    return '';
}

function parentPath(path) {
    const p = String(path || '').replace(/\/$/, '');
    const i = p.lastIndexOf('/');
    return i > 0 ? p.slice(0, i) : '';
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

/** readme.md в storage_folder (класс = meta; папка = сама). Нет своего — наследованный через ~/readme.md (виртуальная ФС, не прямой путь). */
async function resolveReadme(item) {
    if (!item)
        return null;
    const storage = item.storage_folder || item;
    if (typeof storage.get_item === 'function') {
        const file = await storage.get_item('readme.md');
        if (file)
            return file;
    }
    try {
        const inherited = await item.get_item('~/readme.md');
        const list = Array.isArray(inherited) ? inherited : (inherited ? [inherited] : []);
        const found = list.last || list[list.length - 1] || null;
        if (found && typeof found.read_text === 'function')
            return found;
    }
    catch { /* нет наследованного */ }
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
