/**
 * Цикл агента на нативном tool calling.
 *
 * Лента (items) — единственный источник правды: из неё строится контекст модели,
 * по ней рисует UI, с неё продолжается работа после стопа/рестарта.
 *
 * Элементы ленты:
 *   { id, type:'user', content, time, attachments? }
 *   { id, type:'assistant', content, reasoning?, time, model, usage?, durationMs?, stopped?, error?,
 *     tools?: [{ id, name, args, status, result?, error?, answer?, items?, path?, diff?, durationMs? }] }
 *     status: pending | approval | waiting | running | ok | error | denied | interrupted
 *   { id, type:'summary', content, time }   — сжатие контекста; старые элементы получают compacted:true
 *   { id, type:'error', content, time }
 *
 * host — контракт владельца ленты:
 *   save(): Promise          — персист (владелец сам решает, как часто писать на диск)
 *   emit(event)              — стрим в UI: { type:'delta', item, field:'content'|'reasoning', token }
 *   wait(request): Promise   — стоп на человека: { kind:'approval'|'question', item, call, ... } → ответ
 *   signal: AbortSignal      — стоп пользователя
 *   mode: 'auto'|'ask'|'plan' — режим разрешений
 *   allowed: Set<string>     — «разрешить всегда» в этой сессии (имена инструментов)
 */
import { genId, clip, estimateTokens, resultText, StopError, throwIfStopped } from './util.js';
import { decide } from './permissions.js';

export const MAX_TURNS = 60;
export const RESULT_MAX = 24000;
export const OLD_RESULT_MAX = 1500;
export const KEEP_FULL_TURNS = 6;
export const STREAM_RETRIES = 2;
export const COMPACT_AT = 0.72;

/**
 * Выполнить агента до ответа без вызовов инструментов (или стопа/лимита).
 * @param {object} opts
 * @param {object} opts.llm  { name, contextTokens, stream(req) → AsyncIterable }
 * @param {string|Function} opts.system  system-промпт или async () => string
 * @param {Array} opts.items  лента (мутируется)
 * @param {Array} opts.tools  инструменты { name, description, parameters, readonly?, risk?, run(args, ctx) }
 * @param {object} opts.host
 * @param {object} [opts.ctx]  доп. поля в ctx инструментов (session, place, …)
 * @returns {Promise<{status:'done'|'limit'|'stopped'|'error', content?:string}>}
 */
export async function runLoop(opts) {
    const { llm, items, host } = opts;
    const maxTurns = opts.maxTurns ?? MAX_TURNS;
    const tools = visibleTools(opts.tools || [], host.mode);
    const byName = new Map(tools.map(t => [t.name, t]));
    const schemas = tools.map(toSchema);
    try {
        // подтверждённые после рестарта вызовы последнего хода — исполнить до продолжения
        const last = [...items].reverse().find(i => i.type === 'assistant');
        for (const entry of last?.tools || [])
            if (entry.status === 'approved')
                await runOne({ entry, tool: byName.get(entry.name), it: last, host, llm, opts, preapproved: true });
        await recoverInterrupted(items, host);
        for (let turn = 0; ; turn++) {
            throwIfStopped(host.signal);
            if (turn >= maxTurns) {
                items.push({ id: genId(), type: 'error', time: Date.now(), content: 'Лимит шагов (' + maxTurns + ') исчерпан. Напишите «продолжай», чтобы идти дальше.' });
                await host.save();
                return { status: 'limit' };
            }
            const system = typeof opts.system === 'function' ? await opts.system() : String(opts.system || '');
            await maybeCompact({ llm, items, host, system });
            const messages = toMessages(system, items);
            const it = { id: genId(), type: 'assistant', content: '', time: Date.now(), model: llm.name };
            items.push(it);
            await host.save();
            const calls = await streamTurn({ llm, host, it, messages, schemas: schemas.length ? schemas : undefined, effort: opts.effort });
            if (!calls.length) {
                if (!it.content.trim()) {
                    it.error = true;
                    it.content = 'Модель вернула пустой ответ.';
                    await host.save();
                    return { status: 'error', content: it.content };
                }
                await host.save();
                return { status: 'done', content: it.content };
            }
            it.tools = calls.map(c => ({ id: c.id || genId(), name: c.name, args: c.arguments || {}, status: 'pending' }));
            await host.save();
            await runCalls({ it, byName, host, llm, opts });
        }
    }
    catch (e) {
        if (e instanceof StopError || host.signal?.aborted) {
            markInterrupted(items, 'interrupted');
            await host.save();
            return { status: 'stopped' };
        }
        throw e;
    }
}

