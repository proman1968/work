/**
 * Просмотр экрана компьютера человеком: WebSocket ↔ `exec socat` до x11vnc.
 * Портов наружу нет: VNC слушает только loopback внутри контейнера,
 * WORK дотягивается через Docker API. Доступ — владелец компьютера или админ.
 *
 * Маршруты (см. host/websocket.js, host/http-server.js):
 *   WS   /~computer/<name>/vnc        — RFB-поток (noVNC)
 *   GET  /~computer/<name>            — страница просмотра
 *   GET  /~computer/<name>/shot.png   — свежий скриншот
 *   POST /~computer/<name>/takeover   — { take:'human'|'agent' }
 *   GET  /~/lib/novnc/<путь.js>       — клиент noVNC из node_modules
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseCookies } from '../../host/http-server.js';
import { $server } from '../../server/server.js';
import { createDemuxStream } from './stream.js';
import { getDocker } from './driver.js';
import { loadSandboxConfig } from './config.js';
import {
    ownerOf, computerName, findComputer, statusOf, screenshotPng, setControl, controlBy,
} from './manager.js';
import { isAdmin } from '../agent/system.js';

const VNC_RE = /^\/~computer\/([^/]+)\/vnc$/;
const PAGE_RE = /^\/~computer\/([^/]+)(\/(shot\.png|takeover))?$/;
const NOVNC_RE = /^\/~\/lib\/novnc\/(.+)$/;

export function vncPath(name) {
    return '/~computer/' + name + '/vnc';
}

/** Сессия по cookie WS/HTTP-запроса (как в websocket.js). */
function sessionOf(req) {
    try {
        return $server.get_session(parseCookies(req).ssid);
    }
    catch {
        return null;
    }
}

/**
 * Проверка доступа: свой компьютер — всегда; чужой — только админу.
 * @returns {{ session, owner, name, id }}
 */
export async function computerAccess(req, rawName, ownerOverride) {
    const session = sessionOf(req);
    const uid = session?.uid;
    if (!uid)
        throw Object.assign(new Error('нет сессии — войдите в WORK'), { http: 401 });
    const name = computerName(rawName);
    const owner = ownerOverride || uid;
    if (owner !== uid && !(await isAdmin(session)))
        throw Object.assign(new Error('чужой компьютер — нужен ADMIN'), { http: 403 });
    const docker = await getDocker();
    const found = await findComputer(docker, owner, name);
    if (!found)
        throw Object.assign(new Error('компьютера «' + name + '» нет — он создастся при первой команде агента'), { http: 404 });
    return { session, owner, name, id: found.id, docker };
}

/** Мост WS ↔ exec-поток (socat до x11vnc). Чистая функция для тестов: pipeSocket(a, b). */
export function pipeSocket(a, b) {
    const onA = d => { try { b.write?.(d) ?? b.send?.(d); } catch { /* закрыт */ } };
    const onB = d => { try { a.send ? a.send(d) : a.write?.(d); } catch { /* закрыт */ } };
    const closeA = () => { try { a.close?.(); a.destroy?.(); } catch { /* уже */ } };
    const closeB = () => { try { b.destroy?.(); b.close?.(); } catch { /* уже */ } };
    a.on?.('message', onA);
    a.on?.('close', closeB);
    a.on?.('error', closeB);
    b.on?.('data', onB);
    b.on?.('end', closeA);
    b.on?.('error', closeA);
    b.on?.('close', closeA);
    return () => {
        a.off?.('message', onA);
        b.off?.('data', onB);
    };
}

/** Мост WS ↔ мультиплексированный exec-поток docker (VNC через socat).
 * Контейнер→браузер: кадры режутся на лету (сырой RFB). Браузер→контейнер: байты как есть. */
export function pipeVnc(ws, stream) {
    const demux = createDemuxStream();
    const onMsg = d => { try { stream.write(Buffer.isBuffer(d) ? d : Buffer.from(d)); } catch { /* закрыт */ } };
    const onData = d => { try { ws.send(d); } catch { /* закрыт */ } };
    const onClose = () => { try { stream.destroy?.(); } catch { /* уже */ } };
    const onEnd = () => { try { ws.close?.(); } catch { /* уже */ } };
    ws.on?.('message', onMsg);
    ws.on?.('close', onClose);
    ws.on?.('error', onClose);
    demux.on('data', onData);
    demux.on('error', onEnd);
    if (typeof stream.pipe === 'function')
        stream.pipe(demux);
    else
        stream.on?.('data', c => demux.write(c));
    stream.on?.('end', onEnd);
    stream.on?.('error', onEnd);
    stream.on?.('close', onEnd);
    return () => {
        ws.off?.('message', onMsg);
        demux.off?.('data', onData);
        try { stream.unpipe?.(demux); } catch { /* уже */ }
    };
}

/** WS-обработчик VNC (вызывается из host/websocket.js до подписок на пути). */
export async function handleVncSocket(ws, req) {
    const m = String(req?.url || '').split('?')[0].match(VNC_RE);
    if (!m)
        return false;
    let params = {};
    try {
        params = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    }
    catch { /* без параметров */ }
    let acc;
    try {
        acc = await computerAccess(req, decodeURIComponent(m[1]), params.owner);
    }
    catch (e) {
        try { ws.close(4403, String(e?.message || e).slice(0, 120)); } catch { /* уже */ }
        return true;
    }
    const st = await statusOf(acc.docker, acc.id).catch(() => null);
    if (!st?.running) {
        try { ws.close(4404, 'компьютер остановлен'); } catch { /* уже */ }
        return true;
    }
    try {
        const container = acc.docker.getContainer(acc.id);
        const exec = await container.exec({
            AttachStdin: true, AttachStdout: true, AttachStderr: false, Tty: false,
            Cmd: ['socat', '-', 'TCP:127.0.0.1:5900'],
        });
        // stdin-дуплекс: promise-вариант, при неудаче — callback-вариант
        let stream;
        try {
            stream = await exec.start({ Detach: false, Tty: false, stdin: true, hijack: true });
        }
        catch {
            stream = await new Promise((resolve, reject) => exec.start({ stdin: true }, (e, s) => e ? reject(e) : resolve(s)));
        }
        pipeVnc(ws, stream);
    }
    catch (e) {
        try { ws.close(4411, 'VNC недоступен: ' + String(e?.message || e).slice(0, 100)); } catch { /* уже */ }
    }
    return true;
}

