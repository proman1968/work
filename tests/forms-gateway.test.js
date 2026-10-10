/**
 * Вызовы форм через шлюз — теми же параметрами, что шлёт браузер:
 * тело POST — в params.post, фильтры where — JSON-строкой.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { invoke } from '../sources/server/access/gateway.js';
import { closeIndexDb } from '../sources/host/index-db.js';

const ADMIN = 'GA000000000001', USER1 = 'GU000000000001';
let tmp, prev;
const sessionOf = uid => ({ uid, principal: { kind: 'user', id: uid } });
// HTTP-контекст того же происхождения (CSRF-метка браузера)
const http = { transport: 'http', request: { headers: { host: 'test', 'x-work-wsid': '1' } } };

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-gw-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Исполнитель']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('DATA/CATALOGS/$class/class.js', `export default { label: 'Справочники', '#security': { USER: ['${USER1}'] }, METADATA: { FIELDS: [
        { id: 'name', required: true }, { id: 'time', type: 'timestamp' },
    ] } }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('формы через шлюз', () => {
    let id;

    it('index открыт снаружи (было «Доступ запрещён»)', async () => {
        const cat = await WORK.get_item('/DATA/CATALOGS');
        const res = await invoke(cat, 'index', { id: 'table', session: sessionOf(USER1) }, http);
        assert.ok(Array.isArray(res.rows));
    });

    it('create/update/read/delete телом POST в params.post', async () => {
        const cat = await WORK.get_item('/DATA/CATALOGS');
        const created = await invoke(cat, 'create_object', { post: { name: 'Альфа' }, session: sessionOf(USER1) }, http);
        assert.ok(created.id);
        id = created.id;
        const one = await invoke(cat, 'read_object', { id, session: sessionOf(USER1) }, http);
        assert.equal(one.body.name, 'Альфа');
        await invoke(cat, 'update_object', { id, post: { name: 'Бета' }, session: sessionOf(USER1) }, http);
        const back = await invoke(cat, 'read_object', { id, session: sessionOf(USER1) }, http);
        assert.equal(back.body.name, 'Бета');
    });

    it('query с where строкой фильтрует', async () => {
        const cat = await WORK.get_item('/DATA/CATALOGS');
        const all = await invoke(cat, 'query', { session: sessionOf(USER1) }, http);
        assert.equal(all.length, 1);
        const none = await invoke(cat, 'query', { where: JSON.stringify({ name: 'Нетакого' }), session: sessionOf(USER1) }, http);
        assert.equal(none.length, 0);
        const some = await invoke(cat, 'query', { where: JSON.stringify({ name: { like: 'ет' } }), session: sessionOf(USER1) }, http);
        assert.equal(some.length, 1);
    });

    it('read_link и удаление через шлюз', async () => {
        const cat = await WORK.get_item('/DATA/CATALOGS');
        const one = await invoke(cat, 'read_link', { catalog: '/DATA/CATALOGS', id, session: sessionOf(USER1) }, http);
        assert.equal(one.name, 'Бета');
        await invoke(cat, 'delete_object', { id, session: sessionOf(USER1) }, http);
        const gone = await invoke(cat, 'query', { session: sessionOf(USER1) }, http);
        assert.equal(gone.length, 0);
    });
});
