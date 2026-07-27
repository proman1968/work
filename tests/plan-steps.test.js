import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    extractBalancedJsonArray,
    formatPlanMarkdown,
    parseResponseToRibbon,
    planToAction,
    completeTaskStep,
    applySubplan,
    autoAdvanceClarifyStep,
    findAnsweredDuplicate,
    duplicateAskTeach,
    demoteStrayDoActions,
    normalizeChannelTags,
    driverDirective,
    questionsFieldsWithoutOptions,
    hasRecentAskOptionsTeach,
    applyConfirm,
    findActiveTask,
    ribbonTargetOf,
    resolveServicePrompt,
    ROLE_OVERLAYS,
    stepNeedsClarify,
    stepEvidence,
    collectArtifacts,
    makeStepPrompt,
    planFromProposeArgs,
    subplanFromArgs,
    parseNumberedListSteps,
    planQualityError,
    mapAskQuestionToField,
    isAskQuestionField,
    questionsFromAskUser,
    buildHistoryFromRibbon,
} from '../$server/$folder/$file/$ai/class.js';

/** Болванка body с активной задачей из N шагов (шаг 1 in_progress). */
function makeTaskBody(n = 3) {
    const steps = Array.from({ length: n }, (_, i) => ({
        step: i + 1,
        description: 'Шаг ' + (i + 1),
        status: i === 0 ? 'in_progress' : 'proposed',
    }));
    const task = {
        type: 'task',
        label: 'Тестовая задача',
        state: 'active',
        steps,
        ribbon: [{ type: 'prompt', content: 'Выполни шаг 1: «Шаг 1»', sender: 'WORK', step: 1 }],
    };
    return { ribbon: [{ type: 'prompt', content: 'сделай X', sender: 'U' }, task], task };
}

/** Доказательство работы шага: успешный tool_result в ленте активной задачи. */
function pushEvidence(body, tool = 'save_file') {
    ribbonTargetOf(body).push({ type: 'tool_result', tool, ok: true, content: '{}' });
}

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

describe('formatPlanMarkdown', () => {
    it('numbered list from steps, short CTA appended', () => {
        const md = formatPlanMarkdown(
            [
                { step: 1, description: 'A', status: 'proposed' },
                { step: 2, description: 'B', status: 'proposed' },
            ],
            'Длинный парафраз плана. Начнём?',
        );
        assert.match(md, /1\.\s*A/);
        assert.match(md, /2\.\s*B/);
        assert.match(md, /Начнём\?/);
        assert.doesNotMatch(md, /парафраз/);
    });

    it('prose only when no steps', () => {
        assert.equal(formatPlanMarkdown([], 'Просто текст.'), 'Просто текст.');
    });
});

describe('planToAction', () => {
    it('plan → action «План» with proposed steps and tip «Начать»', () => {
        const action = planToAction({
            steps: [
                { step: 1, description: 'A', status: 'in_progress' },
                { description: 'B' },
            ],
        }, 'MODEL');
        assert.equal(action.type, 'action');
        assert.equal(action.title, 'План');
        assert.equal(action.button.label, 'Начать');
        assert.deepEqual(action.steps.map(s => s.status), ['proposed', 'proposed']);
        assert.deepEqual(action.steps.map(s => s.step), [1, 2]);
        assert.equal(action.sender, 'MODEL');
    });
});

describe('движок шагов: completeTaskStep', () => {
    it('закрывает текущий шаг (с доказательством) и выдаёт step-prompt следующего', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(3));
        pushEvidence(body);
        const { result, followPrompt } = completeTaskStep(body, { summary: 'готово' });
        assert.equal(result.success, true);
        assert.equal(task.steps[0].status, 'done');
        assert.equal(task.steps[0].summary, 'готово');
        assert.equal(task.steps[1].status, 'in_progress');
        assert.match(followPrompt.content, /Выполни шаг 2/);
        assert.equal(followPrompt.step, 2);
    });

    it('последний шаг → prompt «сформируй Отчёт» с итогами шагов', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(1));
        pushEvidence(body);
        const { result, followPrompt } = completeTaskStep(body, { step: 1, summary: 'итог 1' });
        assert.equal(result.success, true);
        assert.ok(task.steps.every(s => s.status === 'done'));
        assert.match(followPrompt.content, /Все шаги выполнены/);
        assert.match(followPrompt.content, /итог 1/);
        assert.match(followPrompt.content, /"title":"Отчёт"/);
    });

    it('без активной задачи — ошибка', () => {
        const { result, followPrompt } = completeTaskStep({ ribbon: [] }, {});
        assert.ok(result.error);
        assert.equal(followPrompt, undefined);
    });
});

