/**
 * Индекс лент: запись в ленте пользователя (его кабинете) открывает ему то,
 * на что она указывает (`path`, `includes`) — ровно эту версию (снимок).
 * Наполняется при записи в ленту (logs.appendRow) и при индексации кабинетов (RAG).
 */
import { indexDb, indexDbSync, registerSchema } from '../../host/index-db.js';

registerSchema(`
CREATE TABLE IF NOT EXISTS feed_refs(
    uid TEXT NOT NULL,
    target TEXT NOT NULL,
    entry TEXT NOT NULL DEFAULT '',
    time INTEGER,
    PRIMARY KEY (uid, target, entry)
);
CREATE INDEX IF NOT EXISTS feed_refs_target ON feed_refs(target);
`);

/** Каноническая форма пути: с ведущим `/`, прямые слэши, без хвостового `/`. */
export function normPath(p) {
    let s = String(p ?? '').trim().replace(/\\/g, '/');
    if (!s)
        return '';
    if (s.startsWith('./'))
        s = s.slice(1);
    if (!s.startsWith('/'))
        s = '/' + s;
    return s.replace(/\/+$/, '') || '/';
}

/** Цели записи ленты: path + includes. */
export function rowTargets(row) {
    const out = [];
    if (row?.path)
        out.push(normPath(row.path));
    for (const p of row?.includes || [])
        if (p)
            out.push(normPath(p));
    return [...new Set(out.filter(Boolean))];
}

/**
 * Отметить, что запись ленты пользователя uid ссылается на цели.
 * @param {string} uid
 * @param {object} row Запись лога
 * @param {string} [entry] Путь .logs-файла записи
 */
export async function addRow(uid, row, entry = '') {
    const targets = rowTargets(row);
    if (!uid || !targets.length)
        return;
    const db = await indexDb();
    if (!db)
        return;
    const stmt = db.prepare('INSERT OR IGNORE INTO feed_refs(uid, target, entry, time) VALUES (?, ?, ?, ?)');
    for (const t of targets)
        stmt.run(String(uid), t, String(entry || ''), Number(row?.time) || Date.now());
}

/** Убрать ссылки записи (запись удалена/пересобрана). */
export async function removeEntry(entry) {
    const db = await indexDb();
    if (!db || !entry)
        return;
    db.prepare('DELETE FROM feed_refs WHERE entry = ?').run(String(entry));
}

/**
 * Виден ли путь пользователю через его ленту.
 * @param {string} uid
 * @param {string} path Путь элемента
 */
export async function visible(uid, path) {
    if (!uid || !path)
        return false;
    const db = indexDbSync() || await indexDb();
    if (!db)
        return false;
    const p = normPath(path);
    const row = db.prepare('SELECT 1 FROM feed_refs WHERE uid = ? AND target = ? LIMIT 1').get(String(uid), p);
    return !!row;
}

/** Все цели ленты пользователя (для RAG: контекст «моя лента»). */
export async function targetsOf(uid, limit = 5000) {
    const db = await indexDb();
    if (!db || !uid)
        return [];
    return db.prepare('SELECT target, MAX(time) AS time FROM feed_refs WHERE uid = ? GROUP BY target ORDER BY time DESC LIMIT ?')
        .all(String(uid), limit);
}
