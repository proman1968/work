/**
 * Кэш дерева классов в БД данных: таблицы `classes` и `class_tree`.
 *
 * Источник истины — файлы дерева: класс = папка с метапапкой `$тип`, собственный
 * слой — `<класс>/$тип/class.js`. Здесь дерево сканируется и складывается в БД,
 * чтобы иерархию (итоги по счёту со всеми субсчетами, объекты промежуточного
 * класса операций, подразделение со всеми вложенными) отвечал один SQL-запрос
 * по замыканию `class_tree`.
 *
 * Идентификатор класса `cid` всегда равен его пути в дереве WORK (`path`).
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tx } from './db.js';

/** Типы прикладных классов данных. */
export const DATA_TYPES = Object.freeze(['$catalog', '$virtual', '$struct', '$operation', '$account', '$register']);

/** Типы классов орг-структуры (подразделения), доменов и модулей. */
export const STRUCTURE_TYPES = Object.freeze(['$structure', '$base']);
export const MODULE_TYPES = Object.freeze(['$module']);
export const DOMAIN_TYPES = Object.freeze(['$domain']);

/** Корни дерева, которые сканируются по умолчанию. */
export const DEFAULT_ROOTS = Object.freeze(['MODULES', 'ORGANIZATIONS', 'DATA', 'BASE']);

/** Папки, которые не бывают классами. */
const SKIP = new Set(['node_modules', 'history', 'logs']);

/** Приоритет при нескольких метапапках в одной папке: известные типы раньше прочих. */
const KNOWN = [...DATA_TYPES, '$registry', ...STRUCTURE_TYPES, ...MODULE_TYPES, ...DOMAIN_TYPES];

/**
 * Копия значения без функций, геттеров и символов (только данные class.js).
 * Геттеры не вызываются: в class.js они могут обращаться к ядру.
 */
export function plainData(value, depth = 0) {
    if (depth > 32 || typeof value === 'function' || typeof value === 'symbol')
        return undefined;
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(v => plainData(v, depth + 1) ?? null);
    const out = {};
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!('value' in d))
            continue;
        const v = plainData(d.value, depth + 1);
        if (v !== undefined)
            out[key] = v;
    }
    return out;
}

const ownFileCache = new Map();

/** Собственный слой class.js как данные (импорт модуля с учётом времени изменения файла). */
async function readOwn(file) {
    let stat;
    try {
        stat = await fsp.stat(file);
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return {};
        throw e;
    }
    const mtime = Math.trunc(stat.mtimeMs);
    const cached = ownFileCache.get(file);
    if (cached && cached.mtime === mtime)
        return cached.data;
    const mod = await import(pathToFileURL(file).href + '?mtime=' + mtime);
    const data = plainData(mod.default ?? {}) || {};
    ownFileCache.set(file, { mtime, data });
    return data;
}

/**
 * Найти классы в дереве.
 * Идентификатор класса `cid` равен его пути `path`.
 * @param {string} rootDir Корень WORK на диске
 * @param {readonly string[]} [roots] Корневые папки сканирования (отсутствующие пропускаются)
 * @returns {Promise<{ classes: Array<{cid, path, type, label, own}>, problems: string[] }>}
 */
export async function scanClasses(rootDir, roots = DEFAULT_ROOTS) {
    const classes = [];
    const problems = [];

    async function visit(rel) {
        let entries;
        try {
            entries = await fsp.readdir(path.join(rootDir, rel), { withFileTypes: true });
        }
        catch (e) {
            if (e.code === 'ENOENT' || e.code === 'ENOTDIR')
                return;
            throw e;
        }
        const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
        const metas = dirs.filter(n => n.startsWith('$'));
        let selfItem = null;
        if (metas.length) {
            const ranked = [...metas].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
            const type = ranked[0];
            const clsPath = '/' + rel.split(path.sep).join('/');
            if (metas.length > 1)
                problems.push(`${clsPath}: несколько метапапок (${metas.join(', ')}), выбран ${type}`);
            let own = {};
            try {
                own = await readOwn(path.join(rootDir, rel, type, 'class.js'));
            }
            catch (e) {
                problems.push(`${clsPath}: class.js не загружен — ${e.message}`);
            }
            const label = typeof own.label === 'string' && own.label ? own.label : path.basename(rel);
            selfItem = { cid: clsPath, path: clsPath, type, label, own };
        }
        const childDirs = dirs.filter(name => !name.startsWith('$') && !name.startsWith('.') && !name.startsWith('#') && !SKIP.has(name));
        const subLists = await Promise.all(childDirs.map(name => visit(path.join(rel, name))));
        const out = selfItem ? [selfItem] : [];
        for (const sub of subLists) {
            if (sub?.length)
                out.push(...sub);
        }
        return out;
    }

    const rootLists = await Promise.all(roots.map(root => visit(root)));
    for (const list of rootLists) {
        if (list?.length)
            classes.push(...list);
    }

    return { classes, problems };
}