/** Инструменты по режиму: plan — только чтение (+ вопросы/план). */
function visibleTools(tools, mode) {
    if (mode !== 'plan')
        return tools;
    return tools.filter(t => t.readonly || t.planSafe);
}

export function toSchema(tool) {
    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description || tool.name,
            parameters: tool.parameters || { type: 'object', properties: {} },
        },
    };
}

/** Один ход модели: стрим текста/рассуждения, ретраи до первого токена. */
async function streamTurn({ llm, host, it, messages, schemas, effort }) {
    const t0 = Date.now();
    for (let attempt = 0; ; attempt++) {
        let calls = [];
        try {
            for await (const ch of llm.stream({ messages, tools: schemas, signal: host.signal, effort })) {
                if (host.signal?.aborted)
                    break;
                if (typeof ch === 'string') {
                    it.content += ch;
                    host.emit?.({ type: 'delta', item: it.id, field: 'content', token: ch });
                }
                else if (ch?.type === 'reasoning') {
                    it.reasoning = (it.reasoning || '') + ch.content;
                    host.emit?.({ type: 'delta', item: it.id, field: 'reasoning', token: ch.content });
                }
                else if (ch?.type === 'usage')
                    it.usage = { prompt: ch.prompt_tokens, completion: ch.completion_tokens, total: ch.total_tokens };
                else if (ch?.type === 'tool_calls')
                    calls = ch.calls || [];
            }
            if (host.signal?.aborted) {
                it.stopped = true;
                throw new StopError();
            }
            it.content = stripThink(it.content).replace(/^\s+/, '').replace(/\s+$/, '');
            it.durationMs = Date.now() - t0;
            return calls;
        }
        catch (e) {
            if (e instanceof StopError || host.signal?.aborted) {
                it.stopped = true;
                it.durationMs = Date.now() - t0;
                throw new StopError();
            }
            const fresh = !it.content && !it.reasoning;
            if (fresh && attempt < STREAM_RETRIES && !/401|403|virtual key|ключ/i.test(String(e.message))) {
                await sleep(1500 * (attempt + 1), host.signal);
                continue;
            }
            it.error = true;
            it.content = [it.content, 'Ошибка модели: ' + String(e.message || e)].filter(Boolean).join('\n\n');
            it.durationMs = Date.now() - t0;
            await host.save();
            throw Object.assign(new Error(String(e.message || e)), { reported: true });
        }
    }
}

/** <think>…</think> в content (модели без отдельного reasoning-канала). */
function stripThink(text) {
    return String(text || '').replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
}

function sleep(ms, signal) {
    return new Promise(resolve => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });
}

/** Вызовы хода: подряд идущие read-only — параллельно, остальные — по одному. */
async function runCalls({ it, byName, host, llm, opts }) {
    const entries = it.tools;
    let i = 0;
    while (i < entries.length) {
        throwIfStopped(host.signal);
        const tool = byName.get(entries[i].name);
        const parallel = t => !!(t?.readonly || t?.concurrent);
        if (parallel(tool)) {
            const batch = [];
            while (i < entries.length && parallel(byName.get(entries[i].name)))
                batch.push(entries[i++]);
            await Promise.all(batch.map(e => runOne({ entry: e, tool: byName.get(e.name), it, host, llm, opts })));
        }
        else {
            await runOne({ entry: entries[i++], tool, it, host, llm, opts });
        }
    }
}

