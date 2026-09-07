/** Агент check: проверка постусловия после side (create/write). Read-only.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat, engine }).
 *  Не create/write и не web. Успешная проверка → live.goalDone. */

const AGENT_TAG = 'Проверка';

const existTool = {
    label: 'Есть ли путь',
    icon: 'icons:check-circle',
    role: 'user',
    ignore: true,
    description: 'убедиться что WORK item по пути существует (класс или файл)',
    system: [
        '# Режим: exist',
        'Первая строка — абсолютный путь WORK.',
        'Не создавай и не меняй. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь.',
        'Пример:',
        '/MODELS/BIS-Ollama/exaone3.5 7.8b',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const path = itemPath(b, params.box, existTool.label, params.messages);
        if (!path || path === '/')
            return false;
        tagAgent(params.box, AGENT_TAG, 'exist ' + path);
        const item = await WORK.get_item(path);
        b.path = path;
        b.label = path;
        if (!item) {
            b.error = true;
            b.content = '[exist ' + path + ']\nнет';
            return true;
        }
        const kind = isWorkClass(item) ? 'class' : (typeof item.read_text === 'function' ? 'file' : 'item');
        const type = item.type || item.constructor?.name || '';
        b.content = [
            '[exist ' + path + ']',
            'ok: ' + kind + (type ? ' (' + type + ')' : ''),
            item.label && item.label !== item.id ? 'label: ' + item.label : '',
        ].filter(Boolean).join('\n');
        return true;
    },
};

const metaTool = {
    label: 'Устройство item',
    icon: 'icons:settings',
    role: 'user',
    ignore: true,
    description: 'class.js устройства (importScript): model, baseUrl, … — сверка с целью',
    system: [
        '# Режим: meta / check',
        'Путь класса или файла — устройство через importScript.',
        'Сверь нужные поля с целью (model, path). Не меняй систему.',
    ].join('\n'),
    prompt: [
        'Путь item.',
        'Пример:',
        '/MODELS/BIS-Ollama/exaone3.5 7.8b',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const path = itemPath(b, params.box, metaTool.label, params.messages);
        if (!path || path === '/')
            return false;
        const target = await WORK.get_item(path);
        if (!target) {
            b.error = true;
            b.path = path;
            b.content = '[meta ' + path + ']\nнет item';
            return true;
        }
        b.path = path;
        b.label = path;
        tagAgent(params.box, AGENT_TAG, 'meta ' + path);
        try {
            const device = await loadItemDevice(target);
            const keys = ['model', 'baseUrl', 'protocol', 'label', 'icon', 'maxTokens'];
            const lines = ['[meta ' + path + ']'];
            for (const k of keys) {
                if (device[k] != null && device[k] !== '')
                    lines.push(k + ': ' + (typeof device[k] === 'string' ? device[k] : JSON.stringify(device[k])));
            }
            if (lines.length === 1)
                lines.push(JSON.stringify(device, null, 2));
            b.content = lines.join('\n');
            return true;
        }
        catch (e) {
            b.error = true;
            b.content = 'meta ' + path + ': ' + String(e.message || e);
            return true;
        }
    },
};

export default {
    label: 'Проверяю результат',
    icon: 'icons:verified-user',
    allowReasoning: true,
    description: 'проверка постусловия после work: путь есть, meta/поля совпадают с целью; не create и не write',
    system: [
        '# Агент: check',
        'Проверка, что side-effect из цели реально есть в WORK.',
        'Пути — из goal, create/write в ленте. exist и при необходимости meta.',
        'Не создавай и не правь. Не web. Не повторяй осмотр всей площадки (это explore).',
        'Нет пути для проверки — зафиксируй в итоге.',
    ].join('\n'),
    prompt: [
        'Краткий отчёт: что проверено, ok или gap.',
        'Только факты из items (exist/meta).',
    ].join('\n'),
    async init(params = {}) {
        const brief = String(params.block?.brief || '').trim();
        if (brief)
            tagAgent(params.block, AGENT_TAG, clip(brief, 48));
        else
            tagAgent(params.block, AGENT_TAG, 'постусловие');
    },
    finish(params = {}) {
        const items = params.block?.items || [];
        const data = items.filter(b => b.content && (b.type === 'exist' || b.type === 'meta'));
        if (!data.length)
            return;
        if (data.some(b => b.error))
            return;
        params.live?.goalDone?.();
    },
    tools: {
        exist: existTool,
        meta: metaTool,
    },
};

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

function itemPath(block, box, defaultLabel, messages) {
    const own = String(block?.path || '').trim();
    if (own && own !== '/')
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel && label.startsWith('/'))
        return label.split('\n')[0].trim();
    const raw = String(block?.content || '').replace(/\r\n/g, '\n').trim();
    const head = raw.split('\n').map(l => l.trim()).find(Boolean) || '';
    if (head.startsWith('/'))
        return head.replace(/^#+\s*/, '').trim();
    const fromCreate = (box?.items || []).findLast?.(b => b.type === 'create' && b.path && b.done && !b.error)
        || [...(box?.items || [])].reverse().find(b => b.type === 'create' && b.path && b.done && !b.error);
    if (fromCreate?.path)
        return String(fromCreate.path);
    const fromMsg = pathFromMessages(messages);
    if (fromMsg)
        return fromMsg;
    const brief = String(box?.brief || '').trim();
    const m = brief.match(/(\/MODELS\/[^\s]+)/);
    if (m)
        return m[1].replace(/\/$/, '');
    return '';
}

function pathFromMessages(messages) {
    if (!messages?.length)
        return '';
    for (let i = messages.length - 1; i >= 0; i--) {
        const c = String(messages[i]?.content || '');
        const create = c.match(/\[create\s+(\/[^\]]+?)\]/);
        if (create)
            return create[1].trim();
        const path = c.match(/(\/MODELS\/[^\s\]|]+)/);
        if (path)
            return path[1].replace(/[.,;:]+$/, '');
    }
    return '';
}

function isWorkClass(item) {
    if (!item)
        return false;
    if (typeof FS !== 'undefined' && FS.$class && item instanceof FS.$class)
        return true;
    return item.constructor?.name === '$class'
        || item.constructor?.name?.endsWith?.('$class') === true;
}

const SECRET_KEY = /^(apiKey|token|accessToken|password|secret|authorization|privateKey)$/i;

async function loadItemDevice(item) {
    if (!item)
        throw new Error('нет item');
    let data;
    const metaFile = item.meta_file;
    if (metaFile && typeof metaFile.importScript === 'function')
        data = await metaFile.importScript();
    else if (typeof item.import === 'function' && isWorkClass(item))
        data = await item.import();
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
