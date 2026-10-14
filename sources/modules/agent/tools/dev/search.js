/**
 * Инструменты разработчика (этап 6.2): поиск по коду — grep (по содержимому) и glob (по именам).
 *
 * Две арены (архитектура 6.1 — readme модуля, инварианты 11–14 в rules/threats.md):
 *   work    — дерево WORK: обход через ядро, содержимое читается с правами пользователя
 *             (callAs → loadText: файл без прав пропускается), системные #-зоны не перечисляются,
 *             чужие файлы (.eml, external-source) в результатах помечают ход untrusted;
 *   sandbox — компьютер пользователя (Docker): через docker exec (ripgrep, при его отсутствии
 *             в старом образе — fallback на grep -rn / find), вывод с потолком,
 *             при включённом интернете — untrusted (правило sandbox_exec).
 *
 * Оба инструмента readonly: доступны в любом режиме (в т.ч. plan) и любому пользователю —
 * права по файлам проверяет ядро, а не подтверждение.
 */
import { log } from '../../log.js';
import { clip } from '../../util.js';
import { mustItem, loadText, callAs } from '../work/common.js';
import { ctxRun } from '../sandbox.js';
import { FS } from '../../../../server/index.js';
import { loadSandboxConfig } from '../../../sandbox/config.js';
import { getDocker } from '../../../sandbox/driver.js';
import {
    ensureComputer, ownerOf, computerName, assertSandboxPath, execRaw, statusOf, touchComputer, formatExec,
} from '../../../sandbox/manager.js';

// лимиты (6.1): чужое дерево или файл не занимает ни память, ни ленту
const MATCH_MAX = 2000;            // совпадений на вызов (аргументом — меньше, не больше)
const FILE_READ_MAX = 200;         // файлов, содержимое которых читается
const FILE_SIZE_MAX = 256 * 1024;  // файл больше — пропускается
const GLOB_MAX = 2000;             // путей glob на вызов
const TIME_BUDGET_MS = 30_000;     // бюджет обхода
const OUT_MAX = 30 * 1024;         // вывод
const WALK_LEVEL_MAX = 14;         // глубина обхода дерева
const SBX_TIMEOUT_SEC = 60;        // потолок поиска в песочнице
const SBX_OUT_MAX = 32 * 1024;     // потолок вывода песочницы

