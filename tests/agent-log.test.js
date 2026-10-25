/** Лог агента (hardening 4.2): уровень WORK_LOG, формат ошибок, тихие catch. */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../sources/modules/agent/log.js';

/** Подмена console.log/warn на сборщик. */
function capture() {
    const out = { log: [], warn: [] };
    const orig = { log: console.log, warn: console.warn };
    console.log = (...a) => out.log.push(a.join(' '));
    console.warn = (...a) => out.warn.push(a.join(' '));
    return [out, () => { console.log = orig.log; console.warn = orig.warn; }];
}

/** Уровень кэшируется на миллисекунду — после смены WORK_LOG даём кэшу протухнуть. */
const tick = () => new Promise(r => setTimeout(r, 3));

describe('agent log', () => {
    beforeEach(async () => {
        delete process.env.WORK_LOG;
        await tick();
    });

    it('по умолчанию warn: debug и info тихи, warn — в console.warn', async () => {
        const [out, done] = capture();
        try {
            log.debug('scope', new Error('мелочь'));
            log.info('scope', 'событие');
            log.warn('scope', 'важно');
            assert.equal(out.log.length, 0);
            assert.equal(out.warn.length, 1);
            assert.match(out.warn[0], /\[agent:scope\]/);
            assert.match(out.warn[0], /важно/);
        }
        finally { done(); }
    });

    it('WORK_LOG=debug: видны debug/info/warn; ошибка — со стеком', async () => {
        process.env.WORK_LOG = 'debug';
        await tick();
        const [out, done] = capture();
        try {
            log.debug('tree', new Error('глоток'));
            log.info('tree', 'событие');
            log.warn('tree', 'важно');
            assert.equal(out.log.length, 2);
            assert.match(out.log[0], /\[agent:tree\]/);
            assert.match(out.log[0], /глоток/);
            assert.match(out.log[0], /at /); // стек, не только сообщение
            assert.equal(out.warn.length, 1);
        }
        finally { done(); }
    });

    it('WORK_LOG=info: debug тих; неизвестное значение — как warn', async () => {
        process.env.WORK_LOG = 'info';
        await tick();
        const [out, done] = capture();
        try {
            log.debug('x', 1);
            log.info('x', 2);
            assert.deepEqual(out.log, ['[agent:x] 2']);
            process.env.WORK_LOG = 'мусор';
            await tick();
            log.warn('x', 3);
            log.debug('x', 4);
            assert.deepEqual(out.warn, ['[agent:x] 3']);
            assert.equal(out.log.length, 1);
        }
        finally { done(); }
    });
});
