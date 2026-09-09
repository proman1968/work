/** Агент check: постусловие после side (create/write). Read-only.
 *  Контракт:
 *    block.targets[] = { path, kind: class|file, expect? } из evidence операций;
 *    create → exist (класс, type/id) → file class.js (устройство читается) → file readme.md (непустой);
 *    write → exist → file (непустой / сниппет из секции write);
 *    без доменных полей (model и т.п.) — только выполнение операции.
 *  Блоки в ленте: `exist` (путь) и `file` (любой файл: path реальный, тело в content); критерий — `crit`.
 *  goalDone только полное соответствие; enrichTotal — сводка.
 *  Движок: init({ block, box, messages, session, agent, live, exec, streamChat, engine }).
 */

const AGENT_TAG = 'Проверка';

const existTool = {
    label: 'Есть ли путь',
    icon: 'icons:check-circle',
    role: 'user',
    ignore: true,
    description: 'WORK.get_item: путь из targets существует',
    system: [
        '# Режим: exist',
        'Путь из targets. Пробелы в id сохраняй. Не меняй систему.',
    ].join('\n'),
    prompt: 'Путь WORK из targets.',
    async init(params = {}) {
        return toolStep(params, 'exist');
    },
};

const fileTool = {
    label: 'Файл',
    icon: 'icons:description',
    role: 'user',
    ignore: true,
    description: 'файл target (class.js / readme.md / файл write): есть, читается, непустой',
    system: [
        '# Режим: file',
        'Файл из targets. Только чтение. Не меняй систему.',
    ].join('\n'),
    prompt: 'Путь файла из targets.',
    async init(params = {}) {
        return toolStep(params, 'file');
    },
};

export default {
    label: 'Проверяю результат',
    icon: 'icons:verified-user',
    allowReasoning: true,
    description: 'постусловие create/write: путь, class.js/readme или содержимое файла; не предметные поля',
    system: [
        '# Агент: check',
        'Постусловие side-effect: операция create/write из ленты выполнена.',
        'targets = [create …] (классы) и [write …] (файлы) из контекста.',
        'Класс: exist (класс, type/id из секции create) → file class.js (читается, есть icon) → file readme.md в storage_folder (непустой, актуален).',
        'Файл: exist → file (непустой / согласован с секцией write).',
        'Write class.js без обновлённого readme того же класса — gap. class.js без icon из реального набора ODA (carbon:, icons:, ai:, lineawesome:, bootstrap:, iconoir:, editor:) — gap. Набора register: нет.',
        'Не сверяй предметные поля устройства (model и т.п.) — это не роль check; icon обязателен как поле UI.',
        'goalDone только когда все критерии по всем targets ok.',
        'Не создавай и не правь. Не web. Не осмотр системы (explore).',
    ].join('\n'),
    prompt: [
        'Краткий отчёт: по каждому target — критерии ok или gap.',
        'Только факты из items.',
    ].join('\n'),
    async init(params = {}) {
        const box = params.block;
        const messages = params.messages || [];
        box.targets = collectTargets(messages);
        const n = box.targets.length;
        tagAgent(box, AGENT_TAG, n ? (n + ' target' + (n > 1 ? 's' : '')) : 'нет targets');
        if (!n)
            return;
        box.items ??= [];
        for (const t of box.targets) {
            await verifyTarget(box, t, messages);
        }
        settleCheckTools(box);
        await params.live?.save?.();
    },
    finish(params = {}) {
        const box = params.block;
        if (!box)
            return;
        ensureTargets(box, params.messages);
        if (allTargetsFullyOk(box))
            params.live?.goalDone?.();
    },
    enrichTotal(_content, block) {
        return formatCheckReport(block);
    },
    tools: {
        exist: existTool,
        file: fileTool,
    },
};

/** Донабор, если init не закрыл всё (обрыв). */
async function toolStep(params, kind) {
    const b = params.block;
    const box = params.box;
    if (b.content)
        return false;
    ensureTargets(box, params.messages);
    if (allTargetsFullyOk(box) || allTargetsSettled(box)) {
        settleCheckTools(box);
        return false;
    }
    const next = nextIncomplete(box);
    if (!next)
        return false;
    const { t, crit } = next;
    if (kind === 'exist') {
        if (crit !== 'exist')
            return false;
        await fillExist(b, t);
    }
    else {
        if (crit === 'exist')
            return false;
        await fillCriterion(b, t, crit);
    }
    tagAgent(box, AGENT_TAG, crit + ' ' + t.path);
    pushMsg(params.messages, b);
    settleIfDone(box);
    return true;
}