describe('движок шагов: ворота на complete_step (анти-галлюцинации)', () => {
    it('do-шаг без tool_result не закрывается — обучающая ошибка про save_file', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(2));
        const { result, followPrompt } = completeTaskStep(body, { summary: 'сделал (на словах)' });
        assert.ok(result.error, 'закрытие отклонено');
        assert.match(result.error, /save_file/);
        assert.equal(task.steps[0].status, 'in_progress', 'шаг остался открытым');
        assert.equal(followPrompt, undefined);
    });

    it('ошибочный tool_result (ok=false) — не доказательство', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(1));
        ribbonTargetOf(body).push({ type: 'tool_result', tool: 'save_file', ok: false, content: '{"error":"x"}' });
        const { result } = completeTaskStep(body, {});
        assert.ok(result.error);
        assert.equal(task.steps[0].status, 'in_progress');
    });

    it('сам complete_step в span — не доказательство', () => {
        const { body } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(1));
        ribbonTargetOf(body).push({ type: 'tool_result', tool: 'complete_step', ok: false, content: '{"error":"нет работы"}' });
        const { result } = completeTaskStep(body, {});
        assert.ok(result.error);
    });

    it('clarify-шаг без answered-опроса не закрывается — ошибка про ask_user', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(1));
        task.steps[0].description = 'Определить тему и цели презентации';
        pushEvidence(body); // даже с tool_result — clarify требует ответов пользователя
        const { result } = completeTaskStep(body, {});
        assert.ok(result.error);
        assert.match(result.error, /ask_user/);
        assert.equal(task.steps[0].status, 'in_progress');
    });

    it('clarify-шаг с answered questions закрывается', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(1));
        task.steps[0].description = 'Уточнить тему презентации';
        ribbonTargetOf(body).push({
            type: 'questions',
            fields: [{ id: 'topic', value: 'WORK' }],
            answered: true,
        });
        const { result } = completeTaskStep(body, {});
        assert.equal(result.success, true);
        assert.equal(task.steps[0].status, 'done');
    });

    it('stepEvidence считает только span текущего шага', () => {
        const task = {
            steps: [{ step: 2, description: 'Шаг 2', status: 'in_progress' }],
            ribbon: [
                { type: 'tool_result', tool: 'save_file', ok: true },   // артефакт шага 1
                { type: 'prompt', sender: 'WORK', step: 2, content: 'Выполни шаг 2' },
                { type: 'text', content: 'проза' },
            ],
        };
        const ev = stepEvidence(task, task.steps[0]);
        assert.equal(ev.toolOk, false, 'доказательство шага 1 не засчитано шагу 2');
        assert.equal(ev.answered, false);
    });
});

describe('clarify-эвристика и step-prompt', () => {
    it('словоформы: «Определить тему и цели» — clarify; «Создать структуру» — нет', () => {
        assert.equal(stepNeedsClarify({ description: 'Определить тему и цели презентации' }), true);
        assert.equal(stepNeedsClarify({ description: 'Выяснить, зачем нужна презентация' }), true);
        assert.equal(stepNeedsClarify({ description: 'Уточнить параметры отчёта' }), true);
        assert.equal(stepNeedsClarify({ description: 'Создать структуру презентации' }), false);
        assert.equal(stepNeedsClarify({ description: 'Определить структуру системы' }), false);
        assert.equal(stepNeedsClarify({ description: 'Оформить слайды согласно стилю' }), false);
    });

    it('makeStepPrompt добавляет подсказку ask_user только clarify-шагу', () => {
        const clarify = makeStepPrompt({ step: 1, description: 'Определить тему и цели презентации' });
        assert.match(clarify.content, /ask_user/);
        const doStep = makeStepPrompt({ step: 2, description: 'Создать структуру презентации' });
        assert.doesNotMatch(doStep.content, /ask_user/);
    });
});

describe('честный Отчёт: collectArtifacts', () => {
    it('собирает file-блоки по всем лентам без дублей', () => {
        const body = {
            ribbon: [
                { type: 'file', path: '/A/history/1.html' },
                {
                    type: 'task', state: 'completed',
                    ribbon: [
                        { type: 'file', path: '/A/history/2.html' },
                        { type: 'file', path: '/A/history/1.html' },
                    ],
                },
            ],
        };
        assert.deepEqual(collectArtifacts(body), ['/A/history/1.html', '/A/history/2.html']);
    });

    it('финальный prompt содержит реальные пути; без файлов — «не выдумывай»', () => {
        const withFile = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(1));
        ribbonTargetOf(withFile.body).push({ type: 'file', path: '/U/history/итог.html' });
        pushEvidence(withFile.body);
        const { followPrompt } = completeTaskStep(withFile.body, {});
        assert.match(followPrompt.content, /итог\.html/);
        assert.match(followPrompt.content, /реальные пути/);

        const noFile = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(1));
        pushEvidence(noFile.body, 'read_file');
        const { followPrompt: fp2 } = completeTaskStep(noFile.body, {});
        assert.match(fp2.content, /Артефактов не создано/);
    });
});

