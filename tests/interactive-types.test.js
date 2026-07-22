import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseResponseToRibbon,
    normalizeInteractiveBlocks,
    normalizeActionBlocks,
    isInteractiveBlock,
} from '../$server/$folder/$file/$ai/methods/prompt/$method/class.js';

describe('parseResponseToRibbon types', () => {
    it('plan → action title План without fields', () => {
        const { blocks, pendingPlan } = parseResponseToRibbon(
            `<plan>[{"step":1,"description":"A","status":"proposed"}]</plan>
<action>{"label":"Начать","color":"success"}</action>`,
            'AI',
        );
        assert.ok(pendingPlan);
        const act = blocks.find(b => b.type === 'action');
        assert.ok(act);
        assert.equal(act.title, 'План');
        assert.equal(act.button.label, 'Начать');
        assert.equal(act.fields, undefined);
        assert.equal(blocks.some(b => b.type === 'questions' || b.type === 'form'), false);
    });

    it('questions → type questions with fields', () => {
        const { blocks } = parseResponseToRibbon(
            `<questions>[{"id":"topic","label":"Тема","type":"select","options":["A","B"]}]</questions>
Укажи тему.
<action>{"label":"Уточнить","color":"success"}</action>`,
            'AI',
        );
        const q = blocks.find(b => b.type === 'questions');
        assert.ok(q);
        assert.ok(q.fields?.length >= 1);
        assert.equal(q.button.label, 'Уточнить');
        assert.equal(blocks.some(b => b.type === 'action'), false);
    });

    it('form tag → type form', () => {
        const { blocks } = parseResponseToRibbon(
            `<form>[{"id":"name","label":"Имя","type":"text"}]</form>
<action>{"label":"Продолжить"}</action>`,
            'AI',
        );
        const f = blocks.find(b => b.type === 'form');
        assert.ok(f);
        assert.ok(f.fields?.length >= 1);
        assert.equal(f.button.label, 'Продолжить');
    });

    it('naked Уточнить without questions → no interactive button', () => {
        const { blocks } = parseResponseToRibbon(
            `Нужно уточнить тему.
<action>{"label":"Уточнить","color":"success"}</action>`,
            'AI',
        );
        assert.equal(blocks.some(isInteractiveBlock), false);
        assert.ok(blocks.some(b => b.type === 'text'));
    });

    it('ask_user tag → questions; raw XML stripped from text', () => {
        const { blocks } = parseResponseToRibbon(
            `Сначала уточню параметры.
<ask_user>{"questions":[{"id":"topic","prompt":"Тема","options":["A","B"]}]}</ask_user>
<function_caller></function_caller>`,
            'AI',
        );
        const q = blocks.find(b => b.type === 'questions');
        assert.ok(q);
        assert.ok(q.fields?.length >= 1);
        assert.equal(q.fields[0].id, 'topic');
        const text = blocks.filter(b => b.type === 'text').map(b => b.content).join('\n');
        assert.ok(!text.includes('<ask_user>'));
        assert.ok(!text.includes('</ask_user>'));
        assert.ok(!text.includes('function_caller'));
        assert.ok(!text.includes('"questions"'));
    });

    it('unclosed reasoning → thinking (stream cut mid-tag)', () => {
        const { blocks } = parseResponseToRibbon(
            `<reasoning>\nТема известна, пишу структуру слайдов.`,
            'AI',
        );
        const th = blocks.filter(b => b.type === 'thinking');
        assert.equal(th.length, 1);
        assert.ok(th[0].content.includes('пишу структуру'));
        assert.ok(!th[0].content.includes('<reasoning>'));
    });

    it('closed + trailing unclosed reasoning both kept', () => {
        const { blocks } = parseResponseToRibbon(
            `<reasoning>Первый блок</reasoning>\n<reasoning>\nВторой без закрытия`,
            'AI',
        );
        const th = blocks.filter(b => b.type === 'thinking');
        assert.equal(th.length, 2);
        assert.equal(th[0].content, 'Первый блок');
        assert.ok(th[1].content.includes('Второй'));
    });
});

describe('normalizeInteractiveBlocks', () => {
    it('plan phase forces Начать action', () => {
        const out = normalizeInteractiveBlocks([
            { type: 'action', button: { label: 'Уточнить' }, fields: [{ id: 'a' }] },
        ], { phase: 'plan' });
        const act = out.filter(b => b.type === 'action');
        assert.equal(act.length, 1);
        assert.equal(act[0].button.label, 'Начать');
        assert.equal(act[0].title, 'План');
        assert.equal(act[0].fields, undefined);
        assert.equal(out.some(b => b.type === 'questions' || b.type === 'form'), false);
    });

    it('drops Уточнить-like action without converting; keeps questions with fields', () => {
        const out = normalizeInteractiveBlocks([
            { type: 'questions', button: { label: 'Уточнить' }, fields: [{ id: 't', label: 'Тема', type: 'text', value: '' }] },
        ], { phase: 'do', allDone: false });
        assert.equal(out.filter(b => b.type === 'questions').length, 1);
        assert.ok(out[0].fields.length);
    });

    it('normalizeActionBlocks alias still works', () => {
        const out = normalizeActionBlocks([], { phase: 'plan' });
        assert.equal(out.find(b => b.type === 'action')?.button.label, 'Начать');
    });
});
