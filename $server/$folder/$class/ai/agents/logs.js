/** Агент logs: журнал класса ($class.logs). Хронология процессов и взаимодействий.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat, engine }).
 *  Read-only: dates → bodies (день + ext) → entry через read_log_entry. Не work.read по .logs. */
const BODIES_LIMIT = 40;
const ENTRY_CONTENT_MAX = 1200;

/** Подсказки темы → фильтр ext для $class.logs({ ext }). Без фильтра = все типы дня. */
const EXT_HINTS = [
    [/календар|встреч|\.ics\b|\bics\b/i, 'ics'],
    [/почт|письм|email|\.eml\b|\beml\b/i, 'eml'],
    [/\.task\b|ai\.task|задач[аи] ии/i, 'task'],
];

const datesTool = {
    label: 'Дни журнала',
    icon: 'icons:date-range',
    role: 'user',
    description: 'список дней, за которые есть логи класса',
    async init(params = {}) {
        const b = params.block;
        if (b.content)
            return false;
        const target = await resolveLogClass(params);
        if (!target)
            return false;
        b.path = target.short || target.path;
        b.label = b.path;
        tagAgent(params.box, 'Журнал', b.path);
        try {
            const dates = await target.logs({ mode: 'dates' });
            const list = Array.isArray(dates) ? dates : [];
            b.content = list.length
                ? '[логи ' + b.path + ': дни]\n' + list.map(d => '- ' + d).join('\n')
                : '[логи ' + b.path + ': дни]\n(пусто)';
            return true;
        }
        catch (e) {
            b.error = true;
            b.content = 'logs dates: ' + String(e.message || e);
            return true;
        }
    },
};

const bodiesTool = {
    label: 'Записи дня',
    icon: 'icons:list',
    role: 'user',
    allowReasoning: true,
    description: 'записи журнала за день через $class.logs; фильтр ext (ics/eml/task/logs)',
    system: [
        '# Режим: записи журнала',
        'День YYYY-MM-DD (или «вчера»/«сегодня») и опционально ext.',
        'Фильтры: календарь → ics; почта → eml; задачи ИИ → task; общий журнал → logs.',
        'Только через $class.logs — не читай history-файлы через work.',
        'Не выдумывай записи.',
    ].join('\n'),
    prompt: [
        'День (YYYY-MM-DD | вчера | сегодня), опционально путь класса и ext.',
        'Пример: 2026-09-06',
        'Пример:',
        'вчера',
        'ext: logs',
        'Пример:',
        '/BASE/direction',
        '2026-09-06',
        'ics',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content && b.done)
            return false;
        const { path, day, ext } = parseDayQuery(b, params.box, params.messages, bodiesTool.label);
        const target = await resolveLogClass(params, path);
        if (!target)
            return false;
        const dayKey = day || todayISO();
        b.path = target.short || target.path;
        b.day = dayKey;
        if (ext)
            b.ext = ext;
        b.label = b.path + ' @ ' + dayKey + (ext ? ' .' + ext : '');
        tagAgent(params.box, 'Журнал', b.path + ' @ ' + dayKey + (ext ? ' .' + ext : ''));
        try {
            const args = { mode: 'bodies', day: dayKey };
            if (ext)
                args.ext = ext;
            const rows = await target.logs(args);
            b.content = formatBodies(rows, b.path, dayKey, ext);
            b.done = true;
            return true;
        }
        catch (e) {
            b.error = true;
            b.content = 'logs bodies: ' + String(e.message || e);
            return true;
        }
    },
};

const entryTool = {
    label: 'Запись журнала',
    icon: 'icons:description',
    role: 'user',
    allowReasoning: true,
    description: 'одна запись через read_log_entry (не work.read)',
    system: [
        '# Режим: одна запись',
        'Путь entry из bodies (строка entry: …/history/…/*.logs|*.task|…).',
        'Читай только через read_log_entry класса — не work.read / search.',
        'Не выдумывай содержимое.',
    ].join('\n'),
    prompt: [
        'Путь записи журнала (…/history/YYYY-MM-DD/…).',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.content && b.done)
            return false;
        const entryPath = parseEntryPath(b, params.box, params.messages, entryTool.label);
        if (!entryPath)
            return false;
        const target = await resolveLogClass(params);
        if (!target || typeof target.read_log_entry !== 'function')
            return false;
        b.path = entryPath;
        b.label = entryPath;
        tagAgent(params.box, 'Журнал', 'entry');
        try {
            const row = await target.read_log_entry({ path: entryPath });
            b.content = formatEntry(row, entryPath);
            b.done = true;
            return true;
        }
        catch (e) {
            b.error = true;
            b.content = 'logs entry: ' + String(e.message || e);
            return true;
        }
    },
};

