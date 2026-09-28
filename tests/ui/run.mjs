/**
 * UI-тесты в headless Edge/Chrome (без npm-зависимостей, кроме ws из проекта).
 * Поднимает WORK (WORK_DEV, свободный порт), открывает tests/ui/*.html (результат — window.__results),
 * затем smoke-экраны (нет исключений на странице). Нет браузера — пропуск с кодом 0.
 *   npm run test:ui   |   node tests/ui/run.mjs [--keep] [фильтр]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const filter = args.find(a => !a.startsWith('--')) || '';
const BROWSERS = [
    process.env.UI_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean);
const exe = BROWSERS.find(f => fs.existsSync(f));
if (!exe) {
    console.log('UI-тесты пропущены: нет Edge/Chrome (UI_BROWSER=путь)');
    process.exit(0);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => {
    const s = net.createServer().listen(0, () => {
        const p = s.address().port;
        s.close(() => res(p));
    });
});

// --- сервер WORK ---
const port = await freePort();
const server = spawn(process.execPath, ['sources/work.js'], {
    cwd: ROOT,
    env: { ...process.env, WORK_DEV: 'true', WORK_PORT: String(port), WORK_STUN_PORT: String(await freePort()), WORK_WATCH: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
});
let serverLog = '';
server.stdout.on('data', d => serverLog += d);
server.stderr.on('data', d => serverLog += d);
const base = 'http://localhost:' + port;
let up = false;
for (let i = 0; i < 80 && !up; i++) {
    await sleep(250);
    try { up = (await fetch(base + '/favicon.ico')).status < 500; } catch { }
}
if (!up) {
    console.error('сервер не поднялся:\n' + serverLog.slice(-2000));
    server.kill();
    process.exit(1);
}

// --- браузер (CDP) ---
const cdpPort = await freePort();
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ui-'));
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
let pageErrors = [];
ws.on('message', raw => {
    const m = JSON.parse(String(raw));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown')
        pageErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
});
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable');
await send('Page.enable');

let failed = 0, passed = 0;
const report = (ok, name, err) => {
    ok ? passed++ : failed++;
    console.log((ok ? '  ✔ ' : '  ✖ ') + name + (err ? '\n      ' + String(err).split('\n').slice(0, 4).join('\n      ') : ''));
};

// --- страницы с проверками ---
const pages = fs.readdirSync(path.join(ROOT, 'tests/ui')).filter(f => f.endsWith('.html') && f.includes(filter));
for (const file of pages) {
    console.log('▶ ' + file);
    pageErrors = [];
    await send('Page.navigate', { url: base + '/tests/ui/' + file });
    let done = false;
    for (let i = 0; i < 150 && !done; i++) {
        await sleep(200);
        done = await evaluate('!!window.__done');
    }
    const results = (await evaluate('JSON.stringify(window.__results || [])')) || '[]';
    for (const r of JSON.parse(results))
        report(r.ok, r.name, r.error);
    if (!done)
        report(false, file + ': не завершилась за 30с', pageErrors.join('\n'));
    for (const e of pageErrors)
        report(false, file + ': исключение на странице', e);
}

// --- smoke-экраны: открываются без исключений ---
const SMOKE = [
    ['проводник', '/~/handlers//explorer/index.html', 'document.querySelector("body *") && document.body.style.visibility !== "hidden"'],
    ['форма класса BASE', '/BASE/~/handlers//form/index.html', '!!document.querySelector("pages-form")'],
].filter(([name]) => name.includes(filter) || !filter || pages.length === 0);
if (!filter || SMOKE.length) {
    console.log('▶ smoke');
    for (const [name, url, ready] of SMOKE) {
        pageErrors = [];
        await send('Page.navigate', { url: base + url });
        let ok = false;
        for (let i = 0; i < 100 && !ok; i++) {
            await sleep(200);
            ok = await evaluate('(() => { try { return !!(' + ready + '); } catch { return false; } })()');
        }
        await sleep(1500);
        report(ok && !pageErrors.length, name, !ok ? 'не отрисовалось' : pageErrors.join('\n'));
    }
}

console.log(`\nUI: ${passed} прошло, ${failed} упало`);
ws.close();
browser.kill();
if (!args.includes('--keep'))
    server.kill();
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { }
process.exit(failed ? 1 : 0);
