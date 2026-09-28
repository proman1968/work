/**
 * Проекции ленты для доков и контекста (чистые функции, без DOM):
 *   collectDocs(items)  — полезные результаты работы: файлы (записанные/изменённые/картинки/навыки),
 *                          отчёты субагентов, развёрнутые ответы-сводки;
 *   computeStats(body)  — статистика сессии для вкладки «Контекст».
 */

const FILE_TOOLS = { write: 'carbon:document-add', edit: 'carbon:edit', generate_image: 'carbon:image', save_skill: 'carbon:skill-level' };
const REPORT_MIN = 700;

function basename(p) {
    return String(p || '').split('/').pop() || String(p || '');
}

function plainTitle(text, max = 48) {
    const s = String(text || '');
    const h = s.match(/^\s{0,3}#{1,4}\s+(.+)$/m);
    let t = (h ? h[1] : s.split('\n').find(l => l.trim()) || '').replace(/[*_`#>\[\]]/g, '').replace(/\(http[^)]*\)/g, '').trim();
    if (t.length > max)
        t = t.slice(0, max - 1) + '…';
    return t || 'Документ';
}

/** Ответ — документ: длинный или структурированный (заголовки, таблица). */
export function isReport(text) {
    const s = String(text || '');
    if (s.length >= REPORT_MIN)
        return true;
    return s.length >= 300 && (/^\s{0,3}#{1,3}\s/m.test(s) || /^\|.+\|\s*$/m.test(s));
}

export function collectDocs(items) {
    const docs = [];
    const byKey = new Map();
    const put = d => {
        const prev = byKey.get(d.key);
        if (prev) {
            Object.assign(prev, d);
            return;
        }
        byKey.set(d.key, d);
        docs.push(d);
    };
    const walkFiles = (list, nested) => {
        for (const it of list || []) {
            if (it?.type !== 'assistant')
                continue;
            for (const t of it.tools || []) {
                if (FILE_TOOLS[t.name] && t.status === 'ok' && t.path)
                    put({ key: 'file:' + t.path, kind: 'file', path: t.path, title: basename(t.path), icon: FILE_TOOLS[t.name], time: it.time, source: t.id });
                if (t.name === 'task' && t.status === 'ok' && t.result && !nested)
                    put({ key: 'agent:' + t.id, kind: 'text', text: String(t.result), title: t.args?.description || plainTitle(t.result), icon: 'carbon:bot', time: it.time, source: t.id, subtitle: 'отчёт субагента ' + (t.agent || t.args?.agent || '') });
                if (Array.isArray(t.items))
                    walkFiles(t.items, true);
            }
            if (!nested && !it.error && isReport(it.content))
                put({ key: 'reply:' + it.id, kind: 'text', text: String(it.content), title: plainTitle(it.content), icon: 'carbon:document', time: it.time, source: it.id, subtitle: 'ответ агента' });
        }
    };
    walkFiles(items, false);
    return docs;
}

function est(text) {
    return Math.ceil(String(text || '').length / 3.2);
}

function sumUsage(items, acc) {
    for (const it of items || []) {
        if (it?.type !== 'assistant')
            continue;
        acc.assistant++;
        const u = it.usage;
        if (u) {
            acc.input += Number(u.prompt) || 0;
            acc.output += Number(u.completion) || 0;
            acc.total += Number(u.total) || ((Number(u.prompt) || 0) + (Number(u.completion) || 0));
        }
        acc.reasoning += est(it.reasoning);
        for (const t of it.tools || []) {
            acc.calls++;
            if (t.status === 'error')
                acc.callErrors++;
            if (Array.isArray(t.items))
                sumUsage(t.items, acc);
        }
    }
}

/** Статистика сессии. model — путь модели; limit — из body.context (сервер) или modelLimit. */
export function computeStats(body, modelLimit = 0) {
    const items = body?.items || [];
    const live = items.filter(i => !i.compacted);
    const acc = { input: 0, output: 0, total: 0, reasoning: 0, calls: 0, callErrors: 0, assistant: 0 };
    sumUsage(items, acc);
    const users = items.filter(i => i.type === 'user').length;
    const ctx = body?.context || {};
    const lastAssistant = [...items].reverse().find(i => i.type === 'assistant' && i.usage?.prompt);
    const limit = Number(ctx.limit) || Number(modelLimit) || 0;
    // состав контекста последнего хода: сервер знает system и схемы, диалог — оценка по ленте
    let userT = 0, replyT = 0, toolT = 0, summaryT = 0;
    for (const it of live) {
        if (it.type === 'user')
            userT += est(it.content);
        else if (it.type === 'summary')
            summaryT += est(it.content);
        else if (it.type === 'assistant') {
            replyT += est(it.content);
            for (const t of it.tools || [])
                toolT += est(JSON.stringify(t.args || {})) + est(t.result || t.error || '');
        }
    }
    const parts = [
        { id: 'system', label: 'System и контракт места', tokens: Number(ctx.system) || 0, color: 'var(--muted-color)' },
        { id: 'tools', label: 'Схемы инструментов', tokens: Number(ctx.tools) || 0, color: 'oklch(from var(--accent-color) l c calc(h + 60))' },
        { id: 'user', label: 'Сообщения пользователя', tokens: userT, color: 'var(--accent-color)' },
        { id: 'reply', label: 'Ответы агента', tokens: replyT, color: 'oklch(from var(--accent-color) calc(l + .15) c calc(h - 40))' },
        { id: 'calls', label: 'Вызовы инструментов', tokens: toolT, color: 'orange' },
        { id: 'summary', label: 'Сводка сжатия', tokens: summaryT, color: 'teal' },
    ].filter(p => p.tokens > 0);
    const estTotal = parts.reduce((s, p) => s + p.tokens, 0) || 1;
    const used = Number(lastAssistant?.usage?.prompt) || estTotal;
    for (const p of parts)
        p.pct = Math.round(p.tokens / estTotal * 100);
    const times = items.map(i => Number(i.time) || 0).filter(Boolean);
    const lastItem = items[items.length - 1];
    return {
        title: body?.title || body?.name || 'Задача',
        model: String(body?.model || ''),
        modelName: String(body?.model || '').split('/').pop() || '—',
        provider: String(body?.model || '').split('/')[2] || '—',
        limit,
        used,
        pct: limit ? Math.min(100, Math.round(used / limit * 100)) : 0,
        total: acc.total,
        input: acc.input,
        output: acc.output,
        reasoning: acc.reasoning,
        users,
        assistant: acc.assistant,
        calls: acc.calls,
        callErrors: acc.callErrors,
        items: items.length,
        compacted: items.filter(i => i.compacted).length,
        created: Number(body?.created) || Number(body?.time) || (times.length ? Math.min(...times) : 0),
        updated: Number(body?.updated) || (lastItem ? (Number(lastItem.time) || 0) + (Number(lastItem.durationMs) || 0) : 0),
        parts,
    };
}

export function fmtNum(n) {
    return (Number(n) || 0).toLocaleString('ru-RU');
}

export function fmtDate(ms) {
    const t = Number(ms) || 0;
    if (!t)
        return '—';
    try {
        return new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    catch {
        return '—';
    }
}
