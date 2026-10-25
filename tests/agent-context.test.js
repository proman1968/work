/**
 * Размер контекста по реальному usage (hardening 2.2): решения о сжатии принимаются по prompt_tokens последнего ответа
 * плюс оценка добавленного после него; эвристика len/3.2 — только запасной вариант (и она учитывает схемы инструментов).
 */
import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runLoop, maybeCompact, estimateContext, toMessages, COMPACT_AT, USAGE_TRUST_MIN } from '../sources/modules/agent/loop.js';
import { estimateTokens } from '../sources/modules/agent/util.js';

const host = (extra = {}) => ({ mode: 'auto', signal: new AbortController().signal, allowed: new Set(), async save() {}, emit() {}, ...extra });
const PARAMS = { type: 'object', properties: {} };

/** Сценарная модель: usage задаётся в шаге ({ usage: { prompt, cached? } }). */
function scripted(steps, log = [], extra = {}) {
    let i = 0;
    return {
        name: 'mock', contextTokens: 100000, requests: log, ...extra,
        async *stream(req) {
            log.push(req);
            const step = steps[i++];
            if (!step)
                throw new Error('сценарий кончился на шаге ' + i);
            if (step.text)
                yield step.text;
            if (step.calls)
                yield { type: 'tool_calls', calls: step.calls.map((c, k) => ({ id: 'c' + i + '_' + k, name: c.name, arguments: c.args || {} })) };
            yield { type: 'usage', prompt_tokens: step.usage?.prompt ?? 10, completion_tokens: 5, total_tokens: (step.usage?.prompt ?? 10) + 5, cached_tokens: step.usage?.cached };
        },
    };
}

const user = (id, content = 'вопрос', time = 1000) => ({ id, type: 'user', content, time });
const asst = (id, content, usage, time = 2000) => ({ id, type: 'assistant', content, time, ...(usage ? { usage } : {}) });

describe('estimateContext: реальный usage + добавленное после него', () => {
    it('есть usage — prompt того запроса + оценка ответа и результатов после него (source usage)', () => {
        const items = [user('u'), asst('a', 'ответ', { prompt: 50000, completion: 5, total: 50005 })];
        const r = estimateContext({ items, system: 'S' });
        assert.equal(r.source, 'usage');
        assert.ok(r.tokens >= 50000 && r.tokens < 50050, 'tokens=' + r.tokens);

        const grown = [...items, user('u2', 'x'.repeat(3200))];
        const g = estimateContext({ items: grown, system: 'S' });
        assert.ok(g.tokens - r.tokens >= 1000 - 20 && g.tokens - r.tokens <= 1000 + 20, 'добавка 3200 символов ≈ 1000 токенов: ' + (g.tokens - r.tokens));
    });

    it('опора — последний ответ с usage: старые не считаются, ответы без usage и с ошибкой пропускаются', () => {
        const items = [
            user('u'), asst('a1', 'раз', { prompt: 1000 }),
            user('u2'), asst('a2', 'два', { prompt: 60000 }),
            user('u3'), { id: 'a3', type: 'assistant', content: 'без usage', time: 3000 },
            { id: 'a4', type: 'assistant', content: 'ошибка', time: 3100, error: true, usage: { prompt: 5 } },
        ];
        const r = estimateContext({ items, system: 'S' });
        assert.equal(r.source, 'usage');
        assert.ok(r.tokens > 60000 && r.tokens < 60100);
    });

    it('нет usage — эвристика: сообщения + схемы инструментов (source estimate)', () => {
        const items = [user('u', 'x'.repeat(32000))];
        const plain = estimateContext({ items, system: 'S' });
        assert.equal(plain.source, 'estimate');
        assert.equal(plain.tokens, estimateTokens(toMessages('S', items)));
        assert.equal(estimateContext({ items, system: 'S', toolsTokens: 7000 }).tokens, plain.tokens + 7000);
    });

    it('после сжатия (summary новее ответа) опора устарела — эвристика; summary старше ответа — usage действителен', () => {
        const stale = [user('u'), asst('a', 'ответ', { prompt: 90000 }, 2000), { id: 's', type: 'summary', content: 'сводка', time: 5000 }];
        assert.equal(estimateContext({ items: stale, system: 'S' }).source, 'estimate');
        const fresh = [{ id: 's', type: 'summary', content: 'сводка', time: 1000 }, user('u', 'q', 1500), asst('a', 'ответ', { prompt: 90000 }, 2000)];
        assert.equal(estimateContext({ items: fresh, system: 'S' }).source, 'usage');
        const sameMs = [{ id: 's', type: 'summary', content: 'сводка', time: 2000 }, user('u', 'q', 1500), asst('a', 'ответ', { prompt: 90000 }, 2000)];
        assert.equal(estimateContext({ items: sameMs, system: 'S' }).source, 'usage', 'сжатие в ту же мс — до запроса, usage годится');
    });

    it('недостоверный usage (меньше схем инструментов + system, которые есть в каждом запросе) — эвристика', () => {
        const items = [user('u', 'x'.repeat(3200)), asst('a', 'ответ', { prompt: 40 })];
        const bogus = estimateContext({ items, system: 'S'.repeat(3200), toolsTokens: 20000 });
        assert.equal(bogus.source, 'estimate');
        assert.ok(bogus.tokens >= 20000);
        assert.equal(estimateContext({ items, system: 'S', toolsTokens: 0 }).source, 'usage', 'без инструментов и system 40 токенов правдоподобны');
        assert.equal(USAGE_TRUST_MIN, 0.7);
    });

    it('сжатые элементы после опоры не считаются дважды', () => {
        const items = [user('u'), asst('a', 'ответ', { prompt: 1000 }), { ...user('u2', 'x'.repeat(32000)), compacted: true }];
        const r = estimateContext({ items, system: 'S' });
        assert.ok(r.tokens < 1100, 'tokens=' + r.tokens);
    });
});

