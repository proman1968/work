/**
 * Этап 8.1: цепочки ссылок рабочего места — link_tree, каркас предков, стиль данных.
 * Сервер строит трие LINKS + предки до корня типа; вниз и вбок — ничего.
 * Предки видны как страницы (SYSTEM), данные учётного ядра их поддерева — только по веткам ссылок.
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
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Продавец'], [NOBODY, 'Чужой']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('BASE/direction/$structure/class.js', `export default { label: 'Направление' }`);
    write('BASE/direction/sales/$structure/class.js', `export default { label: 'Продажи',
        '#security': {
            USER: ['${USER1}'],
            LINKS: [
                { id: '/DATA/OPERATIONS/Финансы/Платежи/Поставщик', access: 'write' },
                { id: '/DATA/OPERATIONS/Финансы/Платежи/Покупатель', access: 'write' },
                { id: '/DATA/CATALOGS/Контрагенты/Поставщики', access: 'write' },
                { id: '/DATA/REGISTER/62', access: 'read' },
            ],
        } }`);
    write('DATA/OPERATIONS/Финансы/$operation/class.js', `export default { label: 'Финансы' }`);
    write('DATA/OPERATIONS/Финансы/Платежи/$operation/class.js', `export default { label: 'Платежи' }`);
    write('DATA/OPERATIONS/Финансы/Платежи/Поставщик/$operation/class.js', `export default { label: 'Поставщик', ${FIELDS} }`);
    write('DATA/OPERATIONS/Финансы/Платежи/Покупатель/$operation/class.js', `export default { label: 'Покупатель', ${FIELDS} }`);
    write('DATA/OPERATIONS/Финансы/Зарплата/$operation/class.js', `export default { label: 'Зарплата', ${FIELDS} }`);
    write('DATA/CATALOGS/Контрагенты/$catalog/class.js', `export default { label: 'Контрагенты' }`);
    write('DATA/CATALOGS/Контрагенты/Поставщики/$catalog/class.js', `export default { label: 'Поставщики', ${FIELDS} }`);
    write('DATA/REGISTER/$register/class.js', 'export default {}');
    write('DATA/REGISTER/62/$account/class.js', `export default { label: 'Расчёты' }`);
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

function chain(node) {
    return { path: node.path, label: node.label, access: node.access, children: node.children.map(chain) };
}

describe('link_tree', () => {
    it('трие: общие префиксы слиты, вбок — ничего, подписи из class.js', async () => {
        const sales = await WORK.get_item('/BASE/direction/sales');
        const tree = await sales.link_tree(as(USER1));
        assert.deepEqual(tree.map(t => t.path), ['/DATA']);
        const data = tree[0];
        assert.deepEqual(data.children.map(t => t.path), ['/DATA/CATALOGS', '/DATA/OPERATIONS', '/DATA/REGISTER']);
        const ops = data.children.find(t => t.path === '/DATA/OPERATIONS');
        assert.deepEqual(chain(ops), {
            path: '/DATA/OPERATIONS', label: 'OPERATIONS', access: 'read',
            children: [{
                path: '/DATA/OPERATIONS/Финансы', label: 'Финансы', access: 'read',
                children: [{
                    path: '/DATA/OPERATIONS/Финансы/Платежи', label: 'Платежи', access: 'read',
                    children: [
                        { path: '/DATA/OPERATIONS/Финансы/Платежи/Покупатель', label: 'Покупатель', access: 'write', children: [] },
                        { path: '/DATA/OPERATIONS/Финансы/Платежи/Поставщик', label: 'Поставщик', access: 'write', children: [] },
                    ],
                }],
            }],
        });
        const cat = data.children.find(t => t.path === '/DATA/CATALOGS');
        assert.equal(cat.children[0].path, '/DATA/CATALOGS/Контрагенты');
        assert.equal(cat.children[0].children[0].path, '/DATA/CATALOGS/Контрагенты/Поставщики');
        const reg = data.children.find(t => t.path === '/DATA/REGISTER');
        assert.equal(reg.children[0].path, '/DATA/REGISTER/62');
        assert.equal(reg.children[0].access, 'read');
    });

    it('шлюз отдаёт link_tree участнику, чужому — запрет', async () => {
        const sales = await WORK.get_item('/BASE/direction/sales');
        const tree = await invoke(sales, 'link_tree', as(USER1));
        assert.equal(tree.length, 1);
        assert.equal(tree[0].path, '/DATA');
        await assert.rejects(invoke(sales, 'link_tree', as(NOBODY)), /Доступ запрещён/);
        assert.deepEqual(await sales.link_tree(as(NOBODY)), []);
        const ops = await WORK.get_item('/DATA/OPERATIONS/Финансы');
        assert.deepEqual(await ops.link_tree(as(USER1)), []);
    });

    it('предок виден как страница, но data_access пуст; боковой — невидим', async () => {
        const fin = await WORK.get_item('/DATA/OPERATIONS/Финансы');
        assert.equal(await fin.canSee(fin, as(USER1)), true);
        assert.equal(await fin.data_access(as(USER1)), null);
        const pay = await WORK.get_item('/DATA/OPERATIONS/Финансы/Платежи/Поставщик');
        assert.equal(await pay.data_access(as(USER1)), 'write');
        const zar = await WORK.get_item('/DATA/OPERATIONS/Финансы/Зарплата');
        assert.equal(await zar.canSee(zar, as(USER1)), false);
        assert.equal(await zar.data_access(as(USER1)), null);
    });

    it('данные учётного ядра: связанный лист открыт, предок — только по видимым веткам, боковая ветка закрыта', async () => {
        const sup = await WORK.get_item('/DATA/OPERATIONS/Финансы/Платежи/Поставщик');
        const own = await sup.db_create({ post: { name: 'Плата' }, ...as(USER1) });
        assert.equal(own.unit, '/BASE/direction/sales', 'подразделение — единственное место записи');
        assert.equal((await invoke(sup, 'db_query', as(USER1))).items.length, 1);
        const zar = await WORK.get_item('/DATA/OPERATIONS/Финансы/Зарплата');
        const salary = await zar.db_create({ post: { name: 'Оклад' }, ...as(ADMIN) });
        const fin = await WORK.get_item('/DATA/OPERATIONS/Финансы');
        assert.deepEqual((await invoke(fin, 'db_query', as(USER1))).items.map(o => o.id), [own.id], 'агрегат предка — без чужих веток');
        await assert.rejects(invoke(fin, 'db_read', { id: salary.id, ...as(USER1) }), /не найден/);
        assert.equal((await invoke(fin, 'db_journal', as(USER1))).total, 0);
        await assert.rejects(invoke(zar, 'db_query', as(USER1)), /Доступ запрещён/);
        const acc = await WORK.get_item('/DATA/REGISTER/62');
        assert.equal((await invoke(acc, 'db_journal', as(USER1))).total, 0, 'счёт по ссылке на чтение');
        assert.deepEqual((await invoke(await WORK.get_item('/DATA/REGISTER'), 'db_sheet', as(USER1))).rows, []);
        await assert.rejects(invoke(fin, 'db_query', as(NOBODY)), /Доступ запрещён/);
        assert.equal((await invoke(fin, 'db_query', as(ADMIN))).items.length, 2, 'ADMIN видит всё');
    });
});
