/**
 * Инспектор и редактор SQLite-баз WORK (`sources/data/sql-inspector.js`).
 *
 * Позволяет администратору (`ADMIN`) просматривать структуру (таблицы, колонки,
 * индексы, физические и логические связи ER) и содержимое всех SQL-баз:
 *  - на уровне организации (`$base`) — изолированной БД `<Организация>/$base/#system/work.db`;
 *  - на уровне сервера (`$server`) — прикладной БД `./.data/work.db`, индексной БД `./.index/work.db`
 *    и баз организаций `/ORGANIZATIONS/*`.
 * Поддерживает фильтрацию, поиск, переходы по внешним ключам, редактирование, добавление и удаление строк.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataStore, resolveBasePath, markClassesDirty } from './api.js';
import { baseDbFile, tx, bumpDataGeneration } from './db.js';
import { DataError } from './errors.js';
import { indexDb } from '../host/index-db.js';

/** Человекочитаемые описания таблиц WORK и индекса. */
export const TABLE_DESCRIPTIONS = Object.freeze({
    classes: 'Кэш классов дерева WORK и их собственных метаданных (class.js)',
    class_tree: 'Транзитивное замыкание иерархии классов (ancestor → descendant)',
    objects: 'Объекты справочников ($catalog) и документы операций ($operation)',
    object_versions: 'Версии объектов и история изменений во времени (valid_from)',
    refs: 'Ссылки между объектами (поля Link и строки табличных частей)',
    objects_fts: 'Полнотекстовый индекс объектов (FTS5 unicode61)',
    entries: 'Журнал двойных проводок (связка Дебет ↔ Кредит по операциям)',
    entry_analytics: 'Субконто (аналитики) проводок журнала по сторонам Дт и Кт',
    account_entries: 'Записи регистров по классам счетов ($account) со своими аналитиками',
    logs: 'Журнал событий, чатов подразделений, классов и личных кабинетов',
    doc_links: 'Подшивка документов (связи «Основание → Следствие» между операциями)',
    settings: 'Системные параметры и настройки базы данных (в т.ч. дата закрытия периода)',
    // Таблицы .index/work.db
    rag_docs: 'RAG: проиндексированные документы и файлы дерева',
    rag_contents: 'RAG: дедуплицированное текстовое содержимое по SHA-256 hash',
    rag_chunks: 'RAG: текстовые фрагменты (чанки) документов',
    rag_vectors: 'RAG: эмбеддинги (векторы) чанков для семантического поиска',
    rag_chunks_fts: 'RAG: полнотекстовый индекс чанков (FTS5)',
    rag_grants: 'RAG: права видимости областей для фильтрации поиска',
    rag_classes: 'RAG: реестр проиндексированных классов',
    agent_usage: 'ИИ-агент: учёт расхода токенов и стоимости ходов по дням и задачам',
    agent_schedules: 'ИИ-агент: расписания автоматического запуска задач (.task)',
    feed_index: 'Индекс лент событий и обратных ссылок доступа',
    node_nonces: 'Федерация узлов (/NODES): одноразовые nonce подписанных запросов',
});

/**
 * Логические связи между таблицами схемы WORK и индекса
 * (в дополнение к физическим PRAGMA foreign_key_list).
 */
