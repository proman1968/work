/**
 * Инструменты разработчика (этап 6.5): код TypeScript/JavaScript — диагностика и навигация.
 *
 * Диагностика — настоящий компилятор: tsc из зависимостей WORK (--noEmit, позиции file(line,col)).
 * Навигация (definition/references/rename) — позиционный символьный поиск по коду арены:
 * идентификатор под курсором + границы слова; языкового сервера в зависимостях нет
 * (typescript-language-server требует классический tsserver, в WORK — TypeScript 7 без него);
 * в песочнице при установленном typescript-language-server агент может вызвать его сам (sandbox_exec).
 *
 * Арены (архитектура 6.1, инварианты 11–12):
 *   work    — код WORK: только корневому ADMIN (как git/run_checks); права на файлы — при чтении
 *             через ядро (walkItems + loadText из search.js); окружение tsc — очищенное;
 *   sandbox — код компьютера: rg --column --word-match по коду, tsc в контейнере
 *             (typescript ставится в песочнице npm i -g typescript — нужен интернет);
 *             включённый интернет — untrusted (правило sandbox_exec).
 *
 * `lsp_rename` — readonly: возвращает ПЛАН правок (позиции), применение — только через
 * edit/apply_patch (права роли, история, откат ленты). Символьный поиск не различает
 * строки/комментарии — план показывает позиции, решение за человеком/моделью.
 *
 * Лимиты: ≤200 файлов, ≤2000 совпадений, ≤30 с обход, вывод ≤30 КБ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mustItem, loadText, callAs } from '../work/common.js';
import { ctxRun } from '../sandbox.js';
import { useSandbox, markSandboxTaint, walkItems } from './search.js';
import { clipHeadTail } from './checks.js';
import { readText, assertSandboxPath, execRaw } from '../../../sandbox/manager.js';
import { FS } from '../../../../server/index.js';
import { isAdmin } from '../../system.js';

const TSC_TIMEOUT_MS = 60_000;
const OUT_MAX = 30_000;
const MATCH_MAX = 2000;
const TIME_BUDGET_MS = 30_000;
const CODE_EXT_RE = /\.(m?ts|c?tsx|js|jsx)$/i;

/** Путь к tsc из зависимостей WORK (модуль живёт в репозитории WORK). */
export function tscPath() {
    for (const base of [fileURLToPath(new URL('../../../../../node_modules/typescript/lib/tsc.js', import.meta.url)), path.join(process.cwd(), 'node_modules', 'typescript', 'lib', 'tsc.js')]) {
        if (fs.existsSync(base))
            return base;
    }
    throw new Error('не найден tsc (typescript) в зависимостях WORK — npm i typescript');
}

