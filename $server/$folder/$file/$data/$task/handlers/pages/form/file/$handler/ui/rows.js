/**
 * Проекция блока ленты в строку (образец: v2 timeline/projection).
 * Чистая функция: блок + контекст фокуса → дескриптор строки.
 * Наша специфика поверх образца: домен строки — конфигурация / данные / люди,
 * т.к. управляем не только кодом, но и классами, файлами, проводками, командой.
 *
 * kind: prompt | thinking | text | agent | approval | todo | media | attachment | diff | error
 * status: stream | waiting | ok | error | idle
 * control: тег инлайн-контрола (form/quiz/todo/html) или null
 * domain: config | data | people | null
 *
 * diff — карточка файловых изменений (как v2 file-changes): проверки `check`,
 * итоги записи. Построчный +/- — следующая итерация (нужны тексты из history).
 */

/** Боксы-агенты: строка операции, дети — свернутые детали. */
const AGENT_BOXES = new Set([
    'explore', 'work', 'check', 'web', 'site', 'logs', 'image',
    'mcp', 'step', 'search', 'inspect', 'offer',
    'activation', 'create', 'read', 'write',
]);

/** Диалоги с человеком: строка-запрос со своим решением. */
const APPROVALS = new Set(['form', 'quiz', 'question', 'planning', 'plan']);

const CONTROLS = {
    form: 'microchat-control-form',
    quiz: 'microchat-control-quiz',
    todo: 'microchat-control-todo',
    html: 'microchat-control-html',
};

function hasBody(b) {
    if (!b || typeof b !== 'object')
        return false;
    if (typeof b.content === 'string' ? b.content.trim() : b.content)
        return true;
    const d = b.draft;
    if (d == null || d === '')
        return false;
    if (typeof d === 'string')
        return !!d.trim();
    if (d.type === 'text')
        return !!String(d.text || '').trim();
    return true;
}

/**
 * Высота iframe по пингу контента, кэп — 80vh вьюпорта.
 * @returns {string|null} 'Npx' или null (мусор — игнорировать, оставить как было)
 */
export const HTML_HEIGHT_CAP_VH = 80;
export function clampFrameHeight(px, viewportH) {
    const h = Number(px);
    const cap = Math.max(0, Math.round(Number(viewportH) * HTML_HEIGHT_CAP_VH / 100)) || 0;
    if (!Number.isFinite(h) || h <= 0)
        return null;
    return Math.min(Math.round(h), cap || Math.round(h)) + 'px';
}

/**
 * Цепочка id от корня до фокуса (фокус + все предки).
 * Чистая функция для подсветки активных предков в ленте.
 * @returns {string[]} id от корня к фокусу (пусто — фокуса нет в дереве)
 */
export function focusChainIds(root, focusId) {
    if (!root || focusId == null)
        return [];
    if (root.id === focusId)
        return root.id != null ? [root.id] : [];
    for (const b of root.items || []) {
        const chain = focusChainIds(b, focusId);
        if (chain.length)
            return root.id != null ? [root.id, ...chain] : chain;
    }
    return [];
}

/**
 * Домен строки по пути артефакта:
 * config — классы, class.js, интеграции (SERVICES/MODELS), структура (MARKET/CATALOGS);
 * data — журнал, проводки, задачи, документы;
 * people — пользователи, подразделения, внешние узлы.
 */
export function blockDomain(block) {
    const p = String(block?.path || '');
    if (!p)
        return null;
    // артефакт важнее местоположения: class.js в BASE — конфигурация
    if (p.includes('$class') || p.endsWith('class.js')
        || p.includes('/SERVICES/') || p.includes('/MODELS/')
        || p.includes('/MARKET/') || p.includes('/CATALOGS/'))
        return 'config';
    if (p.includes('/USERS/') || p.includes('/BASE/') || p.includes('/NODES/'))
        return 'people';
    if (p.includes('/REGISTER/') || p.includes('/history/')
        || /\.logs\b/.test(p) || /\.task\b/.test(p) || /\.ics\b/.test(p) || /\.eml\b/.test(p))
        return 'data';
    return null;
}

function rowStatus(block, isFocus, streaming) {
    if (!block || typeof block !== 'object')
        return 'idle';
    if (block.error)
        return 'error';
    if (isFocus && streaming)
        return 'stream';
    if (block.stop && hasBody(block) && block.approved == null && block.answer == null)
        return 'waiting';
    if (hasBody(block) || block.done)
        return 'ok';
    return 'idle';
}

/**
 * @param {object} block блок ленты (или объект todo со steps)
 * @param {object} ctx { focusedId, streaming }
 * @returns {{kind, status, control, domain, title} | null}
 */
export function projectBlock(block, ctx = {}) {
    if (!block || typeof block !== 'object')
        return null;
    const { focusedId = null, streaming = false } = ctx;
    const type = block.type;
    const isFocus = focusedId != null && block.id != null && block.id === focusedId;

    // todo — не блок items, а объект со steps
    if ((!type || type === 'todo') && Array.isArray(block.steps)) {
        return {
            kind: 'todo',
            status: block.steps.some(s => s?.state !== 'done') ? 'waiting' : 'ok',
            control: CONTROLS.todo,
            domain: blockDomain(block),
            title: String(block.label || 'План').trim() || 'План',
        };
    }
    if (!type)
        return null;

    if (type === 'prompt')
        return { kind: 'prompt', status: rowStatus(block, isFocus, streaming), control: null, domain: null, title: '' };
    if (type === 'thinking' || type === 'reasoning')
        return { kind: 'thinking', status: rowStatus(block, isFocus, streaming), control: null, domain: null, title: String(block.label || 'Думаю') };
    if (type === 'answer' || type === 'report')
        return { kind: 'text', status: rowStatus(block, isFocus, streaming), control: null, domain: blockDomain(block), title: String(block.label || '') };
    if (type === 'error')
        return { kind: 'error', status: 'error', control: null, domain: null, title: String(block.label || 'Ошибка') };
    if (type === 'html' || type === 'image' || type === 'generate')
        return { kind: 'media', status: rowStatus(block, isFocus, streaming), control: CONTROLS[type] || null, domain: blockDomain(block), title: String(block.label || type) };
    if (type === 'file' || type === 'includes')
        return { kind: 'attachment', status: rowStatus(block, isFocus, streaming), control: null, domain: blockDomain(block) || 'data', title: String(block.label || type) };
    // проверка/запись: строка файловых изменений (файл + статус, детали — дети)
    if (type === 'check' || type === 'write' || type === 'create')
        return { kind: 'diff', status: rowStatus(block, isFocus, streaming), control: null, domain: blockDomain(block), title: String(block.label || type) };
    if (APPROVALS.has(type))
        return { kind: 'approval', status: rowStatus(block, isFocus, streaming), control: CONTROLS[type] || null, domain: blockDomain(block), title: String(block.label || type) };
    if (AGENT_BOXES.has(type) || Array.isArray(block.items))
        return { kind: 'agent', status: rowStatus(block, isFocus, streaming), control: null, domain: blockDomain(block), title: String(block.label || type) };
    return { kind: 'text', status: rowStatus(block, isFocus, streaming), control: null, domain: blockDomain(block), title: String(block.label || type) };
}
