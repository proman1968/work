/**
 * Рабочее пространство пользователя (sources/data/workspace.js, Р15): подразделения и места,
 * меню места из ссылок, контексты работы, описание классов меню; метод `db_workspace` на сервере.
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
import { closeDataDb, openDataDb } from '../sources/data/db.js';
import { syncClasses } from '../sources/data/classes.js';
import { buildWorkspace } from '../sources/data/workspace.js';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('buildWorkspace: чистая часть', () => {
    let db;
    const cls = (p, type, label, own = {}) => ({ cid: p, path: p, type, label, own });

    before(async () => {
        db = await openDataDb(':memory:');
        syncClasses(db, [
            cls('/D/CAT', '$catalog', 'Справочники'),
            cls('/D/CAT/ITEMS', '$catalog', 'Номенклатура'),
            cls('/D/OPS', '$operation', 'Операции', { icon: 'icons:ops' }),
            cls('/D/OPS/SALE', '$operation', 'Продажа'),
            cls('/D/REG/62', '$account', 'Расчёты'),
            cls('/BASE/ORG', '$base', 'Организация'),
            cls('/BASE/ORG/SALES', '$structure', 'Продажи'),
            cls('/BASE/ORG/BUY', '$structure', 'Закупки'),
        ]);
    });
    after(() => db?.close());

    const link = (id, access = 'read', scope) => ({ id, access, ...(scope ? { scope } : {}) });
    const unit = (path, label, parent, roles, security, admin = false) =>
        ({ cid: path, path, label, type: path === '/BASE/ORG' ? '$base' : '$structure', parent, own: {}, roles, admin, security });
    const salesSecurity = {
        LINKS: [link('/D/CAT/ITEMS', 'write')],
        ROLES: [{
            id: 'head', label: 'Руководитель', USERS: ['u1'], LINKS: [link('/D/OPS', 'write', 'unit'), link('/D/REG/62', 'read', 'unit')],
            ROLES: [{ id: 'manager', label: 'Менеджер', USERS: ['u2'], LINKS: [link('/D/OPS/SALE', 'write', 'own')] }],
        }],
    };
    const units = (rolesSales, rolesBuy = [], admin = false) => [
        unit('/BASE/ORG', 'Организация', null, [], { LINKS: [link('/D/CAT')] }, admin),
        unit('/BASE/ORG/SALES', 'Продажи', '/BASE/ORG', rolesSales, salesSecurity, admin),
        unit('/BASE/ORG/BUY', 'Закупки', '/BASE/ORG', rolesBuy, { ROLES: [{ id: 'buyer', label: 'Закупщик', USERS: ['u1'] }] }, admin),
    ];
    const find = (ws, cid) => ws.units.find(u => u.cid === cid);
    const ids = links => links.map(l => `${l.id}:${l.access}${l.scope ? ':' + l.scope : ''}`).sort();

    it('участник места: свои ссылки со своим доступом, вложенные места — на чтение', () => {
        const ws = buildWorkspace(db, { units: units(['USER']), uid: 'u1' });
        const sales = find(ws, '/BASE/ORG/SALES');
        assert.equal(sales.rights, 'member');
        assert.deepEqual(sales.places.map(p => [p.key, p.view, p.mine]), [['head', 'mine', true], ['head/manager', 'below', false]]);
        assert.deepEqual(ids(sales.places[0].links), [
            '/D/CAT/ITEMS:write', '/D/OPS/SALE:read:own', '/D/OPS:write:unit', '/D/REG/62:read:unit',
        ], 'свои ссылки — со своим доступом, ссылка вложенного места — на чтение, общие — как есть');
        assert.deepEqual(ids(sales.places[1].links), ['/D/CAT/ITEMS:write', '/D/OPS/SALE:read:own'],
            'вышестоящее место видит только чтение ссылок вложенного; сам он вложенных не видит');
        assert.deepEqual(ids(sales.links), ['/D/CAT/ITEMS:write'], 'без места — только общие ссылки подразделения');
    });

    it('подразделение без ролей не видно, но остаётся каркасом дерева; место закупок — моё', () => {
        const ws = buildWorkspace(db, { units: units(['USER']), uid: 'u1' });
        assert.deepEqual(ws.units.map(u => [u.cid, u.rights]), [
            ['/BASE/ORG', null], ['/BASE/ORG/SALES', 'member'],
        ], 'закупки: ролей нет — не показаны; организация: каркас без прав');
        const all = buildWorkspace(db, { units: units(['USER'], ['USER']), uid: 'u1' });
        assert.deepEqual(find(all, '/BASE/ORG/BUY').places.map(p => [p.key, p.mine]), [['buyer', true]]);
        assert.deepEqual(find(all, '/BASE/ORG').places, []);
        assert.equal(find(all, '/BASE/ORG/BUY').parent, '/BASE/ORG');
    });

    it('контексты: мои места, у руководителя и администратора — ещё и подразделение', () => {
        const mine = buildWorkspace(db, { units: units(['USER'], ['USER']), uid: 'u1' });
        assert.deepEqual(mine.contexts.map(c => [c.unit, c.place, c.kind]), [
            ['/BASE/ORG/SALES', 'head', 'place'], ['/BASE/ORG/BUY', 'buyer', 'place'],
        ]);
        assert.equal(mine.contexts[0].label, 'Продажи / Руководитель');
        const plain = buildWorkspace(db, { units: units(['USER']), uid: 'zz' });
        assert.deepEqual(plain.contexts.map(c => [c.unit, c.place, c.kind]), [['/BASE/ORG/SALES', null, 'unit']], 'без места — контекст подразделения');
        const boss = buildWorkspace(db, { units: units(['BOSS', 'USER']), uid: 'zz' });
        assert.deepEqual(boss.contexts.map(c => [c.unit, c.place]), [['/BASE/ORG/SALES', null]]);
    });

    it('BOSS видит места подразделения на чтение, ADMIN — со своими правами', () => {
        const boss = find(buildWorkspace(db, { units: units(['BOSS']), uid: 'zz' }), '/BASE/ORG/SALES');
        assert.equal(boss.rights, 'boss');
        assert.deepEqual(boss.places.map(p => [p.key, p.view]), [['head', 'boss'], ['head/manager', 'boss']]);
        assert.deepEqual(ids(boss.places[0].links), ['/D/CAT/ITEMS:write', '/D/OPS/SALE:read:own', '/D/OPS:read:unit', '/D/REG/62:read:unit']);
        assert.ok(boss.links.every(l => l.id === '/D/CAT/ITEMS' ? l.access === 'write' : l.access === 'read'), 'ссылки мест — на чтение, общая — как есть');
        const admin = find(buildWorkspace(db, { units: units([], [], true), uid: 'zz' }), '/BASE/ORG/SALES');
        assert.equal(admin.rights, 'admin');
        assert.deepEqual(admin.places.map(p => p.view), ['admin', 'admin']);
        assert.ok(admin.places[0].links.some(l => l.id === '/D/OPS' && l.access === 'write'));
        assert.ok(admin.links.some(l => l.id === '/D/OPS' && l.access === 'write'));
    });

    it('классы меню: поддерево ссылки, семейство, значок, листья', () => {
        const ws = buildWorkspace(db, { units: units(['USER']), uid: 'u1' });
        const c = ws.classes;
        assert.deepEqual(Object.keys(c).sort(), ['/D/CAT/ITEMS', '/D/OPS', '/D/OPS/SALE', '/D/REG/62']);
        assert.deepEqual([c['/D/OPS'].family, c['/D/OPS'].icon, c['/D/OPS'].leaf, c['/D/OPS'].children], ['operation', 'icons:ops', false, ['/D/OPS/SALE']]);
        assert.deepEqual([c['/D/OPS/SALE'].leaf, c['/D/REG/62'].family, c['/D/CAT/ITEMS'].family], [true, 'account', 'catalog']);
    });

    it('одинаковая ссылка из нескольких мест: выше доступ, при равном — шире видимость', () => {
        const security = { ROLES: [
            { id: 'a', USERS: ['u1'], LINKS: [link('/D/OPS', 'read', 'own')] },
            { id: 'b', USERS: ['u1'], LINKS: [link('/D/OPS', 'read', 'all'), link('/D/CAT', 'write', 'own'), link('/D/CAT', 'read', 'all')] },
        ] };
        const ws = buildWorkspace(db, { units: [unit('/BASE/ORG', 'Организация', null, ['USER'], security)], uid: 'u1' });
        assert.deepEqual(ids(ws.units[0].places.flatMap(p => p.links)).filter((v, i, a) => a.indexOf(v) === i),
            ['/D/CAT:write:own', '/D/OPS:read:all', '/D/OPS:read:own']);
        assert.deepEqual(ids(ws.units[0].places.find(p => p.key === 'b').links), ['/D/CAT:write:own', '/D/OPS:read:all']);
    });
});

describe('db_workspace: метод класса', () => {
    let tmp, prev;
    const ADMIN = 'WA000000000001', SELLER = 'WS000000000001', STRANGER = 'WX000000000001';
    const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });
    const write = (rel, content) => {
        const full = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf-8');
    };
    const copy = rel => write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
    const cls = (rel, type, body) => write(`${rel}/${type}/class.js`, `export default ${body}`);

    before(async () => {
        prev = process.cwd();
        tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-data-workspace-'));
        write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
        for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
            write(p + '/class.js', 'export default {}');
        for (const uid of [ADMIN, SELLER, STRANGER])
            write(`USERS/${uid}/$user/class.js`, `export default { label: '${uid}' }`);
        copy('DATA/$domain/class.js');
        copy('DATA/OPERATIONS/$operation/$folder/$class/$operation/class.js');
        copy('DATA/CATALOGS/$catalog/$folder/$class/$catalog/class.js');
        cls('DATA/OPERATIONS', '$operation', `{ label: 'Операции', icon: 'icons:ops' }`);
        cls('DATA/OPERATIONS/SALE', '$operation', `{ label: 'Продажа' }`);
        cls('DATA/CATALOGS', '$catalog', `{ label: 'Справочники' }`);
        cls('BASE/ORG', '$structure', `{ label: 'Организация', '#security': { ADMIN: ['${ADMIN}'] } }`);
        cls('BASE/ORG/SALES', '$structure', `{ label: 'Продажи', '#security': { ROLES: [
            { id: 'seller', label: 'Продавец', USERS: ['${SELLER}'], LINKS: [{ id: '/DATA/OPERATIONS', access: 'write', scope: 'own' }] }] } }`);
        cls('BASE/ORG/BUY', '$structure', `{ label: 'Закупки' }`);
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

    const item = p => WORK.get_item(p);

    it('продавец: своё подразделение, своё место и меню с классами', async () => {
        const ws = await invoke(await item('/BASE/ORG'), 'db_workspace', as(SELLER));
        assert.equal(ws.uid, SELLER);
        assert.deepEqual(ws.units.map(u => [u.path, u.rights]), [['/BASE/ORG', null], ['/BASE/ORG/SALES', 'member']]);
        const sales = ws.units[1];
        assert.equal(sales.parent, ws.units[0].cid);
        assert.deepEqual(sales.places.map(p => [p.key, p.view, p.links]), [['seller', 'mine', [{ id: '/DATA/OPERATIONS', access: 'write', scope: 'own' }]]]);
        assert.deepEqual(ws.contexts.map(c => [c.unit, c.place]), [[sales.cid, 'seller']]);
        assert.deepEqual(ws.classes['/DATA/OPERATIONS'].children, ['/DATA/OPERATIONS/SALE']);
        assert.equal(ws.classes['/DATA/OPERATIONS'].icon, 'icons:ops');
    });

    it('администратор организации видит все подразделения; посторонний — ничего', async () => {
        const ws = await invoke(await item('/BASE/ORG'), 'db_workspace', as(ADMIN));
        assert.deepEqual(ws.units.map(u => [u.path, u.rights]), [
            ['/BASE/ORG', 'admin'], ['/BASE/ORG/BUY', 'admin'], ['/BASE/ORG/SALES', 'admin'],
        ]);
        assert.deepEqual(ws.contexts.map(c => [c.unit, c.place]).length, 3);
        await assert.rejects(invoke(await item('/BASE/ORG'), 'db_workspace', as(STRANGER)), /Доступ запрещён/);
    });

    it('вызов на подразделении ниже корня и на не-подразделении', async () => {
        const ws = await invoke(await item('/BASE/ORG/SALES'), 'db_workspace', as(SELLER));
        assert.deepEqual(ws.units.map(u => [u.path, u.parent]), [['/BASE/ORG/SALES', null]]);
        await assert.rejects(invoke(await item('/DATA/CATALOGS'), 'db_workspace', as(ADMIN)), /не подразделение/);
    });
});
