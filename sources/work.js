import '../oda/reactor.js';
import webPush from 'web-push';
import * as CORE from './server.js';
import { LOCAL_ORIGIN } from './config.js';
import { vapidKeys } from './server/vapid.js';
import './server/work-server.js';
import { WorkServer } from './server/work-server.js';
import { fileHandlers } from './server/file-handlers.js';
import { createRequestHandler } from './server/request-handler.js';
import { startServers } from './server/http-server.js';
import { attachWebSocket } from './server/websocket.js';

globalThis.CORE = CORE;

webPush.setVapidDetails(
    'https://odant.org',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

globalThis.WORK = new WorkServer();
WORK.file_handlers = fileHandlers;
globalThis.ssid = globalThis.$server.genGUID();

const requestHandler = createRequestHandler();
const { httpServer, httpsServer } = startServers(requestHandler);
attachWebSocket(httpServer, httpsServer);

await WORK.children;

globalThis.ODA = function (prototype) {};
console.log(`to launch: ${LOCAL_ORIGIN}/index.html`);
console.log(`to launch: ${LOCAL_ORIGIN}/root/~/handlers//explorer/`);