export default {
    label: 'Смотрю журнал',
    icon: 'carbon:log',
    allowReasoning: true,
    description: 'журнал класса через $class.logs (дни, день+ext, entry); хронология/вчера/почта/календарь — не work и не чтение .logs файлами',
    system: [
        '# Агент: logs',
        'Хронология места только через $class.logs / read_log_entry. Не explore, не work.read history.',
        'Порядок: dates → bodies(день, опц. ext) → entry по пути entry: из bodies.',
        'День: YYYY-MM-DD или «вчера»/«сегодня». Фильтр: ics (календарь), eml (почта), task, logs.',
        'Класс: путь из запроса или place исполнения. Без write / save_message.',
        'Не выдумывай записи — только факты из журнала.',
    ].join('\n'),
    prompt: 'Сводка по журналу: кто, когда, что (по фактам из dates/bodies/entry). Пути history не предлагай читать через work.',
    tools: {
        dates: datesTool,
        bodies: bodiesTool,
        entry: entryTool,
    },
};

function tagAgent(box, role, detail) {
    if (!box)
        return;
    const d = String(detail || '').trim();
    box.label = d ? role + ': ' + d : role;
}

/** Как platform logs.today — YYYY-MM-DD (UTC date). */
function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function shiftISO(day, delta) {
    const d = new Date(day + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
}

function resolveRelativeDay(text) {
    const s = String(text || '');
    if (/вчера|yesterday/i.test(s))
        return shiftISO(todayISO(), -1);
    if (/сегодня|today/i.test(s))
        return todayISO();
    if (/позавчера/i.test(s))
        return shiftISO(todayISO(), -2);
    return '';
}

function resolveExtHint(text) {
    const s = String(text || '');
    const explicit = s.match(/(?:^|\n)\s*(?:ext\s*[:=]\s*|\.)?(ics|eml|task|logs|msg)\b/i)
        || s.match(/\.(ics|eml|task|logs|msg)\b/i);
    if (explicit)
        return explicit[1].toLowerCase();
    for (const [re, ext] of EXT_HINTS) {
        if (re.test(s))
            return ext;
    }
    return '';
}

/** $class для логов: явный path → иначе place из engine.$context. */
async function resolveLogClass(params = {}, pathHint = '') {
    let path = String(pathHint || '').trim();
    if (!path)
        path = classPathFrom(params.block, params.box, params.messages);
    if (!path) {
        const ctx = params.engine?.$context;
        path = String(ctx?.short || ctx?.path || '').trim();
    }
    if (!path)
        return null;
    const item = await WORK.get_item(path);
    if (!item || typeof item.logs !== 'function')
        return null;
    return item;
}

function classPathFrom(block, box, messages) {
    const own = String(block?.path || '').trim();
    if (own && !isHistoryPath(own) && !/^\d{4}-\d{2}-\d{2}$/.test(own))
        return own;
    const label = String(block?.label || '').trim();
    if (label.includes('/') && !isHistoryPath(label) && !label.includes(' @ '))
        return label.split(/\s/)[0];
    const brief = String(box?.brief || lastUserContent(messages) || '').trim();
    const m = brief.match(/(\/[^\s]+)/);
    if (m && !isHistoryPath(m[1]))
        return m[1];
    const dates = (box?.items || []).findLast?.(b => b.type === 'dates' && b.path)
        || [...(box?.items || [])].reverse().find(b => b.type === 'dates' && b.path);
    return dates?.path ? String(dates.path) : '';
}

function isHistoryPath(p) {
    return /\/history\/|\.logs\b|\.task\b|\.eml\b|\.ics\b/i.test(String(p || ''));
}

function parseDayQuery(block, box, messages, defaultLabel) {
    const raw = String(block?.content || '').replace(/\r\n/g, '\n').trim();
    let path = '';
    let day = '';
    let ext = '';
    if (raw) {
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(line))
                day = line;
            else if (/^(вчера|сегодня|позавчера|yesterday|today)$/i.test(line))
                day = resolveRelativeDay(line) || day;
            else if (line.startsWith('/') && !isHistoryPath(line))
                path = line.replace(/^#+\s*/, '').trim();
            else {
                const e = resolveExtHint(line);
                if (e)
                    ext = e;
            }
        }
        if (!day)
            day = resolveRelativeDay(raw);
        if (!ext)
            ext = resolveExtHint(raw);
    }
    const label = String(block?.label || '').trim();
    if (!day) {
        const fromLabel = label.match(/(\d{4}-\d{2}-\d{2})/);
        if (fromLabel)
            day = fromLabel[1];
    }
    if (!path && label && label !== defaultLabel && label.includes('/') && !isHistoryPath(label))
        path = label.split(/\s+@\s+/)[0].trim();
    const brief = String(box?.brief || lastUserContent(messages) || '').trim();
    if (!day) {
        const m = brief.match(/(\d{4}-\d{2}-\d{2})/);
        if (m)
            day = m[1];
        else
            day = resolveRelativeDay(brief);
    }
    if (!ext)
        ext = resolveExtHint(brief) || resolveExtHint(label);
    if (!path) {
        const m = brief.match(/(\/[^\s]+)/);
        if (m && !isHistoryPath(m[1]))
            path = m[1];
    }
    // не подставлять «первый день из dates» — это часто «сегодня» вместо «вчера»
    if (!day)
        day = todayISO();
    return { path, day, ext };
}

