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

const copy = rel => write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
const cls = (rel, type, body) => write(`${rel}/${type}/class.js`, `export default ${body}`);
const item = p => WORK.get_item(p);

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-data-api-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Продавец'], [NOBODY, 'Чужой']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    copy('DATA/$class/class.js');
    for (const t of ['$catalog', '$virtual', '$registry'])
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
        sale = await invoke(cls, 'db_create', { time: d('02-01'), post: { client: alpha.id, sum: 500 }, ...as(USER1) });
        assert.equal(sale.status, 'draft');
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
        const REG = 'DATA/REGISTER/$register/$folder/$class';
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
        const v = await form('DATA/CATALOGS/$catalog/$folder/$class/$virtual/handlers/pages/form/virtual/$handler/virtual.js', '/DATA/CATALOGS/CLIENTS');
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
});
