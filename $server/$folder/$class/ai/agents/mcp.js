/** Агент mcp: маркет внешних MCP-серверов — поиск, оценка, установка.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat, engine, callAgent, task }).
 *  Установка — только через work.create (с его activation-гейтом): mcp готовит
 *  спецификацию, work создаёт класс, mcp проверяет smoke tools/list.
 *  Секреты — только secret:ФАЙЛ (#secret), открытым текстом в class.js запрещены. */

const AGENT_TAG = 'MCP';

/** Заведомо рабочие stdio-пресеты (reference-серверы, без секретов). */
const PRESETS = {
    time: {
        id: 'Time',
        label: 'Время',
        package: '@modelcontextprotocol/server-time',
        description: 'Время и часовые пояса (MCP reference: time)',
    },
    filesystem: {
        id: 'Filesystem',
        label: 'Файлы (MCP)',
        package: '@modelcontextprotocol/server-filesystem',
        description: 'Файлы песочницы через внешний MCP (reference: filesystem)',
    },
    fetch: {
        id: 'Fetch',
        label: 'Fetch (MCP)',
        package: '@modelcontextprotocol/server-fetch',
        description: 'Чтение веб-страниц через внешний MCP (reference: fetch)',
    },
    memory: {
        id: 'Memory',
        label: 'Память (MCP)',
        package: '@modelcontextprotocol/server-memory',
        description: 'Память агента между сессиями (reference: memory)',
    },
    sqlite: {
        id: 'Sqlite',
        label: 'SQLite (MCP)',
        package: '@modelcontextprotocol/server-sqlite',
        description: 'Локальная БД через внешний MCP (reference: sqlite)',
    },
    puppeteer: {
        id: 'Puppeteer',
        label: 'Браузер (MCP)',
        package: '@modelcontextprotocol/server-puppeteer',
        description: 'Скриншоты и автоматизация браузера (reference: puppeteer)',
    },
};

const searchTool = {
    label: 'Ищу сервер',
    icon: 'icons:search',
    role: 'user',
    allowReasoning: true,
    description: 'поиск MCP-серверов на маркете (Smithery): кандидаты с сигналами доверия',
    system: [
        '# Режим: поиск MCP',
        'Одна строка — что искать (домен/сервис/инструмент).',
        'Источники: маркет Smithery (публичный API) + заведомо известные reference.',
        'Не выдумывай серверы. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Что искать на маркете MCP.',
        'Пример: postgres',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        tagAgent(params.box, AGENT_TAG, 'маркет…');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done || b.error)
            return;
        const query = searchQuery(b, params.box, params.messages);
        if (!query)
            return;
        b.state = query;
        tagAgent(params.box, AGENT_TAG, 'маркет: ' + clip(query, 40));
        let cards = [];
        try {
            cards = await searchMarket(query);
        }
        catch (e) {
            b.error = true;
            b.state = 'ошибка';
            b.content = 'mcp search: маркет недоступен: ' + String(e.message || e);
            return;
        }
        const refs = referenceHits(query);
        b.content = formatSearchResults(query, cards, refs);
        b.done = true;
        b.state = 'ok';
    },
};

