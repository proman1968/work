import './reactor.js';
import webPush from 'web-push';
import './host/stun.js';
import { DEV_MODE, LOCAL_ORIGIN } from './host/config.js';
import { vapidKeys } from './host/vapid.js';
import './server/index.js';
import './server/server.js';
import { $server } from './server/server.js';
import { createRequestHandler, startServers } from './host/http-server.js';
import { attachWebSocket } from './host/websocket.js';
import { startStatsCollector } from './host/stats-collector.js';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

webPush.setVapidDetails(
    'https://odant.org',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

globalThis.WORK = new $server();
globalThis.ssid = $server.genGUID();

/** $method scripts load via data: URL — use this instead of relative imports. */
globalThis.loadHost = async function loadHost(name) {
    const href = pathToFileURL(path.join(process.cwd(), 'sources/host', name + '.js')).href;
    return import(href);
};

const requestHandler = createRequestHandler();
const { httpServer, httpsServer } = startServers(requestHandler);
attachWebSocket(httpServer, httpsServer);

await WORK.children;

try {
    const licenses = await WORK.get_item('/SYS/Licenses', 0, undefined, { user: globalThis.WORK });
    const methods = await licenses?._methods;
    if (methods?.getActive?.execute) {
        const active = await methods.getActive.execute({ user: globalThis.WORK, $context: licenses });
        if (!active?.count)
            console.warn('[licenses] boot check: no active licenses (soft mode)');
        else
            console.log(`[licenses] boot check: ${active.count} active license(s)`);
    }
}
catch (e) {
    console.warn('[licenses] boot check skipped:', e.message);
}

startStatsCollector();

globalThis.ODA = function (prototype) {};
if (DEV_MODE)
    console.warn(`WORK_DEV=${process.env.WORK_DEV}: security visibility and method guards are DISABLED`);
else
    console.log('Security: visibility and method guards enabled (WORK_DEV is off)');
console.log(`to launch: ${LOCAL_ORIGIN}/index.html`);
console.log(`to launch: ${LOCAL_ORIGIN}/root/~/handlers//explorer/`);