/** Окружение без секретов процесса (как mcp-pool ENV_BASE). */
function cleanEnv() {
    const keep = process.platform === 'win32'
        ? ['PATH', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA']
        : ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR'];
    const out = {};
    for (const k of keep)
        if (process.env[k] != null)
            out[k] = process.env[k];
    return out;
}

/** Идентификатор под позицией (1-based line/column): слово, содержащее колонку. */
export function symbolAt(text, line, column) {
    const ls = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
    const l = ls[Math.max(1, Number(line) || 1) - 1] ?? '';
    const col = Math.max(0, (Number(column) || 1) - 1);
    if (col >= l.length)
        return null;
    const re = /[$\w]+/y;
    for (let i = col; i >= 0; i--) {
        re.lastIndex = i;
        const m = re.exec(l);
        if (m && i + m[0].length > col)
            return { symbol: m[0], start: i + 1, end: i + m[0].length, line: l };
    }
    return null;
}

/** Строки кода арены work с вхождениями символа (границы слова, права по файлам). */
async function workMatches(symbol, ctx) {
    // \b не работает с $-идентификаторами — границы собираем вручную
    const wordRe = new RegExp('(?:^|[^$\\w])(' + symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')($|[^$\\w])', 'g');
    const out = [];
    const deadline = Date.now() + TIME_BUDGET_MS;
    const root = await mustItem('/', ctx);
    for await (const f of walkItems(root, deadline, ctx)) {
        if (out.length >= MATCH_MAX || Date.now() > deadline)
            break;
        if (!(f instanceof FS.$file) || !CODE_EXT_RE.test(f.id))
            continue;
        let text;
        try {
            text = await loadText(f, ctx);
        }
        catch { continue; }
        if (typeof text !== 'string')
            continue;
        const ls = text.replace(/\r\n/g, '\n').split('\n');
        for (let i = 0; i < ls.length && out.length < MATCH_MAX; i++) {
            wordRe.lastIndex = 0;
            if (wordRe.test(ls[i]))
                out.push({ rel: f.path, line: i + 1, text: ls[i].slice(0, 300) });
        }
    }
    return { lines: out, timedOut: Date.now() > deadline };
}

/** Строки кода песочницы с вхождениями символа: rg --column --word-match. */
async function sbxMatches(symbol, args, ctx) {
    const { cfg, docker, pc } = await useSandbox({ ...args, name: args?.computer }, ctx);
    await markSandboxTaint(docker, pc, cfg, ctx);
    const script = 'cd "$1" || exit 1\n'
        + 'if command -v rg >/dev/null 2>&1; then\n'
        + '  exec rg --no-heading --line-number --column --word-match --color=never -e "$2" --glob "*.ts" --glob "*.tsx" --glob "*.mts" --glob "*.cts" --glob "*.js" --glob "*.jsx" --glob "!node_modules/**" .\n'
        + 'else\n'
        + '  exit 127\n'
        + 'fi';
    const r = await execRaw(docker, pc.id, {
        cmd: ['timeout', '-s', 'KILL', '60', 'sh', '-c', script, 'sh', cfg.workdir || '/workspace', symbol],
        workdir: cfg.workdir || '/workspace', timeoutSec: 60, maxBytes: 2 * 1024 * 1024, signal: ctx?.signal,
    });
    if (r.code === 127)
        throw new Error('в песочнице нет ripgrep — переустановите образ (docker build sources/modules/sandbox/images/work-computer)');
    if (r.code !== 0 && r.code !== 1)
        throw new Error('символьный поиск в песочнице: код ' + r.code + ' ' + String(r.stderr || '').trim().slice(0, 120));
    const out = [];
    for (const l of String(r.stdout || '').split('\n').filter(Boolean).slice(0, MATCH_MAX)) {
        // ./src/a.ts:3:7: const sym = 1
        const m = /^(\.\/)?(.+?):(\d+):(\d+):(.*)$/.exec(l);
        if (m)
            out.push({ rel: m[2], line: Number(m[3]), text: m[5].slice(0, 300) });
    }
    return { lines: out, seen: out.length, timedOut: false };
}

const DECL_RE = sym => new RegExp('(?:^|[^$\\w])(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|interface|enum|type|const|let|var)\\s+' + sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^$\\w])');

// ── диагностика (tsc) ───────────────────────────────────────────────────────

async function workDiagnostics(args, ctx) {
    if (!(await isAdmin(ctx?.session)))
        throw new Error('диагностика кода WORK — только администратору; свой проект — в песочнице (where:"sandbox")');
    const item = await mustItem(args.path, ctx);
    if (Array.isArray(item) || !(item instanceof FS.$file))
        throw new Error('нужен файл (например /SRC/mod.ts)');
    await callAs(item, 'assertAccess', {}, ctx);
    const tsc = tscPath();
    const r = await new Promise((resolve, reject) => {
        const child = spawn('node', [tsc, '--noEmit', '--skipLibCheck', item.dir], {
            cwd: process.cwd(), env: cleanEnv(), windowsHide: true,
        });
        let out = '', err = '', timedOut = false, done = false;
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TSC_TIMEOUT_MS);
        child.stdout.on('data', c => { if (out.length < OUT_MAX * 4) out += c; });
        child.stderr.on('data', c => { if (err.length < OUT_MAX) err += c; });
        child.on('error', e => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
        child.on('close', code => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            resolve({ code, stdout: out, stderr: err, timedOut });
        });
    });
    const diags = String(r.stdout || '').trim() ? clipHeadTail(String(r.stdout).trim(), OUT_MAX) : '';
    return (r.timedOut ? '[таймаут — процесс остановлен]\n' : '')
        + 'диагностика (tsc --noEmit): код возврата ' + r.code
        + (diags ? '\n' + diags : '\nпроблем не найдено')
        + (String(r.stderr || '').trim() ? '\n[stderr]\n' + clipHeadTail(String(r.stderr).trim(), OUT_MAX) : '');
}

