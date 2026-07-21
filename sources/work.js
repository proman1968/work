import './reactor.js';
import webPush from 'web-push';
import './host/stun.js';
import { DEV_MODE, LOCAL_ORIGIN } from './host/config.js';
import { vapidKeys } from './host/vapid.js';
import './server/index.js';  // гарантирует порядок инициализации FS классов
import './server/server.js';
import { $server } from './server/server.js';
import { createRequestHandler, startServers } from './host/http-server.js';
import { attachWebSocket } from './host/websocket.js';

webPush.setVapidDetails(
    'https://odant.org',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

globalThis.WORK = new $server();
globalThis.ssid = $server.genGUID();

const requestHandler = createRequestHandler();
const { httpServer, httpsServer } = startServers(requestHandler);
attachWebSocket(httpServer, httpsServer);

await WORK.children;

globalThis.ODA = function (prototype) {};
if (DEV_MODE)
    console.warn(`WORK_DEV=${process.env.WORK_DEV}: security visibility and method guards are DISABLED`);
else
    console.log('Security: visibility and method guards enabled (WORK_DEV is off)');
console.log(`to launch: ${LOCAL_ORIGIN}/index.html`);
console.log(`to launch: ${LOCAL_ORIGIN}/root/~/handlers//explorer/`);
