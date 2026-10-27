/**
 * Методы учётного ядра у классов дерева (sources/data/api.js): права, класс вызова,
 * объекты и проведение, отчёты, выбор ссылки, закрытие периода, обновление кэша классов.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { invoke, MEMBERS } from '../sources/server/access/gateway.js';
import { closeIndexDb } from '../sources/host/index-db.js';
import { closeDataDb } from '../sources/data/db.js';
import { DATA_METHODS } from '../sources/data/api.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN = 'DA000000000001', USER1 = 'DU000000000001', NOBODY = 'DN000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });
const Y = new Date().getFullYear() - 1;
const d = md => `${Y}-${md}`;
const SEC = `'#security': { USER: ['${USER1}'] }`;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

const copy = rel => {
    const src = rel === 'DATA/$domain/class.js'
        ? 'MODULES/$domain/class.js'
        : rel.startsWith('DATA/') ? 'MODULES/Register/' + rel.slice(5) : rel;
    write(rel, fs.readFileSync(path.join(ROOT, src), 'utf-8'));
};
const cls = (rel, type, body) => write(`${rel}/${type}/class.js`, `export default ${body}`);
const item = p => WORK.get_item(p);

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-data-api-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file', '$server/$folder/$class/$domain', '$server/$folder/$class/$module', '$server/$folder/$class/$structure'])
        write(p + '/class.js', 'export default {}');
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Продавец'], [NOBODY, 'Чужой']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    copy('DATA/$domain/class.js');
    for (const t of ['$catalog', '$virtual'])
        copy(`DATA/CATALOGS/$catalog/$folder/$class/${t}/class.js`);
    for (const t of ['$register', '$account'])
        copy(`DATA/REGISTER/$register/$folder/$class/${t}/class.js`);
    copy('DATA/OPERATIONS/$operation/$folder/$class/$operation/class.js');

    cls('DATA/CATALOGS', '$catalog', `{ label: 'Справочники', ${SEC} }`);
    cls('DATA/CATALOGS/SUBJECTS', '$catalog', `{ label: 'Субъекты', ${SEC}, METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
    cls('DATA/CATALOGS/CLIENTS', '$virtual', `{ label: 'Клиенты', ${SEC},
        SOURCE: { registry: '/DATA/CATALOGS/SUBJECTS', account: '/DATA/REGISTER/62' }, OVERLAY: [{ id: 'discount', type: 'Number' }] }`);
    cls('DATA/REGISTER', '$register', `{ label: 'Журнал', ${SEC} }`);
    cls('DATA/REGISTER/62', '$account', `{ label: 'Расчёты с покупателями', ${SEC}, METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', catalog: '/DATA/CATALOGS/SUBJECTS', analytic: true, required: true }] } }`);
    cls('DATA/REGISTER/90', '$account', `{ label: 'Продажи', ${SEC} }`);
    cls('DATA/OPERATIONS', '$operation', `{ label: 'Операции', ${SEC} }`);
    cls('DATA/OPERATIONS/SALE', '$operation', `{ label: 'Продажа', ${SEC}, METADATA: {
        FIELDS: [{ id: 'client', type: 'Link', catalog: '/DATA/CATALOGS/CLIENTS', required: true }, { id: 'sum', type: 'Money', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum',
            debit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'client' } }, credit: { account: '/DATA/REGISTER/90' } }] } }`);
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

describe('методы учётного ядра у классов', () => {
    let alpha, beta, sale;

    it('объявлены в шлюзе с уровнями', () => {
        for (const [name, m] of Object.entries(DATA_METHODS))
            assert.equal(MEMBERS[name], m.level, name);
        assert.equal(MEMBERS.db_close_period, 'admin');
    });

    it('справочник: создание (автор из сессии), чтение, выборка, запрет чужому', async () => {
        const subjects = await item('/DATA/CATALOGS/SUBJECTS');
        alpha = await invoke(subjects, 'db_create', { post: JSON.stringify({ name: 'ООО «Альфа»' }), ...as(USER1) });
        assert.equal(alpha.author, USER1);
        assert.equal(alpha.cid, '/DATA/CATALOGS/SUBJECTS', 'cid класса без CID — путь');
        beta = await subjects.db_create({ post: { name: 'ООО «Бета»' }, ...as(USER1) });
        assert.equal((await subjects.db_read({ id: alpha.id, ...as(USER1) })).title, 'ООО «Альфа»');
        const all = await invoke(await item('/DATA/CATALOGS'), 'db_query', { search: 'бета', ...as(USER1) });
        assert.deepEqual(all.items.map(o => o.id), [beta.id]);
        await assert.rejects(invoke(subjects, 'db_create', { post: { name: 'X' }, ...as(NOBODY) }), /Доступ запрещён/);
        await assert.rejects(invoke(subjects, 'db_query', as(NOBODY)), /Доступ запрещён/);
        await assert.rejects(subjects.db_create({ post: { name: 1, extra: 2 }, ...as(USER1) }), /нет такого поля/);
    });

    it('объект доступен только в поддереве класса вызова', async () => {
        const sale = await item('/DATA/OPERATIONS/SALE');
        await assert.rejects(sale.db_read({ id: alpha.id, ...as(USER1) }), /не найден в «Продажа»/);
        await assert.rejects(sale.db_update({ id: alpha.id, post: { sum: 1 }, ...as(USER1) }), /не найден/);
    });

    it('операция: черновик, предпросмотр, регистрация, исправление, проводки', async () => {
        const cls = await item('/DATA/OPERATIONS/SALE');
        const preview = await cls.db_preview({ post: { client: alpha.id, sum: 10 }, ...as(USER1) });
        assert.deepEqual(preview.entries.map(e => [e.debit, e.credit, e.amount]), [['/DATA/REGISTER/62', '/DATA/REGISTER/90', 10]]);
        assert.equal(preview.names.classes['/DATA/REGISTER/62'], 'Расчёты с покупателями', 'предпросмотр называет счета');
        assert.equal(preview.names.objects[alpha.id], 'ООО «Альфа»', 'и объекты аналитик');
        sale = await invoke(cls, 'db_create', { time: d('02-01'), post: { client: alpha.id, sum: 500 }, ...as(USER1) });
        assert.equal(sale.status, 'draft');
        assert.deepEqual((await cls.db_read({ id: sale.id, ...as(USER1) })).names, { [alpha.id]: 'ООО «Альфа»' }, 'чтение называет объекты ссылок');
        const reg = await invoke(cls, 'db_register', { id: sale.id, version: String(sale.version), ...as(USER1) });
        assert.equal(reg.status, 'registered');
        await invoke(cls, 'db_correct', { id: sale.id, post: { sum: 600 }, ...as(USER1) });
        const entries = await cls.db_entries({ id: sale.id, history: 'true', ...as(USER1) });
        assert.deepEqual(entries.map(e => e.amount), [500, -500, 600]);
        assert.equal(entries[2].author, USER1);
        const second = await cls.db_create({ time: d('02-05'), post: { client: beta.id, sum: 300 }, ...as(USER1) });
        await cls.db_register({ id: second.id, ...as(USER1) });
        await invoke(cls, 'db_cancel', { id: second.id, ...as(USER1) });
    });

    it('отчёты на счёте и журнале: журнал, ОСВ с разворотом, карточка; журнал класса операций', async () => {
        const regItem = await item('/DATA/REGISTER');
        const j = await invoke(regItem, 'db_journal', { effective: 'true', ...as(USER1) });
        assert.deepEqual(j.items.map(e => e.amount), [600]);
        assert.equal((await regItem.db_journal(as(USER1))).total, 5);
        const sheet = await invoke(regItem, 'db_sheet', { to: d('12-31'), by: 'counterparty', ...as(USER1) });
        const row62 = sheet.rows.find(r => r.account === '/DATA/REGISTER/62' && r.key?.counterparty === alpha.id);
        assert.deepEqual(row62.closing, { debit: 600, credit: 0 });
        assert.deepEqual(sheet.total.closing, { debit: 600, credit: 600 });
        const acc62 = await item('/DATA/REGISTER/62');
        const card = await invoke(acc62, 'db_card', { analytics: JSON.stringify({ counterparty: alpha.id }), ...as(USER1) });
        assert.deepEqual(card.items.map(i => i.balance), [500, 0, 600]);
        await assert.rejects(acc62.db_sheet({ account: '/DATA/REGISTER/90', ...as(USER1) }), /не найден в «Расчёты с покупателями»/);
        const ops = await item('/DATA/OPERATIONS');
        assert.equal((await ops.db_journal({ effective: '1', ...as(USER1) })).total, 1);
        await assert.rejects((await item('/DATA/CATALOGS/SUBJECTS')).db_sheet(as(USER1)), /не счёт/);
    });

    it('объект: состояние и траектория; виртуальный справочник: состав и выбор', async () => {
        const subjects = await item('/DATA/CATALOGS/SUBJECTS');
        const st = await subjects.db_state({ id: alpha.id, at: d('02-01'), ...as(USER1) });
        assert.deepEqual(st.balances.map(b => [b.account, b.debit]), [['/DATA/REGISTER/62', 600]], 'исправление — тем же днём');
        assert.deepEqual((await subjects.db_state({ id: alpha.id, at: d('01-31'), ...as(USER1) })).balances, []);
        assert.equal((await subjects.db_trajectory({ id: alpha.id, ...as(USER1) })).items.length, 3);

        const clients = await item('/DATA/CATALOGS/CLIENTS');
        const members = await invoke(clients, 'db_members', as(USER1));
        assert.deepEqual(members.items.map(m => m.id), [alpha.id]);
        const choices = await invoke(clients, 'db_choices', { search: 'ооо', ...as(USER1) });
        assert.deepEqual(choices.items.map(i => [i.id, i.member]), [[alpha.id, true], [beta.id, false]]);
        assert.deepEqual(choices.create.map(c => c.cid), ['/DATA/CATALOGS/SUBJECTS']);
    });

    it('формы журнала, ОСВ, карточки счёта и состава — на ответах ядра', async () => {
        const form = async (rel, path) => {
            const proto = (await import(`../${rel}`)).default;
            const h = Object.create(proto);
            const target = await item(path);
            // как по HTTP: параметры строками, права — сессии пользователя
            h.$item = { fetch: (m, p = {}, post) => invoke(target, m, {
                ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])),
                ...(post !== undefined ? { post: JSON.stringify(post) } : {}),
                ...as(USER1),
            }) };
            return h;
        };
        const REG = 'MODULES/Register/REGISTER/$register/$folder/$class';
        const j = await form(`${REG}/$register/handlers/pages/form/journal/$handler/journal.js`, '/DATA/REGISTER');
        await j.reload();
        assert.equal(j.error, '');
        assert.equal(j.items.length, 5, 'со сторно и прежними версиями');
        j.effective = true;
        j.account = '/DATA/REGISTER/62';
        await j.reload();
        assert.deepEqual(j.displayRows.map(r => [r.op, r.debit, r.debitAnalytics, r.credit]),
            [['Продажа', '62 Расчёты с покупателями', 'ООО «Альфа»', '90 Продажи']]);
        assert.equal(j.names.paths['/DATA/REGISTER/90'], '/DATA/REGISTER/90');

        const s = await form(`${REG}/$register/handlers/pages/form/sheet/$handler/sheet.js`, '/DATA/REGISTER');
        s.by = 'counterparty';
        await s.reload();
        assert.equal(s.error, '');
        assert.deepEqual(s.displayRows.map(r => r.label), ['62 Расчёты с покупателями', 'ООО «Альфа»', '90 Продажи']);
        assert.equal(s.totals.close_debit, s.totals.close_credit, 'итоги сходятся');

        const c = await form(`${REG}/$account/handlers/pages/form/postings/$handler/postings.js`, '/DATA/REGISTER/62');
        await c.loadSlots();
        assert.deepEqual(c.slots.map(x => [x.id, x.catalog]), [['counterparty', '/DATA/CATALOGS/SUBJECTS']]);
        c.filters = { counterparty: alpha.id };
        await c.reload();
        assert.equal(c.error, '');
        assert.deepEqual(c.displayRows.map(r => r.corr), ['90 Продажи', '90 Продажи', '90 Продажи']);
        assert.deepEqual(c.displayRows.map(r => r.slots), [['ООО «Альфа»'], ['ООО «Альфа»'], ['ООО «Альфа»']]);
        assert.match(c.closingText, /^600,00 Дт$/);

        // форма состава регистрирует окно правки (ODA) при импорте — в node достаточно заглушки
        globalThis.ODA ??= def => def;
        const v = await form('MODULES/Register/CATALOGS/$catalog/$folder/$class/$virtual/handlers/pages/form/virtual/$handler/virtual.js', '/DATA/CATALOGS/CLIENTS');
        await v.loadSlots();
        await v.reload();
        assert.equal(v.error, '');
        assert.deepEqual(v.slots, [{ id: 'discount', label: 'discount' }]);
        assert.deepEqual(v.displayRows.map(r => r.name), ['ООО «Альфа»']);
        assert.equal(v.registry.path, '/DATA/CATALOGS/SUBJECTS');
        // правка расширения: создание записи, затем замена с версией
        assert.ok(v.startEdit({ id: alpha.id }));
        v.editing.data.discount = 7;
        assert.equal(await v.saveExt(), true, v.error);
        await v.reload();
        assert.deepEqual(v.displayRows[0].slots, ['7']);
        v.startEdit({ id: alpha.id });
        assert.equal(v.editing.ext.version, 1);
        v.editing.data.discount = 9;
        assert.equal(await v.saveExt(), true, v.error);
        await v.reload();
        assert.deepEqual(v.displayRows[0].slots, ['9']);
    });

    it('закрытие периода — только ADMIN', async () => {
        const regItem = await item('/DATA/REGISTER');
        await assert.rejects(invoke(regItem, 'db_close_period', { day: d('01-31'), ...as(USER1) }), /Доступ запрещён/);
        assert.deepEqual(await invoke(regItem, 'db_close_period', { day: d('01-31'), ...as(ADMIN) }), { closed_until: d('01-31') });
        assert.deepEqual(await regItem.db_close_period(as(ADMIN)), { closed_until: d('01-31') });
        const cls = await item('/DATA/OPERATIONS/SALE');
        const late = await cls.db_create({ time: d('01-15'), post: { client: alpha.id, sum: 1 }, ...as(USER1) });
        await assert.rejects(cls.db_register({ id: late.id, ...as(USER1) }), /закрыт/);
        assert.deepEqual(await regItem.db_close_period({ day: '', ...as(ADMIN) }), { closed_until: null });
    });

    it('новый класс и правка class.js видны без рестарта', async () => {
        const catalogs = await item('/DATA/CATALOGS');
        await catalogs.create({ id: 'GOODS', type: '$catalog', ...as(ADMIN),
            post: `export default { label: 'Товары', ${SEC}, METADATA: { FIELDS: [{ id: 'name', required: true }] } }` });
        const goods = await item('/DATA/CATALOGS/GOODS');
        const oil = await goods.db_create({ post: { name: 'Масло' }, ...as(USER1) });
        assert.equal(oil.title, 'Масло');
        await goods.meta_folder.save_file({ filename: 'class.js', post: `export default { label: 'Товары', ${SEC}, METADATA: { FIELDS: [
            { id: 'name', required: true }, { id: 'base_unit' }] } }`, ...as(ADMIN) });
        const { schema, errors } = await goods.db_schema(as(USER1));
        assert.deepEqual(schema.fields.map(f => f.id), ['name', 'base_unit']);
        assert.deepEqual(errors, []);
    });

    it('у класса с объектами нельзя создать дочерний класс того же типа (инвариант листа)', async () => {
        const subjects = await item('/DATA/CATALOGS/SUBJECTS');
        await assert.rejects(subjects.create({ id: 'LEGAL', type: '$catalog', ...as(ADMIN), post: `export default { label: 'Юр. лица', ${SEC} }` }),
            /есть объекты/);
        const catalogs = await item('/DATA/CATALOGS');
        await catalogs.create({ id: 'EMPTY', type: '$catalog', ...as(ADMIN), post: `export default { label: 'Пустой', ${SEC} }` });
        const empty = await item('/DATA/CATALOGS/EMPTY');
        await empty.create({ id: 'SUB', type: '$catalog', ...as(ADMIN), post: `export default { label: 'Подкласс', ${SEC} }` });
        assert.ok(await item('/DATA/CATALOGS/EMPTY/SUB'), 'у класса без объектов — можно');
    });

    it('изоляция БД организаций ($base) в /ORGANIZATIONS и наследование по Ancestor', async () => {
        for (const p of ['$server/$folder/$class/$structure', '$server/$folder/$class/$structure/$base'])
            write(p + '/class.js', 'export default {}');
        cls('ORGANIZATIONS', '$domain', `{ label: 'Организации', ${SEC} }`);
        for (const [org, label] of [['ORG_A', 'А'], ['ORG_B', 'Б']]) {
            cls(`ORGANIZATIONS/${org}`, '$base', `{ label: 'Организация ${label}', ${SEC} }`);
            cls(`ORGANIZATIONS/${org}/DATA`, '$domain', `{ label: 'Данные ${label}', ${SEC} }`);
            cls(`ORGANIZATIONS/${org}/DATA/CATALOGS`, '$catalog', `{ label: 'Справочники ${label}', ${SEC} }`);
            cls(`ORGANIZATIONS/${org}/DATA/CATALOGS/SUBJECTS`, '$catalog', `{ label: 'Субъекты ${label}', ${SEC} }`);
        }
        globalThis.WORK.reset();

        const subjA = await item('/ORGANIZATIONS/ORG_A/DATA/CATALOGS/SUBJECTS');
        const subjB = await item('/ORGANIZATIONS/ORG_B/DATA/CATALOGS/SUBJECTS');

        // Поле name унаследовано по Ancestor от /DATA/CATALOGS/SUBJECTS
        const schemaA = await subjA.db_schema(as(USER1));
        assert.equal(schemaA.schema.ancestor, '/DATA/CATALOGS/SUBJECTS');
        assert.ok(schemaA.schema.fields.some(f => f.id === 'name' && f.required));

        const objA = await subjA.db_create({ post: { name: 'Только в А' }, ...as(USER1) });
        const objB = await subjB.db_create({ post: { name: 'Только в Б' }, ...as(USER1) });

        const listA = await subjA.db_query(as(USER1));
        const listB = await subjB.db_query(as(USER1));
        assert.deepEqual(listA.items.map(o => o.title), ['Только в А']);
        assert.deepEqual(listB.items.map(o => o.title), ['Только в Б']);
        assert.notEqual(objA.id, objB.id);

        assert.ok(fs.existsSync(path.join(tmp, 'ORGANIZATIONS/ORG_A/$base/#system/work.db')), 'БД внутри папки ORG_A');
        assert.ok(fs.existsSync(path.join(tmp, 'ORGANIZATIONS/ORG_B/$base/#system/work.db')), 'БД внутри папки ORG_B');
    });

    it('матрица вложенности типов (allowed_child_types): запрет абстрактного $class и чужих типов в контейнерах', async () => {
        copy('ORGANIZATIONS/$domain/$folder/$class/$base/class.js');
        copy('MODULES/$domain/class.js');
        copy('MODULES/$domain/$folder/$class/$module/class.js');
        globalThis.WORK.reset();

        // 1. В корне $server разрешены только домены ($domain)
        const sys = { session: { $user: globalThis.WORK } };
        assert.deepEqual(await globalThis.WORK.allowed_child_types, ['$domain']);
        await assert.rejects(globalThis.WORK.create({ id: 'BAD_CLS', type: '$class', ...sys }), /абстрактный/);
        await assert.rejects(globalThis.WORK.create({ id: 'BAD_CAT', type: '$catalog', ...sys }), /нельзя создать тип \$catalog/);
        await globalThis.WORK.create({ id: 'CUSTOM_DOM', type: '$domain', ...sys });
        const customDom = await item('/CUSTOM_DOM');
        assert.equal(customDom.type, '$domain');

        // 2. В домене /ORGANIZATIONS ($domain) разрешены $base (и группирующий $domain), но не $catalog/$module/$class
        const orgs = await item('/ORGANIZATIONS');
        assert.equal(orgs.type, '$domain');
        assert.deepEqual(await orgs.allowed_child_types, ['$base', '$domain']);
        await assert.rejects(orgs.create({ id: 'BAD_MOD', type: '$module', ...as(ADMIN) }), /нельзя создать тип \$module/);
        await assert.rejects(orgs.create({ id: 'BAD_CLS', type: '$class', ...as(ADMIN) }), /абстрактный/);
        await orgs.create({ id: 'ORG_C', ...as(ADMIN), post: `export default { label: 'Орг С', ${SEC} }` });
        const orgC = await item('/ORGANIZATIONS/ORG_C');
        assert.equal(orgC.type, '$base', 'по умолчанию в ORGANIZATIONS создаётся $base');

        // 3. Внутри $base разрешены $structure, $base, $domain, $module, но не $account или $class
        assert.deepEqual(await orgC.allowed_child_types, ['$structure', '$base', '$domain', '$module']);
        await assert.rejects(orgC.create({ id: 'ACC', type: '$account', ...as(ADMIN) }), /нельзя создать тип \$account/);
        await orgC.create({ id: 'SALES', type: '$structure', ...as(ADMIN), post: `export default { label: 'Отдел продаж', ${SEC} }` });
        const sales = await item('/ORGANIZATIONS/ORG_C/SALES');
        assert.equal(sales.type, '$structure');

        // 4. Внутри $structure разрешены только вложенные $structure
        assert.deepEqual(await sales.allowed_child_types, ['$structure']);
        await assert.rejects(sales.create({ id: 'SUB_BASE', type: '$base', ...as(ADMIN) }), /нельзя создать тип \$base/);
        await sales.create({ id: 'GROUP1', ...as(ADMIN), post: `export default { label: 'Группа 1', ${SEC} }` });
        assert.equal((await item('/ORGANIZATIONS/ORG_C/SALES/GROUP1')).type, '$structure');

        // 5. Внутри $virtual дочерние классы запрещены (конечный лист)
        const clients = await item('/DATA/CATALOGS/CLIENTS');
        assert.deepEqual(await clients.allowed_child_types, []);
        await assert.rejects(clients.create({ id: 'VIP', type: '$virtual', ...as(ADMIN) }), /нельзя создать/);

        // 6. Создание новой организации ($base) с подключением модуля ($module) из /MODULES
        write('MODULES/MiniReg/$module/class.js', `export default { label: 'Мини-учёт', icon: 'carbon:package' }`);
        write('MODULES/MiniReg/$module/$folder/$class/$catalog/class.js', `export default { label: 'Справочник' }`);
        write('MODULES/MiniReg/CATALOGS/$catalog/class.js', `export default { label: 'Справочники', $public: { form: 'objects' } }`);
        write('MODULES/MiniReg/CATALOGS/$catalog/$folder/$class/$catalog/class.js', `export default { label: 'Справочник' }`);
        write('MODULES/MiniReg/CATALOGS/ITEMS/$catalog/class.js', `export default { label: 'Товары', ${SEC}, METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
        globalThis.WORK.reset();

        await orgs.create({ id: 'ORG_NEW', label: 'ООО «Ромашка»', modules: 'MiniReg', ...as(ADMIN), post: `export default { label: 'ООО «Ромашка»', ${SEC} }` });
        const orgNewItems = await item('/ORGANIZATIONS/ORG_NEW/MODULES/MiniReg/CATALOGS/ITEMS');
        assert.ok(orgNewItems, 'каркас классов модуля развёрнут внутри новой организации');
        assert.equal(orgNewItems.type, '$catalog');
        const schemaNew = await orgNewItems.db_schema(as(ADMIN));
        assert.equal(schemaNew.schema.ancestor, '/MODULES/MiniReg/CATALOGS/ITEMS');
        assert.ok(schemaNew.schema.fields.some(f => f.id === 'name' && f.required));
        const createdItem = await orgNewItems.db_create({ post: { name: 'Товар Ромашки' }, ...as(ADMIN) });
        assert.equal(createdItem.title, 'Товар Ромашки');
        assert.ok(fs.existsSync(path.join(tmp, 'ORGANIZATIONS/ORG_NEW/$base/#system/work.db')));
    });

    it('инструменты ИИ-агента (describe_class, find_objects, register_operation, report) и сквозная цепочка ODANT', async () => {
        const { accountingTools } = await import('../sources/modules/agent/tools/work.js');
        const byName = Object.fromEntries(accountingTools.map(t => [t.name, t]));
        assert.deepEqual(Object.keys(byName), ['describe_class', 'find_objects', 'register_operation', 'report']);

        const ctx = { session: as(USER1).session, place: await item('/DATA') };

        // 1. describe_class
        const desc = await byName.describe_class.run({ path: '/DATA/OPERATIONS/SALE' }, ctx);
        assert.equal(desc.schema.cid, '/DATA/OPERATIONS/SALE');
        assert.equal(desc.schema.postings.length, 1);

        // 2. find_objects
        const found = await byName.find_objects.run({ path: '/DATA/CATALOGS/SUBJECTS', search: 'Альфа' }, ctx);
        assert.equal(found.items.length, 1);
        assert.equal(found.items[0].id, alpha.id);

        // 3. register_operation: подтверждение (ask) на запись, allow на preview
        assert.equal((await byName.register_operation.permission({ path: '/DATA/OPERATIONS/SALE', action: 'preview' })).verdict, 'allow');
        assert.equal((await byName.register_operation.permission({ path: '/DATA/OPERATIONS/SALE', action: 'register' })).verdict, 'ask');

        const preview = await byName.register_operation.run({
            path: '/DATA/OPERATIONS/SALE', action: 'preview', time: d('02-15'), body: { client: alpha.id, sum: 300 },
        }, ctx);
        assert.equal(preview.entries[0].amount, 300);

        const regOp = await byName.register_operation.run({
            path: '/DATA/OPERATIONS/SALE', action: 'register', time: d('02-15'), body: { client: alpha.id, sum: 300 },
        }, ctx);
        assert.equal(regOp.status, 'registered');

        // 4. report: Общая ОСВ (sheet) → Двухпанельные Обороты (turnovers) → Карточка проводки (entry)
        const tb = await byName.report.run({ path: '/DATA/REGISTER', kind: 'sheet', by: ['counterparty'] }, ctx);
        assert.equal(tb.total.closing.debit, 900); // 600 + 300

        const turns = await byName.report.run({
            path: '/DATA/REGISTER/62', kind: 'turnovers', groupBy: 'quarter', analytics: { counterparty: alpha.id },
        }, ctx);
        assert.equal(turns.groups.length, 1);
        assert.equal(turns.groups[0].debit, 900);
        assert.ok(turns.items.length >= 2);

        const entryId = turns.items.at(-1).entry;
        const entryCard = await byName.report.run({ path: '/DATA/REGISTER/62', kind: 'entry', entry: entryId }, ctx);
        assert.equal(entryCard.entry, entryId);
        assert.equal(entryCard.amount, 300);
        assert.equal(entryCard.debit.account, '/DATA/REGISTER/62');
        assert.equal(entryCard.credit.account, '/DATA/REGISTER/90');

        // 5. Глобальный поиск (search_tree): возвращает только доступные пользователю элементы и объекты
        const dataDom = await item('/DATA');
        const sUser = await invoke(dataDom, 'search_tree', { q: 'Альфа', ...as(USER1) });
        assert.ok(sUser.objects.some(o => o.id === alpha.id), 'USER1 видит объект ООО «Альфа»');
        const sNobody = await invoke(dataDom, 'search_tree', { q: 'Альфа', ...as(NOBODY) });
        assert.equal(sNobody.objects.length, 0, 'посторонний не видит объекты');
        assert.equal(sNobody.nodes.length, 0, 'посторонний не видит узлы');
    });
});
