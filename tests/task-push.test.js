/** SW: ожидающий вопрос/разрешение не скрывается из-за другой вкладки WORK. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

it('push ожидания виден при сфокусированном WORK; завершение скрыто лишь в открытой задаче', async () => {
    const handlers = new Map();
    const shown = [];
    let focused = 'https://work.test/BASE/other';
    const self = {
        Notification: { permission: 'granted' },
        location: { origin: 'https://work.test' },
        addEventListener: (name, fn) => handlers.set(name, fn),
        clients: { matchAll: async () => [{ url: focused, visibilityState: 'visible', focused: true }] },
        registration: { showNotification: async (title, options) => shown.push({ title, options }) },
    };
    vm.runInNewContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), {
        self, URL, console: { log() {}, warn() {} }, BroadcastChannel: class { addEventListener() {} },
    });
    const fire = async state => {
        let done;
        handlers.get('push')({ data: { json: () => ({ type: 'task:/BASE/task/1.task', title: state,
            data: { url: '/BASE/task/1.task/~/handlers//form/index.html', state } }) }, waitUntil: p => { done = p; } });
        await done;
    };
    await fire('waiting');
    assert.equal(shown.length, 1);
    await fire('review');
    assert.equal(shown.length, 2);
    await fire('done'); // в фокусе другая страница WORK
    assert.equal(shown.length, 3);
    focused = 'https://work.test/BASE/task/1.task/~/handlers//form/index.html';
    await fire('done');
    assert.equal(shown.length, 3);
    await fire('waiting');
    assert.equal(shown.length, 3, 'в открытой сфокусированной задаче пуш waiting тоже не дублируется');

    // Когда открыт и в фокусе главный проводник WORK (/), пуши задач тоже подавляются
    focused = 'https://work.test/';
    await fire('waiting');
    assert.equal(shown.length, 3, 'в активном окне проводника WORK пуш не спамит');

    // Клик по кнопкам «Разрешить / Отклонить» в пуше отправляет POST ?approve напрямую по notification.data без открытия новой вкладки
    focused = 'https://work.test/BASE/other';
    const fetches = [];
    let openedWins = 0;
    self.clients.openWindow = async () => { openedWins++; };
    const ctxFetch = async (url, opts) => {
        fetches.push({ url, opts });
        return { ok: true, json: async () => ({ ok: true }) };
    };
    const handlers2 = new Map();
    vm.runInNewContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), {
        self: { ...self, addEventListener: (name, fn) => handlers2.set(name, fn) },
        URL, fetch: ctxFetch, console: { log() {}, warn() {} }, BroadcastChannel: class { addEventListener() {} },
    });
    let waitClick;
    await handlers2.get('notificationclick')({
        action: 'task-approve',
        notification: {
            tag: 'task:/BASE/task/1.task',
            close() {},
            data: {
                url: '/BASE/task/1.task/~/handlers//form/index.html',
                task: '/BASE/task/1.task',
                approval: { call: 'call-123', reason: 'schedule' },
            },
        },
        waitUntil: p => { waitClick = p; },
    });
    await waitClick;
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0].url, '/BASE/task/1.task?approve');
    assert.deepEqual(JSON.parse(fetches[0].opts.body), { call: 'call-123', accept: true });
    assert.equal(openedWins, 0, 'новая вкладка не открывается при нажатии кнопки в пуше');
});