describe('движок шагов: applySubplan (стек задач)', () => {
    it('subplan создаёт подзадачу с step-prompt, закрытие подшагов закрывает шаг родителя', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(2));
        const sub = applySubplan(body, [
            { description: 'Под-A' },
            { description: 'Под-B' },
        ]);
        assert.ok(sub);
        assert.equal(sub.subplan, true);
        assert.equal(sub.parentStep, 1);
        // Активная лента — подзадача, драйвер — её шаг 1
        assert.equal(findActiveTask(body), sub);
        assert.match(ribbonTargetOf(body)[0].content, /Под-A/);

        // Закрываем оба подшага (с доказательствами) → подзадача completed,
        // шаг 1 родителя done, driver — шаг 2 родителя
        pushEvidence(body);
        completeTaskStep(body, {});
        pushEvidence(body);
        const { followPrompt } = completeTaskStep(body, {});
        assert.equal(sub.state, 'completed');
        assert.equal(task.steps[0].status, 'done');
        assert.equal(task.steps[1].status, 'in_progress');
        assert.match(followPrompt.content, /Выполни шаг 2/);
        assert.equal(findActiveTask(body), task);
    });

    it('пустой subplan игнорируется', () => {
        const { body } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(1));
        assert.equal(applySubplan(body, [{}, { description: '' }]), null);
    });
});

describe('движок шагов: «Принять» у Отчёта завершает задачу', () => {
    it('applyConfirm(true) по action «Отчёт» → state completed, все шаги done, финальный text', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(2));
        task.steps[0].status = 'done';
        task.ribbon.push({
            type: 'action',
            title: 'Отчёт',
            content: 'Готово',
            button: { label: 'Принять', color: 'success' },
        });
        const applied = applyConfirm(body, true, 'U1');
        assert.equal(applied.taskCompleted, true);
        assert.equal(task.state, 'completed');
        assert.ok(task.steps.every(s => s.status === 'done'));
        const last = body.ribbon[body.ribbon.length - 1];
        assert.equal(last.type, 'text');
        assert.match(last.content, /завершена/);
        // Активных задач больше нет — лента вернулась в корень
        assert.equal(findActiveTask(body), null);
    });
});

describe('парсер: атрибутная форма <action>', () => {
    it('<action title label color>текст</action> → action-блок, без сырого XML', () => {
        const { blocks } = parseResponseToRibbon(
            '<reasoning>Думаю.</reasoning>\n'
            + '<action title="Начать" label="Начать работу" color="success"> Начните работу над презентацией. </action>',
            'MODEL',
        );
        const act = blocks.find(b => b.type === 'action');
        assert.ok(act, 'action-блок создан');
        assert.equal(act.button.label, 'Начать работу');
        assert.match(act.content, /Начните работу/);
        for (const b of blocks)
            assert.doesNotMatch(String(b.content || ''), /<action/);
    });

    it('самозакрытый <action …/> тоже разбирается', () => {
        const { blocks } = parseResponseToRibbon(
            'Готов продолжить. <action title="Действие" label="Выполнить" color="warning"/>',
            'MODEL',
        );
        const act = blocks.find(b => b.type === 'action');
        assert.ok(act);
        assert.equal(act.button.label, 'Выполнить');
        assert.equal(act.button.color, 'warning');
    });

    it('нераспознанные теги каналов вычищаются из text', () => {
        const { blocks } = parseResponseToRibbon(
            'Вот план: <plan >кривой контент без JSON</plan> и всё.',
            'MODEL',
        );
        const text = blocks.find(b => b.type === 'text');
        if (text)
            assert.doesNotMatch(text.content, /<\/?plan/);
    });
});

describe('ролевые оверлеи servicePrompt', () => {
    it('prompt + роль USER содержит артефакт-first, BOSS — делегирование, ADMIN — inspect/edit', () => {
        const entry = { type: 'prompt' };
        assert.match(resolveServicePrompt(entry, 'USER'), /save_file.*complete_step|артефакт/);
        assert.match(resolveServicePrompt(entry, 'BOSS'), /spawn_agent/);
        assert.match(resolveServicePrompt(entry, 'ADMIN'), /inspect_schema/);
    });

    it('без роли — только базовый протокол', () => {
        const base = resolveServicePrompt({ type: 'prompt' });
        for (const role of Object.keys(ROLE_OVERLAYS))
            assert.ok(!base.includes(ROLE_OVERLAYS[role].prompt));
    });

    it('оверлей только для типов из ROLE_OVERLAYS (у tool_result нет добавки)', () => {
        const withRole = resolveServicePrompt({ type: 'tool_result', tool: 't', ok: true }, 'USER');
        const without = resolveServicePrompt({ type: 'tool_result', tool: 't', ok: true });
        assert.equal(withRole, without);
    });
});

