import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeStepStatus,
    normalizeProposedSteps,
    normalizePlanSteps,
    prepareStepsForStart,
    extractBalancedJsonArray,
    ensureMinimumPlanSteps,
    formatPlanMarkdown,
    parseResponseToRibbon,
} from '../$server/$folder/$file/$ai/methods/prompt/$method/class.js';

describe('normalizeStepStatus', () => {
    it('maps synonyms to canonical statuses', () => {
        assert.equal(normalizeStepStatus('completed'), 'done');
        assert.equal(normalizeStepStatus('complete'), 'done');
        assert.equal(normalizeStepStatus('finished'), 'done');
        assert.equal(normalizeStepStatus('running'), 'in_progress');
        assert.equal(normalizeStepStatus('in-progress'), 'in_progress');
        assert.equal(normalizeStepStatus('proposed'), 'proposed');
        assert.equal(normalizeStepStatus(''), 'proposed');
    });
});

describe('normalizeProposedSteps', () => {
    it('forces all steps to proposed', () => {
        const out = normalizeProposedSteps([
            { step: 1, description: 'A', status: 'done' },
            { step: 2, description: 'B', status: 'in_progress' },
        ]);
        assert.deepEqual(out.map(s => s.status), ['proposed', 'proposed']);
    });
});

describe('normalizePlanSteps', () => {
    it('fixes last-done-only regression from history 1784652578183', () => {
        const prev = [
            { step: 1, description: 'Создать базовую структуру презентации в HTML', status: 'in_progress' },
            { step: 2, description: 'Заполнить слайды информацией о WORK', status: 'proposed' },
            { step: 3, description: 'Добавить оформление и стили', status: 'proposed' },
            { step: 4, description: 'Проверить и сохранить презентацию', status: 'proposed' },
        ];
        const bad = [
            { step: 1, description: 'Создать базовую структуру презентации в HTML', status: 'proposed' },
            { step: 2, description: 'Заполнить слайды информацией о WORK', status: 'proposed' },
            { step: 3, description: 'Добавить оформление и стили', status: 'proposed' },
            { step: 4, description: 'Проверить и сохранить презентацию', status: 'done' },
        ];
        const out = normalizePlanSteps(prev, bad);
        assert.equal(out[0].status, 'in_progress');
        assert.equal(out[1].status, 'proposed');
        assert.equal(out[2].status, 'proposed');
        assert.equal(out[3].status, 'proposed');
    });

    it('keeps legal sequential progress', () => {
        const out = normalizePlanSteps([], [
            { step: 1, description: 'A', status: 'done' },
            { step: 2, description: 'B', status: 'done' },
            { step: 3, description: 'C', status: 'in_progress' },
            { step: 4, description: 'D', status: 'proposed' },
        ]);
        assert.deepEqual(out.map(s => s.status), ['done', 'done', 'in_progress', 'proposed']);
    });

    it('allows all done', () => {
        const out = normalizePlanSteps([], [
            { step: 1, description: 'A', status: 'done' },
            { step: 2, description: 'B', status: 'done' },
        ]);
        assert.deepEqual(out.map(s => s.status), ['done', 'done']);
    });

    it('merges description from prev when next omits it', () => {
        const out = normalizePlanSteps(
            [{ step: 1, description: 'Keep me', status: 'in_progress' }],
            [{ step: 1, status: 'done' }],
        );
        assert.equal(out[0].description, 'Keep me');
        assert.equal(out[0].status, 'done');
    });

    it('does not collapse plan when model sends truncated <plan> (history 1784665814298)', () => {
        const prev = [
            { step: 1, description: 'Уточнить тему и количество слайдов презентации', status: 'done' },
            { step: 2, description: 'Создать структуру слайдов в HTML', status: 'in_progress' },
            { step: 3, description: 'Заполнить слайды контентом', status: 'proposed' },
            { step: 4, description: 'Сохранить презентацию в нужном формате', status: 'proposed' },
        ];
        const truncated = [
            { step: 3, description: 'Написать содержание слайдов', status: 'in_progress' },
        ];
        const out = normalizePlanSteps(prev, truncated);
        assert.equal(out.length, 4);
        assert.equal(out[0].status, 'done');
        assert.equal(out[0].description, 'Уточнить тему и количество слайдов презентации');
        assert.equal(out[2].description, 'Написать содержание слайдов');
        // done-префикс: шаг 2 ещё не done → in_progress, 3–4 proposed
        assert.equal(out[1].status, 'in_progress');
        assert.equal(out[2].status, 'proposed');
        assert.equal(out[3].status, 'proposed');
    });
});

describe('prepareStepsForStart', () => {
    it('sets first non-done to in_progress', () => {
        const out = prepareStepsForStart([
            { step: 1, description: 'A', status: 'proposed' },
            { step: 2, description: 'B', status: 'proposed' },
        ]);
        assert.deepEqual(out.map(s => s.status), ['in_progress', 'proposed']);
    });

    it('ignores stray done on last step at start', () => {
        const out = prepareStepsForStart([
            { step: 1, description: 'A', status: 'proposed' },
            { step: 2, description: 'B', status: 'proposed' },
            { step: 3, description: 'C', status: 'proposed' },
            { step: 4, description: 'D', status: 'done' },
        ]);
        assert.deepEqual(out.map(s => s.status), ['in_progress', 'proposed', 'proposed', 'proposed']);
    });
});

