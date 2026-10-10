/**
 * Замер загрузки дерева проводника: сколько HTTP-запросов уходит на старте и по каким видам.
 * Поднимает WORK (WORK_DEV), открывает проводник в headless Edge/Chrome, ждёт тишины сети.
 *   node tests/perf/tree-load.mjs [--max=N]   — с --max падает, если запросов больше N
 * Вид запроса: `?метод` или `@свойство` из пути (путь класса отбрасывается).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';

const ROOT = path.resolve(import.meta.dirname, '../..');
const maxArg = process.argv.find(a => a.startsWith('--max='));
const MAX = maxArg ? Number(maxArg.slice(6)) : null;
const BROWSERS = [
    process.env.UI_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean);
const exe = BROWSERS.find(f => fs.existsSync(f));
if (!exe) {
    console.log('замер пропущен: нет Edge/Chrome (UI_BROWSER=путь)');
    process.exit(0);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => {
    const s = net.createServer().listen(0, () => {
        const p = s.address().port;
        s.close(() => res(p));
    });
});

const port = await freePort();
const server = spawn(process.execPath, ['sources/work.js'], {
    cwd: ROOT,
    env: { ...process.env, WORK_DEV: 'true', WORK_PORT: String(port), WORK_STUN_PORT: String(await freePort()), WORK_WATCH: '0' },
    stdio: 'ignore',
    windowsHide: true,
});
const base = 'http://localhost:' + port;
let up = false;
for (let i = 0; i < 80 && !up; i++) {
    await sleep(250);
    try { up = (await fetch(base + '/favicon.ico')).status < 500; } catch { }
}
if (!up) {
    console.error('сервер не поднялся');
    server.kill();
    process.exit(1);
}

const cdpPort = await freePort();
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'work-perf-'));
const browser = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${prof}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find(t => t.type === 'page'); } catch { }
}
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise(r => ws.once('open', r));
let seq = 0;
const pending = new Map();
const reqs = new Map();
let lastActivity = Date.now();
ws.on('message', raw => {
    const m = JSON.parse(String(raw));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Network.requestWillBeSent') {
        const u = new URL(m.params.request.url);
        if (u.origin !== base)
            return;
        reqs.set(m.params.requestId, { path: decodeURIComponent(u.pathname), search: u.search, t0: m.params.timestamp });
        lastActivity = Date.now();
    }
    else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
        const r = reqs.get(m.params.requestId);
        if (r) {
            r.t1 = m.params.timestamp;
            lastActivity = Date.now();
        }
    }
});
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.enable');

const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
// Без входа страница уходит на публичный экран. Харнесс подставляет WORK.uid ещё до скриптов
// (на сервере WORK_DEV права отключены), чтобы проводник нарисовал дерево как у вошедшего.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    let w;
    Object.defineProperty(window, 'WORK', { configurable: true, get: () => w, set(v) {
        w = v;
        try { Object.defineProperty(v, 'uid', { configurable: true, get: () => 'PERF', set() {} }); } catch {}
    } });
})()` });
const t0 = Date.now();
await send('Page.navigate', { url: base + '/~/handlers//explorer/index.html' });
for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await evaluate('!!(window.explorer && window.explorer.left_drawer)'))
        break;
}
const tOpen = Date.now();
// дерево тянется долго: ждём 2 с полной тишины, но не больше 40 с
lastActivity = Date.now();
while (Date.now() - lastActivity < 2000 && Date.now() - tOpen < 40000)
    await sleep(250);
const settled = lastActivity - tOpen;

const kindOf = (r) => {
    const at = r.path.match(/\/@([^/]+)$/);
    if (at) return '@' + at[1];
    const q = r.search.replace(/^\?/, '').split('&')[0].split('=')[0];
    if (/\.(js|css|svg|png|ico|json|html|woff2?|wav|jpg|jpeg|webp)$/i.test(r.path)) return 'статика';
    return q ? '?' + q : 'GET';
};
const byKind = {};
for (const r of reqs.values()) {
    const k = kindOf(r);
    const dur = r.t1 ? (r.t1 - r.t0) * 1000 : 0;
    const e = byKind[k] ||= { n: 0, ms: 0, max: 0 };
    e.n++;
    e.ms += dur;
    e.max = Math.max(e.max, dur);
}
const total = reqs.size;
const data = Object.entries(byKind).filter(([k]) => k !== 'статика');
const dataTotal = data.reduce((s, [, e]) => s + e.n, 0);
console.log(`запросов всего: ${total}, не статика: ${dataTotal}, загрузка до тишины: ${(settled / 1000).toFixed(1)} с`);
for (const [k, e] of data.sort((a, b) => b[1].n - a[1].n).slice(0, 15))
    console.log('  ' + k.padEnd(18), String(e.n).padStart(4), 'шт  среднее', (e.ms / e.n).toFixed(0).padStart(5), 'мс  макс', e.max.toFixed(0).padStart(5), 'мс');

// самые частые пути (повторы одного и того же)
const byPath = {};
for (const r of reqs.values())
    byPath[r.path + r.search] = (byPath[r.path + r.search] || 0) + 1;
const dups = Object.entries(byPath).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
console.log(`повторов одного URL: ${dups.reduce((s, [, n]) => s + n - 1, 0)} (уникальных с повтором: ${dups.length})`);
for (const [p, n] of dups.slice(0, 8))
    console.log('  ×' + n, p.slice(0, 90));

// что нарисовано: узлы дерева, у скольких есть стрелка, и сверка стрелки с реальными детьми
const drawExpr = `(async () => { try {
    const find = (root) => {
        for (const el of root.querySelectorAll('*')) {
            if (el.localName === 'item-tree') return el;
            const r = el.__shadowRoot__ && find(el.__shadowRoot__);
            if (r) return r;
        }
        return null;
    };
    const tree = find(document);
    if (!tree) return JSON.stringify({ nodes: 0 });
    const all = [];
    const collect = (root) => {
        for (const n of root.querySelectorAll('oda-tree-node')) {
            all.push(n);
            if (n.__shadowRoot__) collect(n.__shadowRoot__);
        }
    };
    collect(tree.__shadowRoot__);
    let arrows = 0, wrong = [];
    for (const n of all) {
        const icon = await n.expanderIcon;
        const it = n.$item;
        if (icon) arrows++;
        const flag = it?.DATA?.hasItems;
        if (typeof flag === 'boolean' && !!icon !== flag) wrong.push(it.path);
    }
    return JSON.stringify({ nodes: all.length, arrows, wrong });
} catch (e) { return JSON.stringify({ nodes: 0, error: String(e && e.message || e) }); } })()`;
const drawnRaw = await evaluate(drawExpr);
let drawn = {};
try { drawn = JSON.parse(drawnRaw || '{}'); } catch { drawn = { error: String(drawnRaw) }; }
if (drawn.error)
    console.log('сверка дерева не удалась: ' + drawn.error);
console.log(`нарисовано узлов: ${drawn.nodes}, со стрелкой: ${drawn.arrows}${drawn.wrong?.length ? ', стрелка расходится с hasItems: ' + drawn.wrong.join(', ') : ''}`);

// --expand: раскрыть всё видимое со стрелкой (2 прохода) и посчитать запросы раскрытия
if (process.argv.includes('--expand')) {
    const before = reqs.size;
    for (let round = 0; round < 2; round++) {
        await evaluate(`(async () => {
            const find = (root) => {
                for (const el of root.querySelectorAll('*')) {
                    if (el.localName === 'item-tree') return el;
                    const r = el.__shadowRoot__ && find(el.__shadowRoot__);
                    if (r) return r;
                }
                return null;
            };
            const all = [];
            const collect = (root) => {
                for (const n of root.querySelectorAll('oda-tree-node')) {
                    all.push(n);
                    if (n.__shadowRoot__) collect(n.__shadowRoot__);
                }
            };
            collect(find(document).__shadowRoot__);
            for (const n of all)
                if (await n.expanderIcon && !n.expanded) n.expanded = true;
        })()`);
        lastActivity = Date.now();
        while (Date.now() - lastActivity < 1500)
            await sleep(200);
    }
    const added = [...reqs.values()].slice(before);
    const kinds = {};
    for (const r of added) {
        const k = kindOf(r);
        if (k !== 'статика')
            kinds[k] = (kinds[k] || 0) + 1;
    }
    const after = JSON.parse(await evaluate(drawExpr) || '{}');
    console.log(`раскрытие: +${Object.values(kinds).reduce((s, n) => s + n, 0)} запросов (${Object.entries(kinds).map(([k, n]) => k + '×' + n).join(', ')}), узлов ${after.nodes}, со стрелкой ${after.arrows}${after.wrong?.length ? ', расхождения: ' + after.wrong.join(', ') : ''}`);
}

if (process.argv.includes('--paths')) {
    for (const r of reqs.values())
        if (/\/@items$/.test(r.path))
            console.log('  @items', r.path, ((r.t1 - r.t0) * 1000).toFixed(0), 'мс');
}
const hits = JSON.parse(await evaluate('JSON.stringify(window.WORK?.emptyHits || {})') || '{}');
const hitList = Object.entries(hits).sort((a, b) => b[1] - a[1]);
if (hitList.length)
    console.log('свойства элементов, ушедшие на сервер (_onEmpty): ' + hitList.slice(0, 10).map(([k, n]) => `${k}×${n}`).join(', '));

ws.close();
browser.kill();
server.kill();
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { }
if (MAX != null && dataTotal > MAX) {
    console.error(`ПРЕВЫШЕНИЕ: ${dataTotal} запросов данных > ${MAX}`);
    process.exit(1);
}
process.exit(0);
