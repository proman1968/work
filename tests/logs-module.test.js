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
});
