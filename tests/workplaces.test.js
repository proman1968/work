/**
 * Этап 8: рабочие места — LINKS группы дают доступ к прикладным классам.
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

const ADMIN = 'WA000000000001', USER1 = 'WU000000000001', NOBODY = 'WN000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

const FIELDS = `METADATA: { FIELDS: [{ id: 'name', required: true }, { id: 'time', type: 'timestamp' }] }`;

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-links-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Продавец'], [NOBODY, 'Чужой']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('BASE/direction/sales/$group/class.js', `export default { label: 'Продажи',
        '#security': { USERS: ['${USER1}'] },
        LINKS: [
            { id: '/OPERATIONS', access: 'write' },
            { id: '/REGISTER/62', access: 'read' },
        ] }`);
    write('OPERATIONS/$class/class.js', `export default { label: 'Операции', ${FIELDS} }`);
    write('REGISTER/$register/class.js', `export default { label: 'Журнал' }`);
    write('REGISTER/62/$account/class.js', `export default { label: 'Расчёты', ${FIELDS} }`);
    write('OTHER/$class/class.js', `export default { label: 'Чужой класс', ${FIELDS} }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('рабочие места', () => {
    it('data_access: write/read/null по ссылкам', async () => {
        const ops = await WORK.get_item('/OPERATIONS');
        const acc = await WORK.get_item('/REGISTER/62');
        const other = await WORK.get_item('/OTHER');
        assert.equal(await ops.data_access(as(USER1)), 'write');
        assert.equal(await acc.data_access(as(USER1)), 'read');
        assert.equal(await other.data_access(as(USER1)), null);
        assert.equal(await ops.data_access(as(NOBODY)), null);
        assert.equal(await ops.data_access(as(ADMIN)), 'admin');
    });

    it('write-ссылка: создание объектов, read-ссылка: только чтение', async () => {
        const ops = await WORK.get_item('/OPERATIONS');
        const acc = await WORK.get_item('/REGISTER/62');
        const r = await ops.create_object({ filename: 'op.data', post: { name: 'Продажа' }, ...as(USER1) });
        assert.ok(r.id);
        await assert.rejects(acc.create_object({ filename: 'p.data', post: { name: 'Проводка' }, ...as(USER1) }), /Доступ запрещён/);
        const q = await acc.query({ ...as(USER1) });
        assert.ok(Array.isArray(q), 'чтение по read-ссылке разрешено');
        await assert.rejects((await WORK.get_item('/OTHER')).query(as(USER1)), /Доступ запрещён/);
    });

    it('смена LINKS через save сразу меняет права', async () => {
        const sales = await WORK.get_item('/BASE/direction/sales');
        const acc = await WORK.get_item('/REGISTER/62');
        await assert.rejects(acc.create_object({ filename: 'x.data', post: { name: 'x' }, ...as(USER1) }), /Доступ запрещён/);
        await sales.save({ post: `{ label: 'Продажи', '#security': { USERS: ['${USER1}'] }, LINKS: [
            { id: '/OPERATIONS', access: 'write' },
            { id: '/REGISTER/62', access: 'write' },
        ] }`, ...as(ADMIN) });
        assert.equal(await acc.data_access(as(USER1)), 'write');
        const r = await acc.create_object({ filename: 'x.data', post: { name: 'x' }, ...as(USER1) });
        assert.ok(r.id);
    });
});