export const LOGICAL_RELATIONS = Object.freeze([
    { fromTable: 'classes', fromColumn: 'parent', toTable: 'classes', toColumn: 'cid', label: 'Родительский класс' },
    { fromTable: 'class_tree', fromColumn: 'ancestor', toTable: 'classes', toColumn: 'cid', label: 'Класс-предок' },
    { fromTable: 'class_tree', fromColumn: 'descendant', toTable: 'classes', toColumn: 'cid', label: 'Класс-потомок' },
    { fromTable: 'objects', fromColumn: 'cid', toTable: 'classes', toColumn: 'cid', label: 'Класс объекта' },
    { fromTable: 'objects', fromColumn: 'unit', toTable: 'classes', toColumn: 'cid', label: 'Подразделение' },
    { fromTable: 'objects', fromColumn: 'ext_of', toTable: 'objects', toColumn: 'id', label: 'Базовый объект ($virtual)' },
    { fromTable: 'object_versions', fromColumn: 'id', toTable: 'objects', toColumn: 'id', label: 'Объект версии' },
    { fromTable: 'refs', fromColumn: 'obj_id', toTable: 'objects', toColumn: 'id', label: 'Объект-источник' },
    { fromTable: 'refs', fromColumn: 'ref_id', toTable: 'objects', toColumn: 'id', label: 'Целевой объект' },
    { fromTable: 'refs', fromColumn: 'ref_cid', toTable: 'classes', toColumn: 'cid', label: 'Целевой класс' },
    { fromTable: 'entries', fromColumn: 'op_id', toTable: 'objects', toColumn: 'id', label: 'Операция проводки' },
    { fromTable: 'entries', fromColumn: 'op_cid', toTable: 'classes', toColumn: 'cid', label: 'Класс операции' },
    { fromTable: 'entries', fromColumn: 'debit_cid', toTable: 'classes', toColumn: 'cid', label: 'Счёт дебета' },
    { fromTable: 'entries', fromColumn: 'credit_cid', toTable: 'classes', toColumn: 'cid', label: 'Счёт кредита' },
    { fromTable: 'entries', fromColumn: 'unit', toTable: 'classes', toColumn: 'cid', label: 'Подразделение' },
    { fromTable: 'entry_analytics', fromColumn: 'entry_id', toTable: 'entries', toColumn: 'id', label: 'Проводка журнала' },
    { fromTable: 'entry_analytics', fromColumn: 'ref_id', toTable: 'objects', toColumn: 'id', label: 'Объект субконто' },
    { fromTable: 'entry_analytics', fromColumn: 'ref_cid', toTable: 'classes', toColumn: 'cid', label: 'Класс субконто' },
    { fromTable: 'account_entries', fromColumn: 'entry_id', toTable: 'entries', toColumn: 'id', label: 'Проводка журнала' },
    { fromTable: 'account_entries', fromColumn: 'account_cid', toTable: 'classes', toColumn: 'cid', label: 'Счёт записи' },
    { fromTable: 'account_entries', fromColumn: 'corr_cid', toTable: 'classes', toColumn: 'cid', label: 'Корр. счёт' },
    { fromTable: 'account_entries', fromColumn: 'op_id', toTable: 'objects', toColumn: 'id', label: 'Операция проводки' },
    { fromTable: 'account_entries', fromColumn: 'op_cid', toTable: 'classes', toColumn: 'cid', label: 'Класс операции' },
    { fromTable: 'account_entries', fromColumn: 'unit', toTable: 'classes', toColumn: 'cid', label: 'Подразделение' },
    { fromTable: 'doc_links', fromColumn: 'source_id', toTable: 'objects', toColumn: 'id', label: 'Документ-основание' },
    { fromTable: 'doc_links', fromColumn: 'target_id', toTable: 'objects', toColumn: 'id', label: 'Документ-следствие' },
    // Индексная БД (.index/work.db)
    { fromTable: 'rag_docs', fromColumn: 'hash', toTable: 'rag_contents', toColumn: 'hash', label: 'Контент по SHA-256' },
    { fromTable: 'rag_chunks', fromColumn: 'doc_path', toTable: 'rag_docs', toColumn: 'path', label: 'Документ фрагмента' },
    { fromTable: 'rag_vectors', fromColumn: 'chunk_id', toTable: 'rag_chunks', toColumn: 'id', label: 'Фрагмент вектора' },
]);

const FTS_SHADOW_SUFFIXES = ['_data', '_idx', '_content', '_docsize', '_config'];

function escapeIdent(ident) {
    return String(ident ?? '').replace(/"/g, '""');
}

function fileSizeSafe(filePath) {
    try {
        return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    }
    catch {
        return 0;
    }
}

function inspectDbQuickStats(db, absFile) {
    const sizeBytes = fileSizeSafe(absFile);
    const walBytes = fileSizeSafe(absFile + '-wal');
    let userVersion = 0;
    let journalMode = '';
    let tableCount = 0;
    if (db) {
        try {
            userVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version) || 0;
            journalMode = String(db.prepare('PRAGMA journal_mode').get()?.journal_mode || '');
            const rows = db.prepare(`
                SELECT name, sql FROM sqlite_master
                WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
            `).all();
            const ftsRoots = new Set(
                rows.filter(r => /^CREATE\s+VIRTUAL\s+TABLE/i.test(String(r.sql || ''))).map(r => r.name)
            );
            tableCount = rows.filter(r => {
                for (const root of ftsRoots) {
                    if (FTS_SHADOW_SUFFIXES.some(suf => r.name === root + suf))
                        return false;
                }
                return true;
            }).length;
        }
        catch { /* ignore */ }
    }
    return {
        exists: fs.existsSync(absFile),
        sizeBytes,
        walBytes,
        totalBytes: sizeBytes + walBytes,
        userVersion,
        journalMode,
        tableCount,
    };
}

