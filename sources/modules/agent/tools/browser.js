/**
 * Браузер компьютера (Chromium через CDP-помощник /opt/work/cdp.py).
 * Текстовый снимок со ссылками [ref] работает с любой моделью (vision не нужен);
 * клики/ввод — по ref, координаты резолвит помощник. refs действуют, пока страница не изменилась.
 * Пароли — только browser_fill_secret (значение из #secret, модель его не видит).
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDocker } from '../../sandbox/driver.js';
import { loadSandboxConfig } from '../../sandbox/config.js';
import {
    ownerOf, computerName, ensureComputer, findComputer, cdp, ensureChromium,
    touchComputer,
} from '../../sandbox/manager.js';
import { isAdmin } from '../system.js';
import { assertPageUrl } from './browse.js';
import { ctxRun } from './sandbox.js';

const SECRET_DIR = 'browser';
const SECRET_NAME = /^[a-z0-9][a-z0-9._-]{0,40}$/i;
const SECRET_ENV = 'WORK_FILL_SECRET';
/** Первое включение секрета на домен — с подтверждением (память процесса). */
const secretApprovals = new Map();

function secretFile(uid, name) {
    if (!SECRET_NAME.test(String(name || '')))
        throw new Error('имя секрета: латиница, цифры, . _ - (например github)');
    const u = String(uid || '');
    if (!/^[\w-]+$/.test(u))
        throw new Error('секреты доступны после входа в систему');
    return path.join(process.cwd(), 'USERS', u, '$user', '#secret', SECRET_DIR, name + '.json');
}

function readSecret(uid, name) {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(secretFile(uid, name), 'utf-8'));
    }
    catch {
        throw new Error('нет секрета «' + name + '» — создайте файл USERS/' + uid + '/$user/#secret/browser/' + name + '.json с {"value": "..."} (вручную, не через агента)');
    }
    const value = String(data?.value ?? '');
    if (!value)
        throw new Error('в секрете «' + name + '» пустое value');
    return value;
}

export function listSecrets(uid) {
    try {
        return fs.readdirSync(path.join(process.cwd(), 'USERS', String(uid), '$user', '#secret', SECRET_DIR))
            .filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
    }
    catch {
        return [];
    }
}

async function useBrowser(args, ctx) {
    const cfg = loadSandboxConfig();
    if (cfg.enabled === false)
        throw new Error('песочницы выключены (#system/sandbox.json enabled:false)');
    const docker = await getDocker();
    const owner = ownerOf(ctx);
    const name = computerName(args?.name);
    const pc = await ensureComputer(docker, owner, name, cfg);
    touchComputer(owner, name, pc.id);
    await ensureChromium(docker, pc.id, { timeoutSec: 90, signal: ctx?.signal });
    return { docker, owner, name, pc };
}

function fmtSnapshot(snap) {
    if (!snap || typeof snap !== 'object')
        return String(snap ?? '');
    return 'Страница: ' + (snap.title || '(без названия)') + ' — ' + (snap.url || '') + '\n' + (snap.text || '');
}

const NAME_PROP = { name: { type: 'string', description: 'Компьютер (по умолчанию main)' } };

