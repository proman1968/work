import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    shouldContinueDo,
    normalizeFieldMeta,
    formatPromptWithAnswers,
    nextIdleDoAction,
    getDoStepPhase,
    stepNeedsClarify,
    makeClarifyQuestions,
    questionsFromAskUser,
    ensureHarnessFunctions,
    advanceAfterClarifyAnswers,
    formatPlanMarkdown,
    keepDoAction,
    buildToolMethodParams,
    normalizeActionBlocks,
    commitDurableBlocks,
    commitIdleContent,
    mayCommitDeferredOnIdleExecuteStop,
    MAX_IDLE_DO,
    MAX_IDLE_PROPOSE,
    ASK_USER_METHOD,
} from '../$server/$folder/$file/$ai/methods/prompt/$method/class.js';

const activeIncomplete = {
    state: 'active',
    steps: [
        { step: 1, status: 'in_progress' },
        { step: 2, status: 'proposed' },
    ],
};

describe('shouldContinueDo', () => {
    it('continues idle active Do without tools or wait', () => {
        assert.equal(shouldContinueDo(activeIncomplete, false, []), true);
    });

    it('stops when waiting for user confirmation', () => {
        assert.equal(shouldContinueDo(activeIncomplete, true, []), false);
    });
});

describe('nextIdleDoAction', () => {
    it('retries until MAX_IDLE_DO then stops', () => {
        assert.equal(MAX_IDLE_DO, 3);
        assert.equal(nextIdleDoAction(0), 'retry');
        assert.equal(nextIdleDoAction(1), 'retry');
        assert.equal(nextIdleDoAction(2), 'retry');
        assert.equal(nextIdleDoAction(3), 'stop');
        assert.equal(nextIdleDoAction(99), 'stop');
    });
});

describe('commitDurableBlocks', () => {
    it('pushes thinking/text and returns the rest', () => {
        const ribbon = [];
        const rest = commitDurableBlocks(ribbon, [
            { type: 'thinking', content: 'рассуждение' },
            { type: 'text', content: 'проза' },
            { type: 'questions', fields: [{ id: 'a' }] },
            { type: 'form', fields: [{ id: 'b' }] },
            { type: 'action', button: { label: 'Начать' } },
            { type: 'error', content: 'x' },
        ]);
        assert.equal(ribbon.length, 2);
        assert.equal(ribbon[0].type, 'thinking');
        assert.equal(ribbon[1].type, 'text');
        assert.deepEqual(rest.map(b => b.type), ['questions', 'form', 'action', 'error']);
    });

    it('handles empty / non-array', () => {
        assert.deepEqual(commitDurableBlocks([], null), []);
        assert.deepEqual(commitDurableBlocks(null, [{ type: 'thinking' }, { type: 'action' }]), [
            { type: 'action' },
        ]);
    });

    it('single commit then inject: no duplicate thinking', () => {
        const ribbon = [];
        let blocks = [
            { type: 'thinking', content: 'нужны тема и слайды' },
            { type: 'text', content: 'уточню' },
        ];
        blocks = commitDurableBlocks(ribbon, blocks);
        ribbon.push(makeClarifyQuestions({ description: 'Уточнить тему' }, 'WORK'));
        // happy-path push of rest would not re-add thinking
        for (const b of blocks) ribbon.push(b);
        assert.equal(ribbon.filter(b => b.type === 'thinking').length, 1);
        assert.equal(ribbon.filter(b => b.type === 'text').length, 1);
        assert.equal(ribbon[ribbon.length - 1].type, 'questions');
    });
});

describe('commitIdleContent', () => {
    it('alias still counts pushed durable blocks', () => {
        const ribbon = [];
        const n = commitIdleContent(ribbon, [
            { type: 'thinking', content: 'x' },
            { type: 'questions', fields: [] },
        ]);
        assert.equal(n, 1);
        assert.equal(ribbon[0].type, 'thinking');
    });
});

describe('mayCommitDeferredOnIdleExecuteStop', () => {
    it('never applies deferred plan steps on idle execute stop', () => {
        assert.equal(mayCommitDeferredOnIdleExecuteStop(), false);
    });
});

describe('formatPromptWithAnswers', () => {
    it('returns only question:answer lines without button label', () => {
        const text = formatPromptWithAnswers('Уточнить', {
            topic: 'work',
            slides_count: '12',
        }, [
            { id: 'topic', label: 'Тема презентации:' },
            { id: 'slides_count', label: 'Сколько слайдов?:' },
        ]);
        assert.equal(text, 'Тема презентации: work\nСколько слайдов: 12');
        assert.ok(!text.includes('Уточнить'));
        assert.ok(!text.includes('?:'));
        assert.ok(!text.includes('::'));
    });

    it('falls back to label when no answers', () => {
        assert.equal(formatPromptWithAnswers('Начать', null), 'Начать');
    });
});

