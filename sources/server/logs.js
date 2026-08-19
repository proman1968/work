/**
 * Подсистема логов класса: data.logs + history в метапапке
 * (`<meta>/logs/.data.logs/history/YYYY-MM-DD/*.logs`).
 *
 * Чистые функции над storage ($class). Публичный фасад — методы $class:
 * logs({mode}), read_log_entry(), append_log_includes().
 */
import { $item } from '../core.js';
import { FS } from './index.js';

export const today = () => new Date().toISOString().slice(0, 10);

/** Нормализация запроса: строка → {day}, ext → массив exts в нижнем регистре. */
export function normalizeQuery(params = {}) {
    if (typeof params === 'string')
        params = { day: params };
    params = { ...params };
    params.exts ??= params.ext != null
        ? (Array.isArray(params.ext) ? params.ext : [params.ext])
        : null;
    if (params.exts)
        params.exts = params.exts.map(e => String(e).replace(/^\./, '').toLowerCase());
    return params;
}

/** Расширение history-файла из записи лога (поле ext или path). */
export function logExt(row) {
    if (row?.ext)
        return String(row.ext).replace(/^\./, '').toLowerCase();
    const id = row?.path?.split('/').pop() || '';
    const dot = id.lastIndexOf('.');
    return dot > 0 ? id.slice(dot + 1).toLowerCase() : '';
}

export function matchesFilter(row, params) {
    if (!params.exts?.length)
        return true;
    return params.exts.includes(logExt(row));
}

/** Список дней запроса: day | days | from..to | сегодня. */
export function resolveDays(params = {}) {
    if (params.day)
        return [params.day];
    if (params.days?.length)
        return params.days.slice();
    if (params.from) {
        const to = params.to || params.from;
        const days = [];
        const cur = new Date(params.from + 'T12:00:00');
        const end = new Date(to + 'T12:00:00');
        while (cur <= end) {
            days.push(cur.toISOString().slice(0, 10));
            cur.setDate(cur.getDate() + 1);
        }
        return days;
    }
    return [today()];
}

export function historyFolder(storage) {
    return storage.meta_folder.get_item('/logs/.data.logs/history');
}

/** Даты, за которые есть логи (по убыванию); сегодня — всегда в списке. */
export async function datesList(storage) {
    let dates = [];
    try {
        const history = await historyFolder(storage);
        if (history) {
            dates = await history.folders;
            dates = dates.map(f => f.name);
            dates.sort((a, b) => b.localeCompare(a));
        }
    }
    catch (e) {
        if (e?.code !== 'ENOENT')
            console.warn('[WORK] logs dates:', e.message);
    }
    const day = today();
    if (dates.indexOf(day) === -1)
        dates.unshift(day);
    return dates;
}

/** .logs файлы дня (без load) — для инкрементального чата. */
export function dayFiles(storage, day) {
    day ??= today();
    return storage.meta_folder.get_item('/logs/.data.logs/history/' + day + '/*.logs');
}

/** Папка дня (создаётся при отсутствии). */
export async function dayFolder(storage, day) {
    day ??= today();
    const history = await historyFolder(storage);
    if (!history)
        return null;
    const folder = await history._get_next_item(day, FS.$folder);
    await folder.save();
    return folder;
}

async function dayFilesArray(storage, day) {
    let files = await dayFiles(storage, day);
    if (!Array.isArray(files))
        files = files ? [files] : [];
    return files;
}

/** Тела записей за дни запроса, по убыванию времени. */
export async function loadBodies(storage, params = {}) {
    const days = resolveDays(params);
    const rows = [];
    for (const day of days) {
        for (const f of await dayFilesArray(storage, day)) {
            try {
                const raw = await f.load();
                const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (row?.time == null)
                    continue;
                if (!matchesFilter(row, params))
                    continue;
                rows.push(Object.assign({ day, logsFilePath: f.path }, row));
            }
            catch (e) {
                console.warn('[WORK] log load', day, e.message);
            }
        }
    }
    rows.sort((a, b) => (b.time || 0) - (a.time || 0));
    return rows;
}

/** .logs файлы за дни запроса с фильтром по ext (для mode: files). */
export async function filesForDays(storage, params = {}) {
    const days = resolveDays(params);
    const files = [];
    for (const day of days) {
        const list = await dayFilesArray(storage, day);
        if (!params.exts?.length) {
            files.push(...list);
            continue;
        }
        for (const f of list) {
            try {
                const raw = await f.load();
                const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (matchesFilter(row, params))
                    files.push(f);
            }
            catch { /* skip */ }
        }
    }
    return files;
}