describe('FC-каналы: propose_plan / subplan', () => {
    it('propose_plan args → pendingPlan → action «План» с proposed-шагами', () => {
        const plan = planFromProposeArgs({
            steps: [{ description: 'Собрать данные' }, { description: 'Оформить отчёт' }],
            intro: 'Предлагаю план.',
        });
        assert.ok(plan);
        assert.equal(plan.steps.length, 2);
        assert.equal(plan.content, 'Предлагаю план.');
        const action = planToAction(plan, 'MODEL');
        assert.equal(action.title, 'План');
        assert.equal(action.button.label, 'Начать');
        assert.deepEqual(action.steps.map(s => s.step), [1, 2]);
        assert.ok(action.steps.every(s => s.status === 'proposed'));
    });

    it('шаги голыми строками тоже принимаются', () => {
        const plan = planFromProposeArgs({ steps: ['A', ' B '] });
        assert.deepEqual(plan.steps.map(s => s.description), ['A', 'B']);
        const sub = subplanFromArgs({ steps: ['Под-A', { description: 'Под-B' }] });
        assert.deepEqual(sub.map(s => s.description), ['Под-A', 'Под-B']);
    });

    it('пустые args → null (fallback на XML-разбор не ломается)', () => {
        assert.equal(planFromProposeArgs({}), null);
        assert.equal(planFromProposeArgs({ steps: [{ description: '' }] }), null);
        assert.equal(subplanFromArgs({ steps: [] }), null);
    });

    it('subplanFromArgs → applySubplan создаёт подзадачу', () => {
        const { body } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(2));
        const steps = subplanFromArgs({ steps: ['Под-A', 'Под-B'] });
        const sub = applySubplan(body, steps);
        assert.ok(sub);
        assert.equal(sub.steps.length, 2);
        assert.equal(sub.steps[0].description, 'Под-A');
    });
});

describe('reasoning не глотает каналы', () => {
    it('закрытый <reasoning> с <plan> внутри: thinking обрезан, план зарегистрирован', () => {
        const { blocks, pendingPlan } = parseResponseToRibbon(
            '<reasoning>Думаю о плане. <plan>[{"step":1,"description":"A"},{"step":2,"description":"B"}]</plan></reasoning>',
            'MODEL',
        );
        const th = blocks.find(b => b.type === 'thinking');
        assert.equal(th.content, 'Думаю о плане.');
        assert.doesNotMatch(th.content, /<plan/);
        assert.ok(pendingPlan, 'план не проглочен');
        assert.equal(pendingPlan.steps.length, 2);
    });

    it('незакрытый <reasoning> с <questions> внутри: thinking обрезан, опрос разобран', () => {
        const { blocks } = parseResponseToRibbon(
            '<reasoning>Нужно уточнить.\n<questions>[{"id":"topic","label":"Тема","options":["A","B"]}]</questions>',
            'MODEL',
        );
        const th = blocks.find(b => b.type === 'thinking');
        assert.equal(th.content, 'Нужно уточнить.');
        const q = blocks.find(b => b.type === 'questions');
        assert.ok(q, 'опрос не проглочен');
        assert.equal(q.fields[0].id, 'topic');
    });

    it('reasoning без каналов внутри — как раньше, целиком в thinking', () => {
        const { blocks } = parseResponseToRibbon(
            '<reasoning>Просто мысль.</reasoning>Ответ.',
            'MODEL',
        );
        assert.equal(blocks.find(b => b.type === 'thinking').content, 'Просто мысль.');
        assert.equal(blocks.find(b => b.type === 'text').content, 'Ответ.');
    });
});

describe('толерантный <plan>: нумерованный список', () => {
    it('parseNumberedListSteps: «1. …» и «2) Шаг: …» → шаги', () => {
        const steps = parseNumberedListSteps(
            '1. Собрать данные\n2) Шаг: Оформить **отчёт**\nпроза без номера\n3. Показать итог',
        );
        assert.deepEqual(steps.map(s => s.description),
            ['Собрать данные', 'Оформить отчёт', 'Показать итог']);
        assert.ok(steps.every((s, i) => s.step === i + 1 && s.status === 'proposed'));
    });

    it('<plan> с markdown-списком вместо JSON → pendingPlan', () => {
        const { pendingPlan } = parseResponseToRibbon(
            '<plan>\n1. Определить тему\n2. Составить структуру\n3. Сохранить артефакт\n</plan>',
            'MODEL',
        );
        assert.ok(pendingPlan, 'план извлечён из списка');
        assert.equal(pendingPlan.steps.length, 3);
        assert.equal(pendingPlan.steps[1].description, 'Составить структуру');
    });

    it('<plan> без JSON и без списка — вырезается, planRejected для обучающего отказа', () => {
        const { pendingPlan, planRejected, blocks } = parseResponseToRibbon(
            'Вот: <plan>кривой контент</plan> и всё.',
            'MODEL',
        );
        assert.equal(pendingPlan, null);
        assert.equal(planRejected, true);
        const text = blocks.find(b => b.type === 'text');
        if (text)
            assert.doesNotMatch(text.content, /<\/?plan/);
    });
});

