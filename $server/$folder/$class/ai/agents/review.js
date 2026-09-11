/** Агент review: разбор этой ленты. Диагноз + слот слой/path. Не пишет канон.
 *  Операнд — схема task.body, не простыня draft. step: false. Не в pipe навыка. */

const CLIP = 400;

const diagnoseTool = {
    label: 'Диагноз',
    icon: 'carbon:debug',
    role: 'user',
    allowReasoning: true,
    description: 'схема ленты → закон + слой + один path',
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const body = await params.task?.body;
        if (!body) {
            b.error = true;
            b.content = 'review: нет тела задачи';
            return true;
        }
        const outline = tapeOutline(body, params.box);
        params.box.outline = outline;
        const claim = String(params.box.brief || b.brief || '').trim() || '(без претензии — разбери ход ленты)';
        const chat = params.streamChat;
        if (typeof chat !== 'function') {
            b.error = true;
            b.content = 'review: нет streamChat';
            return true;
        }
        const addrs = await runtimeAddrs(params);
        const res = await chat({
            messages: [
                { role: 'system', content: DIAG_SYSTEM },
                { role: 'user', content: [addrs, outline, '[претензия]', claim].join('\n\n') },
            ],
        });
        b.content = String(res?.content || '').trim() || 'review: пустой диагноз';
        b.done = true;
        const slot = parseSlot(b.content);
        if (slot)
            params.box.slot = slot;
        params.box.using_blocks = ['diagnose', 'total'];
        return true;
    },
};

const confirmTool = {
    label: 'Принять диагноз',
    icon: 'icons:check-box-outline-blank',
    description: 'зафиксировать слой и path; правку не запускать',
    stop: 'Принять',
    async init(params = {}) {
        const diag = (params.box.items || []).find(x => x.type === 'diagnose' && x.content);
        if (!diag) {
            params.block.error = true;
            params.block.content = 'review: нет диагноза';
            return true;
        }
        const slot = params.box.slot || parseSlot(diag.content);
        const head = slot
            ? 'слой: ' + slot.layer + '\npath: ' + slot.path + '\n\n'
            : '';
        params.block.content = head + String(diag.content).trim() + '\n\n[instruction]\n'
            + 'APPROVE — принять адрес. Правка — отдельная постановка или @work с этим path.';
        return true;
    },
    async approve(params = {}) {
        params.block.icon = 'icons:check-circle';
        params.box.using_blocks = ['diagnose', 'confirm'];
    },
};

export default {
    label: 'Разбираю ленту',
    icon: 'carbon:debug',
    role: 'user',
    doc: true,
    step: false,
    stopOnError: true,
    allowReasoning: true,
    description: 'диагноз этой ленты: закон + слой + path; не пишет файлы',
    system: [
        '# Агент: review',
        'Операнд — схема ленты этой задачи, не HTML draft.',
        'Диагноз: что сломалось, какой закон, один слой и один path (откуда runtime читает).',
        'Не патч, не work, не новая цель. Не класть review в pipe навыка.',
    ].join('\n'),
    async init(params = {}) {
        params.block.using_blocks = ['confirm', 'total'];
        return true;
    },
    tools: {
        diagnose: diagnoseTool,
        confirm: confirmTool,
    },
};

const DIAG_SYSTEM = [
    '# Режим: диагноз ленты',
    'Ты рецензент, не оркестратор исходной цели и не писатель файлов.',
    'По схеме ленты, претензии и [адреса runtime]: прошло / дыра / один закон.',
    'В конце ровно две строки:',
    'слой: пакет | $task | meta | инвентарь',
    'path: один WORK-путь, откуда runtime читает (не копия агента в USER).',
    'Не предлагай патч-код. Не выдумывай блоки вне схемы.',
].join('\n');

async function runtimeAddrs(params) {
    const lines = ['[адреса runtime]'];
    try {
        const ai = await params.engine?._aiPackage?.();
        const root = ai?.short || ai?.path;
        if (root)
            lines.push('слой пакет: ' + String(root).replace(/\/$/, '') + '/agents/{id}.js — код агента, который исполняется');
    }
    catch { /* нет пакета */ }
    lines.push('слой $task: тип $file/$task (class.js) — меню, goal, lookOnly; не файл ai.task в профиле');
    lines.push('слой meta: ai/config.js и system.md места исполнения');
    lines.push('слой инвентарь: create ребёнка у родителя (провайдер, журнал) — пикер и состав мира');
    lines.push('копия ai/agents в USER без смены loadAgent не исполняется');
    return lines.join('\n');
}

function parseSlot(text) {
    const layer = String(text || '').match(/^\s*слой:\s*(пакет|\$task|meta|инвентарь)\s*$/im);
    const path = String(text || '').match(/^\s*path:\s*(\/\S+)/im);
    if (!path)
        return null;
    return { layer: layer ? layer[1] : '', path: path[1] };
}

function tapeOutline(body, self) {
    const lines = [];
    const g = body.goal;
    if (g) {
        lines.push('[goal]', String(g.text || '').trim(),
            'status: ' + (g.status || ''),
            'need: ' + (g.need || 'side'));
        if (g.resume?.agent)
            lines.push('resume: ' + g.resume.agent);
        if (g.resume?.continue)
            lines.push('resume: continue');
    }
    if (body.using_blocks?.length)
        lines.push('using: ' + body.using_blocks.join(', '));
    if (body.model)
        lines.push('model: ' + body.model);
    lines.push('', '[лента]');
    walkTape(body.items, lines, 0, self);
    return lines.join('\n');
}

function walkTape(items, lines, depth, skip) {
    const pad = '  '.repeat(depth);
    for (const b of items || []) {
        if (!b || b === skip)
            continue;
        const bits = [b.type];
        if (b.label && b.label !== b.type)
            bits.push(b.label);
        if (b.error)
            bits.push('error');
        if (b.state)
            bits.push(b.state);
        if (b.url)
            bits.push(b.url);
        if (b.budget)
            bits.push('ok=' + (b.budget.ok ?? 0) + '/' + (b.budget.limit ?? '?'));
        if (b.draft)
            bits.push('draft:' + String(b.draft).length);
        if (b.content)
            bits.push('content:' + String(b.content).length);
        if (b.using_blocks?.length)
            bits.push('using=' + b.using_blocks.join(','));
        lines.push(pad + '- ' + bits.join(' '));
        if (b.type === 'prompt' && b.content)
            lines.push(pad + '  «' + clip(b.content, 200) + '»');
        if ((b.type === 'answer' || b.type === 'question' || b.type === 'thinking') && b.content)
            lines.push(pad + '  «' + clip(b.content, CLIP) + '»');
        if (b.items?.length && b.type !== 'review')
            walkTape(b.items, lines, depth + 1, skip);
    }
}

function clip(text, max) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max)
        return s;
    return s.slice(0, max).trimEnd() + '…';
}
