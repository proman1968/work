/**
 * Контракт TYPE-driven prompt-пайплайна (без реального LLM).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveServicePrompt,
    parseResponseToRibbon,
} from '../$server/$folder/$file/$ai/methods/prompt/$method/class.js';

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