function rank(meta) {
    const i = KNOWN.indexOf(meta);
    return i < 0 ? KNOWN.length : i;
}

const generations = new WeakMap();

/** Поколение кэша классов БД: растёт при каждом изменении (сброс производных кэшей — схем). */
export function classesGeneration(db) {
    return generations.get(db) || 0;
}

function hashOf(own) {
    return crypto.createHash('sha1').update(JSON.stringify(own)).digest('hex');
}

/**
 * Записать найденные классы в БД: upsert, удаление исчезнувших, пересборка замыкания.
 * Родитель класса — ближайший найденный класс-предок по пути.
 * @returns {{ total: number, changed: number, removed: number }}
 */
export function syncClasses(db, classes) {
    const byPath = new Map(classes.map(c => [c.path, c]));
    const parentOf = c => {
        for (let p = path.posix.dirname(c.path); p !== '/' && p !== '.'; p = path.posix.dirname(p)) {
            const hit = byPath.get(p);
            if (hit)
                return hit.cid;
        }
        return null;
    };
    return tx(db, () => {
        const old = new Map(db.prepare('SELECT cid, path, parent, type, label, hash FROM classes').all().map(r => [r.cid, r]));
        const upsert = db.prepare(`
            INSERT INTO classes (cid, path, parent, type, label, own, hash) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cid) DO UPDATE SET path = excluded.path, parent = excluded.parent, type = excluded.type,
                label = excluded.label, own = excluded.own, hash = excluded.hash`);
        let changed = 0;
        const del = db.prepare('DELETE FROM classes WHERE cid = ?');
        const keep = new Set(classes.map(c => c.cid));
        let removed = 0;
        for (const cid of old.keys()) {
            if (!keep.has(cid)) {
                del.run(cid);
                removed++;
            }
        }
        for (const c of classes) {
            const parent = parentOf(c);
            const hash = hashOf(c.own);
            const prev = old.get(c.cid);
            if (prev && prev.path === c.path && prev.parent === parent && prev.type === c.type && prev.label === c.label && prev.hash === hash)
                continue;
            if (prev?.path !== c.path)
                db.prepare('DELETE FROM classes WHERE path = ? AND cid <> ?').run(c.path, c.cid);
            upsert.run(c.cid, c.path, parent, c.type, c.label, JSON.stringify(c.own), hash);
            changed++;
        }
        if (changed || removed) {
            rebuildTree(db);
            generations.set(db, classesGeneration(db) + 1);
        }
        return { total: classes.length, changed, removed };
    });
}

/** Пересобрать замыкание иерархии из `classes.parent`. */
export function rebuildTree(db) {
    tx(db, () => {
        db.exec('DELETE FROM class_tree');
        const parent = new Map(db.prepare('SELECT cid, parent FROM classes').all().map(r => [r.cid, r.parent]));
        const ins = db.prepare('INSERT INTO class_tree (ancestor, descendant, depth) VALUES (?, ?, ?)');
        for (const cid of parent.keys()) {
            const seen = new Set();
            for (let a = cid, d = 0; a && parent.has(a) && !seen.has(a); a = parent.get(a), d++) {
                seen.add(a);
                ins.run(a, cid, d);
            }
        }
        generations.set(db, classesGeneration(db) + 1);
    });
}

/**
 * Просканировать дерево и обновить кэш классов.
 * @returns {Promise<{ total: number, changed: number, removed: number, problems: string[] }>}
 */
export async function refreshClasses(db, rootDir, roots = DEFAULT_ROOTS) {
    const { classes, problems } = await scanClasses(rootDir, roots);
    return { ...syncClasses(db, classes), problems };
}

const classIndexCache = new WeakMap();

