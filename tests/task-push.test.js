/** SW: ожидающий вопрос/разрешение не скрывается из-за другой вкладки WORK. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

it('push ожидания виден при сфокусированном WORK; скрыт, если эта же задача уже на экране', async () => {
    const handlers = new Map();
    const shown = [];
    let focused = 'https://work.test/BASE/other';
    let visible = true;
    let focusedFlag = true;
    let visibleTaskPath = '';
    const closed = [];
    class FakePort {
        constructor() { this.other = null; this.onmessage = null; }
        postMessage(data) { this.other?.onmessage?.({ data }); }
        close() {}
    }
    class FakeChannel {
        constructor() {
            this.port1 = new FakePort();
            this.port2 = new FakePort();
            this.port1.other = this.port2;
            this.port2.other = this.port1;
        }
    }
    const client = {
        url: focused,
        visibilityState: 'visible',
        focused: true,
        postMessage(msg, ports) {
            if (msg?.type === 'work:is-task-visible' && msg.path === visibleTaskPath)
                ports?.[0]?.postMessage({ visible: true });
        },
    };
    const self = {
        Notification: { permission: 'granted' },
        location: { origin: 'https://work.test' },
        addEventListener: (name, fn) => handlers.set(name, fn),
        clients: {
            matchAll: async () => {
                client.url = focused;
                client.visibilityState = visible ? 'visible' : 'hidden';
                client.focused = focusedFlag;
                return [client];
            },
        },
        registration: {
            showNotification: async (title, options) => shown.push({ title, options }),
            getNotifications: async ({ tag }) => [{ tag, close: () => closed.push(tag) }],
        },
    };
    vm.runInNewContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), {
        self, URL, console: { log() {}, warn() {} }, BroadcastChannel: class { addEventListener() {} },
        MessageChannel: FakeChannel, setTimeout, clearTimeout,
    });
    const fire = async state => {
        let done;
        handlers.get('push')({ data: { json: () => ({ type: 'task:/BASE/task/1.task', title: state,
            data: { url: '/BASE/task/1.task/~/handlers//form/index.html', task: '/BASE/task/1.task', state } }) }, waitUntil: p => { done = p; } });
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

    // Та же задача открыта на экране (проводник держит её в hash), а окно не в фокусе —
    // человек видит запрос: пуш лишний
    focusedFlag = false;
    focused = 'https://work.test/~/handlers/pages/explorer/index.html#/BASE/task/1.task/~/handlers/pages/form';
    await fire('waiting');
    assert.equal(shown.length, 3, 'задача на экране — пуш не дублируется даже без фокуса окна');

    // Открыта ДРУГАЯ задача в активном окне WORK: пуш по этой не спамит (проводник в фокусе)
    focusedFlag = true;
    focused = 'https://work.test/~/handlers/pages/explorer/index.html#/BASE/task/2.task/~/handlers/pages/form';
    await fire('waiting');
    assert.equal(shown.length, 3, 'активное окно WORK по-прежнему подавляет пуш');

    // Окно WORK не в фокусе и открыта другая задача — уведомление нужно
    focusedFlag = false;
    await fire('waiting');
    assert.equal(shown.length, 4, 'другая задача на экране в неактивном окне не подавляет пуш по этой');

    // Задача открыта в ленте чата: адрес не содержит путь задачи, но видимая форма
    // отвечает service worker'у сама — пуш лишний
    focused = 'https://work.test/ORG/chat/~/handlers/pages/form/chat/index.html';
    visibleTaskPath = '/BASE/task/1.task';
    await fire('waiting');
    assert.equal(shown.length, 4, 'видимая форма задачи не подавила пуш через ответ страницы');

    // В чате открыта другая задача — пуш нужен
    visibleTaskPath = '/BASE/task/2.task';
    await fire('waiting');
    assert.equal(shown.length, 5, 'другая задача в чате не должна подавлять пуш по этой');
    visibleTaskPath = '';

    // Страница сообщила, что задача снова на экране: висящее уведомление закрывается
    await handlers.get('message')({ data: { type: 'work:task-visible', path: '/BASE/task/1.task' } });
    assert.deepEqual(closed, ['task:/BASE/task/1.task'], 'уведомление задачи не закрыто по сообщению страницы');

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
