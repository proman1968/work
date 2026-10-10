/**
 * Хранилище RAG в общей БД индексов (`.index/work.db`).
 *  - rag_docs     — физические документы: путь, вид, hash содержимого, класс-владелец;
 *  - rag_content  — содержимое по hash: одно содержимое (живой файл и его снимки, копии
 *                   записи лога в нескольких лентах) — одни чанки и эмбеддинги;
 *  - rag_chunks   — чанки: текст, раздел, позиция, вектор (Float32 BLOB) + FTS5 (BM25);
 *  - rag_assign   — назначения ролей по классам (для колец поиска по другим точкам);
 *  - rag_classes  — известные классы (пути), для обхода нижестоящих точек.
 */
import { indexDb, registerSchema, transaction } from '../../host/index-db.js';

registerSchema(`
CREATE TABLE IF NOT EXISTS rag_docs(
    path TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    hash TEXT,
    mtime INTEGER,
    size INTEGER,
    class_dir TEXT,
    title TEXT,
    meta TEXT,
    error TEXT,
    indexed_at INTEGER
);
CREATE INDEX IF NOT EXISTS rag_docs_hash ON rag_docs(hash);
CREATE INDEX IF NOT EXISTS rag_docs_class ON rag_docs(class_dir);
CREATE TABLE IF NOT EXISTS rag_content(
    hash TEXT PRIMARY KEY,
    chunks INTEGER,
    created_at INTEGER
);
CREATE TABLE IF NOT EXISTS rag_chunks(
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL,
    ord INTEGER,
    heading TEXT,
    start INTEGER,
    "end" INTEGER,
    text TEXT,
    vec BLOB
);
CREATE INDEX IF NOT EXISTS rag_chunks_hash ON rag_chunks(hash);
CREATE VIRTUAL TABLE IF NOT EXISTS rag_fts USING fts5(
    text, heading, content='rag_chunks', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS rag_assign(
    class_path TEXT NOT NULL,
    role TEXT NOT NULL,
    uid TEXT NOT NULL,
    PRIMARY KEY (class_path, role, uid)
);
CREATE INDEX IF NOT EXISTS rag_assign_uid ON rag_assign(uid);
CREATE TABLE IF NOT EXISTS rag_classes(
    path TEXT PRIMARY KEY,
    type TEXT,
    label TEXT
);
CREATE TABLE IF NOT EXISTS rag_meta(
    key TEXT PRIMARY KEY,
    value TEXT
);
`);

let db = null;
const stmts = new Map();

/**
 * Открыть хранилище. Если версия индекса (модель | чанкер) изменилась —
 * содержимое сбрасывается, документы переиндексируются сверкой.
 */
export async function open() {
    if (db)
        return db;
    const d = await indexDb();
    if (!d)
        return null;
    db = d;
    const { contentVersion } = await import('./config.js');
    const version = contentVersion();
    const row = st('SELECT value FROM rag_meta WHERE key = ?').get('version');
    if (row?.value !== version) {
        transaction(db, () => {
            db.exec("DELETE FROM rag_docs; DELETE FROM rag_chunks; DELETE FROM rag_content; INSERT INTO rag_fts(rag_fts) VALUES('delete-all');");
            st('INSERT OR REPLACE INTO rag_meta(key, value) VALUES (?, ?)').run('version', version);
        });
    }
    return db;
}

function st(sql) {
    let s = stmts.get(sql);
    if (!s) {
        s = db.prepare(sql);
        stmts.set(sql, s);
    }
    return s;
}

/** Векторный кэш: hash → [{id, vec}] (чтение BLOB из БД — один раз на содержимое). */
const vecCache = new Map();
const VEC_CACHE_MAX = 200_000;
let vecCacheSize = 0;

