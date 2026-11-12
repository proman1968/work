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
 * 1) Проверяем, разрешаются ли все dependencies из package.json через import.meta.resolve
 *    (учитывает как локальный node_modules, так и поднятый родительский node_modules при установке через npm/npx).
 * 2) Если рядом есть package-lock.json (репозиторий Git/SVN), дополнительно сверяем версии package.json и package-lock.json.
 */
function isPackageActual() {
    try {
        const pkgFile = path.join(currentDirectory, 'package.json');
        if (!fs.existsSync(pkgFile))
            return false;
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
        const deps = Object.keys(pkg.dependencies || {});
        for (const dep of deps) {
            try {
                import.meta.resolve(dep);
            }
            catch {
                return false;
            }
        }
        const lockFile = path.join(currentDirectory, 'package-lock.json');
        if (fs.existsSync(lockFile)) {
            const lockVersion = readVersion(lockFile);
            if (pkg.version && lockVersion && pkg.version !== lockVersion)
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
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

const workRoot = path.resolve(process.cwd());
const pkgRoot = path.resolve(currentDirectory);

/**
 * Если запуск выполнен через `npx odant-work` или из `node_modules/odant-work` в рабочей папке (например, D:\WORK),
 * автоматически разворачиваем или безопасно обновляем рабочую директорию из установленного пакета.
 */
if (workRoot !== pkgRoot) {
    const pkgVersion = readVersion(path.join(pkgRoot, 'package.json'));
    const manifestVersion = readVersion(path.join(workRoot, '#system', 'package-manifest.json'));
    const hasServerTree = fs.existsSync(path.join(workRoot, '$server', '$folder'));
    if (!hasServerTree || (pkgVersion && manifestVersion !== pkgVersion)) {
        const { applyUpdateFromDirectory } = await import('./sources/host/auto-updater.js');
        const report = applyUpdateFromDirectory({
            sourceDir: pkgRoot,
            rootDir: workRoot,
            newVersion: pkgVersion || '',
        });
        console.log(`[WORK] Рабочая директория синхронизирована с пакетом odant-work@${report.toVersion} (${workRoot})`);
    }
}

/**
 * При первом запуске в чистой папке автоматически засеваем демонстрационную базу Маслоторг,
 * если класс организации присутствует, а файла work.db ещё нет.
 */
const maslotorgClass = path.join(workRoot, 'ORGANIZATIONS', 'Маслоторг', '$base', 'class.js');
const maslotorgDb = path.join(workRoot, 'ORGANIZATIONS', 'Маслоторг', '$base', '#system', 'work.db');
if (!process.env.WORK_TEST && fs.existsSync(maslotorgClass) && !fs.existsSync(maslotorgDb)) {
    try {
        const { openDataDb } = await import('./sources/data/db.js');
        const { refreshClasses } = await import('./sources/data/classes.js');
        const { queryObjects } = await import('./sources/data/objects.js');
        const { seedDemo, seedDemoOperations } = await import('./scripts/demo-seed.mjs');
        const prefix = '/ORGANIZATIONS/Маслоторг/MODULES/Register';
        const orgBase = '/ORGANIZATIONS/Маслоторг';
        const db = await openDataDb(maslotorgDb);
        await refreshClasses(db, workRoot);
        if (!queryObjects(db, { cid: `${prefix}/CATALOGS/Виды нормативов`, limit: 1 }).total) {
            const ids = seedDemo(db, { prefix });
            seedDemoOperations(db, ids, { prefix, orgBase });
            console.log('[WORK] Инициализирована демонстрационная база данных /ORGANIZATIONS/Маслоторг.');
        }
        db.close();
    }
    catch (err) {
        console.warn('[WORK] Не удалось засеять демо-базу Маслоторг:', err?.message || err);
    }
}

/**
 * Если предыдущий экземпляр `run.mjs` остался висеть в фоне и держит порт 8001 / STUN 3478,
 * аккуратно завершаем его перед стартом нового экземпляра.
 */
async function releasePreviousInstance() {
    const pidFile = path.join(workRoot, '#system', 'run.pid');
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