describe('ворота качества плана (анти-«1. Шаг»)', () => {
    it('обёртка <plan>{"steps":[…]}</plan> разворачивается в шаги', () => {
        const { pendingPlan, planRejected } = parseResponseToRibbon(
            '<plan>{"steps":[{"description":"Собрать данные"},{"description":"Оформить отчёт"}]}</plan>',
            'MODEL',
        );
        assert.equal(planRejected, false);
        assert.ok(pendingPlan);
        assert.deepEqual(pendingPlan.steps.map(s => s.description),
            ['Собрать данные', 'Оформить отчёт']);
        assert.deepEqual(pendingPlan.steps.map(s => s.step), [1, 2]);
    });

    it('объект без description — отказ, а не фабрикация шага «Шаг»', () => {
        const { pendingPlan, planRejected, blocks } = parseResponseToRibbon(
            '<plan>{"status":"proposed","priority":1}</plan>',
            'MODEL',
        );
        assert.equal(pendingPlan, null, 'план не сфабрикован');
        assert.equal(planRejected, true);
        assert.ok(!blocks.some(b => b.type === 'action'), 'кнопки «Начать» нет');
        for (const b of blocks)
            assert.doesNotMatch(String(b.content || ''), /^Шаг$/m);
    });

    it('битый JSON-объект внутри <plan> → planRejected', () => {
        const { pendingPlan, planRejected } = parseResponseToRibbon(
            '<plan>{"description": незакавыченный}</plan>',
            'MODEL',
        );
        assert.equal(pendingPlan, null);
        assert.equal(planRejected, true);
    });

    it('planQualityError: ≥2 осмысленных шагов — ок; огрызки — обучающий отказ', () => {
        assert.equal(planQualityError([
            { description: 'Собрать данные' },
            { description: 'Оформить отчёт' },
        ]), null);
        assert.match(planQualityError([{ description: 'Шаг' }]), /propose_plan/);
        assert.match(planQualityError([{ description: 'Один шаг' }]), /propose_plan/);
        assert.match(planQualityError([]), /propose_plan/);
        assert.match(planQualityError([
            { description: 'шаг 1' },
            { description: 'шаг 2' },
        ]), /propose_plan/, 'дефолтные «шаг N» не считаются осмысленными');
    });
});

describe('открытые поля ask_user/questions (без фабрикации вариантов)', () => {
    it('явный textarea без options остаётся открытым полем', () => {
        const f = mapAskQuestionToField({ id: 'details', prompt: 'Опишите задачу', type: 'textarea' });
        assert.equal(f.type, 'textarea');
        assert.ok(!f.options);
        assert.equal(isAskQuestionField(f), true, 'открытое поле пригодно для UI');
    });

    it('select/без type без options → открытое text-поле, варианты не выдумываются', () => {
        const sel = mapAskQuestionToField({ id: 'style', prompt: 'Стиль', type: 'select' });
        assert.equal(sel.type, 'text');
        assert.ok(!sel.options?.length);
        const noType = mapAskQuestionToField({ id: 'topic', prompt: 'Тема' });
        assert.equal(noType.type, 'text');
        assert.ok(!noType.options?.length);
    });

    it('options ≥2 от модели → select независимо от type', () => {
        const f = mapAskQuestionToField({ id: 't', prompt: 'Тема', type: 'textarea', options: ['A', 'B'] });
        assert.equal(f.type, 'select');
        assert.deepEqual(f.options, ['A', 'B']);
    });

    it('пустой ask_user → null (обучающий отказ, не сфабрикованный опрос)', () => {
        assert.equal(questionsFromAskUser({}), null);
        assert.equal(questionsFromAskUser({ questions: [] }), null);
        assert.equal(questionsFromAskUser({ questions: [{}] }), null);
    });

    it('ask_user с вопросами по-прежнему даёт questions-блок', () => {
        const q = questionsFromAskUser({
            questions: [
                { id: 'topic', prompt: 'Тема?', options: ['A', 'B'] },
                { id: 'details', prompt: 'Детали?', type: 'textarea' },
            ],
        });
        assert.equal(q.type, 'questions');
        assert.equal(q.fields.length, 2);
        assert.equal(q.fields[0].type, 'select');
        assert.equal(q.fields[1].type, 'textarea');
    });
});

