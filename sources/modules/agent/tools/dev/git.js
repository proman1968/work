/**
 * Инструменты разработчика (этап 6.4): git — чтение истории, коммиты, ветки, публикация.
 *
 * Арены (архитектура 6.1, инварианты 12–13 в rules/threats.md):
 *   work    — репозиторий сервера WORK (корень дерева): только корневому ADMIN;
 *             spawn с ЯВНЫМИ аргументами (без оболочки), фиксированный cwd, окружение
 *             без токенов и с GIT_TERMINAL_PROMPT=0, ref/имена/пути проверяются,
 *             «--» перед путями против инъекции опций; таймаут ≤120 с, вывод ≤200 КБ;
 *             команды, переписывающие рабочее дерево (checkout/reset/restore/stash/clean/rm),
 *             агенту недоступны вовсе — правка файлов идёт через write/edit/apply_patch
 *             с историей и откатом ленты (таких инструментов здесь нет — и быть не должно);
 *   sandbox — репозиторий пользователя в контейнере (/workspace): те же инструменты,
 *             через docker exec с массивом аргументов (без sh), вывод с потолком;
 *             при включённом интернете — untrusted (правило sandbox_exec).
 *
 * Разрешения: чтения — readonly (любой режим); git_branch — risk write (в auto свободно,
 * создаёт только указатель ветки); git_commit — подтверждение КАЖДЫЙ раз (изменение системы,
 * без «разрешить всегда»; хеш коммита — в журнал безопасности); git_push — outbound:
 * всегда подтверждение без «разрешить всегда», субагенту не выдаётся (SUBAGENT_DENY).
 */
import fs from 'node:fs';
import path from 'node:path';
import { run, isAdmin, audit, askEach } from '../../system.js';
import { ctxRun } from '../sandbox.js';
import { useSandbox, markSandboxTaint } from './search.js';
import { execRaw } from '../../../sandbox/manager.js';
import { clip } from '../../util.js';

const GIT_TIMEOUT_MS = 120_000;   // потолок команды (арена work)
const GIT_OUT_MAX = 200_000;       // потолок вывода
const GIT_SBX_SEC = 60;            // потолок команды (песочница)

/** Окружение для git: без токенов/паролей процесса, без интерактивных вопросов. */
function gitEnv() {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
    for (const k of Object.keys(env))
        if (/(TOKEN|PASSPHRASE|PASSWORD|SECRET)/i.test(k))
            delete env[k];
    return env;
}

