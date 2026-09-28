/**
 * Инструменты работы с деревом WORK (серверный объектный API).
 * Все вызовы идут с session пользователя — права проверяет ядро (assertAccess).
 */
import { clip, isAccessDenied } from '../util.js';
import { lineDiff } from '../diff.js';
import { FS } from '../../../server/index.js';

const ROLE_ORDER = ['ADMIN', 'BOSS', 'USER', 'GUEST'];
const READ_LINES = 2000;
const LINE_MAX = 2000;

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
 * Вызов метода элемента с правами пользователя.
 * Ядро проверяет права по params.role: пробуем без роли (админ WORK), затем роли пользователя в классе.
 * params создаётся заново на каждую попытку — методы ядра мутируют аргументы.
 */
export async function callAs(item, method, params, ctx, roleFirst) {
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
    const roles = roleFirst ? [roleFirst] : [undefined, ...(await rolesIn(item, session))];
    let lastErr;
    for (const role of roles) {
        try {
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

async function writeFile(path, content, ctx) {
    const { parent, filename, folder } = await resolveParent(path, ctx);
    const params = { filename, post: Buffer.isBuffer(content) ? content : String(content ?? '') };
    if (folder)
        params.folder = folder;
    // класс пишет в рабочую зону роли: берём сильнейшую роль, где запись разрешена
    const roles = await rolesIn(parent, ctx?.session);
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
    return realPathOf(log, absPath(path, ctx));
}

const target = key => args => absPath(args?.[key], null);

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
        name: 'write',
        risk: 'write',
        target: target('path'),
        description: 'Создать или целиком перезаписать файл. Файл в классе попадает в рабочую зону твоей роли; прежняя версия остаётся в истории. Для точечной правки существующего файла используй edit.',
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
                ctx.entry.diff = lineDiff(typeof before === 'string' ? before : '', String(args.content));
            }
            return (before == null ? 'создан ' : 'перезаписан ') + real + ' (' + String(args.content).length + ' символов)';
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
            await callAs(file, 'save', { post: out }, ctx);
            if (ctx.entry) {
                ctx.entry.path = file.path;
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
            if (DANGER_METHODS.has(m))
                return { verdict: 'ask', reason: 'метод ' + m + ' — опасная операция' };
            if (READ_METHOD.test(m))
                return { verdict: 'allow' };
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
            const a = args.args && typeof args.args === 'object' ? args.args : {};
            const res = await callAs(item, m, a, ctx);
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
            return list.slice(-200).map(r => {
                const t = r.time ? new Date(r.time).toISOString().replace('T', ' ').slice(0, 16) : '';
                return [t, r.sender, r.ext ? '[' + r.ext + ']' : '', r.path || '', r.content ? '— ' + clip(String(r.content), 300) : ''].filter(Boolean).join(' ');
            }).join('\n');
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

const READ_METHOD = /^(get_|list|read|load|info|find|search|fetch|logs|members|schema|services_schema|semantic_search|query_objects|rag_status|declared_roles|work_zone|roles|mcp_list_tools)/;
const DANGER_METHODS = new Set(['delete', 'npm', 'proxy', 'devModeToggle', 'save_secret', 'read_secret', 'clear_rag', 'send_push_notification', 'save', 'restore_from_history']);
const BLOCKED_METHODS = new Set(['constructor', 'execute', 'reset', 'fire', 'listen', 'assertAccess', 'canSee', 'canWrite', 'user_register_start', 'user_register_process', 'user_register_finish', 'user_login_start', 'user_login_finish']);
