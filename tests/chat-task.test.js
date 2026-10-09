/**
 * Раскрытие карточки только что созданной задачи в ленте чата: только та, что создана (не «последняя в ленте»).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { taskKeyOf, taskDayOf, isCreatedTask, withTimeout, runCreateTask, pathOfLog, taskNameOf, stageText } from '../$server/$folder/$class/$structure/handlers/pages/form/chat/$handler/chat-task.js';

const stub = (id, path, extra = {}) => [{ id }, { ext: 'task', path, sender: 'U1', time: 1, ...extra }];

describe('chat-task: предельное время', () => {
    it('повисший запрос отклоняется по времени, быстрый — проходит, таймер не течёт', async () => {
        await assert.rejects(withTimeout(new Promise(() => {}), 30, 'Сервер молчит'), /Сервер молчит за 0 с/);
        assert.equal(await withTimeout(Promise.resolve(7), 1000), 7);
        await assert.rejects(withTimeout(Promise.reject(new Error('отказ')), 1000), /отказ/);
    });
});

describe('chat-task: какая карточка — новая задача', () => {
    it('имя и день задачи из пути', () => {
        assert.equal(taskKeyOf('/ORG/USERS/U1/$user/USER/2026-10-08/1790000000000.U1.task'), '1790000000000.U1.task');
        assert.equal(taskKeyOf('/a/b.md'), '');
        assert.equal(taskDayOf('/x/2026-10-08/1790000000000.U1.task'), '2026-10-08');
        assert.equal(taskDayOf('/x/1790000000000.U1.task'), '');
    });

    it('путь известен: подходит только запись именно этой задачи, старые задачи дня — нет', () => {
        const want = { key: '1790000000002.U1.task', known: new Set(), uid: 'U1' };
        assert.equal(isCreatedTask(...stub('1790000000001.U1.logs', '/d/2026-10-08/1790000000001.U1.task'), want), false, 'прошлая задача');
        assert.equal(isCreatedTask(...stub('1790000000002.U1.logs', '/d/2026-10-08/1790000000002.U1.task'), want), true);
        assert.equal(isCreatedTask({ id: '1790000000002.U1.task' }, {}, want), true, 'сам файл .task');
        assert.equal(isCreatedTask({ id: '1790000000001.U1.task' }, {}, want), false);
    });

    it('путь известен: путь в записи может быть с другим префиксом — сравнивается имя файла', () => {
        const want = { key: '5.U1.task', known: new Set(), uid: 'U1' };
        assert.equal(isCreatedTask(...stub('5.U1.logs', 'USERS/U1/$user/USER/2026-10-08/5.U1.task'), want), true);
    });

    it('путь неизвестен: старые карточки (были до отправки) не подходят, новая своя — да', () => {
        const known = new Set(['1.U1.logs', '2.U1.logs']);
        const want = { key: '', known, uid: 'U1' };
        assert.equal(isCreatedTask(...stub('2.U1.logs', '/d/2026-10-08/2.U1.task'), want), false);
        assert.equal(isCreatedTask(...stub('3.U1.logs', '/d/2026-10-08/3.U1.task'), want), true);
    });

    it('путь неизвестен: чужая задача и записи не-задач не подходят', () => {
        const want = { key: '', known: new Set(), uid: 'U1' };
        assert.equal(isCreatedTask(...stub('4.U2.logs', '/d/2026-10-08/4.U2.task', { sender: 'U2' }), want), false);
        assert.equal(isCreatedTask({ id: '5.U1.logs' }, { ext: 'md', path: '/d/5.U1.md', sender: 'U1' }, want), false);
        assert.equal(isCreatedTask(...stub('6.U1.logs', '/d/2026-10-08/6.U1.task', { mainContext: '/x.task' }), want), false, 'запись внутри задачи');
    });
});

describe('chat-task: создание задачи (runCreateTask)', () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const file = name => new File(['x'], name);

    /** Зависимости-заглушки; calls — журнал вызовов по порядку. */
    function mkDeps(over = {}) {
        const calls = [];
        const deps = {
            calls,
            upload: async f => { calls.push('upload:' + f.name); return 'USERS/U1/up/' + f.name; },
            save: async ({ body, name }, params) => { calls.push('save'); deps.saved = { body, name, params }; return { logFullPath: 'BASE/$base/USER/task/2026-10-08/1791000000000.U1.task' }; },
            location: async () => ({ lat: 54.6, lon: 39.7 }),
            tz: () => 'Europe/Moscow',
            ...over,
        };
        return deps;
    }

    it('порядок и параметры: сохранение задачи (агента запускает on_save-триггер, как раньше)', async () => {
        const deps = mkDeps();
        const stages = [];
        const res = await runCreateTask({ text: 'Сделай отчёт: «итог»', files: [file('a.pdf')], params: { encoding: 'utf-8' }, settings: { model: '/MODELS/m', effort: '' }, deps, onStage: (s, i) => stages.push(s) });
        assert.deepEqual(deps.calls, ['upload:a.pdf', 'save']);
        assert.deepEqual(stages.filter((s, i) => stages.indexOf(s) === i), ['uploading', 'saving', 'saved']);
        assert.ok(!deps.saved.params.skip_file_handler, 'триггер не отключается — запуск через on_save');
        assert.equal(deps.saved.params.encoding, 'utf-8');
        assert.equal(deps.saved.params.includes, JSON.stringify(['/USERS/U1/up/a.pdf']));
        assert.equal(deps.saved.name, 'Сделай отчёт «итог»');
        assert.equal(deps.saved.body.model, '/MODELS/m');
        assert.equal(deps.saved.body.effort, 'low', 'effort всегда в теле');
        assert.deepEqual(deps.saved.body.items, []);
        assert.equal(res.path, '/BASE/$base/USER/task/2026-10-08/1791000000000.U1.task');
    });

    it('вложения грузятся параллельно, прогресс считается', async () => {
        const deps = mkDeps({ upload: async f => { await wait(80); return '/up/' + f.name; } });
        const progress = [];
        const t0 = Date.now();
        await runCreateTask({ text: 'файлы', files: [file('1.md'), file('2.md'), file('3.md')], deps, onStage: (s, i) => { if (s === 'uploading') progress.push(i.done + '/' + i.total); } });
        assert.ok(Date.now() - t0 < 230, 'не по очереди: ' + (Date.now() - t0));
        assert.deepEqual(progress, ['0/3', '1/3', '2/3', '3/3']);
        assert.equal(stageText('uploading', { done: 2, total: 3 }), 'Загружаю вложения 2/3…');
    });

    it('ошибки помечены стадией; после неудачной загрузки задача не создаётся', async () => {
        const up = mkDeps({ upload: async () => { throw new Error('413'); } });
        await assert.rejects(runCreateTask({ text: 'x', files: [file('a')], deps: up }), e => e.stage === 'uploading' && /413/.test(e.message));
        assert.ok(!up.calls.includes('save'));
        const sv = mkDeps({ save: async () => { throw new Error('500'); } });
        await assert.rejects(runCreateTask({ text: 'x', deps: sv }), e => e.stage === 'saving' && e.path === '');
        const nopath = mkDeps({ save: async () => ({}) });
        await assert.rejects(runCreateTask({ text: 'x', deps: nopath }), e => e.stage === 'saving' && /путь/.test(e.message));
    });

    it('путь из ответа сервера: logFullPath / path / обещание, всегда с «/»; имя задачи без запрещённых символов', async () => {
        assert.equal(await pathOfLog({ logFullPath: 'A/B/1.U.task' }), '/A/B/1.U.task');
        assert.equal(await pathOfLog({ path: Promise.resolve('/A/1.task') }), '/A/1.task');
        assert.equal(await pathOfLog({}), '');
        assert.equal(await pathOfLog(null), '');
        assert.equal(taskNameOf('  а/б:в\nг?  '), 'а б в г');
        assert.equal(taskNameOf('///'), 'task');
    });
});