/** ref/имя ветки/тега или хеш: без опций, «..», пробелов — не превращается в аргумент команды. */
export function checkGitRef(s, what = 'ref') {
    const v = String(s ?? '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,99}$/.test(v) || v.includes('..'))
        throw new Error('недопустимое значение ' + what + ' «' + String(s).slice(0, 40) + '»: буквы, цифры, точка, дефис, слэш, @ (без опций и «..»)');
    return v;
}

/** remote: имя или URL — без пробелов и ведущих дефисов (не опция). */
export function checkGitRemote(s) {
    const v = String(s ?? '').trim();
    if (!/^[A-Za-z0-9@:/._~-]{1,200}$/.test(v) || v.includes('..'))
        throw new Error('недопустимый remote «' + String(s).slice(0, 40) + '»');
    return v;
}

/** Путь внутри репозитория: относительный, без «..» и ведущего дефиса. */
export function checkRepoPath(s) {
    const v = String(s ?? '').trim().replace(/\\/g, '/');
    if (!v || v.startsWith('/') || v.startsWith('-') || v.split('/').some(x => !x || x === '..' || x === '.'))
        throw new Error('недопустимый путь «' + String(s).slice(0, 60) + '»: относительный, внутри репозитория');
    return v;
}

/** git на сервере WORK: только администратор, и корень дерева — репозиторий. */
async function assertGitWork(ctx) {
    if (!(await isAdmin(ctx?.session)))
        throw new Error('git репозитория сервера WORK — только администратору; свой проект — в песочнице (where:"sandbox")');
    if (!fs.existsSync(path.join(process.cwd(), '.git')))
        throw new Error('корень WORK не является git-репозиторием (нет .git) — работа с git доступна в песочнице (where:"sandbox")');
}

/** Запуск git в арене work: явные аргументы, фиксированный cwd, окружение без токенов. */
async function workGit(argv, ctx) {
    return await run('git', argv, {
        cwd: process.cwd(), timeout: GIT_TIMEOUT_MS, max: GIT_OUT_MAX,
        signal: ctx?.signal, env: gitEnv(),
    });
}

/** Запуск git в арене sandbox: массив аргументов без оболочки, потолок вывода. */
async function sbxGit(argv, ctx, args) {
    const { cfg, docker, pc } = await useSandbox(args, ctx);
    await markSandboxTaint(docker, pc, cfg, ctx);
    return await execRaw(docker, pc.id, {
        cmd: ['git', ...argv],
        workdir: cfg.workdir || '/workspace', timeoutSec: GIT_SBX_SEC, maxBytes: GIT_OUT_MAX, signal: ctx?.signal,
    });
}

/** Вывод команды: stdout с потолком, ошибка — с stderr. */
function gitOut(r, o = {}) {
    if (r.aborted)
        return '[остановлено пользователем]';
    if (r.timedOut || r.code === 124)
        return '[таймаут — команда остановлена]\n' + clip(r.stdout || '', GIT_OUT_MAX);
    if (r.code === 0)
        return clip(String(r.stdout || '').trim(), GIT_OUT_MAX) || o.empty || '(пусто)';
    throw new Error('git ' + (o.what || 'команда') + ' вернула код ' + r.code
        + (String(r.stderr || '').trim() ? ': ' + clip(String(r.stderr).trim(), 400) : ''));
}

const WHERE_PROP = {
    where: {
        type: 'string',
        enum: ['work', 'sandbox'],
        description: 'Репозиторий: work — сервер WORK (только администратор), sandbox — ваш компьютер (песочница, /workspace)',
    },
};
const SBX_NAME = { name: { type: 'string', description: 'Компьютер (только sandbox, по умолчанию main)' } };

/** Единая обвязка простого инструмента: собрать argv (валидации в fn), выполнить в арене. */
function gitTool(fn, o = {}) {
    return async (args, ctx) => {
        const argv = fn(args);
        const r = args?.where === 'sandbox'
            ? await sbxGit(argv, ctx, args)
            : (await assertGitWork(ctx), await workGit(argv, ctx));
        return gitOut(r, { what: o.what || argv[0], empty: o.empty });
    };
}

// ── инструменты ─────────────────────────────────────────────────────────────

export const git_status = {
    name: 'git_status',
    readonly: true,
    description: 'Состояние репозитория: ветка, изменённые и новые файлы (git status --porcelain). Арена where: work — репозиторий сервера WORK (администратор), sandbox — ваш компьютер.',
    parameters: { type: 'object', properties: { ...WHERE_PROP, ...SBX_NAME } },
    run: gitTool(() => ['status', '--porcelain=v1', '--branch']),
};

export const git_diff = {
    name: 'git_diff',
    readonly: true,
    description: 'Незафиксированные изменения (git diff; staged:true — подготовленные к коммиту). Пусто — по всему репозиторию.',
    parameters: {
        type: 'object',
        properties: {
            ...WHERE_PROP, ...SBX_NAME,
            path: { type: 'string', description: 'Путь внутри репозитория (по умолчанию всё)' },
            staged: { type: 'boolean', description: 'Подготовленные к коммиту (index) вместо рабочей копии' },
        },
    },
    run: gitTool(a => {
        const paths = a?.path !== undefined ? ['--', checkRepoPath(a.path)] : [];
        return ['diff', ...(a.staged ? ['--cached'] : []), ...paths];
    }, { what: 'diff' }),
};

export const git_log = {
    name: 'git_log',
    readonly: true,
    description: 'История коммитов (git log --oneline), последние сверху. Пусто — по всем путям.',
    parameters: {
        type: 'object',
        properties: {
            ...WHERE_PROP, ...SBX_NAME,
            path: { type: 'string', description: 'История одного пути' },
            limit: { type: 'integer', description: 'Сколько коммитов (по умолчанию 30, максимум 200)' },
        },
    },
    run: gitTool(a => ['log', '--oneline', '--decorate', '-n', String(Math.min(200, Math.max(1, Number(a?.limit) || 30))),
        ...(a?.path !== undefined ? ['--', checkRepoPath(a.path)] : [])]),
};

export const git_show = {
    name: 'git_show',
    readonly: true,
    description: 'Коммит/тег/ветка: что вошло (git show) — метаданные и изменения. ref — хеш, имя ветки или тега.',
    parameters: {
        type: 'object',
        properties: { ...WHERE_PROP, ...SBX_NAME, ref: { type: 'string', description: 'Хеш/ветка/тег, например HEAD или main' } },
        required: ['ref'],
    },
    run: gitTool(a => ['show', '--oneline', '--stat', checkGitRef(a?.ref)]),
};

export const git_blame = {
    name: 'git_blame',
    readonly: true,
    description: 'Кто и каким коммитом написал каждую строку файла (git blame).',
    parameters: {
        type: 'object',
        properties: { ...WHERE_PROP, ...SBX_NAME, path: { type: 'string', description: 'Путь внутри репозитория' } },
        required: ['path'],
    },
    run: gitTool(a => ['blame', '--', checkRepoPath(a?.path)]),
};

export const git_branch = {
    name: 'git_branch',
    risk: 'write',
    description: 'Создать ветку от текущего HEAD (переключения не происходит: рабочая копия не меняется). Список веток — в git_status/git_log.',
    parameters: {
        type: 'object',
        properties: { ...WHERE_PROP, ...SBX_NAME, branch: { type: 'string', description: 'Имя новой ветки' } },
        required: ['branch'],
    },
    run: gitTool(a => ['branch', checkGitRef(a?.branch, 'имя ветки')]),
};

export const git_commit = {
    name: 'git_commit',
    risk: 'write',
    description: 'Зафиксировать изменения: добавить paths (пусто — все изменения, включая новые файлы) и создать коммит с сообщением. Подтверждение — каждый раз; хеш коммита попадает в журнал безопасности. Правка файлов — через write/edit/apply_patch, git только фиксирует.',
    parameters: {
        type: 'object',
        properties: {
            ...WHERE_PROP, ...SBX_NAME,
            message: { type: 'string', description: 'Сообщение коммита' },
            paths: { type: 'array', items: { type: 'string' }, description: 'Что добавить (по умолчанию — все изменения)' },
        },
        required: ['message'],
    },
    permission: askEach(a => 'создать git-коммит' + (a?.message ? ' «' + String(a.message).slice(0, 80) + '»' : '') + ' — изменение системы'),
    async run(args, ctx) {
        const message = String(args?.message ?? '').trim();
        if (!message)
            throw new Error('нужно сообщение коммита');
        const argvAdd = args?.paths?.length
            ? ['add', '--', ...args.paths.map(p => checkRepoPath(p))]
            : ['add', '-A'];
        if (args?.where === 'sandbox') {
            return ctxRun('git_commit_sandbox', async () => {
                gitOut(await sbxGit(argvAdd, ctx, args), { what: 'add' });
                return gitOut(await sbxGit(['commit', '-m', message], ctx, args), { what: 'commit', empty: 'коммит создан' });
            })(args, ctx);
        }
        return ctxRun('git_commit', async () => {
            const t0 = Date.now();
            await assertGitWork(ctx);
            gitOut(await workGit(argvAdd, ctx), { what: 'add', empty: '' });
            const r = await workGit(['commit', '-m', message], ctx);
            if (r.timedOut || r.code !== 0)
                return gitOut(r, { what: 'commit' });
            const hash = String((await workGit(['rev-parse', '--short', 'HEAD'], ctx)).stdout || '').trim();
            audit({ tool: 'git_commit', hash, ok: true, ms: Date.now() - t0 }, ctx?.session);
            return gitOut(r, { what: 'commit' }) + (hash ? ' (' + hash + ')' : '');
        })(args, ctx);
    },
};

export const git_push = {
    name: 'git_push',
    risk: 'write',
    outbound: true,
    description: 'Отправить коммиты в удалённый репозиторий (git push). Действие наружу: подтверждение человека каждый раз, «разрешить всегда» не предлагается, субагентам недоступно.',
    parameters: {
        type: 'object',
        properties: {
            ...WHERE_PROP, ...SBX_NAME,
            remote: { type: 'string', description: 'Имя remote или URL (по умолчанию origin)' },
            ref: { type: 'string', description: 'Что отправлять (по умолчанию HEAD — текущая ветка)' },
        },
    },
    permission: askEach(a => 'отправить коммиты наружу в git («' + String(a?.remote || 'origin') + '», ' + String(a?.ref || 'HEAD') + ') — код покидает сервер'),
    async run(args, ctx) {
        const remote = checkGitRemote(args?.remote || 'origin');
        const ref = checkGitRef(args?.ref || 'HEAD', 'ref');
        const argv = ['push', remote, ref];
        if (args?.where === 'sandbox')
            return ctxRun('git_push_sandbox', () => sbxGit(argv, ctx, args)
                .then(r => gitOut(r, { what: 'push', empty: 'отправлено (без вывода)' })))(args, ctx);
        return ctxRun('git_push', async () => {
            const t0 = Date.now();
            await assertGitWork(ctx);
            const r = await workGit(argv, ctx);
            audit({ tool: 'git_push', remote, ref, ok: r.code === 0, ms: Date.now() - t0 }, ctx?.session);
            return gitOut(r, { what: 'push', empty: 'отправлено (без вывода)' });
        })(args, ctx);
    },
};

export const devGitTools = [git_status, git_diff, git_log, git_show, git_blame, git_branch, git_commit, git_push];
