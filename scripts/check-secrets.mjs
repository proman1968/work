/**
 * Сканер секретов в отслеживаемых файлах репозитория (hardening 0.5).
 *
 *   node scripts/check-secrets.mjs [--json] [--all]
 *
 * Ищет приватные ключи, токены известных форматов и «ключевое слово = значение»
 * в отслеживаемых и новых (не игнорируемых git) файлах. Исключения — .secretsignore (gitignore-подобные маски).
 * Бинарные файлы (NUL-байт) пропускаются. Вывод маскируется: сами значения не печатаются.
 * Находки → exit 1 (для CI и pre-commit), чисто → exit 0.
 *
 * --json — итог одной JSON-строкой (CI), --all — не останавливаться на первом файле с ошибкой чтения.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');

/** Правила: id → регулярное выражение. Значения в выводе маскируются. */
const RULES = [
    ['private-key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
    ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
    ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
    ['mcp-token', /\bwmcp\.[0-9A-F]{16}\.[A-Za-z0-9_-]{43}\b/],
    ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/],
    ['bearer-basic-b64', /\b(?:Authorization['"]?\s*[:=]\s*['"]?|Bearer\s+|Basic\s+)[A-Za-z0-9+/]{40,}={0,2}\b/],
    ['keyword-value', /\b(?:api[_-]?key|apikey|secret|token|password|passwd|pass)['"]?\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
    ['uuid-pair-key', /(?<![A-Za-z0-9+/=-])[A-Za-z0-9+/]{60,}==(?![A-Za-z0-9+/=])/],
];

/** Значения-указатели, пути и заведомые заглушки — не секреты. */
const SAFE_VALUE = /^(?:secret:|env:|\$\{|true|false|null|undefined|<|\/)/i;
const SAFE_MARK = /example|placeholder|your[-_]|вставь|замен[иі]т|xxxx|^\*+$|^\*+/i;

/** Развернуть gitignore-подобную маску в RegExp (только простые случаи: *, **, ?, остальное — литерал). */
function globToRegExp(pattern) {
    let re = '';
    let i = 0;
    while (i < pattern.length) {
        const c = pattern[i];
        if (c === '*') {
            if (pattern[i + 1] === '*') { re += '[\\s\\S]*'; i += 2; continue; }
            re += '[^/]*'; i++; continue;
        }
        if (c === '?') { re += '[^/]'; i++; continue; }
        re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        i++;
    }
    return new RegExp('(?:^|/)' + re + '(?:$|/)');
}

/** Прочитать .secretsignore: маски, `#` — комментарии. */
export function loadIgnores(file = path.join(ROOT, '.secretsignore')) {
    if (!fs.existsSync(file))
        return [];
    return fs.readFileSync(file, 'utf-8').split(/\r?\n/)
        .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
        .map(globToRegExp);
}

/** Маскировка значения: первые 4 символа + длина. */
function mask(match) {
    const m = String(match).replace(/^[^A-Za-z0-9]*/, '');
    return m.slice(0, 4) + '…<' + m.length + ' симв.>';
}

/**
 * Скан файла (текст) → находки [{line, rule, preview}].
 * @param {string} content текст файла
 * @param {RegExp[]} ignores исключения
 */
export function scanText(content, ignores = []) {
    const out = [];
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
        if (ignores.some(re => re.test(line.trim())))
            return;
        for (const [rule, re] of RULES) {
            const m = line.match(re);
            if (!m)
                continue;
            const value = m[0];
            if (rule === 'keyword-value' || rule === 'bearer-basic-b64') {
                const v = (value.match(/['"]([^'"]+)['"]/) || value.match(/[A-Za-z0-9+/]{20,}/) || [])[1] || value;
                if (SAFE_VALUE.test(v) || SAFE_MARK.test(v) || SAFE_MARK.test(line))
                    continue;
            }
            out.push({ line: idx + 1, rule, preview: mask(value) });
        }
    });
    return out;
}

/** Бинарный ли файл: NUL-байт в первых 8 КБ. */
function isBinary(full) {
    const fd = fs.openSync(full, 'r');
    try {
        const buf = Buffer.alloc(8192);
        const n = fs.readSync(fd, buf, 0, 8192, 0);
        return buf.subarray(0, n).includes(0);
    } finally { fs.closeSync(fd); }
}

function main() {
    // отслеживаемые + новые не игнорируемые файлы: секрет ловится до `git add`
    const ls = spawnSync('git', ['-C', ROOT, '-c', 'core.quotepath=false', 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (ls.status !== 0)
        return finish(ls.error?.message || 'git ls-files недоступен', 2);
    const ignores = loadIgnores();
    const findings = [];
    const errors = [];
    for (const rel of ls.stdout.split(/\r?\n/).filter(Boolean)) {
        if (ignores.some(re => re.test(rel.replace(/\\/g, '/'))))
            continue;
        const full = path.join(ROOT, rel);
        let content;
        try {
            if (isBinary(full))
                continue;
            content = fs.readFileSync(full, 'utf-8');
        } catch (e) {
            if (e.code !== 'ENOENT')
                errors.push(rel + ': ' + e.code);
            continue;
        }
        for (const f of scanText(content, ignores))
            findings.push({ file: rel, ...f });
    }
    if (asJson)
        console.log(JSON.stringify({ findings, errors }));
    else {
        for (const f of findings)
            console.error('СЕКРЕТ? ' + f.file + ':' + f.line + ' [' + f.rule + '] ' + f.preview);
        for (const e of errors)
            console.error('пропущен ' + e);
        if (!findings.length && !errors.length)
            console.log('Чисто: секретов по правилам не найдено (' + RULES.length + ' правил).');
        else
            console.log('Итог: ' + findings.length + ' находок, ' + errors.length + ' пропущенных файлов.');
    }
    process.exitCode = findings.length ? 1 : 0;
}

function finish(msg, code) {
    console.error(msg);
    process.exit(code);
}

/** Запуск как скрипт (не при импорте из тестов). */
const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invoked)
    main();
