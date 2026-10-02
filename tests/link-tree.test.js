/**
 * Этап 8.1: цепочки ссылок рабочего места — link_tree, каркас предков, стиль данных.
 * Сервер строит трие LINKS + предки до корня типа; вниз и вбок — ничего.
 * Предки видны как страницы (SYSTEM), но DATA/INDEX им закрыты.
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

const ADMIN = 'WA000000000001', USER1 = 'WU000000000001', NOBODY = 'WN000000000001';
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
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-linktree-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Продавец'], [NOBODY, 'Чужой']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('BASE/direction/sales/$group/class.js', `export default { label: 'Продажи',
        '#security': { USERS: ['${USER1}'] },
        LINKS: [
            { id: '/OPERATIONS/Финансы/Платежи/Поставщик', access: 'write' },
            { id: '/OPERATIONS/Финансы/Платежи/Покупатель', access: 'write' },
            { id: '/CATALOGS/Контрагенты/Поставщики', access: 'write' },
            { id: '/REGISTER/62', access: 'read' },
        ] }`);
    write('OPERATIONS/Финансы/$operation/class.js', `export default { label: 'Финансы' }`);
    write('OPERATIONS/Финансы/Платежи/$operation/class.js', `export default { label: 'Платежи' }`);
    write('OPERATIONS/Финансы/Платежи/Поставщик/$operation/class.js', `export default { label: 'Поставщик', ${FIELDS} }`);
    write('OPERATIONS/Финансы/Платежи/Покупатель/$operation/class.js', `export default { label: 'Покупатель', ${FIELDS} }`);
    write('OPERATIONS/Финансы/Зарплата/$operation/class.js', `export default { label: 'Зарплата', ${FIELDS} }`);
    write('CATALOGS/Контрагенты/$catalog/class.js', `export default { label: 'Контрагенты' }`);
    write('CATALOGS/Контрагенты/Поставщики/$catalog/class.js', `export default { label: 'Поставщики', ${FIELDS} }`);
    write('REGISTER/62/$account/class.js', `export default { label: 'Расчёты', ${FIELDS} }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

function chain(node) {
    return { path: node.path, label: node.label, access: node.access, children: node.children.map(chain) };
}

describe('link_tree', () => {
    it('трие: общие префиксы слиты, вбок — ничего, подписи из class.js', async () => {
        const sales = await WORK.get_item('/BASE/direction/sales');
        const tree = await sales.link_tree(as(USER1));
        assert.deepEqual(tree.map(t => t.path), ['/CATALOGS', '/OPERATIONS', '/REGISTER']);
        const ops = tree.find(t => t.path === '/OPERATIONS');
        assert.deepEqual(chain(ops), {
            path: '/OPERATIONS', label: 'OPERATIONS', access: 'read',
            children: [{
                path: '/OPERATIONS/Финансы', label: 'Финансы', access: 'read',
                children: [{
                    path: '/OPERATIONS/Финансы/Платежи', label: 'Платежи', access: 'read',
                    children: [
                        { path: '/OPERATIONS/Финансы/Платежи/Покупатель', label: 'Покупатель', access: 'write', children: [] },
                        { path: '/OPERATIONS/Финансы/Платежи/Поставщик', label: 'Поставщик', access: 'write', children: [] },
                    ],
                }],
            }],
        });
        const cat = tree.find(t => t.path === '/CATALOGS');
        assert.equal(cat.children[0].path, '/CATALOGS/Контрагенты');
        assert.equal(cat.children[0].children[0].path, '/CATALOGS/Контрагенты/Поставщики');
        const reg = tree.find(t => t.path === '/REGISTER');
        assert.equal(reg.children[0].path, '/REGISTER/62');
        assert.equal(reg.children[0].access, 'read');
    });

    it('шлюз отдаёт link_tree члену группы, чужому — запрет', async () => {
        const sales = await WORK.get_item('/BASE/direction/sales');
        const tree = await invoke(sales, 'link_tree', as(USER1));
        assert.equal(tree.length, 3);
        await assert.rejects(invoke(sales, 'link_tree', as(NOBODY)), /Доступ запрещён/);
        assert.deepEqual(await sales.link_tree(as(NOBODY)), []);
        const ops = await WORK.get_item('/OPERATIONS/Финансы');
        assert.deepEqual(await ops.link_tree(as(USER1)), []);
    });

    it('предок виден как страница, но data_access пуст; боковой — невидим', async () => {
        const fin = await WORK.get_item('/OPERATIONS/Финансы');
        assert.equal(await fin.canSee(fin, as(USER1)), true);
        assert.equal(await fin.data_access(as(USER1)), null);
        const pay = await WORK.get_item('/OPERATIONS/Финансы/Платежи/Поставщик');
        assert.equal(await pay.data_access(as(USER1)), 'write');
        const zar = await WORK.get_item('/OPERATIONS/Финансы/Зарплата');
        assert.equal(await zar.canSee(zar, as(USER1)), false);
        assert.equal(await zar.data_access(as(USER1)), null);
    });

    it('query предка показывает только связанные ветки, боковая запрещена', async () => {
        const sup = await WORK.get_item('/OPERATIONS/Финансы/Платежи/Поставщик');
        await sup.create_object({ filename: 'op.data', post: { name: 'Плата' }, ...as(USER1) });
        const fin = await WORK.get_item('/OPERATIONS/Финансы');
        const rows = await fin.query(as(USER1));
        assert.equal(rows.length, 1);
        assert.ok(rows[0].point.includes('Поставщик'));
        const zar = await WORK.get_item('/OPERATIONS/Финансы/Зарплата');
        await assert.rejects(zar.query(as(USER1)), /Доступ запрещён/);
    });

    it('index предка запрещён (агрегат с чужими ветками), у листа — штатная ошибка', async () => {
        const fin = await WORK.get_item('/OPERATIONS/Финансы');
        await assert.rejects(fin.index({ id: 'x', ...as(USER1) }), /Доступ запрещён/);
        const sup = await WORK.get_item('/OPERATIONS/Финансы/Платежи/Поставщик');
        await assert.rejects(sup.index({ id: 'x', ...as(USER1) }), /нет индекса/);
    });
});
