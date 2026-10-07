/**
 * Этап 8: подразделения — ссылки #security ($structure и наследники)
 * дают доступ к прикладным классам.
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

const ADMIN = 'WA000000000001', BOSS = 'WB000000000001', USER1 = 'WU000000000001', USER2 = 'WU000000000002', NOBODY = 'WN000000000001';
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
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [BOSS, 'Руководитель'], [USER1, 'Продавец'], [USER2, 'Стажёр'], [NOBODY, 'Чужой']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('BASE/direction/$structure/class.js', `export default { label: 'Направление' }`);
    write('BASE/direction/sales/$structure/class.js', `export default { label: 'Продажи',
        '#security': {
            USER: ['${USER1}'],
            BOSS: ['${BOSS}'],
            LINKS: [{ id: '/OTHER', access: 'read' }],
            ROLES: [
                { id: 'heads', label: 'Руководство', USERS: ['${USER2}'], LINKS: [{ id: '/DATA/REGISTER/62', access: 'read' }],
                    ROLES: [{ id: 'seller', label: 'Продавец', USERS: ['${USER1}'],
                        LINKS: [{ id: '/DATA/OPERATIONS', access: 'write' }] }] },
            ],
        } }`);
    write('DATA/OPERATIONS/$class/class.js', `export default { label: 'Операции', ${FIELDS} }`);
    write('DATA/REGISTER/$register/class.js', `export default { label: 'Журнал' }`);
    write('DATA/REGISTER/62/$account/class.js', `export default { label: 'Расчёты', ${FIELDS} }`);
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

describe('подразделения: ссылки #security', () => {
    it('data_access: write/read/null по ссылкам мест и общим', async () => {
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        const acc = await WORK.get_item('/DATA/REGISTER/62');
        const other = await WORK.get_item('/OTHER');
        assert.equal(await ops.data_access(as(USER1)), 'write', 'своя ссылка места');
        assert.equal(await acc.data_access(as(USER1)), null, 'ссылки вышестоящего места вниз не наследуются');
        assert.equal(await other.data_access(as(USER1)), 'read', 'общая ссылка — всем назначенным');
        assert.equal(await other.data_access(as(NOBODY)), null);
        assert.equal(await ops.data_access(as(NOBODY)), null);
        assert.equal(await ops.data_access(as(ADMIN)), 'admin');
    });

    it('вышестоящее место видит ссылки вложенных на чтение', async () => {
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        const acc = await WORK.get_item('/DATA/REGISTER/62');
        assert.equal(await ops.data_access(as(USER2)), 'read', 'heads видит OPERATIONS через seller');
        assert.equal(await acc.data_access(as(USER2)), 'read', 'своя ссылка heads');
    });

    it('BOSS видит ссылки всех мест на чтение', async () => {
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        assert.equal(await ops.data_access(as(BOSS)), 'read');
    });

    it('назначение на место даёт USER и членство', async () => {
        const sales = await WORK.get_item('/BASE/direction/sales');
        assert.deepEqual(await sales.roles(as(USER1)), ['USER']);
        assert.equal(await sales.hasLocalRole({ ...as(USER1), role: 'USER' }), true);
        const users = await sales.members({ role: 'USER' });
        assert.ok(users.some(u => u.id === USER1), 'продавец в members');
        assert.ok(users.some(u => u.id === USER2), 'руководитель в members');
    });

    it('hasSecurity в info: панель при заполненной #security', async () => {
        const sales = await WORK.get_item('/BASE/direction/sales');
        assert.equal((await sales.info({})).hasSecurity, true, 'есть ROLES, LINKS и USER');
        const other = await WORK.get_item('/OTHER');
        assert.equal((await other.info({})).hasSecurity, false, 'пусто — панели нет');
    });

    it('places: дерево мест с флагами mine и цепочками ссылок', async () => {
        const { invoke } = await import('../sources/server/access/gateway.js');
        const sales = await WORK.get_item('/BASE/direction/sales');
        const p = await invoke(sales, 'places', as(USER1));
        assert.equal(p.places.length, 1);
        assert.equal(p.places[0].mine, false);
        assert.equal(p.places[0].roles[0].id, 'seller');
        assert.equal(p.places[0].roles[0].mine, true);
        const leaves = (nodes) => (nodes || []).flatMap(n => n.children?.length ? leaves(n.children) : [n]);
        assert.deepEqual(p.commonTree.map(t => t.path), ['/OTHER']);
        assert.deepEqual(p.places[0].tree.map(t => t.path), ['/DATA']);
        assert.deepEqual(leaves(p.places[0].tree).map(t => [t.path, t.access]), [['/DATA/REGISTER/62', 'read']]);
        assert.deepEqual(leaves(p.places[0].roles[0].tree).map(t => [t.path, t.access]), [['/DATA/OPERATIONS', 'write']]);
        await assert.rejects(invoke(sales, 'places', as(NOBODY)), /Доступ запрещён/);
    });

    it('write-ссылка: создание объектов, read-ссылка: только чтение', async () => {
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        const acc = await WORK.get_item('/DATA/REGISTER/62');
        const r = await ops.create_object({ filename: 'op.data', post: { name: 'Продажа' }, ...as(USER1) });
        assert.ok(r.id);
        await assert.rejects(acc.create_object({ filename: 'p.data', post: { name: 'Проводка' }, ...as(USER1) }), /Доступ запрещён/);
        const q = await acc.query({ ...as(USER2) });
        assert.ok(Array.isArray(q), 'чтение своей read-ссылки разрешено');
        const qo = await (await WORK.get_item('/OTHER')).query(as(USER1));
        assert.ok(Array.isArray(qo), 'чтение по общей ссылке разрешено');
        await assert.rejects((await WORK.get_item('/OTHER')).create_object({ filename: 'o.data', post: { name: 'o' }, ...as(USER1) }), /Доступ запрещён/);
    });

    it('смена #security через save сразу меняет права', async () => {
        const sales = await WORK.get_item('/BASE/direction/sales');
        const acc = await WORK.get_item('/DATA/REGISTER/62');
        await assert.rejects(acc.create_object({ filename: 'x.data', post: { name: 'x' }, ...as(USER1) }), /Доступ запрещён/);
        await sales.save({ post: `{ label: 'Продажи', '#security': { USER: ['${USER1}'],
            LINKS: [{ id: '/DATA/REGISTER/62', access: 'write' }] } }`, ...as(ADMIN) });
        assert.equal(await acc.data_access(as(USER1)), 'write');
        const r = await acc.create_object({ filename: 'x.data', post: { name: 'x' }, ...as(USER1) });
        assert.ok(r.id);
        assert.equal((await sales.info({})).hasSecurity, true, 'остались USER и LINKS — панель есть');
    });
});
