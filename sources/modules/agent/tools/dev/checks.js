/**
 * Инструменты разработчика (этап 6.6): run_checks — запуск тестов/линтера/сборки.
 *
 * Арены (архитектура 6.1, инвариант 12 в rules/threats.md):
 *   work    — репозиторий сервера WORK (корень дерева): запуск кода репозитория =
 *             эквивалент shell → только корневому ADMIN и с подтверждением КАЖДЫЙ раз
 *             (без «разрешить всегда»); команда — ТОЛЬКО из разрешённого списка
 *             (скрипты package.json + #system/dev.json `checks: {имя: команда}`,
 *             который ставит ADMIN) — модель выбирает имя, но не пишет команду;
 *             в журнал безопасности идёт имя проверки (не команда — она из конфига);
 *             таймаут ≤600 с, вывод ≤30 КБ (начало+конец);
 *   sandbox — компьютер пользователя: свободная команда (как sandbox_exec),
 *             таймаут ≤600 с, вывод ≤30 КБ (начало+конец), при включённом интернете —
 *             untrusted (исполняется чужой код, правило sandbox_exec).
 *
 * 8.37 закрыл fail-open ветки песочницы (сеть/квоты/TTL) — эта основа и используется.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run, isAdmin, audit } from '../../system.js';
import { ctxRun } from '../sandbox.js';
import { useSandbox, markSandboxTaint } from './search.js';
import { execCommand } from '../../../sandbox/manager.js';

const CHECK_TIMEOUT_SEC = 600;   // потолок прогона
const CHECK_OUT_MAX = 30_000;     // вывод в ленту
const CHECK_BUF_MAX = 300_000;    // буфер вывода (для «начало+конец»)

/** Разрешённые проверки сервера: скрипты package.json + #system/dev.json (checks). */
export async function listChecks() {
    const out = { dev: [], scripts: [] };
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
        out.scripts = Object.keys(pkg.scripts || {});
    }
    catch { /* нет package.json — только dev.json */ }
    try {
        const dev = JSON.parse(fs.readFileSync(path.join(process.cwd(), '#system', 'dev.json'), 'utf-8'));
        out.dev = Object.keys(dev.checks || {}).map(name => ({ name, cmd: String(dev.checks[name]) }));
    }
    catch { /* нет dev.json — только скрипты */ }
    return out;
}

/** Найти проверку по имени: dev.json (админ переопределяет) → скрипт package.json. */
export function findCheck(name, sources) {
    const n = String(name ?? '').trim();
    const dev = (sources.dev || []).find(c => c.name === n);
    if (dev)
        return dev;
    if ((sources.scripts || []).includes(n))
        return { name: n, cmd: 'npm run ' + n };
    return null;
}

/** Вывод с потолком: начало + конец (ошибки обычно в конце, приветствие — в начале). */
export function clipHeadTail(text, max = CHECK_OUT_MAX) {
    const s = String(text ?? '');
    if (s.length <= max)
        return s;
    const head = Math.floor(max / 2);
    const tail = Math.max(1000, max - head - 80);
    return s.slice(0, head)
        + '\n[… пропущено ' + (s.length - head - tail) + ' символов вывода …]\n'
        + s.slice(-tail);
}

/** Формат прогона: код возврата + вывод (stdout, затем stderr) с потолком. */
function formatCheck(r, what) {
    const parts = [];
    if (r.aborted)
        parts.push('[остановлено пользователем]');
    if (r.timedOut || r.code === 124)
        parts.push('[таймаут — процесс остановлен]');
    parts.push(what + ': код возврата ' + r.code);
    const out = String(r.stdout || '').trim();
    const err = String(r.stderr || '').trim();
    const body = out + (out && err ? '\n[stderr]\n' : '') + err;
    if (body)
        parts.push(clipHeadTail(body));
    return parts.join('\n');
}