async function sandboxDiagnostics(args, ctx) {
    const { cfg, docker, pc } = await useSandbox({ ...args, name: args?.computer }, ctx);
    await markSandboxTaint(docker, pc, cfg, ctx);
    const file = assertSandboxPath(args.path, cfg.workdir);
    // позиционный аргумент: путь не попадает в командную строку
    const script = 'if command -v tsc >/dev/null 2>&1; then\n'
        + '  exec tsc --noEmit --skipLibCheck "$1"\n'
        + 'else\n'
        + '  echo "нет tsc — npm i -g typescript (нужен интернет)" >&2\n'
        + '  exit 127\n'
        + 'fi';
    const r = await execRaw(docker, pc.id, {
        cmd: ['timeout', '-s', 'KILL', '120', 'sh', '-c', script, 'sh', file],
        workdir: cfg.workdir || '/workspace', timeoutSec: 120, maxBytes: OUT_MAX * 4, signal: ctx?.signal,
    });
    if (r.code === 127)
        throw new Error('в песочнице нет tsc (typescript): npm i -g typescript — интернет включите через computer_network');
    return formatSbx(r);
}

function formatSbx(r) {
    return (r.timedOut ? '[таймаут — процесс остановлен]\n' : '')
        + 'диагностика (tsc --noEmit): код возврата ' + r.code
        + (String(r.stdout || '').trim() ? '\n' + clipHeadTail(String(r.stdout).trim(), OUT_MAX) : '\nпроблем не найдено')
        + (String(r.stderr || '').trim() ? '\n[stderr]\n' + clipHeadTail(String(r.stderr).trim(), OUT_MAX) : '');
}

// ── навигация (символ под позицией) ─────────────────────────────────────────

async function readWorkFile(p, ctx) {
    const item = await mustItem(p, ctx);
    if (Array.isArray(item) || !(item instanceof FS.$file))
        throw new Error('нужен файл (например /SRC/mod.ts)');
    await callAs(item, 'assertAccess', {}, ctx);
    const text = await loadText(item, ctx);
    return { item, text };
}

/** Тело инструмента навигации: символ под позицией → совпадения → формат. */
async function navigate(args, ctx, format) {
    if (!CODE_EXT_RE.test(String(args?.path ?? '')))
        throw new Error('язык файла не поддерживается: typescript — .ts/.tsx/.js/.jsx/.mts/.cts');
    const where = args?.where === 'sandbox' ? 'sandbox' : 'work';
    let symbol;
    if (where === 'sandbox') {
        const { cfg, docker, pc } = await useSandbox({ ...args, name: args?.computer }, ctx);
        await markSandboxTaint(docker, pc, cfg, ctx);
        const file = assertSandboxPath(args.path, cfg.workdir);
        let text;
        try {
            text = await readText(docker, pc.id, file, cfg);
        }
        catch {
            throw new Error('файл не найден: ' + file);
        }
        const at = symbolAt(text, args.line, args.column);
        if (!at)
            throw new Error('под позицией ' + args.line + ':' + args.column + ' нет идентификатора');
        symbol = at.symbol;
        const m = await sbxMatches(symbol, args, ctx);
        return format(symbol, m);
    }
    if (!(await isAdmin(ctx?.session)))
        throw new Error('навигация по коду WORK — только администратору; свой проект — в песочнице (where:"sandbox")');
    const { text } = await readWorkFile(args.path, ctx);
    const at = symbolAt(text, args.line, args.column);
    if (!at)
        throw new Error('под позицией ' + args.line + ':' + args.column + ' нет идентификатора');
    symbol = at.symbol;
    const m = await workMatches(symbol, ctx);
    return format(symbol, m);
}

function posOf(l) {
    return l.rel + ':' + l.line;
}

// ── инструменты ─────────────────────────────────────────────────────────────

const WHERE_PROP = {
    where: { type: 'string', enum: ['work', 'sandbox'], description: 'work — код WORK (только администратор), sandbox — ваш компьютер (песочница)' },
};
const SBX_PROPS = { computer: { type: 'string', description: 'Компьютер (только sandbox, по умолчанию main)' } };
const NAV_PROPS = {
    ...WHERE_PROP, ...SBX_PROPS,
    path: { type: 'string', description: 'Файл с символом (WORK-путь или путь в песочнице)' },
    line: { type: 'integer', description: 'Строка (1-based, как в read)' },
    column: { type: 'integer', description: 'Колонка (1-based)' },
};

