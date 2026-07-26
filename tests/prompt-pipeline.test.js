/**
 * Контракт TYPE-driven prompt-пайплайна (без реального LLM).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveServicePrompt,
    parseResponseToRibbon,
    classifyStreamError,
} from '../$server/$folder/$file/$ai/class.js';

describe('resolveServicePrompt from TYPES', () => {
    it('подставляет button/title для action', () => {
        const text = resolveServicePrompt({
            type: 'action',
            title: 'План',
            button: { label: 'Начать' },
        });
        assert.ok(text.includes('Начать'), 'button в инструкции');
        assert.ok(text.includes('План'), 'title в инструкции');
        assert.ok(text.includes('Не вызывай tools'), 'канон ожидания tip');
    });

    it('для prompt отдаёт классификацию хода', () => {
        const text = resolveServicePrompt({ type: 'prompt', content: 'hi' });
        assert.ok(text.includes('reasoning'), 'канон U→M→S');
        assert.ok(text.includes('<plan>') || text.includes('plan'), 'план в классификации');
    });

    it('step/ribbon → пусто', () => {
        assert.equal(resolveServicePrompt({ type: 'step' }), '');
        assert.equal(resolveServicePrompt({ type: 'ribbon' }), '');
    });
});

describe('parseResponseToRibbon → TYPE blocks', () => {
    it('reasoning → thinking', () => {
        const { blocks } = parseResponseToRibbon(
            '<reasoning>думаю</reasoning><text unused>',
            'AI',
        );
        assert.ok(blocks.some(b => b.type === 'thinking' && b.content.includes('думаю')));
    });

    it('plan → pendingPlan (платформа сделает action)', () => {
        const { pendingPlan } = parseResponseToRibbon(
            '<reasoning>x</reasoning><plan>[{"step":1,"description":"A","status":"proposed"},{"step":2,"description":"B","status":"proposed"},{"step":3,"description":"C","status":"proposed"}]</plan>',
            'AI',
        );
        assert.ok(pendingPlan?.steps?.length >= 3);
    });
});

describe('classifyStreamError: transient vs fatal', () => {
    it('сетевые коды → transient', () => {
        for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE'])
            assert.equal(classifyStreamError({ code, message: 'x' }), 'transient', code);
    });

    it('тексты сетевых сбоев → transient', () => {
        assert.equal(classifyStreamError(new Error(
            'Client network socket disconnected before secure TLS connection was established',
        )), 'transient');
        assert.equal(classifyStreamError(new Error('socket hang up')), 'transient');
        assert.equal(classifyStreamError(new Error('request timeout')), 'transient');
    });

    it('HTTP 429 / 5xx из streamChat → transient', () => {
        assert.equal(classifyStreamError(new Error('LLM glm-5.2 stream error 429: rate limit')), 'transient');
        assert.equal(classifyStreamError(new Error('LLM glm-5.2 stream error 502: bad gateway')), 'transient');
        assert.equal(classifyStreamError(new Error('LLM glm-5.2 stream error 500: internal')), 'transient');
    });

    it('HTTP 401/403/404/422 → fatal', () => {
        for (const code of [401, 403, 404, 422])
            assert.equal(classifyStreamError(new Error('LLM glm-5.2 stream error ' + code + ': nope')), 'fatal', String(code));
    });

    it('прочее → fatal', () => {
        assert.equal(classifyStreamError(new Error('Unexpected token in JSON')), 'fatal');
        assert.equal(classifyStreamError({}), 'fatal');
    });
});
