/**
 * Общие вызовы инструментов дерева WORK (hardening 4.4: расщепление tools/work.js).
 * Пути и роли (callAs, roleOrder), разрешение путей (absPath, getItem, mustItem),
 * запись файлов (writeFile/writeBinary, undo-трекинг), описания классов — для
 * ./fs.js, ./data.js, ./access.js, ./feed.js и реэкспорта ../work.js.
 */
import { log } from '../../log.js';
import { clip, isAccessDenied } from '../../util.js';
import { beforeWrite, recordWrite } from '../../undo.js';
import { FS } from '../../../../server/index.js';
import * as GATEWAY from '../../../../server/access/gateway.js';

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
    let item;
    try {
        item = await WORK.get_item(p === '/' ? '' : p);
    }
    catch (e) {
        throw new Error('путь ' + p + ': ' + String(e.message || e), { cause: e });
    }
    if (Array.isArray(item))
        return item.length ? item : null;
    return item || null;
}

export async function mustItem(path, ctx) {
    const item = await getItem(path, ctx);
    if (!item)
        throw new Error('не найдено: ' + absPath(path, ctx) + ' — проверь путь через ls');
    return item;
}

export function classOf(item) {
    if (!item)
        return null;
    if (item instanceof FS.$class)
        return item;
    return item.$class || item.$parent || null;
}

