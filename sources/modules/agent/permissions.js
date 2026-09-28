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
 */

/** Зоны самоизменения системы: правки только с подтверждением. */
export const PROTECTED_PREFIXES = ['/$server', '/sources', '/oda', '/MODELS', '/SERVICES', '/NODES', '/torus'];

/** Путь относится к коду/конфигурации системы. */
export function isProtectedPath(path) {
    const p = String(path || '').trim();
    if (!p)
        return false;
    if (PROTECTED_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/')))
        return true;
    // код и конфиг классов: class.js / *.js / #security / #secret — где угодно
    if (/(^|\/)(#security|#secret|#system)(\/|$)/.test(p))
        return true;
    if (/\.(m?js|cjs|ts)$/i.test(p))
        return true;
    return false;
}

/**
 * @returns {Promise<{verdict:'allow'|'ask'|'deny', reason?:string}>}
 */
export async function decide(tool, args, ctx) {
    if (tool.readonly)
        return { verdict: 'allow' };
    const host = ctx.host || {};
    const mode = host.mode || 'auto';
    if (mode === 'plan' && !tool.planSafe)
        return { verdict: 'deny', reason: 'режим «План»: изменения запрещены — предложи план и попроси переключить режим' };
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
    const target = typeof tool.target === 'function' ? tool.target(args) : null;
    const targets = (Array.isArray(target) ? target : [target]).filter(Boolean);
    const hit = targets.find(isProtectedPath);
    if (hit)
        return { verdict: 'ask', reason: 'изменение системы: ' + hit };
    return { verdict: 'allow' };
}