describe('keepDoAction', () => {
    it('keeps Выполнить; drops Начать and naked Уточнить; keeps questions fields', () => {
        assert.equal(keepDoAction({ type: 'action', button: { label: 'Выполнить' } }), true);
        assert.equal(keepDoAction({ type: 'action', button: { label: 'Начать' } }), false);
        assert.equal(keepDoAction({ type: 'action', button: { label: 'Уточнить' } }), false);
        assert.equal(keepDoAction({ type: 'questions', fields: [{ id: 'a' }], button: { label: 'Уточнить' } }), true);
    });
});

describe('getDoStepPhase', () => {
    it('empty ribbon: clarify → propose, otherwise execute', () => {
        assert.equal(getDoStepPhase({
            steps: [
                { step: 1, description: 'Уточнить тему и структуру презентации', status: 'in_progress' },
                { step: 2, description: 'Создать структуру', status: 'proposed' },
            ],
            ribbon: [],
        }), 'propose');
        assert.equal(getDoStepPhase({
            steps: [
                { step: 1, description: 'Создать структуру слайдов', status: 'in_progress' },
                { step: 2, description: 'Сохранить файл', status: 'proposed' },
            ],
            ribbon: [],
        }), 'execute');
        assert.equal(getDoStepPhase({
            steps: activeIncomplete.steps,
            ribbon: [{ type: 'prompt', content: 'Выполнить' }],
        }), 'execute');
        assert.equal(getDoStepPhase({
            steps: activeIncomplete.steps,
            ribbon: [{ type: 'action', button: { label: 'Выполнить' } }],
        }), 'propose');
    });
});

describe('stepNeedsClarify', () => {
    it('detects clarify steps', () => {
        assert.equal(stepNeedsClarify({ description: 'Уточнить тему' }), true);
        assert.equal(stepNeedsClarify({ description: 'Создать структуру слайдов' }), false);
    });
});

describe('makeClarifyQuestions', () => {
    it('presentation step → Cursor selects with options, not text details', () => {
        const stepDesc = 'Уточнить детали презентации';
        const q = makeClarifyQuestions({ description: stepDesc });
        assert.equal(q.type, 'questions');
        assert.equal(q.fields.length, 2);
        assert.equal(q.fields[0].id, 'topic');
        assert.equal(q.fields[0].type, 'select');
        assert.ok(q.fields[0].options.length >= 2);
        assert.equal(q.fields[1].id, 'slides');
        assert.equal(q.fields[1].type, 'select');
        assert.ok(!q.fields.some(f => f.id === 'details' || f.type === 'text'));
        assert.notEqual(q.fields[0].label, stepDesc);
        assert.equal(q.button.label, 'Уточнить');
        assert.equal(q.title, '');
        assert.equal(q.content, '');
        assert.equal(MAX_IDLE_PROPOSE, 1);
    });

    it('generic clarify step → select options, not open text', () => {
        const q = makeClarifyQuestions({ description: 'Уточнить параметры задачи' });
        assert.ok(q.fields.every(f => f.type === 'select' && f.options?.length >= 2));
        assert.ok(!q.fields.some(f => f.label === 'Что уточнить?'));
    });
});

describe('questionsFromAskUser', () => {
    it('maps Cursor-style questions with options to select fields', () => {
        assert.equal(ASK_USER_METHOD, 'ask_user');
        const q = questionsFromAskUser({
            questions: [{
                id: 'topic',
                prompt: 'Какая тема?',
                options: ['WORK', 'ИИ', 'Другое'],
            }],
        });
        assert.equal(q.type, 'questions');
        assert.equal(q.title, '');
        assert.equal(q.content, '');
        assert.equal(q.fields.length, 1);
        assert.equal(q.fields[0].id, 'topic');
        assert.equal(q.fields[0].label, 'Какая тема?');
        assert.equal(q.fields[0].type, 'select');
        assert.deepEqual(q.fields[0].options, ['WORK', 'ИИ', 'Другое']);
        assert.equal(q.button.label, 'Уточнить');
    });

    it('maps legacy fields with options and strips boilerplate title/content', () => {
        const q = questionsFromAskUser({
            title: 'Уточнение',
            content: 'Уточните параметры',
            fields: [{
                id: 'topic',
                label: 'Тема презентации',
                type: 'select',
                options: ['A', 'B', 'C'],
            }],
            label: 'Уточнить',
        });
        assert.equal(q.fields[0].id, 'topic');
        assert.equal(q.fields[0].type, 'select');
        assert.equal(q.title, '');
        assert.equal(q.content, '');
    });

    it('empty / text-without-options → makeClarifyQuestions shape', () => {
        const empty = questionsFromAskUser({});
        assert.ok(empty.fields.every(f => f.type === 'select' && f.options?.length >= 2));
        const noOpts = questionsFromAskUser({ question: 'Какая тема?' });
        assert.ok(noOpts.fields.every(f => f.type === 'select' && f.options?.length >= 2));
        const presentation = questionsFromAskUser(
            { fields: [{ id: 'x', label: 'Тема', type: 'text' }] },
            'WORK',
            { description: 'Уточнить тему презентации' },
        );
        assert.equal(presentation.fields[0].id, 'topic');
        assert.equal(presentation.fields[0].type, 'select');
    });
});

