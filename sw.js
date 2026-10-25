/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

(/**@param {ServiceWorkerGlobalScope} self*/async (self) => {
    const pushHandlers = Object.create(null);
    const RTCCallerMessageChannel = new BroadcastChannel('RTCCaller-channel');
    self.addEventListener('install',
        (event) => {
            self.skipWaiting();

        }
    );
    self.addEventListener(
        'fetch',
        (event) => {
            // 9.11: офлайн-заглушка навигации: страницы WORK не открываются без сети —
            // честный экран «нет сети» вместо зависшей пустой вкладки (данные — только онлайн)
            if (event.request.mode === 'navigate' && !self.navigator.onLine) {
                event.respondWith(new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
                return;
            }
            if (event.request.method !== "GET") return;
            const url = new URL(event.request.url);
            const { method, params } = Array.from(url.searchParams)
                .reduce((res, [k, v], i) => {
                    if (i === 0 && !v) {
                        res.method = k;
                    }
                    else {
                        res.params[k] = v;
                    }
                    return res;
                }, { method: '', params: {} });
            if (method === 'manifest') {
                event.respondWith(
                    (async () => {
                        try {
                            const client = await self.clients.get(event.clientId);
                            const idx = client.url.lastIndexOf('~') - 1;
                            let handler_path = idx > -1 ? client.url.slice(idx) : '/~/handlers/pages/explorer/';
                            if (!handler_path.endsWith('/')) handler_path += '/';
                            url.searchParams.append('handler_path', handler_path);
                            return fetch(url);
                        }
                        catch (err) {
                            console.warn(err);
                            return fetch(url);
                        }
                    })(),
                  );
            }
        }
    );
    self.addEventListener(
        'push',
        (event) => {
            const data = event?.data?.json();
            if (!data) return;
            event.waitUntil(handleNotification(data));
        }
    );
    self.addEventListener(
        'notificationclick',
        async (event) => {
            console.log('notificationclick', event);
            event.notification.close();
            const pushHandler = pushHandlers[event.notification.tag];
            if (pushHandler) {
                try {
                    await pushHandler.actions.find(a => a.action === event.action)?.fn();
                }
                catch (err) {
                    console.warn(err);
                }
                pushHandler.remove();
                return;
            }
            // уведомление с адресом (задача): вкладка с ним — в фокус, иначе открыть
            const url = event.notification.data?.url;
            if (url)
                event.waitUntil((async () => {
                    const target = new URL(url, self.location.origin).href;
                    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
                    const open = wins.find(c => c.url === target);
                    if (open)
                        return open.focus();
                    return self.clients.openWindow(target);
                })());
        });
    self.addEventListener(
        'notificationclose', async (event) => {
            console.log('notificationclose', event);
            event.notification.close();
            const pushHandler = pushHandlers[event.notification.tag];
            if (pushHandler) {
                pushHandler.remove();
            }
        });

const OFFLINE_PAGE = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WORK — нет сети</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', Arial, sans-serif; background: #f5f6fa; color: #1a2333; }
  .card { max-width: 420px; padding: 32px 36px; border-radius: 16px; background: #fff;
    box-shadow: 0 8px 32px rgba(20, 30, 60, .12); text-align: center; }
  h1 { margin: 0 0 12px; font-size: 22px; }
  p { margin: 0; color: #5a6b85; line-height: 1.5; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: #2f6fed; margin: 0 auto 18px; }
  button { margin-top: 20px; padding: 10px 22px; border: 0; border-radius: 999px;
    background: #2f6fed; color: #fff; font-size: 15px; cursor: pointer; }
</style></head><body>
<div class="card"><div class="dot"></div>
<h1>Нет сети</h1>
<p>WORK работает с сервером организации — данные доступны только при подключении.</p>
<p style="margin-top:10px">Сообщения, написанные без сети, сохранятся и отправятся при подключении (если задача открыта).</p>
<button onclick="location.reload()">Повторить</button>
</div></body></html>`;

    /**@param {{type: string, [key: string]: any}} data  */
    async function handleNotification(data) {        if (!(self.Notification && self.Notification.permission === "granted")) {
            return;
        }
        console.log('push:', data);
        const tag = data.type;
        switch (data.type) {
            case 'phone.call': {
                if (RTCCallerMessageChannel) {
                    return new Promise(async (resolve, reject) => {
                        try {
                            const openedClients = await self.clients.matchAll({ type: 'window' })
                            const visibleClient = openedClients.find(c => c.visibilityState === 'visible');
                            if (!visibleClient) {
                                const message = data.data;

                                if (pushHandlers[tag]) {
                                    console.warn('pushHandler already exist');
                                    pushHandlers[tag].remove();
                                    return;
                                }

                                const pushHandler = {
                                    messageHandler: (e) => {
                                        try {
                                            console.log(e);
                                            if (e.data.type === 'caller-ready') {
                                                RTCCallerMessageChannel.removeEventListener('message', pushHandler.messageHandler);
                                                RTCCallerMessageChannel.postMessage({
                                                    type: 'phone.call',
                                                    message
                                                });
                                                resolve(true);
                                            }
                                        }
                                        catch (err) {
                                            reject(err);
                                        }
                                    },
                                    actions: [
                                        {
                                            action: 'confirm',
                                            title: 'принять',
                                            fn: () => {
                                                return self.clients.openWindow(`${message.context}/~/handlers/pages/explorer/index.html`);
                                            }
                                        },
                                        {
                                            action: 'reject',
                                            title: 'отклонить',
                                        }
                                    ],
                                    remove: () => {
                                        if (pushHandlers[tag] === pushHandler) {
                                            delete pushHandlers[tag];
                                        }
                                    }
                                };
                                pushHandlers[tag] = pushHandler;

                                RTCCallerMessageChannel.addEventListener('message', pushHandler.messageHandler);

                                await self.registration.showNotification('Входящий звонок', {
                                    tag,
                                    icon: '/icon-192.png',
                                    badge: '/badge-72.png',
                                    vibrate: [300, 300, 300, 100, 100, 300, 300, 300, 100],
                                    actions: pushHandler.actions
                                });
                            }
                            else {
                                resolve(false);
                            }
                        }
                        catch (err) {
                            reject(err);
                        }
                    });
                }
            } break;
            default: {
                // Вопрос/разрешение/ошибка требуют внимания даже при открытой другой вкладке WORK.
                // Завершение подавляем только когда пользователь уже смотрит именно эту задачу.
                if (String(data.type || '').startsWith('task:')) {
                    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
                    const target = data.data?.url && new URL(data.data.url, self.location.origin).pathname;
                    if (data.data?.state === 'done' && target && wins.some(c => c.visibilityState === 'visible' && c.focused
                        && new URL(c.url).pathname === target))
                        return;
                    // 9.7: ожидающее разрешение — кнопки «Разрешить/Отклонить» прямо в уведомлении:
                    // подтверждение уходит на сервер (POST file?approve — те же права, что в интерфейсе),
                    // без кнопок (вопрос/прочее) — клик открывает задачу, как раньше
                    const approval = data.data?.approval;
                    if (approval && approval.call && data.data?.task && !pushHandlers[data.tag]) {
                        const tag = data.tag;
                        const approveOnServer = async (accept) => {
                            const res = await fetch(data.data.task + '?approve', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ call: approval.call, accept }),
                            });
                            const out = await res.json().catch(() => null);
                            if (!res.ok || out?.ok === false)
                                throw new Error(out?.error || 'HTTP ' + res.status);
                        };
                        const pushHandler = {
                            actions: [
                                { action: 'task-approve', title: 'Разрешить', fn: () => approveOnServer(true) },
                                { action: 'task-reject', title: 'Отклонить', fn: () => approveOnServer(false) },
                            ],
                            remove: () => { if (pushHandlers[tag] === pushHandler) delete pushHandlers[tag]; },
                        };
                        pushHandlers[tag] = pushHandler;
                        await self.registration.showNotification(data.title || 'Задача ждёт вас', {
                            tag,
                            icon: '/icon-192.png',
                            badge: '/badge-72.png',
                            vibrate: [200, 100, 200],
                            requireInteraction: true,
                            renotify: true,
                            ...data,
                        });
                        return;
                    }
                }
                await self.registration.showNotification(data.title || 'Внимание!', {
                    tag,
                    icon: '/icon-192.png',
                    badge: '/badge-72.png',
                    vibrate: [200, 100, 200],
                    ...data
                });
            } break;
        }
    }
})(self);