/**
 * Проверить права ADMIN на элементе вызова.
 */
async function assertAdminAccess(item, params = {}) {
    if (item && typeof item.assertAccess === 'function')
        await item.assertAccess(params, 'ADMIN');
}

/**
 * Список доступных SQL-баз для текущего контекста (`$server` или `$base`).
 */
export async function listSqlDatabases(item, params = {}) {
    await assertAdminAccess(item, params);
    const rootDir = process.cwd();
    const itemBasePath = resolveBasePath(item);

    // Если открыта конкретная организация ($base) — показываем строго её изолированную БД
    if (itemBasePath) {
        const orgName = itemBasePath.split('/').filter(Boolean).pop() || itemBasePath;
        const absFile = baseDbFile(rootDir, itemBasePath);
        const relFile = path.relative(rootDir, absFile).replace(/\\/g, '/');
        const db = await dataStore(itemBasePath);
        const stats = inspectDbQuickStats(db, absFile);
        return {
            scope: 'base',
            basePath: itemBasePath,
            databases: [
                {
                    id: `base:${itemBasePath}`,
                    label: `${orgName} (work.db)`,
                    kind: 'base',
                    basePath: itemBasePath,
                    file: relFile,
                    ...stats,
                },
            ],
        };
    }

    // На уровне корневого сервера WORK ($server) доступны серверные БД и базы всех организаций
    const databases = [];

    // 1. Прикладная БД сервера (.data/work.db)
    const serverDataFile = baseDbFile(rootDir, '');
    const serverDataDb = await dataStore('');
    databases.push({
        id: 'data',
        label: 'WORK — Прикладная БД (.data/work.db)',
        kind: 'server-data',
        basePath: '',
        file: path.relative(rootDir, serverDataFile).replace(/\\/g, '/'),
        ...inspectDbQuickStats(serverDataDb, serverDataFile),
    });

    // 2. Индексная БД сервера (.index/work.db)
    const indexFile = path.resolve(rootDir, '.index', 'work.db');
    const idxDb = await indexDb();
    databases.push({
        id: 'index',
        label: 'WORK — Индексная БД (.index/work.db)',
        kind: 'server-index',
        basePath: '',
        file: path.relative(rootDir, indexFile).replace(/\\/g, '/'),
        ...inspectDbQuickStats(idxDb, indexFile),
    });

    // 3. Изолированные БД всех организаций в /ORGANIZATIONS
    const orgsDir = path.resolve(rootDir, 'ORGANIZATIONS');
    if (fs.existsSync(orgsDir)) {
        const entries = fs.readdirSync(orgsDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('$') && !d.name.startsWith('.') && !d.name.startsWith('#'))
            .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        for (const d of entries) {
            const baseMetaDir = path.join(orgsDir, d.name, '$base');
            if (!fs.existsSync(baseMetaDir))
                continue;
            const bp = `/ORGANIZATIONS/${d.name}`;
            const absFile = baseDbFile(rootDir, bp);
            const relFile = path.relative(rootDir, absFile).replace(/\\/g, '/');
            const db = fs.existsSync(absFile) ? await dataStore(bp) : null;
            databases.push({
                id: `base:${bp}`,
                label: `${d.name} (work.db)`,
                kind: 'base',
                basePath: bp,
                file: relFile,
                ...inspectDbQuickStats(db, absFile),
            });
        }
    }

    return {
        scope: 'server',
        basePath: '',
        databases,
    };
}

/**
 * Открыть целевую БД по контексту элемента и параметру `dbId`.
 * Гарантирует, что из контекста `$base` нельзя обратиться к чужой БД.
 */
