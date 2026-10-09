/** Общие помощники ленты задачи (клиент). */

export const TOOL_META = {
    ls: { label: 'Обзор', icon: 'carbon:folder' },
    read: { label: 'Чтение', icon: 'carbon:document' },
    find: { label: 'Поиск', icon: 'carbon:search' },
    write: { label: 'Запись', icon: 'carbon:document-add' },
    append: { label: 'Дополнение', icon: 'carbon:document-add' },
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
    agent_start: { label: 'Продолжимый агент', icon: 'carbon:bot' },
    agent_status: { label: 'Статус агента', icon: 'carbon:task' },
    agent_message: { label: 'Сообщение агенту', icon: 'carbon:chat' },
    agent_stop: { label: 'Остановить агента', icon: 'carbon:stop-filled' },
    skill: { label: 'Навык', icon: 'carbon:skill-level' },
    save_skill: { label: 'Новый навык', icon: 'carbon:save' },
    generate_image: { label: 'Изображение', icon: 'carbon:image' },
    connections: { label: 'Подключения', icon: 'carbon:connect' },
    connect_service: { label: 'Подключение', icon: 'carbon:connect' },
    disconnect_service: { label: 'Отключение', icon: 'carbon:connect' },
    http_request: { label: 'Запрос API', icon: 'carbon:http' },
    open_page: { label: 'Страница', icon: 'carbon:application-web' },
    computer_status: { label: 'Компьютер', icon: 'carbon:screen' },
    computer_network: { label: 'Сеть песочницы', icon: 'carbon:network' },
    computer_destroy: { label: 'Удалить компьютер', icon: 'carbon:trash-can' },
    computer_screenshot: { label: 'Скриншот', icon: 'carbon:image' },
    computer_action: { label: 'Действие на экране', icon: 'carbon:cursor-1' },
    computer_handoff: { label: 'Помощь человека', icon: 'carbon:help' },
    sandbox_exec: { label: 'Команда', icon: 'carbon:terminal' },
    sandbox_read: { label: 'Файл из песочницы', icon: 'carbon:document' },
    sandbox_write: { label: 'Файл в песочницу', icon: 'carbon:document-add' },
    sandbox_ls: { label: 'Папка песочницы', icon: 'carbon:folder' },
    sandbox_import: { label: 'В песочницу', icon: 'carbon:upload' },
    sandbox_export: { label: 'Из песочницы', icon: 'carbon:download' },
    search: { label: 'Смысловой поиск', icon: 'carbon:search-advanced' },
    query: { label: 'Выборка объектов', icon: 'carbon:data-table' },
    access: { label: 'Права', icon: 'carbon:user-access' },
    assign: { label: 'Назначение роли', icon: 'carbon:user-role' },
    escalate: { label: 'Запрос доступа', icon: 'carbon:request-quote' },
    send: { label: 'Сообщение в ленту', icon: 'carbon:send-alt' },
    write_table: { label: 'Таблица', icon: 'carbon:table' },
    read_table: { label: 'Чтение таблицы', icon: 'carbon:table' },
    import_objects: { label: 'Импорт объектов', icon: 'carbon:data-base' },
    render_doc: { label: 'Документ по шаблону', icon: 'carbon:document-export' },
    export_pdf: { label: 'PDF', icon: 'carbon:document-pdf' },
    memory: { label: 'Память', icon: 'carbon:notebook' },
    publish: { label: 'Результат в ленту', icon: 'carbon:share' },
    schedule: { label: 'Расписание', icon: 'carbon:alarm' },
    browser_open: { label: 'Открыть сайт', icon: 'carbon:application-web' },
    browser_snapshot: { label: 'Снимок страницы', icon: 'carbon:image' },
    browser_click: { label: 'Клик на странице', icon: 'carbon:cursor-1' },
    browser_type: { label: 'Ввод на странице', icon: 'carbon:text-creation' },
    browser_select: { label: 'Выбор на странице', icon: 'carbon:list-boxes' },
    browser_nav: { label: 'Навигация', icon: 'carbon:arrow-left' },
    browser_secrets: { label: 'Секреты входа', icon: 'carbon:password' },
    browser_fill_secret: { label: 'Вход по секрету', icon: 'carbon:password' },
    os_info: { label: 'Состояние сервера', icon: 'carbon:server' },
    os_processes: { label: 'Процессы', icon: 'carbon:task-tools' },
    os_services: { label: 'Службы', icon: 'carbon:settings' },
    os_service: { label: 'Управление службой', icon: 'carbon:settings' },
    os_kill: { label: 'Завершить процесс', icon: 'carbon:stop-outline' },
    os_ls: { label: 'Папка сервера', icon: 'carbon:folder' },
    os_stat: { label: 'Сведения о файле ОС', icon: 'carbon:document' },
    os_read: { label: 'Файл сервера', icon: 'carbon:document' },
    os_find: { label: 'Поиск на сервере', icon: 'carbon:search' },
    os_write: { label: 'Запись на сервере', icon: 'carbon:document-add' },
    os_edit: { label: 'Правка на сервере', icon: 'carbon:edit' },
    os_mkdir: { label: 'Папка на сервере', icon: 'carbon:folder-add' },
    os_copy: { label: 'Копирование на сервере', icon: 'carbon:copy' },
    os_move: { label: 'Перенос на сервере', icon: 'carbon:move' },
    os_delete: { label: 'Удаление на сервере', icon: 'carbon:trash-can' },
    os_import: { label: 'Файл сервера → WORK', icon: 'carbon:upload' },
    os_export: { label: 'Файл WORK → сервер', icon: 'carbon:download' },
    shell: { label: 'Команда сервера', icon: 'carbon:terminal' },
    install_package: { label: 'Установка пакета', icon: 'carbon:package' },
    net_info: { label: 'Сеть сервера', icon: 'carbon:network-3' },
    net_discover: { label: 'Поиск устройств', icon: 'carbon:search' },
    net_scan: { label: 'Сканирование сети', icon: 'carbon:radar' },
    net_probe: { label: 'Проверка устройства', icon: 'carbon:radar' },
    net_http: { label: 'Запрос к устройству', icon: 'carbon:http' },
    net_candidates: { label: 'Найденные устройства', icon: 'carbon:devices' },
    net_register: { label: 'Регистрация устройства', icon: 'carbon:add-alt' },
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
    if (t?.name === 'http_request')
        return String(a.method || 'GET').toUpperCase() + ' ' + (a.connection ? a.connection + ': ' : '') + String(a.url || '');
    if (t?.name === 'open_page')
        return String(t?.page?.host || a.url || '');
    if (t?.name === 'connect_service')
        return (t.connect?.label || a.provider || '') + (a.scopes?.length ? ' · ' + a.scopes.join(', ') : '');
    if (t?.name === 'todo_write')
        return (a.todos || []).filter(x => x.status === 'completed').length + '/' + (a.todos || []).length;
    if (t?.name === 'sandbox_exec')
        return String(a.command || '').split('\n')[0].slice(0, 80);
    if (t?.name === 'computer_action') {
        const coords = a.action === 'drag'
            ? [a.x1, a.y1, a.x2, a.y2].map(v => v ?? '?').join(',')
            : (a.x ?? '') + ',' + (a.y ?? '');
        return (a.action || '') + (a.action === 'type' ? ' «' + String(a.text || '').slice(0, 40) + '»' : a.action === 'key' ? ' ' + (a.key || '') : ' ' + coords);
    }
    if (String(t?.name || '').startsWith('sandbox_') || String(t?.name || '').startsWith('computer_'))
        return String(a.path || a.command || a.action || a.name || '').split('\n')[0].slice(0, 80);
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
/** Карточка файла по пути (chat-item compact / вкладка «Файлы»). Обещание кэшируется: иначе плитка перезагружалась бы при каждой перерисовке. */
const FILE_ITEMS = new Map();
export function fileItemOf(path) {
    const p = String(path || '');
    if (!FILE_ITEMS.has(p))
        FILE_ITEMS.set(p, WORK.get_item(p.startsWith('/') ? p : '/' + p, 'info'));
    return FILE_ITEMS.get(p);
}

export function extOf(path) {
    const leaf = String(path || '').split('/').pop() || '';
    const m = leaf.match(/\.([a-z0-9]{1,8})$/i);
    return m && m.index > 0 ? m[1].toLowerCase() : '';
}

/** Имя вложения: ссылка остаётся на снимок, надпись — имя файла перед /history/. */
export function attachmentName(attachment) {
    const path = String(attachment?.path || (typeof attachment === 'string' ? attachment : ''));
    const snapshot = path.split('/').pop() || '';
    const supplied = String(attachment?.name || '');
    // В старых задачах name подставлялся из basename снимка (время.uid.ext).
    if (supplied && supplied !== snapshot)
        return supplied;
    const match = path.match(/\/\.([^/]+)\/history\/\d{4}-\d{2}-\d{2}\/[^/]+$/);
    return match ? match[1] : (supplied || snapshot);
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
export function linkifyWork(md, artifacts = new Map()) {
    const src = String(md ?? '');
    if (!src || !src.includes('/'))
        return src;
    const parts = src.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/);
    return parts.map((part, i) => i % 2 ? part : linkifySegment(part, artifacts)).join('');
}

function linkifySegment(text, artifacts) {
    const keep = [];
    const hold = s => '\u0000' + (keep.push(s) - 1) + '\u0000';
    const artifact = path => {
        if (!artifacts.has(path))
            return null;
        const name = path.split('/').pop();
        const snapshot = artifacts.get(path);
        return snapshot ? '[' + name + '](' + workHref(snapshot) + ')' : name;
    };
    // готовые ссылки: абсолютный путь → WORK-формат
    text = text.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (m, label, href) => {
        let h = href;
        try { h = decodeURI(href); } catch { /* как есть */ }
        return hold(artifact(h) ?? (isWorkPath(h) ? '[' + label + '](' + workHref(h) + ')' : m));
    });
    text = text.replace(/https?:\/\/[^\s)\]]+/g, m => hold(m));
    text = text.replace(/<[^>\n]+>/g, m => hold(m));
    // `путь` в бэктиках
    text = text.replace(/`([^`\n]+)`/g, (m, code) => {
        const c = code.trim();
        return hold(artifact(c) ?? (isWorkPath(c) ? '[`' + c + '`](' + workHref(c) + ')' : m));
    });
    // голые пути в тексте
    text = text.replace(/(^|[\s(«"'])(\/[^\s`'"«»()\[\]<>]+)/g, (m, pre, raw) => {
        const tail = (raw.match(TRAIL) || [''])[0];
        const path = tail ? raw.slice(0, -tail.length) : raw;
        if (!isWorkPath(path, true))
            return m;
        return pre + hold(artifact(path) ?? ('[' + path + '](' + workHref(path) + ')')) + tail;
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
