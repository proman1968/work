/**
 * БД прикладных данных WORK (`./.data/work.db`, node:sqlite).
 * Источник истины для объектов справочников и операций, их версий и проводок
 * единого журнала. Метаданные (class.js) остаются файлами дерева; здесь — только
 * их кэш (`classes`, `class_tree`). В отличие от `.index/work.db` (RAG, ленты —
 * пересобираемые индексы) эту БД обязательно включать в резервную копию.
 *
 * Миграции — по `PRAGMA user_version`: каждый элемент MIGRATIONS выполняется один раз.
 */
import fs from 'node:fs';
import path from 'node:path';
import { importSqlite } from '../host/index-db.js';

export const DATA_DIR = '.data';
export const DATA_FILE = 'work.db';

/** Схема по версиям. Новая версия — новый элемент в конце; старые не правятся. */
export const MIGRATIONS = [
    // 1 — классы, объекты, версии, ссылки, полнотекстовый поиск, проводки, настройки
    `
    CREATE TABLE classes (
        cid    TEXT PRIMARY KEY,           -- стабильный id класса (CID в class.js, иначе путь)
        path   TEXT NOT NULL UNIQUE,       -- путь в дереве WORK (для показа и поиска)
        parent TEXT,                       -- cid ближайшего класса-предка по пути
        type   TEXT NOT NULL,              -- метапапка: $catalog, $operation, $account, $base, ...
        label  TEXT NOT NULL,
        own    TEXT NOT NULL DEFAULT '{}', -- собственный слой class.js (JSON без функций и геттеров)
        hash   TEXT NOT NULL DEFAULT ''    -- хеш own: обнаружение изменений
    );
    CREATE INDEX classes_parent ON classes(parent);

    CREATE TABLE class_tree (
        ancestor   TEXT NOT NULL,
        descendant TEXT NOT NULL,
        depth      INTEGER NOT NULL,       -- 0 — сам класс
        PRIMARY KEY (ancestor, descendant)
    ) WITHOUT ROWID;
    CREATE INDEX class_tree_descendant ON class_tree(descendant, depth);

    CREATE TABLE objects (
        id      TEXT PRIMARY KEY,
        cid     TEXT NOT NULL,             -- класс-лист, в котором создан объект
        status  TEXT NOT NULL,             -- справочник: active|deleted; операция: draft|registered|cancelled
        time    INTEGER NOT NULL,          -- дата объекта (для операции — дата факта), мс
        author  TEXT,
        place   TEXT,                      -- рабочее место регистрации
        unit    TEXT,                      -- подразделение регистрации (cid структуры)
        ext_of  TEXT,                      -- запись-расширение виртуального справочника: id реального объекта
        version INTEGER NOT NULL DEFAULT 1,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        body    TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX objects_cid_time  ON objects(cid, time);
    CREATE INDEX objects_unit_time ON objects(unit, time);
    CREATE INDEX objects_ext_of    ON objects(ext_of);

    CREATE TABLE object_versions (
        id         TEXT NOT NULL,
        version    INTEGER NOT NULL,
        valid_from INTEGER NOT NULL,       -- с какого момента действует версия, мс
        author     TEXT,
        status     TEXT NOT NULL,
        body       TEXT NOT NULL,
        PRIMARY KEY (id, version)
    ) WITHOUT ROWID;
    CREATE INDEX object_versions_valid ON object_versions(id, valid_from);

    CREATE TABLE refs (
        obj_id  TEXT NOT NULL,
        field   TEXT NOT NULL,             -- поле (для табличной части — 'таблица.поле')
        row     INTEGER NOT NULL DEFAULT -1,
        ref_id  TEXT NOT NULL,
        ref_cid TEXT
    );
    CREATE INDEX refs_obj ON refs(obj_id);
    CREATE INDEX refs_ref ON refs(ref_id);

    -- rowid строки поиска = rowid объекта (удаление и замена — по ключу, без прохода таблицы)
    CREATE VIRTUAL TABLE objects_fts USING fts5(
        text,
        tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE entries (
        id         INTEGER PRIMARY KEY,
        op_id      TEXT NOT NULL,
        op_version INTEGER NOT NULL,
        op_cid     TEXT NOT NULL,
        rule       TEXT NOT NULL,
        row        INTEGER NOT NULL DEFAULT -1, -- строка табличной части (each) или -1
        time       INTEGER NOT NULL,
        debit_cid  TEXT NOT NULL,
        credit_cid TEXT NOT NULL,
        amount     INTEGER NOT NULL DEFAULT 0,  -- копейки; сторно — с обратным знаком
        qty        REAL NOT NULL DEFAULT 0,     -- в базовой единице
        qty2       REAL NOT NULL DEFAULT 0,     -- второе измерение (масса/объём)
        doc_qty    REAL,
        doc_unit   TEXT,
        author     TEXT,
        place      TEXT,
        unit       TEXT,
        storno     INTEGER NOT NULL DEFAULT 0,
        created    INTEGER NOT NULL
    );
    CREATE INDEX entries_debit  ON entries(debit_cid, time);
    CREATE INDEX entries_credit ON entries(credit_cid, time);
    CREATE INDEX entries_unit   ON entries(unit, time);
    CREATE INDEX entries_op     ON entries(op_id);
    CREATE INDEX entries_time   ON entries(time);

    CREATE TABLE entry_analytics (
        entry_id INTEGER NOT NULL,
        side     TEXT NOT NULL CHECK (side IN ('D', 'C')),
        slot     TEXT NOT NULL,
        ref_id   TEXT NOT NULL,
        ref_cid  TEXT,
        PRIMARY KEY (entry_id, side, slot)
    ) WITHOUT ROWID;
    CREATE INDEX entry_analytics_ref ON entry_analytics(ref_id, entry_id);

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT
    );
    `,
    // 2 — явная двойная запись по классам счетов ($account): отдельная запись в счёте Дебета
    //     со своими аналитиками и отдельная запись в счёте Кредита со своими аналитиками
    `
    CREATE TABLE account_entries (
        id          INTEGER PRIMARY KEY,
        entry_id    INTEGER NOT NULL,          -- общий ключ проводки (связка Дт и Кт)
        side        TEXT NOT NULL CHECK (side IN ('D', 'C')),
        account_cid TEXT NOT NULL,             -- класс счёта ($account), владеющий записью
        corr_cid    TEXT NOT NULL,             -- корреспондирующий счёт
        op_id       TEXT NOT NULL,
        op_version  INTEGER NOT NULL,
        op_cid      TEXT NOT NULL,
        rule        TEXT NOT NULL,
        row         INTEGER NOT NULL DEFAULT -1,
        time        INTEGER NOT NULL,
        debit       INTEGER NOT NULL DEFAULT 0, -- копейки
        credit      INTEGER NOT NULL DEFAULT 0, -- копейки
        qty_in      REAL NOT NULL DEFAULT 0,
        qty_out     REAL NOT NULL DEFAULT 0,
        qty2        REAL NOT NULL DEFAULT 0,
        doc_qty     REAL,
        doc_unit    TEXT,
        analytics   TEXT NOT NULL DEFAULT '{}', -- JSON аналитик ИМЕННО этого счёта { слот: ref_id }
        author      TEXT,
        place       TEXT,
        unit        TEXT,
        storno      INTEGER NOT NULL DEFAULT 0,
        created     INTEGER NOT NULL
    );
    CREATE INDEX account_entries_acc_time ON account_entries(account_cid, time);
    CREATE INDEX account_entries_entry    ON account_entries(entry_id);
    CREATE INDEX account_entries_op       ON account_entries(op_id);
    `,
];

