import '../sources/reactor.js';
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { $server } from '../sources/server/server.js';
import { createEnv } from '../sources/modules/agent/index.js';
import { checkPath, guarded, run } from '../sources/modules/agent/system.js';
import { osFileTools, checkTree } from '../sources/modules/agent/tools/os-files.js';
import { netTools } from '../sources/modules/agent/tools/net.js';
import { decide } from '../sources/modules/agent/permissions.js';

let tmp, root, external, previous;
function write(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }
before(async () => {
    previous = process.cwd();
    const tempRoot = path.join(process.env.TEMP || os.tmpdir(), 'opencode');
    await fsp.mkdir(tempRoot, { recursive: true });
    tmp = await fsp.mkdtemp(path.join(tempRoot, 'os-test-'));
    root = path.join(tmp, 'work'); external = path.join(tmp, 'external'); fs.mkdirSync(external);
    write(path.join(root, '$server/class.js'), `export default { '#security': { ADMINS: ['admin'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file']) write(path.join(root, p, 'class.js'), 'export default {}');
    process.chdir(root); globalThis.WORK = new $server();
});
after(async () => { await new Promise(r => setTimeout(r, 300)); process.chdir(previous); await fsp.rm(tmp, { recursive: true, force: true }); });

it('админ получает os/net, пользователь и узел — нет; wildcard субагента не расширяет доступ', async () => {
    const admin = await createEnv({ place: WORK, session: { uid: 'admin' } });
    const names = (await admin.makeTools()).map(t => t.name);
    assert.ok(names.includes('os_read') && names.includes('net_scan'));
    assert.ok(!(await admin.makeTools({ meta: { tools: '*' } })).some(t => t.system));
    assert.ok((await admin.makeTools({ meta: { tools: 'os_* net_*' } })).every(t => t.system));
    for (const session of [{ uid: 'user' }, { uid: 'admin', principal: { kind: 'node', id: 'admin' } }]) {
        const env = await createEnv({ place: WORK, session });
        assert.ok(!(await env.makeTools()).some(t => t.system));
        await assert.rejects(guarded(osFileTools)[0].run({}, { session }), /администраторам/);
    }
});
it('пути: roots/deny, WORK и ссылки/junction не обходят ограничения', async () => {
    const file = path.join(external, 'x.txt'); write(file, 'hello');
    assert.equal(checkPath(file), file);
    assert.throws(() => checkPath(path.join(root, 'x')), /дерево WORK/);
    assert.throws(() => checkPath(tmp, { write: true }), /родительскую/);
    assert.throws(() => checkPath(path.join(external, 'private.key')), /запрещено/);
    const link = path.join(external, 'shortcut');
    await fsp.symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => checkPath(path.join(link, 'not-yet-created.txt'), { write: true }), /WORK/);
    write(path.join(root, '#system/os.json'), JSON.stringify({ roots: [external], deny: [path.join(external, 'forbidden')] }));
    assert.throws(() => checkPath(path.join(tmp, 'outside.txt')), /вне разрешённых/);
    assert.throws(() => checkPath(path.join(external, 'forbidden/x')), /запрещено/);
    fs.unlinkSync(path.join(root, '#system/os.json'));
});
it('рекурсивная операция проверяет вложенные запреты до изменения данных', async () => {
    const dir = path.join(external, 'tree'); write(path.join(dir, 'ok.txt'), 'ok'); write(path.join(dir, 'private.key'), 'secret');
    await assert.rejects(checkTree(dir, { write: true }), /запрещено/);
    const del = guarded(osFileTools).find(t => t.name === 'os_delete');
    await assert.rejects(del.run({ path: dir, recursive: true }, { session: { uid: 'admin' } }), /запрещено/);
    assert.ok(fs.existsSync(path.join(dir, 'ok.txt')));
});
it('os_write/read/edit работает в разрешённой папке, os_export сохраняет бинарь', async () => {
    const ctx = { session: { uid: 'admin' }, entry: {} };
    const tools = guarded(osFileTools), tool = name => tools.find(t => t.name === name);
    const p = path.join(external, 'edit.txt');
    await tool('os_write').run({ path: p, content: 'before' }, ctx);
    await tool('os_edit').run({ path: p, old_string: 'before', new_string: 'after' }, ctx);
    assert.match(await tool('os_read').run({ path: p }, ctx), /after/);
    const binary = Buffer.from([0, 255, 128, 1]); write(path.join(root, 'test.bin'), binary); WORK.reset();
    const dest = path.join(external, 'copy.bin');
    await tool('os_export').run({ from: '/test.bin', path: dest }, ctx);
    assert.deepEqual(fs.readFileSync(dest), binary);
});
it('активный scan и shell требуют подтверждения, план их запрещает; отмена процесса работает', async () => {
    const scan = netTools.find(t => t.name === 'net_scan');
    assert.deepEqual((await decide(scan, { cidr: '127.0.0.1/32' }, { host: { mode: 'auto', allowed: new Set(['net_scan']) } })).verdict, 'ask');
    assert.equal((await decide(scan, {}, { host: { mode: 'plan' } })).verdict, 'deny');
    const result = await run(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { timeout: 50 });
    assert.equal(result.timedOut, true);
});