describe('tap-first ворота: options обязательны, один ретрай', () => {
    it('questionsFieldsWithoutOptions: text-поля — кандидаты на отказ, select/textarea — нет', () => {
        const q = questionsFromAskUser({
            questions: [
                { id: 'topic', prompt: 'Тема?' },
                { id: 'style', prompt: 'Стиль?', options: ['A', 'B'] },
                { id: 'details', prompt: 'Детали?', type: 'textarea' },
            ],
        });
        assert.deepEqual(questionsFieldsWithoutOptions(q), ['Тема?']);
        assert.deepEqual(questionsFieldsWithoutOptions({ fields: [] }), []);
    });

    it('hasRecentAskOptionsTeach: отказ в текущем span → true, после входа пользователя → false', () => {
        const teach = {
            type: 'tool_result',
            tool: 'ask_user',
            ok: false,
            content: 'Опрос не показан: вопросы без вариантов… дай options…',
        };
        assert.equal(hasRecentAskOptionsTeach([teach]), true);
        assert.equal(hasRecentAskOptionsTeach([
            teach,
            { type: 'prompt', content: 'ответ', sender: 'U1' },
        ]), false, 'вход пользователя сбрасывает ретрай');
        assert.equal(hasRecentAskOptionsTeach([
            teach,
            { type: 'prompt', content: 'Выполни шаг 2', sender: 'WORK' },
        ]), true, 'step-prompt от WORK не сбрасывает');
        assert.equal(hasRecentAskOptionsTeach([
            { type: 'tool_result', tool: 'save_file', ok: false, content: 'options' },
        ]), false, 'чужой tool_result не считается');
        assert.equal(hasRecentAskOptionsTeach([]), false);
    });
});

