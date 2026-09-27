/**
 * Замер загрузки страницы WORK в headless Edge: первое открытие (холодный кэш браузера) и повторное (тёплый).
 * node scripts/ui-timing.mjs <url> [ждатьМс=15000] → ms до готовности (нет запросов 1.5с), число запросов, 304, топ медленных.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [url, waitMs = '15000'] = process.argv.slice(2);
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(f => fs.existsSync(f));
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-timing-'));
const proc = spawn(exe, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { }
}
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise(r => ws.once('open', r));
let seq = 0, last = Date.now();
const pending = new Map(), reqs = new Map();
let stats;
ws.on('message', raw => {
    const m = JSON.parse(String(raw));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (!stats) return;
    if (m.method === 'Network.requestWillBeSent') { reqs.set(m.params.requestId, { url: m.params.request.url, t: m.params.timestamp }); last = Date.now(); }
    if (m.method === 'Network.responseReceived') { const r = reqs.get(m.params.requestId); if (r) r.status = m.params.response.status; }
    if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
        const r = reqs.get(m.params.requestId);
        if (r) { r.ms = Math.round((m.params.timestamp - r.t) * 1000); stats.done.push(r); }
        last = Date.now();
    }
});
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Network.enable');
async function run(label) {
    stats = { done: [] };
    reqs.clear();
    const t0 = Date.now();
    last = t0;
    await send('Page.navigate', { url });
    while (Date.now() - last < 1500 && Date.now() - t0 < +waitMs)
        await sleep(100);
    const total = last - t0;
    const s304 = stats.done.filter(r => r.status === 304).length;
    const slow = stats.done.sort((a, b) => b.ms - a.ms).slice(0, 5).map(r => r.ms + 'ms ' + decodeURIComponent(r.url.replace(/^https?:\/\/[^/]+/, '')).slice(0, 90));
    console.log(label + ': ' + total + 'мс, запросов ' + stats.done.length + ', 304: ' + s304 + '\n  ' + slow.join('\n  '));
}
await run('холодно');
await run('тепло ');
ws.close();
proc.kill();
process.exit(0);
