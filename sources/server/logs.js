/**
 * Подсистема логов класса в SQLite (`logs` в `<Организация>/$base/#system/work.db`
 * для узлов внутри организации `$base` и в `./.data/work.db` для `/USERS` и сервера).
 *
 * Записи логов больше не раскладываются тысячами мелких файлов `.logs` по папкам
 * `<meta>/logs/YYYY-MM-DD/`. При этом публичный фасад `$class` полностью сохранён:
 * `logs({ mode: 'dates' | 'bodies' | 'index' | 'files' | 'folder' })`,
 * `save_message()`, `read_log_bodies()`, `read_log_entry()`, `append_log_includes()`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { $item } from '../core.js';
import { FS } from './index.js';
import * as REFS from './access/refs.js';
import { dataDb } from '../data/db.js';

/** Сегодня по местному времени сервера (YYYY-MM-DD). */
export const today = () => new Date().toLocalDay();

/** Местная дата YYYY-MM-DD для произвольного timestamp (мс). */
export function dayOfTime(ms) {
    const dt = new Date(Number(ms) || Date.now());
    if (typeof dt.toLocalDay === 'function')
        return dt.toLocalDay();
    if (typeof dt.toISOTimezoneString === 'function')
        return dt.toISOTimezoneString().slice(0, 10).split('.').toReversed().join('-');
    return dt.toISOString().slice(0, 10);
}

/** Канонический ключ владельца ленты ('/' для корня WORK, '/USERS/ivan', '/ORGANIZATIONS/Маслоторг/sales', ...). */
export function feedPathOf(storage) {
    if (!storage || storage === globalThis.WORK || storage?.type === '$server' || (!storage?.parent && !storage?.path))
        return '/';
    const raw = String(storage.path || storage.id || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!raw || raw === '/')
        return '/';
    return raw.startsWith('/') ? raw : '/' + raw;
}

/** Виртуальный адрес записи лога (совместим с прежним logsFilePath). */
export function buildStubPath(storage, day, time, sender) {
    const fp = feedPathOf(storage);
    const meta = storage?.type || (fp === '/' ? '$server' : '$class');
    const prefix = fp === '/' ? '' : fp;
    return `${prefix}/${meta}/logs/${day}/${time}.${sender || 'system'}.logs`;
}

/**
 * Определить SQLite БД для хранения логов конкретного узла `storage`:
 * - если узел находится внутри организации (`$base`), используется БД этой организации `<Организация>/$base/#system/work.db`;
 * - иначе (личные кабинеты `/USERS/<uid>`, `/NODES`, корневой `WORK`) — корневая БД сервера `./.data/work.db`.
 */
export async function dbForStorage(storage) {
    const rootDir = globalThis.WORK?.real_dir || globalThis.WORK?.dir || process.cwd();
    let basePath = '';
    for (let cur = storage; cur; cur = cur.$parent || cur.parent) {
        if (cur?.type === '$base' && cur.path) {
            basePath = cur.path;
            break;
        }
    }
    if (!basePath) {
        const fp = feedPathOf(storage);
        const m = fp.match(/^\/(ORGANIZATIONS|BASES)\/([^/]+)/);
        if (m) {
            const candidate = path.resolve(rootDir, m[1], m[2], '$base');
            if (fs.existsSync(candidate))
                basePath = `/${m[1]}/${m[2]}`;
        }
    }
    return dataDb(basePath, rootDir);
}

/**
 * includes из query/post: массив путей, JSON-строка или один путь.
 * WORK.fetch кладёт params в query — массив там становится строкой.
 */
export function normalizeIncludes(v) {
    if (v == null || v === '')
        return [];
    let list = v;
    if (typeof v === 'string') {
        const s = v.trim();
        if (!s)
            return [];
        if (s[0] === '[') {
            try {
                const parsed = JSON.parse(s);
                list = Array.isArray(parsed) ? parsed : [s];
            } catch {
                list = s.includes(',/') ? s.split(',') : [s];
            }
        } else
            list = s.includes(',/') ? s.split(',') : [s];
    } else if (!Array.isArray(v))
        list = [v];
    return list.map(p => {
        p = String(p ?? '').trim();
        if (!p)
            return '';
        return p.startsWith('/') ? p : '/' + p;
    }).filter(Boolean);
}

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
            days.push(cur.toLocalDay());
            cur.setDate(cur.getDate() + 1);
        }
        return days;
    }
    return [today()];
}