describe('анти-цикл clarify: авто-закрытие шага и повторный опрос', () => {
    /** Задача, где шаг 1 — clarify, с отвеченным опросом в ленте. */
    function makeClarifyBody() {
        const { ribbon, task } = makeTaskBody(2);
        task.steps[0].description = 'Определить тему и цель презентации';
        task.ribbon[0].content = 'Выполни шаг 1: «Определить тему и цель презентации»';
        task.ribbon.push({
            type: 'questions',
            fields: [
                { id: 'thema', label: 'Какова тема Вашей презентации?', type: 'select', value: 'Технологии' },
                { id: 'goal', label: 'Какова цель Вашей презентации?', type: 'select', value: 'Представить продукт' },
            ],
            answered: true,
        });
        return { body: { ribbon }, task };
    }

    it('ответы на опрос clarify-шага закрывают шаг без complete_step от модели', () => {
        const { body, task } = makeClarifyBody();
        const followPrompt = autoAdvanceClarifyStep(body);
        assert.ok(followPrompt, 'шаг продвинут');
        assert.equal(task.steps[0].status, 'done');
        assert.match(task.steps[0].summary, /тема.*Технологии/i);
        assert.equal(task.steps[1].status, 'in_progress');
        assert.match(followPrompt.content, /Выполни шаг 2/);
        const last = task.ribbon[task.ribbon.length - 1];
        assert.equal(last, followPrompt, 'step-prompt следующего шага уже в ленте');
    });

    it('do-шаг не закрывается ответами — нужен tool', () => {
        const { body, task } = makeClarifyBody();
        task.steps[0].description = 'Создать структуру презентации';
        assert.equal(autoAdvanceClarifyStep(body), null);
        assert.equal(task.steps[0].status, 'in_progress');
    });

    it('без активной задачи — ничего не происходит', () => {
        assert.equal(autoAdvanceClarifyStep({ ribbon: [] }), null);
    });

    it('findAnsweredDuplicate находит повтор по label (регистр/пунктуация не мешают)', () => {
        const ribbon = [{
            type: 'questions',
            answered: true,
            fields: [
                { id: 'thema', label: 'Какова тема Вашей презентации?', value: 'Технологии' },
                { id: 'goal', label: 'Какова цель Вашей презентации?', value: 'Продукт' },
            ],
        }];
        const dup = findAnsweredDuplicate(ribbon, {
            type: 'questions',
            fields: [
                { id: 'x1', label: 'какова цель вашей презентации' },
                { id: 'x2', label: 'Какова тема Вашей презентации?' },
            ],
        });
        assert.ok(dup, 'повтор распознан несмотря на другие id и порядок');
        assert.equal(dup.fields[0].value, 'Технологии');
    });

    it('другие вопросы — не повтор', () => {
        const ribbon = [{
            type: 'questions',
            answered: true,
            fields: [{ id: 'thema', label: 'Тема?', value: 'X' }],
        }];
        assert.equal(findAnsweredDuplicate(ribbon, {
            fields: [{ id: 'slides', label: 'Сколько слайдов?' }],
        }), null);
        assert.equal(findAnsweredDuplicate(ribbon, { fields: [] }), null);
    });

    it('неотвеченный опрос — не повтор (модель может переспросить открытый)', () => {
        const ribbon = [{
            type: 'questions',
            answered: false,
            fields: [{ id: 'thema', label: 'Тема?' }],
        }];
        assert.equal(findAnsweredDuplicate(ribbon, {
            fields: [{ id: 'thema', label: 'Тема?' }],
        }), null);
    });

    it('complete_step уже закрытого шага — явный отказ, без remap на in_progress', () => {
        const { body, task } = makeClarifyBody();
        autoAdvanceClarifyStep(body);
        assert.equal(task.steps[0].status, 'done');
        assert.equal(task.steps[1].status, 'in_progress');
        const { result, followPrompt } = completeTaskStep(body, {
            step: 1,
            summary: 'Тема: Технологии',
        });
        assert.ok(result?.error, 'ожидается ошибка');
        assert.match(result.error, /Шаг 1 уже закрыт/);
        assert.match(result.error, /Текущий шаг — 2/);
        assert.match(result.error, /complete_step\(\{step: 2/);
        assert.equal(followPrompt, undefined);
        assert.equal(task.steps[1].status, 'in_progress', 'шаг 2 не тронут');
        assert.doesNotMatch(result.error, /нет результата работы/i);
    });

    it('duplicateAskTeach после advance указывает на открытый шаг, не на complete_step(1)', () => {
        const { body, task } = makeClarifyBody();
        autoAdvanceClarifyStep(body);
        const dup = findAnsweredDuplicate(task.ribbon, {
            fields: [
                { id: 'x', label: 'Какова тема Вашей презентации?' },
                { id: 'y', label: 'Какова цель Вашей презентации?' },
            ],
        });
        assert.ok(dup);
        const teach = duplicateAskTeach(body, dup);
        assert.match(teach, /уже отвечены/);
        assert.match(teach, /Текущий шаг — 2/);
        assert.match(teach, /save_file/);
        assert.match(teach, /Не вызывай complete_step для уже закрытого/);
        assert.doesNotMatch(teach, /если шаг закрыт,\s*вызови complete_step/);
    });

    it('duplicateAskTeach без открытого шага — только факты, без complete_step', () => {
        const { body, task } = makeClarifyBody();
        task.steps.forEach(s => { s.status = 'done'; });
        const teach = duplicateAskTeach(body, {
            fields: [{ id: 'thema', label: 'Тема?', value: 'X' }],
        });
        assert.match(teach, /Тема\?: X/);
        assert.doesNotMatch(teach, /Текущий шаг/);
        assert.doesNotMatch(teach, /complete_step/);
    });
});

describe('кириллические теги каналов и мусор <tool>', () => {
    it('<план>{intro, steps}</план> → pendingPlan, сырой тег не в text', () => {
        const { pendingPlan, blocks } = parseResponseToRibbon(
            '<план>{"intro":"Соберём информацию.","steps":['
            + '{"description":"Определить характеристики"},'
            + '{"description":"Найти аналоги"},'
            + '{"description":"Собрать спецификации"}]}</план>',
        );
        assert.ok(pendingPlan, 'план распознан');
        assert.equal(pendingPlan.steps.length, 3);
        for (const b of blocks)
            assert.doesNotMatch(String(b.content || ''), /<\/?план/i);
    });

    it('normalizeChannelTags: подплан/вопросы → латиница, регистр не мешает', () => {
        assert.equal(normalizeChannelTags('<Подплан>[…]</Подплан>'), '<subplan>[…]</subplan>');
        assert.equal(normalizeChannelTags('<вопросы>[]</вопросы>'), '<questions>[]</questions>');
        assert.equal(normalizeChannelTags('без тегов'), 'без тегов');
    });

    it('<tool>propose_plan</tool> вычищается из prose', () => {
        const { blocks } = parseResponseToRibbon(
            '<tool>propose_plan</tool>\n\nНачнём собирать данные.',
        );
        const text = blocks.find(b => b.type === 'text');
        assert.ok(text);
        assert.doesNotMatch(text.content, /<tool>/);
        assert.match(text.content, /Начнём собирать данные/);
    });
});

describe('план при активной задаче и шальные action в Do', () => {
    it('план модели при активной задаче применяется как subplan текущего шага', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(3));
        const { pendingPlan } = parseResponseToRibbon(
            '<план>{"steps":[{"description":"Характеристики"},{"description":"Аналоги"}]}</план>',
        );
        assert.ok(pendingPlan);
        // маршрутизация promptTurn: план при in_progress шаге → subplan
        const sub = applySubplan(body, pendingPlan.steps);
        assert.ok(sub, 'subplan применён');
        assert.equal(sub.subplan, true);
        assert.equal(findActiveTask(body), sub, 'подзадача стала активной лентой');
        assert.equal(sub.steps.length, 2);
        assert.equal(sub.steps[0].status, 'in_progress');
        assert.equal(task.steps[0].status, 'in_progress', 'родительский шаг ждёт закрытия подзадачей');
    });

    it('demoteStrayDoActions: произвольный action при активной задаче → text', () => {
        const { body } = (({ ribbon }) => ({ body: { ribbon } }))(makeTaskBody(2));
        const out = demoteStrayDoActions(body, [
            {
                type: 'action',
                title: 'Сбор данных и информации',
                content: 'Подтвердите продолжение.',
                button: { label: 'Начать', color: 'info' },
                sender: 'M',
            },
            { type: 'action', title: 'Отчёт', content: 'Готово', button: { label: 'Принять' } },
            { type: 'text', content: 'просто текст' },
        ]);
        assert.equal(out[0].type, 'text');
        assert.match(out[0].content, /Сбор данных и информации: Подтвердите продолжение\./);
        assert.equal(out[0].button, undefined);
        assert.equal(out[1].type, 'action', 'Отчёт не понижается');
        assert.equal(out[2].type, 'text');
    });

    it('без активной задачи action не трогаем', () => {
        const body = { ribbon: [] };
        const blocks = [{ type: 'action', title: 'Произвольный', button: { label: 'OK' } }];
        assert.deepEqual(demoteStrayDoActions(body, blocks), blocks);
    });
});

