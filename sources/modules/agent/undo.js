/**
 * Откат изменений файлов, сделанных агентом (revert ленты «с файлами»).
 *
 * Запись об изменении (`entry.undo`, ставят инструменты write/append/edit/delete и writeBinary):
 *   { path, dir, op: 'create'|'modify'|'delete', before, hash }
 *   dir    — путь файла на диске на момент записи (справочно: при откате НЕ используется — см. ниже);
 *   before — прежнее состояние: { snapshot, dir } снимок истории (если он совпал с файлом до записи) |
 *            { text } небольшой файл (≤ INLINE_MAX) текстом | { lost: true } восстановить нечем | null (create);
 *   hash   — sha1 байтов файла на диске ПОСЛЕ записи (нет у delete).
 *
 * Откат идёт от новых изменений к старым. Файл, изменённый после агента (хеш не совпал, удалён, создан заново),
 * не трогается — попадает в `skipped` с причиной. Права — те же, что у пользователя задачи (callAs).
 *
 * Записям ленты НЕ доверяем: ленту .task может править её владелец, поэтому пути на диске берутся из дерева WORK
 * (элемент по `path`; для удалённого файла — папка-родитель + имя), а снимок истории принимается только из истории
 * этого же файла (и по WORK-пути, и по пути на диске). Иначе подделанная запись превращала бы откат в чтение любого
 * файла сервера с записью его содержимого в файл пользователя.
 * Зависимости (getItem, callAs, writeFile) передаются снаружи: модуль не импортирует tools/work.js (цикл).
 */
import { log } from './log.js';
import fs from 'node:fs/promises';
import pathMod from 'node:path';
import crypto from 'node:crypto';

/** Файл прежней версии до этого размера сохраняется в записи текстом, если снимка истории нет. */
export const INLINE_MAX = 20_000;

const sha = buf => crypto.createHash('sha1').update(buf).digest('hex');
const isText = buf => !buf.includes(0);
const readOrNull = async dir => { try { return dir ? await fs.readFile(dir) : null; } catch { return null; } };

/** Байты файла на диске (null — нет файла). */
export const bytesOf = item => readOrNull(item?.dir);

/** Папка истории файла на диске: <папка>/.<имя>/history. */
const historyDirOf = dir => pathMod.join(pathMod.dirname(dir), '.' + pathMod.basename(dir), 'history');

/** WORK-префикс снимков файла: <папка>/.<имя>/history/ — как его строит snapshotsOf. */
const historyPrefixOf = path => String(path).replace(/[^/]+$/, '') + '.' + String(path).split('/').pop() + '/history/';

/** child лежит строго внутри parent (после нормализации; без «..» и абсолютных обходов). */
function within(child, parent) {
    const rel = pathMod.relative(pathMod.resolve(parent), pathMod.resolve(String(child)));
    return !!rel && !rel.startsWith('..') && !pathMod.isAbsolute(rel);
}

/**
 * Путь файла на диске по WORK-пути — из дерева, не из ленты. Есть элемент — его dir; файла уже нет (откат удаления) —
 * папка-родитель из дерева + имя листа. null — путь не разобрать.
 */
async function diskDirOf(path, item, deps) {
    if (item?.dir)
        return item.dir;
    const leaf = String(path).split('/').pop();
    if (!leaf || leaf === '.' || leaf === '..' || leaf.includes('\\'))
        return null;
    const parent = await deps.getItem(String(path).replace(/\/[^/]*$/, '') || '/').catch(() => null);
    return parent && !Array.isArray(parent) && parent.dir ? pathMod.join(parent.dir, leaf) : null;
}

/**
 * Снимки истории файла по возрастанию времени: [{ path, dir }].
 * Читаются прямо с диска (`<папка>/.<имя>/history/<день>/<снимок>`): дерево WORK кэширует список папок,
 * и только что созданный снимок прошлой записи в нём может быть ещё не виден.
 */
