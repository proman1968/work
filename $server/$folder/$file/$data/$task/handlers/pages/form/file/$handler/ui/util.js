/** Общие помощники ленты задачи (клиент). */

export const TOOL_META = {
    ls: { label: 'Обзор', icon: 'carbon:folder' },
    read: { label: 'Чтение', icon: 'carbon:document' },
    find: { label: 'Поиск', icon: 'carbon:search' },
    write: { label: 'Запись', icon: 'carbon:document-add' },
    edit: { label: 'Правка', icon: 'carbon:edit' },
    create_class: { label: 'Новый класс', icon: 'carbon:tree-view-alt' },
    schema: { label: 'Методы', icon: 'carbon:api' },
    call: { label: 'Вызов', icon: 'carbon:function' },
    logs: { label: 'Журнал', icon: 'carbon:catalog' },
    history: { label: 'История', icon: 'carbon:recently-viewed' },
    restore: { label: 'Откат', icon: 'carbon:reset' },
    delete: { label: 'Удаление', icon: 'carbon:trash-can' },
    web_search: { label: 'Поиск в сети', icon: 'carbon:earth' },
    web_fetch: { label: 'Страница', icon: 'carbon:link' },
    todo_write: { label: 'План', icon: 'carbon:list-checked' },
    ask_user: { label: 'Вопрос', icon: 'carbon:help' },
    task: { label: 'Субагент', icon: 'carbon:bot' },
    skill: { label: 'Навык', icon: 'carbon:skill-level' },
    save_skill: { label: 'Новый навык', icon: 'carbon:save' },
    generate_image: { label: 'Изображение', icon: 'carbon:image' },
};

export function toolMeta(name) {
    const n = String(name || '');
    if (TOOL_META[n])
        return TOOL_META[n];
    if (n.startsWith('mcp_'))
        return { label: 'MCP · ' + n.slice(4).replace(/_/g, ' '), icon: 'carbon:plug' };
    if (n.startsWith('svc_'))
        return { label: n.slice(4).replace(/_/g, ' '), icon: 'carbon:cloud-service-management' };
    return { label: n, icon: 'carbon:api' };
}

/** Главный операнд вызова для строки карточки. */
export function toolTarget(t) {
    const a = t?.args || {};
    if (t?.name === 'create_class')
        return String(a.parent || '').replace(/\/+$/, '') + '/' + (a.id || '');
    if (t?.name === 'call')
        return (a.path || '') + ' → ' + (a.method || '');
    if (t?.name === 'task')
        return (a.agent ? a.agent + ': ' : '') + (a.description || a.prompt || '');
    if (t?.name === 'todo_write')
        return (a.todos || []).filter(x => x.status === 'completed').length + '/' + (a.todos || []).length;
    return String(t?.path || a.path || a.query || a.url || a.snapshot || a.name || a.question || a.prompt || '');
}

export const STATUS_META = {
    pending: { icon: 'spinners:3-dots-scale', label: 'в очереди' },
    running: { icon: 'spinners:3-dots-scale', label: 'выполняется' },
    approval: { icon: 'carbon:locked', label: 'ждёт разрешения' },
    waiting: { icon: 'carbon:help', label: 'ждёт ответа' },
    approved: { icon: 'carbon:unlocked', label: 'разрешено' },
    ok: { icon: 'carbon:checkmark', label: '' },
    error: { icon: 'carbon:warning', label: 'ошибка' },
    denied: { icon: 'carbon:close', label: 'отклонено' },
    interrupted: { icon: 'carbon:pause', label: 'прервано' },
};

export function fmtDuration(ms) {
    const v = Number(ms) || 0;
    if (!v)
        return '';
    if (v < 1000)
        return v + 'мс';
    const s = Math.round(v / 1000);
    if (s < 60)
        return s + 'с';
    return Math.floor(s / 60) + 'м ' + String(s % 60).padStart(2, '0') + 'с';
}

export function fmtTime(ms) {
    const t = Number(ms) || 0;
    if (!t)
        return '';
    try {
        return new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    catch {
        return '';
    }
}

export function fmtTokens(n) {
    const v = Number(n) || 0;
    if (v >= 10000)
        return Math.round(v / 1000) + 'k';
    if (v >= 1000)
        return (v / 1000).toFixed(1) + 'k';
    return String(v);
}

export function modelShort(m) {
    return String(m || '').split('/').pop() || '';
}

export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(String(text ?? ''));
        return true;
    }
    catch {
        return false;
    }
}

/** Шелл задачи вверх по DOM (через границы shadow root). */
export function findShell(el) {
    let n = el;
    while (n) {
        if (n.__microchatShell)
            return n;
        n = n.parentNode || n.host || null;
    }
    return null;
}

