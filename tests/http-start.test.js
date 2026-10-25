/**
 * Прод-стартап http-сервера (startServers, http-server.js): слушает порт из WORK_PORT,
 * отдаёт запросы, останавливается. WORK_PORT подбирается до импорта движка (свободный порт).
 */
import net from 'node:net';

const free = await new Promise(res => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
        const port = s.address().port;
        s.close(() => res(port));
    });
});
process.env.WORK_PORT = String(free);

await import('../sources/reactor.js');
const { $server } = await import('../sources/server/server.js');
const { createRequestHandler, startServers } = await import('../sources/host/http-server.js');
const { describe, it, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = (await import('node:fs')).default;
const fsp = (await import('node:fs/promises')).default;
const os = (await import('node:os')).default;
const path = (await import('node:path')).default;

let tmp, prevCwd, httpServer;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-http-'));
    write('$server/class.js', `export default { label: 'HTTPSTART' }`);
    write('$server/$folder/class.js', `export default {}`);
    write('$server/$folder/$class/class.js', `export default {}`);
    write('$server/$folder/$file/class.js', `export default {}`);
    write('$server/$folder/$file/$md/class.js', `export default {}`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
    ({ httpServer } = startServers(createRequestHandler()));
    await new Promise((res, rej) => {
        httpServer.on('listening', res);
        httpServer.on('error', rej);
    });
});

after(async () => {
    await new Promise(r => httpServer?.close(r));
    process.chdir(prevCwd);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* занято */ }
});

describe('startServers', () => {
    it('поднимает сервер на WORK_PORT и отвечает: корень — редирект, отсутствие — ошибка', async () => {
        const base = 'http://127.0.0.1:' + free + '/';
        const root = await fetch(base, { redirect: 'manual' });
        assert.equal(root.status, 302, 'корень отвечает редиректом на главную');
        assert.match(root.headers.get('location') || '', /index\.html/);
        await root.text();
        const nope = await fetch(base + 'nope');
        assert.equal(nope.status, 400, nope.status + '');
        assert.match(await nope.text(), /not found/);
    });
});
