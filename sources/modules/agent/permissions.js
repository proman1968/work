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

const SHELL_DANGEROUS_RE = /(?:^|[;&|{}\n(]\s*)(?:rm|rmdir|del|erase|rd|format|diskpart|bcdedit|shutdown|restart-computer|stop-computer|stop-process|start-process|taskkill|kill|killall|pkill|mkfs|dd|fdisk|parted|remove-item|clear-content|invoke-expression|iex)\b|\breg\s+delete\b|\bnet\s+user\b|\bwsl\b[^;\n|&]*--unregister\b|\[(?:system\.)?io\.(?:directory|file|fileinfo|directoryinfo)\]::(?:delete|move|write|append|create)|\.delete\s*\(|\b(?:curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod)\b[^|\n]*\|/i;

const SHELL_WRITE_RE = /(?:^|[;&|{}\n(]\s*)(?:set-content|add-content|out-file|new-item|copy-item|move-item|rename-item|set-itemproperty|new-service|start-service|stop-service|restart-service|mkdir|md|touch|cp|mv|ln|chmod|chown|tee|winget\s+(?:install|uninstall|upgrade)|choco\s+(?:install|uninstall|upgrade)|pip\d?\s+install|npm\s+(?:install|i|uninstall)|apt(?:-get)?\s+(?:install|remove|purge)|msiexec)\b/i;

const SHELL_READ_CMDS = new Set([
    'if', 'else', 'elseif', 'try', 'catch', 'finally',
    'test-path', 'get-content', 'get-item', 'get-itemproperty', 'get-childitem',
    'get-service', 'get-process', 'get-ciminstance', 'get-wmiobject', 'get-eventlog',
    'get-winevent', 'get-date', 'get-location', 'get-command', 'get-host', 'get-history',
    'select-object', 'select-string', 'where-object', 'sort-object', 'group-object',
    'measure-object', 'format-table', 'format-list', 'out-string', 'convertto-json',
    'convertfrom-json', 'write-output', 'write-host', 'echo', 'dir', 'ls', 'type',
    'cat', 'head', 'tail', 'grep', 'rg', 'findstr', 'where', 'which', 'command',
    'ps', 'df', 'free', 'uname', 'uptime', 'stat', 'wc', 'whoami', 'hostname', 'ver',
    'systeminfo', 'tasklist', 'netstat', 'pwd', 'resolve-path', 'split-path', 'join-path',
    'select', 'where', 'sort', 'ft', 'fl', 'gc', 'gci', 'gp', 'gsv', 'gps', 'sls',
]);

const SHELL_READ_SUBCMDS = {
    wsl: new Set(['--status', '-l', '--list', '--version', '-v', 'status', 'list']),
    docker: new Set(['ps', 'info', 'version', 'images', 'logs', 'inspect', 'stats']),
    sc: new Set(['query', 'qc', 'queryex']),
    winget: new Set(['list', 'show', 'search', '--version', '-v']),
    choco: new Set(['list', 'info', 'search', '--version']),
    git: new Set(['status', 'log', 'diff', 'show', 'branch', 'tag', 'rev-parse']),
};

/** Убрать безопасные кавычки (без подстановок $(...)/`...) для структурного анализа команды. */
function stripSafeQuotes(cmd) {
    return String(cmd || '')
        .replace(/'[^']*'/g, ' ')
        .replace(/"([^"\\$`]|\\.)*"/g, ' ');
}

/** Проверить наличие файловых перенаправлений записи (> / >>, кроме 2>&1, $null, /dev/null). */
function hasFileRedirectWrite(stripped) {
    const re = /(?:^|[^\w-])\d*>>?\s*([^\s;&|)]+)/g;
    let m;
    while ((m = re.exec(stripped)) !== null) {
        const target = String(m[1] || '').toLowerCase();
        if (target.startsWith('&') || target === '$null' || target === '/dev/null' || target === 'nul')
            continue;
        return true;
    }
    return false;
}

/**
 * Классификация команды `shell` для области «разрешить подобные в рамках задачи»:
 *  - `{ noAlways: true }` для разрушительных/опасных команд (каждый раз спрашивать);
 *  - `shell:read` — чтение и проверка состояния (логи, статусы, файлы без изменений);
 *  - `shell:prog:<cmd>` — запуск конкретной утилиты в рамках задачи.
 */
export function classifyShellCommand(command) {
    const raw = String(command || '').trim();
    if (!raw)
        return { key: 'shell:read', label: 'команды чтения и проверки состояния', buttonLabel: 'Разрешить подобные' };
    const stripped = stripSafeQuotes(raw);
    if (SHELL_DANGEROUS_RE.test(stripped))
        return { noAlways: true, key: 'shell:danger', label: '', buttonLabel: '' };

    const parts = stripped
        .split(/(?:\|\||&&|[;\n|{}])/)
        .map(s => s.replace(/^[(\s]+/, '').replace(/[)\s]+$/, '').trim())
        .filter(Boolean);

    const hasSubshell = /\$\(/.test(raw) || /`/.test(stripped);
    if (!hasSubshell && !SHELL_WRITE_RE.test(stripped) && !hasFileRedirectWrite(stripped) && parts.length > 0) {
        let allRead = true;
        for (const seg of parts) {
            const clean = seg.replace(/^(?:if|elseif|while)\s*\(/i, '').trim();
            if (!clean)
                continue;
            const tokens = clean.split(/\s+/).filter(Boolean);
            const head = (tokens[0] || '').replace(/^&/, '').replace(/\.exe$/i, '').toLowerCase();
            if (!head)
                continue;
            if (head.startsWith('$') || /^[a-z0-9_.-]+\s*=/i.test(clean)) {
                // присваивание переменной допустимо только если справа не видно вызова записи (проверено выше)
                continue;
            }
            if (SHELL_READ_CMDS.has(head))
                continue;
            const allowedSubs = SHELL_READ_SUBCMDS[head];
            const sub = (tokens[1] || '').toLowerCase();
            if (allowedSubs && allowedSubs.has(sub))
                continue;
            if (/^--?(?:version|help|status)$/i.test(sub) && !/^(?:powershell|pwsh|cmd|bash|sh)$/i.test(head))
                continue;
            allRead = false;
            break;
        }
        if (allRead) {
            return {
                key: 'shell:read',
                label: 'команды чтения и проверки состояния (логи, статусы, файлы без изменений)',
                buttonLabel: 'Разрешить подобные',
            };
        }
    }

    const firstTokens = (parts[0] || stripped).replace(/^(?:&|call)\s+/i, '').trim().split(/\s+/);
    const progRaw = (firstTokens[0] || 'shell').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
    const prog = /^[a-z0-9._-]{1,40}$/i.test(progRaw) ? progRaw : 'shell';
    return {
        key: 'shell:prog:' + prog,
        label: 'команды с утилитой «' + prog + '» в этой задаче',
        buttonLabel: 'Разрешить подобные',
    };
}

/**
 * Вычислить область (шаблон) общего разрешения для вызова в рамках текущей задачи.
 * Если у инструмента есть `tool.approvalScope(args, ctx)`, используется она;
 * иначе для `shell` работает `classifyShellCommand`, а для остальных — имя инструмента целиком.
 * @param {Tool} tool
 * @param {object} args
 * @param {ToolCtx} ctx
 * @returns {{ key?: string, label?: string, buttonLabel?: string, noAlways?: boolean }}
 */
export function resolveApprovalScope(tool, args, ctx) {
    if (!tool)
        return {};
    if (typeof tool.approvalScope === 'function') {
        try {
            const custom = tool.approvalScope(args || {}, ctx);
            if (custom)
                return custom;
        }
        catch { /* fallback */ }
    }
    if (tool.name === 'shell')
        return classifyShellCommand(args?.command);
    const title = tool.label || tool.name;
    return {
        key: tool.name,
        label: 'все вызовы «' + title + '» в этой задаче',
        buttonLabel: 'Разрешить в задаче',
    };
}

function allowedMatches(host, toolName, scope) {
    if (!host?.allowed?.has)
        return false;
    if (host.allowed.has(toolName))
        return true;
    if (scope?.key && host.allowed.has(scope.key))
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
    const scope = resolveApprovalScope(tool, args, ctx);
    if (typeof tool.permission === 'function') {
        const custom = await tool.permission(args, ctx);
        if (custom) {
            if (custom.verdict === 'ask' && !custom.noAlways) {
                if (scope?.noAlways)
                    return { ...custom, noAlways: true };
                if (allowedMatches(host, tool.name, scope))
                    return { verdict: 'allow', autoAllowed: true, scopeKey: scope?.key || tool.name, scopeLabel: scope?.label || '' };
                return { ...custom, ...(scope?.key ? { scope } : {}) };
            }
            return custom;
        }
    }
    const target = typeof tool.target === 'function' ? tool.target(args, ctx) : null;
    const targets = (Array.isArray(target) ? target : [target]).filter(Boolean);
    const hit = targets.find(isProtectedPath);
    if (hit)
        return { verdict: 'ask', noAlways: true, reason: 'изменение системы: ' + hit };
    if (tool.risk === 'danger')
        return { verdict: 'ask', reason: 'необратимое или внешнее действие', ...(scope?.noAlways ? { noAlways: true } : { scope }) };
    if (allowedMatches(host, tool.name, scope))
        return { verdict: 'allow', autoAllowed: true, scopeKey: scope?.key || tool.name, scopeLabel: scope?.label || '' };
    if (mode === 'ask')
        return { verdict: 'ask', reason: 'режим «Спрашивать»', ...(scope?.noAlways ? { noAlways: true } : { scope }) };
    return { verdict: 'allow' };
}
