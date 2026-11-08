/**
 * Тесты инспектора и редактора SQL-баз WORK (`sources/data/sql-inspector.js` и `form/database`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    listSqlDatabases,
    getSqlSchema,
    querySqlRows,
    insertSqlRow,
    updateSqlRow,
    deleteSqlRows,
} from '../sources/data/sql-inspector.js';

describe('Инспектор и редактор SQL-баз (sql-inspector + form/database)', () => {
    it('sql_databases: на уровне $server возвращает .data/work.db, .index/work.db и базы организаций, а на $base — строго изолированную БД организации', async () => {
        const serverRes = await listSqlDatabases({ path: '/', type: '$server' });
        assert.equal(serverRes.scope, 'server');
        const ids = serverRes.databases.map(d => d.id);
        assert.ok(ids.includes('data'), 'должна быть прикладная БД сервера .data/work.db');
        assert.ok(ids.includes('index'), 'должна быть индексная БД сервера .index/work.db');
        assert.ok(ids.includes('base:/ORGANIZATIONS/Маслоторг'), 'должна быть БД организации Маслоторг');

        const baseRes = await listSqlDatabases({ path: '/ORGANIZATIONS/Маслоторг', type: '$base' });
        assert.equal(baseRes.scope, 'base');
        assert.equal(baseRes.databases.length, 1);
        assert.equal(baseRes.databases[0].id, 'base:/ORGANIZATIONS/Маслоторг');
        assert.match(baseRes.databases[0].file, /ORGANIZATIONS\/Маслоторг\/\$base\/#system\/work\.db$/);
    });

    it('sql_schema: возвращает таблицы, колонки, PK, индексы и логические связи схемы WORK, изолируя $base от чужих dbId', async () => {
        const baseItem = { path: '/ORGANIZATIONS/Маслоторг', type: '$base' };
        // Даже если передать dbId: 'index', на $base должна открыться только её собственная БД
        const schema = await getSqlSchema(baseItem, { dbId: 'index' });
        assert.equal(schema.dbId, 'base:/ORGANIZATIONS/Маслоторг');

        const tableNames = schema.tables.filter(t => !t.isShadow).map(t => t.name);
        for (const expected of ['classes', 'class_tree', 'objects', 'object_versions', 'refs', 'entries', 'entry_analytics', 'account_entries', 'logs', 'doc_links', 'settings']) {
            assert.ok(tableNames.includes(expected), `таблица ${expected} должна присутствовать в схеме`);
        }

        const objectsTbl = schema.tables.find(t => t.name === 'objects');
        assert.deepEqual(objectsTbl.pkColumns, ['id']);
        assert.ok(objectsTbl.columns.some(c => c.name === 'body'));
        assert.ok(objectsTbl.indexes.length > 0, 'индексы таблицы objects должны быть прочитаны');

        const docLinksTbl = schema.tables.find(t => t.name === 'doc_links');
        assert.equal(docLinksTbl.withoutRowid, true);
        assert.deepEqual(docLinksTbl.pkColumns, ['source_id', 'target_id']);

        // Проверяем наличие связей
        assert.ok(schema.relations.some(r => r.fromTable === 'objects' && r.fromColumn === 'cid' && r.toTable === 'classes' && r.toColumn === 'cid'));
        assert.ok(schema.relations.some(r => r.fromTable === 'account_entries' && r.fromColumn === 'entry_id' && r.toTable === 'entries' && r.toColumn === 'id'));
        assert.ok(schema.relations.some(r => r.fromTable === 'doc_links' && r.fromColumn === 'source_id' && r.toTable === 'objects' && r.toColumn === 'id'));
    });

    it('sql_rows, sql_insert_row, sql_update_row, sql_delete_row: чтение, фильтрация, добавление, редактирование и удаление записей', async () => {
        const serverItem = { path: '/', type: '$server' };
        const testKey = '__sql_inspector_test_key__';

        // 1. Вставка записи в таблицу settings
        await insertSqlRow(serverItem, {
            dbId: 'data',
            table: 'settings',
            values: { key: testKey, value: '{"hello":"world"}' },
        });

        try {
            // 2. Выборка с точным фильтром
            const q1 = await querySqlRows(serverItem, {
                dbId: 'data',
                table: 'settings',
                filters: { key: `exact:${testKey}` },
            });
            assert.equal(q1.total, 1);
            assert.equal(q1.rows[0].key, testKey);
            assert.equal(q1.rows[0].value, '{"hello":"world"}');

            // 3. Редактирование записи по PK
            await updateSqlRow(serverItem, {
                dbId: 'data',
                table: 'settings',
                pk: { key: testKey },
                values: { value: '{"hello":"updated"}' },
            });

            const q2 = await querySqlRows(serverItem, {
                dbId: 'data',
                table: 'settings',
                filters: { key: `exact:${testKey}` },
            });
            assert.equal(q2.rows[0].value, '{"hello":"updated"}');
        }
        finally {
            // 4. Удаление записи
            await deleteSqlRows(serverItem, {
                dbId: 'data',
                table: 'settings',
                pks: [{ key: testKey }],
            });
        }

        const qAfter = await querySqlRows(serverItem, {
            dbId: 'data',
            table: 'settings',
            filters: { key: `exact:${testKey}` },
        });
        assert.equal(qAfter.total, 0);
    });

    it('составной PK (WITHOUT ROWID) в doc_links и валидация JSON в колонках body/own/analytics', async () => {
        const serverItem = { path: '/', type: '$server' };
        const srcId = '__test_src_doc__';
        const dstId = '__test_dst_doc__';

        await insertSqlRow(serverItem, {
            dbId: 'data',
            table: 'doc_links',
            values: {
                source_id: srcId,
                target_id: dstId,
                kind: 'basis',
                note: 'Черновик связи',
                author: 'admin',
                created: Date.now(),
            },
        });

        try {
            await updateSqlRow(serverItem, {
                dbId: 'data',
                table: 'doc_links',
                pk: { source_id: srcId, target_id: dstId },
                values: { note: 'Обновлённая связь' },
            });

            const rowsRes = await querySqlRows(serverItem, {
                dbId: 'data',
                table: 'doc_links',
                filters: { source_id: `exact:${srcId}` },
            });
            assert.equal(rowsRes.total, 1);
            assert.equal(rowsRes.rows[0].note, 'Обновлённая связь');
        }
        finally {
            await deleteSqlRows(serverItem, {
                dbId: 'data',
                table: 'doc_links',
                pks: [{ source_id: srcId, target_id: dstId }],
            });
        }

        // Проверка отклонения битого JSON для JSON-колонок (body в logs)
        await assert.rejects(
            () => insertSqlRow(serverItem, {
                dbId: 'data',
                table: 'logs',
                values: {
                    feed_path: '/test',
                    day: '2026-11-04',
                    time: Date.now(),
                    body: '{broken json',
                },
            }),
            /невалидный JSON/i
        );
    });

    it('представление form/database видно только для ADMIN и только на $server и $base (не на $structure)', async () => {
        await import('../sources/reactor.js');
        const { $server } = await import('../sources/server/server.js');
        const prevWork = globalThis.WORK;
        globalThis.WORK = new $server();
        try {
            const baseItem = await WORK.get_item('/ORGANIZATIONS/Маслоторг');
            const salesItem = await WORK.get_item('/ORGANIZATIONS/Маслоторг/sales');

            const viewsOf = async (item, role) => {
                const root = await item.handlers({ path: '//form', role });
                return (root?.items || [])
                    .filter(i => i.type === '$handler' && i.usable !== false)
                    .map(i => i.id);
            };

            const serverBossViews = await viewsOf(WORK, 'BOSS');
            const serverUserViews = await viewsOf(WORK, 'USER');
            assert.ok(serverBossViews.includes('database'), 'на $server у BOSS должно быть представление database');
            assert.ok(!serverUserViews.includes('database'), 'на $server у USER не должно быть представления database');

            // Проверяем полное дерево контекстного меню handlers (без path: '//form') на WORK
            const fullMenu = await WORK.handlers({ role: 'BOSS' });
            const pagesNode = (fullMenu?.items || []).find(i => i.id === 'pages');
            assert.ok(pagesNode, 'в меню WORK должен быть раздел pages');
            const pageIds = (pagesNode.items || []).map(i => i.id);
            assert.ok(!pageIds.includes('agents'), 'незаказанного хендлера agents в pages быть не должно');
            const formNode = (pagesNode.items || []).find(i => i.id === 'form');
            assert.equal(formNode?.type, '$handler', 'pages/form должен быть $handler, а не $folder');
            assert.equal(formNode?.label, 'VIEWS', 'pages/form должен иметь label VIEWS');
            const formChildIds = (formNode?.items || []).map(i => i.id);
            assert.ok(formChildIds.includes('database'), 'в контекстном меню WORK внутри VIEWS должно быть представление database');

            const baseBossViews = await viewsOf(baseItem, 'BOSS');
            const baseUserViews = await viewsOf(baseItem, 'USER');
            assert.ok(baseBossViews.includes('database'), 'на $base у BOSS должно быть представление database');
            assert.ok(!baseUserViews.includes('database'), 'на $base у USER не должно быть представления database');

            const salesBossViews = await viewsOf(salesItem, 'BOSS');
            assert.ok(!salesBossViews.includes('database'), 'на подразделении $structure не должно быть представления database');
        }
        finally {
            globalThis.WORK = prevWork;
        }
    });

    it('file.loadPreview сохраняет геттеры task-preview (без spread), deleteLogEntry удаляет осиротевший лог, а chat-day стабилизирует ссылки', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const fileJsSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../sources/client/file.js'), 'utf-8');
        assert.ok(fileJsSrc.includes('Object.getOwnPropertyDescriptors(def)'), 'loadPreview должен клонировать дескрипторы, не убивая геттеры через {...def}');
        assert.ok(!fileJsSrc.includes('{ ...def, is:'), 'spread {...def} в loadPreview запрещён');

        const chatItemSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../$server/$folder/lib/chat-item/chat-item.js'), 'utf-8');
        assert.ok(chatItemSrc.includes('Такого файла нет:'), 'chat-item должен выводить плашку об отсутствующем целевом файле');
        assert.ok(chatItemSrc.includes('deleteMissingLog'), 'chat-item должен иметь кнопку удаления осиротевшего лога для ADMIN');

        const { saveDataLogRow, deleteLogEntry, loadBodies } = await import('../sources/server/logs.js');
        const fakeStorage = { path: '/USERS/__test_orphan_user__', id: '__test_orphan_user__', type: '$user' };
        const saved = await saveDataLogRow(fakeStorage, {}, {
            time: 1799999999001,
            sender: 'USER',
            ext: 'task',
            path: '/ORGANIZATIONS/Маслоторг/$base/task/2026-11-04/1799999999001.USER.task',
            content: '{"name":"Удалённый таск","items":[]}',
        });
        assert.ok(saved?.logsFilePath);

        const before = await loadBodies(fakeStorage, { day: saved.day });
        assert.ok(before.some(r => r.time === 1799999999001));

        const delRes = await deleteLogEntry(fakeStorage, {
            stubPath: saved.logsFilePath,
            path: '/ORGANIZATIONS/Маслоторг/$base/task/2026-11-04/1799999999001.USER.task',
            time: 1799999999001,
            sender: 'USER',
        });
        assert.equal(delRes.ok, true);
        assert.ok(delRes.deleted >= 1);

        const after = await loadBodies(fakeStorage, { day: saved.day });
        assert.ok(!after.some(r => r.time === 1799999999001), 'осиротевший лог должен быть удалён из БД');
    });
});
