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

    }
    finally {
        globalThis.ODA = previous;
        globalThis.WORK = previousWork;
    }
});