describe('extractBalancedJsonArray', () => {
    it('parses plan array with ] inside description (non-greedy regex would truncate)', () => {
        const text = `<plan>[{"step":1,"description":"Слайд [титул]","status":"proposed"},{"step":2,"description":"Контент","status":"proposed"}]</plan>`;
        const extracted = extractBalancedJsonArray(text, '<plan>', '</plan>');
        assert.ok(extracted);
        const steps = JSON.parse(extracted.raw);
        assert.equal(steps.length, 2);
        assert.equal(steps[0].description, 'Слайд [титул]');
    });

    it('parseResponseToRibbon keeps both steps when description has ]', () => {
        const { pendingPlan, blocks } = parseResponseToRibbon(
            `<plan>[{"step":1,"description":"A [x]","status":"proposed"},{"step":2,"description":"B","status":"proposed"}]</plan>
<action>{"label":"Начать","color":"success"}</action>`,
        );
        assert.equal(pendingPlan.steps.length, 2);
        const act = blocks.find(b => b.type === 'action');
        assert.match(act.content, /2\.\s*B/);
    });
});

describe('ensureMinimumPlanSteps', () => {
    it('1-step deliverable → abstract fallback (no domain filename)', () => {
        const out = ensureMinimumPlanSteps(
            [{ step: 1, description: 'Уточнить детали презентации', status: 'proposed' }],
            'сделай презентацию',
        );
        assert.equal(out.length, 4);
        assert.equal(out[0].description, 'Уточнить детали');
        assert.match(out[1].description, /артефакт/i);
        assert.doesNotMatch(out.map(s => s.description).join('\n'), /presentation\.html/i);
        const md = formatPlanMarkdown(out, '');
        assert.match(md, /2\./);
        assert.match(md, /4\./);
    });

    it('process-only multi-step deliverable → abstract fallback', () => {
        const out = ensureMinimumPlanSteps(
            [
                { step: 1, description: 'Уточнить', status: 'proposed' },
                { step: 2, description: 'Сделать слайды', status: 'proposed' },
            ],
            'сделай презентацию',
        );
        assert.equal(out.length, 4);
        assert.match(out[1].description, /артефакт/i);
        assert.doesNotMatch(out.map(s => s.description).join('\n'), /presentation\.html/i);
    });

    it('does not rewrite a 4-step artifact plan from the model', () => {
        const input = [
            { step: 1, description: 'Уточнить тему', status: 'proposed' },
            { step: 2, description: 'Создать presentation.html — каркас', status: 'proposed' },
            { step: 3, description: 'Наполнить presentation.html', status: 'proposed' },
            { step: 4, description: 'Проверить и принять', status: 'proposed' },
        ];
        const out = ensureMinimumPlanSteps(input, 'сделай презентацию');
        assert.deepEqual(out.map(s => s.description), input.map(s => s.description));
    });

    it('replaces process-only plan with abstract fallback on deliverable', () => {
        const out = ensureMinimumPlanSteps(
            [
                { step: 1, description: 'A', status: 'proposed' },
                { step: 2, description: 'B', status: 'proposed' },
                { step: 3, description: 'C', status: 'proposed' },
                { step: 4, description: 'D', status: 'proposed' },
            ],
            'сделай презентацию',
        );
        assert.equal(out.length, 4);
        assert.match(out[1].description, /артефакт/i);
        assert.doesNotMatch(out.map(s => s.description).join('\n'), /presentation\.html/i);
    });

    it('replaces thin deliverable plan with abstract fallback', () => {
        const out = ensureMinimumPlanSteps(
            [{ step: 1, description: 'Уточнить формат отчёта', status: 'proposed' }],
            'сделай отчёт',
        );
        assert.equal(out.length, 4);
        assert.match(out[1].description, /артефакт/i);
        assert.match(out[3].description, /принять/i);
    });

    it('empty model plan + deliverable → abstract fallback', () => {
        const out = ensureMinimumPlanSteps([], 'сделай презентацию');
        assert.equal(out.length, 4);
        assert.equal(out[0].description, 'Уточнить детали');
        assert.match(out[1].description, /артефакт/i);
        assert.doesNotMatch(out.map(s => s.description).join('\n'), /presentation\.html/i);
    });

    it('fills empty descriptions without rewriting non-empty artifact plan', () => {
        const out = ensureMinimumPlanSteps(
            [
                { step: 1, description: 'Уточнить тему', status: 'proposed' },
                { step: 2, description: 'Создать notes.md каркас', status: 'proposed' },
                { step: 3, description: '', status: 'proposed' },
                { step: 4, description: 'Проверить и принять notes.md', status: 'proposed' },
            ],
            'сделай файл',
        );
        assert.equal(out.length, 4);
        assert.equal(out[0].description, 'Уточнить тему');
        assert.equal(out[1].description, 'Создать notes.md каркас');
        assert.equal(out[2].description, 'Сохранить или оформить результат');
        assert.equal(out[3].description, 'Проверить и принять notes.md');
        assert.ok(!out.some(s => !String(s.description || '').trim()));
    });

    it('fills empty middle step for artifact report plan', () => {
        const out = ensureMinimumPlanSteps(
            [
                { step: 1, description: 'Уточнить аудиторию отчёта', status: 'proposed' },
                { step: 2, description: '  ', status: 'proposed' },
                { step: 3, description: 'Сохранить report.md и принять файл', status: 'proposed' },
            ],
            'сделай отчёт',
        );
        assert.equal(out[0].description, 'Уточнить аудиторию отчёта');
        assert.equal(out[1].description, 'Выполнить основную работу');
        assert.equal(out[2].description, 'Сохранить report.md и принять файл');
    });
});
