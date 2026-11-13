#!/usr/bin/env node
/**
 * Точка запуска лицензионного сервера и лендинга ПАК WORK (work.odant.org).
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import * as childProcess from 'node:child_process';
import { createLicenseServerApp } from '../src/server.js';
import { resolvePersistentDataDir } from '../src/store.js';

const port = Number(process.env.PORT || process.env.WORK_LICENSE_PORT || 8020);
const dataDir = resolvePersistentDataDir();

async function releasePreviousInstance() {
    const pidFile = path.join(dataDir, 'run.pid');
    try {
        if (fs.existsSync(pidFile)) {
            const oldPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
            if (Number.isInteger(oldPid) && oldPid > 0 && oldPid !== process.pid) {
                try {
                    process.kill(oldPid);
                    for (let i = 0; i < 15; i++) {
                        await new Promise(r => setTimeout(r, 100));
                        try { process.kill(oldPid, 0); }
                        catch { break; }
                    }
                }
                catch { /* процесс уже завершён */ }
            }
        }
    }
    catch { /* ignore */ }

    const isPortBusy = () => new Promise((resolve) => {
        const sock = net.createConnection({ host: '127.0.0.1', port });
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('error', () => { sock.destroy(); resolve(false); });
    });

    if (await isPortBusy() && process.platform === 'win32') {
        try {
            const out = childProcess.execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            for (const line of out.split(/\r?\n/)) {
                const m = line.trim().match(/LISTENING\s+(\d+)$/i);
                const pid = m ? Number(m[1]) : 0;
                if (pid && pid !== process.pid) {
                    try { process.kill(pid); } catch { /* ignore */ }
                }
            }
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 100));
                if (!(await isPortBusy()))
                    break;
            }
        }
        catch { /* ignore */ }
    }

    try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(pidFile, String(process.pid), 'utf8');
    }
    catch { /* ignore */ }
}

await releasePreviousInstance();

const app = createLicenseServerApp({ dataDir, autoRecover: true });
const server = await app.listen(port);
const addr = server.address();
const actualPort = typeof addr === 'object' && addr ? addr.port : port;
const counts = app.store.getStoreCounts();
console.log(`[work.odant.org] Витрина ODANT-WORK: http://localhost:${actualPort}/`);
console.log(`[work.odant.org] Панель администратора: http://localhost:${actualPort}/admin`);
console.log(`[work.odant.org] Постоянная база данных: ${app.store.stateFile} (пользователей: ${counts.users}, серверов/лицензий: ${counts.licenses}, заказов: ${counts.orders})`);