const inspectTool = {
    label: 'Оцениваю сервер',
    icon: 'icons:verified-user',
    role: 'user',
    allowReasoning: true,
    description: 'карточка оценки кандидата: доверие, транспорт, секреты, scope; вердикт ставить/нет',
    system: [
        '# Режим: оценка MCP',
        'Кандидат — строка из search (qualifiedName) или пресет (time/fetch/filesystem/memory/sqlite/puppeteer).',
        'Проверь: verified/useCount (маркет), транспорт (stdio — ставим; только remote — отказ: нужен HTTP-транспорт), секреты (есть — только через #secret), scope (что отдаём: файлы? сеть? ключи?).',
        'Вердикт в конце: ставить (+спецификация) или нет (+причина). Не выдумывай поля сервера.',
    ].join('\n'),
    prompt: [
        'Кандидат: qualifiedName из search или пресет.',
        'Пример: time',
        'Последняя строка content — машиночитаемо: [вердикт: ставить time fetch | отказ].',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        tagAgent(params.box, AGENT_TAG, 'оценка…');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done || b.error)
            return;
        const name = inspectName(b, params.box, params.messages);
        if (name) {
            // Прямой пресет — вердикт строит код, не модель.
            const verdict = await inspectCandidate(name, params);
            b.content = verdict.text;
            b.candidate = verdict.spec || undefined;
            b.done = true;
            b.state = verdict.ok ? 'ставить' : 'отказ';
            tagAgent(params.box, AGENT_TAG, verdict.ok ? 'ставить: ' + name : 'отказ: ' + name);
            if (verdict.ok)
                rearmActivation(params.box);
            return;
        }
        // Таблица от fill: вердикт «ставить» переводим в данные (candidate),
        // иначе install нечем потребить. Нет вердиктов — ждём, не ошибаемся.
        const hit = parseVerdictTable(b.content);
        if (!hit) {
            // Машиночитаемая строка вердикта — второй шанс после таблицы.
            const machine = parseMachineVerdict(b.content);
            if (machine)
                return applyMachineVerdict(machine, b, params);
            // Проза без вердикта, но с телом — честный исход «обзор», не висяк.
            if (hasBodyText(b.content)) {
                b.done = true;
                b.state = 'обзор';
                return;
            }
            return;
        }
        if (hit.decision === 'install') {
            const verdict = await inspectCandidate(hit.id, params);
            if (verdict.ok) {
                b.candidate = verdict.spec;
                b.done = true;
                b.state = 'ставить';
                tagAgent(params.box, AGENT_TAG, 'ставить: ' + hit.id);
                rearmActivation(params.box);
            }
            else {
                b.done = true;
                b.state = 'отказ';
                tagAgent(params.box, AGENT_TAG, 'отказ: ' + hit.id);
            }
            return;
        }
        b.done = true;
        b.state = 'отказ';
        tagAgent(params.box, AGENT_TAG, 'отказ: ' + hit.id);
    },
};

/** Машиночитаемая строка вердикта `[вердикт: ставить time fetch | отказ]`. */
export function parseMachineVerdict(text) {
    const m = String(text || '').match(/\[вердикт:\s*([^\]]+)\]/i);
    if (!m)
        return null;
    const frag = m[1].toLowerCase();
    if (/отказ/.test(frag))
        return { decision: 'refuse', id: '' };
    const tokens = new Set(frag.split(/[^a-zа-яё0-9]+/i).filter(Boolean));
    for (const id of Object.keys(PRESETS)) {
        if (tokens.has(id))
            return { id, decision: 'install' };
    }
    return { decision: 'refuse', id: '' };
}

/** Применить машинный вердикт к блоку: candidate + done/state + re-arm. */
async function applyMachineVerdict(machine, b, params) {
    if (machine.decision === 'install') {
        const verdict = await inspectCandidate(machine.id, params);
        if (verdict.ok) {
            b.candidate = verdict.spec;
            b.done = true;
            b.state = 'ставить';
            tagAgent(params.box, AGENT_TAG, 'ставить: ' + machine.id);
            rearmActivation(params.box);
            return true;
        }
    }
    b.done = true;
    b.state = 'отказ';
    tagAgent(params.box, AGENT_TAG, 'отказ' + (machine.id ? ': ' + machine.id : ''));
    return true;
}

function hasBodyText(content) {
    return !!String(content || '').trim();
}
export function parseVerdictTable(text) {
    const lines = String(text || '').split('\n');
    let refused = null;
    for (const raw of lines) {
        const line = raw.toLowerCase();
        const tokens = new Set(line.split(/[^a-zа-яё0-9]+/i).filter(Boolean));
        for (const id of Object.keys(PRESETS)) {
            if (!tokens.has(id))
                continue;
            const positive = /✅|ставить/.test(line) && !/не ставить|отказ|не рекоменд/.test(line);
            const negative = /❌|⛔|не ставить|отказ|не рекоменд/.test(line);
            if (positive)
                return { id, decision: 'install' };
            if (negative && !refused)
                refused = { id, decision: 'refuse' };
        }
    }
    return refused;
}

