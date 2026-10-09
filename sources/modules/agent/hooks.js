/**
 * Хуки агента: код организации, который вмешивается в работу цикла. Задаются в `ai/config.js` слоя:
 *
 *   export default { hooks: {
 *       pre_tool:   [ ({ tool, args, risk, target, tainted, mode, role, task, depth, uid }) => ({ verdict, reason, args }) | undefined, 'hooks/guard.js' ],
 *       post_tool:  [ ({ …, status, result, error, durationMs }) => ({ append }) | undefined ],
 *       on_stop:    [ ({ status, content, turns, task }) => void ],
 *       on_compact: [ ({ summary, compacted, task }) => ({ append }) | undefined ],
 *   } }
 *
 * Элемент списка — функция или имя модуля `hooks/<имя>.js` в папке ai/ того же слоя (default-экспорт или экспорт с именем события).
 * Слои копятся от движка к месту задачи (config.js остальных ключей — ближний перекрывает дальний, хуки — складываются).
 * Менять config.js и hooks/ может только ADMIN: это системная область метапапки `$…` (политика ядра).
 *
 * Хук может только ОГРАНИЧИТЬ: verdict 'deny' (первый deny побеждает) или 'ask' (потребовать подтверждение человека),
 * подменить args. Разрешить то, чего не разрешает политика (permissions.js), он не может.
 * Таймаут — HOOK_TIMEOUT_MS (5 с; env WORK_HOOK_TIMEOUT_MS — для тестов); ошибка/таймаут не роняют цикл (хук пропускается) и пишутся в журнал безопасности (agent_hook).
 * Хукам передаются копии данных, а не живые объекты (сессия, инструменты, лента).
 */

export const HOOK_EVENTS = ['pre_tool', 'post_tool', 'on_stop', 'on_compact'];
export const HOOK_TIMEOUT_MS = 5000;

export function emptyHooks() {
    return { pre_tool: [], post_tool: [], on_stop: [], on_compact: [], errors: [] };
}

const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);

function clone(payload) {
    try {
        return structuredClone(payload);
    }
    catch {
        return JSON.parse(JSON.stringify(payload));
    }
}

/** Запись о событии хука в журнал безопасности (не роняет цикл). */
export async function auditHook(rec, ctx) {
    try {
        const { audit } = await import('../../server/access/audit.js');
        audit('agent_hook', { ...rec, task: ctx?.task?.path, params: { session: ctx?.session, role: ctx?.role } });
    }
    catch { /* журнал не должен ронять цикл */ }
}

/**
 * Вызвать один хук с таймаутом.
 * @returns {Promise<{ok: boolean, value?: *, error?: string, timedOut?: boolean}>}
 */
export async function callHook(h, payload, timeoutMs = HOOK_TIMEOUT_MS) {
    let timer;
    try {
        const value = await Promise.race([
            Promise.resolve().then(() => h.fn(clone(payload))),
            new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('таймаут ' + timeoutMs + ' мс'), { timedOut: true })), timeoutMs); }),
        ]);
        return { ok: true, value };
    }
    catch (e) {
        return { ok: false, error: String(e?.message || e).slice(0, 300), timedOut: !!e?.timedOut };
    }
    finally {
        clearTimeout(timer);
    }
}

/** Вызвать хук события с записью сбоя в аудит. Возвращает значение или undefined. */
async function runOne(hooks, h, event, payload, ctx) {
    const r = await callHook(h, payload, hooks.timeoutMs ?? (Number(process.env.WORK_HOOK_TIMEOUT_MS) || HOOK_TIMEOUT_MS));
    if (!r.ok) {
        await auditHook({ on: event, hook: h.name, scope: h.scope, outcome: r.timedOut ? 'timeout' : 'error', error: r.error, tool: payload.tool }, ctx);
        return undefined;
    }
    return r.value;
}

/**
 * pre_tool: хуки по порядку слоёв. Подмена args накапливается (следующий хук видит уже изменённые), первый deny
 * останавливает цепочку, ask — требует подтверждения человека.
 * @returns {Promise<{verdict: 'deny'|'ask'|null, reason?: string, scope?: string, args: object, argsChanged: boolean}>}
 */
export async function runPreTool(hooks, payload, ctx) {
    let args = payload.args;
    let argsChanged = false;
    let ask = null;
    for (const h of hooks?.pre_tool || []) {
        const v = await runOne(hooks, h, 'pre_tool', { ...payload, args }, ctx);
        if (!isPlain(v))
            continue;
        if (v.args !== undefined) {
            if (isPlain(v.args)) {
                args = v.args;
                argsChanged = true;
                await auditHook({ on: 'pre_tool', hook: h.name, scope: h.scope, outcome: 'args', tool: payload.tool }, ctx);
            }
            else
                await auditHook({ on: 'pre_tool', hook: h.name, scope: h.scope, outcome: 'error', error: 'args должен быть объектом', tool: payload.tool }, ctx);
        }
        if (v.verdict === 'deny') {
            const reason = String(v.reason || 'правило организации').slice(0, 300);
            await auditHook({ on: 'pre_tool', hook: h.name, scope: h.scope, outcome: 'deny', reason, tool: payload.tool }, ctx);
            return { verdict: 'deny', reason, scope: h.scope, args: payload.args, argsChanged: false };
        }
        if (v.verdict === 'ask' && !ask) {
            ask = { reason: String(v.reason || 'правило организации').slice(0, 300), scope: h.scope };
            await auditHook({ on: 'pre_tool', hook: h.name, scope: h.scope, outcome: 'ask', reason: ask.reason, tool: payload.tool }, ctx);
        }
    }
    return { verdict: ask ? 'ask' : null, reason: ask?.reason, scope: ask?.scope, args, argsChanged };
}

/** post_tool / on_compact: хуки могут вернуть { append } — текст дописывается к результату (summary). @returns {Promise<string>} */
export async function runAppend(hooks, event, payload, ctx) {
    const parts = [];
    for (const h of hooks?.[event] || []) {
        const v = await runOne(hooks, h, event, payload, ctx);
        if (isPlain(v) && typeof v.append === 'string' && v.append.trim())
            parts.push(v.append.trim().slice(0, 2000));
    }
    return parts.join('\n');
}

/** on_stop: уведомление, результат не используется. */
export async function runNotify(hooks, event, payload, ctx) {
    for (const h of hooks?.[event] || [])
        await runOne(hooks, h, event, payload, ctx);
}
