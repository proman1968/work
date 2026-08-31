/**
 * Usage stats for context dial (from task JSON).
 */

const DEFAULT_CONTEXT_LIMIT = 128000;

function estimateTokens(text) {
    const s = String(text || '');
    if (!s) return 0;
    return Math.max(1, Math.ceil(s.length / 4));
}

export function fmtTokens(n) {
    const v = Number(n) || 0;
    if (v >= 10000) return Math.round(v / 1000) + 'k';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return String(Math.round(v));
}

function sumUsageFromItems(items) {
    let prompt = 0, completion = 0, total = 0, lastPrompt = 0;
    const walk = (list) => {
        for (const b of list || []) {
            const u = b?.usage;
            if (u && typeof u === 'object') {
                const p = Number(u.prompt_tokens ?? u.prompt) || 0;
                const c = Number(u.completion_tokens ?? u.completion) || 0;
                const t = Number(u.total_tokens ?? u.total) || (p + c);
                if (p) lastPrompt = p;
                prompt += p;
                completion += c;
                total += t;
            }
            if (b?.items?.length) walk(b.items);
        }
    };
    walk(items);
    return { prompt, completion, total, lastPrompt };
}

/** Кэш лимитов по пути модели: клиентский WORK.get_item возвращает Promise, синхронно item не прочитать. */
const LIMITS = {};

/** Лимит контекста — maxTokens модели. При промахе кэша резолвит item и зовёт retrigger —
 *  хост сбрасывает computed (паттерн hasEffort), геттер пересчитывается с готовым значением. */
function modelLimit(data, retrigger) {
    const path = data?.model;
    if (!path) return 0;
    const hit = LIMITS[path];
    if (typeof hit === 'number') return hit;
    LIMITS[path] ??= Promise.resolve(WORK.get_item(path))
        .then(async item => LIMITS[path] = Number(await item?.maxTokens) || 0)
        .then(v => { retrigger?.(); return v; })
        .catch(() => LIMITS[path] = 0);
    return 0;
}

export function buildUsageStats(data, retrigger) {
    const root = data?.usage && typeof data.usage === 'object' ? data.usage : null;
    const agg = sumUsageFromItems(data?.items);
    const system = estimateTokens(data?.system);
    const used = Number(root?.contextUsed ?? root?.prompt ?? root?.prompt_tokens)
        || agg.lastPrompt
        || system;
    const limit = Number(root?.contextLimit ?? root?.limit) || modelLimit(data, retrigger) || DEFAULT_CONTEXT_LIMIT;
    let pct = Number(root?.contextPct);
    if (!Number.isFinite(pct))
        pct = limit > 0 ? Math.round(used / limit * 100) : 0;
    pct = Math.min(100, Math.max(0, pct));

    // Бар = только состав used (прошлые ответы уже внутри lastPrompt); completion сессии — справкой в легенде
    const conversation = Math.max(0, used - system);
    const segments = [
        { id: 'system', label: 'System', tokens: system, color: 'var(--dark-color)' },
        { id: 'conversation', label: 'Диалог', tokens: conversation, color: 'var(--accent-color)' },
    ].filter(s => s.tokens > 0);

    // Масштаб от лимита: остаток бара — пустой трек
    for (const s of segments)
        s.pct = limit > 0 ? Math.min(100, s.tokens / limit * 100) : 0;

    const info = agg.completion
        ? [{ id: 'completion', label: 'Ответы (сессия)', tokens: agg.completion, color: 'var(--success-color)' }]
        : [];

    return {
        pct,
        used,
        limit,
        usedText: fmtTokens(used),
        limitText: fmtTokens(limit),
        line: [
            pct + '%',
            fmtTokens(used) + ' / ' + fmtTokens(limit),
            agg.completion ? '↓' + fmtTokens(agg.completion) : '',
        ].filter(Boolean).join(' · '),
        segments,
        rows: [...segments, ...info],
    };
}