/** HTTP: страница просмотра / скриншот / takeover. Возвращает true, если путь наш. */
export async function handleComputerHttp(req, res, url, readBody) {
    const pathname = decodeURIComponent(url.pathname);
    const novnc = pathname.match(NOVNC_RE);
    if (novnc) {
        serveNovnc(res, novnc[1]);
        return true;
    }
    const m = pathname.match(PAGE_RE);
    if (!m)
        return false;
    let params = Object.fromEntries(url.searchParams);
    let acc;
    try {
        acc = await computerAccess(req, m[1], params.owner);
    }
    catch (e) {
        res.writeHead(e.http || 500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(String(e?.message || e));
        return true;
    }
    if (m[2] === '/shot.png' && req.method === 'GET') {
        try {
            const png = await screenshotPng(acc.docker, acc.id);
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'no-store' });
            res.end(png);
        }
        catch (e) {
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('скриншот недоступен: ' + String(e?.message || e).slice(0, 200));
        }
        return true;
    }
    if (m[2] === '/takeover' && req.method === 'POST') {
        let body = {};
        try {
            body = JSON.parse(String(await readBody(req, 4096)) || '{}');
        }
        catch { /* пустое тело */ }
        const take = body.take === 'agent' ? 'agent' : 'human';
        setControl(acc.id, take === 'human' ? 'human' : undefined);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ control: controlBy(acc.id) }));
        return true;
    }
    if (!m[2] && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(viewerPage(acc.name, params.owner || ''));
        return true;
    }
    return false;
}

/** Статика noVNC из node_modules (только .js внутри пакета, без выхода наружу). */
function serveNovnc(res, rel) {
    try {
        if (!/\.js$/i.test(rel)) throw new Error('только .js');
        const base = path.resolve(import.meta.dirname, '../../../node_modules/@novnc/novnc');
        const full = path.resolve(base, rel);
        if (full !== base && !full.startsWith(base + path.sep)) throw new Error('вне пакета');
        const data = fs.readFileSync(full);
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
        res.end(data);
    }
    catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('noVNC: ' + String(e?.message || e).slice(0, 120));
    }
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Страница просмотра: noVNC + кнопки управления. */
function viewerPage(name, owner) {
    const q = owner ? '?owner=' + encodeURIComponent(owner) : '';
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>Компьютер ' + esc(name) + ' — WORK</title>'
        + '<style>html,body{margin:0;height:100%;background:#111;color:#eee;font-family:system-ui,sans-serif}'
        + '#bar{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#1c1c1c;position:sticky;top:0;z-index:2}'
        + '#bar button{padding:6px 12px;border:1px solid #555;background:#2a2a2a;color:#eee;border-radius:6px;cursor:pointer}'
        + '#bar button:disabled{opacity:.4;cursor:default}#st{opacity:.8;font-size:13px}#screen{height:calc(100% - 49px)}#screen canvas{cursor:crosshair}</style></head><body>'
        + '<div id="bar"><b>Компьютер ' + esc(name) + '</b><span id="st">подключение…</span>'
        + '<button id="take">Взять управление</button><button id="give" disabled>Вернуть агенту</button>'
        + '<button id="shot">Скриншот</button></div><div id="screen"></div>'
        + '<script type="module">'
        + 'import RFB from ' + JSON.stringify('/~/lib/novnc/core/rfb.js') + ';'
        + 'const NAME=' + JSON.stringify(name) + ', Q=' + JSON.stringify(q) + ';'
        + 'const st=document.getElementById("st"), take=document.getElementById("take"), give=document.getElementById("give");'
        + 'const proto=location.protocol==="https:"?"wss:":"ws:";'
        + 'const rfb=new RFB(document.getElementById("screen"), proto+"//"+location.host+"/~computer/"+encodeURIComponent(NAME)+"/vnc"+Q, { wsProtocols:["binary"] });'
        + 'rfb.viewOnly=true; rfb.scaleViewport=true;'
        + 'rfb.addEventListener("connect",()=>{st.textContent="наблюдение (только просмотр)";});'
        + 'rfb.addEventListener("disconnect",e=>{st.textContent="отключено"+(e&&e.detail&&e.detail.clean?"":" (проверьте компьютер)");take.disabled=true;give.disabled=true;});'
        + 'async function takeover(to){'
        + ' const r=await fetch("/~computer/"+encodeURIComponent(NAME)+"/takeover"+Q,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({take:to})});'
        + ' if(!r.ok){st.textContent="ошибка: "+await r.text();return false;}'
        + ' const human=(await r.json()).control==="human";'
        + ' rfb.viewOnly=!human; take.disabled=human; give.disabled=!human;'
        + ' st.textContent=human?"вы управляете — агент ждёт":"наблюдение (только просмотр)"; return true;}'
        + 'take.onclick=()=>takeover("human"); give.onclick=()=>takeover("agent");'
        + 'document.getElementById("shot").onclick=()=>window.open("/~computer/"+encodeURIComponent(NAME)+"/shot.png"+Q,"_blank");'
        + '</script></body></html>';
}