export async function resolveSqlDatabase(item, params = {}) {
    await assertAdminAccess(item, params);
    const rootDir = process.cwd();
    const itemBasePath = resolveBasePath(item);
    if (itemBasePath) {
        const db = await dataStore(itemBasePath);
        const absFile = baseDbFile(rootDir, itemBasePath);
        return {
            db,
            dbId: `base:${itemBasePath}`,
            kind: 'base',
            basePath: itemBasePath,
            file: path.relative(rootDir, absFile).replace(/\\/g, '/'),
            absFile,
        };
    }

    const reqId = String(params?.dbId || params?.db || 'data').trim();
    if (reqId === 'index') {
        const db = await indexDb();
        if (!db)
            throw new DataError('Индексная БД (.index/work.db) недоступна');
        const absFile = path.resolve(rootDir, '.index', 'work.db');
        return {
            db,
            dbId: 'index',
            kind: 'server-index',
            basePath: '',
            file: path.relative(rootDir, absFile).replace(/\\/g, '/'),
            absFile,
        };
    }
    if (reqId.startsWith('base:')) {
        const bp = reqId.slice('base:'.length).trim();
        if (!/^\/(ORGANIZATIONS|BASES)\/[^/]+$/.test(bp))
            throw new DataError(`Недопустимый путь базы организации: ${bp}`);
        const db = await dataStore(bp);
        const absFile = baseDbFile(rootDir, bp);
        return {
            db,
            dbId: `base:${bp}`,
            kind: 'base',
            basePath: bp,
            file: path.relative(rootDir, absFile).replace(/\\/g, '/'),
            absFile,
        };
    }

    const db = await dataStore('');
    const absFile = baseDbFile(rootDir, '');
    return {
        db,
        dbId: 'data',
        kind: 'server-data',
        basePath: '',
        file: path.relative(rootDir, absFile).replace(/\\/g, '/'),
        absFile,
    };
}

/**
 * Собрать метаданные таблиц, колонок, индексов и связей выбранной БД.
 */
