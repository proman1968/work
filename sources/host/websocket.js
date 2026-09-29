import * as WebSocket from 'ws';
import { parseCookies } from './http-server.js';
import { $server } from '../server/server.js';

/** Уведомить все сессии о смене presence пользователя (online). */
function broadcastUserPath($user) {
    if (!$user?.short)
        return;
    const message = JSON.stringify({ path: $user.short, initiator: $user.id });
    for (const session of Object.values($server.sessions)) {
        for (const sock of Object.values(session.sockets || {})) {
            if (sock?.ws?.readyState === 1)
                sock.ws.send(message);
        }
    }
}

function notifyUserOnline(session) {
    if (!session?.$user)
        return;
    session.$user.online = undefined;
    session.$user.reset();
    broadcastUserPath(session.$user);
}

export function onWebSocketConnect(ws, request) {
    const cookies = parseCookies(request);
    let session = $server.get_session(cookies.ssid);
    let wsid = $server.genGUID();
    session.sockets[wsid] = { ws, events: [] };
    ws.send(JSON.stringify({ type: 'connect', wsid }));
    notifyUserOnline(session);
    ws.on('message', async (message) => {
        try {
            let str = new TextDecoder('utf-8').decode(message);
            let events = JSON.parse(str);
            if (!Array.isArray(events))
                return;
            const { assertPathProps, canRead } = await import('../server/access/gateway.js');
            // подписка на события пути — только если путь виден субъекту сессии
            for (const path of events.slice(0, 200)) {
                if (typeof path !== 'string' || path.length > 2048)
                    continue;
                try {
                    assertPathProps(path);
                    let item = await globalThis.WORK.get_item(path);
                    if (Array.isArray(item))
                        item = item.at(-1);
                    if (!item || !(await canRead(item, { session })))
                        continue;
                    session.sockets[wsid]?.events.add(path);
                }
                catch { /* нет пути или доступа — не подписываем */ }
            }
        }
        catch (e) {
            console.error(e);
        }
    });
    ws.on('close', () => {
        session.sockets[wsid] = undefined;
        delete session.sockets[wsid];
        if (!Object.keys(session.sockets).length)
            notifyUserOnline(session);
    });
}

export function attachWebSocket(httpServer, httpsServer) {
    const wsServer = new WebSocket.WebSocketServer({ server: httpServer });
    wsServer.on('connection', onWebSocketConnect);

    if (httpsServer) {
        const wssServer = new WebSocket.WebSocketServer({ server: httpsServer });
        wssServer.on('connection', onWebSocketConnect);
    }
}
