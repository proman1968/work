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
    mayCommitDeferredOnIdleExecuteStop,
    taskHasSuccessfulSave,
    makeIdleExecuteResumeAction,
    appendDoForceNudge,
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
    ensureFillSubplan,
    allContentWorkDone,
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

describe('appendDoForceNudge', () => {
    it('appends user STOP message with step label', () => {
        const messages = [{ role: 'system', content: 'sys' }];
        appendDoForceNudge(messages, { description: 'Создать отчёт' });
        assert.equal(messages.length, 2);
        assert.equal(messages[1].role, 'user');
        assert.match(messages[1].content, /Создать отчёт/);
        assert.match(messages[1].content, /tool call/);
        assert.match(messages[1].content, /save_file/);
    });

    it('forbids text tool_call / function calling in nudge', () => {
        const messages = [];
        appendDoForceNudge(messages, { description: 'Создать файл presentation.html (первая версия)' });
        assert.equal(messages[0].content.includes('<tool_call>{'), false);
        assert.match(messages[0].content, /native tool save_file/);
        assert.match(messages[0].content, /presentation\.html/);
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
    it('appends user nudge on execute forceDoReminder', () => {
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
        assert.match(last.content, /СТОП/);
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

describe('mayCommitDeferredOnIdleExecuteStop regression', () => {
    it('still never commits deferred plan without tools', () => {
        assert.equal(mayCommitDeferredOnIdleExecuteStop(), false);
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
    it('pushes Выполняю шаг N text once', () => {
        const ribbon = [];
        const a = pushStepAnnounce(ribbon, { step: 2, description: 'Создать файл' }, 'WORK');
        assert.equal(a.type, 'text');
        assert.match(a.content, /Выполняю шаг 2/);
        assert.match(a.content, /Создать файл/);
        assert.equal(a.stepAnnounce, true);
        pushStepAnnounce(ribbon, { step: 2, description: 'Создать файл' }, 'WORK');
        assert.equal(ribbon.length, 1);
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
    it('expands fill step into N slide substeps from answers', () => {
        const task = {
            steps: [
                { step: 1, description: 'Уточнить', status: 'done' },
                { step: 2, description: 'Заполнить слайды информацией', status: 'in_progress' },
                { step: 3, description: 'Проверить и принять', status: 'proposed' },
            ],
            ribbon: [{ type: 'prompt', answers: { topic: 'WORK', slides: '5' } }],
        };
        const r = ensureFillSubplan(task, task.steps[1]);
        assert.equal(r.expanded, true);
        assert.equal(task.steps.filter(s => /^Слайд /.test(s.description)).length, 5);
        assert.equal(task.steps.find(s => s.status === 'in_progress').description, 'Слайд 1');
    });

    it('blocks fill save when no count and no subplan', () => {
        const task = {
            steps: [
                { step: 1, description: 'Заполнить контент деталями', status: 'in_progress' },
            ],
            ribbon: [],
        };
        const r = ensureFillSubplan(task, task.steps[0]);
        assert.equal(r.blocked, true);
    });
});

describe('advanceAfterSuccessfulSave stub/fill', () => {
    it('does not advance fill parent without slide substeps', () => {
        const task = {
            steps: [
                { step: 1, description: 'Заполнить слайды информацией', status: 'in_progress' },
                { step: 2, description: 'Принять', status: 'proposed' },
            ],
        };
        assert.equal(advanceAfterSuccessfulSave(task, task.steps[0], { post: '<html>' + 'x'.repeat(500) + '</html>' }), false);
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
