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
});
