/**
 * Пайплайн prompt (task.ai): wait-порядок, дубль-опросы по стеку задач,
 * ворота subplan, чистка эха [инструкция] и детект мусорных tool-хвостов.
 * Прогон-источник: 1785184209966 («сделай презентацию»).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    hoistWaitBlock,
    collectAnsweredInteractive,
    findAnsweredDuplicate,
    subplanGateError,
    applySubplan,
    findActiveTask,
    activeTaskChain,
    advanceTask,
    normalizeModelToolProse,
    foldProseIntoInteractive,
    stripBoilerplateContent,
    isBareAskUserText,
    isBareAskUserChannel,
    isBareToolProseText,
    parseJsonStepsArray,
    parseResponseToRibbon,
    consumeBraceSubplan,
    parseSubplanTextBlock,
    parseProposePlanTextBlock,
    parseJsObjectLiteral,
    parseJsStyleToolCallAt,
} from '../$server/$folder/$file/$ai/class.js';

const q = (over = {}) => ({
    type: 'questions',
    fields: [{ id: 'kpi', label: 'Какие KPI включить?', type: 'select', options: ['a', 'b'] }],
    ...over,
});

describe('hoistWaitBlock: незакрытый интерактив хода — хвост ленты', () => {
    it('questions перед tool_result перемещается в конец', () => {
        const ribbon = [
            { type: 'prompt', content: 'x' },
            q(),
            { type: 'tool_result', tool: 'propose_plan', ok: false },
        ];
        hoistWaitBlock(ribbon, 1);
        assert.equal(ribbon[2].type, 'questions');
        assert.equal(ribbon[1].type, 'tool_result');
    });

    it('answered-опрос и блоки прошлых ходов не трогаются', () => {
        const ribbon = [
            q({ answered: true }),
            { type: 'prompt', content: 'x' },
            { type: 'tool_result', tool: 'save_file', ok: true },
        ];
        const before = [...ribbon];
        hoistWaitBlock(ribbon, 2);
        assert.deepEqual(ribbon, before);
    });

    it('wait-блок уже последний — порядок сохраняется', () => {
        const ribbon = [{ type: 'thinking', content: 't' }, q()];
        hoistWaitBlock(ribbon, 0);
        assert.equal(ribbon[1].type, 'questions');
        assert.equal(ribbon[0].type, 'thinking');
    });
});

describe('дубль-опрос ищется по всему стеку задач', () => {
    it('answered questions в ленте родительской task находится из свежей subplan-task', () => {
        const answered = q({
            answered: true,
            fields: [
                { id: 'topic', label: 'Какова тема Вашей презентации?', type: 'select', options: ['a'], value: 'a' },
                { id: 'goal', label: 'Какая цель Вашей презентации?', type: 'select', options: ['b'], value: 'b' },
            ],
        });
        const body = {
            ribbon: [
                { type: 'task', state: 'completed', ribbon: [answered] },
                { type: 'task', state: 'active', ribbon: [], steps: [] },
            ],
        };
        const newQ = q({
            fields: [
                { id: 't2', label: 'Какова тема Вашей презентации?', type: 'select', options: ['a'] },
                { id: 'g2', label: 'Какая цель Вашей презентации?', type: 'select', options: ['b'] },
            ],
        });
        const dup = findAnsweredDuplicate(collectAnsweredInteractive(body), newQ);
        assert.equal(dup, answered);
    });

    it('другие вопросы дублем не считаются', () => {
        const body = { ribbon: [q({ answered: true })] };
        const other = q({ fields: [{ id: 'x', label: 'Совсем другой вопрос?', options: ['a', 'b'] }] });
        assert.equal(findAnsweredDuplicate(collectAnsweredInteractive(body), other), null);
    });
});

describe('subplanGateError: повтор плана и глубина стека', () => {
    const task = (steps, state = 'active') => ({
        type: 'task',
        state,
        steps: steps.map((d, i) => ({
            step: i + 1,
            description: d,
            status: i === 0 ? 'in_progress' : 'proposed',
        })),
        ribbon: [],
    });

    it('subplan-копия шагов родителя отклоняется', () => {
        const body = { ribbon: [task(['Определить тему.', 'Собрать информацию!'])] };
        const err = subplanGateError(body, [
            { description: 'Определить тему' },
            { description: 'Собрать информацию' },
        ]);
        assert.match(err, /повтор шагов/i);
        assert.match(err, /Определить тему/);
    });

    it('лимит вложенности: цепочка из 3 активных → отказ', () => {
        const leaf = task(['e', 'f']);
        const mid = task(['c', 'd']);
        mid.ribbon = [leaf];
        const root = task(['a', 'b']);
        root.ribbon = [mid];
        const body = { ribbon: [root] };
        assert.equal(activeTaskChain(body).length, 3);
        const err = subplanGateError(body, [{ description: 'новый подшаг' }, { description: 'ещё один' }]);
        assert.match(err, /лимит вложенности/i);
    });

    it('настоящая декомпозиция пушится в ribbon родителя, не в корень', () => {
        const parent = task(['Собрать информацию', 'Оформить']);
        const body = { ribbon: [parent] };
        assert.equal(subplanGateError(body, [
            { description: 'Изучить структуру презентации' },
            { description: 'Выписать тезисы' },
        ]), null);
        const applied = applySubplan(body, [
            { description: 'Изучить структуру презентации' },
            { description: 'Выписать тезисы' },
        ]);
        assert.ok(applied);
        assert.match(applied.instruction, /Изучить структуру/);
        assert.equal(body.ribbon.length, 1, 'корень не получил соседнюю задачу');
        assert.equal(parent.ribbon.length, 1);
        assert.equal(parent.ribbon[0].subplan, true);
        assert.equal(parent.ribbon[0], applied.sub);
        assert.equal(findActiveTask(body), applied.sub);
    });

    it('без активной задачи ворота молчат', () => {
        assert.equal(subplanGateError({ ribbon: [] }, [{ description: 'x' }]), null);
    });

    it('один подшаг — не декомпозиция: teach «минимум 2»', () => {
        const body = { ribbon: [task(['Предложить шаблон', 'Сохранить файл'])] };
        const err = subplanGateError(body, [
            { description: 'Предложить шаблон для минималистичной презентации' },
        ]);
        assert.match(err, /минимум 2 подшага/i);
        assert.match(err, /Предложить шаблон/);
    });
});

describe('стек вложенных задач: findActiveTask / advanceTask', () => {
    const task = (steps, state = 'active', extra = {}) => ({
        type: 'task',
        state,
        steps: steps.map((d, i) => ({
            step: i + 1,
            description: d,
            status: i === 0 ? 'in_progress' : 'proposed',
        })),
        ribbon: [],
        ...extra,
    });

    it('findActiveTask возвращает самую глубокую активную', () => {
        const child = task(['подшаг 1', 'подшаг 2'], 'active', { subplan: true, parentStep: 1 });
        const parent = task(['шаг 1', 'шаг 2']);
        parent.ribbon = [child];
        const body = { ribbon: [parent] };
        assert.equal(findActiveTask(body), child);
        assert.deepEqual(activeTaskChain(body).map(t => t === parent ? 'parent' : 'child'),
            ['parent', 'child']);
    });

    it('после completed у ребёнка findActiveTask возвращает родителя', () => {
        const child = task(['подшаг 1', 'подшаг 2'], 'active', { subplan: true, parentStep: 1 });
        const parent = task(['шаг 1', 'шаг 2']);
        parent.ribbon = [child];
        const body = { ribbon: [parent] };
        child.state = 'completed';
        assert.equal(findActiveTask(body), parent);
    });

    it('advanceTask: закрытие subplan закрывает шаг родителя и двигает дальше', () => {
        const child = task(['подшаг 1'], 'active', { subplan: true, parentStep: 1, label: 'декомпозиция' });
        child.steps[0].status = 'done';
        const parent = task(['шаг 1 родителя', 'шаг 2 родителя']);
        parent.ribbon = [child];
        const body = { ribbon: [parent] };
        const follow = advanceTask(body, child);
        assert.equal(child.state, 'completed');
        assert.equal(parent.steps[0].status, 'done');
        assert.equal(parent.steps[1].status, 'in_progress');
        assert.match(follow, /шаг 2 родителя/);
        assert.equal(findActiveTask(body), parent);
    });
});

describe('prose propose_plan({intro, steps:[…]})', () => {
    // Прогон 1785189073584: GigaChat пишет JS-style с unquoted keys и массивом steps
    const prose = 'propose_plan({\n'
        + '     intro: "Для создания качественной презентации необходимо уточнить несколько деталей.",\n'
        + '     steps: [\n'
        + '        {\n'
        + '            description: "Уточнить формат презентации"\n'
        + '        },\n'
        + '        {\n'
        + '            description: "Определить тему и цель презентации"\n'
        + '        },\n'
        + '        {\n'
        + '            description: "Выяснить целевую аудиторию"\n'
        + '        },\n'
        + '        {\n'
        + '            description: "Установить сроки выполнения"\n'
        + '        }\n'
        + '    ]\n'
        + '})';

    it('parseJsObjectLiteral разбирает steps:[…] с unquoted keys', () => {
        const start = prose.indexOf('{');
        const bal = prose.slice(start, prose.lastIndexOf('}') + 1);
        const args = parseJsObjectLiteral(bal);
        assert.ok(args);
        assert.equal(args.intro?.startsWith('Для создания'), true);
        assert.equal(args.steps?.length, 4);
        assert.equal(args.steps[0].description, 'Уточнить формат презентации');
    });

    it('parseJsStyleToolCallAt поднимает propose_plan({…}) в call', () => {
        const call = parseJsStyleToolCallAt(prose, 0, 'propose_plan');
        assert.ok(call);
        assert.equal(call.method, 'propose_plan');
        assert.equal(call.args.steps.length, 4);
    });

    it('parseProposePlanTextBlock → pendingPlan с 4 шагами', () => {
        const plan = parseProposePlanTextBlock(prose);
        assert.ok(plan);
        assert.equal(plan.steps.length, 4);
        assert.match(plan.content, /уточнить/i);
    });

    it('isBareToolProseText ловит неразобранный propose_plan({…})', () => {
        assert.equal(isBareToolProseText('propose_plan({\n  steps: [\n'), true);
        assert.equal(isBareToolProseText('propose_plan'), true);
        assert.equal(isBareToolProseText('Я вызову propose_plan позже.'), false);
    });
});

describe('prose-subplan «{subplan}[…]»', () => {
    const prose = '{subplan}[{\n     "description": "Предложить шаблон для минималистичной презентации"\n}]';

    it('consumeBraceSubplan вырезает шаги из прозы', () => {
        const res = consumeBraceSubplan('вступление ' + prose + ' хвост');
        assert.ok(res);
        assert.deepEqual(res.steps, [
            { description: 'Предложить шаблон для минималистичной презентации' },
        ]);
    });

    it('parseResponseToRibbon поднимает {subplan}[…] в pendingSubplan, не text', () => {
        const parsed = parseResponseToRibbon(prose);
        assert.ok(parsed.pendingSubplan?.length);
        assert.equal(parsed.pendingSubplan[0].description,
            'Предложить шаблон для минималистичной презентации');
        assert.ok(!parsed.blocks.some(b => b.type === 'text'
            && /subplan/i.test(String(b.content))));
    });

    it('parseSubplanTextBlock: {subplan}{steps:[…]} и subplan[…] тоже разбираются', () => {
        const viaObject = parseSubplanTextBlock(
            '{subplan}{"steps": [{"description": "а"}, {"description": "б"}]}');
        assert.deepEqual(viaObject, [{ description: 'а' }, { description: 'б' }]);
        const noBraces = parseSubplanTextBlock('subplan[{"description": "в"}]');
        assert.deepEqual(noBraces, [{ description: 'в' }]);
        assert.equal(parseSubplanTextBlock('обычный текст про subplan'), null);
    });

    it('битый {subplan}[ без JSON — огрызок для isBareToolProseText', () => {
        assert.equal(parseSubplanTextBlock('{subplan}[{"description": '), null);
        assert.equal(isBareToolProseText('{subplan}[{"description": '), true);
        assert.equal(isBareToolProseText('Опишу subplan позже в тексте.'), false);
    });
});

describe('эхо [инструкция] и проза-обвязка опроса', () => {
    it('normalizeModelToolProse вырезает строки-эхо', () => {
        const out = normalizeModelToolProse('[инструкция] уточнено\n\nСформулирую уточняющий вопрос:');
        assert.ok(!out.includes('[инструкция]'));
    });

    it('короткий text рядом с questions складывается в content', () => {
        const blocks = foldProseIntoInteractive([
            { type: 'text', content: 'Уточню детали задачи' },
            q(),
        ]);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'questions');
        assert.equal(blocks[0].content, 'Уточню детали задачи');
    });

    it('boilerplate-обвязка отбрасывается, длинный text не трогается', () => {
        const blocks = foldProseIntoInteractive([
            { type: 'text', content: 'Сформулирую уточняющий вопрос:' },
            q(),
        ]);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].content ?? '', '');

        const long = { type: 'text', content: 'Пункты:\n- один\n- два\n- три' };
        const kept = foldProseIntoInteractive([long, q()]);
        assert.ok(kept.includes(long));
    });

    it('stripBoilerplateContent режет «Сформулирую …»', () => {
        assert.equal(stripBoilerplateContent('Сформулирую уточняющий вопрос:'), '');
        assert.equal(stripBoilerplateContent('Нормальный текст'), 'Нормальный текст');
    });
});

describe('мусорные tool-хвосты', () => {
    it('«подагент=ask_user({…» — bare-попытка ask_user', () => {
        const broken = 'подагент=ask_user({\n     "fields": [\n          \n})';
        assert.equal(isBareAskUserText(broken), true);
        assert.equal(isBareAskUserChannel(broken, []), true);
    });

    it('упоминание ask_user в нормальной прозе не флагается', () => {
        const prose = 'Далее вызову ask_user (после сбора данных) и сохраню файл.';
        assert.equal(isBareAskUserText(prose), false);
        assert.equal(isBareAskUserChannel(prose, []), false);
    });

    it('isBareToolProseText: голые имена tool и огрызки → true, проза → false', () => {
        assert.equal(isBareToolProseText('ask_user'), true);
        assert.equal(isBareToolProseText('complete_step'), true);
        assert.equal(isBareToolProseText('подагент=ask_user({\n "fields": [\n})'), true);
        assert.equal(isBareToolProseText('ask_user поможет собрать данные о компании.'), false);
        assert.equal(isBareToolProseText('Готовлю презентацию по разделам.'), false);
        assert.equal(isBareToolProseText(''), false);
    });

    it('parseJsonStepsArray: JSON-массив шагов → шаги, прочее → null', () => {
        assert.deepEqual(
            parseJsonStepsArray('[{\n "description": "Определить ключевые аспекты"\n}]'),
            [{ description: 'Определить ключевые аспекты' }],
        );
        assert.equal(parseJsonStepsArray('обычный текст'), null);
        assert.equal(parseJsonStepsArray('[]'), null);
        assert.deepEqual(
            parseJsonStepsArray('["шаг один", "шаг два"]'),
            [{ description: 'шаг один' }, { description: 'шаг два' }],
        );
    });
});
