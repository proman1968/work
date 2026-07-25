import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    shouldContinueDo,
    normalizeFieldMeta,
    formatPromptWithAnswers,
    nextIdleDoAction,
    getDoStepPhase,
    stepNeedsClarify,
    artifactFilenameFromStep,
    stepNeedsForcedSaveFile,
    resolveFunctionCallMode,
    makeClarifyQuestions,
    questionsFromAskUser,
    ensureHarnessFunctions,
    advanceAfterClarifyAnswers,
    advanceAfterSuccessfulSave,
    currentStepDescription,
    formatPlanMarkdown,
    keepDoAction,
    buildToolMethodParams,
    normalizeActionBlocks,
    commitDurableBlocks,
    commitIdleContent,
    taskHasSuccessfulSave,
    makeIdleExecuteResumeAction,
    appendDoForceNudge,
    appendPlanForceNudge,
    synthesizePlanAfterIdle,
    looksLikeDeliverableRequest,
    ensureMinimumPlanSteps,
    planLooksLikeArtifactWork,
    parseToolCalls,
    parseXmlTagAttrs,
    buildHistoryFromRibbon,
    applyHarnessDoneCap,
    countDoneSteps,
    pushStepAnnounce,
    expandStepWithSubplan,
    workPathFromHistoryPath,
    stepIsAcceptOnly,
    finalizeAcceptOnlySteps,
    parseResponseToRibbon,
    dropTextBlocksBesidePlanAction,
    dropTextBlocksBesideDoInteractive,
    stripRawActionJsonFromProse,
    normalizeInteractiveBlocks,
    pushStepPrompt,
    formatStepPromptContent,
    ensureFillSubplan,
    isStubWriteContent,
    lastSuccessfulWriteWasStub,
    allContentWorkDone,
    summarizeToolResultForRibbon,
    compactToolResultContentForHistory,
    pushToolResult,
    mapAskQuestionToField,
    defaultOptionsForAskField,
    MAX_IDLE_DO,
    MAX_IDLE_PROPOSE,
    ASK_USER_METHOD,
    estimateTokens,
    estimateMessagesTokens,
    resolveTurnUsage,
    applyTurnUsage,
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

    it('idle silent-ok only when plan done even if prior save', () => {
        const withSave = {
            state: 'active',
            steps: [
                { step: 1, status: 'done' },
                { step: 2, status: 'in_progress' },
            ],
            ribbon: [{ type: 'tool_result', tool: 'save_file', ok: true }],
        };
        assert.equal(taskHasSuccessfulSave(withSave), true);
        assert.equal(shouldContinueDo(withSave, false, []), true);
        // Silent ok gate: save && !shouldContinueDo
        assert.equal(taskHasSuccessfulSave(withSave) && !shouldContinueDo(withSave, false, []), false);

        const allDone = {
            state: 'active',
            steps: [
                { step: 1, status: 'done' },
                { step: 2, status: 'done' },
            ],
            ribbon: [{ type: 'tool_result', tool: 'save_file', ok: true }],
        };
        assert.equal(shouldContinueDo(allDone, false, []), false);
        assert.equal(taskHasSuccessfulSave(allDone) && !shouldContinueDo(allDone, false, []), true);
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

    it('empty args → makeClarifyQuestions; field without options gets defaults', () => {
        const empty = questionsFromAskUser({});
        assert.ok(empty.fields.every(f => f.type === 'select' && f.options?.length >= 2));
        const noOpts = questionsFromAskUser({ question: 'Какая тема?' });
        assert.ok(noOpts.fields.every(f => f.type === 'select' && f.options?.length >= 2));
        const withId = questionsFromAskUser(
            { fields: [{ id: 'x', label: 'Тема', type: 'text' }] },
            'WORK',
            { description: 'Уточнить тему презентации' },
        );
        assert.equal(withId.fields[0].id, 'x');
        assert.equal(withId.fields[0].type, 'select');
        assert.ok(withId.fields[0].options.length >= 2);
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
    it('adds ask_user and missing helpers; does not overwrite schema save_file', () => {
        const fns = ensureHarnessFunctions([]);
        const names = fns.map(f => f.name);
        assert.ok(names.includes('save_file'));
        assert.ok(names.includes('read_file'));
        assert.ok(names.includes(ASK_USER_METHOD));
        assert.ok(names.includes('navigate'));
        const sf = fns.find(f => f.name === 'save_file');
        assert.ok(sf.parameters.required.includes('filename'));
        assert.ok(sf.parameters.required.includes('post'));
        assert.equal(ensureHarnessFunctions(fns).filter(f => f.name === 'save_file').length, 1);
        const withSchema = ensureHarnessFunctions([{ name: 'save_file', parameters: { required: ['x'] } }]);
        assert.equal(withSchema.filter(f => f.name === 'save_file').length, 1);
        assert.deepEqual(withSchema.find(f => f.name === 'save_file').parameters.required, ['x']);
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

    it('advances empty-description step after form answers', () => {
        const task = {
            steps: [
                { step: 1, description: '', status: 'in_progress' },
                { step: 2, description: 'Создать presentation.html', status: 'proposed' },
            ],
        };
        advanceAfterClarifyAnswers(task);
        assert.equal(task.steps[0].status, 'done');
        assert.equal(task.steps[1].status, 'in_progress');
    });
});

describe('advanceAfterSuccessfulSave', () => {
    it('marks execute step done and advances next', () => {
        const task = {
            steps: [
                { step: 1, description: 'Создать структуру presentation.md', status: 'in_progress' },
                { step: 2, description: 'Заполнить слайды', status: 'proposed' },
            ],
        };
        assert.equal(advanceAfterSuccessfulSave(task, null, {
            post: '<html><body>' + 'section '.repeat(80) + '</body></html>',
        }), true);
        assert.equal(task.steps[0].status, 'done');
        assert.equal(task.steps[1].status, 'in_progress');
    });

    it('no-op if plan already marked step done (no double-advance)', () => {
        const task = {
            steps: [
                { step: 1, description: 'Наполнить', status: 'done' },
                { step: 2, description: 'Дополнить', status: 'in_progress' },
            ],
        };
        assert.equal(advanceAfterSuccessfulSave(task, { step: 1 }), false);
        assert.equal(task.steps[0].status, 'done');
        assert.equal(task.steps[1].status, 'in_progress');
    });

    it('ignores clarify steps', () => {
        const task = {
            steps: [
                { step: 1, description: 'Уточнить тему презентации', status: 'in_progress' },
                { step: 2, description: 'Создать', status: 'proposed' },
            ],
        };
        assert.equal(advanceAfterSuccessfulSave(task), false);
        assert.equal(task.steps[0].status, 'in_progress');
    });
});

describe('currentStepDescription', () => {
    it('returns in_progress description', () => {
        assert.equal(currentStepDescription([
            { status: 'done', description: 'A' },
            { status: 'in_progress', description: 'Наполнить presentation.md структурой' },
            { status: 'proposed', description: 'C' },
        ]), 'Наполнить presentation.md структурой');
    });

    it('falls back to first non-done', () => {
        assert.equal(currentStepDescription([
            { status: 'done', description: 'A' },
            { status: 'proposed', description: 'B' },
        ]), 'B');
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

describe('makeIdleExecuteResumeAction', () => {
    it('returns Выполнить action for open plan step', () => {
        const a = makeIdleExecuteResumeAction(
            { step: 3, description: 'Наполнить артефакт', status: 'in_progress' },
            'WORK',
        );
        assert.equal(a.type, 'action');
        assert.equal(a.title, 'Действие');
        assert.equal(a.button.label, 'Выполнить');
        assert.equal(a.button.color, 'success');
        assert.match(a.content || '', /Наполнить артефакт/);
        assert.equal(a.sender, 'WORK');
    });
});

describe('looksLikeDeliverableRequest / appendPlanForceNudge', () => {
    it('detects artifact-style user asks', () => {
        assert.equal(looksLikeDeliverableRequest('сделай презентацию'), true);
        assert.equal(looksLikeDeliverableRequest('создай файл отчёта'), true);
        assert.equal(looksLikeDeliverableRequest('привет'), false);
        assert.equal(looksLikeDeliverableRequest('что ты умеешь?'), false);
    });

    it('appends Plan-phase reminder', () => {
        const messages = [{ role: 'system', content: 'sys' }];
        appendPlanForceNudge(messages);
        assert.equal(messages.length, 2);
        assert.equal(messages[1].role, 'user');
        assert.match(messages[1].content, /<plan>/);
        assert.match(messages[1].content, /Начать/);
    });
});

describe('synthesizePlanAfterIdle', () => {
    it('builds abstract fallback plan + Начать action', () => {
        const { pendingPlan, actionBlock } = synthesizePlanAfterIdle('сделай презентацию', 'WORK');
        assert.equal(pendingPlan.label, 'План');
        assert.equal(pendingPlan.steps.length, 4);
        assert.match(pendingPlan.steps[1].description, /артефакт/i);
        assert.doesNotMatch(pendingPlan.steps.map(s => s.description).join('\n'), /presentation\.html/i);
        assert.equal(actionBlock.type, 'action');
        assert.equal(actionBlock.button.label, 'Начать');
        assert.equal(actionBlock.title, 'План');
        assert.match(actionBlock.content || '', /Уточнить детали/);
        assert.equal(actionBlock.sender, 'WORK');
    });

    it('matches ensureMinimumPlanSteps for empty model plan', () => {
        const steps = ensureMinimumPlanSteps([], 'сделай презентацию');
        const { pendingPlan } = synthesizePlanAfterIdle('сделай презентацию');
        assert.deepEqual(pendingPlan.steps.map(s => s.description), steps.map(s => s.description));
    });
});

describe('appendDoForceNudge', () => {
    it('appends user reminder with step label', () => {
        const messages = [{ role: 'system', content: 'sys' }];
        appendDoForceNudge(messages, { description: 'Создать отчёт' });
        assert.equal(messages.length, 2);
        assert.equal(messages[1].role, 'user');
        assert.match(messages[1].content, /Создать отчёт/);
        assert.match(messages[1].content, /tool call/);
        assert.match(messages[1].content, /save_file/);
    });

    it('names artifact file when present in step', () => {
        const messages = [];
        appendDoForceNudge(messages, { description: 'Создать файл presentation.html (первая версия)' });
        assert.match(messages[0].content, /presentation\.html/);
        assert.match(messages[0].content, /tool call/);
    });
});

describe('resolveFunctionCallMode force save_file', () => {
    const fns = [{ name: 'save_file' }];

    it('artifactFilenameFromStep extracts filename', () => {
        assert.equal(
            artifactFilenameFromStep({ description: 'Создать файл presentation.html (первая версия)' }),
            'presentation.html',
        );
        assert.equal(artifactFilenameFromStep({ description: 'Уточнить тему' }), '');
    });

    it('stepNeedsForcedSaveFile true for file execute step', () => {
        assert.equal(
            stepNeedsForcedSaveFile({ description: 'Создать файл presentation.html' }, fns),
            true,
        );
        assert.equal(
            stepNeedsForcedSaveFile({ description: 'Уточнить тему презентации' }, fns),
            false,
        );
        assert.equal(
            stepNeedsForcedSaveFile({ description: 'Создать файл presentation.html' }, []),
            false,
        );
    });

    it('resolveFunctionCallMode forces save_file on execute file step', () => {
        const step = { description: 'Создать файл presentation.html (первая версия)' };
        assert.deepEqual(resolveFunctionCallMode('execute', step, fns), { name: 'save_file' });
        assert.equal(resolveFunctionCallMode('propose', step, fns), 'auto');
        assert.equal(resolveFunctionCallMode('execute', { description: 'Уточнить тему' }, fns), 'auto');
    });
});

describe('buildHistoryFromRibbon forceDoReminder nudge', () => {
    it('appends user reminder on execute forceDoReminder', () => {
        const body = {
            system: 'base',
            ribbon: [{
                type: 'task',
                state: 'active',
                label: 'Задача',
                steps: [
                    { step: 1, description: 'Уточнить', status: 'done' },
                    { step: 2, description: 'Записать результат', status: 'in_progress' },
                ],
                ribbon: [
                    { type: 'tool_result', tool: 'save_file', ok: true, content: '{}' },
                    { type: 'text', content: 'Продолжаем?' },
                ],
            }],
        };
        const messages = buildHistoryFromRibbon(body, false, { forceDoReminder: true });
        const last = messages[messages.length - 1];
        assert.equal(last.role, 'user');
        assert.match(last.content, /Записать результат/);
        assert.match(last.content, /tool call/);
    });
});

describe('buildHistoryFromRibbon forcePlanReminder', () => {
    it('adds Plan-phase reminder in system and user message', () => {
        const body = {
            system: 'base',
            ribbon: [{ type: 'prompt', content: 'сделай презентацию' }],
        };
        const messages = buildHistoryFromRibbon(body, false, { forcePlanReminder: true });
        const sys = messages.find(m => m.role === 'system');
        assert.match(sys?.content || '', /Plan-фаза/);
        assert.match(sys?.content || '', /<plan>/);
        const last = messages[messages.length - 1];
        assert.equal(last.role, 'user');
        assert.match(last.content, /<plan>/);
        assert.match(last.content, /Начать/);
    });
});

describe('buildHistoryFromRibbon servicePrompt', () => {
    it('merges prompt servicePrompt into the same user message', () => {
        const body = {
            system: 'base',
            ribbon: [{ type: 'prompt', content: 'сделай отчёт' }],
        };
        const messages = buildHistoryFromRibbon(body, false);
        const user = messages.find(m => m.role === 'user');
        assert.match(user?.content || '', /^сделай отчёт/);
        assert.match(user?.content || '', /\[инструкция\]/);
        assert.match(user?.content || '', /<plan>/);
        assert.equal(messages.filter(m => m.role === 'user').length, 1);
    });

    it('puts thinking content in messages and service after it in scope', () => {
        const body = {
            system: 'base',
            ribbon: [
                { type: 'prompt', content: 'задача' },
                { type: 'thinking', content: 'Нужен план из четырёх шагов' },
            ],
        };
        const messages = buildHistoryFromRibbon(body, false);
        const thinkingMsg = messages.find(m => m.role === 'assistant' && /четырёх шагов/.test(m.content));
        assert.ok(thinkingMsg);
        const after = messages[messages.indexOf(thinkingMsg) + 1];
        assert.equal(after?.role, 'user');
        assert.match(after?.content || '', /\[инструкция\]/);
        assert.match(after?.content || '', /Не заканчивай ход/i);
    });

    it('maps file fact + service after last prompt', () => {
        const body = {
            system: 'base',
            ribbon: [
                { type: 'prompt', content: 'обработай файл' },
                { type: 'file', path: '/work/a.md', name: 'a.md' },
            ],
        };
        const messages = buildHistoryFromRibbon(body, false);
        const fact = messages.find(m => /Вложение:/.test(m.content || ''));
        assert.match(fact?.content || '', /\/work\/a\.md/);
        const svc = messages[messages.indexOf(fact) + 1];
        assert.match(svc?.content || '', /\[инструкция\]/);
        assert.match(svc?.content || '', /read_file/);
    });

    it('maps action fact + service; does not mutate ribbon', () => {
        const ribbon = [
            { type: 'prompt', content: 'старт' },
            { type: 'action', title: 'План', button: { label: 'Начать' } },
        ];
        const body = { system: 'base', ribbon };
        const messages = buildHistoryFromRibbon(body, false);
        assert.match(messages.map(m => m.content).join('\n'), /UI action «План»/);
        assert.match(messages.map(m => m.content).join('\n'), /\[инструкция\].*Начать/s);
        assert.equal(ribbon.length, 2);
        assert.ok(!JSON.stringify(ribbon).includes('[инструкция]'));
    });

    it('does not inject service on tool_result before last prompt', () => {
        const body = {
            system: 'base',
            ribbon: [
                { type: 'prompt', content: 'первый' },
                { type: 'tool_result', tool: 'save_file', ok: true, content: '{"ok":true}' },
                { type: 'prompt', content: 'второй ход' },
            ],
        };
        const messages = buildHistoryFromRibbon(body, false);
        const joined = messages.map(m => m.content || '').join('\n---\n');
        assert.equal((joined.match(/Если ok — продолжай/g) || []).length, 0);
        assert.match(joined, /второй ход/);
        assert.match(joined, /\[инструкция\].*<plan>/s);
    });
});

describe('token usage estimate / applyTurnUsage', () => {
    it('estimateTokens uses denser rate for cyrillic', () => {
        assert.equal(estimateTokens('abcd'.repeat(25)), 25);
        assert.equal(estimateTokens('абвг'.repeat(25)), 40);
    });

    it('resolveTurnUsage falls back to messages estimate when no API usage', () => {
        const messages = [
            { role: 'system', content: 'sys ' + 'x'.repeat(40) },
            { role: 'user', content: '[инструкция] plan' },
        ];
        const u = resolveTurnUsage(null, messages, 'hello world');
        assert.equal(u.source, 'estimate');
        assert.ok(u.prompt > 0);
        assert.ok(u.completion > 0);
        assert.equal(u.total, u.prompt + u.completion);
    });

    it('resolveTurnUsage keeps API usage without replacing by estimate', () => {
        const u = resolveTurnUsage(
            { prompt: 10, completion: 5, total: 15, source: 'api' },
            [{ role: 'user', content: 'x'.repeat(1000) }],
            'ignored',
        );
        assert.equal(u.source, 'api');
        assert.equal(u.prompt, 10);
        assert.equal(u.total, 15);
    });

    it('applyTurnUsage accumulates body.usage including turns/lastSource', () => {
        const body = { ribbon: [] };
        const ribbon = [{ type: 'thinking', content: 'мысли' }];
        const estimated = resolveTurnUsage(null, [{ role: 'user', content: 'hi' }], 'ok');
        applyTurnUsage(body, ribbon, estimated, { contextWindow: 100000 });
        assert.ok(body.usage.total > 0);
        assert.equal(body.usage.turns, 1);
        assert.equal(body.usage.lastSource, 'estimate');
        applyTurnUsage(body, ribbon, { prompt: 100, completion: 20, total: 120, source: 'api' }, { contextWindow: 100000 });
        assert.equal(body.usage.turns, 2);
        assert.equal(body.usage.lastSource, 'api');
        assert.equal(body.usage.prompt, estimated.prompt + 100);
    });

    it('estimateMessagesTokens counts system and service instructions', () => {
        const n = estimateMessagesTokens([
            { role: 'system', content: 'identity ' + 'я'.repeat(50) },
            { role: 'user', content: '[инструкция] ' + 'п'.repeat(50) },
        ]);
        assert.ok(n > estimateTokens('short'));
    });
});

describe('parseToolCalls XML multiline post', () => {
    it('keeps HTML post with nested quotes and tags', () => {
        const html = '<!DOCTYPE html>\n<html lang="ru">\n<head><meta charset="UTF-8"></head>\n<body><p>Hi</p></body>\n</html>';
        const text = '<save_file filename="report.html" post="' + html + '" />';
        const calls = parseToolCalls(text, [{ name: 'save_file' }]);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].method, 'save_file');
        assert.equal(calls[0].args.filename, 'report.html');
        assert.equal(calls[0].args.post, html);
        assert.match(calls[0].args.post, /lang="ru"/);
        assert.match(calls[0].args.post, /<meta charset="UTF-8">/);
    });

    it('parseXmlTagAttrs keeps nested quotes inside post', () => {
        const attrs = parseXmlTagAttrs('filename="a.html" post="<div class="x">ok</div>"');
        assert.equal(attrs.filename, 'a.html');
        assert.equal(attrs.post, '<div class="x">ok</div>');
    });
});

describe('parseToolCalls Light <function calling>', () => {
    const fns = [{ name: 'save_file' }];

    it('parses <function calling>save_file({…})</function calling>', () => {
        const text = '<function calling>save_file({filename:"presentation.html", post:"Тема: ИИ"})</function calling>';
        const calls = parseToolCalls(text, fns);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].method, 'save_file');
        assert.equal(calls[0].args.filename, 'presentation.html');
        assert.equal(calls[0].args.post, 'Тема: ИИ');
    });

    it('parses bare save_file({…}) when known', () => {
        const text = 'save_file({filename:"a.html", post:"x"})';
        const calls = parseToolCalls(text, fns);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].method, 'save_file');
        assert.equal(calls[0].args.filename, 'a.html');
        assert.equal(calls[0].args.post, 'x');
    });

    it('strips function calling from ribbon prose', () => {
        const text = '<function calling>save_file({filename:"presentation.html", post:"Тема: ИИ"})</function calling> Презентация создана.';
        const { blocks } = parseResponseToRibbon(text, '/MODELS/GigaChat/GigaChat Light');
        const prose = blocks.filter(b => b.type === 'text').map(b => b.content).join('\n');
        assert.equal(prose.includes('function calling'), false);
        assert.equal(prose.includes('save_file('), false);
        assert.match(prose, /Презентация создана/);
    });
});

describe('applyHarnessDoneCap', () => {
    it('blocks model from painting all steps done', () => {
        const prev = [
            { step: 1, description: 'A', status: 'done' },
            { step: 2, description: 'B', status: 'in_progress' },
            { step: 3, description: 'C', status: 'proposed' },
            { step: 4, description: 'D', status: 'proposed' },
        ];
        const fakeAllDone = prev.map(s => ({ ...s, status: 'done' }));
        const capped = applyHarnessDoneCap(prev, fakeAllDone, false);
        assert.equal(countDoneSteps(capped), 1);
        assert.equal(capped[1].status, 'in_progress');
        assert.equal(capped.every(s => s.status === 'done'), false);
    });

    it('allowOneMoreDone advances at most one step', () => {
        const prev = [
            { step: 1, description: 'A', status: 'done' },
            { step: 2, description: 'B', status: 'in_progress' },
            { step: 3, description: 'C', status: 'proposed' },
        ];
        const next = [
            { step: 1, status: 'done' },
            { step: 2, status: 'done' },
            { step: 3, status: 'done' },
        ];
        const capped = applyHarnessDoneCap(prev, next, true);
        assert.equal(countDoneSteps(capped), 2);
        assert.equal(capped[2].status, 'in_progress');
    });
});

describe('pushStepAnnounce', () => {
    it('is a no-op (no text stepAnnounce in ribbon)', () => {
        const ribbon = [];
        const a = pushStepAnnounce(ribbon, { step: 2, description: 'Создать файл' }, 'WORK');
        assert.equal(a, null);
        assert.equal(ribbon.length, 0);
    });
});

describe('expandStepWithSubplan', () => {
    it('replaces current step with substeps', () => {
        const task = {
            steps: [
                { step: 1, description: 'Уточнить', status: 'done' },
                { step: 2, description: 'Большой шаг', status: 'in_progress' },
                { step: 3, description: 'Принять', status: 'proposed' },
            ],
        };
        const ok = expandStepWithSubplan(task, task.steps[1], [
            { description: 'Часть A' },
            { description: 'Часть B' },
        ]);
        assert.equal(ok, true);
        assert.equal(task.steps.length, 4);
        assert.equal(task.steps[0].description, 'Уточнить');
        assert.equal(task.steps[0].status, 'done');
        assert.equal(task.steps[1].description, 'Часть A');
        assert.equal(task.steps[1].status, 'in_progress');
        assert.equal(task.steps[2].description, 'Часть B');
        assert.equal(task.steps[3].description, 'Принять');
    });
});

describe('workPathFromHistoryPath', () => {
    it('maps history snapshot to work file path (helper only; UI uses history)', () => {
        const hp = '/USERS/u1/$user/text/.presentation.html/history/2026-07-23/1.GigaChat.html';
        assert.equal(
            workPathFromHistoryPath(hp, 'presentation.html'),
            '/USERS/u1/$user/text/presentation.html',
        );
    });
});

describe('ensureFillSubplan', () => {
    it('does not auto-expand fill into N slides from answers', () => {
        const task = {
            steps: [
                { step: 1, description: 'Уточнить', status: 'done' },
                { step: 2, description: 'Заполнить слайды информацией', status: 'in_progress' },
                { step: 3, description: 'Проверить и принять', status: 'proposed' },
            ],
            ribbon: [{ type: 'prompt', answers: { topic: 'WORK', slides: '5' } }],
        };
        const r = ensureFillSubplan(task, task.steps[1]);
        assert.equal(r.expanded, false);
        assert.equal(r.blocked, false);
        assert.equal(task.steps.length, 3);
        assert.equal(task.steps[1].description, 'Заполнить слайды информацией');
    });

    it('does not block fill save without subplan', () => {
        const task = {
            steps: [
                { step: 1, description: 'Заполнить контент деталями', status: 'in_progress' },
            ],
            ribbon: [],
        };
        const r = ensureFillSubplan(task, task.steps[0]);
        assert.equal(r.blocked, false);
        assert.equal(r.expanded, false);
    });
});

describe('advanceAfterSuccessfulSave stub/fill', () => {
    it('advances fill step on non-stub save (no auto slide subplan)', () => {
        const task = {
            steps: [
                { step: 1, description: 'Заполнить слайды информацией', status: 'in_progress' },
                { step: 2, description: 'Принять', status: 'proposed' },
            ],
        };
        assert.equal(advanceAfterSuccessfulSave(task, task.steps[0], {
            post: '<html><body><h1>Тема</h1><p>Реальный абзац про содержание.</p></body></html>',
        }), true);
        assert.equal(task.steps[0].status, 'done');
        assert.equal(task.steps[1].status, 'in_progress');
    });

    it('does not advance slide substep on stub post', () => {
        const task = {
            steps: [
                { step: 1, description: 'Слайд 1', status: 'in_progress' },
                { step: 2, description: 'Слайд 2', status: 'proposed' },
            ],
        };
        assert.equal(advanceAfterSuccessfulSave(task, task.steps[0], {
            post: '<html><body><div>Слайд 1 из 5</div></body></html>',
        }), false);
    });

    it('short non-skeleton HTML is not stub (no length hard-fail)', () => {
        assert.equal(isStubWriteContent('<html><body><h1>ИИ</h1><p>Краткий текст.</p></body></html>'), false);
        assert.equal(isStubWriteContent(''), true);
    });

    it('token macros are stub without domain names', () => {
        assert.equal(isStubWriteContent('`_FOO_BAR_`'), true);
        assert.equal(isStubWriteContent('_FOO_BAR_'), true);
        assert.equal(isStubWriteContent('`HEADERS`'), true);
        assert.equal(isStubWriteContent('<PLACEHOLDER>'), true);
        assert.equal(isStubWriteContent('<div class="slide">A</div>', 'file.html'), false);
    });

    it('does not advance structure step on token macro post', () => {
        const task = {
            steps: [
                { step: 1, description: 'Создать report.html — структура и каркас', status: 'in_progress' },
                { step: 2, description: 'Наполнить', status: 'proposed' },
            ],
        };
        assert.equal(advanceAfterSuccessfulSave(task, task.steps[0], {
            filename: 'report.html',
            post: '\n``_FOO_HEADERS``\n',
        }), false);
        assert.equal(task.steps[0].status, 'in_progress');
    });

    it('lastSuccessfulWriteWasStub reads ribbon write args', () => {
        assert.equal(lastSuccessfulWriteWasStub([
            { type: 'tool_result', tool: 'save_file', ok: true, args: { filename: 'a.html', post: '_FOO_' } },
        ]), true);
        assert.equal(lastSuccessfulWriteWasStub([
            { type: 'tool_result', tool: 'save_file', ok: true, args: { filename: 'a.html', post: '<div>ok</div>' } },
        ]), false);
    });
});

describe('ensureMinimumPlanSteps artifact canon', () => {
    it('replaces process-only deliverable plan with abstract fallback', () => {
        const steps = ensureMinimumPlanSteps([
            { step: 1, description: 'Определить тему и цель презентации', status: 'proposed' },
            { step: 2, description: 'Выбрать формат и стиль оформления', status: 'proposed' },
            { step: 3, description: 'Составить структуру и содержание', status: 'proposed' },
            { step: 4, description: 'Реализовать презентацию', status: 'proposed' },
        ], 'сделай презентацию');
        assert.equal(steps.length, 4);
        assert.match(steps[1].description, /артефакт/i);
        assert.doesNotMatch(steps.map(s => s.description).join('\n'), /presentation\.html/i);
        assert.equal(planLooksLikeArtifactWork(steps), true);
    });

    it('uses abstract fallback for non-artifact deliverable', () => {
        const steps = ensureMinimumPlanSteps([
            { step: 1, description: 'Определить требования', status: 'proposed' },
            { step: 2, description: 'Выбрать подход', status: 'proposed' },
            { step: 3, description: 'Согласовать с заказчиком', status: 'proposed' },
        ], 'сделай отчёт');
        assert.equal(steps.length, 4);
        assert.match(steps[1].description, /артефакт/i);
        assert.match(steps[3].description, /принять/i);
    });

    it('keeps plan that already looks like artifact work', () => {
        const input = [
            { step: 1, description: 'Уточнить тему', status: 'proposed' },
            { step: 2, description: 'Создать note.md каркас', status: 'proposed' },
            { step: 3, description: 'Наполнить note.md', status: 'proposed' },
            { step: 4, description: 'Проверить и принять', status: 'proposed' },
        ];
        const steps = ensureMinimumPlanSteps(input, 'сделай файл');
        assert.deepEqual(steps.map(s => s.description), input.map(s => s.description));
    });
});

describe('summarizeToolResultForRibbon get_schema', () => {
    it('compacts schema without params tree', () => {
        const fat = {
            className: '$user',
            properties: Array.from({ length: 5 }, (_, i) => ({ name: 'p' + i, type: 'String' })),
            methods: [
                { name: 'save_file', description: 'long '.repeat(200), params: { filename: { type: 'string' } } },
                { name: 'get_schema', description: 'x', params: {} },
            ],
            json_model: { id: 'U1', name: 'A', type: '$user', path: '/U1', extra: 'drop' },
        };
        const out = summarizeToolResultForRibbon('get_schema', fat);
        assert.ok(out.length < 4000);
        assert.match(out, /_truncated/);
        assert.match(out, /save_file/);
        assert.doesNotMatch(out, /"params"/);
        const ribbon = [];
        pushToolResult(ribbon, { method: 'get_schema', args: {} }, fat, { path: 'WORK' });
        assert.equal(ribbon[0].content, out);
        assert.ok(compactToolResultContentForHistory({
            tool: 'get_schema',
            content: JSON.stringify(fat).repeat(3),
        }).length <= 4000 + 10);
    });
});

describe('allContentWorkDone', () => {
    it('true when only accept-only steps remain open', () => {
        assert.equal(allContentWorkDone({
            steps: [
                { status: 'done', description: 'Слайд 1' },
                { status: 'done', description: 'Слайд 2' },
                { status: 'in_progress', description: 'Проверить и принять' },
            ],
        }), true);
    });
});

describe('finalizeAcceptOnlySteps', () => {
    it('closes remaining check/accept steps', () => {
        const task = {
            steps: [
                { step: 1, description: 'Сделать', status: 'done' },
                { step: 2, description: 'Проверить и принять файл', status: 'in_progress' },
            ],
        };
        assert.equal(stepIsAcceptOnly(task.steps[1]), true);
        assert.equal(finalizeAcceptOnlySteps(task), true);
        assert.equal(task.steps.every(s => s.status === 'done'), true);
    });
});

describe('parseResponseToRibbon subplan', () => {
    it('extracts pendingSubplan', () => {
        const out = parseResponseToRibbon(
            '<reasoning>нужна декомпозиция</reasoning>\n<subplan>[{"description":"A"},{"description":"B"}]</subplan>',
            'WORK',
        );
        assert.ok(out.pendingSubplan);
        assert.equal(out.pendingSubplan.length, 2);
        assert.equal(out.blocks.some(b => b.type === 'thinking'), true);
    });
});

describe('drop plan prose duplicates', () => {
    it('dropTextBlocksBesidePlanAction removes text next to План/Начать', () => {
        const blocks = [
            { type: 'thinking', content: 'думаю' },
            { type: 'text', content: '1. Определить тему\n2. Сделать' },
            {
                type: 'action',
                title: 'План',
                content: '1. Уточнить\n2. Создать',
                button: { label: 'Начать', color: 'success' },
            },
        ];
        const out = dropTextBlocksBesidePlanAction(blocks, { steps: [] });
        assert.equal(out.some(b => b.type === 'text'), false);
        assert.equal(out.filter(b => b.type === 'action').length, 1);
        assert.equal(out.some(b => b.type === 'thinking'), true);
    });

    it('synth path shape: thinking + plan action, no text', () => {
        const { pendingPlan, actionBlock } = synthesizePlanAfterIdle('сделай презентацию', 'WORK');
        const modelBlocks = [
            { type: 'thinking', content: 'нужен план' },
            { type: 'text', content: '1. Определить тему\n2. Выбрать формат' },
        ];
        const keep = modelBlocks.filter(b => b.type === 'thinking');
        let blocks = normalizeInteractiveBlocks([...keep, actionBlock], { phase: 'plan' });
        blocks = dropTextBlocksBesidePlanAction(blocks, pendingPlan);
        assert.equal(blocks.some(b => b.type === 'text'), false);
        assert.equal(blocks.filter(b => b.type === 'action').length, 1);
        assert.equal(blocks.find(b => b.type === 'action')?.button?.label, 'Начать');
    });

    it('stripRawActionJsonFromProse removes leaked action objects', () => {
        const raw = 'Шаги:\n{"title":"Уточнение","label":"Уточнить","color":"success"}\n'
            + '{"title":"План","label":"Начать","color":"success"}\nдальше текст';
        const out = stripRawActionJsonFromProse(raw);
        assert.doesNotMatch(out, /"title"\s*:/);
        assert.doesNotMatch(out, /Уточнение/);
        assert.match(out, /Шаги/);
        assert.match(out, /дальше текст/);
    });

    it('parseResponseToRibbon with plan does not keep raw action JSON as text', () => {
        const out = parseResponseToRibbon(
            '<reasoning>ок</reasoning>\n'
            + '1. Определить тему\n'
            + '{"title":"Уточнение","label":"Уточнить","color":"success"}\n'
            + '<plan>[{"step":1,"description":"Уточнить тему","status":"proposed"},'
            + '{"step":2,"description":"Создать presentation.html","status":"proposed"},'
            + '{"step":3,"description":"Наполнить","status":"proposed"},'
            + '{"step":4,"description":"Проверить","status":"proposed"}]</plan>\n'
            + '<action>{"title":"План","label":"Начать","color":"success"}</action>',
            'WORK',
        );
        assert.ok(out.pendingPlan);
        assert.equal(out.blocks.some(b => b.type === 'text'), false);
        const action = out.blocks.find(b => b.type === 'action');
        assert.ok(action);
        assert.equal(action.button.label, 'Начать');
        assert.doesNotMatch(action.content || '', /"title"\s*:/);
        let cleaned = dropTextBlocksBesidePlanAction(out.blocks, out.pendingPlan);
        assert.equal(cleaned.some(b => b.type === 'text'), false);
    });
});

describe('pushStepPrompt', () => {
    it('pushes Выполни шаг N into task.ribbon', () => {
        const task = {
            type: 'task',
            state: 'active',
            steps: [
                { step: 1, description: 'Уточнить тему', status: 'in_progress' },
                { step: 2, description: 'Создать файл', status: 'proposed' },
            ],
            ribbon: [],
        };
        assert.equal(pushStepPrompt(task, 'WORK'), true);
        assert.equal(task.ribbon.length, 1);
        assert.equal(task.ribbon[0].type, 'prompt');
        assert.equal(task.ribbon[0].content, formatStepPromptContent(task.steps[0]));
        assert.equal(pushStepPrompt(task, 'WORK'), false);
    });
});

describe('Do questions parse / no text', () => {
    it('unclosed <questions> becomes questions block, not text', () => {
        const out = parseResponseToRibbon(
            '<reasoning>нужны детали</reasoning>\n'
            + '<questions>[\n'
            + '{"id":"topic","prompt":"Какова тема?","options":[]},\n'
            + '{"id":"slides_count","prompt":"Сколько слайдов?","options":[]},\n'
            + '{"id":"style","prompt":"Стиль?","options":["Минималистичный","Современный","Классический"]}\n'
            + ']',
            'WORK',
        );
        assert.equal(out.blocks.some(b => b.type === 'thinking'), true);
        assert.equal(out.blocks.some(b => b.type === 'text'), false);
        const q = out.blocks.find(b => b.type === 'questions');
        assert.ok(q);
        assert.ok(q.fields.length >= 3);
        assert.ok(q.fields.every(f => f.type === 'select' && f.options?.length >= 2));
        assert.ok(q.fields.some(f => f.id === 'topic'));
        assert.ok(q.fields.some(f => f.id === 'slides_count'));
    });

    it('mapAskQuestionToField fills empty options', () => {
        const f = mapAskQuestionToField({ id: 'topic', prompt: 'Тема?', options: [] });
        assert.equal(f.type, 'select');
        assert.ok(f.options.length >= 2);
        assert.deepEqual(
            defaultOptionsForAskField('slides_count', 'Сколько слайдов?'),
            ['5', '8', '12', '15'],
        );
    });

    it('dropTextBlocksBesideDoInteractive keeps thinking, drops text', () => {
        const blocks = [
            { type: 'thinking', content: 'думаю' },
            { type: 'text', content: '<questions>[...]' },
            {
                type: 'questions',
                fields: [{ id: 'topic', label: 'Тема?', type: 'select', options: ['A', 'B'] }],
                button: { label: 'Уточнить' },
            },
        ];
        const out = dropTextBlocksBesideDoInteractive(blocks, {});
        assert.equal(out.some(b => b.type === 'text'), false);
        assert.equal(out.some(b => b.type === 'thinking'), true);
        assert.equal(out.filter(b => b.type === 'questions').length, 1);
    });
});