/** Папка журнала класса (`meta/logs`). Возвращается без создания на диске. */
export function logsFolder(storage) {
    return storage?.meta_folder?.get_item?.('/logs');
}

/** @deprecated имя; то же, что logsFolder */
export function historyFolder(storage) {
    return logsFolder(storage);
}

/** Проверить, есть ли на диске физическая папка `<meta>/logs` (для старых тестов безопасности). */
function diskLogsDir(storage) {
    const base = storage?.meta_folder?.real_dir || storage?.meta_folder?.dir
        || (storage?.real_dir ? path.join(storage.real_dir, storage.type || '$class') : '');
    if (!base)
        return '';
    const d = path.join(base, 'logs');
    return fs.existsSync(d) ? d : '';
}

/** Даты, за которые есть логи (по убыванию); сегодня — всегда в списке. */
export async function datesList(storage) {
    const dateSet = new Set([today()]);
    try {
        const db = await dbForStorage(storage);
        const fp = feedPathOf(storage);
        const rows = db.prepare('SELECT DISTINCT day FROM logs WHERE feed_path = ?').all(fp);
        for (const r of rows) {
            if (r?.day && /^\d{4}-\d{2}-\d{2}$/.test(r.day))
                dateSet.add(r.day);
        }
    }
    catch (e) {
        console.warn('[WORK] logs dates (sql):', e.message);
    }
    const diskDir = diskLogsDir(storage);
    if (diskDir) {
        try {
            for (const entry of fs.readdirSync(diskDir, { withFileTypes: true })) {
                if (entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
                    dateSet.add(entry.name);
            }
        }
        catch { /* ignore */ }
    }
    return [...dateSet].sort((a, b) => b.localeCompare(a));
}

function createVirtualLogFile(storage, row) {
    const uid = row.sender || 'system';
    const id = `${row.time}.${uid}.logs`;
    const day = row.day || dayOfTime(row.time);
    const stubPath = row.logsFilePath || buildStubPath(storage, day, row.time, uid);
    return {
        id,
        name: id,
        ext: 'logs',
        path: stubPath,
        short: stubPath,
        descriptor: true,
        logRow: row,
        time: row.time,
        load: async () => JSON.stringify(row),
        toJSON() {
            return { id, name: id, ext: 'logs', path: stubPath, type: '$file', logRow: row };
        },
    };
}

/** Виртуальные дескрипторы `.logs` дня (для обратной совместимости `log_files` / `mode: 'files'`). */
export async function dayFiles(storage, day) {
    day ??= today();
    const rows = await loadBodies(storage, { day });
    return rows.map(r => createVirtualLogFile(storage, r));
}

/** Папка дня (виртуальная, без создания пустых папок на диске). */
export async function dayFolder(storage, day) {
    day ??= today();
    const history = await historyFolder(storage);
    if (!history)
        return null;
    return history._get_next_item(day, FS.$folder);
}

/** Тела записей за дни запроса, по убыванию времени. */
export async function loadBodies(storage, params = {}) {
    params = normalizeQuery(params);
    const days = resolveDays(params);
    if (!days.length)
        return [];
    const rows = [];
    const seenStubs = new Set();

    try {
        const db = await dbForStorage(storage);
        const fp = feedPathOf(storage);
        const placeholders = days.map(() => '?').join(', ');
        const sqlRows = db.prepare(
            `SELECT day, stub_path, body FROM logs WHERE feed_path = ? AND day IN (${placeholders}) ORDER BY time DESC, id DESC`
        ).all(fp, ...days);

        for (const r of sqlRows) {
            try {
                const row = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
                if (row?.time == null)
                    continue;
                if (!matchesFilter(row, params))
                    continue;
                const stub = r.stub_path || buildStubPath(storage, r.day, row.time, row.sender);
                seenStubs.add(stub);
                rows.push(Object.assign({ day: r.day, logsFilePath: stub }, row));
            }
            catch (e) {
                console.warn('[WORK] log parse (sql)', r.day, e.message);
            }
        }
    }
    catch (e) {
        console.warn('[WORK] log load (sql)', e.message);
    }

    // Если в тесте безопасности на диске вручную положен файл .logs, учитываем и его
    const diskDir = diskLogsDir(storage);
    if (diskDir) {
        for (const day of days) {
            const dayPath = path.join(diskDir, day);
            if (!fs.existsSync(dayPath))
                continue;
            try {
                const files = fs.readdirSync(dayPath).filter(n => n.endsWith('.logs'));
                for (const fname of files) {
                    const full = path.join(dayPath, fname);
                    const raw = fs.readFileSync(full, 'utf-8');
                    const row = JSON.parse(raw);
                    if (row?.time == null || !matchesFilter(row, params))
                        continue;
                    const fp = feedPathOf(storage);
                    const meta = storage?.type || '$class';
                    const stub = `${fp === '/' ? '' : fp}/${meta}/logs/${day}/${fname}`;
                    if (seenStubs.has(stub))
                        continue;
                    seenStubs.add(stub);
                    rows.push(Object.assign({ day, logsFilePath: stub }, row));
                }
            }
            catch { /* skip */ }
        }
    }

    rows.sort((a, b) => (b.time || 0) - (a.time || 0));
    return rows;
}

/** Виртуальные `.logs` файлы за дни запроса с фильтром по ext (для mode: files). */
export async function filesForDays(storage, params = {}) {
    const rows = await loadBodies(storage, params);
    return rows.map(r => createVirtualLogFile(storage, r));
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

/** Ключ записи: stub `.logs` или связанный `row.path`. */
export function matchesEntry(entryPath, row, logsFilePath) {
    if (!entryPath)
        return false;
    const target = entryPath.startsWith('/') ? entryPath : '/' + entryPath;
    const shortTarget = $item.toShortPath(target);
    if (logsFilePath) {
        const stub = logsFilePath.startsWith('/') ? logsFilePath : '/' + logsFilePath;
        if (sameLogPath(stub, target, shortTarget))
            return true;
    }
    if (!row?.path)
        return false;
    const rowPath = row.path.startsWith('/') ? row.path : '/' + row.path;
    return sameLogPath(rowPath, target, shortTarget);
}

/** Найти JSON-запись лога по stub (.logs) или связанному path (task/html/…). */
export async function findEntry(storage, entryPath) {
    if (!entryPath)
        return null;
    try {
        const db = await dbForStorage(storage);
        const fp = feedPathOf(storage);
        const sqlRows = db.prepare(
            'SELECT day, stub_path, body FROM logs WHERE feed_path = ? ORDER BY time DESC, id DESC'
        ).all(fp);
        for (const r of sqlRows) {
            try {
                const row = JSON.parse(r.body);
                const stub = r.stub_path || buildStubPath(storage, r.day, row.time, row.sender);
                if (matchesEntry(entryPath, row, stub))
                    return Object.assign({ day: r.day, logsFilePath: stub }, row);
            }
            catch { /* skip */ }
        }
    }
    catch { /* skip */ }

    const diskDir = diskLogsDir(storage);
    if (diskDir) {
        const days = await datesList(storage);
        for (const day of days) {
            const dayPath = path.join(diskDir, day);
            if (!fs.existsSync(dayPath))
                continue;
            try {
                for (const fname of fs.readdirSync(dayPath).filter(n => n.endsWith('.logs'))) {
                    const raw = fs.readFileSync(path.join(dayPath, fname), 'utf-8');
                    const row = JSON.parse(raw);
                    const fp = feedPathOf(storage);
                    const meta = storage?.type || '$class';
                    const stub = `${fp === '/' ? '' : fp}/${meta}/logs/${day}/${fname}`;
                    if (matchesEntry(entryPath, row, stub))
                        return Object.assign({ day, logsFilePath: stub }, row);
                }
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

function resolveSenderUid(row, params) {
    if (row?.sender)
        return String(row.sender);
    const actor = params?.session;
    if (actor?.uid)
        return String(actor.uid);
    if (actor === globalThis.WORK || actor?.$user === globalThis.WORK)
        return String(globalThis.WORK?.id || 'WORK');
    return String(actor?.$user?.id || actor?.id || 'system');
}

/**
 * Записать одну запись лога в SQLite для конкретного узла `storage` (без создания файла .logs на диске).
 */
export async function saveDataLogRow(storage, params = {}, rawRow = null) {
    if (!storage)
        return null;
    let bodyObj = rawRow;
    if (!bodyObj) {
        const raw = params.post ?? params.message ?? '{}';
        bodyObj = typeof raw === 'string' ? JSON.parse(raw) : { ...raw };
    }
    else {
        bodyObj = { ...bodyObj };
    }
    const uid = resolveSenderUid(bodyObj, params);
    const baseTime = Number(bodyObj.time) || Number(params.time) || Date.now();
    const db = await dbForStorage(storage);
    const fp = feedPathOf(storage);

    let actualTime = baseTime;
    const existsStmt = db.prepare('SELECT 1 FROM logs WHERE feed_path = ? AND time = ? AND sender = ? LIMIT 1');
    for (let shift = 0; shift <= 1000; shift++) {
        actualTime = baseTime + shift;
        if (!existsStmt.get(fp, actualTime, uid))
            break;
    }

    bodyObj.time = actualTime;
    bodyObj.name ??= 'data';
    const day = dayOfTime(actualTime);
    const ext = logExt(bodyObj);
    const rowPath = String(bodyObj.path || '');
    const stubPath = buildStubPath(storage, day, actualTime, uid);

    db.prepare(`
        INSERT INTO logs (feed_path, day, time, sender, ext, path, stub_path, body)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fp, day, actualTime, uid, ext, rowPath, stubPath, JSON.stringify(bodyObj));

    storage.reset?.();
    return {
        ...bodyObj,
        day,
        path: stubPath,
        logFullPath: stubPath,
        logsFilePath: stubPath,
    };
}

async function writeLogTo(storage, params, written, row) {
    if (!storage)
        return;
    const key = logClassKey(storage);
    if (key && written.has(key))
        return;
    if (key)
        written.add(key);

    const res = await saveDataLogRow(storage, params, row);
    // Запись в ленте кабинета открывает владельцу то, на что она указывает
    if (row && (storage instanceof FS.$user || storage instanceof FS.$node)) {
        try {
            await REFS.addRow(storage.principalId ?? storage.id, row, res?.logFullPath || res?.path || '');
        }
        catch (e) {
            console.warn('[logs] feed refs:', e.message);
        }
    }
    return res;
}

/**
 * Вложить в запись можно только то, что видит сам автор — иначе лента становится
 * обходом прав (получатели увидят вложенное). Системные вызовы (без session / WORK) не проверяются.
 * @param {string[]} paths Пути includes
 * @param {object} params session, role
 */
export async function assertIncludesVisible(paths, params = {}) {
    const session = params?.session;
    if (!session || session.$user === globalThis.WORK || !paths?.length)
        return;
    for (const p of paths) {
        let item = await globalThis.WORK.get_item(p);
        if (Array.isArray(item))
            item = item.at(-1);
        if (!item || typeof item.assertAccess !== 'function')
            continue;
        await item.assertAccess({ session, role: params.role }, FS.$class.ACCESS_LEVEL.READ);
    }
}

/**
 * Записать строку лога в SQLite с fan-out (owner + кабинет автора + receivers).
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
        encoding: 'utf-8',
        session: { $user: globalThis.WORK }
    });
    const written = new Set();
    const primaryRes = await writeLogTo(storage, log_param, written, row);
    if (primaryRes?.time)
        row.time = primaryRes.time;
    if (primaryRes?.logsFilePath)
        row.logsFilePath = primaryRes.logsFilePath;

    let authorCabinet = params.logAuthor?.$user ?? params.session?.$user;
    const senderUid = row.sender || params.session?.uid || params.uid;
    if ((!authorCabinet || authorCabinet === globalThis.WORK) && senderUid && senderUid !== 'system' && senderUid !== 'WORK' && senderUid !== globalThis.WORK?.id) {
        try {
            const usersList = await globalThis.WORK?.$users;
            if (usersList)
                authorCabinet = await usersList.get_item('//' + senderUid);
        }
        catch { /* ignore */ }
    }
    if (authorCabinet && authorCabinet !== globalThis.WORK
        && logClassKey(authorCabinet) !== logClassKey(storage))
        await writeLogTo(authorCabinet, log_param, written, row);

    let receivers = row.receivers;
    if (typeof receivers === 'string')
        receivers = receivers.split(',').map(s => s.trim()).filter(Boolean);
    if (receivers?.length) {
        receivers = receivers.filter(r => r !== storage.id);
        if (receivers.length) {
            const usersList = await globalThis.WORK.$users;
            const resolved = await Promise.all(receivers.map(uid => usersList.get_item('//' + uid)));
            for (const receiver of resolved)
                await writeLogTo(receiver, log_param, written, row);
        }
        row.receivers = receivers;
    }
    return row;
}

/** Добавить пути в includes записи лога (например, шаги ai.task). */
export async function appendIncludes(storage, entryPath, includePaths = [], params = {}) {
    includePaths = normalizeIncludes(includePaths);
    if (!entryPath || !includePaths.length)
        return null;
    await assertIncludesVisible(includePaths, params);
    const target = entryPath.startsWith('/') ? entryPath : '/' + entryPath;
    const shortTarget = $item.toShortPath(target);
    const session = params.session;
    const internal = !session || session.$user === globalThis.WORK;

    try {
        const db = await dbForStorage(storage);
        const fp = feedPathOf(storage);
        const sqlRows = db.prepare(
            'SELECT id, day, stub_path, body FROM logs WHERE feed_path = ? ORDER BY time DESC, id DESC'
        ).all(fp);

        for (const r of sqlRows) {
            let row;
            try {
                row = JSON.parse(r.body);
            }
            catch {
                continue;
            }
            const stub = r.stub_path || buildStubPath(storage, r.day, row.time, row.sender);
            if (!matchesEntry(target, row, stub) && !(row?.path && sameLogPath(row.path.startsWith('/') ? row.path : '/' + row.path, target, shortTarget)))
                continue;

            const uid = FS.$class.resolveUid(params);
            if (!internal && uid !== row.sender && !(await storage._isWorkAdmin?.(params)))
                throw new Error('Доступ запрещён');

            row.includes ??= [];
            for (const p of includePaths) {
                const normP = p.startsWith('/') ? p : '/' + p;
                if (!row.includes.includes(normP))
                    row.includes.push(normP);
            }
            const updatedJson = JSON.stringify(row);
            db.prepare('UPDATE logs SET body = ? WHERE id = ?').run(updatedJson, r.id);
            storage.reset?.();

            if (storage instanceof FS.$user || storage instanceof FS.$node) {
                const safeIncludes = includePaths.map(p => p.startsWith('/') ? p : '/' + p);
                await REFS.addRow(storage.principalId ?? storage.id, { time: row.time, includes: safeIncludes }, stub).catch(() => {});
            }
            return row;
        }
    }
    catch (e) {
        if (e?.message === 'Доступ запрещён')
            throw e;
    }

    // Fallback для тестов безопасности (R19), которые кладут файл .logs на диск вручную
    const diskDir = diskLogsDir(storage);
    if (diskDir) {
        const days = await datesList(storage);
        for (const day of days) {
            const dayPath = path.join(diskDir, day);
            if (!fs.existsSync(dayPath))
                continue;
            for (const fname of fs.readdirSync(dayPath).filter(n => n.endsWith('.logs'))) {
                const disk = path.join(dayPath, fname);
                let row;
                try {
                    row = JSON.parse(fs.readFileSync(disk, 'utf-8'));
                }
                catch {
                    continue;
                }
                const fp = feedPathOf(storage);
                const meta = storage?.type || '$class';
                const stub = `${fp === '/' ? '' : fp}/${meta}/logs/${day}/${fname}`;
                if (!matchesEntry(target, row, stub) && !(row?.path && sameLogPath(row.path.startsWith('/') ? row.path : '/' + row.path, target, shortTarget)))
                    continue;
                const uid = FS.$class.resolveUid(params);
                if (!internal && uid !== row.sender && !(await storage._isWorkAdmin?.(params)))
                    throw new Error('Доступ запрещён');
                row.includes ??= [];
                for (const p of includePaths) {
                    const normP = p.startsWith('/') ? p : '/' + p;
                    if (!row.includes.includes(normP))
                        row.includes.push(normP);
                }
                await fs.promises.writeFile(disk, JSON.stringify(row), 'utf-8');
                storage.reset?.();
                globalThis.WORK_RAG?.invalidate?.(disk);
                if (storage instanceof FS.$user || storage instanceof FS.$node) {
                    const safeIncludes = includePaths.map(p => p.startsWith('/') ? p : '/' + p);
                    await REFS.addRow(storage.principalId ?? storage.id, { time: row.time, includes: safeIncludes }, stub).catch(() => {});
                }
                return row;
            }
        }
    }
    return null;
}
