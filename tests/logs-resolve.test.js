import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLogClass } from '../$server/$folder/$class/ai/agents/logs.js';

/**
 * Регрессия задачи «чем я занимался сегодня»: бокс logs остался пуст,
 * процесс упал в crash. Причина — brief с `tz Europe/Moscow`: regex
 * забирал `/Moscow):` за путь класса, резолв возвращал null без fallback
 * на место, все три tool скипались, бюджет сгорал в тишине.
 * Инвариант: мусорный кандидат не хоронит резолв — место исполнения
 * пробуется следующим; явный путь — в приоритете.
 */

const withLogs = { short: '/USERS/U', logs() {}, read_log_entry() {} };
const plainFolder = { short: '/SOME/folder' };

function mockWork(map) {
    globalThis.WORK = {
        async get_item(p) {
            if (Object.prototype.hasOwnProperty.call(map, p))
                return map[p];
            return null;
        },
    };
}

const POISON_BRIEF = '— журнал за сегодня (24.09.2026, tz Europe/Moscow): день, все entry; факты — блок items';

describe('resolveLogClass: перебор кандидатов', () => {
    let prevWork;
    before(() => {
        prevWork = globalThis.WORK;
    });
    after(() => {
        globalThis.WORK = prevWork;
    });

    it('отравленный brief + место с logs → место', async () => {
        mockWork({ '/USERS/U': withLogs });
        const target = await resolveLogClass({
            block: {},
            box: { brief: POISON_BRIEF, items: [] },
            messages: [{ role: 'user', content: 'чем я занимался сегодня' }],
            engine: { $context: withLogs },
        });
        assert.equal(target, withLogs);
    });

    it('мусорный pathHint + место с logs → место', async () => {
        mockWork({ '/USERS/U': withLogs });
        const target = await resolveLogClass({
            block: {},
            box: { brief: '', items: [] },
            messages: [],
            engine: { $context: withLogs },
        }, '/Moscow):');
        assert.equal(target, withLogs);
    });

    it('явный валидный pathHint — в приоритете над местом', async () => {
        const explicit = { short: '/BASE/dir', logs() {} };
        mockWork({ '/BASE/dir': explicit, '/USERS/U': withLogs });
        const target = await resolveLogClass({
            block: {},
            box: { brief: '', items: [] },
            messages: [],
            engine: { $context: withLogs },
        }, '/BASE/dir');
        assert.equal(target, explicit);
    });

    it('кандидат без метода logs пропускается', async () => {
        mockWork({ '/SOME/folder': plainFolder, '/USERS/U': withLogs });
        const target = await resolveLogClass({
            block: {},
            box: { brief: '', items: [] },
            messages: [],
            engine: { $context: withLogs },
        }, '/SOME/folder');
        assert.equal(target, withLogs);
    });

    it('нет кандидатов → null', async () => {
        mockWork({});
        const target = await resolveLogClass({
            block: {},
            box: { brief: '', items: [] },
            messages: [],
            engine: {},
        });
        assert.equal(target, null);
    });
});
