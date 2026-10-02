/**
 * Инструменты работы с деревом WORK (серверный объектный API).
 * Все вызовы идут с session пользователя — права проверяет ядро (assertAccess).
 */
import { clip, isAccessDenied } from '../util.js';
import { lineDiff } from '../diff.js';
import { FS } from '../../../server/index.js';
import * as GATEWAY from '../../../server/access/gateway.js';

const ROLE_ORDER = ['ADMIN', 'BOSS', 'USER', 'GUEST'];
const READ_LINES = 2000;
const LINE_MAX = 2000;

/**
 * Методы записи, которые из .task всегда идут с mainContext задачи:
 * промежуточные записи остаются в журнале для аудита, но не становятся
 * отдельными карточками общей ленты. Значение из аргументов модели
 * не подменяет путь задачи.
 */
export const TASK_WRITE_METHODS = new Set(['save_message', 'save_files', 'save_file', 'save', 'edit', 'append']);

/** Принудительно привязать запись к задаче (для универсального call). */
export function forceTaskContext(method, args, ctx) {
    if (ctx?.task?.path && TASK_WRITE_METHODS.has(String(method || '')))
        args.mainContext = ctx.task.path;
    return args;
}

/** Абсолютный WORK-путь: относительный — от места задачи. */
export function absPath(p, ctx) {
    let s = String(p ?? '').trim().replace(/\\/g, '/');
    if (!s || s === '.')
        return ctx?.place?.path || '/';
    if (s.startsWith('/'))
        return s.replace(/\/+$/, '') || '/';
    const base = String(ctx?.place?.path || '').replace(/\/+$/, '');
    return (base + '/' + s).replace(/\/+/g, '/');
}

export async function getItem(path, ctx) {
    const p = absPath(path, ctx);
    let item = null;
    try {
        item = await WORK.get_item(p === '/' ? '' : p);
    }
    catch (e) {
        throw new Error('путь ' + p + ': ' + String(e.message || e));
    }
    if (Array.isArray(item))
        return item.length ? item : null;
    return item || null;
}

async function mustItem(path, ctx) {
    const item = await getItem(path, ctx);
    if (!item)
        throw new Error('не найдено: ' + absPath(path, ctx) + ' — проверь путь через ls');
    return item;
}

function classOf(item) {
    if (!item)
        return null;
    if (item instanceof FS.$class)
        return item;
    return item.$class || item.$parent || null;
}

/** Роли пользователя в классе, по убыванию силы. */
async function rolesIn(item, session) {
    const cls = classOf(item);
    if (!cls || !session || typeof cls.roles !== 'function')
        return [];
    try {
        // ядро уже упорядочивает роли по силе (базовые, затем прикладные — CUSTOMER и т.п.)
        const roles = await cls.roles({ session });
        return [...ROLE_ORDER.filter(r => roles.includes(r)), ...roles.filter(r => !ROLE_ORDER.includes(r))];
    }
    catch {
        return [];
    }
}

/**
 * Порядок ролей для действия в item с учётом роли задачи (ctx.role — «шляпа», в которой работает
 * пользователь): сначала она, затем другие его роли здесь. Не в роли ADMIN — никогда ADMIN и не
 * обход «администратор WORK» (без роли): агент не расширяет права сверх выбранной роли.
 * Без роли задачи (разовый запуск, REST) — прежний порядок: без роли, затем по силе.
 */
async function roleOrder(item, session, ctx) {
    const own = await rolesIn(item, session);
    const active = ctx?.role;
    if (!active)
        return [undefined, ...own];
    if (active === 'ADMIN')
        return [undefined, 'ADMIN', ...own.filter(r => r !== 'ADMIN')];
    return [active, ...own.filter(r => r !== active && r !== 'ADMIN')];
}

/**
 * Вызов метода элемента с правами пользователя.
 * Ядро проверяет права по params.role; порядок перебора ролей — roleOrder (роль задачи первой).
 * params создаётся заново на каждую попытку — методы ядра мутируют аргументы.
 */
export async function callAs(item, method, params, ctx, roleFirst, opts = {}) {
    const session = ctx?.session;
    const make = role => {
        const p = { ...params };
        if (session)
            p.session = session;
        if (role)
            p.role = role;
        return p;
    };
    // методы из class.js появляются на элементе после init (свежий элемент после рестарта)
    if (typeof item?.[method] !== 'function' && item?.init)
        await item.init;
    if (typeof item?.[method] !== 'function')
        throw new Error('у ' + (item?.path || '?') + ' нет метода ' + method);
    // явная роль тоже не выходит за роль задачи (кроме ADMIN-задачи)
    if (roleFirst === 'ADMIN' && ctx?.role && ctx.role !== 'ADMIN')
        throw new Error('Доступ запрещён: задача выполняется в роли ' + ctx.role + ', действие требует ADMIN');
    const roles = roleFirst ? [roleFirst] : await roleOrder(item, session, ctx);
    let lastErr;
    for (const role of roles) {
        try {
            if (opts.gateway)
                return await GATEWAY.invoke(item, method, make(role), { transport: 'agent' });
            return await item[method](make(role));
        }
        catch (e) {
            if (!isAccessDenied(e))
                throw e;
            lastErr = e;
        }
    }
    throw lastErr || new Error('Доступ запрещён');
}

function kindOf(item) {
    if (item instanceof FS.$file)
        return 'файл';
    if (item instanceof FS.$class)
        return 'класс ' + (item.type || '$class');
    return item === globalThis.WORK ? 'корень WORK' : 'папка';
}

function isContainer(item) {
    return !(item instanceof FS.$file);
}

async function lineFor(item) {
    const kind = kindOf(item);
    const label = item?.DATA?.label || item?.label;
    const name = item.id + (isContainer(item) ? '/' : '');
    let extra = '';
    if (!isContainer(item)) {
        const size = item.stat?.size;
        if (size != null)
            extra = ' ' + formatSize(size);
    }
    return name + '  [' + kind + (label && label !== item.id ? ' «' + label + '»' : '') + ']' + extra;
}

