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
            }
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

    /**@param {{type: string, [key: string]: any}} data  */
    async function handleNotification(data) {
        if (!(self.Notification && self.Notification.permission === "granted")) {
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