/** Прогоны на сервере WORK: только ADMIN, команда — из разрешённого списка. */
async function workChecks(args, ctx) {
    if (!(await isAdmin(ctx?.session)))
        throw new Error('проверки на сервере WORK — только администратору; свой проект — в песочнице (where:"sandbox")');
    const sources = await listChecks();
    if (!String(args?.name ?? '').trim())
        return 'доступные проверки (work):'
            + (sources.dev.length ? '\n- из #system/dev.json: ' + sources.dev.map(c => c.name).join(', ') : '')
            + (sources.scripts.length ? '\n- скрипты package.json: ' + sources.scripts.join(', ') : '')
            + '\nзапусти run_checks с name; в песочнице (where:"sandbox") — свободная command';
    const check = findCheck(args.name, sources);
    if (!check)
        throw new Error('нет проверки «' + String(args.name).slice(0, 60) + '». Доступные:'
            + (sources.dev.length ? ' #system/dev.json: ' + sources.dev.map(c => c.name).join(', ') : '')
            + (sources.scripts.length ? ' package.json: ' + sources.scripts.join(', ') : ''));
    const sec = Math.min(CHECK_TIMEOUT_SEC, Math.max(1, Number(args?.timeout) || 300));
    const t0 = Date.now();
    const r = await run(check.cmd, [], {
        shell: true, cwd: process.cwd(), timeout: sec * 1000, max: CHECK_BUF_MAX, signal: ctx?.signal,
    });
    // в журнал — имя проверки: команда — из конфига ADMIN, не от модели
    audit({ tool: 'run_checks', check: check.name, ok: r.code === 0, ms: Date.now() - t0 }, ctx?.session);
    return formatCheck(r, 'проверка «' + check.name + '»');
}

/** Прогон в песочнице: свободная команда, потолки, интернет — untrusted. */
async function sandboxChecks(args, ctx) {
    const command = String(args?.command ?? '').trim();
    if (!command)
        throw new Error('нужна command (проверки в песочнице свободны, как sandbox_exec)');
    const { cfg, docker, pc } = await useSandbox({ ...args, name: args?.computer }, ctx);
    await markSandboxTaint(docker, pc, cfg, ctx);
    const r = await execCommand(docker, pc.id, command, {
        workdir: args?.workdir,
        timeoutSec: Math.min(CHECK_TIMEOUT_SEC, Math.max(1, Number(args?.timeout) || 300)),
        maxBytes: CHECK_BUF_MAX,
        signal: ctx?.signal,
    });
    return formatCheck(r, 'проверка в песочнице');
}

// ── инструмент ──────────────────────────────────────────────────────────────

export const run_checks = {
    name: 'run_checks',
    risk: 'write',
    description: 'Запустить проверки проекта (тесты, линтер, сборка). Арена work — сервер WORK (только администратор, подтверждение каждый раз): name — проверка из разрешённого списка (скрипты package.json + #system/dev.json; без name — список доступных), команда выполняется с правами процесса сервера. Арена sandbox — ваш компьютер: command свободная (sh, рабочая папка от /workspace), до 600 с, вывод до 30 КБ (начало+конец).',
    parameters: {
        type: 'object',
        properties: {
            where: { type: 'string', enum: ['work', 'sandbox'], description: 'work — сервер WORK (администратор), sandbox — ваш компьютер (песочница)' },
            name: { type: 'string', description: 'Имя проверки (work; пропуск — список доступных)' },
            command: { type: 'string', description: 'Команда (sandbox), например npm test' },
            workdir: { type: 'string', description: 'Подпапка /workspace (sandbox)' },
            timeout: { type: 'integer', description: 'Секунд (по умолчанию 300, максимум 600)' },
            computer: { type: 'string', description: 'Компьютер (только sandbox, по умолчанию main)' },
        },
    },
    permission(a) {
        if (a?.where === 'sandbox')
            return undefined; // как sandbox_exec: в auto свободно, ask-режим спрашивает
        if (!String(a?.name ?? '').trim())
            return { verdict: 'allow' }; // список проверок — чтение, не запуск
        // запуск кода репозитория на сервере — эквивалент shell: каждый раз, без «всегда»
        return {
            verdict: 'ask', noAlways: true,
            reason: 'запустить проверку «' + String(a.name).slice(0, 60) + '» на сервере WORK — это запуск кода репозитория с правами процесса сервера',
        };
    },
    async run(args, ctx) {
        return args?.where === 'sandbox'
            ? ctxRun('run_checks_sandbox', sandboxChecks)(args, ctx)
            : workChecks(args, ctx); // аудит — свой, с именем проверки
    },
};

export const devCheckTools = [run_checks];
