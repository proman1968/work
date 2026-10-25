/**
 * Агент-«мост» для управления настоящим компьютером пользователя из WORK (9.12):
 *
 *   node scripts/work-desktop-bridge.mjs --server http://localhost:8001 --token wmcp.<uid>.<секрет> [--root ./work-dir] [--readonly] [--apps notepad,calc]
 *
 * Подключается к серверу WORK по HTTP (/~bridge/*) с персональным токеном пользователя:
 *   - не требует открывать входящие порты на компьютере пользователя;
 *   - ограничивает файловые операции папкой --root (по умолчанию текущая папка);
 *   - при флаге --readonly (или переключении в WORK) жёстко блокирует запись файлов, запуск программ и смену окон;
 *   - запускает только программы из --apps (через spawn с shell:false).
 */
import os from 'node:os';
import path from 'node:path';
import { executeLocalBridgeOp } from '../sources/modules/bridge/hub.js';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };

const serverUrl = String(opt('server') || process.env.WORK_SERVER || 'http://localhost:8001').replace(/\/+$/, '');
const token = String(opt('token') || process.env.WORK_MCP_TOKEN || '').trim();
const rootDir = path.resolve(opt('root') || process.cwd());
const initialReadOnly = args.includes('--readonly');
const allowedApps = String(opt('apps') || '').split(',').map(s => s.trim()).filter(Boolean);
const once = args.includes('--once');

if (!token) {
    console.error('Использование: node scripts/work-desktop-bridge.mjs --server <URL> --token <wmcp...> [--root <папка>] [--readonly] [--apps notepad,calc]');
    process.exit(2);
}

const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'application/json',
};

const cfg = {
    hostname: os.hostname(),
    platform: process.platform,
    rootDir,
    readOnly: initialReadOnly,
    allowedApps,
};

async function register() {
    const res = await fetch(serverUrl + '/~bridge/register', {
        method: 'POST',
        headers,
        body: JSON.stringify(cfg),
    });
    if (!res.ok)
        throw new Error('register HTTP ' + res.status + ': ' + await res.text());
    return res.json();
}

async function pollOnce() {
    const res = await fetch(serverUrl + '/~bridge/poll', { method: 'GET', headers });
    if (!res.ok)
        throw new Error('poll HTTP ' + res.status);
    const data = await res.json();
    if (typeof data.readOnly === 'boolean')
        cfg.readOnly = initialReadOnly || data.readOnly; // локальный --readonly нельзя снять с сервера
    const cmd = data.command;
    if (!cmd)
        return false;
    try {
        const result = await executeLocalBridgeOp(cfg, cmd);
        await fetch(serverUrl + '/~bridge/result', {
            method: 'POST',
            headers,
            body: JSON.stringify({ id: cmd.id, result }),
        });
    }
    catch (e) {
        await fetch(serverUrl + '/~bridge/result', {
            method: 'POST',
            headers,
            body: JSON.stringify({ id: cmd.id, error: String(e?.message || e) }),
        });
    }
    return true;
}

const reg = await register();
console.log('Мост WORK подключён: id=' + reg.id + ', папка=' + rootDir + ', режим=' + (cfg.readOnly ? 'readOnly' : 'actions'));
if (once) {
    await pollOnce();
    process.exit(0);
}
while (true) {
    try {
        const had = await pollOnce();
        if (!had)
            await new Promise(r => setTimeout(r, 1500));
    }
    catch (e) {
        console.warn('[bridge]', e?.message || e);
        await new Promise(r => setTimeout(r, 5000));
        await register().catch(() => {});
    }
}