export function inspectDatabaseSchema(db) {
    const rawObjects = db.prepare(`
        SELECT name, type, sql
        FROM sqlite_master
        WHERE type IN ('table', 'view')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all();

    const ftsRoots = new Set(
        rawObjects
            .filter(r => /^CREATE\s+VIRTUAL\s+TABLE/i.test(String(r.sql || '')))
            .map(r => r.name)
    );

    const tableMap = new Map();
    const tables = [];

    for (const obj of rawObjects) {
        const name = String(obj.name);
        const ddl = String(obj.sql || '');
        const isVirtual = /^CREATE\s+VIRTUAL\s+TABLE/i.test(ddl);
        const withoutRowid = /\bWITHOUT\s+ROWID\b/i.test(ddl);
        let isShadow = false;
        let shadowOf = '';
        for (const root of ftsRoots) {
            if (FTS_SHADOW_SUFFIXES.some(suf => name === root + suf)) {
                isShadow = true;
                shadowOf = root;
                break;
            }
        }

        let columns = [];
        try {
            columns = db.prepare(`PRAGMA table_info("${escapeIdent(name)}")`).all().map(c => ({
                cid: Number(c.cid),
                name: String(c.name),
                colType: String(c.type || 'TEXT'),
                notnull: Boolean(c.notnull),
                dfltValue: c.dflt_value ?? null,
                pk: Number(c.pk) || 0,
            }));
        }
        catch {
            columns = [];
        }

        const pkColumns = columns
            .filter(c => c.pk > 0)
            .sort((a, b) => a.pk - b.pk)
            .map(c => c.name);

        const hasRowid = !withoutRowid && obj.type === 'table';

        let indexes = [];
        try {
            const idxList = db.prepare(`PRAGMA index_list("${escapeIdent(name)}")`).all();
            indexes = idxList.map(idx => {
                let idxCols = [];
                try {
                    idxCols = db.prepare(`PRAGMA index_info("${escapeIdent(idx.name)}")`)
                        .all()
                        .map(ic => String(ic.name || ''))
                        .filter(Boolean);
                }
                catch { /* ignore */ }
                return {
                    name: String(idx.name),
                    unique: Boolean(idx.unique),
                    origin: String(idx.origin || ''),
                    columns: idxCols,
                };
            });
        }
        catch {
            indexes = [];
        }

        let rowCount = 0;
        try {
            rowCount = Number(db.prepare(`SELECT count(*) AS n FROM "${escapeIdent(name)}"`).get()?.n) || 0;
        }
        catch {
            rowCount = 0;
        }

        const tableInfo = {
            name,
            objectType: String(obj.type), // 'table' | 'view'
            isVirtual,
            withoutRowid,
            isShadow,
            shadowOf,
            hasRowid,
            pkColumns,
            rowCount,
            description: TABLE_DESCRIPTIONS[name] || (isShadow ? `Служебная таблица FTS5 (${shadowOf})` : ''),
            sql: ddl,
            columns,
            indexes,
        };
        tableMap.set(name, tableInfo);
        tables.push(tableInfo);
    }

    // Собираем физические и логические связи между таблицами
    const relations = [];
    const seenRel = new Set();

    const addRelation = (rel) => {
        if (!tableMap.has(rel.fromTable) || !tableMap.has(rel.toTable))
            return;
        const fromTbl = tableMap.get(rel.fromTable);
        const toTbl = tableMap.get(rel.toTable);
        if (!fromTbl.columns.some(c => c.name === rel.fromColumn))
            return;
        if (!toTbl.columns.some(c => c.name === rel.toColumn) && rel.toColumn !== 'rowid')
            return;
        const key = `${rel.fromTable}.${rel.fromColumn}->${rel.toTable}.${rel.toColumn}`;
        if (seenRel.has(key))
            return;
        seenRel.add(key);
        relations.push(rel);
    };

    for (const tbl of tables) {
        if (tbl.isShadow || tbl.isVirtual)
            continue;
        try {
            const fks = db.prepare(`PRAGMA foreign_key_list("${escapeIdent(tbl.name)}")`).all();
            for (const fk of fks) {
                addRelation({
                    fromTable: tbl.name,
                    fromColumn: String(fk.from),
                    toTable: String(fk.table),
                    toColumn: String(fk.to || 'id'),
                    label: 'FOREIGN KEY',
                    kind: 'fk',
                });
            }
        }
        catch { /* ignore */ }
    }

    for (const rel of LOGICAL_RELATIONS) {
        addRelation({ ...rel, kind: 'logical' });
    }

    return { tables, relations };
}

/**
 * Проверить существование таблицы и вернуть её описание из схемы.
 */
function getValidatedTable(db, tableName) {
    const clean = String(tableName ?? '').trim();
    if (!clean)
        throw new DataError('Не указано имя таблицы');
    const schema = inspectDatabaseSchema(db);
    const tbl = schema.tables.find(t => t.name === clean);
    if (!tbl)
        throw new DataError(`Таблица «${clean}» не найдена в базе данных`);
    return { tbl, schema };
}

/**
 * Преобразовать значения строки для безопасной JSON-передачи (обработка BLOB / Uint8Array).
 */
function serializeRow(row) {
    if (!row || typeof row !== 'object')
        return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) {
        if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
            out[k] = `[BLOB: ${v.byteLength} байт]`;
        }
        else if (typeof v === 'bigint') {
            out[k] = Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Получить структуру выбранной БД (`sql_schema`).
 */
export async function getSqlSchema(item, params = {}) {
    const resolved = await resolveSqlDatabase(item, params);
    const stats = inspectDbQuickStats(resolved.db, resolved.absFile);
    const { tables, relations } = inspectDatabaseSchema(resolved.db);
    return {
        dbId: resolved.dbId,
        kind: resolved.kind,
        basePath: resolved.basePath,
        file: resolved.file,
        ...stats,
        tables,
        relations,
    };
}

/**
 * Выборка записей таблицы с поиском, фильтрами по колонкам, сортировкой и пагинацией (`sql_rows`).
 */
export async function querySqlRows(item, params = {}) {
    const resolved = await resolveSqlDatabase(item, params);
    const { db } = resolved;
    const { tbl, schema } = getValidatedTable(db, params.table);

    const colNames = new Set(tbl.columns.map(c => c.name));
    const useRowidKey = tbl.pkColumns.length === 0 && tbl.hasRowid;
    const keyColumns = tbl.pkColumns.length > 0 ? tbl.pkColumns : (tbl.hasRowid ? ['__rowid__'] : tbl.columns.map(c => c.name));

    const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 1000);
    const offset = Math.max(Number(params.offset) || 0, 0);
    const search = String(params.search ?? '').trim();

    let filters = params.filters;
    if (typeof filters === 'string' && filters.trim()) {
        try { filters = JSON.parse(filters); } catch { filters = null; }
    }

    const whereParts = [];
    const bindArgs = [];

    if (filters && typeof filters === 'object' && !Array.isArray(filters)) {
        for (const [col, val] of Object.entries(filters)) {
            if (val === undefined || val === null || val === '')
                continue;
            if (col === '__rowid__' && tbl.hasRowid) {
                whereParts.push('rowid = ?');
                bindArgs.push(Number(val));
                continue;
            }
            if (!colNames.has(col))
                continue;
            const strVal = String(val);
            if (strVal.startsWith('exact:')) {
                whereParts.push(`CAST("${escapeIdent(col)}" AS TEXT) = ?`);
                bindArgs.push(strVal.slice('exact:'.length));
            }
            else {
                whereParts.push(`CAST("${escapeIdent(col)}" AS TEXT) LIKE ?`);
                bindArgs.push(`%${strVal}%`);
            }
        }
    }

    if (search) {
        if (tbl.isVirtual && colNames.has('text')) {
            whereParts.push(`CAST("text" AS TEXT) LIKE ?`);
            bindArgs.push(`%${search}%`);
        }
        else if (tbl.columns.length > 0) {
            const orParts = tbl.columns.map(c => `CAST("${escapeIdent(c.name)}" AS TEXT) LIKE ?`);
            whereParts.push(`(${orParts.join(' OR ')})`);
            for (let i = 0; i < tbl.columns.length; i++)
                bindArgs.push(`%${search}%`);
        }
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const sortCol = String(params.sortCol ?? '').trim();
    const sortDir = String(params.sortDir ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    let orderSql = '';
    if (sortCol && (colNames.has(sortCol) || (sortCol === '__rowid__' && tbl.hasRowid))) {
        const expr = sortCol === '__rowid__' ? 'rowid' : `"${escapeIdent(sortCol)}"`;
        orderSql = `ORDER BY ${expr} ${sortDir}`;
    }
    else if (tbl.pkColumns.length > 0) {
        orderSql = `ORDER BY ${tbl.pkColumns.map(c => `"${escapeIdent(c)}" ASC`).join(', ')}`;
    }
    else if (tbl.hasRowid) {
        orderSql = 'ORDER BY rowid ASC';
    }

    const selectPrefix = useRowidKey || tbl.hasRowid ? 'rowid AS "__rowid__", *' : '*';
    const total = Number(
        db.prepare(`SELECT count(*) AS n FROM "${escapeIdent(tbl.name)}" ${whereSql}`).get(...bindArgs)?.n
    ) || 0;

    const rawRows = db.prepare(
        `SELECT ${selectPrefix} FROM "${escapeIdent(tbl.name)}" ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
    ).all(...bindArgs, limit, offset);

    const rows = rawRows.map(serializeRow);
    const outgoingRelations = schema.relations.filter(r => r.fromTable === tbl.name);
    const incomingRelations = schema.relations.filter(r => r.toTable === tbl.name);

    return {
        dbId: resolved.dbId,
        table: tbl.name,
        keyColumns,
        pkColumns: tbl.pkColumns,
        hasRowid: tbl.hasRowid,
        withoutRowid: tbl.withoutRowid,
        isVirtual: tbl.isVirtual,
        columns: tbl.columns,
        outgoingRelations,
        incomingRelations,
        total,
        limit,
        offset,
        rows,
    };
}