async function verifyTarget(box, t, messages) {
    for (const crit of criteriaFor(t)) {
        const b = crit === 'exist'
            ? { type: 'exist', label: existTool.label, icon: 'icons:check-circle', time: Date.now() }
            : { type: 'file', label: fileTool.label, icon: 'icons:description', time: Date.now() };
        if (crit === 'exist')
            await fillExist(b, t);
        else
            await fillCriterion(b, t, crit);
        box.items.push(b);
        pushMsg(messages, b);
        if (crit === 'exist' && b.error)
            return;
    }
}

function pushMsg(messages, b) {
    if (b?.content && messages)
        messages.push({ role: 'assistant', content: b.content });
}

async function fillExist(b, t) {
    const path = t.path;
    b.crit = 'exist';
    b.target = path;
    b.path = path;
    const item = await WORK.get_item(path);
    if (!item) {
        b.error = true;
        b.state = 'gap';
        b.content = '[exist ' + path + ']\nнет';
        return;
    }
    const kind = isWorkClass(item) ? 'class' : (typeof item.read_text === 'function' ? 'file' : 'item');
    const type = String(item.type || item.constructor?.name || '');
    const lines = [
        '[exist ' + path + ']',
        'ok: ' + kind + (type ? ' (' + type + ')' : ''),
    ];
    const gaps = [];
    if (t.kind === 'class' && !isWorkClass(item))
        gaps.push('ожидался класс, got ' + kind);
    if (t.expect?.type && type && type !== String(t.expect.type))
        gaps.push('type: want «' + t.expect.type + '», got «' + type + '»');
    if (t.expect?.id) {
        const id = String(item.id || path.split('/').filter(Boolean).pop() || '');
        if (id !== String(t.expect.id))
            gaps.push('id: want «' + t.expect.id + '», got «' + id + '»');
    }
    if (gaps.length) {
        b.error = true;
        b.state = 'gap';
        lines.push('gap:');
        lines.push(...gaps.map(g => '- ' + g));
    }
    else {
        b.state = 'ok · ' + kind + (type ? ' ' + type : '');
    }
    b.content = lines.join('\n');
}

/** Файловый критерий: meta (class.js читается) | readme (непустой) | content (файл write). Блок — `file`. */
async function fillCriterion(b, t, crit) {
    b.crit = crit;
    b.target = t.path;
    if (crit === 'meta')
        return fillMeta(b, t);
    if (crit === 'readme')
        return fillClassFile(b, t, 'readme.md', { requireText: true });
    return fillWriteFile(b, t);
}

async function fillMeta(b, t) {
    const path = t.path;
    const target = await WORK.get_item(path);
    const meta = await resolveClassFile(target, 'class.js');
    b.path = meta.path || (path + '/class.js');
    if (!target) {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + b.path + ']\nнет класса ' + path;
        return;
    }
    if (!isWorkClass(target)) {
        b.state = 'skip';
        b.content = '[file ' + b.path + ']\nskip: ' + path + ' не класс';
        return;
    }
    try {
        await loadItemDevice(target);
    }
    catch (e) {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + b.path + ']\ngap: class.js не читается — ' + String(e.message || e);
        return;
    }
    const iconGap = iconSetGap(meta.text);
    if (iconGap) {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + b.path + ']\ngap: ' + iconGap;
        return;
    }
    b.state = linesState(meta.text, 'ok');
    b.content = fileReport(b.path, meta.text, 'js');
}

async function fillClassFile(b, t, name, { requireText } = {}) {
    const target = await WORK.get_item(t.path);
    const f = await resolveClassFile(target, name);
    b.path = f.path || (String(t.path).replace(/\/$/, '') + '/' + name);
    if (!f.file) {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + b.path + ']\nнет';
        return;
    }
    if (f.error) {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + b.path + ']\n' + f.error;
        return;
    }
    if (requireText && !String(f.text || '').trim()) {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + b.path + ']\nпусто';
        return;
    }
    b.state = linesState(f.text, 'ok');
    b.content = fileReport(b.path, f.text, langOf(b.path));
}

async function fillWriteFile(b, t) {
    const path = t.path;
    b.path = path;
    const file = await WORK.get_item(path);
    if (!file || typeof file.read_text !== 'function') {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + path + ']\nнет файла';
        return;
    }
    let text = '';
    try {
        text = String(await file.read_text() || '');
    }
    catch (e) {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + path + ']\n' + String(e.message || e);
        return;
    }
    if (!text.trim()) {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + path + ']\nпусто';
        return;
    }
    const snippet = t.expect?.snippet;
    if (snippet && !text.includes(snippet)) {
        b.error = true;
        b.state = 'gap';
        b.content = '[file ' + path + ']\ngap: нет ожидаемого фрагмента из write';
        return;
    }
    b.state = linesState(text, snippet ? 'ok · snippet' : 'ok');
    b.content = fileReport(path, text, langOf(path), snippet ? 'snippet: ok' : '');
}

