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
import { closeDataDb } from '../sources/data/db.js';
import { invoke } from '../sources/server/access/gateway.js';

const ADMIN = 'WA000000000001', BOSS = 'WB000000000001', USER1 = 'WU000000000001', USER2 = 'WU000000000002', NOBODY = 'WN000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

const FIELDS = `METADATA: { FIELDS: [{ id: 'name', required: true }] }`;

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
    write('DATA/OPERATIONS/$operation/class.js', `export default { label: 'Операции', ${FIELDS} }`);
    write('DATA/REGISTER/$register/class.js', `export default { label: 'Журнал' }`);
    write('DATA/REGISTER/62/$account/class.js', `export default { label: 'Расчёты' }`);
    write('OTHER/$class/class.js', `export default { label: 'Чужой класс', ${FIELDS} }`);
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

    it('write-ссылка: создание объектов, read-ссылка: только чтение (учётное ядро)', async () => {
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        const r = await invoke(ops, 'db_create', { post: { name: 'Продажа' }, ...as(USER1) });
        assert.equal(r.author, USER1);
        await assert.rejects(invoke(ops, 'db_create', { post: { name: 'Чужая' }, ...as(USER2) }), /Доступ запрещён/, 'read — без записи');
        assert.equal((await invoke(ops, 'db_query', as(USER2))).items.length, 1, 'чтение по ссылке вложенного места');
        const acc = await WORK.get_item('/DATA/REGISTER/62');
        assert.equal((await invoke(acc, 'db_journal', as(USER2))).total, 0, 'своя read-ссылка');
        await assert.rejects(invoke(acc, 'db_journal', as(USER1)), /Доступ запрещён/, 'ссылки вышестоящего места вниз не наследуются');
    });

    it('смена #security через save сразу меняет права', async () => {
        const sales = await WORK.get_item('/BASE/direction/sales');
        const acc = await WORK.get_item('/DATA/REGISTER/62');
        await sales.save({ post: `{ label: 'Продажи', '#security': { USER: ['${USER1}'],
            LINKS: [{ id: '/DATA/REGISTER/62', access: 'write' }] } }`, ...as(ADMIN) });
        assert.equal(await acc.data_access(as(USER1)), 'write');
        assert.equal((await invoke(acc, 'db_journal', as(USER1))).total, 0);
        assert.equal((await sales.info({})).hasSecurity, true, 'остались USER и LINKS — панель есть');
    });

    it('каркас подразделений (isStructureAncestor) и скрытие MODULES от обычного сотрудника', async () => {
        write('ORGANIZATIONS/$domain/class.js', `export default { label: 'Организации' }`);
        write('ORGANIZATIONS/ORG1/$base/class.js', `export default { label: 'Орг 1', '#security': { ADMIN: ['${ADMIN}'] } }`);
        write('ORGANIZATIONS/ORG1/MODULES/$domain/class.js', `export default { label: 'Модули' }`);
        write('ORGANIZATIONS/ORG1/MODULES/Reg/$module/class.js', `export default { label: 'Учёт' }`);
        write('ORGANIZATIONS/ORG1/MODULES/Reg/ITEMS/$catalog/class.js', `export default { label: 'Номенклатура', ${FIELDS} }`);
        write('ORGANIZATIONS/ORG1/warehouse/$structure/class.js', `export default { label: 'Склад',
            '#security': { ROLES: [{ id: 'keeper', label: 'Кладовщик', USERS: ['${USER2}'],
                LINKS: [{ id: '/ORGANIZATIONS/ORG1/MODULES/Reg/ITEMS', access: 'read' }] }] } }`);
        write('ORGANIZATIONS/ORG1/secret_dept/$structure/class.js', `export default { label: 'Секретный отдел',
            '#security': { ADMIN: ['${ADMIN}'] } }`);
        globalThis.WORK.reset();
        const LINKS = await import('../sources/server/access/links.js');
        LINKS.reset();

        const orgs = await WORK.get_item('/ORGANIZATIONS');
        const org1 = await WORK.get_item('/ORGANIZATIONS/ORG1');
        const wh = await WORK.get_item('/ORGANIZATIONS/ORG1/warehouse');
        const secDept = await WORK.get_item('/ORGANIZATIONS/ORG1/secret_dept');
        const mods = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES');
        const regMod = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg');
        const items = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg/ITEMS');

        // Сотрудник склада USER2 (не назначенный в корне ORG1) видит цепочку /ORGANIZATIONS -> /ORGANIZATIONS/ORG1 -> warehouse
        assert.equal(await orgs.canSee(org1, as(USER2)), true, 'видит свою организацию');
        assert.equal(await org1.canSee(wh, as(USER2)), true, 'видит своё подразделение');
        assert.equal(await org1.canSee(secDept, as(USER2)), false, 'чужое подразделение закрыто');
        assert.equal(await org1.canSee(mods, as(USER2)), false, 'контейнер MODULES скрыт от обычного сотрудника в дереве');
        assert.equal(await regMod.canSee(regMod, as(USER2)), false, 'сам $module скрыт от обычного сотрудника');
        assert.equal(await items.canSee(items, as(USER2)), true, 'прилинкованный класс внутри модуля доступен по ссылке рабочего места');

        // Администратор видит и MODULES, и все подразделения
        assert.equal(await org1.canSee(mods, as(ADMIN)), true);
        assert.equal(await org1.canSee(secDept, as(ADMIN)), true);
    });
});