/**
 * Сформировать SQL-условие `WHERE` для точной идентификации одной строки по её ключу (`pk`).
 */
function buildPkWhere(tbl, pkInput) {
    if (!pkInput || typeof pkInput !== 'object')
        throw new DataError('Не передан первичный ключ записи (pk)');

    const colNames = new Set(tbl.columns.map(c => c.name));
    const whereParts = [];
    const args = [];

    if (tbl.pkColumns.length > 0) {
        for (const pkCol of tbl.pkColumns) {
            if (!(pkCol in pkInput) || pkInput[pkCol] === undefined)
                throw new DataError(`Не указано значение ключевой колонки «${pkCol}»`);
            const v = pkInput[pkCol];
            if (v === null) {
                whereParts.push(`"${escapeIdent(pkCol)}" IS NULL`);
            }
            else {
                whereParts.push(`"${escapeIdent(pkCol)}" = ?`);
                args.push(v);
            }
        }
    }
    else if (tbl.hasRowid && pkInput.__rowid__ !== undefined && pkInput.__rowid__ !== null) {
        whereParts.push('rowid = ?');
        args.push(Number(pkInput.__rowid__));
    }
    else {
        // Fallback: по всем переданным колонкам таблицы
        for (const [k, v] of Object.entries(pkInput)) {
            if (!colNames.has(k))
                continue;
            if (v === null) {
                whereParts.push(`"${escapeIdent(k)}" IS NULL`);
            }
            else {
                whereParts.push(`"${escapeIdent(k)}" = ?`);
                args.push(v);
            }
        }
    }

    if (!whereParts.length)
        throw new DataError('Невозможно определить первичный ключ строки для модификации');

    return { whereSql: whereParts.join(' AND '), args };
}