/** Лёгкий индекс без content: flat-список или агрегаты по дням. */
export function buildIndex(rows, params = {}) {
    const pick = row => ({
        day: row.day,
        time: row.time,
        sender: row.sender,
        ext: logExt(row),
        path: row.path,
        logsFilePath: row.logsFilePath,
    });
    if (params.flat || params.day)
        return rows.map(pick);
    const byDay = Object.create(null);
    for (const row of rows) {
        let bucket = byDay[row.day];
        if (!bucket) {
            bucket = byDay[row.day] = {
                day: row.day,
                count: 0,
                firstTime: row.time,
                lastTime: row.time,
                exts: [],
                items: [],
            };
        }
        bucket.count++;
        bucket.firstTime = Math.min(bucket.firstTime, row.time);
        bucket.lastTime = Math.max(bucket.lastTime, row.time);
        const ext = logExt(row);
        if (ext && !bucket.exts.includes(ext))
            bucket.exts.push(ext);
        if (params.items)
            bucket.items.push(pick(row));
    }
    return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
}

function sameLogPath(rowPath, target, shortTarget) {
    const shortRow = $item.toShortPath(rowPath);
    return shortRow === shortTarget || rowPath === target
        || rowPath.endsWith(target) || target.endsWith(rowPath);
}

/** Найти JSON-запись лога по path history-файла (ai.task и т.п.). */
export async function findEntry(storage, entryPath) {
    if (!entryPath)
        return null;
    const target = entryPath.startsWith('/') ? entryPath : '/' + entryPath;
    const shortTarget = $item.toShortPath(target);
    const days = await datesList(storage);
    for (const day of days) {
        for (const f of await dayFilesArray(storage, day)) {
            try {
                const raw = await f.load();
                const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (!row?.path)
                    continue;
                const rowPath = row.path.startsWith('/') ? row.path : '/' + row.path;
                if (sameLogPath(rowPath, target, shortTarget))
                    return row;
            }
            catch { /* skip */ }
        }
    }
    return null;
}

function logClassKey(storage) {
    if (!storage || storage === globalThis.WORK)
        return 'WORK';
    return storage.id || storage.path || storage.dir || '';
}

async function writeLogTo(storage, log_param, written) {
    if (!storage?.save_file)
        return;
    const key = logClassKey(storage);
    if (key && written.has(key))
        return;
    if (key)
        written.add(key);
    await storage.save_file(log_param);
}

/**
 * Записать строку лога в data.logs с fan-out (owner + кабинет автора + receivers).
 * @param {object} storage $class-владелец ленты
 * @param {object} row { time, sender?, content?, includes?, path?, ext?, receivers? }
 * @param {object} [params] session, logAuthor, …
 */
export async function appendRow(storage, row, params = {}) {
    if (!storage)
        throw new Error('appendRow: нужен storage');
    const log_param = Object.assign({}, params, {
        ignore_save_logs: true,
        filename: 'data.logs',
        post: JSON.stringify(row, null, 2),
        encoding: 'utf-8',
    });
    const written = new Set();
    await writeLogTo(storage, log_param, written);

    const authorCabinet = params.logAuthor?.$user ?? params.session?.$user;
    if (authorCabinet && authorCabinet !== globalThis.WORK
        && logClassKey(authorCabinet) !== logClassKey(storage))
        await writeLogTo(authorCabinet, log_param, written);

    let receivers = row.receivers;
    if (typeof receivers === 'string')
        receivers = receivers.split(',').map(s => s.trim()).filter(Boolean);
    if (receivers?.length) {
        receivers = receivers.filter(r => r !== storage.id);
        if (receivers.length) {
            const usersList = await globalThis.WORK.$users;
            const resolved = await Promise.all(receivers.map(uid => usersList.get_item('//' + uid)));
            for (const receiver of resolved)
                await writeLogTo(receiver, log_param, written);
        }
        row.receivers = receivers;
    }
    return row;
}

/** Добавить пути в includes записи лога (например, шаги ai.task). */
export async function appendIncludes(storage, entryPath, includePaths = [], params = {}) {
    if (typeof includePaths === 'string')
        includePaths = includePaths.split(',').map(s => s.trim()).filter(Boolean);
    if (!Array.isArray(includePaths))
        includePaths = includePaths ? [includePaths] : [];
    if (!entryPath || !includePaths.length)
        return null;
    const target = entryPath.startsWith('/') ? entryPath : '/' + entryPath;
    const shortTarget = $item.toShortPath(target);
    const days = await datesList(storage);
    for (const day of days) {
        for (const f of await dayFilesArray(storage, day)) {
            try {
                const raw = await f.load();
                const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (!row?.path)
                    continue;
                const rowPath = row.path.startsWith('/') ? row.path : '/' + row.path;
                if (!sameLogPath(rowPath, target, shortTarget))
                    continue;
                row.includes ??= [];
                for (const p of includePaths) {
                    const path = p.startsWith('/') ? p : '/' + p;
                    if (!row.includes.includes(path))
                        row.includes.push(path);
                }
                await f.save({
                    post: JSON.stringify(row, null, 2),
                    encoding: 'utf-8',
                    session: params.session || globalThis.WORK,
                });
                storage.reset();
                return row;
            }
            catch (e) {
                console.warn('[WORK] append_log_includes', e.message);
            }
        }
    }
    return null;
}
