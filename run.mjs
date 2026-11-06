#!/usr/bin/env node
import * as childProcess from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import * as fs from "node:fs";

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const currentDirectory = import.meta?.dirname || __dirname;

function readVersion(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))?.version ?? null;
    }
    catch (err) {
        return null;
    }
}

/**
 * Нужна ли установка зависимостей.
 * Сравниваем ВЕРСИИ, а не mtime файлов: git checkout/revert/reset (и svn update) переписывают
 * package.json и package-lock.json, из-за чего прежняя проверка по времени считала пакет
 * «устаревшим» на каждом старте, запускала `npm i --production` и завершала процесс кодом 1.
 */
function isPackageActual() {
    const nodeModules = path.join(currentDirectory, 'node_modules');
    if (!fs.existsSync(nodeModules))
        return false;
    const packageVersion = readVersion(path.join(currentDirectory, 'package.json'));
    const lockVersion = readVersion(path.join(currentDirectory, 'package-lock.json'));
    if (!packageVersion || !lockVersion)
        return false;
    return packageVersion === lockVersion;
}

if (!isPackageActual()) {
    console.log('The installation process of node.js modules is started.');
    const npmInstall = new Promise((resolve , reject) => {
        const npmProcess = childProcess.spawn('npm i --production', [], { cwd: currentDirectory, env: process.env, shell: true });
        npmProcess.on('close', (code) => {
            if (code !== 0) {
                console.log(`npm install process exited with code ${code}`);
                reject(code);
            } else {
                console.log('npm install completed successfully.');
                resolve(code);
            }
        });

        npmProcess.on('error', (err) => {
            console.error('Failed to start npm install process:', err);
            reject(err);
        });
    })
    await npmInstall;
}

/**
 * Если предыдущий экземпляр `run.mjs` остался висеть в фоне и держит порт 8001 / STUN 3478,
 * аккуратно завершаем его перед стартом нового экземпляра.
 */
async function releasePreviousInstance() {
    const pidFile = path.join(currentDirectory, '#system', 'run.pid');
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

    const port = Number(process.env.WORK_PORT || 8001);
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
        fs.mkdirSync(path.dirname(pidFile), { recursive: true });
        fs.writeFileSync(pidFile, String(process.pid), 'utf8');
    }
    catch { /* ignore */ }
}

await releasePreviousInstance();

await import('./sources/work.js');
