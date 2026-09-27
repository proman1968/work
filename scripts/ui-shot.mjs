/**
 * Скриншот страницы WORK через headless Edge/Chrome (CDP) + консоль и исключения страницы.
 * node scripts/ui-shot.mjs <url> <out.png> [width] [height] [waitMs] [js-перед-снимком]
 * Инструмент разработчика UI (не часть сервера).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [url, out = 'shot.png', w = '1280', h = '900', waitMs = '6000', js = ''] = process.argv.slice(2);
const browsers = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const exe = browsers.find(b => fs.existsSync(b));
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-shot-'));
const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = list.find(t => t.type === 'page');
    }
    catch { /* ещё не поднялся */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise(r => ws.once('open', r));
let seq = 0;
const pending = new Map();
ws.on('message', raw => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
        return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
        if (msg.params.type === 'error' || msg.params.type === 'warning')
            console.log('[console.' + msg.params.type + ']', text.slice(0, 500));
    }
    if (msg.method === 'Runtime.exceptionThrown')
        console.log('[exception]', (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || '').slice(0, 800));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')
        console.log('[log]', msg.params.entry.text.slice(0, 300), msg.params.entry.url || '');
});
const send = (method, params = {}) => new Promise(r => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(+waitMs);
// CLICK="x,y[;x,y…]" — клики мышью перед снимком (закрытые shadow root недоступны из js)
for (const pt of String(process.env.CLICK || '').split(';').filter(Boolean)) {
    const [x, y] = pt.split(',').map(Number);
    for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await sleep(Number(process.env.CLICK_WAIT) || 4000);
}
// TYPE="текст" — ввести в сфокусированное поле и нажать Enter (после CLICK); ждать TYPE_WAIT мс
if (process.env.TYPE) {
    await send('Input.insertText', { text: process.env.TYPE });
    await sleep(300);
    for (const type of ['keyDown', 'keyUp'])
        await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await sleep(Number(process.env.TYPE_WAIT) || 8000);
}
if (js) {
    const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    console.log('[eval]', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? r.result).slice(0, 2000));
    await sleep(1500);
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out);
ws.close();
proc.kill();
process.exit(0);
