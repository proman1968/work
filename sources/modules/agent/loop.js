// @ts-check
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
import { log } from './log.js';
import { genId, clip, estimateTokens, resultText, StopError, throwIfStopped } from './util.js';
import { decide } from './permissions.js';
import { newNonce, wrapUntrusted, taintSources, untrustedNames } from './taint.js';
import { runPreTool, runAppend, runNotify } from './hooks.js';
import { costOf, recordUsage, budgetExceeded } from './cost.js';

/** 9.5: самопроверка перед завершением — открытые пункты плана (todo_write). */
export const SELF_CHECK_NUDGE = '[Самопроверка] Перед завершением: в плане задачи остались незакрытые пункты';

/** Открытые пункты плана (не завершённые) с непустым содержанием — для самопроверки (9.5). */
export function openTodosOf(todos) {
    return (Array.isArray(todos) ? todos : [])
        .filter(t => t && String(t?.content || '').trim() && String(t?.status || '') !== 'completed')
        .map(t => ({ content: String(t.content), status: String(t.status || 'pending') }));
}

export const MAX_TURNS = 60;
export const RESULT_MAX = 24000;
export const OLD_RESULT_MAX = 1500;
export const KEEP_FULL_TURNS = 6;
export const STREAM_RETRIES = 2;
export const EMPTY_RETRIES = 2;
export const COMPACT_AT = 0.72;
/** usage ответа считается достоверным, если не меньше этой доли от system + схем инструментов (они есть в каждом запросе). */
export const USAGE_TRUST_MIN = 0.7;
/** Заголовок служебного сообщения с изменчивой частью среды (время, режим…), см. splitSystem/toMessages. */
export const VOLATILE_HEAD = '[Служебный контекст среды на этот ход — не реплика пользователя]\n';

/**
 * system → { stable, volatile }. Строка (разовые вызовы, сжатие) — только стабильная часть.
 * stable идёт первым сообщением system и почти не меняется (префикс для кэша провайдера),
 * volatile (время, режим) — отдельным сообщением в КОНЦЕ: изменение в начале сломало бы кэш всей истории.
 * @param {string | { stable?: string, volatile?: string } | Function} system
 * @returns {{ stable: string, volatile: string }}
 */
export function splitSystem(system) {
    if (system && typeof system === 'object')
        return { stable: String(system.stable || ''), volatile: String(system.volatile || '') };
    return { stable: String(system || ''), volatile: '' };
}

/** Весь текст system одной строкой (оценка токенов).
 * @param {string | { stable?: string, volatile?: string } | Function} system
 * @returns {string}
 */
export function systemText(system) {
    const { stable, volatile } = splitSystem(system);
    return volatile ? stable + '\n\n' + volatile : stable;
}

/** Скрытая подсказка после пустого хода (только в messages, в ленту не пишется). */
export const EMPTY_NUDGE = '[Система] Твой предыдущий ответ был пустым: ни текста, ни вызова инструмента. Продолжай работу — вызови нужный инструмент или напиши итоговый ответ пользователю.';

/**
 * Выполнить агента до ответа без вызовов инструментов (или стопа/лимита).
 * @param {LoopOpts} opts
 * @returns {Promise<RunResult>}
 */
export async function runLoop(opts) {
    let res;
    try {
        res = await runLoopCore(opts);
    }
    catch (e) {
        await notifyStop(opts, { status: 'error', content: String(e?.message || e) });
        throw e;
    }
    await notifyStop(opts, res);
    return res;
}

/** Хук on_stop (hooks.js): только для основного цикла задачи, не для субагентов. */
async function notifyStop(opts, res) {
    if (opts.depth || !opts.hooks?.on_stop?.length)
        return;
    await runNotify(opts.hooks, 'on_stop', {
        status: res.status, content: clip(res.content || '', 2000),
        turns: opts.items.filter(i => i.type === 'assistant').length,
        task: opts.ctx?.task?.path || null,
    }, opts.ctx);
}

