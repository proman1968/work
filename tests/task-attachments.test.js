/** Первое сообщение .task из чата: имена файлов и пути снимков передаются раздельно. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import trigger from '../$server/$folder/$file/$task/triggers/on_save/$trigger/class.js';

it('on_save передаёт именованные attachments задаче, но включает в журнал только пути', async () => {
    const file = { init: Promise.resolve() };
    let received;
    const previous = globalThis.WORK_AGENT;
    globalThis.WORK_AGENT = async () => ({
        isRunning: () => false,
        getBody: async () => ({ items: [], name: 'Задача' }),
        prompt: async (_file, args) => { received = args; return { ok: true }; },
    });
    const path = '/BASE/xlsx/.себестоимость июнь.xlsx/history/2026-10-01/123.X.xlsx';
    try {
        const params = {
            prompt: 'Проверь файл',
            includes: JSON.stringify([path]),
            attachments: JSON.stringify([{ path, name: 'себестоимость июнь.xlsx' }]),
        };
        assert.deepEqual(JSON.parse(params.includes), [path]);
        await trigger.execute.call({ $context: file }, params);
        assert.deepEqual(received.attachments, [{ path, name: 'себестоимость июнь.xlsx' }]);
        assert.equal(received.prompt, 'Проверь файл');

        await trigger.execute.call({ $context: file }, { includes: params.includes });
        assert.deepEqual(received.attachments, [path]);
    }
    finally {
        globalThis.WORK_AGENT = previous;
    }
});

it('общий чат передаёт имя исходного файла отдельно от пути снимка', async () => {
    const previous = globalThis.ODA;
    const previousWork = globalThis.WORK;
    const defs = [];
    globalThis.ODA = def => { defs.push(def); return def; };
    try {
        await import('../$server/$folder/$class/$structure/handlers/pages/form/chat/$handler/chat.js');
        const chat = defs.find(d => d.is === 'oda-chat');
        assert.ok(chat);
        const file = new File(['xlsx'], 'себестоимость июнь.xlsx');
        const history = '/BASE/xlsx/.себестоимость июнь.xlsx/history/2026-10-01/123.X.xlsx';
        let taskParams;
        const node = {
            async save_file(f, params) {
                if (f.name.endsWith('.task')) {
                    taskParams = { ...params };
                    return { path: '/BASE/task/123.X.task' };
                }
                return { path: history };
            },
        };
        const host = {
            value: 'task', files: [file], isAIMode: true, model: '', effort: 'low',
            $pdp: { isPrivate: false, receivers: [], $item: node },
            $(id) { return id === '#ribbon' ? { scrollDown: false } : { files: [file], effortLevel: 'low' }; },
            _geo() { return null; },
            clear() {}, focusInput() {}, _awaitNewTask() {},
            _openCreated: async () => {},
            _createTask: chat._createTask,
        };
        await chat.send.call(host);
        assert.deepEqual(JSON.parse(taskParams.includes), [history]);

        // Отправка файлов без текстового промпта в режиме ИИ также создаёт .task (не падает в save_files)
        let taskCreatedNoPrompt = false;
        let savedTaskBody = null;
        let saveFilesCalled = false;
        const nodeNoPrompt = {
            async save_files() {
                saveFilesCalled = true;
                return [];
            },
            async save_file(f, params) {
                if (f.name.endsWith('.task')) {
                    taskCreatedNoPrompt = true;
                    savedTaskBody = JSON.parse(await f.text());
                    taskParams = { ...params };
                    return { path: '/BASE/task/124.X.task' };
                }
                return { path: history };
            },
        };
        const hostNoPrompt = {
            value: '', files: [file], isAIMode: true, model: '',
            $pdp: { isPrivate: false, receivers: [], $item: nodeNoPrompt },
            $(id) { return id === '#ribbon' ? { scrollDown: false } : { files: [file] }; },
            _geo() { return null; },
            clear() {}, focusInput() {}, _awaitNewTask() {},
            _openCreated: async () => {},
            _createTask: chat._createTask,
        };
        await chat.send.call(hostNoPrompt);
        assert.equal(taskCreatedNoPrompt, true, 'без текстового промпта в режиме ИИ должна создаваться задача .task');
        assert.equal(saveFilesCalled, false, 'save_files обычного чата не должен вызываться в режиме ИИ');
        assert.equal(savedTaskBody.name, 'себестоимость июнь.xlsx');
        assert.equal(savedTaskBody.prompt, '');
        assert.equal(taskParams.prompt, '');

    }
    finally {
        globalThis.ODA = previous;
        globalThis.WORK = previousWork;
    }
});

it('toMessages формирует инструкцию изучить вложения и спросить пользователя при пустом тексте промпта', async () => {
    const { toMessages } = await import('../sources/modules/agent/loop.js');
    const items = [{
        id: 'u1',
        type: 'user',
        content: '',
        attachments: [
            { path: '/BASE/task/.124.X.task/xlsx/себестоимость июнь.xlsx', name: 'себестоимость июнь.xlsx' },
            { path: '/BASE/task/.124.X.task/xlsx/затраты.xlsx', name: 'затраты.xlsx' },
        ],
    }];
    const msgs = toMessages('SYS', items);
    const userMsg = msgs.find(m => m.role === 'user');
    assert.ok(userMsg);
    assert.match(userMsg.content, /Пользователь прикрепил файлы без текстового поручения/);
    assert.match(userMsg.content, /спроси у пользователя, что с ними нужно сделать/);
    assert.match(userMsg.content, /\[Вложения\]/);
    assert.match(userMsg.content, /себестоимость июнь\.xlsx/);
});