const installTool = {
    label: 'Ставлю сервер',
    icon: 'icons:download',
    role: 'user',
    allowReasoning: true,
    description: 'создать SERVICES/<Имя> через work (с его approval) + smoke tools/list; только после inspect-вердикта «ставить»',
    system: [
        '# Режим: установка MCP',
        'Ставить — только кандидата с вердиктом «ставить» из inspect в этом боксе.',
        'Создание — только через вложенный work (его activation-гейт обязателен, не обходить).',
        'После create — smoke mcp_list_tools, итог в content. Секреты — только secret:ФАЙЛ.',
        'Нет вердикта — не выдумывай, вернись к inspect.',
    ].join('\n'),
    prompt: [
        'Что ставить: пресет (time/filesystem/fetch) — inspect выше должен дать «ставить».',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        tagAgent(params.box, AGENT_TAG, 'установка…');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done || b.error)
            return;
        const spec = installSpec(b, params.box, params.messages);
        if (!spec) {
            b.error = true;
            b.state = 'ошибка';
            b.content = 'mcp install: нет вердикта «ставить» из inspect — сначала inspect';
            return;
        }
        b.spec = spec;
        b.state = spec.id;
        tagAgent(params.box, AGENT_TAG, 'ставлю ' + spec.id);
        // Создание — вложенным work: его activation-гейт решает, спрашивать человека или нет.
        const section = buildCreateSection(spec);
        let res;
        try {
            res = await params.callAgent('work', section);
        }
        catch (e) {
            b.error = true;
            b.state = 'ошибка';
            b.content = 'mcp install: work не создал класс: ' + String(e.message || e);
            return;
        }
        if (!res || res.skip || res.error) {
            b.error = true;
            b.state = 'ошибка';
            b.content = 'mcp install: work не довёл создание (' + (res?.state || 'skip') + ')'
                + (res?.content ? '\n\n' + res.content : '');
            return;
        }
        // Smoke: сервер обязан ответить tools/list.
        try {
            const item = await WORK.get_item('/SERVICES/' + spec.id);
            if (!item || typeof item.mcp_list_tools !== 'function')
                throw new Error('нет mcp_list_tools у /SERVICES/' + spec.id);
            const tools = await params.exec(item, { method: 'mcp_list_tools', args: {} }, { block: b });
            const names = Array.isArray(tools?.tools)
                ? tools.tools.map(t => t.name).filter(Boolean)
                : [];
            b.path = '/SERVICES/' + spec.id;
            b.done = true;
            b.state = 'ok';
            b.content = formatInstallResult(spec, names, res.content);
            tagAgent(params.box, AGENT_TAG, 'стоит: ' + spec.id);
        }
        catch (e) {
            b.error = true;
            b.state = 'ошибка';
            b.content = 'mcp install: smoke tools/list провален: ' + String(e.message || e);
        }
    },
};