/** Применить недостающие миграции. @returns {number} версия схемы после миграции */
export function migrate(db) {
    const current = db.prepare('PRAGMA user_version').get().user_version;
    for (let v = current; v < MIGRATIONS.length; v++) {
        tx(db, () => {
            db.exec(MIGRATIONS[v]);
            db.exec(`PRAGMA user_version = ${v + 1}`);
        });
    }
    return MIGRATIONS.length;
}

/**
 * Открыть БД данных и привести схему к текущей версии.
 * @param {string} [file] Путь к файлу или ':memory:' (тесты). По умолчанию `./.data/work.db`.
 * @returns {Promise<import('node:sqlite').DatabaseSync>}
 */
export async function openDataDb(file = path.resolve(DATA_DIR, DATA_FILE)) {
    const { DatabaseSync } = await importSqlite();
    if (file !== ':memory:')
        fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -32000; PRAGMA mmap_size = 268435456;');
    migrate(db);
    return db;
}

let opened = null;
const openedByBase = new Map();

/**
 * Путь к файлу БД конкретной организации ($base): `<Организация>/$base/#system/work.db`.
 * Для пустого basePath (режим по умолчанию) — `./.data/work.db`.
 */
export function baseDbFile(rootDir = process.cwd(), basePath = '') {
    const norm = String(basePath ?? '').trim().replace(/\/+$/, '');
    if (norm && norm !== '/') {
        const rel = norm.replace(/^\/+/, '');
        return path.resolve(rootDir, rel, '$base', '#system', DATA_FILE);
    }
    return path.resolve(rootDir, DATA_DIR, DATA_FILE);
}