export const browserTools = [
    {
        name: 'browser_open',
        risk: 'write',
        description: 'Открыть страницу в браузере компьютера (Chromium). Нужен включённый интернет (computer_network). Возвращает текстовый снимок с пронумерованными элементами [ref] для browser_click/type/select.',
        parameters: {
            type: 'object',
            properties: { ...NAME_PROP, url: { type: 'string', description: 'Адрес http/https' } },
            required: ['url'],
        },
        run: ctxRun('browser_open', async (args, ctx) => {
            const href = assertPageUrl(args?.url);
            const { docker, pc } = await useBrowser(args, ctx);
            const snap = await cdp(docker, pc.id, 'open', { url: href }, { timeoutSec: 120, signal: ctx?.signal });
            noteDomain(ctx, snap?.url || href);
            return fmtSnapshot(snap) + '\n\nСкриншот — отдельно через computer_screenshot, если нужно увидеть страницу глазами.';
        }),
    },
    {
        name: 'browser_snapshot',
        readonly: true,
        description: 'Текстовый снимок текущей страницы: заголовок, адрес и элементы с номерами [ref]. Для кликов и ввода (работает и без vision).',
        parameters: { type: 'object', properties: { ...NAME_PROP } },
        run: ctxRun('browser_snapshot', async (args, ctx) => {
            const { docker, pc } = await useBrowser(args, ctx);
            return fmtSnapshot(await cdp(docker, pc.id, 'snapshot', {}, { signal: ctx?.signal }));
        }),
    },
    {
        name: 'browser_click',
        risk: 'write',
        description: 'Клик по элементу [ref] из browser_snapshot (кнопки, ссылки, чекбоксы). refs действуют, пока страница не изменилась.',
        parameters: {
            type: 'object',
            properties: { ...NAME_PROP, ref: { type: 'integer', description: 'Номер элемента из снимка' } },
            required: ['ref'],
        },
        run: ctxRun('browser_click', async (args, ctx) => {
            const { docker, pc } = await useBrowser(args, ctx);
            const r = await cdp(docker, pc.id, 'click', { ref: Number(args?.ref) }, { signal: ctx?.signal });
            return r.label + ' — проверьте результат новым browser_snapshot или скриншотом.';
        }),
    },
    {
        name: 'browser_type',
        risk: 'write',
        description: 'Ввести текст в поле [ref] (латиница и кириллица — через вставку, раскладка не важна). Пароли — только browser_fill_secret, не этим инструментом. submit:true — нажать Enter после.',
        parameters: {
            type: 'object',
            properties: {
                ...NAME_PROP,
                ref: { type: 'integer' },
                text: { type: 'string', description: 'Текст (не пароль!)' },
                submit: { type: 'boolean', description: 'Нажать Enter после ввода' },
            },
            required: ['ref', 'text'],
        },
        run: ctxRun('browser_type', async (args, ctx) => {
            const { docker, pc } = await useBrowser(args, ctx);
            const r = await cdp(docker, pc.id, 'type', { ref: Number(args?.ref), text: String(args?.text ?? ''), submit: !!args?.submit }, { signal: ctx?.signal });
            return r.label + ' — проверьте результат снимком или скриншотом.';
        }),
    },
    {
        name: 'browser_select',
        risk: 'write',
        description: 'Выбрать вариант в списке [ref] (select): value — значение или видимый текст варианта.',
        parameters: {
            type: 'object',
            properties: { ...NAME_PROP, ref: { type: 'integer' }, value: { type: 'string' } },
            required: ['ref', 'value'],
        },
        run: ctxRun('browser_select', async (args, ctx) => {
            const { docker, pc } = await useBrowser(args, ctx);
            const r = await cdp(docker, pc.id, 'select', { ref: Number(args?.ref), value: String(args?.value ?? '') }, { signal: ctx?.signal });
            return r.label + '.';
        }),
    },
    {
        name: 'browser_nav',
        risk: 'write',
        description: 'Назад (back) или обновить (reload) текущую страницу.',
        parameters: {
            type: 'object',
            properties: { ...NAME_PROP, action: { type: 'string', enum: ['back', 'reload'] } },
            required: ['action'],
        },
        run: ctxRun('browser_nav', async (args, ctx) => {
            const { docker, pc } = await useBrowser(args, ctx);
            const snap = await cdp(docker, pc.id, 'nav', { action: args?.action }, { signal: ctx?.signal });
            noteDomain(ctx, snap?.url);
            return fmtSnapshot(snap);
        }),
    },
    {
        name: 'browser_secrets',
        readonly: true,
        description: 'Какие логины/пароли сохранены для ввода в браузер (только имена, не значения). Секрет создаёт человек файлом USERS/<uid>/$user/#secret/browser/<имя>.json с {"value": "..."}.',
        parameters: { type: 'object', properties: {} },
        run: ctxRun('browser_secrets', async (args, ctx) => {
            const names = listSecrets(ownerOf(ctx));
            return names.length ? 'Сохранённые секреты (имена для browser_fill_secret):\n' + names.map(n => '- ' + n).join('\n') : 'Секретов нет.';
        }),
    },
    {
        name: 'browser_fill_secret',
        risk: 'write',
        permission: (args, ctx) => {
            // первое использование секрета на этом компьютере — всегда с подтверждением
            const key = ownerOf(ctx) + '/' + computerName(args?.name) + '/' + String(args?.secret || '');
            if (secretApprovals.get(key) === currentDomain(ctx))
                return { verdict: 'allow' };
            return {
                verdict: 'ask', noAlways: true, hideArgs: true,
                reason: 'ввести сохранённый секрет «' + args?.secret + '» в поле [' + args?.ref + '] (первый раз — подтверждение, значение модель не видит)',
            };
        },
        description: 'Ввести сохранённый пароль/логин в поле [ref]. Значение берётся из #secret и никогда не показывается модели — знает только имя. Первый раз — с подтверждением человека.',
        parameters: {
            type: 'object',
            properties: { ...NAME_PROP, ref: { type: 'integer' }, secret: { type: 'string', description: 'Имя секрета (см. browser_secrets)' } },
            required: ['ref', 'secret'],
        },
        run: ctxRun('browser_fill_secret', async (args, ctx) => {
            const { docker, pc, owner, name } = await useBrowser(args, ctx);
            const value = readSecret(owner, args?.secret);
            try {
                const r = await cdp(docker, pc.id, 'type',
                    { ref: Number(args?.ref), fromEnv: SECRET_ENV, submit: false },
                    { env: [SECRET_ENV + '=' + value], signal: ctx?.signal });
                secretApprovals.set(owner + '/' + name + '/' + args?.secret, currentDomain(ctx));
                return 'Секрет «' + args?.secret + '» введён в [' + args?.ref + '] (' + r.chars + ' символов) — проверьте снимком, что форма приняла значение.';
            }
            finally {
                // значение жило только в окружении одного exec — дополнительно не чистим
            }
        }),
    },
];

/** Последний известный домен компьютера (для подтверждения секретов). */
const lastDomain = new Map();
export function currentDomain(ctx) {
    return lastDomain.get(ownerOf(ctx) + '/' + computerName(ctx?.entry?.args?.name)) || '';
}
export function noteDomain(ctx, url) {
    try {
        const host = new URL(String(url)).host;
        if (host)
            lastDomain.set(ownerOf(ctx) + '/' + computerName(ctx?.entry?.args?.name), host);
    }
    catch { /* не URL */ }
}

/** Доступ к чужому компьютеру — только админу (для UI/расширений). */
export async function adminComputer(ctx, owner, name) {
    if (owner === ownerOf(ctx))
        return { owner, admin: false };
    if (!(await isAdmin(ctx?.session)))
        throw new Error('чужой компьютер — нужен ADMIN');
    const docker = await getDocker();
    const found = await findComputer(docker, owner, computerName(name));
    if (!found)
        throw new Error('компьютера нет');
    return { owner, admin: true, id: found.id, docker };
}
