/**
 * Общая локальная БД индексов сервера (`./.index/work.db`, node:sqlite).
 * Используют подсистема доступа (индекс лент) и RAG. Открывается лениво:
 * пока никто не обратился, файл не создаётся (тесты и утилиты его не видят).
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.index';
const FILE = 'work.db';

let opened = null;
let failed = null;
const migrations = [];

/**
 * Зарегистрировать DDL подсистемы: выполняется при открытии (и сразу, если БД уже открыта).
 * @param {string} sql Идемпотентный DDL (CREATE … IF NOT EXISTS)
 */
export function registerSchema(sql) {
    migrations.push(sql);
    if (opened)
        opened.exec(sql);
}

/**
 * БД или null, если node:sqlite недоступен (подсистемы работают в деградированном режиме).
 * @returns {Promise<import('node:sqlite').DatabaseSync|null>}
 */
export async function indexDb() {
    if (opened || failed)
        return opened;
    try {
        const { DatabaseSync } = await importSqlite();
        if (opened)
            return opened;
        const dir = path.resolve(DIR);
        fs.mkdirSync(dir, { recursive: true });
        const db = new DatabaseSync(path.join(dir, FILE));
        db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
        for (const sql of migrations)
            db.exec(sql);
        opened = db;
    }
    catch (e) {
        failed = e;
        console.warn('[index-db] недоступна:', e.message);
    }
    return opened;
}

/** node:sqlite без разового ExperimentalWarning в логе сервера (остальные предупреждения не трогаем). */
async function importSqlite() {
    const emit = process.emitWarning;
    process.emitWarning = function (warning, ...rest) {
        const text = typeof warning === 'string' ? warning : warning?.message;
        if (/SQLite is an experimental feature/i.test(String(text)))
            return;
        return emit.call(process, warning, ...rest);
    };
    try {
        return await import('node:sqlite');
    }
    finally {
        process.emitWarning = emit;
    }
}

/** Синхронный доступ к уже открытой БД (null — ещё не открыта). */
export function indexDbSync() {
    return opened;
}

/** Выполнить fn в транзакции. */
export function transaction(db, fn) {
    db.exec('BEGIN');
    try {
        const res = fn();
        db.exec('COMMIT');
        return res;
    }
    catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* уже откатилась */ }
        throw e;
    }
}

/** Закрыть БД (тесты, остановка сервера). */
export function closeIndexDb() {
    try { opened?.close(); } catch { /* уже закрыта */ }
    opened = null;
    failed = null;
}