/** glob-шаблон → RegExp: `*` — внутри сегмента, `**` — через любые сегменты (включая косую черту), `?` — один символ. */
export function globToRegExp(glob) {
    const g = String(glob ?? '').replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!g || g.startsWith('/') || g.split('/').some(s => s === '..' || s === ''))
        throw new Error('glob-шаблон вида "**/*.js" или "*.md", относительно папки поиска (без ведущего / и ..)');
    let re = '';
    for (let i = 0; i < g.length; i++) {
        const c = g[i];
        if (c === '*') {
            if (g[i + 1] === '*') {
                if (g[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2; continue; }
                re += '.*'; i += 1; continue;
            }
            re += '[^/]*'; continue;
        }
        if (c === '?') { re += '[^/]'; continue; }
        re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$', 'i');
}

/**
 * Обход поддерева через ядро: entries (видит и $-метазоны — код /MODELS/…/$…/class.js),
 * системные #-зоны и скрытые элементы не перечисляются и не читаются.
 * Имена — на уровне ls (дети доступной папки); в папку без прав на чтение не заходим,
 * содержимое файлов проверяется правами по файлу при чтении (loadText).
 */
async function* walkItems(root, deadline, ctx) {
    const seen = new Set();
    const walk = async function* (it, level) {
        let kids;
        try { kids = (await it.entries) || []; }
        catch { return; /* нет доступа/не папка — как у ls */ }
        for (const k of kids) {
            if (Date.now() > deadline)
                return;
            if (!k?.id || k.id === 'node_modules')
                continue;
            if (k.id[0] === '#' || k.id[0] === '.')
                continue;
            if (seen.has(k.path))
                continue;
            seen.add(k.path);
            yield k;
            if (k instanceof FS.$file || level >= WALK_LEVEL_MAX)
                continue;
            // в папку без прав на чтение не заходим (имя видно как у ls, содержимое — нет)
            let open = true;
            try {
                await callAs(k, 'assertAccess', {}, ctx);
            }
            catch { open = false; }
            if (open)
                yield* walk(k, level + 1);
        }
    };
    yield* walk(root, 0);
}

/** Путь относительно корня поиска (для glob-шаблона). */
function relPath(item, root) {
    const rp = String(root.path || '');
    let p = String(item.path || '');
    if (rp && rp !== '/' && p.startsWith(rp))
        p = p.slice(rp.length);
    return p.replace(/^\/+/, '');
}

/** Чужое содержимое в результатах: .eml или файл с внешней пометкой → ход untrusted. */
async function markUntrustedFiles(files, ctx) {
    if (!ctx?.entry || !files.length)
        return;
    for (const f of files) {
        if (/\.eml$/i.test(String(f.path))) {
            ctx.entry.untrusted = true;
            return;
        }
    }
    try {
        const { externalSourceOf } = await import('../../../../server/external-source.js');
        for (const f of files) {
            if (await externalSourceOf(f.path)) {
                ctx.entry.untrusted = true;
                return;
            }
        }
    }
    catch (e) { log.debug('dev.untrusted', e); /* пометки нет — не заражаем */ }
}

// ── арена work ──────────────────────────────────────────────────────────────

async function workGrep(args, ctx) {
    const root = await mustItem(args.path, ctx);
    if (Array.isArray(root))
        throw new Error('grep: укажите конкретную папку (~/сборка слоёв не поддерживается)');
    if (ctx.entry)
        ctx.entry.path = root.path;
    const raw = String(args.regex ?? args.text ?? '');
    if (!raw)
        throw new Error('grep: нужен text (подстрока) или regex (регулярное выражение)');
    const ci = args.caseSensitive ? '' : 'i';
    let re;
    try {
        re = new RegExp(args.regex ? raw : raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci);
    }
    catch (e) {
        throw new Error('grep: некорректное регулярное выражение: ' + e.message, { cause: e });
    }
    const mask = args.glob ? globToRegExp(args.glob) : null;
    const cx = Math.min(10, Math.max(0, Number(args.context) || 0));
    const maxMatches = Math.min(MATCH_MAX, Math.max(1, Number(args.limit) || 200));
    const deadline = Date.now() + TIME_BUDGET_MS;
    const lines = [];
    const matchedFiles = [];
    let filesRead = 0, seen = 0, matches = 0, timedOut = false;
    for await (const f of walkItems(root, deadline, ctx)) {
        seen++;
        if (matches >= maxMatches || filesRead >= FILE_READ_MAX)
            break;
        if (!(f instanceof FS.$file))
            continue;
        if (mask && !mask.test(f.id))
            continue;
        if ((f.stat?.size ?? 0) > FILE_SIZE_MAX)
            continue;
        let text;
        try {
            text = await loadText(f, ctx); // права по файлу: нет прав — пропускаем
        }
        catch { continue; /* чтение не вышло (права/формат) — не мешаем остальным */ }
        if (typeof text !== 'string' || !text)
            continue;
        if (text.slice(0, 8192).includes('\0'))
            continue; // бинарный
        filesRead++;
        const ls = text.replace(/\r\n/g, '\n').split('\n');
        const hits = [];
        for (let i = 0; i < ls.length && matches + hits.length < maxMatches; i++)
            if (re.test(ls[i]))
                hits.push(i);
        if (!hits.length)
            continue;
        matchedFiles.push(f);
        const want = new Set();
        for (const i of hits)
            for (let j = Math.max(0, i - cx); j <= Math.min(ls.length - 1, i + cx); j++)
                want.add(j);
        let prev = -2;
        for (const j of [...want].sort((a, b) => a - b)) {
            if (j > prev + 1)
                lines.push('--');
            const head = hits.includes(j) ? ':' + (j + 1) + ': ' : '-' + (j + 1) + '- ';
            lines.push(f.path + head + ls[j].slice(0, 500));
            prev = j;
        }
        matches += hits.length;
        if (Date.now() > deadline) {
            timedOut = true;
            break;
        }
        if (lines.join('\n').length >= OUT_MAX)
            break;
    }
    await markUntrustedFiles(matchedFiles, ctx);
    if (!lines.length)
        return 'ничего не найдено' + (mask ? ' (маска ' + args.glob + ')' : '');
    const notes = [
        'совпадений ' + matches + ' в ' + matchedFiles.length + ' файлах (прочитано ' + filesRead + ', просмотрено ' + seen + ')',
        matches >= maxMatches ? 'достигнут лимит совпадений (' + maxMatches + ') — сузь запрос (path/glob)' : '',
        lines.join('\n').length >= OUT_MAX ? 'вывод усечён (~' + Math.round(OUT_MAX / 1024) + ' КБ)' : '',
        timedOut ? 'обход прерван по лимиту времени (' + Math.round(TIME_BUDGET_MS / 1000) + ' с)' : '',
    ].filter(Boolean);
    return clip(lines.join('\n'), OUT_MAX) + '\n\n(' + notes.join('; ') + ')';
}

async function workGlob(args, ctx) {
    const root = await mustItem(args.path, ctx);
    if (Array.isArray(root))
        throw new Error('glob: укажите конкретную папку (~/сборка слоёв не поддерживается)');
    if (ctx.entry)
        ctx.entry.path = root.path;
    if (!String(args.pattern ?? '').trim())
        throw new Error('glob: нужен pattern, например "**/*.js"');
    // шаблон без «/» — имена на любой глубине ('*.md' ≡ '**/*.md'), с «/» — путь от папки поиска
    const star = p => globToRegExp(String(p ?? '').includes('/') ? p : '**/' + p);
    const re = star(args.pattern);
    const exclude = args.exclude ? star(args.exclude) : null;
    const max = Math.min(GLOB_MAX, Math.max(1, Number(args.limit) || 500));
    const deadline = Date.now() + TIME_BUDGET_MS;
    const out = [];
    for await (const k of walkItems(root, deadline, ctx)) {
        const rel = relPath(k, root);
        if (!re.test(rel) || (exclude && exclude.test(rel)))
            continue;
        out.push(k.path + (k instanceof FS.$file ? '' : '/'));
        if (out.length >= max || Date.now() > deadline)
            break;
    }
    if (!out.length)
        return 'ничего не найдено (шаблон ' + args.pattern + ')';
    const notes = [
        'найдено ' + out.length,
        out.length >= max ? 'достигнут лимит (' + max + ') — сузь шаблон или папку' : '',
        Date.now() > deadline ? 'обход прерван по лимиту времени' : '',
    ].filter(Boolean);
    return clip(out.join('\n'), OUT_MAX) + (notes.length > 1 ? '\n\n(' + notes.join('; ') + ')' : '');
}

// ── арена sandbox ───────────────────────────────────────────────────────────

/** Шаблон glob → маска последнего сегмента (для find -name в старом образе без rg). */
function basenameMask(pattern) {
    const last = String(pattern ?? '').replace(/\\/g, '/').split('/').pop() || '*';
    return last.includes('*') ? last : '*' + last + '*';
}

export async function useSandbox(args, ctx) {
    const cfg = loadSandboxConfig();
    if (cfg.enabled === false)
        throw new Error('песочницы выключены (#system/sandbox.json enabled:false)');
    let docker;
    try {
        docker = await getDocker();
    }
    catch (e) {
        throw new Error('песочница недоступна (Docker не отвечает): ' + String(e?.message || e), { cause: e });
    }
    const pc = await ensureComputer(docker, ownerOf(ctx), computerName(args?.name), cfg);
    return { cfg, docker, pc };
}

/** С включённым интернетом вывод песочницы — чужой текст (правило sandbox_exec, 8.2). */
export async function markSandboxTaint(docker, pc, cfg, ctx) {
    try {
        const st = await statusOf(docker, pc.id);
        if (st?.networks?.includes(cfg.network?.egressName || 'work-egress') && ctx.entry)
            ctx.entry.untrusted = true;
    }
    catch (e) { log.debug('dev.sbx.net', e); /* статуса нет — не помечаем */ }
}

/** Общий запуск: позиционные аргументы ($1 папка, $2 шаблон, $3 маска) — пользовательский
 *  текст не попадает в командную строку, инъекция в sh невозможна. */
async function sbxExec(script, argv, args, ctx) {
    const { cfg, docker, pc } = await useSandbox(args, ctx);
    await markSandboxTaint(docker, pc, cfg, ctx);
    const wd = args?.path ? assertSandboxPath(args.path, cfg.workdir) : (cfg.workdir || '/workspace');
    const sec = Math.min(SBX_TIMEOUT_SEC, Math.max(1, Number(args?.timeout) || 30));
    const r = await execRaw(docker, pc.id, {
        cmd: ['timeout', '-s', 'KILL', String(sec), 'sh', '-c', script, 'sh', wd, ...argv],
        workdir: cfg.workdir || '/workspace', timeoutSec: sec, maxBytes: SBX_OUT_MAX, signal: ctx?.signal,
    });
    touchComputer(ownerOf(ctx), pc.name, pc.id);
    return r;
}

async function sandboxGrep(args, ctx) {
    const raw = String(args.regex ?? args.text ?? '');
    if (!raw)
        throw new Error('grep: нужен text или regex');
    const ci = args.caseSensitive ? '' : ' -i';
    const cx = Math.min(10, Math.max(0, Number(args.context) || 0));
    const cxFlag = cx ? ' -C ' + cx : '';
    const mask = args.glob ? String(args.glob) : '';
    const rgGlob = mask ? ' --glob "$3"' : '';
    const grepInc = mask ? ' --include="$3"' : '';
    const script = 'cd "$1" || exit 1\n'
        + 'if command -v rg >/dev/null 2>&1; then\n'
        + '  exec rg --no-heading --line-number --color=never' + ci + cxFlag + rgGlob + ' -- "$2" .\n'
        + 'else\n'
        + '  exec grep -rn --color=never' + ci + cxFlag + grepInc + ' -- "$2" .\n'
        + 'fi';
    const r = await sbxExec(script, [raw, mask], args, ctx);
    if (r.aborted)
        return '[остановлено пользователем]';
    if (r.timedOut || r.code === 124)
        return '[таймаут — поиск прерван]\n' + formatExec(r, OUT_MAX);
    if (r.code === 1 && !r.stdout.trim())
        return 'ничего не найдено' + (mask ? ' (маска ' + mask + ')' : '');
    if (r.code === 0 || r.code === 1)
        return formatExec(r, OUT_MAX);
    throw new Error('grep в песочнице: код ' + r.code + (r.stderr.trim() ? ': ' + clip(r.stderr.trim(), 300) : ''));
}

async function sandboxGlob(args, ctx) {
    const pattern = String(args.pattern ?? '').trim();
    if (!pattern)
        throw new Error('glob: нужен pattern, например "**/*.js"');
    const exclude = String(args.exclude ?? '');
    const rgEx = exclude ? ' --glob "!$3"' : '';
    const findEx = exclude ? ' -not -name "$3"' : '';
    const script = 'cd "$1" || exit 1\n'
        + 'if command -v rg >/dev/null 2>&1; then\n'
        + '  exec rg --files --glob "$2"' + rgEx + " --glob '!node_modules/**' --glob '!.git/**'" + ' .\n'
        + 'else\n'
        + '  exec find . -type f -name "$4"' + findEx + " -not -path '*/node_modules/*' -not -path '*/.git/*'\n"
        + 'fi';
    // find -name не понимает **: маске — последний сегмент шаблона (примерно; настоящий путь — rg)
    const r = await sbxExec(script, [pattern, exclude, basenameMask(pattern)], args, ctx);
    if (r.aborted)
        return '[остановлено пользователем]';
    if (r.timedOut || r.code === 124)
        return '[таймаут — поиск прерван]\n' + formatExec(r, OUT_MAX);
    if (!r.stdout.trim())
        return 'ничего не найдено (шаблон ' + pattern + ')';
    if (r.code === 0)
        return formatExec(r, OUT_MAX);
    throw new Error('glob в песочнице: код ' + r.code + (r.stderr.trim() ? ': ' + clip(r.stderr.trim(), 300) : ''));
}

// ── инструменты ─────────────────────────────────────────────────────────────

const WHERE_PROP = {
    where: {
        type: 'string',
        enum: ['work', 'sandbox'],
        description: 'Где искать: work — дерево WORK (с правами; код /sources, /MODELS), sandbox — ваш компьютер (песочница, от /workspace)',
    },
};
const SBX_PROPS = {
    name: { type: 'string', description: 'Компьютер (по умолчанию main)' },
    timeout: { type: 'integer', description: 'Секунд, только sandbox (по умолчанию 30, максимум 60)' },
};

export const grep = {
    name: 'grep',
    readonly: true,
    concurrent: true,
    description: 'Поиск по содержимому файлов (grep): подстрока text или регулярное выражение regex, без учёта регистра по умолчанию, контекст строк context, маска файлов glob (например *.js), лимит limit. Арена where: work — дерево WORK (права по файлам, системные зоны не видны), sandbox — ваш компьютер (папка от /workspace; ripgrep с учётом .gitignore, в старом образе — grep).',
    parameters: {
        type: 'object',
        properties: {
            ...WHERE_PROP,
            path: { type: 'string', description: 'Где искать: WORK-путь (по умолчанию место задачи) или папка песочницы' },
            text: { type: 'string', description: 'Подстрока' },
            regex: { type: 'string', description: 'Регулярное выражение (по строкам)' },
            caseSensitive: { type: 'boolean', description: 'Учитывать регистр (по умолчанию нет)' },
            context: { type: 'integer', description: 'Строк контекста до/после совпадения (0–10, по умолчанию 0)' },
            glob: { type: 'string', description: 'Маска файлов, например *.js' },
            limit: { type: 'integer', description: 'Максимум совпадений (по умолчанию 200, потолок 2000)' },
            ...SBX_PROPS,
        },
    },
    async run(args, ctx) {
        return args?.where === 'sandbox'
            ? ctxRun('grep_sandbox', sandboxGrep)(args, ctx)
            : workGrep(args, ctx);
    },
};

export const glob = {
    name: 'glob',
    readonly: true,
    concurrent: true,
    description: 'Поиск файлов по шаблону имени: **/*.js (в любой глубине), *.md, src/**/*.test.js; exclude — исключить шаблон. Арена where: work — дерево WORK (права по файлам, системные зоны не видны), sandbox — ваш компьютер (папка от /workspace).',
    parameters: {
        type: 'object',
        properties: {
            ...WHERE_PROP,
            path: { type: 'string', description: 'Где искать: WORK-путь (по умолчанию место задачи) или папка песочницы' },
            pattern: { type: 'string', description: 'Шаблон, например **/*.js' },
            exclude: { type: 'string', description: 'Исключить шаблон, например node_modules/**' },
            limit: { type: 'integer', description: 'Максимум путей (по умолчанию 500, потолок 2000)' },
            ...SBX_PROPS,
        },
        required: ['pattern'],
    },
    async run(args, ctx) {
        return args?.where === 'sandbox'
            ? ctxRun('glob_sandbox', sandboxGlob)(args, ctx)
            : workGlob(args, ctx);
    },
};

export const devSearchTools = [grep, glob];