function toBlob(vec) {
    return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

function fromBlob(blob) {
    const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    const copy = new Uint8Array(u8);
    return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

export function getDoc(path) {
    return st('SELECT * FROM rag_docs WHERE path = ?').get(path) || null;
}

export function hasContent(hash) {
    return !!st('SELECT 1 FROM rag_content WHERE hash = ?').get(hash);
}

/**
 * Сохранить содержимое (чанки + векторы), если его ещё нет.
 * @param {string} hash
 * @param {Array<{text, heading, start, end}>} chunks
 * @param {Float32Array[]} vecs
 */
export function putContent(hash, chunks, vecs) {
    if (hasContent(hash))
        return;
    transaction(db, () => {
        const ins = st('INSERT INTO rag_chunks(hash, ord, heading, start, "end", text, vec) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const fts = st('INSERT INTO rag_fts(rowid, text, heading) VALUES (?, ?, ?)');
        chunks.forEach((c, i) => {
            const r = ins.run(hash, i, c.heading || '', c.start ?? 0, c.end ?? 0, c.text, vecs[i] ? toBlob(vecs[i]) : null);
            fts.run(Number(r.lastInsertRowid), c.text, c.heading || '');
        });
        st('INSERT INTO rag_content(hash, chunks, created_at) VALUES (?, ?, ?)').run(hash, chunks.length, Date.now());
    });
}

/** Записать/обновить документ. */
export function upsertDoc(doc) {
    const prev = getDoc(doc.path);
    st(`INSERT INTO rag_docs(path, kind, hash, mtime, size, class_dir, title, meta, error, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, hash=excluded.hash, mtime=excluded.mtime,
            size=excluded.size, class_dir=excluded.class_dir, title=excluded.title, meta=excluded.meta,
            error=excluded.error, indexed_at=excluded.indexed_at`)
        .run(doc.path, doc.kind, doc.hash ?? null, doc.mtime ?? 0, doc.size ?? 0, doc.class_dir ?? '',
            doc.title ?? '', doc.meta ? JSON.stringify(doc.meta) : null, doc.error ?? null, Date.now());
    if (prev?.hash && prev.hash !== doc.hash)
        gcContent(prev.hash);
    if (!prev || prev.hash !== doc.hash || prev.kind !== doc.kind)
        bump();
}

/** Удалить документ (и поддерево, если это папка). Возвращает число удалённых. */
export function removeDocs(path) {
    const rows = st("SELECT path, hash FROM rag_docs WHERE path = ? OR (path > ? AND path < ?)")
        .all(path, path + '/', path + '0');
    if (!rows.length)
        return 0;
    transaction(db, () => {
        const del = st('DELETE FROM rag_docs WHERE path = ?');
        for (const r of rows)
            del.run(r.path);
    });
    for (const h of new Set(rows.map(r => r.hash).filter(Boolean)))
        gcContent(h);
    bump();
    return rows.length;
}

/** Удалить содержимое, на которое больше не ссылается ни один документ. */
function gcContent(hash) {
    if (st('SELECT 1 FROM rag_docs WHERE hash = ? LIMIT 1').get(hash))
        return;
    const chunks = st('SELECT id, text, heading FROM rag_chunks WHERE hash = ?').all(hash);
    transaction(db, () => {
        const fdel = st("INSERT INTO rag_fts(rag_fts, rowid, text, heading) VALUES ('delete', ?, ?, ?)");
        for (const c of chunks)
            fdel.run(c.id, c.text, c.heading);
        st('DELETE FROM rag_chunks WHERE hash = ?').run(hash);
        st('DELETE FROM rag_content WHERE hash = ?').run(hash);
    });
    const cached = vecCache.get(hash);
    if (cached) {
        vecCacheSize -= cached.length;
        vecCache.delete(hash);
    }
}

/** Документы непосредственно под физической папкой dir (префиксом пути). */
export function docsUnder(dir) {
    return st('SELECT path, kind, hash, title, class_dir, meta FROM rag_docs WHERE hash IS NOT NULL AND path > ? AND path < ?')
        .all(dir + '/', dir + '0');
}

/** Документы, чей ближайший класс-владелец — classDir (собственное дерево точки вне метапапки). */
export function docsByClassDir(classDir) {
    return st('SELECT path, kind, hash, title, class_dir, meta FROM rag_docs WHERE hash IS NOT NULL AND class_dir = ?')
        .all(classDir);
}

/** Полная замена реестра классов (после обхода диска). */
export function replaceClasses(list) {
    transaction(db, () => {
        st('DELETE FROM rag_classes').run();
        const ins = st('INSERT OR REPLACE INTO rag_classes(path, type, label) VALUES (?, ?, ?)');
        for (const c of list)
            ins.run(c.path, c.type || '', c.label || '');
    });
}

/** Счётчик изменений индекса (для кэшей областей поиска). */
let generation = 0;
export function bump() {
    generation++;
}
export function currentGeneration() {
    return generation;
}

export function docsByPaths(paths) {
    const out = [];
    const s = st('SELECT path, kind, hash, title, class_dir, meta FROM rag_docs WHERE path = ? AND hash IS NOT NULL');
    for (const p of paths) {
        const r = s.get(p);
        if (r)
            out.push(r);
    }
    return out;
}

/** Все пути документов с mtime (для сверки с диском). */
export function allDocStamps() {
    return st('SELECT path, mtime, hash FROM rag_docs').all();
}

/** Векторы чанков содержимого (из кэша или БД). */
export function vectorsOf(hash) {
    let list = vecCache.get(hash);
    if (list)
        return list;
    list = st('SELECT id, vec FROM rag_chunks WHERE hash = ? ORDER BY ord').all(hash)
        .filter(r => r.vec)
        .map(r => ({ id: r.id, vec: fromBlob(r.vec) }));
    if (vecCacheSize + list.length > VEC_CACHE_MAX) {
        vecCache.clear();
        vecCacheSize = 0;
    }
    vecCache.set(hash, list);
    vecCacheSize += list.length;
    return list;
}

/** BM25 по чанкам: [{id, hash, score}] (score — чем меньше, тем лучше, как в bm25()). */
export function ftsSearch(match, limit) {
    if (!match)
        return [];
    try {
        return st(`SELECT c.id AS id, c.hash AS hash, bm25(rag_fts) AS score
                   FROM rag_fts JOIN rag_chunks c ON c.id = rag_fts.rowid
                   WHERE rag_fts MATCH ? ORDER BY score LIMIT ?`).all(match, limit);
    }
    catch {
        return [];
    }
}

export function chunksByIds(ids) {
    const s = st('SELECT id, hash, ord, heading, start, "end" AS "end", text FROM rag_chunks WHERE id = ?');
    return ids.map(id => s.get(id)).filter(Boolean);
}

/** Назначения ролей класса (перезапись). */
export function setAssignments(classPath, rows) {
    transaction(db, () => {
        st('DELETE FROM rag_assign WHERE class_path = ?').run(classPath);
        const ins = st('INSERT OR IGNORE INTO rag_assign(class_path, role, uid) VALUES (?, ?, ?)');
        for (const r of rows)
            ins.run(classPath, r.role, r.uid);
    });
}

export function assignmentsOf(uid) {
    return st('SELECT class_path, role FROM rag_assign WHERE uid = ?').all(uid);
}

export function putClass(path, type, label) {
    st('INSERT INTO rag_classes(path, type, label) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET type=excluded.type, label=excluded.label')
        .run(path, type || '', label || '');
}

export function removeClassesUnder(path) {
    st('DELETE FROM rag_classes WHERE path = ? OR (path > ? AND path < ?)').run(path, path + '/', path + '0');
    st('DELETE FROM rag_assign WHERE class_path = ? OR (class_path > ? AND class_path < ?)').run(path, path + '/', path + '0');
}

/** Классы строго ниже path (для охвата subtree). */
export function classesBelow(path, limit = 500) {
    const base = path === '/' ? '' : path;
    return st('SELECT path FROM rag_classes WHERE path > ? AND path < ? LIMIT ?').all(base + '/', base + '0', limit).map(r => r.path);
}

export function stats() {
    return {
        docs: st('SELECT COUNT(*) AS n FROM rag_docs').get().n,
        indexed: st('SELECT COUNT(*) AS n FROM rag_docs WHERE hash IS NOT NULL').get().n,
        errors: st('SELECT COUNT(*) AS n FROM rag_docs WHERE error IS NOT NULL').get().n,
        contents: st('SELECT COUNT(*) AS n FROM rag_content').get().n,
        chunks: st('SELECT COUNT(*) AS n FROM rag_chunks').get().n,
        classes: st('SELECT COUNT(*) AS n FROM rag_classes').get().n,
        lastErrors: st('SELECT path, error FROM rag_docs WHERE error IS NOT NULL ORDER BY indexed_at DESC LIMIT 10').all(),
    };
}