function formatSize(n) {
    if (n < 1024)
        return n + ' B';
    if (n < 1024 * 1024)
        return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

async function listTree(item, depth, indent, out, limit) {
    let kids = [];
    try {
        await item.init;
        kids = (await item.items) || [];
    }
    catch { /* нет доступа/не папка */ }
    kids = kids.filter(k => k && k.id && k.id !== 'node_modules');
    for (const k of kids) {
        if (out.length >= limit) {
            out.push(indent + '… (ещё есть — сузь путь)');
            return;
        }
        try {
            await k.init;
        }
        catch { /* покажем без DATA */ }
        out.push(indent + await lineFor(k));
        if (depth > 1 && isContainer(k))
            await listTree(k, depth - 1, indent + '  ', out, limit);
    }
}

async function describeClass(item, ctx) {
    const lines = [];
    await item.init;
    lines.push('# ' + item.path + '  [' + kindOf(item) + ']');
    if (item.DATA?.label)
        lines.push('label: ' + item.DATA.label);
    try {
        const chain = await item.type_chain;
        if (chain?.length)
            lines.push('цепочка типов: ' + chain.join(' → '));
    }
    catch { /* нет цепочки */ }
    try {
        const meta = item.meta_folder;
        if (meta) {
            const files = ((await meta.items) || []).map(f => f.id + (isContainer(f) ? '/' : ''));
            lines.push('метапапка ' + meta.path + ': ' + (files.join(', ') || '—'));
        }
    }
    catch { /* нет метапапки */ }
    try {
        const own = await item.meta_file;
        if (own) {
            const text = await own.load({ encoding: 'utf-8', session: ctx?.session });
            lines.push('\n## class.js (свой слой)\n```js\n' + clip(text, 6000) + '\n```');
        }
    }
    catch { /* нет class.js */ }
    try {
        const rm = await item.readme_merged?.();
        if (rm?.text)
            lines.push('\n## readme (собранный по ~, ближайший слой ' + rm.path + ')\n' + clip(rm.text, 12000));
    }
    catch { /* нет readme */ }
    return lines.join('\n');
}

function numbered(text, offset = 1, limit = READ_LINES) {
    const all = String(text).replace(/\r\n/g, '\n').split('\n');
    const from = Math.max(1, Number(offset) || 1);
    const slice = all.slice(from - 1, from - 1 + (Number(limit) || READ_LINES));
    const body = slice.map((l, i) => String(from + i).padStart(5) + '\t' + (l.length > LINE_MAX ? l.slice(0, LINE_MAX) + '…' : l)).join('\n');
    const rest = all.length - (from - 1 + slice.length);
    return body + (rest > 0 ? '\n… ещё ' + rest + ' строк (offset=' + (from + slice.length) + ')' : '');
}

async function loadText(file, ctx) {
    try {
        return await callAs(file, 'read_text', {}, ctx);
    }
    catch (e) {
        if (isAccessDenied(e))
            throw e;
        return callAs(file, 'load', { encoding: 'utf-8' }, ctx);
    }
}

/** Родитель по пути и имя листа; недостающие промежуточные папки → folder для save_file. */
async function resolveParent(path, ctx) {
    const p = absPath(path, ctx);
    const parts = p.split('/').filter(Boolean);
    const filename = parts.pop();
    if (!filename)
        throw new Error('нужен путь файла');
    const missing = [];
    let parent = null;
    while (parts.length) {
        parent = await getItem('/' + parts.join('/'), ctx);
        if (parent && !Array.isArray(parent))
            break;
        missing.unshift(parts.pop());
        parent = null;
    }
    if (!parent)
        parent = WORK;
    return { parent, filename, folder: missing.join('/') || undefined, path: p };
}

export async function writeFile(path, content, ctx, extra = {}) {
    const { parent, filename, folder } = await resolveParent(path, ctx);
    const params = { ...extra, filename, post: Buffer.isBuffer(content) ? content : String(content ?? '') };
    // Файлы, созданные инструментами задачи, принадлежат её контексту: в общей ленте
    // показываются только опубликованные через publish результаты, а не каждая версия.
    if (params.mainContext == null && ctx?.task?.path)
        params.mainContext = ctx.task.path;
    if (folder)
        params.folder = folder;
    // класс пишет в рабочую зону роли: роль задачи первой, затем другие роли пользователя здесь
    // (не в ADMIN-задаче — без ADMIN: иначе файлы уходят в зону администратора)
    const roles = (await roleOrder(parent, ctx?.session, ctx)).filter(Boolean);
    if (parent instanceof FS.$class && roles.length) {
        let last;
        for (const role of roles) {
            try {
                return await callAs(parent, 'save_file', params, ctx, role);
            }
            catch (e) {
                if (!isAccessDenied(e))
                    throw e;
                last = e;
            }
        }
        throw last;
    }
    return callAs(parent, 'save_file', params, ctx);
}

function realPathOf(log, fallback) {
    const p = log?.logFullPath || log?.path;
    if (!p)
        return fallback;
    // history-снимок → путь самого файла: …/.name/history/DAY/snap → …/name
    const m = String(p).match(/^(.*)\/\.([^/]+)\/history\/[^/]+\/[^/]+$/);
    return m ? m[1] + '/' + m[2] : p;
}

/** Записать бинарный файл (картинка и т.п.) → фактический путь. */
export async function writeBinary(path, buffer, ctx) {
    const log = await writeFile(path, buffer, ctx);
    if (ctx?.entry)
        ctx.entry.snapshot = log?.logFullPath || log?.path || undefined;
    return realPathOf(log, absPath(path, ctx));
}

const target = key => args => absPath(args?.[key], null);

/** Получатели по uid или ФИО (однозначное совпадение среди пользователей сервера). */
export async function resolvePeople(list) {
    const names = (Array.isArray(list) ? list : String(list || '').split(',')).map(s => String(s).trim()).filter(Boolean);
    if (!names.length)
        return [];
    if (names.length > 50)
        throw new Error('слишком много получателей (до 50)');
    const users = (await (await WORK.$users)?.items) || [];
    await Promise.all(users.map(u => u.init));
    const out = [];
    for (const name of names) {
        const low = name.toLowerCase();
        let hits = users.filter(u => u.id === name.toUpperCase());
        if (!hits.length)
            hits = users.filter(u => String(u.DATA?.label || u.label || '').toLowerCase() === low);
        if (!hits.length)
            hits = users.filter(u => String(u.DATA?.label || u.label || '').toLowerCase().includes(low));
        if (hits.length !== 1)
            throw new Error('получатель «' + name + '»: ' + (hits.length ? 'неоднозначно — ' + hits.map(u => (u.DATA?.label || u.id) + ' [' + u.id + ']').join(', ') : 'не найден') + ' (укажи uid)');
        const u = hits[0];
        if (!out.some(x => x.id === u.id))
            out.push({ id: u.id, label: u.DATA?.label || u.label || u.id });
    }
    return out;
}

export const workTools = [
    {
        name: 'ls',
        readonly: true,
        description: 'Содержимое класса или папки WORK: дочерние классы, папки, файлы (с типом и label). Начинай осмотр отсюда.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь (например /BASE); по умолчанию — место задачи' },
                depth: { type: 'integer', description: 'Глубина 1–3 (по умолчанию 1)' },
            },
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item))
                return item.map(i => i.path).join('\n');
            await callAs(item, 'assertAccess', {}, ctx).catch(e => { if (isAccessDenied(e)) throw e; });
            if (!isContainer(item))
                return await lineFor(item);
            const out = [item.path + '  [' + kindOf(item) + ']'];
            await listTree(item, Math.min(3, Math.max(1, Number(args.depth) || 1)), '  ', out, 300);
            if (out.length === 1)
                out.push('  (пусто)');
            return out.join('\n');
        },
    },
    {
        name: 'read',
        readonly: true,
        description: 'Прочитать файл (текст с номерами строк; docx/xlsx/pdf извлекаются в текст) или описание класса (тип, свой class.js, собранный readme — контракт места). Путь с ~ (например /BASE/~/readme.md) — сборка слоёв наследования.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла или класса' },
                offset: { type: 'integer', description: 'Первая строка (с 1)' },
                limit: { type: 'integer', description: 'Сколько строк (по умолчанию 2000)' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item)) {
                const files = item.filter(f => f instanceof FS.$file);
                if (!files.length)
                    return item.map(i => i.path).join('\n');
                const merger = WORK.constructor;
                const isJs = files[0].id.endsWith('.js');
                const text = isJs ? await merger.mergeFiles(files) : await merger.mergeTextFiles(files);
                ctx.entry && (ctx.entry.path = absPath(args.path, ctx));
                return 'Сборка слоёв: ' + files.map(f => f.path).join(' → ') + '\n\n' + numbered(text, args.offset, args.limit);
            }
            if (ctx.entry)
                ctx.entry.path = item.path;
            if (isContainer(item))
                return describeClass(item, ctx);
            const text = await loadText(item, ctx);
            if (typeof text !== 'string')
                return '[бинарный файл ' + item.path + ', ' + formatSize(item.stat?.size || 0) + ']';
            if (!text.length)
                return '(пустой файл)';
            return numbered(text, args.offset, args.limit);
        },
    },
    {
        name: 'find',
        readonly: true,
        description: 'Поиск внутри поддерева: по содержимому файлов (text или regex) либо по имени элементов (name с * и ?).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Где искать (по умолчанию место задачи)' },
                text: { type: 'string', description: 'Подстрока в содержимом' },
                regex: { type: 'string', description: 'Регулярное выражение по строкам содержимого' },
                name: { type: 'string', description: 'Маска имени элемента, например *.md или отчет*' },
                ext: { type: 'string', description: 'Фильтр расширений через запятую: md,js' },
                limit: { type: 'integer', description: 'Максимум результатов (по умолчанию 100)' },
            },
        },
        async run(args, ctx) {
            const root = await mustItem(args.path, ctx);
            const limit = Math.min(500, Number(args.limit) || 100);
            if (args.name) {
                const re = new RegExp('^' + String(args.name).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
                const out = [];
                const walk = async (it, level) => {
                    if (out.length >= limit || level > 8)
                        return;
                    let kids = [];
                    try {
                        kids = (await it.items) || [];
                    }
                    catch { return; }
                    for (const k of kids) {
                        if (out.length >= limit)
                            return;
                        if (re.test(k.id))
                            out.push(k.path + (isContainer(k) ? '/' : ''));
                        if (isContainer(k) && k.id !== 'node_modules')
                            await walk(k, level + 1);
                    }
                };
                await walk(root, 0);
                return out.length ? out.join('\n') : 'ничего не найдено';
            }
            if (!args.text && !args.regex)
                throw new Error('нужен text, regex или name');
            const res = await callAs(root, 'find_text', {
                text: args.text || args.regex,
                regex: args.regex || undefined,
                ext: args.ext ? String(args.ext).split(',').map(s => s.trim()).filter(Boolean) : undefined,
                limit,
            }, ctx);
            if (!res?.length)
                return 'ничего не найдено';
            return res.map(r => r.path + ':' + r.line + ': ' + r.text).join('\n');
        },
    },
    {
        name: 'search',
        readonly: true,
        description: 'Смысловой поиск (RAG) по документам, объектам данных и своей ленте — только то, что доступно пользователю; сначала место задачи, затем соседние точки организации. Для точных строк и имён — find.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Что найти, своими словами' },
                path: { type: 'string', description: 'Точка, от которой искать (по умолчанию место задачи)' },
                k: { type: 'integer', description: 'Сколько фрагментов (по умолчанию 8, максимум 30)' },
                kinds: { type: 'string', description: 'Виды через запятую: file, object, log, class' },
                rings: { type: 'integer', description: 'Насколько широко расходиться по дереву (0 — только точка; по умолчанию 3)' },
            },
            required: ['query'],
        },
        async run(args, ctx) {
            const point = await mustItem(args.path, ctx);
            if (Array.isArray(point))
                throw new Error('search: укажи точку без ~ (класс или папку)');
            const res = await callAs(point, 'semantic_search', {
                prompt: args.query,
                k: Math.min(30, Number(args.k) || 8),
                kinds: args.kinds || undefined,
                rings: args.rings,
            }, ctx);
            const rows = res?.results || [];
            if (!rows.length)
                return 'ничего не найдено' + (res?.pending ? ' (индексация ещё идёт: ' + res.pending + ' в очереди)' : '');
            const out = rows.map((r, i) => {
                const where = [r.kind, r.role && 'роль ' + r.role, r.point && r.point !== point.path && 'точка ' + r.point]
                    .filter(Boolean).join(', ');
                return (i + 1) + '. ' + r.path + (r.heading ? ' › ' + r.heading : '') + '  [' + where + ']\n'
                    + clip(r.text, 1200);
            });
            if (res.pending)
                out.push('(индексация ещё идёт: ' + res.pending + ' в очереди)');
            return out.join('\n\n');
        },
    },
    {
        name: 'access',
        readonly: true,
        description: 'Права на элемент WORK: область (зона роли / система / лента / секреты), какие роли точки его читают и меняют, кто назначен на эти роли (локально и сверху), твои роли здесь. Для аудита доступа и объяснения отказов.',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'WORK-путь элемента (по умолчанию место задачи)' } },
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            const target = Array.isArray(item) ? item.at(-1) : item;
            const point = target instanceof FS.$class ? target : classOf(target);
            if (!point)
                throw new Error('access: нет класса-владельца');
            await callAs(point, 'assertAccess', {}, ctx).catch(e => { if (isAccessDenied(e)) throw e; });
            const { POLICY } = FS.$class;
            await point.init;
            const declared = await point.declared_roles;
            const area = point.areaOf(target);
            const rows = [];
            for (const [id, role] of Object.entries(declared)) {
                const local = point._roleIds(id, declared).filter(u => u !== 'GUEST');
                const inherited = [];
                if (role.scope === 'subtree')
                    for (let p = point.$parent; p; p = p.$parent)
                        if (p instanceof FS.$class) {
                            await p.init;
                            const pd = p._declaredRolesSync();
                            if (pd[id])
                                inherited.push(...p._roleIds(id, pd).map(u => u + ' (из ' + (p.path || '/') + ')'));
                        }
                rows.push({
                    role: id, label: role.label, scope: role.scope, feed: role.feed, write: role.write,
                    principals: role.principals,
                    read: POLICY.canRead(role, area, { logsContainer: !(target instanceof FS.$file) }),
                    change: POLICY.canWrite(role, area, { local: true, executable: POLICY.isExecutablePath(target.path, point.path) }),
                    assigned: local, inherited,
                });
            }
            const open = (point.DATA?.['#security']?.USERS || []).includes('GUEST');
            return JSON.stringify({
                path: target.path, point: point.path || '/', area,
                openToAll: open || undefined,
                yourRoles: await point.roles({ session: ctx?.session }),
                roles: rows,
                note: 'Плюс видят: WORK ADMIN (всё), владельцы лент, в которых есть запись с этим путём (receivers). Системные пути /$server, /sources, /oda видны всем.',
            }, null, 1);
        },
    },
    {
        name: 'assign',
        risk: 'write',
        target: args => absPath(String(args?.path || '') + '/class.js', null),
        description: 'Назначить или снять пользователей (или узлы сети) на роль класса: меняет только #security собственного class.js. Роль — объявленная в точке (ADMIN, BOSS, USER, GUEST, прикладные). Требует прав администратора.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь класса' },
                role: { type: 'string', description: 'Роль (USER, BOSS, CUSTOMER…)' },
                add: { type: 'array', items: { type: 'string' }, description: 'Кого назначить: uid, ФИО или id узла сети' },
                remove: { type: 'array', items: { type: 'string' }, description: 'Кого снять' },
            },
            required: ['path', 'role'],
        },
        async run(args, ctx) {
            const cls = await mustItem(args.path, ctx);
            if (!(cls instanceof FS.$class))
                throw new Error('assign: ' + absPath(args.path, ctx) + ' — не класс');
            const declared = await cls.declared_roles;
            const role = declared[String(args.role || '').toUpperCase()];
            if (!role)
                throw new Error('роль «' + args.role + '» не объявлена в точке; есть: ' + Object.keys(declared).join(', '));
            const ids = async list => {
                const out = [];
                for (const x of list || []) {
                    const s = String(x).trim();
                    if (/^[0-9A-F]{15}$/i.test(s))
                        out.push(s.toUpperCase()); // узел сети
                    else
                        out.push(...(await resolvePeople([s])).map(p => p.id));
                }
                return out;
            };
            const add = await ids(args.add), remove = new Set(await ids(args.remove));
            if (!add.length && !remove.size)
                throw new Error('assign: нужен add или remove');
            if (add.some(u => /^[0-9A-F]{15}$/.test(u)) && !role.principals?.includes('node'))
                throw new Error('роль ' + role.id + ' нельзя выдать узлу сети');
            // только собственный слой (без склейки с предками — иначе наследуемое осело бы в class.js точки)
            const own = await cls.meta_file;
            const text = own ? await own.load({ encoding: 'utf-8', session: ctx?.session }) : '';
            const data = text ? (await FS.$class.importScript(String(text))) || {} : {};
            const copy = { ...data };
            const sec = { ...(copy['#security'] || {}) };
            const list = new Set([...(sec[role.key] || [])].filter(u => !remove.has(u)));
            for (const u of add)
                list.add(u);
            sec[role.key] = [...list];
            copy['#security'] = sec;
            await callAs(cls.meta_folder, 'save_file', {
                filename: 'class.js',
                post: 'export default ' + FS.$class.toScript(copy),
                message: 'роль ' + role.id + ': ' + [add.length ? '+' + add.join(',') : '', remove.size ? '−' + [...remove].join(',') : ''].filter(Boolean).join(' '),
            }, ctx, 'ADMIN');
            cls.reset();
            return 'роль ' + role.id + ' в ' + cls.path + ': ' + (sec[role.key].join(', ') || 'никого');
        },
    },
    {
        name: 'escalate',
        risk: 'write',
        description: 'Запросить у ответственного то, на что не хватает прав (доступ к точке/файлу, назначение роли, решение): находит руководителя точки (BOSS), выше по дереву — вышестоящего, иначе администратора, и отправляет ему поручение из кабинета пользователя. Используй после «Доступ запрещён», вместо попыток обойти отказ.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'К чему нужен доступ (WORK-путь)' },
                need: { type: 'string', description: 'Что нужно: read | write | role:<РОЛЬ> | decision' },
                reason: { type: 'string', description: 'Зачем — по-человечески, для ответственного' },
            },
            required: ['path', 'reason'],
        },
        async run(args, ctx) {
            const uid = ctx?.session?.uid;
            if (!uid || ctx.session.principal?.kind === 'node')
                throw new Error('escalate: только пользователь сервера');
            const p = absPath(args.path, ctx);
            // ближайший класс по пути (сам элемент может быть недоступен — идём по сегментам)
            const segs = p.split('/').filter(Boolean);
            let point = null;
            while (segs.length && !point) {
                const it = await WORK.get_item('/' + segs.join('/')).catch(() => null);
                const cls = Array.isArray(it) ? null : (it instanceof FS.$class ? it : it?.$class);
                if (cls && cls !== WORK)
                    point = cls;
                segs.pop();
            }
            point ??= WORK;
            await point.init;
            const pick = async list => (await list || []).map(u => u.id).filter(id => id && id !== uid);
            let to = await pick(point.bosses), whom = 'руководитель ' + (point.path || '/');
            if (!to.length) { to = await pick(point.allBosses); whom = 'вышестоящий руководитель'; }
            if (!to.length) { to = await pick(point.allAdmins); whom = 'администратор'; }
            if (!to.length) { to = await pick(WORK.admins); whom = 'администратор WORK'; }
            if (!to.length)
                throw new Error('escalate: не найден ответственный за ' + (point.path || '/'));
            let cab = await (await WORK.$users).get_item('//' + uid);
            if (Array.isArray(cab))
                cab = cab[0];
            const need = String(args.need || 'read');
            const row = await callAs(cab, 'save_message', {
                kind: 'order',
                receivers: to.slice(0, 5),
                message: 'Запрос: ' + need + ' — ' + p + '\nПричина: ' + String(args.reason).slice(0, 1500)
                    + '\n(Ответ: done — выполнено, reject — отказ.)',
            }, ctx);
            return 'запрос отправлен (' + whom + ': ' + to.slice(0, 5).join(', ') + '), id ' + row.id + '. Ответ придёт в ленту кабинета.';
        },
    },
    {
        name: 'send',
        risk: 'write',
        description: 'Записать в ленту точки сообщение или поручение и доставить его получателям (их кабинетам): текст, вложения (видимые тебе файлы WORK), срок. Поручение — kind:"order" с due; отчёт об исполнении — kind:"done" с reply_to (id поручения).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Точка (класс), в ленту которой пишется запись; по умолчанию место задачи' },
                message: { type: 'string', description: 'Текст' },
                to: { type: 'array', items: { type: 'string' }, description: 'Получатели: uid или ФИО/название пользователя' },
                kind: { type: 'string', enum: ['message', 'order', 'done', 'reject', 'remind'], description: 'Вид записи (по умолчанию message)' },
                due: { type: 'string', description: 'Срок YYYY-MM-DD (для order/remind)' },
                reply_to: { type: 'string', description: 'id записи, на которую это ответ (из результата send или ленты)' },
                includes: { type: 'array', items: { type: 'string' }, description: 'WORK-пути вложений' },
            },
            required: ['message'],
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            const cls = classOf(item) || item;
            if (typeof cls.save_message !== 'function')
                throw new Error('send: у ' + cls.path + ' нет ленты');
            const receivers = await resolvePeople(args.to || []);
            const row = await callAs(cls, 'save_message', {
                message: String(args.message),
                receivers: receivers.map(r => r.id),
                includes: (args.includes || []).map(p => absPath(p, ctx)),
                kind: args.kind || (args.due ? 'order' : 'message'),
                due: args.due, reply_to: args.reply_to,
            }, ctx);
            return 'записано в ленту ' + cls.path + ' (id ' + row.id + ')'
                + (receivers.length ? '; получатели: ' + receivers.map(r => r.label + ' [' + r.id + ']').join(', ') : '');
        },
    },
    {
        name: 'write_table',
        risk: 'write',
        target: target('path'),
        description: 'Сохранить таблицу (отчёт) файлом WORK: .xlsx (листы) или .csv. rows — массив объектов (ключи — колонки) или массив массивов (первая строка — заголовки).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла, например /BASE/Отчёты/продажи-2026-Q3.xlsx' },
                rows: { type: 'array', description: 'Строки таблицы (для одного листа)', items: {} },
                sheets: { type: 'object', description: 'Для xlsx с несколькими листами: {имяЛиста: rows}' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const ext = String(args.path || '').split('.').pop().toLowerCase();
            if (!['xlsx', 'csv'].includes(ext))
                throw new Error('write_table: расширение .xlsx или .csv');
            const sheets = args.sheets && typeof args.sheets === 'object' ? args.sheets : { 'Лист1': args.rows };
            const XLSX = await import('xlsx');
            const toSheet = rows => {
                if (!Array.isArray(rows) || !rows.length)
                    throw new Error('write_table: пустая таблица');
                if (rows.length > 100_000)
                    throw new Error('write_table: больше 100 000 строк');
                return Array.isArray(rows[0]) ? XLSX.utils.aoa_to_sheet(rows) : XLSX.utils.json_to_sheet(rows);
            };
            let buf;
            if (ext === 'csv') {
                const first = Object.values(sheets)[0];
                buf = Buffer.from('\uFEFF' + XLSX.utils.sheet_to_csv(toSheet(first)), 'utf-8');
            }
            else {
                const wb = XLSX.utils.book_new();
                for (const [name, rows] of Object.entries(sheets))
                    XLSX.utils.book_append_sheet(wb, toSheet(rows), String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Лист');
                buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            }
            const real = await writeBinary(args.path, buf, ctx);
            if (ctx.entry)
                ctx.entry.path = real;
            const req = absPath(args.path, ctx);
            return (real !== req ? 'сохранено ' + real + ' (запрошено ' + req + '; в классе файлы ложатся в зону роли — используй этот путь)' : 'сохранено ' + real)
                + ', ' + formatSize(buf.length);
        },
    },
    {
        name: 'write',
        risk: 'write',
        target: target('path'),
        description: 'Создать или целиком перезаписать файл. Файл в классе попадает в рабочую зону твоей роли; прежняя версия остаётся в истории. Большой HTML/текст не помещай в один вызов: создай начало через write и добавляй части через append. Для точечной правки существующего файла используй edit.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла, например /BASE/doc/отчёт.md' },
                content: { type: 'string', description: 'Полное содержимое' },
            },
            required: ['path', 'content'],
        },
        async run(args, ctx) {
            let before = null;
            const existing = await getItem(args.path, ctx).catch(() => null);
            if (existing && !Array.isArray(existing) && !isContainer(existing))
                before = await callAs(existing, 'load', { encoding: 'utf-8' }, ctx).catch(() => null);
            const log = await writeFile(args.path, args.content, ctx);
            const real = realPathOf(log, absPath(args.path, ctx));
            if (ctx.entry) {
                ctx.entry.path = real;
                ctx.entry.snapshot = log?.logFullPath || log?.path || undefined;
                ctx.entry.diff = lineDiff(typeof before === 'string' ? before : '', String(args.content));
            }
            const req = absPath(args.path, ctx);
            return (before == null ? 'создан ' : 'перезаписан ') + real + ' (' + String(args.content).length + ' символов)'
                + (real !== req ? '; запрошено ' + req + ' — в классе файлы ложатся в зону роли, дальше используй путь ' + real : '');
        },
    },
    {
        name: 'append',
        risk: 'write',
        target: target('path'),
        description: 'Добавить текст в конец существующего файла WORK. Для больших файлов: сначала write с началом, затем append частями по несколько тысяч символов. Используй фактический путь, возвращённый write. Каждый вызов сохраняет снимок в истории.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Фактический WORK-путь файла из результата write' },
                content: { type: 'string', description: 'Следующая часть текста, без повторения уже записанного' },
            },
            required: ['path', 'content'],
        },
        async run(args, ctx) {
            const file = await mustItem(args.path, ctx);
            if (Array.isArray(file) || isContainer(file))
                throw new Error('append — только для существующего файла; ' + absPath(args.path, ctx) + ' не файл');
            const before = await callAs(file, 'load', { encoding: 'utf-8' }, ctx);
            if (typeof before !== 'string')
                throw new Error('append — файл не текстовый');
            const chunk = String(args.content);
            const saveParams = { post: before + chunk };
            if (ctx?.task?.path)
                saveParams.mainContext = ctx.task.path;
            const log = await callAs(file, 'save', saveParams, ctx);
            if (ctx.entry) {
                ctx.entry.path = file.path;
                ctx.entry.snapshot = log?.logFullPath || log?.path || undefined;
                ctx.entry.diff = lineDiff(before, before + chunk);
            }
            return 'добавлено ' + chunk.length + ' символов в ' + file.path + ' (всего ' + (before.length + chunk.length) + ')';
        },
    },
    {
        name: 'edit',
        risk: 'write',
        target: target('path'),
        description: 'Точечная правка текстового файла: заменить old_string на new_string. old_string должен встречаться ровно один раз (или replace_all). Сначала прочитай файл через read.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла' },
                old_string: { type: 'string', description: 'Точный фрагмент для замены (с отступами)' },
                new_string: { type: 'string', description: 'Новый фрагмент' },
                replace_all: { type: 'boolean', description: 'Заменить все вхождения' },
            },
            required: ['path', 'old_string', 'new_string'],
        },
        async run(args, ctx) {
            const file = await mustItem(args.path, ctx);
            if (Array.isArray(file) || isContainer(file))
                throw new Error('edit — только для файла; ' + absPath(args.path, ctx) + ' не файл');
            const before = await callAs(file, 'load', { encoding: 'utf-8' }, ctx);
            if (typeof before !== 'string')
                throw new Error('файл не текстовый');
            const text = before.replace(/\r\n/g, '\n');
            const oldS = String(args.old_string).replace(/\r\n/g, '\n');
            if (!oldS)
                throw new Error('old_string пуст — для нового файла используй write');
            const count = text.split(oldS).length - 1;
            if (!count)
                throw new Error('old_string не найден в файле. Прочитай файл (read) и скопируй фрагмент точно, с отступами.');
            if (count > 1 && !args.replace_all)
                throw new Error('old_string встречается ' + count + ' раз — добавь контекста для однозначности или replace_all:true');
            const after = args.replace_all ? text.split(oldS).join(String(args.new_string)) : text.replace(oldS, () => String(args.new_string));
            const out = before.includes('\r\n') ? after.replace(/\n/g, '\r\n') : after;
            const saveParams = { post: out };
            if (ctx?.task?.path)
                saveParams.mainContext = ctx.task.path;
            const log = await callAs(file, 'save', saveParams, ctx);
            if (ctx.entry) {
                ctx.entry.path = file.path;
                ctx.entry.snapshot = log?.logFullPath || log?.path || undefined;
                ctx.entry.diff = lineDiff(text, after);
            }
            return 'изменён ' + file.path + ' (замен: ' + (args.replace_all ? count : 1) + ')';
        },
    },
    {
        name: 'create_class',
        risk: 'write',
        target: args => absPath(String(args?.parent || '') + '/' + String(args?.id || ''), null),
        description: 'Создать новый класс (узел структуры) внутри класса parent. Для обычного $class имя id — ЗАГЛАВНЫМИ. type — типизатор ($class, $group, $base, …: смотри контракт места через read). class_js — тело class.js (export default {...}).',
        parameters: {
            type: 'object',
            properties: {
                parent: { type: 'string', description: 'WORK-путь родительского класса' },
                id: { type: 'string', description: 'Имя класса' },
                type: { type: 'string', description: 'Типизатор, по умолчанию $class' },
                label: { type: 'string', description: 'Отображаемое имя' },
                class_js: { type: 'string', description: 'Содержимое class.js (необязательно)' },
            },
            required: ['parent', 'id'],
        },
        async run(args, ctx) {
            const parent = await mustItem(args.parent, ctx);
            if (!(parent instanceof FS.$class))
                throw new Error(absPath(args.parent, ctx) + ' — не класс: создать класс можно только внутри класса');
            const p = { id: args.id };
            if (args.type)
                p.type = args.type;
            if (args.label)
                p.label = args.label;
            if (args.class_js)
                p.post = args.class_js;
            await callAs(parent, 'create', p, ctx);
            const path = parent.path + '/' + args.id;
            if (ctx.entry)
                ctx.entry.path = path;
            return 'создан класс ' + path + (args.type ? ' (' + args.type + ')' : '');
        },
    },
    {
        name: 'schema',
        readonly: true,
        description: 'Методы элемента WORK (серверный API класса/файла) с описаниями и параметрами — чтобы затем вызвать через call.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item))
                throw new Error('путь дал несколько элементов — уточни');
            await item.init;
            const s = await callAs(item, 'get_schema', {}, ctx);
            const lines = [item.path + ' — ' + s.className];
            for (const m of s.methods || []) {
                if (!m?.name || m.name[0] === '_')
                    continue;
                const params = m.parameters?.properties
                    ? Object.entries(m.parameters.properties).map(([k, v]) => k + ((m.parameters.required || []).includes(k) ? '' : '?') + ': ' + (v.type || '')).join(', ')
                    : '';
                lines.push('- ' + m.name + '(' + params + ')' + (m.description ? ' — ' + String(m.description).split('\n')[0] : ''));
            }
            return lines.join('\n');
        },
    },
    {
        name: 'call',
        risk: 'write',
        target: target('path'),
        description: 'Вызвать серверный метод элемента WORK (см. schema): path + method + args. Для чтения, записи и бизнес-операций классов, для которых нет отдельного инструмента.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь элемента' },
                method: { type: 'string', description: 'Имя метода' },
                args: { type: 'object', description: 'Параметры метода (объект)' },
            },
            required: ['path', 'method'],
        },
        permission(args) {
            const m = String(args?.method || '');
            const level = GATEWAY.MEMBERS[m];
            if (DANGER_METHODS.has(m))
                return { verdict: 'ask', reason: 'метод ' + m + ' — опасная операция' };
            // чтение (в т.ч. security_log для ADMIN) — без вопроса; право проверит ядро
            if (READ_METHOD.test(m) || level === GATEWAY.LEVEL.READ)
                return { verdict: 'allow' };
            if (level === GATEWAY.LEVEL.ADMIN)
                return { verdict: 'ask', reason: 'метод ' + m + ' — операция администратора' };
            return null;
        },
        async run(args, ctx) {
            const m = String(args.method || '');
            if (!m || m[0] === '_' || m[0] === '#' || BLOCKED_METHODS.has(m))
                throw new Error('метод ' + m + ' недоступен агенту');
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item))
                throw new Error('путь дал несколько элементов — уточни');
            await item.init;
            // те же правила, что для HTTP: только объявленные методы, уровень доступа до вызова
            const member = GATEWAY.resolveMember(item, m);
            if (!member || member.level === GATEWAY.LEVEL.PUBLIC)
                throw new Error('метод ' + m + ' недоступен агенту');
            const a = args.args && typeof args.args === 'object' ? args.args : {};
            forceTaskContext(m, a, ctx);
            const res = await callAs(item, m, a, ctx, undefined, { gateway: true });
            if (res && typeof res === 'object' && typeof res.pipe === 'function')
                return '[поток данных — используй read]';
            if (res && typeof res === 'object' && res.path && res.constructor?.name?.startsWith?.('$'))
                return 'элемент ' + res.path;
            return res;
        },
    },
    {
        name: 'logs',
        readonly: true,
        description: 'Журнал событий класса (кто, что, когда сделал): даты с записями или записи за день/диапазон.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь класса (по умолчанию место задачи)' },
                day: { type: 'string', description: 'День YYYY-MM-DD' },
                from: { type: 'string', description: 'Начало диапазона YYYY-MM-DD' },
                to: { type: 'string', description: 'Конец диапазона YYYY-MM-DD' },
                dates: { type: 'boolean', description: 'Только список дат с записями' },
                limit: { type: 'integer', description: 'Сколько последних записей показать (по умолчанию 200, максимум 1000)' },
            },
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            const cls = classOf(item) || item;
            if (typeof cls.logs !== 'function')
                throw new Error('у ' + cls.path + ' нет журнала');
            if (args.dates)
                return callAs(cls, 'logs', { mode: 'dates' }, ctx);
            const q = { mode: 'bodies' };
            for (const k of ['day', 'from', 'to'])
                if (args[k])
                    q[k] = args[k];
            const rows = await callAs(cls, 'logs', q, ctx);
            const list = Array.isArray(rows) ? rows : (rows?.items || rows?.rows || []);
            if (!list.length)
                return 'записей нет' + (args.day ? ' за ' + args.day : '') + ' (попробуй dates:true)';
            // журнал отсортирован от новых к старым: берём последние события, выводим по времени
            const limit = Math.min(1000, Math.max(1, Number(args.limit) || 200));
            const shown = list.slice(0, limit).reverse();
            const head = list.length > limit
                ? 'показаны последние ' + limit + ' из ' + list.length + ' записей (сузь период или увеличь limit)\n'
                : 'записей: ' + list.length + '\n';
            return head + shown.map(r => {
                const t = r.time ? new Date(r.time).toISOString().replace('T', ' ').slice(0, 16) : '';
                const who = r.actor ? r.sender + ' (' + r.actor + ')' : r.sender;
                const to = r.receivers?.length ? '→ ' + [].concat(r.receivers).join(',') : '';
                const meta = [r.kind && r.kind !== 'message' ? r.kind : '', r.due ? 'срок ' + r.due : '', r.reply_to ? 'на ' + r.reply_to : '']
                    .filter(Boolean).join(', ');
                const id = r.sender && r.time ? '#' + r.sender + ':' + r.time : '';
                return [t, id, who, to, meta ? '{' + meta + '}' : '', r.ext ? '[' + r.ext + ']' : '', r.path || '', r.content ? '— ' + clip(String(r.content), 300) : ''].filter(Boolean).join(' ');
            }).join('\n');
        },
    },
    {
        name: 'query',
        readonly: true,
        description: 'Структурный запрос к объектам данных (.data, .eml, .ics, .task…) с правами пользователя: фильтр по полям, до 500 объектов. Для подсчётов, отчётов, выборок. Смысловой поиск — search.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Точка, от которой искать (по умолчанию место задачи)' },
                type: { type: 'string', description: 'Расширение типа объектов: data, eml, ics, task…' },
                where: { type: 'object', description: 'Условия по полям: {поле: значение} или {поле: {eq|ne|gt|gte|lt|lte|contains|in: …}}' },
                limit: { type: 'integer', description: 'Максимум объектов (по умолчанию 100, до 500)' },
                rings: { type: 'integer', description: 'Насколько широко по дереву (0 — только точка; по умолчанию 3)' },
            },
        },
        async run(args, ctx) {
            const point = await mustItem(args.path, ctx);
            if (Array.isArray(point))
                throw new Error('query: укажи точку без ~');
            const rows = await callAs(point, 'query_objects', {
                type: args.type, where: args.where, rings: args.rings,
                limit: Math.min(500, Number(args.limit) || 100),
            }, ctx);
            if (!rows?.length)
                return 'объектов не найдено (индекс мог ещё не обработать данные — call rag_status)';
            return JSON.stringify(rows, null, 1);
        },
    },
    {
        name: 'history',
        readonly: true,
        description: 'Версии файла (снимки истории) — для сравнения и отката.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const file = await mustItem(args.path, ctx);
            if (isContainer(file))
                throw new Error('история есть у файлов');
            const hist = await file.storage_folder?.get_item?.('history');
            if (!hist)
                return 'истории нет';
            const out = [];
            for (const day of (await hist.children) || []) {
                for (const snap of (await day.children) || [])
                    out.push(snap.path);
            }
            return out.length ? out.sort().reverse().slice(0, 50).join('\n') + '\n(откат: restore с path снимка)' : 'истории нет';
        },
    },
    {
        name: 'restore',
        risk: 'write',
        target: args => String(args?.snapshot || '').replace(/\/\.([^/]+)\/history\/.*$/, '/$1'),
        description: 'Откатить файл к снимку истории (путь из history).',
        parameters: {
            type: 'object',
            properties: {
                snapshot: { type: 'string', description: 'WORK-путь снимка из history' },
            },
            required: ['snapshot'],
        },
        async run(args, ctx) {
            const snap = await mustItem(args.snapshot, ctx);
            await callAs(snap, 'restore_from_history', {}, ctx);
            return 'восстановлено из ' + snap.path;
        },
    },
    {
        name: 'delete',
        risk: 'danger',
        target: target('path'),
        description: 'Удалить файл или элемент (необратимо, спросит человека).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item))
                throw new Error('путь дал несколько элементов — уточни');
            return callAs(item, 'delete', {}, ctx);
        },
    },
];

const READ_METHOD = /^(get_|list|read|load|info|find|search|fetch|logs|members|schema|services_schema|semantic_search|query_objects|rag_status|declared_roles|work_zone|roles|mcp_list_tools|security_log|network_graph|assignedUsers|allAdmins|allBosses)/;
const DANGER_METHODS = new Set(['delete', 'npm', 'proxy', 'devModeToggle', 'save_secret', 'read_secret', 'clear_rag', 'send_push_notification', 'save', 'restore_from_history']);
const BLOCKED_METHODS = new Set(['constructor', 'execute', 'reset', 'fire', 'listen', 'assertAccess', 'canSee', 'canWrite', 'user_register_start', 'user_register_process', 'user_register_finish', 'user_login_start', 'user_login_finish']);