/** Файл в meta класса (get_item → meta_folder → WORK path). */
async function resolveClassFile(cls, name) {
    const out = { file: null, path: '', text: '', error: '' };
    if (!cls)
        return out;
    try {
        let file = null;
        if (typeof cls.get_item === 'function')
            file = await cls.get_item(name);
        if (!file && (cls.storage_folder || cls.meta_folder)) {
            const storage = cls.storage_folder || cls.meta_folder;
            file = typeof storage.get_item === 'function'
                ? await storage.get_item(name)
                : ((await storage.files) || []).find(f => f.id === name || f.name === name);
        }
        if (!file && cls.path)
            file = await WORK.get_item(String(cls.path).replace(/\/$/, '') + '/' + name);
        if (!file || typeof file.read_text !== 'function')
            return out;
        out.file = file;
        out.path = String(file.path || '');
        try {
            out.text = String(await file.read_text() || '');
        }
        catch (e) {
            out.error = String(e.message || e);
        }
    }
    catch { /* нет */ }
    return out;
}

/** icon в class.js — только реальные наборы ODA (не выдуманный register:). */
const ODA_ICON_SET = /^(carbon|icons|ai|lineawesome|bootstrap|iconoir|editor)$/;

function iconSetGap(text) {
    const m = String(text || '').match(/\bicon\s*:\s*['"`]([^'"`]+)['"`]/);
    if (!m)
        return 'нет icon в class.js';
    const set = String(m[1]).split(':')[0];
    if (!ODA_ICON_SET.test(set))
        return 'icon «' + m[1] + '» не из набора ODA (carbon:, icons:, ai:, lineawesome:, bootstrap:, iconoir:, editor:)';
    return '';
}

function fileReport(path, text, lang, note) {
    const body = String(text || '').replace(/\r\n/g, '\n').trimEnd();
    const lines = body ? body.split('\n').length : 0;
    const isMd = /\.md$/i.test(path) || lang === 'markdown' || lang === 'md';
    const shown = !body ? ''
        : (isMd ? '\n' + body : '\n```' + (lang || '') + '\n' + body + '\n```');
    return [
        '[file ' + path + ']',
        'ok: ' + lines + ' lines',
        note || '',
        shown,
    ].filter(Boolean).join('\n');
}

function linesState(text, prefix = 'ok') {
    const body = String(text || '').replace(/\r\n/g, '\n').trimEnd();
    const n = body ? body.split('\n').length : 0;
    return prefix + (n ? ' · ' + n + ' lines' : '');
}

function langOf(path) {
    const p = String(path || '');
    if (/\.m?js$/i.test(p)) return 'js';
    if (/\.md$/i.test(p)) return 'markdown';
    if (/\.json$/i.test(p)) return 'json';
    if (/\.html?$/i.test(p)) return 'html';
    if (/\.css$/i.test(p)) return 'css';
    return '';
}

/** targets из evidence операций; expect — только из своей секции [create|write path]… */
function collectTargets(messages) {
    const out = [];
    const seen = new Set();
    const add = (t) => {
        const path = String(t.path || '').trim().replace(/\/$/, '');
        if (!path || path === '/' || seen.has(path))
            return;
        seen.add(path);
        out.push({ ...t, path });
    };
    const blob = (messages || []).map(m => String(m?.content || '')).join('\n\n');

    for (const match of blob.matchAll(/\[create\s+(\/[^\]]+?)\]/g)) {
        const path = match[1].trim();
        const section = evidenceSection(blob, match.index);
        const id = path.split('/').filter(Boolean).pop() || '';
        const type = sectionField(section, 'type');
        add({
            path,
            kind: 'class',
            expect: {
                id,
                type: type && type.startsWith('$') ? type : '',
            },
        });
    }
    for (const match of blob.matchAll(/\[write\s+(\/[^\]]+?)\]/g)) {
        const path = match[1].trim();
        if (/\/readme\.md$/i.test(path)) {
            const classPath = path.replace(/\/(?:\$[^/]+\/)?readme\.md$/i, '');
            if (seen.has(classPath))
                continue;
        }
        const section = evidenceSection(blob, match.index);
        add({
            path,
            kind: 'file',
            expect: { snippet: writeSnippetFromSection(section) },
        });
        const classJs = path.match(/^(.*?)\/\$[^/]+\/class\.js$/i) || path.match(/^(.*)\/class\.js$/i);
        if (classJs?.[1]) {
            const classPath = classJs[1];
            const id = classPath.split('/').filter(Boolean).pop() || '';
            add({ path: classPath, kind: 'class', expect: { id } });
        }
    }
    return out;
}

/** Текст от маркера операции до следующего [create|write …] или конца. */
function evidenceSection(blob, index) {
    const from = index ?? 0;
    const rest = blob.slice(from);
    const next = rest.slice(1).search(/\n\[(?:create|write)\s+\//);
    const end = next < 0 ? rest.length : next + 1;
    return rest.slice(0, end);
}

function sectionField(section, name) {
    const m = String(section || '').match(new RegExp('^' + name + ':\\s*(.+)$', 'mi'));
    return m ? m[1].trim() : '';
}

function writeSnippetFromSection(section) {
    const lines = String(section || '').split('\n').map(l => l.trim());
    const line = lines.find(l =>
        l && !/^\[write\s+\//i.test(l) && !/^ok\b/i.test(l) && !/^###?\s/.test(l)
        && !/^```/.test(l) && l.length > 12 && !l.startsWith('_'));
    return line ? line.slice(0, 80) : '';
}

function ensureTargets(box, messages) {
    if (!box)
        return;
    if (!Array.isArray(box.targets) || !box.targets.length)
        box.targets = collectTargets(messages);
}

function criteriaFor(t) {
    if (t.kind === 'class')
        return ['exist', 'meta', 'readme'];
    return ['exist', 'content'];
}

function findCrit(box, crit, target) {
    return (box?.items || []).find(b => b.crit === crit && b.target === target && b.content);
}

function hasOk(box, crit, target) {
    const b = findCrit(box, crit, target);
    return !!b && !b.error;
}

function hasSettled(box, crit, target) {
    return !!findCrit(box, crit, target);
}

function allTargetsSettled(box) {
    const targets = box?.targets || [];
    if (!targets.length)
        return false;
    return targets.every(t => criteriaFor(t).every(c => hasSettled(box, c, t.path)));
}

function allTargetsFullyOk(box) {
    const targets = box?.targets || [];
    if (!targets.length)
        return false;
    return targets.every(t => criteriaFor(t).every(c => hasOk(box, c, t.path)));
}

function nextIncomplete(box) {
    for (const t of box?.targets || []) {
        for (const crit of criteriaFor(t)) {
            if (!hasSettled(box, crit, t.path))
                return { t, crit };
        }
    }
    return null;
}

function settleIfDone(box) {
    if (allTargetsSettled(box))
        settleCheckTools(box);
}

function settleCheckTools(box) {
    if (box)
        box.using_blocks = ['exist', 'file'];
}

function formatCheckReport(block) {
    const targets = block?.targets || [];
    const lines = ['[check]'];
    if (!targets.length)
        return '[check]\ngap: нет targets (create/write в контексте)';
    let nOk = 0;
    for (const t of targets) {
        const bits = criteriaFor(t).map(c => {
            if (hasOk(block, c, t.path))
                return c + ':ok';
            if (hasSettled(block, c, t.path))
                return c + ':gap';
            return c + ':—';
        });
        const full = criteriaFor(t).every(c => hasOk(block, c, t.path));
        if (full)
            nOk++;
        lines.push((full ? 'ok' : 'gap') + ': ' + t.path + ' (' + bits.join(', ') + ')');
    }
    lines.splice(1, 0, nOk + '/' + targets.length + ' targets ok');
    return lines.join('\n');
}

/** Шапка агента: type в block.type; итог — state (не склеивать в label). */
function tagAgent(box, _role, detail) {
    if (!box)
        return;
    const d = String(detail || '').trim();
    if (d)
        box.state = d;
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

/**
 * Полное устройство $class: import() = tilde-merge class.js (не один meta_file).
 * Нет baseUrl — дополнить каналом meta/$folder/$class/<type>.
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
    if (!data || typeof data !== 'object') {
        try {
            const metaFile = await item.meta_file;
            if (metaFile && typeof metaFile.importScript === 'function')
                data = await metaFile.importScript();
        }
        catch { /* */ }
    }
    if (!data || typeof data !== 'object')
        throw new Error('пустые метаданные / class.js');
    if (isWorkClass(item) && !String(data.baseUrl || '').trim()) {
        const channel = await loadTypeChannelDevice(item);
        if (channel && typeof channel === 'object')
            data = { ...channel, ...data };
    }
    return sanitizeDevice(data);
}

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
    catch { /* нет канала */ }
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
