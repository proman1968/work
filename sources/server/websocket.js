import * as WebSocket from 'ws';
import { parseCookies } from './http-utils.js';
import { WorkServer } from './work-server.js';

export function onWebSocketConnect(ws, request) {
    const cookies = parseCookies(request);
    let user = WorkServer.get_user(cookies.ssid);
    let wsid = WorkServer.genGUID();
    user.sockets[wsid] = { ws, events: [] };
    ws.send(JSON.stringify({ type: 'connect', wsid }));
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
        if (!Object.keys(user.sockets).length) {
            delete WorkServer.users[user.ssid];
            if (user.$user) {
                user.$user.online = undefined;
                user.$user.reset();
            }
        }
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