export async function snapshotsOf(item) {
    const out = [];
    try {
        const leaf = pathMod.basename(item.dir);
        const hdir = pathMod.join(pathMod.dirname(item.dir), '.' + leaf, 'history');
        const wbase = String(item.path).replace(/[^/]+$/, '') + '.' + leaf + '/history';
        for (const day of await fs.readdir(hdir))
            for (const snap of await fs.readdir(pathMod.join(hdir, day)))
                out.push({ path: wbase + '/' + day + '/' + snap, dir: pathMod.join(hdir, day, snap) });
    }
    catch (e) { log.debug('undo.list', e); /* истории нет */ }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Как вернуть файл в состояние pre (байты до записи): снимок истории, текст или «нечем». */
async function describeBefore(item, pre) {
    const newest = (await snapshotsOf(item)).at(-1);
    const bytes = await readOrNull(newest?.dir);
    if (bytes && sha(bytes) === sha(pre))
        return { snapshot: newest.path, dir: newest.dir };
    if (isText(pre) && pre.length <= INLINE_MAX)
        return { text: pre.toString('utf-8') };
    return { lost: true };
}

/**
 * Состояние файла ДО изменения. Вызывать до записи/удаления; existing — найденный элемент (или null/массив/папка).
 * @returns {Promise<{ known: boolean, before: object|null }>} known — файл существовал
 */
export async function beforeWrite(existing) {
    if (!existing || Array.isArray(existing) || !existing.dir)
        return { known: false, before: null };
    const pre = await bytesOf(existing);
    if (!pre)
        return { known: false, before: null };
    return { known: true, before: await describeBefore(existing, pre) };
}

/**
 * Записать в карточку вызова, как откатить запись. realItem — файл после записи.
 * Не удалось прочитать файл — откат не ставится (изменение будет в списке «вручную»).
 */
export async function recordWrite(entry, { realItem, pre }) {
    if (!entry || !realItem)
        return;
    const after = await bytesOf(realItem);
    if (!after)
        return;
    let op, before;
    if (pre?.known) {
        op = 'modify';
        before = pre.before;
    }
    else {
        // по запрошенному пути файла не было — но он мог лежать в зоне роли: смотрим историю фактического файла.
        // Свежий снимок этой записи — самый новый и совпадает с файлом по байтам; «прежний» — тот, что перед ним
        const snaps = await snapshotsOf(realItem);
        let prev = snaps.at(-1);
        const bytes = await readOrNull(prev?.dir);
        if (bytes && sha(bytes) === sha(after))
            prev = snaps.at(-2);
        op = prev ? 'modify' : 'create';
        before = prev ? { snapshot: prev.path, dir: prev.dir } : null;
    }
    entry.undo = { path: realItem.path, dir: realItem.dir, op, before, hash: sha(after) };
}

/** После удаления файла: как вернуть. */
export function recordDelete(entry, { item, pre }) {
    if (!entry || !pre?.known)
        return;
    entry.undo = { path: item.path, dir: item.dir, op: 'delete', before: pre.before };
}

function walk(items, fn) {
    for (const it of items || []) {
        if (it?.type !== 'assistant')
            continue;
        for (const t of it.tools || []) {
            fn(t);
            walk(t.items, fn);
        }
    }
}

/**
 * Изменения файлов в диапазоне ленты (включая вложенные ленты субагентов), по возрастанию времени.
 * undo — можно откатить автоматически; manual — изменено, но откат не записан (картинки/таблицы через другие инструменты,
 * классы, вызовы call…).
 */
export function collectUndo(items) {
    const undo = [];
    const manual = [];
    walk(items, t => {
        if (t.status !== 'ok')
            return;
        if (t.undo)
            undo.push({ ...t.undo, tool: t.name, call: t.id });
        else if (Array.isArray(t.undoList)) {
            // многофайловый патч (apply_patch): одна карточка вызова, записи отката — на каждый файл
            for (const u of t.undoList)
                if (u && u.path)
                    undo.push({ ...u, tool: t.name, call: t.id });
        }
        else if (t.snapshot)
            manual.push({ path: t.path || t.snapshot, tool: t.name, call: t.id });
    });
    return { undo, manual };
}

/**
 * Откатить изменения от новых к старым.
 * @param {Array} list результат collectUndo().undo
 * @param {{ getItem: Function, callAs: Function, writeFile: Function }} deps getItem(path) → элемент|null
 * @returns {Promise<{ reverted: Array<{path, op}>, skipped: Array<{path, op, reason}> }>}
 */
export async function applyUndo(list, deps) {
    const reverted = [];
    const skipped = [];
    for (const u of [...list].reverse()) {
        const skip = reason => skipped.push({ path: u.path, op: u.op, reason });
        try {
            // существование и содержимое — по диску (кэш дерева WORK может отставать), но путь на диске — из дерева, не из ленты
            const found = await deps.getItem(u.path).catch(() => null);
            const item = found && !Array.isArray(found) ? found : null;
            const dir = await diskDirOf(u.path, item, deps);
            if (!dir) {
                skip('путь не найден в дереве WORK');
                continue;
            }
            const current = await readOrNull(dir);
            if (u.op === 'delete') {
                if (current)
                    skip('файл уже создан заново');
                else if (u.before?.lost || (!u.before?.snapshot && u.before?.text == null))
                    skip('прежняя версия не сохранена');
                else {
                    await restore(u, null, dir, deps);
                    reverted.push({ path: u.path, op: u.op });
                }
            }
            else if (!current)
                skip('файл удалён после изменения агента');
            else if (sha(current) !== u.hash)
                skip('файл изменён после агента');
            else if (!item)
                skip('файл не найден в дереве WORK');
            else if (u.op === 'create') {
                await deps.callAs(item, 'delete', {});
                reverted.push({ path: u.path, op: u.op });
            }
            else if (u.before?.lost || (!u.before?.snapshot && u.before?.text == null))
                skip('прежняя версия не сохранена');
            else {
                await restore(u, item, dir, deps);
                reverted.push({ path: u.path, op: u.op });
            }
        }
        catch (e) {
            skip(String(e?.message || e).slice(0, 200));
        }
    }
    return { reverted, skipped };
}

/**
 * Вернуть прежнее содержимое: снимок истории (его метод), иначе — байты снимка/текст через сохранение файла.
 * dir — путь файла на диске (из дерева). Снимок принимается только из истории этого же файла.
 */
async function restore(u, item, dir, deps) {
    const snapshot = typeof u.before.snapshot === 'string' && u.before.snapshot.startsWith(historyPrefixOf(u.path)) ? u.before.snapshot : null;
    if (snapshot) {
        const snap = await deps.getItem(snapshot).catch(() => null);
        if (snap && !Array.isArray(snap)) {
            await deps.callAs(snap, 'restore_from_history', {});
            return;
        }
    }
    const bytes = u.before.text != null ? Buffer.from(String(u.before.text), 'utf-8')
        : (snapshot && within(u.before.dir, historyDirOf(dir)) ? await readOrNull(u.before.dir) : null);
    if (!bytes)
        throw new Error('снимок истории не найден');
    const post = isText(bytes) ? bytes.toString('utf-8') : bytes;
    if (item)
        await deps.callAs(item, 'save', { post });
    else
        await deps.writeFile(u.path, post);
}
