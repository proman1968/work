import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import engine from '../$server/$folder/$class/ai/prompt/$method/class.js';
import taskType from '../$server/$folder/$file/$data/$task/class.js';

/**
 * Устойчивость к пустым боксам и упавшим стримам:
 * 1. Маркер «все ходы отклонены» — только когда бокс правда пуст
 *    (регрессия: site-боксы с draft получали маркер поверх улик).
 * 2. Тип error не сужает меню через using_blocks.
 */

function collectLive(block) {
    const live = {
        mode: 'plan',
        send() {},
        async save() {},
    };
    return live;
}

const skipAgent = {
    label: 'W',
    tools: { t: { label: 'T', icon: 'x', init: async () => false } },
};

describe('маркер всех отклонённых ходов', () => {
    it('пустой бокс после скипов — видимый след вместо тишины', async () => {
        const block = { type: 'w', time: 1, items: [] };
        const live = collectLive(block);
        await engine.turn({ block, agent: skipAgent, type: 'w', model: 'm', messages: [], session: {}, live, params: {} });
        assert.equal(block._skipNote, true);
        assert.match(String(block.content || ''), /все ходы отклонены/);
        assert.equal(block.state, 'нет ходов');
    });

    it('бокс с собственным draft — без маркера', async () => {
        const prevWork = globalThis.WORK;
        globalThis.WORK = {
            async get_item() {
                return {
                    async *streamChat() {
                        yield 'ok';
                    },
                };
            },
        };
        try {
            const block = { type: 'w', time: 1, items: [], draft: { type: 'text', text: 'черновик' } };
            const live = collectLive(block);
            await engine.turn({ block, agent: skipAgent, type: 'w', model: 'm', messages: [], session: {}, live, params: {} });
            assert.equal(block._skipNote, undefined);
            assert.ok(!String(block.content || '').includes('все ходы отклонены'));
        }
        finally {
            globalThis.WORK = prevWork;
        }
    });
});

describe('using_blocks без error', () => {
    it('error-блок не сужает меню, обычный — сужает', async () => {
        const box = { items: [] };
        const fakeThis = { body: box, pipe: {}, async _save() {} };
        await taskType._push_block.call(fakeThis, { block: { type: 'error', content: 'бум' }, box });
        assert.deepEqual(box.using_blocks ?? [], [], 'error не должен попадать в using_blocks');
        await taskType._push_block.call(fakeThis, { block: { type: 'thinking', content: '...' }, box });
        assert.deepEqual(box.using_blocks, ['thinking']);
    });
});