async function runLoopCore(opts) {
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
        let empty = 0;
        let selfChecked = false; // 9.5: самопроверка — не чаще одного раза на задачу (без зацикливания)
        for (let turn = 0; ; turn++) {
            throwIfStopped(host.signal);
            if (turn >= maxTurns) {
                items.push({ id: genId(), type: 'error', time: Date.now(), content: 'Лимит шагов (' + maxTurns + ') исчерпан. Напишите «продолжай», чтобы идти дальше.' });
                await host.save();
                return { status: 'limit' };
            }
            // 9.2: дневной бюджет (ai/config.js limits: dayTokens/dayCost) — исчерпан: стоп с пояснением
            if (opts.ctx?.session) {
                const over = await budgetExceeded({ config: opts.ctx?.env?.config, uid: opts.ctx.session.uid });
                if (over) {
                    items.push({ id: genId(), type: 'error', time: Date.now(), content: 'Бюджет остановил задачу: ' + over.reason });
                    await host.save();
                    return { status: 'limit' };
                }
            }
            const system = typeof opts.system === 'function' ? await opts.system() : (opts.system ?? '');
            const toolsTokens = estimateTokens(schemas);
            await maybeCompact({ llm, items, host, system, toolsTokens, hooks: opts.hooks, task: opts.ctx?.task });
            const images = llm.vision ? await loadImages(items, opts.loadImage) : null;
            const messages = toMessages(system, items, images);
            if (empty)
                messages.push({ role: 'user', content: EMPTY_NUDGE });
            const systemTokens = estimateTokens(systemText(system));
            const measured = estimateContext({ items, system, toolsTokens });
            host.noteContext?.({
                limit: Number(llm.contextTokens) || 0,
                system: systemTokens,
                tools: toolsTokens,
                messages: estimateTokens(messages) - systemTokens,
                used: measured.tokens,
                source: measured.source,
            });
            const it = { id: genId(), type: 'assistant', content: '', time: Date.now(), model: llm.name };
            items.push(it);
            await host.save();
            const calls = await streamTurn({ llm, host, it, messages, schemas: schemas.length ? schemas : undefined, effort: opts.effort });
            // 9.2: стоимость хода по тарифам модели (pricing) + учёт (agent_usage в .index/work.db)
            if (it.usage) {
                const cost = costOf(it.usage, llm.pricing);
                if (cost != null)
                    it.usage.cost = cost;
                await recordUsage({
                    uid: opts.ctx?.session?.uid,
                    place: opts.ctx?.place?.path,
                    task: opts.ctx?.task?.path,
                    model: llm.used || llm.name,
                    usage: it.usage,
                    cost,
                });
            }
            if (!calls.length) {
                // реплики, пришедшие во время хода, — в ленту и ещё один ход
                if (takeQueued(items, host, opts.depth)) {
                    await host.save();
                    continue;
                }
                if (!it.content.trim()) {
                    // пустой ход (только рассуждение / обрыв без ошибки) — сами делаем «дальше»
                    if (it.finish !== 'length' && empty < EMPTY_RETRIES) {
                        empty++;
                        items.splice(items.indexOf(it), 1);
                        await host.save();
                        continue;
                    }
                    it.error = true;
                    it.content = emptyReason(it);
                    await host.save();
                    return { status: 'error', content: it.content };
                }
                // 9.5: самопроверка — в плане остались незакрытые пункты: реплика-подсказка и ещё ход
                // (модель либо завершает их инструментами, либо объясняет в ответе, почему нельзя);
                // даётся один раз — иначе цикл не завершился бы никогда
                const open = openTodosOf(host.getTodos?.());
                if (open.length && !selfChecked) {
                    selfChecked = true;
                    items.push({
                        id: genId(), type: 'user', time: Date.now(),
                        content: SELF_CHECK_NUDGE + ':\n'
                            + open.slice(0, 20).map(t => '- ' + t.content + (t.status !== 'pending' ? ' (' + t.status + ')' : '')).join('\n')
                            + '\nЗаверши их инструментами или объясни в итоговом ответе, почему пункт не выполнен.',
                    });
                    await host.save();
                    continue;
                }
                await host.save();
                return { status: 'done', content: it.content };
            }
            empty = 0;
            it.tools = calls.map(c => ({ id: c.id || genId(), name: c.name, args: c.arguments || {}, status: 'pending' }));
            await host.save();
            await runCalls({ it, byName, host, llm, opts });
            if (takeQueued(items, host, opts.depth))
                await host.save();
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

/** Реплики человека, отправленные во время работы (host.takeQueue) → в ленту. @returns {boolean} были ли */
function takeQueued(items, host, depth) {
    if (depth)
        return false; // субагенты реплики человека не забирают
    const q = host.takeQueue?.() || [];
    for (const u of q)
        items.push({ ...u, queued: undefined });
    return q.length > 0;
}

export const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
export const IMAGE_MAX = 5 * 1024 * 1024;
/** Скриншоты компьютера в контексте: не больше этого, только свежие (старые вычищает stripOldShots). */
export const SHOTS_IN_CONTEXT = 3;
export const SHOT_MAX_BYTES = 3 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Картинки результата инструмента [{ png: Buffer|base64, label? }] → [{ url, label }] для ленты.
 * Хранятся data-URL в JSON задачи (последние 3 — в контексте модели, см. toMessages).
 */
export function normalizeShots(shots) {
    const out = [];
    for (const s of Array.isArray(shots) ? shots : []) {
        const buf = Buffer.isBuffer(s?.png) ? s.png : (typeof s?.png === 'string' ? Buffer.from(s.png, 'base64') : null);
        if (!buf || buf.length < 8 || buf.length > SHOT_MAX_BYTES)
            continue;
        if (!buf.subarray(0, 8).equals(PNG_MAGIC))
            continue;
        out.push({ url: 'data:image/png;base64,' + buf.toString('base64'), label: String(s?.label || 'экран').slice(0, 200) });
    }
    return out.slice(-SHOTS_IN_CONTEXT);
}

/** Оставить скриншоты только на последних shot-bearing ходах (вызывать перед toMessages/сжатием). */
export function stripOldShots(items, keep = SHOTS_IN_CONTEXT) {
    const live = (items || []).filter(i => i.type === 'assistant' && !i.compacted && (i.tools || []).some(t => t?.images?.length));
    for (const it of live.slice(0, Math.max(0, live.length - keep)))
        for (const t of it.tools || [])
            if (t?.images) {
                delete t.images;
                t.shotDropped = true;
            }
}

/** Последние скриншоты живой ленты → [{ url, label }]. */
export function collectShots(items, keep = SHOTS_IN_CONTEXT) {
    const out = [];
    for (const it of items || []) {
        if (it?.type !== 'assistant' || it?.compacted)
            continue;
        for (const t of it.tools || [])
            for (const s of t?.images || [])
                if (s?.url)
                    out.push({ url: s.url, label: s.label || 'экран' });
    }
    return out.slice(-keep);
}

/** Картинки из вложений живой ленты → Map(path → data:URL). loader(path) → Buffer. Кэш — на элементе ленты не храним (base64 в JSON не кладём). */
const imageCache = new Map();
async function loadImages(items, loader) {
    const out = new Map();
    if (typeof loader !== 'function')
        return out;
    for (const it of items) {
        if (it.type !== 'user' || it.compacted)
            continue;
        for (const a of it.attachments || []) {
            const ext = String(a?.path || '').split('.').pop().toLowerCase();
            const mime = IMAGE_EXT[ext];
            if (!mime || out.has(a.path))
                continue;
            let url = imageCache.get(a.path);
            if (!url) {
                try {
                    const buf = await loader(a.path);
                    if (!buf || buf.length > IMAGE_MAX)
                        continue;
                    url = 'data:' + mime + ';base64,' + Buffer.from(buf).toString('base64');
                    if (imageCache.size > 50)
                        imageCache.delete(imageCache.keys().next().value);
                    imageCache.set(a.path, url);
                }
                catch {
                    continue;
                }
            }
            out.set(a.path, url);
        }
    }
    return out;
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
        let finish = null;
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
                    it.usage = {
                        prompt: ch.prompt_tokens, completion: ch.completion_tokens, total: ch.total_tokens,
                        ...(ch.cached_tokens ? { cached: ch.cached_tokens } : {}),
                        ...(ch.cache_creation_tokens ? { cacheWrite: ch.cache_creation_tokens } : {}),
                    };
                // подписанные блоки размышлений (Anthropic): без них следующий шаг цикла инструментов при включённом thinking — ошибка API
                else if (ch?.type === 'thinking_blocks')
                    it.thinkingBlocks = ch.blocks;
                else if (ch?.type === 'tool_calls')
                    calls = ch.calls || [];
                else if (ch?.type === 'finish')
                    finish = ch;
            }
            if (host.signal?.aborted) {
                it.stopped = true;
                throw new StopError();
            }
            if (finish?.reason)
                it.finish = String(finish.reason);
            // соединение закрылось без [DONE] и без finish_reason — обрыв, а не ответ
            if (finish && !finish.done && !finish.reason && !calls.length && !it.content && !it.reasoning)
                throw new Error('поток ответа оборвался');
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

/** Текст ошибки пустого ответа: что именно пришло от модели. */
function emptyReason(it) {
    if (it.finish === 'length')
        return 'Ответ модели обрезан лимитом длины (maxOutput) до появления текста. Увеличьте maxOutput модели или напишите «дальше».';
    const why = [
        it.reasoning ? 'было только рассуждение' : '',
        it.finish && it.finish !== 'stop' ? 'finish_reason: ' + it.finish : '',
    ].filter(Boolean).join(', ');
    return 'Модель вернула пустой ответ' + (why ? ' (' + why + ')' : '') + '. Напишите «дальше», чтобы продолжить.';
}

/** <think>…</think> в content (модели без отдельного reasoning-канала). */
function stripThink(text) {
    return String(text || '').replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
    return new Promise(resolve => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });
}

/**
 * Вызовы хода: подряд идущие read-only — параллельно, остальные — по одному.
 * @param {{ it: any, byName: Map<string, Tool>, host: Host, llm: LLM, opts: LoopOpts }} o
 */
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

/**
 * Аудит вызова инструмента (server/access/audit.js, event 'agent'): рискованные (risk) — любой итог,
 * отказы политики и решения человека — всегда. Аргументы не пишутся (секреты), только цель (target).
 * Журнал асинхронный и не должен ронять цикл.
 */
async function noteAudit(tool, entry, ctx, verdict, outcome, extra = {}) {
    try {
        const { audit } = await import('../../server/access/audit.js');
        let target;
        try {
            target = typeof tool.target === 'function' ? tool.target(entry.args || {}) : undefined;
        }
        catch (e) { log.debug('audit.target', e); /* цель не определилась — не повод ломать вызов */ }
        audit('agent', {
            tool: tool.name,
            verdict, outcome,
            ...extra,
            target: Array.isArray(target) ? String(target[0]) : (target != null ? String(target) : undefined),
            task: ctx?.task?.path,
            error: entry.error ? clip(entry.error, 300) : undefined,
            ms: entry.durationMs || 0,
            params: { session: ctx?.session, role: ctx?.role },
        });
    }
    catch (e) { log.debug('audit', e); /* журнал не должен ронять цикл */ }
}

/**
 * Один вызов инструмента: хуки → политика → (подтверждение) → инструмент → аудит.
 * @param {{ entry: Entry, tool: Tool, it: any, host: Host, llm: LLM, opts: LoopOpts, preapproved?: boolean }} o
 */
async function runOne({ entry, tool, it, host, llm, opts, preapproved }) {
    if (!tool) {
        entry.status = 'error';
        entry.error = 'Нет инструмента «' + entry.name + '». Доступны: ' + [...(opts.tools || [])].map(t => t.name).join(', ');
        await host.save();
        return;
    }
    if (entry.args?.raw && Object.keys(entry.args).length === 1) {
        entry.status = 'error';
        const raw = String(entry.args.raw);
        entry.error = 'Аргументы вызова не разобраны как JSON (' + raw.length + ' символов'
            + (it.finish === 'length' ? ', ответ модели достиг лимита длины' : '')
            + '). Возможно, длинный content обрезан или нарушено экранирование. '
            + 'Повтори коротким вызовом; большой файл создавай через write и дополняй небольшими частями через append. Фрагмент: '
            + clip(raw, 300);
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
        hooks: opts.hooks,
        runLoop,
    };
    // внешнее содержимое после последней реплики человека (и от родителя субагента) → действия наружу только с подтверждением
    const tainted = taintSources(opts.items, opts.taintedFrom);
    ctx.tainted = tainted.length ? tainted : null;
    // хуки организации (hooks.js): могут запретить, потребовать подтверждение или поправить аргументы — но не разрешить сверх политики
    let hookAsk = null;
    if (opts.hooks?.pre_tool?.length) {
        const pre = await runPreTool(opts.hooks, hookPayload(tool, entry, ctx), ctx);
        if (pre.verdict === 'deny') {
            entry.status = 'denied';
            entry.hookDenied = true;
            entry.error = pre.reason + ' (' + pre.scope + ')';
            await host.save();
            await noteAudit(tool, entry, ctx, 'deny', 'hook', { reason: clip(entry.error, 300) });
            return;
        }
        if (pre.argsChanged) {
            entry.args = pre.args;
            entry.hookArgs = true;
            const lacking = (tool.parameters?.required || []).filter(k => entry.args?.[k] == null || entry.args[k] === '');
            if (lacking.length) {
                entry.status = 'error';
                entry.error = 'После правки аргументов правилом организации не хватает: ' + lacking.join(', ');
                await host.save();
                return;
            }
        }
        if (pre.verdict === 'ask' && !preapproved)
            hookAsk = pre;
    }
    /** @type {Verdict} */
    let decision = preapproved ? { verdict: 'allow' } : await decide(tool, entry.args || {}, ctx);
    if (hookAsk && decision.verdict === 'allow')
        decision = { verdict: 'ask', noAlways: true, reason: 'правило организации (' + hookAsk.scope + '): ' + hookAsk.reason };
    if (decision.verdict === 'deny') {
        entry.status = 'denied';
        entry.error = decision.reason || 'запрещено политикой';
        await host.save();
        await noteAudit(tool, entry, ctx, 'deny', 'policy', { reason: clip(entry.error, 300) });
        return;
    }
    if (decision.verdict === 'ask' && typeof host.wait !== 'function') {
        entry.status = 'denied';
        entry.error = 'нужно подтверждение человека (' + (decision.reason || 'политика') + '), а запуск автономный — предложи действие в ответе';
        await host.save();
        await noteAudit(tool, entry, ctx, 'ask', 'denied', { reason: clip(decision.reason || 'политика', 300), headless: true });
        return;
    }
    // подтверждение человека (или пред-подтверждение после рестарта) — в аудит попадает пометкой
    /** @type {{ preapproved?: boolean, reason?: string, always?: boolean } | null} */
    let approved = preapproved ? { preapproved: true } : null;
    if (decision.verdict === 'ask') {
        entry.status = 'approval';
        entry.reason = decision.reason;
        // действия во внешнем мире — каждое подтверждается отдельно («разрешить всегда» не предлагается)
        if (decision.noAlways)
            entry.noAlways = true;
        if (decision.hideArgs)
            entry.hideArgs = true;
        await host.save();
        const res = await host.wait({ kind: 'approval', item: it.id, call: entry.id, tool: entry.name, args: entry.args, reason: decision.reason, hideArgs: decision.hideArgs }) || {};
        throwIfStopped(host.signal);
        delete entry.reason;
        if (res.always && !entry.noAlways)
            host.allowed?.add?.(entry.name);
        if (!res.accept) {
            entry.status = 'denied';
            entry.answer = res.content ? String(res.content) : undefined;
            await host.save();
            await noteAudit(tool, entry, ctx, 'ask', 'denied', { reason: clip(decision.reason, 300), answer: entry.answer ? clip(entry.answer, 300) : undefined });
            return;
        }
        approved = { reason: decision.reason, always: !!(res.always && !entry.noAlways) };
    }
    entry.status = 'running';
    const t0 = Date.now();
    await host.save();
    try {
        const value = await tool.run(entry.args || {}, ctx);
        throwIfStopped(host.signal);
        // чужое содержимое (даже в ответе-ошибке сервиса): в контексте оборачивается в <untrusted>, ход считается зараженным
        if (tool.untrusted)
            entry.untrusted = true;
        if (value && typeof value === 'object' && !Array.isArray(value) && value.error && Object.keys(value).length <= 3) {
            entry.status = 'error';
            entry.error = String(value.error);
        }
        else {
            entry.status = 'ok';
            entry.result = clip(resultText(value), RESULT_MAX);
            const rich = value && typeof value === 'object' && !Array.isArray(value) ? value.images : null;
            if (Array.isArray(rich) && rich.length)
                entry.images = normalizeShots(rich);
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
    // инструмент мог пометить вызов сам (ctx.entry.untrusted = true, например read письма .eml)
    if (entry.untrusted && !entry.nonce)
        entry.nonce = newNonce();
    entry.durationMs = Date.now() - t0;
    // post_tool: хук может дописать к результату поясняющий текст организации
    if (opts.hooks?.post_tool?.length && (entry.status === 'ok' || entry.status === 'error')) {
        const extra = await runAppend(opts.hooks, 'post_tool', {
            ...hookPayload(tool, entry, ctx),
            status: entry.status, result: clip(entry.result || '', 4000), error: entry.error, durationMs: entry.durationMs,
        }, ctx);
        if (extra) {
            if (entry.status === 'ok')
                entry.result = clip((entry.result ?? '') + '\n\n[Правило организации]\n' + extra, RESULT_MAX);
            else
                entry.error = String(entry.error || '') + '\n[Правило организации] ' + extra;
        }
    }
    await host.save();
    // аудит: рискованные (risk) — любой итог; подтверждённые человеком — verdict 'ask'; пред-подтверждённые — 'allow' с пометкой
    if (tool.risk || approved || entry.status !== 'ok')
        await noteAudit(tool, entry, ctx, approved ? 'ask' : 'allow', entry.status,
            approved ? { reason: clip(approved.reason, 300), always: approved.always || undefined, preapproved: approved.preapproved || undefined } : {});
}

/** Данные вызова для хуков (копии простых значений — не живые объекты ядра). */
function hookPayload(tool, entry, ctx) {
    let target;
    try {
        target = typeof tool.target === 'function' ? tool.target(entry.args || {}) : undefined;
    }
    catch (e) { log.debug('tool.target', e); /* цель не определилась */ }
    return {
        tool: tool.name, args: entry.args || {}, risk: tool.risk || null, readonly: !!tool.readonly,
        target: Array.isArray(target) ? target.map(String) : (target != null ? String(target) : null),
        tainted: ctx.tainted, mode: ctx.host?.mode || null, role: ctx.role || null,
        task: ctx.task?.path || null, depth: ctx.depth || 0, uid: ctx.session?.uid || null,
    };
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
            if (old)
                t.clipped = true;
            const r = String(t.result ?? 'ok');
            const text = (old || t.clipped) ? clip(r, OLD_RESULT_MAX) : r;
            return t.untrusted ? wrapUntrusted(text, t.name, t.nonce) : text;
        }
        case 'error': {
            const text = 'Ошибка: ' + (t.error || 'неизвестно');
            return t.untrusted ? wrapUntrusted(text, t.name, t.nonce) : text;
        }
        case 'denied':
            if (t.hookDenied)
                return 'Вызов запрещён правилом организации: ' + (t.error || '');
            return 'Пользователь отклонил вызов.' + (t.answer ? ' Комментарий: ' + t.answer : '') + (t.error ? ' ' + t.error : '');
        default:
            return 'Вызов прерван (стоп или перезапуск) — результата нет.';
    }
}

/**
 * Лента → messages (OpenAI-формат). Сжатые элементы пропускаются,
 * результаты старых ходов урезаются (микросжатие).
 */
export function toMessages(system, items, images = null) {
    const out = [];
    const { stable, volatile } = splitSystem(system);
    if (stable)
        out.push({ role: 'system', content: stable });
    const live = items.filter(i => !i.compacted);
    const assistants = live.filter(i => i.type === 'assistant');
    const fullFrom = assistants.length - KEEP_FULL_TURNS;
    let ai = 0;
    for (const it of live) {
        switch (it.type) {
            case 'user':
                out.push({ role: 'user', content: userContent(it, images) });
                break;
            case 'summary': {
                const body = it.untrusted ? wrapUntrusted(it.content, 'summary', it.nonce || 'summary') : it.content;
                out.push({ role: 'user', content: '[Сводка предыдущей части работы]\n' + body });
                break;
            }
            case 'assistant': {
                const old = ai++ < fullFrom;
                const tools = (it.tools || []).filter(t => t && t.name);
                // наши сообщения об ошибке — не реплика модели, в контекст не идут
                if (it.error && !tools.length)
                    break;
                const msg = { role: 'assistant', content: it.content || '' };
                if (tools.length)
                    msg.tool_calls = tools.map(t => ({
                        id: t.id,
                        type: 'function',
                        function: { name: t.name, arguments: JSON.stringify(t.args || {}) },
                    }));
                if (!msg.content && !msg.tool_calls)
                    break;
                // блоки размышлений — неперечисляемое свойство: не попадает в JSON других протоколов и в оценку токенов,
                // читает его только адаптер Anthropic (MODELS/$ai …/class.js toAnthropicMessages)
                if (it.thinkingBlocks?.length)
                    Object.defineProperty(msg, 'thinking_blocks', { value: it.thinkingBlocks, enumerable: false });
                out.push(msg);
                for (const t of tools)
                    out.push({ role: 'tool', tool_call_id: t.id, content: toolContent(t, old) });
                break;
            }
            default:
                break;
        }
    }
    // Изменчивая часть среды (время, режим) — в конце: история выше остаётся неизменным префиксом для кэша провайдера.
    // Роль user, а не второй system: шаблоны многих моделей допускают system только первым сообщением.
    if (volatile)
        out.push({ role: 'user', content: VOLATILE_HEAD + volatile });
    // Скриншоты — отдельным сообщением в конце: не все провайдеры понимают картинки в role:'tool'.
    const shots = collectShots(live);
    if (shots.length && images !== null) {
        out.push({
            role: 'user',
            content: [
                { type: 'text', text: '[Скриншоты экрана компьютера — свежие, по порядку (разрешение 1280×800):\n'
                    + shots.map((s, i) => '[' + (i + 1) + '] ' + s.label).join('\n') + ']' },
                ...shots.map(s => ({ type: 'image_url', image_url: { url: s.url } })),
            ],
        });
    }
    return out;
}

function userContent(it, imageMap) {
    const text = String(it.content || '');
    const att = (it.attachments || []).filter(a => a?.path);
    const images = imageMap ? att.filter(a => imageMap.has(a.path)).map(a => ({ image_url: imageMap.get(a.path) })) : [];
    const note = att.length ? '\n\n[Вложения]\n' + att.map(a => '- ' + a.path + (a.name ? ' (' + a.name + ')' : '')).join('\n') : '';
    if (!images.length)
        return text + note;
    return [{ type: 'text', text: text + note }, ...images.map(a => ({ type: 'image_url', image_url: { url: a.image_url } }))];
}

/**
 * Опора для оценки контекста — реальный usage последнего ответа модели: prompt_tokens того запроса.
 * Не годится, если после него было сжатие (summary новее ответа): размер контекста с тех пор изменился.
 * @returns {{index:number, prompt:number}|null}
 */
function usageBaseline(items) {
    let summaryAt = 0;
    for (const i of items)
        if (i.type === 'summary')
            summaryAt = Math.max(summaryAt, Number(i.time) || 0);
    for (let k = items.length - 1; k >= 0; k--) {
        const it = items[k];
        if (it.type !== 'assistant' || it.compacted || it.error)
            continue;
        const prompt = Number(it.usage?.prompt) || 0;
        if (prompt <= 0)
            continue;
        return summaryAt > (Number(it.time) || 0) ? null : { index: k, prompt };
    }
    return null;
}

/**
 * Размер следующего запроса в токенах. Есть usage последнего ответа — реальный prompt того запроса
 * (system + схемы инструментов + диалог) плюс оценка добавленного после него (ответ, результаты инструментов, реплики);
 * иначе — эвристика len/3.2 по сообщениям плюс схемы инструментов (toolsTokens).
 * Микросжатие старых результатов с тех пор могло уменьшить контекст — оценка с запасом, это безопасная сторона.
 * @returns {{tokens:number, source:'usage'|'estimate'}}
 */
export function estimateContext({ items, system, toolsTokens = 0 }) {
    const base = usageBaseline(items);
    // usage меньше того, что заведомо входит в каждый запрос (схемы инструментов + system), — данные шлюза недостоверны
    // (нулевой/неполный usage): не верим ему, иначе сжатие не сработает и контекст переполнится
    const floor = toolsTokens + estimateTokens(systemText(system));
    if (base && base.prompt >= floor * USAGE_TRUST_MIN) {
        const added = items.slice(base.index).filter(i => !i.compacted);
        return { tokens: base.prompt + estimateTokens(toMessages('', added)), source: 'usage' };
    }
    return { tokens: estimateTokens(toMessages(system, items)) + toolsTokens, source: 'estimate' };
}

/** Сжатие: контекст близок к пределу — старая часть ленты → сводка. toolsTokens — схемы инструментов для эвристики без usage. */
export async function maybeCompact({ llm, items, host, system, force = false, toolsTokens = 0, hooks, task }) {
    stripOldShots(items);
    const limit = Number(llm.contextTokens) || 32000;
    if (!force && estimateContext({ items, system, toolsTokens }).tokens < limit * COMPACT_AT)
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
    const wasUntrusted = untrustedNames(old).size > 0 || old.some(it => it.type === 'summary' && it.untrusted);
    const idx = items.indexOf(live[cut]);
    const note = {
        id: genId(), type: 'summary', time: Date.now(), content: summary,
        ...(wasUntrusted ? { untrusted: true, nonce: newNonce() } : {}),
    };
    // on_compact: хук может дописать к сводке то, что обязано пережить сжатие (правила, ссылки)
    const extra = await runAppend(hooks, 'on_compact', { summary: clip(summary, 4000), compacted: old.length, task: task?.path || null }, { task });
    if (extra)
        note.content += '\n\n' + extra;
    items.splice(idx, 0, note);
    await host.save();
    return true;
}