function parseEntryPath(block, box, messages, defaultLabel) {
    const own = String(block?.path || '').trim();
    if (isHistoryPath(own) && own.startsWith('/'))
        return own;
    const raw = String(block?.content || '').trim();
    const fromRaw = raw.match(/(?:entry|file):\s*(\/[^\s]+)/i)
        || raw.match(/(\/[^\s]*\/history\/[^\s]+)/);
    if (fromRaw)
        return fromRaw[1];
    const label = String(block?.label || '').trim();
    if (label !== defaultLabel && isHistoryPath(label) && label.startsWith('/'))
        return label;
    const brief = String(box?.brief || lastUserContent(messages) || '').trim();
    const fromBrief = brief.match(/(?:entry|file):\s*(\/[^\s]+)/i);
    if (fromBrief)
        return fromBrief[1];
    const bodies = (box?.items || []).findLast?.(b => b.type === 'bodies' && b.content)
        || [...(box?.items || [])].reverse().find(b => b.type === 'bodies' && b.content);
    const hit = String(bodies?.content || '').match(/entry:\s*(\/[^\s]+)/);
    return hit ? hit[1] : '';
}

function formatBodies(rows, classPath, day, ext) {
    const list = Array.isArray(rows) ? rows : [];
    const filt = ext ? ' .' + ext : '';
    const head = '[логи ' + classPath + ' @ ' + day + filt + ': ' + list.length + ']';
    if (!list.length)
        return head + '\n(нет записей)';
    const slice = list.slice(0, BODIES_LIMIT);
    const lines = [head];
    for (const row of slice)
        lines.push(formatBodyLine(row));
    if (list.length > BODIES_LIMIT)
        lines.push('- … ещё ' + (list.length - BODIES_LIMIT) + ' записей');
    return lines.join('\n');
}

function formatBodyLine(row) {
    const t = row.time ? new Date(row.time).toISOString().slice(11, 19) : '??:??:??';
    const who = row.sender || row.user || row.uid || '—';
    const ext = row.ext || '';
    const msg = String(row.message || row.content || row.text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const file = row.logsFilePath || row.path || '';
    const bits = ['- ' + t, who];
    if (ext)
        bits.push('(' + ext + ')');
    if (msg)
        bits.push('— ' + msg);
    let line = bits.join(' ');
    // entry: — для tool entry / read_log_entry; не маскировать под обычный файл для work
    if (file)
        line += '\n  entry: ' + file;
    return line;
}

function formatEntry(row, path) {
    if (!row)
        return '[entry ' + path + ']\n(пусто)';
    const t = row.time ? new Date(row.time).toISOString() : '';
    const who = row.sender || row.user || row.uid || '';
    const msg = String(row.message || row.content || row.text || '').trim();
    const includes = Array.isArray(row.includes) ? row.includes : [];
    const lines = ['[entry ' + path + ']'];
    if (t)
        lines.push('time: ' + t);
    if (who)
        lines.push('sender: ' + who);
    if (msg)
        lines.push(msg.slice(0, ENTRY_CONTENT_MAX));
    if (includes.length)
        lines.push('includes:\n' + includes.map(p => '- ' + p).join('\n'));
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