async function runOne({ entry, tool, it, host, llm, opts, preapproved }) {
    if (!tool) {
        entry.status = 'error';
        entry.error = 'Нет инструмента «' + entry.name + '». Доступны: ' + [...(opts.tools || [])].map(t => t.name).join(', ');
        await host.save();
        return;
    }
    if (entry.args?.raw && Object.keys(entry.args).length === 1) {
        entry.status = 'error';
        entry.error = 'Аргументы не разобраны как JSON: ' + clip(entry.args.raw, 300);
        await host.save();
        return;
    }
    const missing = (tool.parameters?.required || []).filter(k => entry.args?.[k] == null || entry.args[k] === '');
    if (missing.length) {
        entry.status = 'error';
        entry.error = 'Нет обязательных аргументов: ' + missing.join(', ');
        await host.save();
        return;
    }
    const ctx = {
        ...(opts.ctx || {}),
        host, llm, entry, turn: it,
        signal: host.signal,
        depth: opts.depth || 0,
        tools: opts.tools,
        runLoop,
    };
    const decision = preapproved ? { verdict: 'allow' } : await decide(tool, entry.args || {}, ctx);
    if (decision.verdict === 'deny') {
        entry.status = 'denied';
        entry.error = decision.reason || 'запрещено политикой';
        await host.save();
        return;
    }
    if (decision.verdict === 'ask' && typeof host.wait !== 'function') {
        entry.status = 'denied';
        entry.error = 'нужно подтверждение человека (' + (decision.reason || 'политика') + '), а запуск автономный — предложи действие в ответе';
        await host.save();
        return;
    }
    if (decision.verdict === 'ask') {
        entry.status = 'approval';
        entry.reason = decision.reason;
        await host.save();
        const res = await host.wait({ kind: 'approval', item: it.id, call: entry.id, tool: entry.name, args: entry.args, reason: decision.reason }) || {};
        throwIfStopped(host.signal);
        delete entry.reason;
        if (res.always)
            host.allowed?.add?.(entry.name);
        if (!res.accept) {
            entry.status = 'denied';
            entry.answer = res.content ? String(res.content) : undefined;
            await host.save();
            return;
        }
    }
    entry.status = 'running';
    const t0 = Date.now();
    await host.save();
    try {
        const value = await tool.run(entry.args || {}, ctx);
        throwIfStopped(host.signal);
        if (value && typeof value === 'object' && !Array.isArray(value) && value.error && Object.keys(value).length <= 3) {
            entry.status = 'error';
            entry.error = String(value.error);
        }
        else {
            entry.status = 'ok';
            entry.result = clip(resultText(value), RESULT_MAX);
        }
    }
    catch (e) {
        if (e instanceof StopError || host.signal?.aborted) {
            entry.status = 'interrupted';
            entry.durationMs = Date.now() - t0;
            throw new StopError();
        }
        entry.status = 'error';
        entry.error = String(e?.message || e);
    }
    entry.durationMs = Date.now() - t0;
    await host.save();
}

/** Незакрытые вызовы (обрыв, рестарт) → interrupted: модель увидит честный результат. */
function markInterrupted(items, status) {
    for (const it of items) {
        if (it.type !== 'assistant')
            continue;
        for (const t of it.tools || []) {
            if (['pending', 'running', 'approval', 'waiting'].includes(t.status))
                t.status = status;
            if (Array.isArray(t.items))
                markInterrupted(t.items, status);
        }
    }
}

async function recoverInterrupted(items, host) {
    const before = JSON.stringify(items.map(i => i.tools?.map(t => t.status)));
    markInterrupted(items, 'interrupted');
    if (JSON.stringify(items.map(i => i.tools?.map(t => t.status))) !== before)
        await host.save();
}

/** Текст результата вызова для модели. */
export function toolContent(t, old = false) {
    switch (t.status) {
        case 'ok': {
            const r = String(t.result ?? 'ok');
            return old ? clip(r, OLD_RESULT_MAX) : r;
        }
        case 'error':
            return 'Ошибка: ' + (t.error || 'неизвестно');
        case 'denied':
            return 'Пользователь отклонил вызов.' + (t.answer ? ' Комментарий: ' + t.answer : '') + (t.error ? ' ' + t.error : '');
        default:
            return 'Вызов прерван (стоп или перезапуск) — результата нет.';
    }
}

