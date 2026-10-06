import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { closeIndexDb } from '../sources/host/index-db.js';

/**
 * restart_normal: перезапуск в обычный режим — только вошедший ADMIN корня.
 * Успешный путь (спавн помощника + exit) здесь не вызывается: он завершил бы
 * процесс тестов. Проверяются только отказы, до спавна дело не доходит.
 */

const ADMIN = 'AD00000000000001';
const USER = 'BE00000000000001';

let tmp, prevCwd;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function sessionOf(uid) {
    const s = $server.get_session();
    if (!uid)
        return s;
    $server.signIn(s, { id: uid });
    return s;
}

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-restart-'));
    write('$server/class.js', `export default { label: 'RESTART', '#security': { ADMIN: ['${ADMIN}'], USER: ['${USER}'] } }`);
    write('$server/$folder/class.js', `export default {}`);
    write('$server/$folder/$class/class.js', `export default {}`);
    write('$server/$folder/$file/class.js', `export default {}`);
    write('$server/$folder/$file/$md/class.js', `export default {}`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    closeIndexDb();
    process.chdir(prevCwd);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* занято */ }
});

describe('restart_normal: доступ', () => {
    it('без входа — отказ', async () => {
        await assert.rejects(WORK.restart_normal({}), /Доступ запрещён/);
        await assert.rejects(WORK.restart_normal({ session: {} }), /Доступ запрещён/);
    });
    it('не администратор — отказ', async () => {
        const s = sessionOf(USER);
        await assert.rejects(WORK.restart_normal({ session: s }), /Доступ запрещён/);
    });
    it('ADMIN в обычном режиме — отказ без спавна', async () => {
        const s = sessionOf(ADMIN);
        // в тестах DEV_MODE выключен — метод отказывает до запуска помощника
        await assert.rejects(WORK.restart_normal({ session: s }), /уже работает в обычном режиме/);
    });
});