/** Письмо человеку за разрешением ставить. Без принятого activation install не ходит. */
const activationTool = {
    label: 'Требуется установка',
    icon: 'icons:check-box-outline-blank',
    description: 'Письмо человеку на установку: что поставлю, scope, секреты, что не трону. Только после inspect-вердикта «ставить»',
    prompt: `Письмо человеку за разрешением установить MCP-сервер. Сейчас ты только изучаешь (разведка); без подтверждения ничего не создавай.
Структура письма:
- Зачем: одна строка, какую задачу закроет сервер (из фактов ленты, не из памяти).
- Что поставлю: SERVICES/<Id> ($service): пакет npx, scope (файлы/сеть/память), секреты (нет или secret:ФАЙЛ).
- Что не трону: одной строкой.
Плохо: скобки tool-вызовов, JSON профиля, тела class.js. Хорошо: короткие строки плана.
`,
    stop: 'Установить',
    async init(params = {}) {
        // Нечего ставить — тихий пропуск без красного (тип сгорает, verdict перевооружит).
        if (!installCandidate(params.box)) {
            const used = params.box.using_blocks ??= [];
            if (!used.includes('activation'))
                used.push('activation');
            return false;
        }
        tagAgent(params.box, AGENT_TAG, 'нужна установка');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        const text = String(b?.content || '').replace(/\r\n/g, '\n').trim();
        const head = text.split('\n').find(Boolean) || '';
        // Нет кандидата — письмо не о чем: сначала inspect с вердиктом.
        if (!installCandidate(params.box)) {
            delete b.stop;
            b.error = true;
            b.content = 'activation: нечего ставить — сначала inspect с вердиктом «ставить»';
            dropUsed(params.box, 'activation');
            tagAgent(params.box, AGENT_TAG, 'вердикта нет');
            return;
        }
        if (!text || /^\[activation[^\]]*\]\s*$/i.test(text) || /^\s*\[(read|ls|search|write|create|meta|ask|typed|remote)\b/i.test(head)) {
            delete b.stop;
            b.error = true;
            b.content = 'activation: нужно письмо человеку (зачем, что поставлю, что не трону) — не пусто, не тег и не вызов tool в скобках';
            dropUsed(params.box, 'activation');
            tagAgent(params.box, AGENT_TAG, 'план не принят');
            return;
        }
        const first = text.split('\n').find(Boolean) || '';
        if (first)
            tagAgent(params.box, AGENT_TAG, clip(first, 48));
    },
    async approve(params = {}) {
        (await params.task.body).mode = 'build';
        params.block.icon = 'icons:check-circle';
    },
};

