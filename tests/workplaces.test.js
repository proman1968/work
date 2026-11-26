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
    write('$server/class.js', `export default { label: 'WORK', '#security': { BOSS: ['${ADMIN}'] } }`);
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
                        LINKS: [{ id: '/DATA/OPERATIONS', access: 'create' }] }] },
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
        assert.equal(await ops.data_access(as(USER1)), 'create', 'своя ссылка места');
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
        assert.deepEqual(leaves(p.places[0].roles[0].tree).map(t => [t.path, t.access]), [['/DATA/OPERATIONS', 'create']]);
        await assert.rejects(invoke(sales, 'places', as(NOBODY)), /Доступ запрещён/);
    });

    it('create-ссылка: создание объектов, read-ссылка: только чтение (учётное ядро)', async () => {
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
        write('ORGANIZATIONS/ORG1/$base/class.js', `export default { label: 'Орг 1', '#security': { BOSS: ['${ADMIN}'] } }`);
        write('ORGANIZATIONS/ORG1/MODULES/$domain/class.js', `export default { label: 'Модули' }`);
        write('ORGANIZATIONS/ORG1/MODULES/Reg/$module/class.js', `export default { label: 'Учёт' }`);
        write('ORGANIZATIONS/ORG1/MODULES/Reg/ITEMS/$catalog/class.js', `export default { label: 'Номенклатура', ${FIELDS} }`);
        write('ORGANIZATIONS/ORG1/warehouse/$structure/class.js', `export default { label: 'Склад',
            '#security': { ROLES: [{ id: 'keeper', label: 'Кладовщик', USERS: ['${USER2}'],
                LINKS: [{ id: '/ORGANIZATIONS/ORG1/MODULES/Reg/ITEMS', access: 'read' }] }] } }`);
        write('ORGANIZATIONS/ORG1/secret_dept/$structure/class.js', `export default { label: 'Секретный отдел',
            '#security': { BOSS: ['${ADMIN}'] } }`);
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

        // Руководитель (BOSS) видит и MODULES, и все подразделения
        assert.equal(await org1.canSee(mods, as(ADMIN)), true);
        assert.equal(await org1.canSee(secDept, as(ADMIN)), true);
    });

    it('псевдо-субъекты USERS и GUESTS на рабочих местах (ROLES)', async () => {
        write('ORGANIZATIONS/ORG1/public_portal/$structure/class.js', `export default { label: 'Витрина',
            '#security': { ROLES: [
                { id: 'visitors', label: 'Посетители', USERS: ['GUESTS'],
                    LINKS: [{ id: '/ORGANIZATIONS/ORG1/MODULES/Reg/ITEMS', access: 'read' }] },
                { id: 'all_staff', label: 'Все сотрудники', USERS: ['USERS'],
                    LINKS: [{ id: '/OTHER', access: 'write' }] }
            ] } }`);
        globalThis.WORK.reset();
        (await WORK.get_item('/ORGANIZATIONS/ORG1'))?.reset();
        const LINKS = await import('../sources/server/access/links.js');
        LINKS.reset();

        const portal = await WORK.get_item('/ORGANIZATIONS/ORG1/public_portal');
        const items = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg/ITEMS');
        const other = await WORK.get_item('/OTHER');
        const anon = { session: {} };

        // Неавторизованный гость получает роль USER на витрине через GUESTS и доступ read к ITEMS
        assert.deepEqual(await portal.roles(anon), ['USER']);
        assert.equal(await items.data_access(anon), 'read');
        assert.equal(await other.data_access(anon), null, 'место с USERS гостю недоступно');

        // Любой вошедший пользователь (даже NOBODY) получает доступ и к месту GUESTS, и к месту USERS
        assert.deepEqual(await portal.roles(as(NOBODY)), ['USER']);
        assert.equal(await items.data_access(as(NOBODY)), 'read');
        assert.equal(await other.data_access(as(NOBODY)), 'write');
    });

    it('внешний клиент (external: true): роль CLIENT, нет доступа к внутренним файлам и общим ссылкам, scope по умолчанию own', async () => {
        write('ORGANIZATIONS/ORG1/MODULES/Reg/ORDERS/$operation/class.js', `export default { label: 'Заказы', ${FIELDS} }`);
        write('ORGANIZATIONS/ORG1/MODULES/Reg/CLIENT_DOCS/$catalog/class.js', `export default { label: 'Документы клиентов', ${FIELDS} }`);
        write('ORGANIZATIONS/ORG1/client_office/$structure/class.js', `export default { label: 'Отдел продаж',
            '#security': {
                LINKS: [{ id: '/ORGANIZATIONS/ORG1/MODULES/Reg/ORDERS', access: 'write' }],
                ROLES: [
                    { id: 'managers', label: 'Менеджеры', USERS: ['${USER1}'],
                        LINKS: [{ id: '/ORGANIZATIONS/ORG1/MODULES/Reg/CLIENT_DOCS', access: 'write' }] },
                    { id: 'buyers', label: 'Внешние клиенты', external: true, USERS: ['${USER2}'],
                        LINKS: [{ id: '/ORGANIZATIONS/ORG1/MODULES/Reg/CLIENT_DOCS', access: 'read' }] }
                ]
            } }`);
        write('ORGANIZATIONS/ORG1/client_office/$structure/internal_note.txt', 'Внутренняя заметка отдела');
        globalThis.WORK.reset();
        (await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg'))?.reset();
        (await WORK.get_item('/ORGANIZATIONS/ORG1'))?.reset();
        const LINKS = await import('../sources/server/access/links.js');
        const { scopeLinks } = LINKS;
        const { scopeGrants } = await import('../sources/data/scope.js');
        LINKS.reset();

        const office = await WORK.get_item('/ORGANIZATIONS/ORG1/client_office');
        const note = await WORK.get_item('/ORGANIZATIONS/ORG1/client_office/$structure/internal_note.txt');
        const clientDocsCls = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg/CLIENT_DOCS');
        const ordersCls = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg/ORDERS');

        assert.deepEqual(await office.roles(as(USER1)), ['USER'], 'сотрудник на внутреннем месте получает USER');
        assert.deepEqual(await office.roles(as(USER2)), ['CLIENT'], 'пользователь на external-месте получает CLIENT, а не USER');
        assert.equal(await office.canSee(note, as(USER1)), true, 'внутренний сотрудник видит файл отдела');
        assert.equal(await office.canSee(note, as(USER2)), false, 'внешний CLIENT не видит внутренние файлы отдела');
        assert.equal(await office.canWrite(office, { ...as(USER2), filename: 'hack.txt' }), false, 'CLIENT не пишет в файлы отдела');

        assert.equal(await clientDocsCls.data_access(as(USER2)), 'read', 'привязанный к клиентскому месту класс доступен');
        assert.equal(await ordersCls.data_access(as(USER2)), null, 'общие LINKS подразделения клиенту недоступны');

        const ltClient = await office.link_tree(as(USER2));
        assert.ok(JSON.stringify(ltClient).includes('CLIENT_DOCS') && !JSON.stringify(ltClient).includes('ORDERS'),
            'link_tree клиента содержит только ссылки его внешнего места');

        const sLinks = await scopeLinks(clientDocsCls, as(USER2));
        const grants = scopeGrants({ prepare: () => ({ get: () => null, all: () => [] }) }, { cid: clientDocsCls.path, path: clientDocsCls.path, type: '$catalog' }, sLinks, { uid: USER2 });
        assert.deepEqual(grants, [{ author: USER2 }], 'для external-ссылки без явного scope действует ограничение own (только свои)');
    });

    it('4-уровневая модель RWCD: R (чтение), W (правка без создания/удаления), C (создание без удаления), D (удаление)', async () => {
        const { invoke } = await import('../sources/server/access/gateway.js');
        const LINKS = await import('../sources/server/access/links.js');
        const U_R = 'URWCD_R000001', U_W = 'URWCD_W000001', U_C = 'URWCD_C000001', U_D = 'URWCD_D000001';
        for (const uid of [U_R, U_W, U_C, U_D])
            write(`USERS/${uid}/$user/class.js`, `export default { label: '${uid}' }`);
        write('ORGANIZATIONS/ORG1/MODULES/Reg/CATS/$catalog/class.js', `export default { label: 'Справочники' }`);
        write('ORGANIZATIONS/ORG1/MODULES/Reg/CATS/OPEN/$catalog/class.js', `export default { label: 'Открытый', ${FIELDS} }`);
        write('ORGANIZATIONS/ORG1/MODULES/Reg/CATS/SECRET/$catalog/class.js', `export default { label: 'Секретный', ${FIELDS} }`);
        write('ORGANIZATIONS/ORG1/MODULES/Reg/CATS/READONLY/$catalog/class.js', `export default { label: 'Только чтение', ${FIELDS} }`);
        write('ORGANIZATIONS/ORG1/rwcd_dept/$structure/class.js', `export default { label: 'RWCD Отдел',
            '#security': {
                ROLES: [
                    { id: 'r_role', label: 'Наблюдатель', USERS: ['${U_R}'],
                        LINKS: [{ id: '/ORGANIZATIONS/ORG1/MODULES/Reg/CATS', access: 'read' }] },
                    { id: 'w_role', label: 'Редактор', USERS: ['${U_W}'],
                        LINKS: [{ id: '/ORGANIZATIONS/ORG1/MODULES/Reg/CATS', access: 'write' }] },
                    { id: 'c_role', label: 'Создатель', USERS: ['${U_C}'],
                        LINKS: [
                            { id: '/ORGANIZATIONS/ORG1/MODULES/Reg/CATS', access: 'create' },
                            { id: '/ORGANIZATIONS/ORG1/MODULES/Reg/CATS/SECRET', access: 'none' },
                            { id: '/ORGANIZATIONS/ORG1/MODULES/Reg/CATS/READONLY', access: 'read' },
                        ] },
                    { id: 'd_role', label: 'Полный', USERS: ['${U_D}'],
                        LINKS: [{ id: '/ORGANIZATIONS/ORG1/MODULES/Reg/CATS', access: 'delete' }] },
                ]
            } }`);
        globalThis.WORK.reset();
        (await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg'))?.reset();
        (await WORK.get_item('/ORGANIZATIONS/ORG1'))?.reset();
        LINKS.reset();

        const cats = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg/CATS');
        const open = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg/CATS/OPEN');
        const secret = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg/CATS/SECRET');
        const ro = await WORK.get_item('/ORGANIZATIONS/ORG1/MODULES/Reg/CATS/READONLY');
        const dept = await WORK.get_item('/ORGANIZATIONS/ORG1/rwcd_dept');

        // 1. Проверка уровней data_access с проваливанием вниз и переопределениями
        assert.equal(await open.data_access(as(U_R)), 'read');
        assert.equal(await open.data_access(as(U_W)), 'write');
        assert.equal(await open.data_access(as(U_C)), 'create');
        assert.equal(await open.data_access(as(U_D)), 'delete');
        assert.equal(await secret.data_access(as(U_C)), null, 'явное none переопределяет create родительской папки');
        assert.equal(await ro.data_access(as(U_C)), 'read', 'явное read понижает create родительской папки');

        // 2. Администратор создаёт эталонные объекты в OPEN и SECRET
        const secretObj = await invoke(secret, 'db_create', { post: { name: 'Секретная запись' }, ...as(ADMIN) });
        assert.ok(secretObj.id);

        // 3. R — только чтение; W — правка без создания и удаления; C — создание без удаления; D — удаление
        await assert.rejects(invoke(open, 'db_create', { post: { name: 'От R' }, ...as(U_R) }), /Доступ запрещён/);
        await assert.rejects(invoke(open, 'db_create', { post: { name: 'От W' }, ...as(U_W) }), /Доступ запрещён/, 'write трактуется строго как W и не даёт db_create');

        const created = await invoke(open, 'db_create', { post: { name: 'Создано C' }, ...as(U_C) });
        assert.ok(created.id, 'C может создавать');
        await assert.rejects(invoke(open, 'db_delete', { id: created.id, ...as(U_C) }), /Доступ запрещён/, 'C не может удалять');
        await assert.rejects(invoke(ro, 'db_create', { post: { name: 'В RO' }, ...as(U_C) }), /Доступ запрещён/, 'понижение до read блокирует создание');

        // W может редактировать существующий объект, но не может удалять
        const updated = await invoke(open, 'db_update', { id: created.id, post: { name: 'Обновлено W' }, ...as(U_W) });
        assert.equal(updated.body.name, 'Обновлено W', 'W может редактировать существующий объект');
        await assert.rejects(invoke(open, 'db_delete', { id: created.id, ...as(U_W) }), /Доступ запрещён/, 'W не может удалять');

        // D может удалять и восстанавливать
        const deleted = await invoke(open, 'db_delete', { id: created.id, ...as(U_D) });
        assert.equal(deleted.status, 'deleted', 'D может удалять');
        const restored = await invoke(open, 'db_restore', { id: created.id, ...as(U_D) });
        assert.equal(restored.status, 'active', 'D может восстанавливать');

        // 4. Явное none вырезает подкласс из выборки родительской папки и из link_tree
        const qCats = await invoke(cats, 'db_query', as(U_C));
        assert.ok(qCats.items.some(o => o.id === created.id), 'U_C видит объекты OPEN через CATS');
        assert.ok(!qCats.items.some(o => o.id === secretObj.id), 'U_C не видит объекты SECRET (access: none) даже через родительский CATS');

        const ltC = await dept.link_tree(as(U_C));
        const ltJson = JSON.stringify(ltC);
        assert.ok(ltJson.includes('OPEN') && ltJson.includes('READONLY'), 'link_tree включает разрешённые классы');
        assert.ok(!ltJson.includes('SECRET'), 'link_tree исключает подкласс с явным none');
    });

    it('удалённые субъекты из /NODES: сервер целиком, пользователь и подразделение с другого сервера', async () => {
        const { matchesUserList, buildSubject } = await import('../sources/server/access/workplaces.js');
        const nodeSession = (actor = '', fromPath = '') => ({
            session: {
                uid: 'NODEHOST1',
                principal: {
                    kind: 'node',
                    id: 'NODEHOST1',
                    nodePath: '/NODES/partner',
                    actorId: actor,
                    actor: actor ? `${actor}@NODEHOST1` : undefined,
                    fromPath,
                },
            },
        });
        const subjWhole = buildSubject('NODEHOST1', nodeSession());
        const subjIvan = buildSubject('NODEHOST1', nodeSession('U_IVAN'));
        const subjPetr = buildSubject('NODEHOST1', nodeSession('U_PETR'));
        const subjDept = buildSubject('NODEHOST1', nodeSession('', '/ORGANIZATIONS/PartnerOrg/Sales'));

        assert.equal(matchesUserList(['/NODES/partner'], subjWhole), true, 'путь узла /NODES/partner даёт доступ всему серверу');
        assert.equal(matchesUserList(['NODEHOST1'], subjIvan), true, 'host_id даёт доступ всему серверу');
        assert.equal(matchesUserList(['/NODES/partner/USERS/U_IVAN'], subjIvan), true, 'конкретный удалённый пользователь совпадает');
        assert.equal(matchesUserList(['/NODES/partner/USERS/U_IVAN'], subjPetr), false, 'другой пользователь того же сервера не совпадает');
        assert.equal(matchesUserList(['/NODES/partner/ORGANIZATIONS/PartnerOrg/Sales'], subjDept), true, 'удалённое подразделение совпадает');
        assert.equal(matchesUserList(['/NODES/partner/ORGANIZATIONS/PartnerOrg/HR'], subjDept), false, 'чужое удалённое подразделение не совпадает');
        assert.equal(matchesUserList(['USERS'], subjIvan), false, 'локальное USERS не открывает роль удалённому серверу');
    });
});
