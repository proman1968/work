import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../sources/reactor.js';
import * as LOGS from '../sources/server/logs.js';

describe('logs.js: чистые функции', () => {
    it('normalizeQuery: строка → {day}, ext → exts[]', () => {
        assert.deepEqual(LOGS.normalizeQuery('2026-07-25').day, '2026-07-25');
        assert.deepEqual(LOGS.normalizeQuery({ ext: '.EML' }).exts, ['eml']);
        assert.deepEqual(LOGS.normalizeQuery({ ext: ['md', '.Txt'] }).exts, ['md', 'txt']);
        assert.equal(LOGS.normalizeQuery({}).exts, null);
    });

    it('resolveDays: day | days | from..to | сегодня', () => {
        assert.deepEqual(LOGS.resolveDays({ day: '2026-01-02' }), ['2026-01-02']);
        assert.deepEqual(LOGS.resolveDays({ days: ['a', 'b'] }), ['a', 'b']);
        assert.deepEqual(
            LOGS.resolveDays({ from: '2026-01-30', to: '2026-02-01' }),
            ['2026-01-30', '2026-01-31', '2026-02-01'],
        );
        assert.deepEqual(LOGS.resolveDays({}), [LOGS.today()]);
    });

    it('logExt: поле ext приоритетнее path', () => {
        assert.equal(LOGS.logExt({ ext: '.MD', path: '/a/b.txt' }), 'md');
        assert.equal(LOGS.logExt({ path: '/a/1234.uid.smoke' }), 'smoke');
        assert.equal(LOGS.logExt({}), '');
    });

    it('buildIndex: flat-список и агрегаты по дням', () => {
        const rows = [
            { day: 'd1', time: 2, sender: 'a', path: '/x/1.md' },
            { day: 'd1', time: 5, sender: 'b', path: '/x/2.txt' },
            { day: 'd2', time: 7, sender: 'a', path: '/x/3.md' },
        ];
        const flat = LOGS.buildIndex(rows, { flat: true });
        assert.equal(flat.length, 3);
        assert.deepEqual(Object.keys(flat[0]).sort(),
            ['day', 'ext', 'logsFilePath', 'path', 'sender', 'time']);

        const byDay = LOGS.buildIndex(rows, {});
        assert.equal(byDay.length, 2);
        const d1 = byDay.find(b => b.day === 'd1');
        assert.equal(d1.count, 2);
        assert.equal(d1.firstTime, 2);
        assert.equal(d1.lastTime, 5);
        assert.deepEqual(d1.exts.sort(), ['md', 'txt']);
    });

    it('matchesFilter: без exts пропускает всё', () => {
        assert.equal(LOGS.matchesFilter({ ext: 'md' }, {}), true);
        assert.equal(LOGS.matchesFilter({ ext: 'md' }, { exts: ['md'] }), true);
        assert.equal(LOGS.matchesFilter({ ext: 'md' }, { exts: ['txt'] }), false);
    });

    it('matchesEntry: stub .logs и связанный path', () => {
        const row = { path: '/U/work/task/.ai.task/history/2026-09-10/1.task' };
        const stub = '/U/logs/2026-09-10/1.logs';
        assert.equal(LOGS.matchesEntry(stub, row, stub), true);
        assert.equal(LOGS.matchesEntry(row.path, row, stub), true);
        assert.equal(LOGS.matchesEntry('/other.logs', row, stub), false);
        assert.equal(LOGS.matchesEntry('', row, stub), false);
    });

    it('SQL-хранение логов: логи организации живут в её $base/#system/work.db, логи кабинетов — в .data/work.db, файлы .logs на диске не создаются', async () => {
        const fs = await import('node:fs');
        const fsp = await import('node:fs/promises');
        const os = await import('node:os');
        const path = await import('node:path');
        const { closeDataDb, dataDb } = await import('../sources/data/db.js');
        const prevWork = globalThis.WORK;
        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-sql-logs-'));
        try {
            fs.mkdirSync(path.join(tmp, 'ORGANIZATIONS', 'OrgA', '$base', '#system'), { recursive: true });
            globalThis.WORK = { id: 'WORK', type: '$server', real_dir: tmp, dir: tmp, path: '' };

            const orgBase = { id: 'OrgA', type: '$base', path: '/ORGANIZATIONS/OrgA', real_dir: path.join(tmp, 'ORGANIZATIONS', 'OrgA'), parent: globalThis.WORK };
            const salesDept = { id: 'sales', type: '$structure', path: '/ORGANIZATIONS/OrgA/sales', real_dir: path.join(tmp, 'ORGANIZATIONS', 'OrgA', 'sales'), parent: orgBase, $parent: orgBase };
            const userCab = { id: 'ivan', type: '$user', path: '/USERS/ivan', real_dir: path.join(tmp, 'USERS', 'ivan'), parent: globalThis.WORK };

            const row = {
                time: 1761800000000,
                sender: 'ivan',
                content: 'Счёт оплачен',
                path: '/ORGANIZATIONS/OrgA/sales/work/act.docx',
                ext: 'docx',
            };
            await LOGS.appendRow(salesDept, row, { logAuthor: { $user: userCab } });

            // 1. На диске нет папок logs и файлов .logs
            assert.equal(fs.existsSync(path.join(tmp, 'ORGANIZATIONS', 'OrgA', 'sales', '$structure', 'logs')), false, 'папка logs подразделения на диске не создаётся');
            assert.equal(fs.existsSync(path.join(tmp, 'USERS', 'ivan', '$user', 'logs')), false, 'папка logs кабинета на диске не создаётся');

            // 2. Запись подразделения лежит в БД организации OrgA ($base/#system/work.db)
            const orgDb = await dataDb('/ORGANIZATIONS/OrgA', tmp);
            const orgLogCount = orgDb.prepare('SELECT COUNT(*) AS c FROM logs WHERE feed_path = ?').get('/ORGANIZATIONS/OrgA/sales').c;
            assert.equal(orgLogCount, 1, 'запись подразделения сохранена в work.db организации');

            // 3. Зеркальная запись автора лежит в серверной БД (.data/work.db)
            const srvDb = await dataDb('', tmp);
            const cabLogCount = srvDb.prepare('SELECT COUNT(*) AS c FROM logs WHERE feed_path = ?').get('/USERS/ivan').c;
            assert.equal(cabLogCount, 1, 'запись кабинета автора сохранена в корневой .data/work.db');

            // 4. Чтение через datesList, loadBodies, findEntry и appendIncludes
            const day = LOGS.dayOfTime(row.time);
            const dates = await LOGS.datesList(salesDept);
            assert.ok(dates.includes(day), 'день записи виден в datesList');

            const bodies = await LOGS.loadBodies(salesDept, { day });
            assert.equal(bodies.length, 1);
            assert.equal(bodies[0].content, 'Счёт оплачен');

            const found = await LOGS.findEntry(salesDept, row.path);
            assert.ok(found, 'findEntry находит запись в SQLite по path');

            const updated = await LOGS.appendIncludes(salesDept, found.logsFilePath, ['/ORGANIZATIONS/OrgA/sales/work/att.xlsx']);
            assert.deepEqual(updated.includes, ['/ORGANIZATIONS/OrgA/sales/work/att.xlsx'], 'appendIncludes обновляет запись в SQLite');
        }
        finally {
            await closeDataDb();
            globalThis.WORK = prevWork;
            await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
        }
    });
});