/**
 * Нормализовать значение колонки перед записью в SQLite.
 */
function coerceColumnValue(colDef, rawVal) {
    if (rawVal === null || rawVal === undefined)
        return null;
    const t = String(colDef?.colType || '').toUpperCase();
    // Для известных JSON-колонок проверяем валидность JSON
    if (['body', 'own', 'analytics'].includes(colDef?.name) && typeof rawVal === 'string' && rawVal.trim()) {
        try {
            JSON.parse(rawVal);
        }
        catch (err) {
            throw new DataError(`Поле «${colDef.name}» содержит невалидный JSON: ${err.message}`);
        }
    }
    if (typeof rawVal === 'object') {
        return JSON.stringify(rawVal);
    }
    if ((t.includes('INT') || t.includes('REAL') || t.includes('NUM')) && typeof rawVal === 'string') {
        const trimmed = rawVal.trim();
        if (trimmed === '')
            return colDef?.notnull ? 0 : null;
        const n = Number(trimmed);
        if (Number.isFinite(n))
            return t.includes('INT') ? Math.trunc(n) : n;
    }
    return rawVal;
}

function parseBodyPayload(params = {}) {
    let b = params.post ?? params.body;
    if (Buffer.isBuffer(b))
        b = b.toString('utf-8');
    if (typeof b === 'string' && b.trim()) {
        try { b = JSON.parse(b); }
        catch { throw new DataError('Невалидный JSON тела запроса'); }
    }
    return (b && typeof b === 'object') ? { ...params, ...b } : { ...params };
}

function notifyDbChanged(db, tableName) {
    try { bumpDataGeneration(db); } catch { /* ignore */ }
    if (tableName === 'classes' || tableName === 'class_tree') {
        try { markClassesDirty(); } catch { /* ignore */ }
    }
}

/**
 * Обновить существующую запись таблицы (`sql_update_row`).
 */
export async function updateSqlRow(item, params = {}) {
    const p = parseBodyPayload(params);
    const resolved = await resolveSqlDatabase(item, p);
    const { db } = resolved;
    const { tbl } = getValidatedTable(db, p.table);

    if (tbl.objectType === 'view')
        throw new DataError(`Представление (VIEW) «${tbl.name}» доступно только для чтения`);

    const pk = typeof p.pk === 'string' ? JSON.parse(p.pk) : p.pk;
    const values = typeof p.values === 'string' ? JSON.parse(p.values) : p.values;
    if (!values || typeof values !== 'object')
        throw new DataError('Не переданы обновляемые значения (values)');

    const colMap = new Map(tbl.columns.map(c => [c.name, c]));
    const setParts = [];
    const setArgs = [];

    for (const [colName, rawVal] of Object.entries(values)) {
        if (colName === '__rowid__' || !colMap.has(colName))
            continue;
        if (typeof rawVal === 'string' && /^\[BLOB:\s*\d+\s*байт\]$/.test(rawVal))
            continue;
        const colDef = colMap.get(colName);
        setParts.push(`"${escapeIdent(colName)}" = ?`);
        setArgs.push(coerceColumnValue(colDef, rawVal));
    }

    if (!setParts.length)
        throw new DataError('Нет полей для обновления');

    const { whereSql, args: whereArgs } = buildPkWhere(tbl, pk);

    let changes = 0;
    const runUpdate = () => {
        const res = db.prepare(
            `UPDATE "${escapeIdent(tbl.name)}" SET ${setParts.join(', ')} WHERE ${whereSql}`
        ).run(...setArgs, ...whereArgs);
        changes = Number(res?.changes) || 0;
    };

    if (resolved.kind === 'server-index') {
        db.exec('BEGIN');
        try {
            runUpdate();
            db.exec('COMMIT');
        }
        catch (e) {
            try { db.exec('ROLLBACK'); } catch { /* ignore */ }
            throw e;
        }
    }
    else {
        tx(db, runUpdate);
        notifyDbChanged(db, tbl.name);
    }

    return { ok: true, changes, table: tbl.name };
}

/**
 * Добавить новую запись в таблицу (`sql_insert_row`).
 */