export default {
    label: 'Подключаю MCP',
    icon: 'icons:extension',
    doc: true,
    box: true,
    expand: true,
    allowReasoning: true,
    // Программный вызов work — только из install через callAgent;
    // в nested его нет: в меню — лишь то, что модель выбирает осмысленно.
    nested: [],
    tools: {
        search: searchTool,
        inspect: inspectTool,
        install: installTool,
    },
    description: 'маркет MCP-серверов: поиск, оценка, установка в SERVICES/ (с approval). Звать когда нужен внешний инструмент',
    system: [
        '# Агент: mcp',
        'Внешние инструменты — через маркет и установку, не из памяти.',
        'Порядок: search (кандидаты) → inspect (вердикт) → activation (письмо) → install (только в build).',
        'Первый ход бокса — всегда search; install и activation до вердикта запрещены.',
        'Локальное раньше внешнего — но маркет ищет то, чего нет в системе.',
        'Секреты — только secret:ФАЙЛ. Нет вердикта — нет установки.',
    ].join('\n'),
    prompt: 'Кратко: найденные серверы, вердикты, что установлено (пути SERVICES/). Без выдуманных серверов.',
    async init(params = {}) {
        const brief = String(params.block?.brief || '').trim();
        if (brief)
            tagAgent(params.block, AGENT_TAG, clip(brief, 48));
    },
    /** После итога — обратно в plan. */
    finish(params = {}) {
        const live = params.live;
        if (live && live.mode === 'build')
            live.mode = 'plan';
    },
    plan: {
        description: 'поиск и оценка; install — после activation',
        system: [
            'search (маркет Smithery), inspect (вердикт «ставить»/«отказ»).',
            'Ставить — только через activation-письмо человеку и build.',
            'Activation — письмо на кнопку; вердикт до неё — tool inspect, не текст activation.',
            'Нет кандидата — не выдумывай. Недостающее у человека — наружу (question).',
        ].join('\n'),
        tools: {
            activation: activationTool,
            search: searchTool,
            inspect: inspectTool,
        },
    },
    build: {
        description: 'установка вердикта из inspect',
        system: [
            'После принятой activation — сразу install (вердикт из inspect-блоков бокса), не повтор search/inspect.',
            'Создание — вложенным work, smoke mcp_list_tools — итог.',
            'Нет вердикта — не выдумывай.',
        ].join('\n'),
        tools: {
            install: installTool,
        },
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

function dropUsed(box, type) {
    const list = box?.using_blocks;
    if (!list)
        return;
    const i = list.indexOf(type);
    if (i >= 0)
        list.splice(i, 1);
    if (!list.length)
        delete box.using_blocks;
}

/** Перевооружение activation после вердикта: тип снова доступен в меню. */
function rearmActivation(box) {
    const used = box?.using_blocks;
    if (!used)
        return;
    const i = used.indexOf('activation');
    if (i >= 0)
        used.splice(i, 1);
    if (!used.length)
        delete box.using_blocks;
}

/** Кандидат на установку: вердикт inspect в боксе (та же функция, что у install). */
function installCandidate(box) {
    return installSpec({}, box, []);
}

/** Запрос маркету: brief/контент/head. */
function searchQuery(block, box, messages) {
    const raw = String(block?.content || '').replace(/\r\n/g, '\n').trim();
    if (raw) {
        const head = raw.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
        if (head && !head.startsWith('/') && !head.startsWith('['))
            return head.slice(0, 120);
    }
    const brief = String(box?.brief || lastUserContent(messages) || '').trim();
    const m = brief.match(/mcp\s+(?:найди|поиск|search)?\s*(.+)/i) || brief.match(/^(.+)$/);
    return String(m?.[1] || brief).trim().slice(0, 120);
}

/** Маркет Smithery: публичный поиск, без ключа. */
async function searchMarket(query) {
    const res = await fetch('https://registry.smithery.ai/servers?q='
        + encodeURIComponent(query) + '&pageSize=10', {
        signal: AbortSignal.timeout(15000),
        headers: { 'Accept': 'application/json' },
    });
    if (!res.ok)
        throw new Error('Smithery HTTP ' + res.status);
    const data = await res.json();
    return (data?.servers || []).map(s => ({
        name: String(s.qualifiedName || s.displayName || '').trim(),
        title: String(s.displayName || s.qualifiedName || '').trim(),
        description: String(s.description || '').trim().slice(0, 300),
        verified: !!s.verified,
        useCount: Number(s.useCount) || 0,
        remote: !!s.remote,
        homepage: String(s.homepage || '').trim(),
    })).filter(s => s.name);
}

/** Reference-пресеты, бьющиеся с запросом (транслит — как в explore). */
function referenceHits(query) {
    const q = normMap(query);
    return Object.entries(PRESETS)
        .filter(([id, p]) => normMap(id).length >= 3 && (q.includes(normMap(id)) || q.includes(normMap(p.label || ''))))
        .map(([id, p]) => ({ preset: id, ...p }));
}

function normMap(s) {
    const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
    return String(s || '').toLowerCase().split('').map(c => map[c] ?? c).join('').replace(/[\s\-_]+/g, '');
}

function formatSearchResults(query, cards, refs) {
    const lines = ['[mcp search: ' + query + ']'];
    for (const p of refs)
        lines.push('- пресет ' + p.preset + ' — ' + p.description + ' (npx ' + p.package + ')');
    const seen = new Set(refs.map(r => normMap(r.preset)));
    for (const c of cards.slice(0, 10)) {
        if (seen.has(normMap(c.name)))
            continue;
        lines.push('- ' + c.name + (c.verified ? ' [verified]' : '')
            + (c.useCount ? ' (use: ' + c.useCount + ')' : '')
            + (c.remote ? ' [remote]' : '')
            + (c.title && c.title !== c.name ? ' — ' + c.title : '')
            + (c.description ? '\n  ' + c.description : ''));
    }
    if (lines.length === 1)
        lines.push('(пусто — маркет ничего не дал)');
    return lines.join('\n');
}

/** Кандидат на оценку: пресет из brief/контента. Маркет-записи без stdio-команды — не кандидаты на установку. */
function inspectName(block, box, messages) {
    const raw = String(block?.content || '').replace(/\r\n/g, '\n').trim();
    const head = raw.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
    const brief = String(box?.brief || '').trim() + '\n' + lastUserContent(messages);
    const text = (head + '\n' + brief).toLowerCase();
    for (const id of Object.keys(PRESETS)) {
        if (text.includes(id))
            return id;
    }
    return '';
}

async function inspectCandidate(name, params) {
    const preset = PRESETS[name];
    if (!preset)
        return { ok: false, text: '[mcp inspect: ' + name + ']\nотказ: не пресет и нет stdio-команды (remote-серверы — нужен HTTP-транспорт, долг)' };
    const dir = presetOperand(params);
    const spec = {
        id: preset.id,
        label: preset.label,
        package: preset.package,
        description: preset.description,
        args: name === 'filesystem' ? ['-y', preset.package, dir]
            : name === 'sqlite' ? ['-y', preset.package, dir + '\\work.db']
            : ['-y', preset.package],
    };
    const scope = name === 'filesystem' ? 'файлы ' + dir
        : name === 'sqlite' ? 'БД ' + dir + '\\work.db'
        : name === 'fetch' ? 'сеть (чтение страниц)'
        : name === 'puppeteer' ? 'браузер, сеть (скриншоты)'
        : name === 'memory' ? 'память между сессиями'
        : 'часы/пояса (без доступа к данным)';
    const lines = [
        '[mcp inspect: ' + name + ']',
        'сервер: ' + preset.package + ' (reference, npx stdio)',
        'scope: ' + scope,
        'секреты: не нужны',
        transportLine(spec),
        'вердикт: ставить',
    ];
    return { ok: true, spec, text: lines.join('\n') };
}

function transportLine(spec) {
    return 'транспорт: stdio `' + 'npx ' + spec.args.join(' ') + '`';
}

/** Операнд пресета с путём (filesystem root, sqlite файл): явный путь в brief, иначе песочница. */
function presetOperand(params) {
    const brief = String(params.box?.brief || '').trim();
    const m = brief.match(/([A-Za-z]:\\[^\s]+|\/[^\s]+)/);
    if (m)
        return m[1];
    return 'C:\\Users\\Acer\\AppData\\Local\\Temp\\opencode';
}

/** Спецификация установки: только вердикт inspect в боксе. Без вердикта не ставим. */
function installSpec(block, box, messages) {
    for (const b of [...(box?.items || [])].reverse()) {
        if (b?.type === 'inspect' && b?.candidate && !b.error)
            return b.candidate;
    }
    return null;
}

/** Секция work.create: родитель + тип + id + class.js. */
function buildCreateSection(spec) {
    const classJs = [
        'export default {',
        "    icon: 'carbon:api',",
        "    label: '" + spec.label.replace(/'/g, '') + "',",
        "    description: '" + spec.description.replace(/'/g, '') + "',",
        "    capabilities: ['mcp'],",
        '    mcp: {',
        "        command: 'npx',",
        '        args: [' + spec.args.map(a => "'" + String(a).replace(/\\/g, '\\\\').replace(/'/g, '') + "'").join(', ') + '],',
        '        env: {},',
        '    },',
        '};',
    ].join('\n');
    return [
        '/SERVICES',
        '$service',
        spec.id,
        spec.label,
        '```js',
        classJs,
        '```',
    ].join('\n');
}

function formatInstallResult(spec, names, workContent) {
    const lines = [
        '[mcp install ' + '/SERVICES/' + spec.id + ']',
        'ok: tools/list ответил (' + names.length + ' инструментов)',
        ...names.slice(0, 30).map(n => '- ' + n),
    ];
    if (names.length > 30)
        lines.push('- … ещё ' + (names.length - 30));
    return lines.join('\n');
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
