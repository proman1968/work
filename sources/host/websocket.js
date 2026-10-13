import { log } from '../modules/agent/log.js';
import * as WebSocket from 'ws';
import { parseCookies } from './http-server.js';
import { $server } from '../server/server.js';

/** F24 (final 8.17): потолок WS-сообщения (подписки — маленькие JSON; RFB-клиент шлёт события мыши/клавиатуры). */
export const WS_MAX_PAYLOAD = 1024 * 1024;

/**
 * Origin WS/HTTP-запроса должен совпадать с нашим хостом (F24): кросс-сайтовый
 * захват — чужая страница в браузере вошедшего открывает ws://нас, браузер шлёт
 * cookie сессии, и страница получает подписки и экран компьютера. Без Origin
 * (не-браузерные клиенты) — пропускаем.
 */
export function sameOrigin(req) {
    const origin = String(req?.headers?.origin || '').trim();
    if (!origin)
        return true;
    try {
        return new URL(origin).host === String(req?.headers?.host || '').trim();
    }
    catch {
        return false;
    }
}

/** Уведомить сессии о смене presence пользователя (online).
 *  F24: анонимным сессиям (без вошедшего) местоположение людей не рассылаем.
 *  Экспортировано для теста фильтра. */
export function broadcastUserPath($user) {
    if (!$user?.short)
        return;
    const message = JSON.stringify({ path: $user.short, initiator: $user.id });
    for (const session of Object.values($server.sessions)) {
        if (!session?.$user)
            continue; // анонимная сессия — без присутствия
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
    // F24: чужой origin — не подключаемся вовсе (ни подписки, ни экран компьютера)
    if (!sameOrigin(request)) {
        try { ws.close(4403, 'чужой origin'); } catch (e) { log.debug('ws.origin', e); /* уже закрыт */ }
        return;
    }
    // Экран компьютера (RFB через docker exec) — отдельный обработчик, не подписка на пути
    try {
        if (/^\/~computer\//.test(String(request?.url || '').split('?')[0])) {
            import('../modules/sandbox/vnc-proxy.js')
                .then(m => m.handleVncSocket(ws, request))
                .catch(() => { try { ws.close(4411, 'VNC недоступен'); } catch (e) { log.debug('ws.vnc', e); /* уже */ } });
            return;
        }
    }
    catch (e) { log.debug('ws.upgrade', e); /* обычный путь подписки */ }
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
                catch (e) { log.debug('ws.subscribe', e); /* нет пути или доступа — не подписываем */ }
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
    // F24: слишком большое сообщение (и прочие ошибки сокета) — не роняют процесс
    ws.on('error', e => log.debug('ws.error', e));
}

export function attachWebSocket(httpServer, httpsServer) {
    // F24: maxPayload — гигантский кадр от клиента не оседает в памяти
    const wsServer = new WebSocket.WebSocketServer({ server: httpServer, maxPayload: WS_MAX_PAYLOAD });
    wsServer.on('connection', onWebSocketConnect);

    if (httpsServer) {
        const wssServer = new WebSocket.WebSocketServer({ server: httpsServer, maxPayload: WS_MAX_PAYLOAD });
        wssServer.on('connection', onWebSocketConnect);
    }
}