/**
 * Построить или вернуть из памяти индекс всех классов и замыкания иерархии БД.
 * Сбрасывается автоматически при изменении `classesGeneration(db)`.
 */
function getClassIndex(db) {
    const gen = classesGeneration(db);
    let idx = classIndexCache.get(db);
    if (idx && idx.gen === gen)
        return idx;

    const byCid = new Map();
    const byPath = new Map();
    const childrenByParent = new Map();
    const nonVirtualChildParents = new Set();
    const allSortedByPath = [];

    const rows = db.prepare('SELECT cid, path, parent, type, label, own FROM classes ORDER BY path').all();
    for (const r of rows) {
        const item = {
            cid: r.cid,
            path: r.path,
            parent: r.parent,
            type: r.type,
            label: r.label,
            own: r.own ? JSON.parse(r.own) : {},
        };
        byCid.set(item.cid, item);
        byPath.set(item.path, item);
        allSortedByPath.push(item);
        if (item.parent) {
            let list = childrenByParent.get(item.parent);
            if (!list)
                childrenByParent.set(item.parent, list = []);
            list.push(item);
            if (item.type !== '$virtual')
                nonVirtualChildParents.add(item.parent);
        }
    }
    for (const list of childrenByParent.values())
        list.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

    const descByAncestor = new Map();
    const treeRows = db.prepare('SELECT ancestor, descendant, depth FROM class_tree ORDER BY ancestor, depth, descendant').all();
    for (const tr of treeRows) {
        let dList = descByAncestor.get(tr.ancestor);
        if (!dList)
            descByAncestor.set(tr.ancestor, dList = []);
        dList.push(tr.descendant);
    }

    const ancByDescendant = new Map();
    for (const item of allSortedByPath) {
        const chain = [];
        const seen = new Set();
        for (let cur = item; cur && !seen.has(cur.cid); cur = cur.parent ? byCid.get(cur.parent) : null) {
            seen.add(cur.cid);
            chain.unshift(cur);
        }
        ancByDescendant.set(item.cid, chain);
    }

    idx = {
        gen,
        byCid,
        byPath,
        childrenByParent,
        nonVirtualChildParents,
        descByAncestor,
        ancByDescendant,
        allSortedByPath,
    };
    classIndexCache.set(db, idx);
    return idx;
}

function cloneClassRow(r) {
    return r ? { ...r } : null;
}

/** Класс по пути (null — нет). */
export function getClass(db, ref) {
    const key = String(ref ?? '');
    if (!key)
        return null;
    const idx = getClassIndex(db);
    return cloneClassRow(idx.byCid.get(key) || idx.byPath.get(key));
}

/**
 * Пути потомков класса.
 * @param {object} [opts] { self = true — включая сам класс }
 * @returns {string[]}
 */
export function descendants(db, cid, { self = true } = {}) {
    const list = getClassIndex(db).descByAncestor.get(String(cid ?? ''));
    if (!list?.length)
        return [];
    return self ? list.slice() : list.slice(1);
}

/**
 * Цепочка предков от корня к классу.
 * @param {object} [opts] { self = true — включая сам класс }
 * @returns {Array<{cid, path, parent, type, label, own}>}
 */
export function ancestors(db, cid, { self = true } = {}) {
    const chain = getClassIndex(db).ancByDescendant.get(String(cid ?? ''));
    if (!chain?.length)
        return [];
    const slice = self ? chain : chain.slice(0, -1);
    return slice.map(cloneClassRow);
}

/** Прямые дочерние классы. */
export function children(db, cid) {
    const list = getClassIndex(db).childrenByParent.get(String(cid ?? ''));
    return list ? list.map(cloneClassRow) : [];
}

/** Лист — класс без дочерних классов своего реального типа (виртуальные справочники $virtual всегда листья для своих расширений и не превращают родительский $catalog в не-лист). */
export function isLeaf(db, cid) {
    const key = String(cid ?? '');
    const idx = getClassIndex(db);
    const cls = idx.byCid.get(key) || idx.byPath.get(key);
    if (cls?.type === '$virtual')
        return true;
    const targetCid = cls?.cid || key;
    return !idx.nonVirtualChildParents.has(targetCid);
}

/** Все классы типа (или типов). */
export function classesOfType(db, types) {
    const set = new Set([].concat(types).map(String));
    return getClassIndex(db).allSortedByPath.filter(c => set.has(c.type)).map(cloneClassRow);
}