describe('maybeCompact: решение по реальному usage', () => {
    const history = n => {
        const items = [];
        for (let k = 0; k < n; k++) {
            items.push(user('u' + k, 'вопрос ' + k, 1000 + k * 10));
            items.push(asst('a' + k, 'ответ ' + k, null, 1001 + k * 10));
        }
        return items;
    };

    it('короткий текст, но usage за порогом — сжимает; те же элементы без usage — нет', async () => {
        const noUsage = history(6);
        const llm = scripted([{ text: 'СВОДКА' }], [], { contextTokens: 100000 });
        assert.equal(await maybeCompact({ llm, items: noUsage, host: host(), system: 'S' }), false);

        const items = history(6);
        items.at(-1).usage = { prompt: Math.ceil(100000 * COMPACT_AT) + 500, completion: 5, total: 0 };
        assert.equal(await maybeCompact({ llm, items, host: host(), system: 'S' }), true);
        assert.ok(items.some(i => i.type === 'summary'));
    });

    it('usage ниже порога, но добавленные результаты инструментов переводят за порог — сжимает', async () => {
        const items = history(6);
        items.at(-1).usage = { prompt: 60000, completion: 5, total: 60005 };
        const llm = scripted([{ text: 'СВОДКА' }], [], { contextTokens: 100000 });
        assert.equal(await maybeCompact({ llm, items, host: host(), system: 'S' }), false, 'порог ' + 100000 * COMPACT_AT + ' не достигнут');
        items.push(user('big', 'x'.repeat(3.2 * 14000), 5000));
        items.push(asst('tail', 'ок', null, 5001));
        assert.equal(await maybeCompact({ llm, items, host: host(), system: 'S' }), true);
    });

    it('эвристика без usage учитывает схемы инструментов', async () => {
        const items = history(2);
        items[0].content = 'x'.repeat(3.2 * 10000);
        const llm = scripted([{ text: 'СВОДКА' }], [], { contextTokens: 40000 });
        assert.equal(await maybeCompact({ llm, items: structuredClone(items), host: host(), system: 'S' }), false, '10 тыс. токенов < 28,8 тыс.');
        assert.equal(await maybeCompact({ llm, items: structuredClone(items), host: host(), system: 'S', toolsTokens: 20000 }), true, '10 тыс. + схемы 20 тыс. > 28,8 тыс.');
    });

    it('force сжимает независимо от usage', async () => {
        const items = history(4);
        const llm = scripted([{ text: 'СВОДКА' }], [], { contextTokens: 100000 });
        assert.equal(await maybeCompact({ llm, items, host: host(), system: 'S', force: true }), true);
    });
});

describe('runLoop: сжатие срабатывает по usage ответа модели', () => {
    const base = () => [
        user('u1', 'старый вопрос', 1000), asst('a1', 'старый ответ', null, 1001),
        user('u2', 'ещё вопрос', 1002), asst('a2', 'ещё ответ', null, 1003),
        user('u3', 'текущая задача', 1004),
    ];
    const ls = { name: 'ls', readonly: true, parameters: PARAMS, run: () => 'a\nb' };

    it('ответ с usage за порогом → на следующем ходе перед запросом сжатие; индикатор контекста получает used и source', async () => {
        const log = [];
        const noted = [];
        const items = base();
        await runLoop({
            llm: scripted([{ calls: [{ name: 'ls' }], usage: { prompt: 80000 } }, { text: 'СВОДКА' }, { text: 'готово' }], log),
            system: 'S', items, tools: [ls], host: host({ noteContext: c => noted.push(c) }),
        });
        assert.equal(log.length, 3);
        assert.match(log[1].messages[0].content, /^Ты сжимаешь историю/, 'второй запрос — сжатие');
        assert.ok(items.some(i => i.type === 'summary'));
        assert.ok(items.filter(i => i.compacted).length >= 4);
        assert.equal(noted[0].source, 'estimate', 'до первого ответа usage нет');
        assert.equal(noted[1].source, 'estimate', 'после сжатия опора устарела — оценка по сообщениям');
        assert.ok(noted.every(n => Number.isFinite(n.used)));
    });

    it('тот же сценарий с малым usage — сжатия нет, второй запрос — обычный ход; usage идёт в индикатор', async () => {
        const log = [];
        const noted = [];
        const items = base();
        await runLoop({
            llm: scripted([{ calls: [{ name: 'ls' }], usage: { prompt: 9000 } }, { text: 'готово' }], log),
            system: 'S', items, tools: [ls], host: host({ noteContext: c => noted.push(c) }),
        });
        assert.equal(log.length, 2);
        assert.ok(!items.some(i => i.type === 'summary'));
        assert.equal(noted[1].source, 'usage');
        assert.ok(noted[1].used >= 9000 && noted[1].used < 9100, 'used=' + noted[1].used);
    });

    it('токены кэша сохраняются в usage ответа; без кэша поля нет', async () => {
        const items = [user('u1', 'привет', 1000)];
        await runLoop({ llm: scripted([{ text: 'ок', usage: { prompt: 5000, cached: 4000 } }]), system: 'S', items, tools: [], host: host() });
        assert.deepEqual(items.at(-1).usage, { prompt: 5000, completion: 5, total: 5005, cached: 4000 });
        const items2 = [user('u1', 'привет', 1000)];
        await runLoop({ llm: scripted([{ text: 'ок' }]), system: 'S', items: items2, tools: [], host: host() });
        assert.equal('cached' in items2.at(-1).usage, false);
    });
});
