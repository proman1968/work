/**
 * Перезапуск dev-сервера WORK (фон, WORK_DEV=true) на порту [8011] и ожидание готовности.
 * node scripts/dev-restart.mjs [port] — pid в %TEMP%/work-dev-<port>.pid, лог — work-dev-<port>.log
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.argv[2]) || 8011;
const root = path.resolve(import.meta.dirname, '..');
const pidFile = path.join(os.tmpdir(), 'work-dev-' + port + '.pid');
const logFile = path.join(os.tmpdir(), 'work-dev-' + port + '.log');
try {
    process.kill(Number(fs.readFileSync(pidFile, 'utf8')));
}
catch { /* не было */ }
await new Promise(r => setTimeout(r, 800));
const out = fs.openSync(logFile, 'w');
const child = spawn(process.execPath, ['sources/work.js'], {
    cwd: root,
    env: { ...process.env, WORK_DEV: 'true', WORK_PORT: String(port), WORK_STUN_PORT: String(port + 1000) },
    stdio: ['ignore', out, out],
    detached: true,
    windowsHide: true,
});
child.unref();
fs.writeFileSync(pidFile, String(child.pid));
for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
        const res = await fetch('http://localhost:' + port + '/favicon.ico');
        if (res.status < 500) {
            console.log('WORK dev http://localhost:' + port + ' pid ' + child.pid);
            process.exit(0);
        }
    }
    catch { /* ещё поднимается */ }
}
console.log('не поднялся, см. ' + logFile);
process.exit(1);
