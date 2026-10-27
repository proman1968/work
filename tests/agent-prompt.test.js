/**
 * Кэш-дружественный контекст (hardening 2.1): стабильный system первым, изменчивая часть среды — отдельным сообщением
 * в конце; история между ходами остаётся неизменным префиксом (на этом держится prompt cache провайдера).
 */
import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runLoop, toMessages, splitSystem, systemText, maybeCompact, VOLATILE_HEAD, EMPTY_NUDGE } from '../sources/modules/agent/loop.js';
import { estimateTokens } from '../sources/modules/agent/util.js';
import { stableToolOrder } from '../sources/modules/agent/index.js';
import { listing } from '../sources/modules/agent/tools/meta.js';

function scripted(steps, log = []) {
    let i = 0;
    return {
        name: 'mock', contextTokens: 100000, requests: log,
        async *stream(req) {
            log.push(req);
            const step = steps[i++];
            if (!step)
                throw new Error('сценарий кончился на шаге ' + i);
            if (step.text)
                yield step.text;
            if (step.calls)
                yield { type: 'tool_calls', calls: step.calls.map((c, k) => ({ id: 'c' + i + '_' + k, name: c.name, arguments: c.args || {} })) };
            yield { type: 'usage', prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
        },
    };
}

const host = (extra = {}) => ({ mode: 'auto', signal: new AbortController().signal, allowed: new Set(), async save() {}, emit() {}, ...extra });
const PARAMS = { type: 'object', properties: {} };
const ls = { name: 'ls', readonly: true, parameters: PARAMS, run: () => 'a\nb' };

describe('splitSystem / toMessages', () => {
    it('строка — только стабильная часть; части — stable первым system, volatile отдельным user в конце', () => {
        assert.deepEqual(splitSystem('S'), { stable: 'S', volatile: '' });
        assert.deepEqual(splitSystem({ stable: 'A', volatile: 'B' }), { stable: 'A', volatile: 'B' });
        assert.deepEqual(splitSystem(undefined), { stable: '', volatile: '' });
        assert.equal(systemText({ stable: 'A', volatile: 'B' }), 'A\n\nB');
        assert.equal(systemText('A'), 'A');
        const items = [{ id: 'u', type: 'user', content: 'привет' }];
        const plain = toMessages('S', items);
        assert.deepEqual(plain, [{ role: 'system', content: 'S' }, { role: 'user', content: 'привет' }]);
        const split = toMessages({ stable: 'STABLE', volatile: 'Сейчас: 10:00' }, items);
        assert.deepEqual(split, [
            { role: 'system', content: 'STABLE' },
            { role: 'user', content: 'привет' },
            { role: 'user', content: VOLATILE_HEAD + 'Сейчас: 10:00' },
        ]);
        assert.ok(VOLATILE_HEAD.includes('не реплика пользователя'));
    });

    it('только одно сообщение system — первым (шаблоны моделей не терпят system посреди диалога)', () => {
        const items = [
            { id: 'u', type: 'user', content: 'x' },
            { id: 'a', type: 'assistant', content: '', tools: [{ id: 't', name: 'ls', args: {}, status: 'ok', result: 'ok' }] },
        ];
        const msgs = toMessages({ stable: 'S', volatile: 'V' }, items);
        assert.equal(msgs.filter(m => m.role === 'system').length, 1);
        assert.equal(msgs[0].role, 'system');
        assert.equal(msgs.at(-1).content, VOLATILE_HEAD + 'V');
    });

    it('служебное сообщение — перед скриншотами, пустое volatile — не добавляется', () => {
        const items = [
            { id: 'u', type: 'user', content: 'x' },
            { id: 'a', type: 'assistant', content: '', tools: [{ id: 't', name: 'computer_screenshot', args: {}, status: 'ok', result: 'экран', images: [{ url: 'data:image/png;base64,AAAA', label: 'экран' }] }] },
        ];
        const msgs = toMessages({ stable: 'S', volatile: 'V' }, items, new Map());
        assert.equal(msgs.at(-2).content, VOLATILE_HEAD + 'V');
        assert.ok(Array.isArray(msgs.at(-1).content), 'скриншоты — последним сообщением');
        assert.equal(toMessages({ stable: 'S', volatile: '' }, items, new Map()).filter(m => String(m.content).startsWith(VOLATILE_HEAD)).length, 0);
    });
});

describe('runLoop: префикс контекста между ходами', () => {
    it('stable не меняется, volatile меняется — всё до служебного сообщения идентично между запросами', async () => {
        const log = [];
        let n = 0;
        const items = [{ id: 'u', type: 'user', content: 'что в BOX' }];
        await runLoop({
            llm: scripted([{ calls: [{ name: 'ls' }] }, { calls: [{ name: 'ls' }] }, { text: 'готово' }], log),
            system: async () => ({ stable: 'СТАБИЛЬНАЯ ЧАСТЬ', volatile: 'Сейчас: 10:0' + (n++) }),
            items, tools: [ls], host: host(),
        });
        assert.equal(log.length, 3);
        const tails = log.map(r => r.messages.at(-1));
        assert.ok(tails.every(t => t.role === 'user' && t.content.startsWith(VOLATILE_HEAD)));
        assert.deepEqual(tails.map(t => t.content.slice(VOLATILE_HEAD.length)), ['Сейчас: 10:00', 'Сейчас: 10:01', 'Сейчас: 10:02']);
        const bodies = log.map(r => r.messages.slice(0, -1));
        assert.equal(bodies[0][0].content, 'СТАБИЛЬНАЯ ЧАСТЬ');
        for (let i = 1; i < bodies.length; i++)
            assert.deepEqual(bodies[i].slice(0, bodies[i - 1].length), bodies[i - 1], 'запрос ' + i + ': префикс прошлого хода изменился');
        assert.ok(bodies[2].length > bodies[0].length, 'история растёт только в конце');
    });

    it('строка system (разовые вызовы) работает как раньше: без служебного сообщения', async () => {
        const log = [];
        await runLoop({ llm: scripted([{ text: 'ок' }], log), system: 'S', items: [{ id: 'u', type: 'user', content: 'x' }], tools: [], host: host() });
        assert.deepEqual(log[0].messages.map(m => m.role), ['system', 'user']);
    });

    it('подсказка после пустого хода идёт после служебного сообщения; оценка system учитывает обе части', async () => {
        const noted = [];
        const log = [];
        let first = true;
        const llm = {
            name: 'mock', contextTokens: 100000,
            async *stream(req) {
                log.push(req);
                if (first) { first = false; yield { type: 'usage', prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 }; return; }
                yield 'ок';
            },
        };
        const system = { stable: 'стабильная часть', volatile: 'изменчивая часть' };
        await runLoop({ llm, system, items: [{ id: 'u', type: 'user', content: 'x' }], tools: [], host: host({ noteContext: c => noted.push(c) }) });
        const second = log[1].messages;
        assert.equal(second.at(-1).content, EMPTY_NUDGE);
        assert.equal(second.at(-2).content, VOLATILE_HEAD + 'изменчивая часть');
        assert.equal(noted[0].system, estimateTokens(systemText(system)));
    });

    it('сжатие контекста принимает system по частям', async () => {
        const llm = scripted([{ text: 'сводка' }]);
        const items = [{ id: 'u', type: 'user', content: 'коротко' }, { id: 'a', type: 'assistant', content: 'ок' }];
        assert.equal(await maybeCompact({ llm, items, host: host(), system: { stable: 'S', volatile: 'V' } }), false);
    });
});

describe('детерминированный порядок инструментов', () => {
    it('listing навыков/субагентов: показ по имени независимо от порядка чтения, набор первых max не меняется', () => {
        const mk = names => new Map(names.map(n => [n, { name: n, meta: { description: 'описание ' + n }, body: '' }]));
        const out = listing(mk(['zeta', 'alpha', 'mid']));
        assert.deepEqual(out.split('\n').map(l => l.split(':')[0]), ['- alpha', '- mid', '- zeta']);
        assert.equal(out, listing(mk(['mid', 'zeta', 'alpha'])));
        assert.deepEqual(listing(mk(['c', 'b', 'a']), 2).split('\n').map(l => l.split(':')[0]), ['- a', '- b'], 'сначала сортируются по имени, затем берутся первые max (a, b)');
    });

    it('stableToolOrder: по имени, не зависит от входного порядка, вход не мутируется', () => {
        const names = ['svc_b_x', 'mcp_a_z', 'svc_a_y', 'mcp_a_a'];
        const a = stableToolOrder(names.map(name => ({ name })));
        const b = stableToolOrder([...names].reverse().map(name => ({ name })));
        assert.deepEqual(a.map(t => t.name), ['mcp_a_a', 'mcp_a_z', 'svc_a_y', 'svc_b_x']);
        assert.deepEqual(b.map(t => t.name), a.map(t => t.name));
        const input = names.map(name => ({ name }));
        stableToolOrder(input);
        assert.deepEqual(input.map(t => t.name), names);
    });
});
