/**
 * Тест монтирования удалённых точек федерации узлов внутри `/NODES/<Узел>` (P2.3):
 *  - node_grants находит выданные узлу точки дерева даже без индекса RAG;
 *  - раскрытие `/NODES/<Узел>` показывает смонтированные элементы партнёра;
 *  - смонтированный элемент (`/NODES/<Узел>/...`) разрешается через WORK.get_item,
 *    открывается у себя в проводнике (`~/handlers/pages/form/index.html`, `handlers`),
 *    проксирует `info`, `readme_merged`, `db_schema`, `db_query` через подписанный `nodeFetch`
 *    и переписывает пути под `/NODES/<Узел>/...`;
 *  - пользователь без роли представителя в `/NODES/<Узел>` не видит смонтированные элементы.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { closeIndexDb } from '../sources/host/index-db.js';
import { closeDataDb } from '../sources/data/db.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN = 'NA000000000001';
const REP_USER = 'NR000000000001';
const OTHER_USER = 'NO000000000001';
const PARTNER_HOST_ID = 'BEEF00000000001';

let tmp, prevCwd, partnerServer, partnerOrigin;
const partnerCalls = [];

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function copy(rel) {
    write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-nodes-mount-'));

    // Поднимаем HTTP-сервер, эмулирующий удалённый узел партнёра по протоколу work-node/1
    partnerServer = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        const method = Array.from(u.searchParams.keys())[0] || 'info';
        partnerCalls.push({
            pathname: decodeURIComponent(u.pathname),
            method,
            nodeHeader: req.headers['work-node'],
            audienceHeader: req.headers['work-audience'],
            actorHeader: req.headers['work-actor'],
            rolesHeader: req.headers['work-roles'],
            signature: req.headers['work-signature'],
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const p = decodeURIComponent(u.pathname);

        if (method === 'readme_merged') {
            res.end(JSON.stringify({ text: '# Справочник партнёра', path: p + '/$catalog/readme.md' }));
            return;
        }
        if (method === 'db_schema') {
            res.end(JSON.stringify({
                schema: {
                    cid: p,
                    path: p,
                    label: 'Товары партнёра',
                    type: '$catalog',
                    family: 'catalog',
                    leaf: true,
                    fields: [
                        { id: 'name', label: 'Наименование', type: 'string', required: true },
                        { id: 'unit', label: 'Единица', type: 'link', target: '/ORGANIZATIONS/Партнёр/MODULES/Register/CATALOGS/Единицы', targetPath: '/ORGANIZATIONS/Партнёр/MODULES/Register/CATALOGS/Единицы' },
                    ],
                },
                errors: [],
            }));
            return;
        }
        if (method === 'db_query') {
            res.end(JSON.stringify({
                items: [
                    { id: 'p1', cid: p, title: 'Масло индустриальное И-20А', status: 'active', body: { name: 'Масло индустриальное И-20А' } },
                ],
                total: 1,
                names: {
                    objects: {},
                    classes: { [p]: 'Товары партнёра' },
                    paths: { [p]: p },
                },
            }));
            return;
        }
        if (p === '/ORGANIZATIONS/Партнёр/sales') {
            res.end(JSON.stringify({
                id: 'sales',
                label: 'Отдел оптовых продаж',
                type: '$structure',
                path: '/ORGANIZATIONS/Партнёр/sales',
                hasItems: true,
                items: [
                    {
                        id: 'Товары',
                        label: 'Товары партнёра',
                        type: '$catalog',
                        path: '/ORGANIZATIONS/Партнёр/sales/Товары',
                        objectCount: 15,
                        hasItems: false,
                    },
                ],
            }));
            return;
        }
        if (p === '/ORGANIZATIONS/Партнёр/sales/Товары') {
            res.end(JSON.stringify({
                id: 'Товары',
                label: 'Товары партнёра',
                type: '$catalog',
                path: '/ORGANIZATIONS/Партнёр/sales/Товары',
                objectCount: 15,
                hasItems: false,
                items: [],
            }));
            return;
        }
        res.end(JSON.stringify({
            id: p.split('/').filter(Boolean).pop() || 'root',
            label: p.split('/').filter(Boolean).pop() || 'Партнёр',
            type: '$structure',
            path: p,
            hasItems: true,
            items: [],
        }));
    });

    await new Promise(r => partnerServer.listen(0, '127.0.0.1', r));
    partnerOrigin = `http://127.0.0.1:${partnerServer.address().port}`;

    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file', '$server/$folder/$class/$structure', '$server/$folder/$class/$domain'])
        write(p + '/class.js', 'export default {}');

    copy('sources/page.html');
    copy('$server/$folder/handlers/pages/form/$handler/class.js');
    copy('$server/$folder/handlers/pages/form/$handler/form.js');
    copy('$server/$folder/$class/handlers/pages/form/objects/$handler/class.js');
    copy('$server/$folder/$class/handlers/pages/form/objects/$handler/objects.js');
    copy('NODES/$node/class.js');
    copy('NODES/$node/$folder/$class/$node/class.js');

    for (const [uid, label] of [[ADMIN, 'Админ'], [REP_USER, 'Представитель'], [OTHER_USER, 'Сторонний']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);

    // Напишем локальное подразделение, где чужой узел PARTNER_HOST_ID назначен на роль CUSTOMER (для проверки node_grants без RAG)
    write('ORGANIZATIONS/$domain/class.js', `export default { label: 'Организации' }`);
    write('ORGANIZATIONS/Маслоторг/$base/class.js', `export default {
        label: 'ООО Маслоторг',
        ROLES: { CUSTOMER: { label: 'Покупатель', principals: ['user', 'node'] } },
        '#security': { CUSTOMER: ['${PARTNER_HOST_ID}'] }
    }`);

    // Зарегистрируем узел партнёра в /NODES/Партнёр
    write('NODES/Партнёр/$node/class.js', `export default {
        label: 'Сервер Партнёра',
        host_id: '${PARTNER_HOST_ID}',
        origin: '${partnerOrigin}',
        status: 'active',
        ROLES: {
            CUSTOMER: { label: 'Покупатель', principals: ['user', 'node'] }
        },
        '#security': {
            CUSTOMER: ['${REP_USER}']
        },
        remote: {
            label: 'Сервер Партнёра',
            grants: [
                { point: '/ORGANIZATIONS/Партнёр/sales', label: 'Отдел оптовых продаж', role: 'CUSTOMER', roleLabel: 'Покупатель' }
            ]
        }
    }`);

    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => partnerServer.close(r));
    await new Promise(r => setTimeout(r, 200));
    await closeDataDb();
    closeIndexDb();
    process.chdir(prevCwd);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('монтирование удалённых узлов федерации в /NODES (P2.3)', () => {
    it('node_grants находит точки, выданные узлу сети, прямым обходом дерева без RAG', async () => {
        const grants = await WORK.node_grants({
            session: { principal: { kind: 'node', id: PARTNER_HOST_ID } },
        });
        assert.equal(grants.length, 1);
        assert.deepEqual(grants[0], {
            point: '/ORGANIZATIONS/Маслоторг',
            label: 'ООО Маслоторг',
            role: 'CUSTOMER',
            roleLabel: 'Покупатель',
        });
    });

    it('внутри /NODES/Партнёр монтируются выданные точки и раскрываются удалённые элементы', async () => {
        const node = await WORK.get_item('/NODES/Партнёр');
        assert.ok(node);
        assert.equal(node.isNodeRoot, true);

        const topItems = await node.items;
        assert.equal(topItems.length, 1);
        assert.equal(topItems[0].id, 'ORGANIZATIONS');
        assert.equal(topItems[0].path, '/NODES/Партнёр/ORGANIZATIONS');
        assert.equal(topItems[0].isMountedRemote, true);

        const sales = await WORK.get_item('/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales', 0, undefined, as(REP_USER));
        assert.ok(sales, 'узел sales смонтирован');
        assert.equal(sales.isMountedRemote, true);
        assert.equal(sales.path, '/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales');
        assert.equal(sales.remotePath, '/ORGANIZATIONS/Партнёр/sales');
        assert.equal(sales.type, '$structure');
        assert.equal(sales.label, 'Отдел оптовых продаж');

        const salesKids = await sales.items;
        assert.equal(salesKids.length, 1);
        assert.equal(salesKids[0].id, 'Товары');
        assert.equal(salesKids[0].path, '/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales/Товары');
        assert.equal(salesKids[0].type, '$catalog');
    });

    it('смонтированный элемент открывается у нас в проводнике (form/objects) и проксирует db_schema / db_query с подписанным заголовком work-node/1', async () => {
        partnerCalls.length = 0;
        const catalog = await WORK.get_item('/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales/Товары', 0, undefined, as(REP_USER));
        assert.ok(catalog);
        assert.equal(catalog.type, '$catalog');

        // 1. Открытие страницы формы у нас в проводнике
        const pageHtml = await WORK.get_item('/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales/Товары/~/handlers/pages/form/index.html', 0, undefined, as(REP_USER));
        assert.equal(typeof pageHtml, 'string');
        assert.ok(pageHtml.includes('/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales/Товары'), 'page.html содержит локальный смонтированный путь');

        // 2. Проксирование db_schema с переписыванием путей ссылок под /NODES/Партнёр/...
        const schemaRes = await catalog.db_schema(as(REP_USER));
        assert.equal(schemaRes.schema.label, 'Товары партнёра');
        assert.equal(schemaRes.schema.path, '/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales/Товары');
        const unitField = schemaRes.schema.fields.find(f => f.id === 'unit');
        assert.equal(unitField.targetPath, '/NODES/Партнёр/ORGANIZATIONS/Партнёр/MODULES/Register/CATALOGS/Единицы');

        // 3. Проксирование db_query
        const queryRes = await catalog.db_query(as(REP_USER));
        assert.equal(queryRes.items.length, 1);
        assert.equal(queryRes.items[0].title, 'Масло индустриальное И-20А');
        assert.equal(queryRes.names.paths['/ORGANIZATIONS/Партнёр/sales/Товары'], '/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales/Товары');

        // 4. Проксирование readme_merged
        const rm = await catalog.readme_merged(as(REP_USER));
        assert.equal(rm.text, '# Справочник партнёра');
        assert.equal(rm.path, '/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales/Товары/$catalog/readme.md');

        // Проверяем, что запросы уходили с криптографической подписью work-node/1 и ролью CUSTOMER
        const schemaCall = partnerCalls.find(c => c.method === 'db_schema');
        assert.ok(schemaCall, 'вызов db_schema пришёл на сервер партнёра');
        assert.equal(schemaCall.audienceHeader, PARTNER_HOST_ID);
        assert.equal(schemaCall.actorHeader, REP_USER);
        assert.equal(schemaCall.rolesHeader, 'CUSTOMER');
        assert.ok(schemaCall.signature && schemaCall.signature.length > 20, 'подпись Ed25519 присутствует');
    });

    it('пользователь без назначенной роли представителя в /NODES/Партнёр не имеет доступа к смонтированным элементам', async () => {
        const catalog = await WORK.get_item('/NODES/Партнёр/ORGANIZATIONS/Партнёр/sales/Товары', 0, undefined, as(REP_USER));
        const canOtherSee = await catalog.canSee(catalog, as(OTHER_USER));
        assert.equal(canOtherSee, false, 'сторонний пользователь не видит смонтированный узел');
        await assert.rejects(
            () => catalog.db_query(as(OTHER_USER)),
            /Доступ запрещён/
        );
    });
});
