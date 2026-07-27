import * as WebSocket from 'ws';
import { parseCookies } from './http-server.js';
import { $server } from '../server/server.js';

/** Уведомить все сессии о смене presence пользователя (online). */
function broadcastUserPath($user) {
    if (!$user?.short)
        return;
    const message = JSON.stringify({ path: $user.short, initiator: $user.id });
    for (const session of Object.values($server.users)) {
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
    let user = $server.get_user(cookies.ssid);
    let wsid = $server.genGUID();
    user.sockets[wsid] = { ws, events: [] };
    ws.send(JSON.stringify({ type: 'connect', wsid }));
    notifyUserOnline(user);
    ws.on('message', (message) => {
        try {
            let str = new TextDecoder('utf-8').decode(message);
            let events = JSON.parse(str);
            user.sockets[wsid].events.add(...events);
        }
        catch (e) {
            console.error(e);
        }
    });
    ws.on('close', () => {
        user.sockets[wsid] = undefined;
        delete user.sockets[wsid];
        if (!Object.keys(user.sockets).length)
            notifyUserOnline(user);
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
