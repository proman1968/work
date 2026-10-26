/**
 * Видимость данных учётного ядра по scope ссылок рабочих мест (sources/data/scope.js, Р8):
 * подразделение и место при создании, выборки и отчёты по подразделению, месту и автору,
 * BOSS — подразделение на чтение, сводные отчёты предка по видимым веткам, состав виртуального
 * справочника и поиск по его реестру.
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
import { scopeGrants, resolvePlace } from '../sources/data/scope.js';
import { normalizeLink } from '../sources/server/access/workplaces.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN = 'SA000000000001', N1 = 'SN000000000001', J1 = 'SJ000000000001', S1 = 'SS000000000001',
    M1 = 'SM000000000001', BOSS = 'SB000000000001', NOBODY = 'SX000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });
const Y = new Date().getFullYear() - 1;
const d = md => `${Y}-${md}`;
const NORTH = '/BASE/NORTH', SOUTH = '/BASE/SOUTH';
const SALE = '/DATA/OPERATIONS/SALE';

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

const copy = rel => write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
const cls = (rel, type, body) => write(`${rel}/${type}/class.js`, `export default ${body}`);
const item = p => WORK.get_item(p);
const ids = res => res.items.map(o => o.id).sort();

const SALES_LINKS = `[
    { id: '${SALE}', access: 'write' },
    { id: '/DATA/CATALOGS/SUBJECTS', access: 'write' },
    { id: '/DATA/CATALOGS/CLIENTS', access: 'read', scope: 'unit' },
    { id: '/DATA/REGISTER/62', access: 'read' }]`;

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-data-scope-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    for (const uid of [ADMIN, N1, J1, S1, M1, BOSS, NOBODY])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${uid}' }`);
    copy('DATA/$domain/class.js');
    for (const t of ['$catalog', '$virtual'])
        copy(`DATA/CATALOGS/$catalog/$folder/$class/${t}/class.js`);
    for (const t of ['$register', '$account'])
        copy(`DATA/REGISTER/$register/$folder/$class/${t}/class.js`);
    copy('DATA/OPERATIONS/$operation/$folder/$class/$operation/class.js');

    cls('BASE/NORTH', '$structure', `{ label: 'Север', '#security': { BOSS: ['${BOSS}'], ROLES: [
        { id: 'sales', label: 'Продажи', USERS: ['${N1}', '${M1}'], LINKS: ${SALES_LINKS},
            ROLES: [{ id: 'junior', label: 'Стажёр', USERS: ['${J1}'], LINKS: [
                { id: '${SALE}', access: 'write', scope: 'own' }, { id: '/DATA/CATALOGS/SUBJECTS', access: 'read' }] }] }] } }`);
    cls('BASE/SOUTH', '$structure', `{ label: 'Юг', '#security': { ROLES: [
        { id: 'sales', label: 'Продажи', USERS: ['${S1}', '${M1}'], LINKS: ${SALES_LINKS} }] } }`);

    cls('DATA/CATALOGS', '$catalog', `{ label: 'Справочники' }`);
    cls('DATA/CATALOGS/SUBJECTS', '$catalog', `{ label: 'Субъекты', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
    cls('DATA/CATALOGS/CLIENTS', '$virtual', `{ label: 'Клиенты', SOURCE: { registry: '/DATA/CATALOGS/SUBJECTS', account: '/DATA/REGISTER/62' } }`);
    cls('DATA/REGISTER', '$register', `{ label: 'Журнал' }`);
    cls('DATA/REGISTER/62', '$account', `{ label: 'Расчёты с покупателями', METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', catalog: '/DATA/CATALOGS/SUBJECTS', analytic: true, required: true }] } }`);
    cls('DATA/REGISTER/90', '$account', `{ label: 'Продажи' }`);
    cls('DATA/OPERATIONS', '$operation', `{ label: 'Операции' }`);
    cls('DATA/OPERATIONS/SALE', '$operation', `{ label: 'Продажа', METADATA: {
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

describe('scope: правила без сервера', () => {
    let db;
    const op = { cid: '/D/OPS', path: '/D/OPS', type: '$operation' };
    before(async () => {
        db = await openDataDb(':memory:');
        syncClasses(db, [
            ['/BASE/N', '$structure', 'N'], ['/D/OPS', '$operation', 'Операции'],
            ['/D/OPS/SALE', '$operation', 'Продажа'], ['/D/OTHER', '$operation', 'Прочие'],
        ].map(([p, type, label]) => ({ cid: p, path: p, type, label, own: {} })));
    });
    after(() => db?.close());
    const link = x => ({ structure: '/BASE/N', place: 'sales', id: '/D/OPS', access: 'write', scope: null, relation: 'member', places: ['sales'], ...x });

    it('scope ссылки и отношение пользователя → права', () => {
        assert.deepEqual(scopeGrants(db, op, [link()], { uid: 'u' }), [{ units: ['/BASE/N'] }], 'операции по умолчанию — подразделение');
        assert.deepEqual(scopeGrants(db, op, [link({ scope: 'place' })], { uid: 'u' }), [{ places: [['/BASE/N', 'sales']] }]);
        assert.deepEqual(scopeGrants(db, op, [link({ scope: 'own' })], { uid: 'u' }), [{ author: 'u' }]);
        assert.deepEqual(scopeGrants(db, op, [link({ scope: 'own', relation: 'ancestor', place: 'sales/junior' })], { uid: 'u' }),
            [{ places: [['/BASE/N', 'sales/junior']] }], 'вышестоящее место видит вложенное место');
        assert.deepEqual(scopeGrants(db, op, [link({ scope: 'own', relation: 'boss' })], { uid: 'u' }), [{ units: ['/BASE/N'] }]);
        assert.equal(scopeGrants(db, op, [link({ scope: 'all' })], { uid: 'u' }), null);
        assert.equal(scopeGrants(db, op, [link({ relation: 'admin' })], { uid: 'u' }), null);
        assert.deepEqual(scopeGrants(db, op, [link({ access: 'read' })], { uid: 'u', write: true }), [], 'для записи — только ссылки на запись');
        assert.deepEqual(scopeGrants(db, op, [link({ id: '/D/OPS/SALE' })], { uid: 'u' }), [{ cids: ['/D/OPS/SALE'], units: ['/BASE/N'] }],
            'ссылка ниже класса — только её ветка');
        assert.deepEqual(scopeGrants(db, op, [link({ id: '/D/OTHER' })], { uid: 'u' }), [], 'боковая ветка — мимо');
    });

    it('scope в ссылке места: известные значения сохраняются, прочие отбрасываются', () => {
        assert.deepEqual(normalizeLink({ id: '/X', access: 'read', scope: 'own' }), { id: '/X', access: 'read', scope: 'own' });
        assert.deepEqual(normalizeLink({ id: '/X', access: 'read', scope: 'всё' }), { id: '/X', access: 'read' });
    });

    it('подразделение и место записи', () => {
        const ctx = [{ unit: '/BASE/N', unit_label: 'N', place: 'sales', place_label: 'Продажи' }];
        assert.deepEqual(resolvePlace(db, ctx, {}), { unit: '/BASE/N', place: 'sales' });
        assert.throws(() => resolvePlace(db, [...ctx, { ...ctx[0], place: 'buy', place_label: 'Закупки' }], {}), /укажите подразделение и место записи: N \/ Продажи; N \/ Закупки/);
        assert.deepEqual(resolvePlace(db, [], {}, { full: true }), { unit: null, place: null });
        assert.throws(() => resolvePlace(db, ctx, { place: 'sales' }), /вместе с подразделением/);
    });
});

describe('видимость данных по scope ссылок рабочих мест', () => {
    let alpha, beta, saleN, saleJ, saleS;

    it('создание: подразделение и место — из места записи пользователя', async () => {
        const subjects = await item('/DATA/CATALOGS/SUBJECTS');
        alpha = await invoke(subjects, 'db_create', { post: JSON.stringify({ name: 'ООО «Альфа»' }), ...as(N1) });
        assert.deepEqual([alpha.unit, alpha.place], [NORTH, 'sales']);
        beta = await invoke(subjects, 'db_create', { post: { name: 'ООО «Бета»' }, ...as(S1) });
        assert.deepEqual([beta.unit, beta.place], [SOUTH, 'sales']);
        assert.deepEqual(ids(await invoke(subjects, 'db_query', as(S1))), [alpha.id, beta.id].sort(), 'справочник по умолчанию — все');

        const sale = await item(SALE);
        saleN = await invoke(sale, 'db_create', { time: d('03-01'), post: { client: alpha.id, sum: 100 }, ...as(N1) });
        saleJ = await invoke(sale, 'db_create', { time: d('03-02'), post: { client: alpha.id, sum: 10 }, ...as(J1) });
        saleS = await invoke(sale, 'db_create', { time: d('03-03'), post: { client: beta.id, sum: 1000 }, ...as(S1) });
        assert.deepEqual([saleJ.unit, saleJ.place], [NORTH, 'sales/junior']);
        for (const [o, uid] of [[saleN, N1], [saleJ, J1], [saleS, S1]])
            await invoke(sale, 'db_register', { id: o.id, ...as(uid) });
    });

    it('создание: чужое подразделение, неизвестное место, несколько мест, BOSS', async () => {
        const sale = await item(SALE);
        const body = { post: { client: alpha.id, sum: 1 } };
        await assert.rejects(invoke(sale, 'db_create', { ...body, unit: SOUTH, ...as(N1) }), /нет права записи от подразделения «Юг»/);
        await assert.rejects(invoke(sale, 'db_create', { ...body, unit: NORTH, place: 'nope', ...as(N1) }), /место nope не найдено в «Север»/);
        await assert.rejects(invoke(sale, 'db_create', { ...body, unit: NORTH, place: 'sales', ...as(J1) }), /нет права записи от места «sales»/);
        await assert.rejects(invoke(sale, 'db_create', { ...body, ...as(M1) }), /укажите подразделение и место записи: Север \/ Продажи; Юг \/ Продажи/);
        const m = await invoke(sale, 'db_create', { ...body, unit: SOUTH, ...as(M1) });
        assert.deepEqual([m.unit, m.place], [SOUTH, 'sales'], 'место — единственное в подразделении');
        await invoke(sale, 'db_delete', { id: m.id, ...as(M1) });
        await assert.rejects(invoke(sale, 'db_create', { ...body, ...as(BOSS) }), /Доступ запрещён/);
        const scope = await invoke(sale, 'db_scope', as(M1));
        assert.equal(scope.all, false);
        assert.deepEqual(scope.units.map(u => u.label).sort(), ['Север', 'Юг']);
        assert.deepEqual(scope.contexts.map(c => [c.unit, c.place, c.place_label]), [[NORTH, 'sales', 'Продажи'], [SOUTH, 'sales', 'Продажи']]);
        assert.equal((await invoke(sale, 'db_scope', as(ADMIN))).all, true);
    });

    it('выборки: подразделение, вышестоящее место, свои, BOSS, ADMIN', async () => {
        const sale = await item(SALE);
        assert.deepEqual(ids(await invoke(sale, 'db_query', as(N1))), [saleN.id, saleJ.id].sort());
        assert.deepEqual(ids(await invoke(sale, 'db_query', as(S1))), [saleS.id]);
        assert.deepEqual(ids(await invoke(sale, 'db_query', as(J1))), [saleJ.id], 'scope own — только свои');
        assert.deepEqual(ids(await invoke(sale, 'db_query', as(BOSS))), [saleN.id, saleJ.id].sort(), 'BOSS — подразделение на чтение');
        assert.equal((await invoke(sale, 'db_query', as(ADMIN))).total, 3);
        await assert.rejects(invoke(sale, 'db_read', { id: saleS.id, ...as(N1) }), /не найден/);
        await assert.rejects(invoke(sale, 'db_cancel', { id: saleS.id, ...as(N1) }), /не найден/);
        await assert.rejects(invoke(sale, 'db_cancel', { id: saleN.id, ...as(J1) }), /не найден/, 'стажёр не правит чужие');
        await assert.rejects(invoke(sale, 'db_query', as(NOBODY)), /Доступ запрещён/);
    });

    it('отчёты: карточка счёта по подразделению; сводные отчёты предка — по видимым веткам', async () => {
        const acc62 = await item('/DATA/REGISTER/62');
        assert.deepEqual((await invoke(acc62, 'db_card', as(N1))).items.map(i => i.debit), [100, 10]);
        assert.deepEqual((await invoke(acc62, 'db_card', as(S1))).items.map(i => i.debit), [1000]);
        assert.deepEqual((await invoke(acc62, 'db_card', as(BOSS))).items.map(i => i.debit), [100, 10]);

        const reg = await item('/DATA/REGISTER');
        const sheet = await invoke(reg, 'db_sheet', as(N1));
        assert.deepEqual(sheet.rows.map(r => [r.account, r.closing.debit]), [['/DATA/REGISTER/62', 110]], 'счёт 90 — вне ссылок');
        const all = await invoke(reg, 'db_sheet', as(ADMIN));
        assert.deepEqual(all.rows.map(r => r.account), ['/DATA/REGISTER/62', '/DATA/REGISTER/90']);
        assert.equal((await invoke(reg, 'db_journal', as(S1))).total, 1);

        const ops = await item('/DATA/OPERATIONS');
        assert.deepEqual((await invoke(ops, 'db_journal', { effective: 'true', ...as(N1) })).items.map(e => e.amount), [100, 10]);
        assert.deepEqual((await invoke(ops, 'db_query', as(J1))).items.map(o => o.id), [saleJ.id]);
        await assert.rejects(invoke(ops, 'db_journal', as(NOBODY)), /Доступ запрещён/);

        const subjects = await item('/DATA/CATALOGS/SUBJECTS');
        assert.deepEqual((await invoke(subjects, 'db_state', { id: alpha.id, ...as(S1) })).balances.map(b => b.debit), [110],
            'справочник со scope all — сальдо объекта целиком');
    });

    it('виртуальный справочник: состав по подразделению, поиск — по видимому реестру', async () => {
        const clients = await item('/DATA/CATALOGS/CLIENTS');
        assert.deepEqual((await invoke(clients, 'db_members', as(N1))).items.map(m => [m.id, m.balance.debit]), [[alpha.id, 110]]);
        assert.deepEqual((await invoke(clients, 'db_members', as(S1))).items.map(m => m.id), [beta.id]);
        assert.equal((await invoke(clients, 'db_members', as(ADMIN))).items.length, 2);
        const choices = await invoke(clients, 'db_choices', { search: 'ооо', ...as(S1) });
        assert.deepEqual(choices.items.map(i => [i.id, i.member]), [[beta.id, true], [alpha.id, false]], 'чужой клиент находится как субъект');
        assert.equal((await invoke(clients, 'db_read', { id: alpha.id, ...as(S1) })).title, 'ООО «Альфа»');
    });

    /** Обработчик формы с $item.fetch как по HTTP (параметры строками) от имени uid. */
    const form = async (rel, target, uid) => {
        globalThis.ODA ??= def => def;
        const h = Object.create((await import(`../${rel}`)).default);
        const it = await item(target);
        h.$item = { fetch: (m, p = {}, post) => invoke(it, m, {
            ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])),
            ...(post !== undefined ? { post: JSON.stringify(post) } : {}),
            ...as(uid),
        }) };
        return h;
    };
    const REG = 'DATA/REGISTER/$register/$folder/$class';

    it('форма объектов: место записи из нескольких, фильтр подразделения', async () => {
        const f = await form('$server/$folder/$class/handlers/pages/form/objects/$handler/objects.js', SALE, M1);
        await f.loadSchema();
        await f.loadScope();
        assert.equal(f.showContext, true);
        assert.deepEqual(f.units.map(u => u.cid).sort(), [NORTH, SOUTH]);
        assert.equal(f.contextTitle(f.context), 'Север / Продажи', 'по умолчанию — первое место');
        f.contextKey = f.contextKeyOf(f.contexts.find(c => c.unit === SOUTH));
        f.editing = { time: d('04-01'), client: beta.id, sum: 5 };
        assert.deepEqual(f.writeParams(), { unit: SOUTH, place: 'sales', time: d('04-01') });
        assert.equal(await f.save(), true, f.error);
        f.unitFilter = SOUTH;
        await f.reload();
        assert.equal(f.error, '');
        assert.ok(f.rows.length >= 2 && f.rows.every(r => r.id !== saleN.id), 'только Юг');
        await invoke(await item(SALE), 'db_delete', { id: f.editing.id, ...as(M1) });

        const single = await form('$server/$folder/$class/handlers/pages/form/objects/$handler/objects.js', SALE, N1);
        await single.loadScope();
        assert.equal(single.showContext, false, 'одно место — без выбора');
        assert.equal(single.units.length, 1, 'одно подразделение — фильтр не показывается');
    });

    it('формы отчётов: фильтр подразделения из видимых', async () => {
        const j = await form(`${REG}/$register/handlers/pages/form/journal/$handler/journal.js`, '/DATA/REGISTER', M1);
        await j.loadScope();
        assert.deepEqual(j.units.map(u => u.label).sort(), ['Север', 'Юг']);
        await j.reload();
        assert.equal(j.items.length, 3);
        j.unit = SOUTH;
        await j.reload();
        assert.deepEqual(j.items.map(e => e.amount), [1000]);

        const s = await form(`${REG}/$register/handlers/pages/form/sheet/$handler/sheet.js`, '/DATA/REGISTER', M1);
        await s.loadScope();
        s.unit = NORTH;
        await s.reload();
        assert.equal(s.error, '');
        assert.equal(s.total.closing.debit, 110);

        const c = await form(`${REG}/$account/handlers/pages/form/postings/$handler/postings.js`, '/DATA/REGISTER/62', M1);
        await c.loadScope();
        c.unit = SOUTH;
        await c.reload();
        assert.equal(c.error, '');
        assert.match(c.closingText, /^1\s?000,00 Дт$/);
    });
});