/**
 * БД данных организации ($base) или сервера по умолчанию.
 * @param {string} [basePath] Путь организации (например, '/ORGANIZATIONS/Маслоторг'); пусто — дефолтная БД
 */
export async function dataDb(basePath = '') {
    const key = String(basePath ?? '').trim().replace(/\/+$/, '');
    if (!key) {
        opened ??= openDataDb();
        return opened;
    }
    let p = openedByBase.get(key);
    if (!p) {
        p = openDataDb(baseDbFile(process.cwd(), key));
        openedByBase.set(key, p);
    }
    return p;
}

/**
 * Сбросить WAL-журнал БД организации в основной файл `work.db` перед архивацией.
 * @param {string} basePath Путь организации (например, '/ORGANIZATIONS/Деловая сфера')
 */
export async function checkpointBaseDb(basePath = '') {
    const key = String(basePath ?? '').trim().replace(/\/+$/, '');
    const file = baseDbFile(process.cwd(), key);
    if (!fs.existsSync(file))
        return;
    const p = openedByBase.get(key);
    if (p) {
        const db = await p;
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignore */ }
        return;
    }
    if (fs.existsSync(file + '-wal')) {
        const db = await openDataDb(file);
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignore */ }
        try { db.close(); } catch { /* ignore */ }
    }
}

/**
 * Закрыть соединение с БД конкретной организации (перед перезаписью из архива).
 * @param {string} basePath Путь организации
 */
export async function closeBaseDb(basePath = '') {
    const key = String(basePath ?? '').trim().replace(/\/+$/, '');
    const p = openedByBase.get(key);
    if (!p)
        return;
    openedByBase.delete(key);
    try {
        const db = await p;
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignore */ }
        db.close();
    }
    catch { /* ignore */ }
}

/** Закрыть открытые БД данных (тесты, остановка сервера). */
export async function closeDataDb() {
    const p = opened;
    opened = null;
    const list = [...openedByBase.values()];
    openedByBase.clear();
    if (p)
        (await p).close();
    for (const dbPromise of list) {
        try { (await dbPromise).close(); } catch { /* ignore */ }
    }
}

/** Значение настройки (JSON) или undefined. */
export function getSetting(db, key) {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
    return r ? JSON.parse(r.value) : undefined;
}

/** Записать настройку; null/undefined — удалить. */
export function setSetting(db, key, value) {
    if (value === undefined || value === null)
        db.prepare('DELETE FROM settings WHERE key = ?').run(String(key));
    else
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(String(key), JSON.stringify(value));
}

const depth = new WeakMap();
const dataGenerations = new WeakMap();

/** Поколение прикладных данных БД: растёт при каждом успешном COMMIT транзакции. */
export function dataGeneration(db) {
    return dataGenerations.get(db) || 0;
}

/** Принудительно увеличить поколение прикладных данных БД. */
export function bumpDataGeneration(db) {
    const next = (dataGenerations.get(db) || 0) + 1;
    dataGenerations.set(db, next);
    return next;
}

/**
 * Выполнить fn в транзакции. Вложенный вызов — точка сохранения (SAVEPOINT),
 * поэтому владельцы могут вызывать друг друга, не заботясь о внешней транзакции.
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn Синхронная функция (node:sqlite синхронный)
 * @returns {T}
 */
export function tx(db, fn) {
    const level = depth.get(db) || 0;
    const sp = 'sp' + level;
    db.exec(level ? `SAVEPOINT ${sp}` : 'BEGIN IMMEDIATE');
    depth.set(db, level + 1);
    try {
        const res = fn();
        if (typeof res?.then === 'function')
            throw new Error('tx: функция транзакции должна быть синхронной');
        db.exec(level ? `RELEASE ${sp}` : 'COMMIT');
        if (!level)
            bumpDataGeneration(db);
        return res;
    }
    catch (e) {
        db.exec(level ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
        throw e;
    }
    finally {
        depth.set(db, level);
    }
}