describe('formatPlanMarkdown', () => {
    it('lists steps without ## План heading', () => {
        const md = formatPlanMarkdown([
            { step: 1, description: 'A' },
            { step: 2, description: 'B' },
        ]);
        assert.equal(md, '1. A\n2. B');
        assert.ok(!md.includes('## План'));
    });
});

describe('normalizeFieldMeta', () => {
    it('defaults missing value to empty string', () => {
        assert.equal(normalizeFieldMeta({ id: 'topic', type: 'text' }).value, '');
    });
});

describe('buildToolMethodParams', () => {
    it('forwards params.role and user for generic methods', () => {
        const user = { uid: 'u1' };
        const p = buildToolMethodParams(
            { method: 'create', args: { name: 'a.html' } },
            { user, role: 'USER' },
        );
        assert.equal(p.role, 'USER');
        assert.equal(p.user, user);
        assert.equal(p.name, 'a.html');
    });

    it('uses aiUser for save_file but keeps user role', () => {
        const user = { uid: 'u1' };
        const aiUser = { uid: 'GigaChat', isAI: true, $user: user };
        const p = buildToolMethodParams(
            { method: 'save_file', args: { filename: 'x.html', post: 'hi' } },
            { user, role: 'BOSS' },
            { aiUser },
        );
        assert.equal(p.role, 'BOSS');
        assert.equal(p.user, aiUser);
        assert.equal(p.filename, 'x.html');
    });
});

describe('ensureHarnessFunctions', () => {
    it('adds save_file read_file ask_user for FC', () => {
        const fns = ensureHarnessFunctions([]);
        const names = fns.map(f => f.name);
        assert.ok(names.includes('save_file'));
        assert.ok(names.includes('read_file'));
        assert.ok(names.includes(ASK_USER_METHOD));
        assert.ok(names.includes('navigate'));
        const sf = fns.find(f => f.name === 'save_file');
        assert.ok(sf.parameters.required.includes('filename'));
        assert.ok(sf.parameters.required.includes('post'));
        // idempotent + overwrite schema duplicate
        assert.equal(ensureHarnessFunctions(fns).filter(f => f.name === 'save_file').length, 1);
        const withSchema = ensureHarnessFunctions([{ name: 'save_file', parameters: { required: ['x'] } }]);
        assert.equal(withSchema.filter(f => f.name === 'save_file').length, 1);
        assert.ok(withSchema.find(f => f.name === 'save_file').parameters.required.includes('filename'));
    });
});

describe('advanceAfterClarifyAnswers', () => {
    it('marks clarify step done and advances next', () => {
        const task = {
            steps: [
                { step: 1, description: 'Уточнить тему презентации', status: 'in_progress' },
                { step: 2, description: 'Создать структуру', status: 'proposed' },
            ],
        };
        advanceAfterClarifyAnswers(task);
        assert.equal(task.steps[0].status, 'done');
        assert.equal(task.steps[1].status, 'in_progress');
    });

    it('ignores non-clarify execute steps', () => {
        const task = {
            steps: [
                { step: 1, description: 'Создать структуру слайдов', status: 'in_progress' },
                { step: 2, description: 'Сохранить', status: 'proposed' },
            ],
        };
        advanceAfterClarifyAnswers(task);
        assert.equal(task.steps[0].status, 'in_progress');
        assert.equal(task.steps[1].status, 'proposed');
    });
});

describe('normalizeActionBlocks', () => {
    it('plan: Уточнить + fields → Начать without fields', () => {
        const out = normalizeActionBlocks([
            {
                type: 'action',
                button: { label: 'Уточнить', color: 'success' },
                fields: [{ id: 'topic', type: 'text' }],
            },
        ], { phase: 'plan' });
        const actions = out.filter(b => b.type === 'action');
        assert.equal(actions.length, 1);
        assert.equal(actions[0].button.label, 'Начать');
        assert.equal(actions[0].fields, undefined);
    });

    it('do allDone → Принять; do action+fields → questions', () => {
        const done = normalizeActionBlocks([
            { type: 'action', button: { label: 'OK' } },
        ], { phase: 'do', allDone: true });
        assert.equal(done.find(b => b.type === 'action').button.label, 'Принять');
        assert.equal(done.find(b => b.type === 'action').title, 'Отчёт');

        const form = normalizeActionBlocks([
            {
                type: 'action',
                button: { label: '' },
                fields: [{ id: 'a' }],
            },
        ], { phase: 'do', allDone: false });
        const q = form.find(b => b.type === 'questions');
        assert.ok(q);
        assert.equal(q.button.label, 'Уточнить');
        assert.ok(q.fields?.length);
    });
});