export async function insertSqlRow(item, params = {}) {
    const p = parseBodyPayload(params);
    const resolved = await resolveSqlDatabase(item, p);
    const { db } = resolved;
    const { tbl } = getValidatedTable(db, p.table);

    if (tbl.objectType === 'view')
        throw new DataError(`Представление (VIEW) «${tbl.name}» доступно только для чтения`);

    const values = typeof p.values === 'string' ? JSON.parse(p.values) : p.values;
    if (!values || typeof values !== 'object')
        throw new DataError('Не переданы значения для вставки (values)');

    const colMap = new Map(tbl.columns.map(c => [c.name, c]));
    const cols = [];
    const placeholders = [];
    const args = [];

    for (const [colName, rawVal] of Object.entries(values)) {
        if (colName === '__rowid__' || !colMap.has(colName))
            continue;
        const colDef = colMap.get(colName);
        // Если автоинкрементный INTEGER PK не заполнен — пропускаем, чтобы SQLite сам назначил id
        if (colDef.pk > 0 && (rawVal === '' || rawVal === null || rawVal === undefined) && /INT/i.test(colDef.colType))
            continue;
        if ((rawVal === '' || rawVal === undefined) && colDef.dfltValue !== null)
            continue;
        cols.push(`"${escapeIdent(colName)}"`);
        placeholders.push('?');
        args.push(coerceColumnValue(colDef, rawVal));
    }

    if (!cols.length)
        throw new DataError('Не заполнено ни одно поле новой записи');

    let lastInsertRowid = null;
    const runInsert = () => {
        const res = db.prepare(
            `INSERT INTO "${escapeIdent(tbl.name)}" (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`
        ).run(...args);
        lastInsertRowid = res?.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null;
    };

    if (resolved.kind === 'server-index') {
        db.exec('BEGIN');
        try {
            runInsert();
            db.exec('COMMIT');
        }
        catch (e) {
            try { db.exec('ROLLBACK'); } catch { /* ignore */ }
            throw e;
        }
    }
    else {
        tx(db, runInsert);
        notifyDbChanged(db, tbl.name);
    }

    return { ok: true, table: tbl.name, lastInsertRowid };
}

/**
 * Удалить одну или несколько записей из таблицы по первичным ключам (`sql_delete_row`).
 */
export async function deleteSqlRows(item, params = {}) {
    const p = parseBodyPayload(params);
    const resolved = await resolveSqlDatabase(item, p);
    const { db } = resolved;
    const { tbl } = getValidatedTable(db, p.table);

    if (tbl.objectType === 'view')
        throw new DataError(`Представление (VIEW) «${tbl.name}» доступно только для чтения`);

    let pks = p.pks ?? (p.pk ? [p.pk] : null);
    if (typeof pks === 'string')
        pks = JSON.parse(pks);
    if (!Array.isArray(pks) || !pks.length)
        throw new DataError('Не переданы ключи удаляемых записей (pks)');

    let deleted = 0;
    const runDelete = () => {
        for (const pk of pks) {
            const { whereSql, args } = buildPkWhere(tbl, pk);
            const res = db.prepare(`DELETE FROM "${escapeIdent(tbl.name)}" WHERE ${whereSql}`).run(...args);
            deleted += Number(res?.changes) || 0;
        }
    };

    if (resolved.kind === 'server-index') {
        db.exec('BEGIN');
        try {
            runDelete();
            db.exec('COMMIT');
        }
        catch (e) {
            try { db.exec('ROLLBACK'); } catch { /* ignore */ }
            throw e;
        }
    }
    else {
        tx(db, runDelete);
        notifyDbChanged(db, tbl.name);
    }

    return { ok: true, deleted, table: tbl.name };
}

export const SQL_INSPECTOR_METHODS = Object.freeze({
    sql_databases: { level: 'admin', fn: (item, p) => listSqlDatabases(item, p) },
    sql_schema: { level: 'admin', fn: (item, p) => getSqlSchema(item, p) },
    sql_rows: { level: 'admin', fn: (item, p) => querySqlRows(item, p) },
    sql_update_row: { level: 'admin', fn: (item, p) => updateSqlRow(item, p) },
    sql_insert_row: { level: 'admin', fn: (item, p) => insertSqlRow(item, p) },
    sql_delete_row: { level: 'admin', fn: (item, p) => deleteSqlRows(item, p) },
});
