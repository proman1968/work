// @ts-check
/**
 * Политика разрешений инструментов.
 *
 * Режимы сессии (host.mode):
 *   plan — только чтение (инструменты записи модели даже не показываются);
 *   ask  — любое действие с побочным эффектом спрашивает человека;
 *   auto — запись в рабочие данные без вопросов; системные пути, код и опасные действия — с вопросом.
 *
 * Инструмент: readonly (чтение, всегда можно) | risk: 'write' | 'danger'.
 * tool.target(args) → WORK-путь цели (для проверки защищённых зон).
 * host.allowed — «разрешить всегда» в этой сессии.
 * ctx.tainted — источники внешнего содержимого в ходе (taint.js): инструмент с `outbound` (действие наружу)
 * тогда всегда спрашивает человека, не предлагая «разрешить всегда».
 */
import { isOutbound } from './taint.js';

/** Зоны самоизменения системы: правки только с подтверждением. */
export const PROTECTED_PREFIXES = ['/$server', '/sources', '/oda', '/MODELS', '/SERVICES', '/NODES', '/torus'];

/** Канонический WORK-путь для проверок: прямые слэши, без пустых и «.» сегментов, «..» свёрнуты.
 *  null — путь вылезает выше корня (неканонизируемый): проверки обязаны считать его защищённым. */
export function normalizeWorkPath(raw) {
    const segs = [];
    for (const s of String(raw ?? '').replace(/\\/g, '/').split('/')) {
        if (!s || s === '.')
            continue;
        if (s === '..') {
            if (segs.length && segs[segs.length - 1] !== '..')
                segs.pop();
            else
                return null;
            continue;
        }
        segs.push(s);
    }
    return '/' + segs.join('/');
}

/**
 * Путь относится к коду/конфигурации системы.
 * Проверяется КАНОНИЧЕСКИЙ путь (F22): «//sources», «/./sources», «/DATA/../sources»,
 * обратные слэши и прочие маскировки не обходят распознавание — ядро нормализует их
 * при записи, и политика обязана видеть ту же цель, что ядро.
 * @param {string} path
 * @returns {boolean}
 */
export function isProtectedPath(path) {
    const p = normalizeWorkPath(path);
    if (!p)
        return true; // выше корня — недопустимая цель, считаем защищённой (fail-closed)
    const low = p.toLowerCase();
    if (PROTECTED_PREFIXES.some(pre => low === pre.toLowerCase() || low.startsWith(pre.toLowerCase() + '/')))
        return true;
    // код и конфиг классов: class.js / *.js / #security / #secret — где угодно
    if (/(^|\/)(#security|#secret|#system)(\/|$)/i.test(p))
        return true;
    if (/\.(m?js|cjs|ts)$/i.test(p))
        return true;
    return false;
}

/**
 * Решение политики для вызова инструмента (режим сессии, правила инструмента, защищённые зоны).
 * @param {Tool} tool
 * @param {object} args
 * @param {ToolCtx} ctx
 * @returns {Promise<Verdict>}
 */
export async function decide(tool, args, ctx) {
    if (tool.readonly)
        return { verdict: 'allow' };
    const host = ctx.host || /** @type {Host} */ ({});
    const mode = host.mode || 'auto';
    if (mode === 'plan' && !tool.planSafe)
        return { verdict: 'deny', reason: 'режим «План»: изменения запрещены — предложи план и попроси переключить режим' };
    // в контексте внешнее содержимое (taint.js): действия «наружу» — только с подтверждением, даже в auto и без «разрешить всегда»
    if (ctx.tainted?.length && isOutbound(tool, args, ctx)) {
        let own = null;
        if (!tool.planSafe && typeof tool.permission === 'function') {
            own = await tool.permission(args, ctx);
            if (own?.verdict === 'deny')
                return own;
        }
        return {
            verdict: 'ask', noAlways: true,
            ...(own?.hideArgs ? { hideArgs: true } : {}),
            reason: 'в контексте есть внешнее содержимое (' + ctx.tainted.join(', ') + '), действие наружу — только с вашего подтверждения'
                + (own?.reason ? ': ' + own.reason : ''),
        };
    }
    if (tool.planSafe)
        return { verdict: 'allow' };
    if (typeof tool.permission === 'function') {
        const custom = await tool.permission(args, ctx);
        if (custom)
            return custom;
    }
    if (host.allowed?.has?.(tool.name))
        return { verdict: 'allow' };
    if (mode === 'ask')
        return { verdict: 'ask', reason: 'режим «Спрашивать»' };
    if (tool.risk === 'danger')
        return { verdict: 'ask', reason: 'необратимое или внешнее действие' };
    const target = typeof tool.target === 'function' ? tool.target(args, ctx) : null;
    const targets = (Array.isArray(target) ? target : [target]).filter(Boolean);
    const hit = targets.find(isProtectedPath);
    if (hit)
        return { verdict: 'ask', reason: 'изменение системы: ' + hit };
    return { verdict: 'allow' };
}