describe('driverDirective: ситуативная инструкция хода', () => {
    it('step-prompt clarify → «Действие: ask_user» с номером шага, без propose_plan/complete_step-меню', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(2));
        task.steps[0].description = 'Определить тему и цель презентации';
        const entry = task.ribbon[0];
        entry.content = 'Выполни шаг 1: «Определить тему и цель презентации»';
        const d = driverDirective(body, entry);
        assert.match(d, /Шаг 1/);
        assert.match(d, /Действие: ask_user/);
        assert.doesNotMatch(d, /propose_plan/);
        assert.doesNotMatch(d, /complete_step/);
    });

    it('step-prompt do → save_file и complete_step({step: N}) с конкретным N, без ask_user', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(3));
        task.steps[0].status = 'done';
        task.steps[1].status = 'in_progress';
        task.ribbon.push({ type: 'prompt', content: 'Выполни шаг 2: «Шаг 2»', sender: 'WORK', step: 2 });
        const d = driverDirective(body, task.ribbon[task.ribbon.length - 1]);
        assert.match(d, /Шаг 2/);
        assert.match(d, /save_file/);
        assert.match(d, /complete_step\(\{step: 2/);
        assert.doesNotMatch(d, /Действие: ask_user/);
    });

    it('пользовательский prompt без задачи → Plan-фаза с «Тип: вопрос | задача», без complete_step', () => {
        const body = { ribbon: [{ type: 'prompt', content: 'сделай презентацию', sender: 'U1' }] };
        const d = driverDirective(body, body.ribbon[0]);
        assert.match(d, /Тип: вопрос \| задача/);
        assert.match(d, /propose_plan/);
        assert.doesNotMatch(d, /complete_step/);
        assert.doesNotMatch(d, /save_file/);
    });

    it('tool_result ok при активной задаче → конкретный complete_step({step: N})', () => {
        const { body } = (({ ribbon }) => ({ body: { ribbon } }))(makeTaskBody(2));
        const d = driverDirective(body, { type: 'tool_result', tool: 'save_file', ok: true });
        assert.match(d, /complete_step\(\{step: 1/);
        const dErr = driverDirective(body, { type: 'tool_result', tool: 'save_file', ok: false });
        assert.match(dErr, /исправленный tool/);
        assert.match(dErr, /complete_step\(\{step: 1/);
    });

    it('финальный prompt Отчёта → отчёт + Принять, без tools', () => {
        const { body } = (({ ribbon }) => ({ body: { ribbon } }))(makeTaskBody(1));
        const d = driverDirective(body, {
            type: 'prompt',
            sender: 'WORK',
            content: 'Все шаги выполнены…\n\nСформируй финальный Отчёт: что сделано.',
        });
        assert.match(d, /Действие: отчёт/);
        assert.match(d, /Принять/);
        assert.match(d, /Tools не вызывай/);
    });

    it('resolveServicePrompt с body отдаёт директиву, без body — fallback TYPES', () => {
        const { body, task } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(2));
        const entry = task.ribbon[0];
        const withBody = resolveServicePrompt(entry, 'USER', body);
        assert.match(withBody, /Шаг 1/);
        const withoutBody = resolveServicePrompt({ type: 'prompt' }, 'USER');
        assert.match(withoutBody, /Классификация/);
    });
});

describe('впрыск состояния в Do-блок system', () => {
    it('system содержит evidence шага, реальные артефакты и остаток авто-ходов', () => {
        const { body } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(2));
        ribbonTargetOf(body).push({ type: 'file', path: '/U/history/док.html' });
        pushEvidence(body);
        const messages = buildHistoryFromRibbon(body, false, { autoTurnsLeft: 7 });
        const sys = messages.find(m => m.role === 'system').content;
        assert.match(sys, /Исполнение задачи \(Do\)/);
        assert.match(sys, /Доказательства шага: опрос нет, успешный tool есть/);
        assert.match(sys, /Артефакты \(реальные пути\): \/U\/history\/док\.html/);
        assert.match(sys, /Остаток авто-ходов: 7/);
    });

    it('без артефактов — предупреждение не выдумывать файлы', () => {
        const { body } = (({ ribbon, task }) => ({ body: { ribbon }, task }))(makeTaskBody(1));
        const messages = buildHistoryFromRibbon(body, false, {});
        const sys = messages.find(m => m.role === 'system').content;
        assert.match(sys, /Артефактов ещё нет — не упоминай несуществующие файлы/);
        assert.doesNotMatch(sys, /Остаток авто-ходов/, 'без autoTurnsLeft строка бюджета не пишется');
    });
});
