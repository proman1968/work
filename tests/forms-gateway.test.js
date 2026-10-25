/**
 * Вызовы форм через шлюз — теми же параметрами, что шлёт браузер:
 * тело POST — в params.post (JSON-строкой), флаги и версия — строками, where — JSON-строкой.
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
import { closeDataDb } from '../sources/data/db.js';

const ROOT = path.resolve(import.meta.dirname, '..');
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
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Исполнитель']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    for (const rel of ['DATA/$class/class.js', 'DATA/CATALOGS/$catalog/$folder/$class/$catalog/class.js'])
        write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
    write('DATA/CATALOGS/$catalog/class.js', `export default { label: 'Справочники', '#security': { USER: ['${USER1}'] }, METADATA: { FIELDS: [
        { id: 'name', required: true },
    ] } }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    await closeDataDb();
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('формы через шлюз', () => {
    let id;
    const call = async (method, params) => invoke(await WORK.get_item('/DATA/CATALOGS'), method, { ...params, session: sessionOf(USER1) }, http);

    it('db_create / db_read / db_update телом POST в params.post, версия строкой', async () => {
        const created = await call('db_create', { post: JSON.stringify({ name: 'Альфа' }) });
        assert.ok(created.id);
        assert.equal(created.author, USER1);
        id = created.id;
        assert.equal((await call('db_read', { id })).body.name, 'Альфа');
        const upd = await call('db_update', { id, replace: 'true', version: String(created.version), post: JSON.stringify({ name: 'Бета' }) });
        assert.equal(upd.version, created.version + 1);
        assert.equal((await call('db_read', { id })).title, 'Бета');
        await assert.rejects(call('db_update', { id, version: String(created.version), post: JSON.stringify({ name: 'Гамма' }) }), /верси/,
            'чужая правка: устаревшая версия');
    });

    it('db_query с where и поиском строкой', async () => {
        assert.equal((await call('db_query', {})).items.length, 1);
        assert.equal((await call('db_query', { where: JSON.stringify({ name: 'Нетакого' }) })).items.length, 0);
        assert.equal((await call('db_query', { search: 'бет' })).items.length, 1);
    });

    it('db_delete через шлюз; старые файловые методы закрыты', async () => {
        await call('db_delete', { id });
        assert.equal((await call('db_query', {})).items.length, 0);
        for (const old of ['create_object', 'read_object', 'query', 'read_link', 'index'])
            await assert.rejects(call(old, {}), /.+/, old);
    });
});