/**
 * Лента → messages (OpenAI-формат). Сжатые элементы пропускаются,
 * результаты старых ходов урезаются (микросжатие).
 */
export function toMessages(system, items) {
    const out = [];
    if (system)
        out.push({ role: 'system', content: system });
    const live = items.filter(i => !i.compacted);
    const assistants = live.filter(i => i.type === 'assistant');
    const fullFrom = assistants.length - KEEP_FULL_TURNS;
    let ai = 0;
    for (const it of live) {
        switch (it.type) {
            case 'user':
                out.push({ role: 'user', content: userContent(it) });
                break;
            case 'summary':
                out.push({ role: 'user', content: '[Сводка предыдущей части работы]\n' + it.content });
                break;
            case 'assistant': {
                const old = ai++ < fullFrom;
                const tools = (it.tools || []).filter(t => t && t.name);
                const msg = { role: 'assistant', content: it.content || '' };
                if (tools.length)
                    msg.tool_calls = tools.map(t => ({
                        id: t.id,
                        type: 'function',
                        function: { name: t.name, arguments: JSON.stringify(t.args || {}) },
                    }));
                if (!msg.content && !msg.tool_calls)
                    break;
                out.push(msg);
                for (const t of tools)
                    out.push({ role: 'tool', tool_call_id: t.id, content: toolContent(t, old) });
                break;
            }
            default:
                break;
        }
    }
    return out;
}

function userContent(it) {
    const text = String(it.content || '');
    const att = (it.attachments || []).filter(a => a?.path);
    const images = att.filter(a => a.image_url);
    const note = att.length ? '\n\n[Вложения]\n' + att.map(a => '- ' + a.path + (a.name ? ' (' + a.name + ')' : '')).join('\n') : '';
    if (!images.length)
        return text + note;
    return [{ type: 'text', text: text + note }, ...images.map(a => ({ type: 'image_url', image_url: { url: a.image_url } }))];
}

/** Сжатие: контекст близок к пределу — старая часть ленты → сводка. */
export async function maybeCompact({ llm, items, host, system, force = false }) {
    const limit = Number(llm.contextTokens) || 32000;
    const messages = toMessages(system, items);
    if (!force && estimateTokens(messages) < limit * COMPACT_AT)
        return false;
    const live = items.filter(i => !i.compacted);
    // граница — последний user-элемент, чтобы не резать пары вызов/результат
    let cut = -1;
    for (let k = live.length - 1; k > 0; k--) {
        if (live[k].type === 'user' && k <= live.length - 2) {
            cut = k;
            break;
        }
    }
    if (cut <= 0) {
        // одна длинная реплика: сжимаем всё, кроме последних 2 ходов
        cut = Math.max(0, live.length - 2);
        while (cut > 0 && live[cut].type !== 'assistant')
            cut--;
    }
    if (cut <= 0)
        return false;
    const old = live.slice(0, cut);
    const transcript = toMessages('', old)
        .map(m => m.role.toUpperCase() + ': ' + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
            + (m.tool_calls ? '\n' + m.tool_calls.map(c => '→ ' + c.function.name + ' ' + c.function.arguments).join('\n') : ''))
        .join('\n\n');
    let summary = '';
    for await (const ch of llm.stream({
        messages: [
            { role: 'system', content: 'Ты сжимаешь историю работы агента. Сохрани: цель пользователя, принятые решения, факты и пути (WORK-пути, файлы, классы), что уже сделано, что осталось, открытые вопросы. Кратко, по-русски, списками.' },
            { role: 'user', content: clip(transcript, Math.floor(limit * 2.4)) },
        ],
        signal: host.signal,
    })) {
        if (typeof ch === 'string')
            summary += ch;
    }
    summary = stripThink(summary).trim();
    if (!summary)
        return false;
    for (const it of old)
        it.compacted = true;
    const idx = items.indexOf(live[cut]);
    items.splice(idx, 0, { id: genId(), type: 'summary', time: Date.now(), content: summary });
    await host.save();
    return true;
}