/** Роли пользователя в классе, по убыванию силы. */
export async function rolesIn(item, session) {
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
export async function roleOrder(item, session, ctx) {
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

export function kindOf(item) {
    if (item instanceof FS.$file)
        return 'файл';
    if (item instanceof FS.$class)
        return 'класс ' + (item.type || '$class');
    return item === globalThis.WORK ? 'корень WORK' : 'папка';
}

export function isContainer(item) {
    return !(item instanceof FS.$file);
}

export async function lineFor(item) {
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

export function formatSize(n) {
    if (n < 1024)
        return n + ' B';
    if (n < 1024 * 1024)
        return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export async function listTree(item, depth, indent, out, limit) {
    let kids = [];
    try {
        await item.init;
        kids = (await item.items) || [];
    }
    catch (e) { log.debug('tree.items', e); /* нет доступа/не папка */ }
    kids = kids.filter(k => k && k.id && k.id !== 'node_modules');
    for (const k of kids) {
        if (out.length >= limit) {
            out.push(indent + '… (ещё есть — сузь путь)');
            return;
        }
        try {
            await k.init;
        }
        catch (e) { log.debug('tree.init', e); /* покажем без DATA */ }
        out.push(indent + await lineFor(k));
        if (depth > 1 && isContainer(k))
            await listTree(k, depth - 1, indent + '  ', out, limit);
    }
}

export async function describeClass(item, ctx) {
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
    catch (e) { log.debug('schema.chain', e); /* нет цепочки */ }
    try {
        const meta = item.meta_folder;
        if (meta) {
            const files = ((await meta.items) || []).map(f => f.id + (isContainer(f) ? '/' : ''));
            lines.push('метапапка ' + meta.path + ': ' + (files.join(', ') || '—'));
        }
    }
    catch (e) { log.debug('schema.meta', e); /* нет метапапки */ }
    try {
        const own = await item.meta_file;
        if (own) {
            const text = await own.load({ encoding: 'utf-8', session: ctx?.session });
            lines.push('\n## class.js (свой слой)\n```js\n' + clip(text, 6000) + '\n```');
        }
    }
    catch (e) { log.debug('schema.class', e); /* нет class.js */ }
    try {
        const rm = await item.readme_merged?.();
        if (rm?.text)
            lines.push('\n## readme (собранный по ~, ближайший слой ' + rm.path + ')\n' + clip(rm.text, 12000));
    }
    catch (e) { log.debug('schema.readme', e); /* нет readme */ }
    return lines.join('\n');
}

export function numbered(text, offset = 1, limit = READ_LINES) {
    const all = String(text).replace(/\r\n/g, '\n').split('\n');
    const from = Math.max(1, Number(offset) || 1);
    const slice = all.slice(from - 1, from - 1 + (Number(limit) || READ_LINES));
    const body = slice.map((l, i) => String(from + i).padStart(5) + '\t' + (l.length > LINE_MAX ? l.slice(0, LINE_MAX) + '…' : l)).join('\n');
    const rest = all.length - (from - 1 + slice.length);
    return body + (rest > 0 ? '\n… ещё ' + rest + ' строк (offset=' + (from + slice.length) + ')' : '');
}

export async function loadText(file, ctx) {
    try {
        return await callAs(file, 'read_text', {}, ctx);
    }
    catch (e) {
        if (isAccessDenied(e))
            throw e;
        return callAs(file, 'load', { encoding: 'utf-8' }, ctx);
    }
}

/**
 * R15 (8.38): пометить ход untrusted, если в результатах чтения чужой файл:
 * письмо (.eml) или файл, пришедший извне (загрузка из формы, скачивание по URL —
 * server/external-source.js). Ставят все читатели: read, find, search (RAG-куски),
 * read_table, import_objects, grep (dev/search.js) — содержимое читается как чужой текст
 * (<untrusted> + заражение хода, taint.js), действия наружу после него — с подтверждения.
 * @param {Array<string>} paths WORK-пути прочитанного
 */
export async function markUntrustedByPaths(paths, ctx) {
    if (!ctx?.entry || !paths?.length)
        return;
    const list = paths.map(p => String(p || '')).filter(Boolean);
    if (list.some(p => /\.eml$/i.test(p))) {
        ctx.entry.untrusted = true;
        return;
    }
    try {
        const { externalSourceOf } = await import('../../../../server/external-source.js');
        for (const p of list) {
            if (await externalSourceOf(p)) {
                ctx.entry.untrusted = true;
                return;
            }
        }
    }
    catch { /* реестра нет — не заражаем */ }
}

/** Родитель по пути и имя листа; недостающие промежуточные папки → folder для save_file. */
export async function resolveParent(path, ctx) {    const p = absPath(path, ctx);
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
    // коррекция: если родитель — папка-тип рабочей зоны, а расширение файла относится к другому типу,
    // поднимаем к классу — пусть class.save_file + getFolderToSaveFile положат файл в правильную папку
    const corrected = correctTypeFolder(parent, filename);
    if (corrected) {
        const roles = (await roleOrder(corrected.parent, ctx?.session, ctx)).filter(Boolean);
        if (corrected.parent instanceof FS.$class && roles.length) {
            let last;
            for (const role of roles) {
                try {
                    const p2 = { ...params, folder: corrected.folder };
                    return await callAs(corrected.parent, 'save_file', p2, ctx, role);
                }
                catch (e) {
                    if (!isAccessDenied(e))
                        throw e;
                    last = e;
                }
            }
            if (last)
                throw last;
        }
        return callAs(corrected.parent, 'save_file', { ...params, folder: corrected.folder }, ctx);
    }
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

/** MIME top-level папки, которые getFolderToSaveFile использует для маршрутизации. */
export const MIME_TOP_FOLDERS = new Set(['text', 'image', 'video', 'audio']);

/** Каноническая папка для расширения (правила getFolderToSaveFile). */
export function canonicalFolder(name) {
    const ext = FS.$file.fileExt(name);
    if (!ext)
        return null;
    const mime = typeof globalThis.mime?.contentType === 'function'
        ? globalThis.mime.contentType(ext)
        : null;
    if (!mime)
        return ext.toLowerCase();
    const top = String(mime).split('/')[0];
    if (MIME_TOP_FOLDERS.has(top))
        return top;
    if (top === 'application')
        return ext.toLowerCase();
    return top;
}

/** Если parent — папка-тип рабочей зоны, а расширение файла относится к другой папке → вернуть {parent, folder} для маршрутизации через класс. */
export function correctTypeFolder(parent, filename) {
    if (!parent || parent instanceof FS.$class)
        return null;
    // parent.parent — потенциальный корень рабочей зоны (USER, ADMIN…)
    const zoneRoot = parent.parent;
    if (!zoneRoot)
        return null;
    const parentName = String(parent.name || '').toLowerCase();
    if (!MIME_TOP_FOLDERS.has(parentName))
        return null; // только MIME top-type папки (text/image/video/audio)
    const canon = canonicalFolder(filename);
    if (!canon || canon === parentName)
        return null; // папка совпадает — коррекция не нужна
    // нашёл mismatch (напр. docx в text/) → сохраняем через zoneRoot без folder, пусть routing решит
    return { parent: zoneRoot, folder: undefined };
}

export function realPathOf(log, fallback) {
    const p = log?.logFullPath || log?.path;
    if (!p)
        return fallback;
    // history-снимок → путь самого файла: …/.name/history/DAY/snap → …/name
    const m = String(p).match(/^(.*)\/\.([^/]+)\/history\/[^/]+\/[^/]+$/);
    return m ? m[1] + '/' + m[2] : p;
}

/** Записать бинарный файл (картинка и т.п.) → фактический путь. */
export async function writeBinary(path, buffer, ctx) {
    const pre = await beforeWrite(await fileAt(path, ctx));
    const log = await writeFile(path, buffer, ctx);
    if (ctx?.entry)
        ctx.entry.snapshot = log?.logFullPath || log?.path || undefined;
    const real = realPathOf(log, absPath(path, ctx));
    await trackWrite(ctx, real, log, pre);
    return real;
}

/** Существующий файл по пути (не папка, не несколько элементов) или null — для записи «как откатить» (undo.js). */
export async function fileAt(path, ctx) {
    const item = await getItem(path, ctx).catch(() => null);
    return item && !Array.isArray(item) && !isContainer(item) ? item : null;
}

/** Записать в карточку вызова способ отката (undo.js); ошибка отслеживания не ломает запись. */
export async function trackWrite(ctx, realPath, log, pre) {
    if (!ctx?.entry)
        return;
    try {
        await recordWrite(ctx.entry, { realItem: await fileAt(realPath, ctx), pre });
    }
    catch (e) { log.debug('undo.record', e); /* откат не поставится — изменение попадёт в список «вручную» */ }
}

export const target = key => args => absPath(args?.[key], null);

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

// (F23, removed) READ_METHOD — угадывание «чтения» по имени метода: имя пишет автор class.js,
// «get_…» ничего не гарантирует. Уровень берётся из реестра ядра или объявления ACCESS в class.js.
export const DANGER_METHODS = new Set(['delete', 'npm', 'proxy', 'restart_normal', 'save_secret', 'read_secret', 'clear_rag', 'send_push_notification', 'save', 'restore_from_history']);
export const BLOCKED_METHODS = new Set(['constructor', 'execute', 'reset', 'fire', 'listen', 'assertAccess', 'canSee', 'canWrite', 'user_register_start', 'user_register_process', 'user_register_finish', 'user_login_start', 'user_login_finish']);