export const lsp_diagnostics = {
    name: 'lsp_diagnostics',
    readonly: true,
    description: 'Диагностика TypeScript/JavaScript файла настоящим компилятором (tsc --noEmit): ошибки с позициями file(line,col). Арена work — код WORK (только администратор); sandbox — ваш компьютер (tsc ставится в песочнице: npm i -g typescript).',
    parameters: {
        type: 'object',
        properties: { ...WHERE_PROP, ...SBX_PROPS, path: { type: 'string', description: 'Файл (.ts/.tsx/.js/.jsx)' } },
        required: ['path'],
    },
    async run(args, ctx) {
        return args?.where === 'sandbox'
            ? ctxRun('lsp_diagnostics_sandbox', sandboxDiagnostics)(args, ctx)
            : ctxRun('lsp_diagnostics', workDiagnostics)(args, ctx);
    },
};

export const lsp_definition = {
    name: 'lsp_definition',
    readonly: true,
    description: 'Где объявлен символ под позицией (файл:строка): function/class/interface/enum/type/const/let/var. Позиционный поиск по коду арены (без языкового сервера).',
    parameters: { type: 'object', properties: NAV_PROPS, required: ['path', 'line', 'column'] },
    async run(args, ctx) {
        return navigate(args, ctx, (symbol, m) => {
            const decl = DECL_RE(symbol);
            const defs = m.lines.filter(l => decl.test(l.text));
            if (!defs.length)
                return 'объявление «' + symbol + '» не найдено (все вхождения: ' + m.lines.length + ')';
            return 'объявление «' + symbol + '» (' + defs.length + '):\n' + defs.map(l => posOf(l) + ': ' + l.text.trim().slice(0, 120)).join('\n');
        });
    },
};

export const lsp_references = {
    name: 'lsp_references',
    readonly: true,
    description: 'Все вхождения символа под позицией (файл:строка) — объявления и использования. Позиционный поиск по границам слова.',
    parameters: { type: 'object', properties: NAV_PROPS, required: ['path', 'line', 'column'] },
    async run(args, ctx) {
        return navigate(args, ctx, (symbol, m) => {
            const decl = DECL_RE(symbol);
            const sorted = [...m.lines].sort((a, b) => (decl.test(b.text) ? 1 : 0) - (decl.test(a.text) ? 1 : 0));
            const body = sorted.slice(0, 200).map(l => posOf(l) + (decl.test(l.text) ? ' [объявление]' : '') + ': ' + l.text.trim().slice(0, 120)).join('\n');
            return 'вхождения «' + symbol + '»: ' + m.lines.length + (m.lines.length > 200 ? ' (показаны первые 200)' : '')
                + (m.timedOut ? ' — обход прерван по времени' : '') + '\n' + (body || 'не найдено');
        });
    },
};

export const lsp_rename = {
    name: 'lsp_rename',
    readonly: true,
    description: 'План переименования символа под позицией: все позиции (файл:строка) со старым именем. Сам ничего не меняет — примени правки через edit или apply_patch (права роли, история, откат). Позиционный поиск не различает строки/комментарии — смотри контекст позиций.',
    parameters: {
        type: 'object',
        properties: { ...NAV_PROPS, new_name: { type: 'string', description: 'Новое имя (для плана)' } },
        required: ['path', 'line', 'column'],
    },
    async run(args, ctx) {
        return navigate(args, ctx, (symbol, m) => {
            const newName = String(args?.new_name ?? '').trim();
            if (!/^[A-Za-z_$][\w$]{0,63}$/.test(newName))
                return m.lines.length
                    ? 'план переименования «' + symbol + '»: ' + m.lines.length + ' позиций\n' + m.lines.slice(0, 200).map(l => posOf(l)).join('\n')
                    : 'вхождений «' + symbol + '» нет';
            const plan = m.lines.slice(0, 200).map(l => posOf(l) + ': ' + l.text.trim().slice(0, 100)).join('\n');
            return 'план переименования «' + symbol + '» → «' + newName + '»: ' + m.lines.length + ' позиций'
                + (m.lines.length > 200 ? ' (показаны первые 200)' : '') + '\n' + plan
                + '\n\nПримени правки через edit или apply_patch — они пройдут права, историю и откат.';
        });
    },
};

export const devLspTools = [lsp_diagnostics, lsp_definition, lsp_references, lsp_rename];
