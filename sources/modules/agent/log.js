// @ts-check
/**
 * Лог агента WORK: log.debug/info/warn(scope, ...детали).
 *
 *   WORK_LOG=debug|info|warn — уровень (по умолчанию warn): сообщения ниже уровня не печатаются.
 *   debug — тихие сбои «на всякий случай» (бывшие пустые catch: WORK_LOG=debug покажет, что молча глоталось),
 *   info — заметные события, warn — важно.
 * Ошибка самой печати не роняет работу.
 */
const LEVELS = { debug: 10, info: 20, warn: 30 };

/** Текущий уровень: читается не чаще раза в миллисекунду (горячие циклы не дёргают env). */
let cachedAt = -1;
let cached = LEVELS.warn;
function level() {
    const now = Date.now();
    if (now !== cachedAt) {
        cached = LEVELS[String(process.env.WORK_LOG || '').toLowerCase()] ?? LEVELS.warn;
        cachedAt = now;
    }
    return cached;
}

/** Error → стек, остальное — как есть. */
const fmt = a => a instanceof Error ? (a.stack || String(a.message || a)) : a;

function out(min, method) {
    return (scope, ...args) => {
        if (min < level())
            return;
        try {
            // метод берём в момент вызова: подмена console (тесты) видна
            console[method]('[agent:' + scope + ']', ...args.map(fmt));
        }
        catch { /* лог не должен ронять работу */ }
    };
}

export const log = {
    debug: out(LEVELS.debug, 'log'),
    info: out(LEVELS.info, 'log'),
    warn: out(LEVELS.warn, 'warn'),
};
