import * as WebSocket from 'ws';
import { parseCookies } from './http-server.js';
import { $server } from '../server/server.js';

export function onWebSocketConnect(ws, request) {
    const cookies = parseCookies(request);
    let user = $server.get_user(cookies.ssid);
    let wsid = $server.genGUID();
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
        if (!Object.keys(user.sockets).length && user.$user) {
            user.$user.online = undefined;
            user.$user.reset();
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
