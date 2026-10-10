/**
 * Этап 7: поле-ссылка Link — проверка при записи, read_link.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { closeIndexDb } from '../sources/host/index-db.js';

const ADMIN = 'LA000000000001', USER1 = 'LU000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-link-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Исполнитель']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('DATA/CATALOGS/$class/class.js', `export default { label: 'Справочники', '#security': { USER: ['${USER1}'] } }`);
    write('DATA/CATALOGS/ITEMS/$class/class.js', `export default { label: 'Товары', '#security': { USER: ['${USER1}'] }, METADATA: { FIELDS: [
        { id: 'name', required: true }, { id: 'time', type: 'timestamp' },
    ] } }`);
    write('DATA/CATALOGS/TREE/$class/class.js', `export default { label: 'Дерево', '#security': { USER: ['${USER1}'] } }`);
    write('DATA/CATALOGS/TREE/SUB/$class/class.js', `export default { label: 'Ветка', '#security': { USER: ['${USER1}'] }, METADATA: { FIELDS: [
        { id: 'name', required: true }, { id: 'time', type: 'timestamp' },
    ] } }`);
    write('DATA/OPERATIONS/$class/class.js', `export default { label: 'Операции', '#security': { USER: ['${USER1}'] }, METADATA: { FIELDS: [
        { id: 'name', required: true }, { id: 'time', type: 'timestamp' },
        { id: 'ref', type: 'Link', catalog: '/DATA/CATALOGS/ITEMS', label: 'Ссылка' },
        { id: 'sub', type: 'Link', catalog: '/DATA/CATALOGS/TREE', label: 'Ветка' },
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

describe('поле Link', () => {
    let itemId, subId;

    it('create: ссылка на объект проходит, на мусор — нет', async () => {
        const items = await WORK.get_item('/DATA/CATALOGS/ITEMS');
        const r = await items.create_object({ filename: 't1.data', post: { name: 'Товар' }, ...as(USER1) });
        itemId = r.id;
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        const ok = await ops.create_object({ filename: 'o1.data', post: { name: 'Оп', ref: itemId }, ...as(USER1) });
        assert.ok(ok.id);
        await assert.rejects(
            ops.create_object({ filename: 'o2.data', post: { name: 'Оп2', ref: '1.NOPE' }, ...as(USER1) }),
            /нет объекта/);
        const noRef = await ops.create_object({ filename: 'o3.data', post: { name: 'Без ссылки' }, ...as(USER1) });
        assert.ok(noRef.id, 'пустая ссылка разрешена');
    });

    it('ссылка на объект подкласса проходит', async () => {
        const sub = await WORK.get_item('/DATA/CATALOGS/TREE/SUB');
        const r = await sub.create_object({ filename: 's1.data', post: { name: 'Подтовар' }, ...as(USER1) });
        subId = r.id;
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        const ok = await ops.create_object({ filename: 'o4.data', post: { name: 'Оп4', sub: subId }, ...as(USER1) });
        assert.ok(ok.id);
    });

    it('read_link возвращает имя', async () => {
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        const one = await ops.read_link({ catalog: '/DATA/CATALOGS/ITEMS', id: itemId, ...as(USER1) });
        assert.equal(one.name, 'Товар');
        assert.equal(one.id, itemId);
        await assert.rejects(ops.read_link({ catalog: '/DATA/CATALOGS/ITEMS', id: '1.NOPE', ...as(USER1) }), /нет объекта/);
        await assert.rejects(ops.read_link({ catalog: '/NOPE', id: itemId, ...as(USER1) }), /нет справочника/);
    });
});