/** Текст для показа: стрим обгоняет сохранённое — берём стрим. */
export function liveText(saved, streamed) {
    const a = String(saved || '');
    const b = String(streamed || '');
    return b.length > a.length ? b : a;
}

/** Расширение по пути. */
export function extOf(path) {
    const leaf = String(path || '').split('/').pop() || '';
    const m = leaf.match(/\.([a-z0-9]{1,8})$/i);
    return m && m.index > 0 ? m[1].toLowerCase() : '';
}

/** URL файла WORK для браузера. */
export function fileUrl(path) {
    return String(path || '').split('/').map(s => encodeURIComponent(s)).join('/');
}

const LOWER_ROOTS = ['sources', 'oda', 'docs', 'rules', 'scripts', 'tests'];

/** Абсолютный WORK-путь (а не просто «что-то со слешем»): /КЛАСС/…, /$server/…, /sources/… */
export function isWorkPath(s, plain = false) {
    const t = String(s || '').trim();
    if (!t.startsWith('/') || t.startsWith('//') || t.length < 3 || /[<>{}]|→|\n/.test(t))
        return false;
    if (t.includes('/~/handlers/'))
        return false;
    const first = t.slice(1).split('/')[0];
    if (/^\$[\w-]+$/.test(first))
        return true;
    if (/^[A-Z][A-Z0-9_.-]+$/.test(first))
        return true;
    return !plain && LOWER_ROOTS.includes(first);
}

/** WORK-ссылка на форму элемента (rules.md 1.1.1): /путь/~/handlers/pages/form/ */
export function workHref(path) {
    const p = String(path || '').trim().replace(/\/+$/, '');
    return encodeURI(p + '/~/handlers/pages/form/');
}

/** Путь из WORK-ссылки формы (или null). */
export function pathOfWorkHref(href) {
    try {
        const u = new URL(href, location.origin);
        if (u.origin !== location.origin)
            return null;
        const m = decodeURI(u.pathname).match(/^(.*?)\/~\/handlers\/(?:pages\/)?form\/?$/);
        return m ? m[1] : null;
    }
    catch {
        return null;
    }
}

const TRAIL = /[.,;:!?)»"'…]+$/;

/**
 * Markdown → с кликабельными WORK-путями (стандарт rules.md 1.1.1):
 * `/путь` в бэктиках и голые /КЛАСС/… пути в тексте → [путь](/путь/~/handlers/pages/form/);
 * markdown-ссылки на абсолютные пути → WORK-формат. Блоки кода, внешние URL — без изменений.
 */
export function linkifyWork(md) {
    const src = String(md ?? '');
    if (!src || !src.includes('/'))
        return src;
    const parts = src.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/);
    return parts.map((part, i) => i % 2 ? part : linkifySegment(part)).join('');
}

function linkifySegment(text) {
    const keep = [];
    const hold = s => '\u0000' + (keep.push(s) - 1) + '\u0000';
    // готовые ссылки: абсолютный путь → WORK-формат
    text = text.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (m, label, href) => {
        let h = href;
        try { h = decodeURI(href); } catch { /* как есть */ }
        return hold(isWorkPath(h) ? '[' + label + '](' + workHref(h) + ')' : m);
    });
    text = text.replace(/https?:\/\/[^\s)\]]+/g, m => hold(m));
    text = text.replace(/<[^>\n]+>/g, m => hold(m));
    // `путь` в бэктиках
    text = text.replace(/`([^`\n]+)`/g, (m, code) => {
        const c = code.trim();
        return hold(isWorkPath(c) ? '[`' + c + '`](' + workHref(c) + ')' : m);
    });
    // голые пути в тексте
    text = text.replace(/(^|[\s(«"'])(\/[^\s`'"«»()\[\]<>]+)/g, (m, pre, raw) => {
        const tail = (raw.match(TRAIL) || [''])[0];
        const path = tail ? raw.slice(0, -tail.length) : raw;
        if (!isWorkPath(path, true))
            return m;
        return pre + hold('[' + path + '](' + workHref(path) + ')') + tail;
    });
    return text.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[+n]);
}

/** Результат вызова → markdown для раскрытия. */
export function resultMarkdown(t) {
    if (t?.status === 'error')
        return '```\n' + String(t.error || '') + '\n```';
    if (t?.status === 'denied')
        return '_Отклонено_' + (t.answer ? ': ' + t.answer : '') + (t.error ? '\n\n' + t.error : '');
    const r = String(t?.result ?? '');
    if (!r)
        return '';
    if (['web_search', 'task', 'skill', 'web_fetch'].includes(t?.name))
        return r;
    return '```\n' + r.replace(/```/g, '``\u200b`') + '\n```';
}
