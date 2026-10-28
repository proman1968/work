import '../sources/reactor.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { $server } from '../sources/server/server.js';
import { openDataDb } from '../sources/data/db.js';
import { refreshClasses } from '../sources/data/classes.js';
import { checkSchema } from '../sources/data/schema.js';
import { queryObjects } from '../sources/data/objects.js';
import { trialBalance, accountTurnovers, accountCard, virtualMembers, readEntry } from '../sources/data/reports.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORG_BASE = '/ORGANIZATIONS/Деловая сфера';
const REG = `${ORG_BASE}/MODULES/Register`;
const DB_FILE = path.join(ROOT_DIR, 'ORGANIZATIONS', 'Деловая сфера', '$base', '#system', 'work.db');

const HAS_DELOVAYA = fs.existsSync(path.join(ROOT_DIR, 'ORGANIZATIONS', 'Деловая сфера', '$base', 'class.js'));

describe('Миграция ООО МА «Деловая сфера» (ODANT -> WORK)', { skip: !HAS_DELOVAYA }, () => {
    before(async () => {
        globalThis.WORK ??= new $server();
        await WORK.init;
    });

    it('каркас организации, подразделений, рабочих мест и 20 рабочих счетов развёрнут на диске', async () => {
        const orgItem = await WORK.get_item(ORG_BASE);
        assert.ok(orgItem, 'Узел /ORGANIZATIONS/Деловая сфера должен существовать');
        await orgItem.init;
        assert.equal(orgItem.type, '$base');
        assert.equal(orgItem.DATA.label, 'ООО МА «Деловая сфера»');
        assert.equal(orgItem.DATA.inn, '6227007668');
        assert.equal(orgItem.DATA.kpp, '623401001');
        assert.equal(orgItem.DATA.ogrn, '1026200871927');

        // Подразделения
        for (const sub of ['accounting', 'orders', 'hr', 'research']) {
            const unit = await WORK.get_item(`${ORG_BASE}/${sub}`);
            assert.ok(unit, `Подразделение ${sub} должно существовать`);
            await unit.init;
            assert.equal(unit.type, '$structure');
        }

        // Только рабочие счета в REGISTER
        const regItem = await WORK.get_item(`${REG}/REGISTER`);
        assert.ok(regItem, 'Журнал проводок должен существовать');
        const children = await regItem.children;
        const accIds = children.filter(c => c.type === '$account').map(c => c.id).sort();
        assert.deepEqual(accIds, ['01', '02', '08', '26', '50', '51', '60', '62', '68', '69', '70', '71', '73', '90', '99']);
    });

    it('все схемы классов Деловой сферы проходят checkSchema без ошибок', async () => {
        assert.ok(fs.existsSync(DB_FILE), 'work.db Деловой сферы должна быть создана');
        const db = await openDataDb(DB_FILE);
        try {
            await refreshClasses(db, ROOT_DIR);
            const cids = db.prepare('SELECT cid FROM classes WHERE path LIKE ?').all(`${ORG_BASE}/%`).map(r => r.cid);
            assert.ok(cids.length >= 50, `Ожидалось не менее 50 классов, найдено ${cids.length}`);
            for (const cid of cids) {
                const errs = checkSchema(db, cid);
                assert.deepEqual(errs, [], `Ошибки схемы у ${cid}: ${errs.join('; ')}`);
            }
        } finally {
            db.close();
        }
    });

    it('экранные обработчики (sheet, journal, turnovers, analysis, postings, virtual, objects) наследуются корректно', async () => {
        const viewsOf = async (item, role = 'USER') => {
            const root = await item.handlers({ path: '//form', role });
            return (root?.items || []).filter(i => i.type === '$handler' && i.usable !== false).map(i => i.id);
        };

        const regItem = await WORK.get_item(`${REG}/REGISTER`);
        const regIds = await viewsOf(regItem, 'USER');
        assert.ok(regIds.includes('sheet'), 'У REGISTER должен быть обработчик sheet');
        assert.ok(regIds.includes('journal'), 'У REGISTER должен быть обработчик journal');

        // Проверим как счёт 62 (есть в MODULES/Register), так и счёт 01 и 68/09 (специфичны для Деловой сферы)
        for (const code of ['62', '01', '68/09']) {
            const accItem = await WORK.get_item(`${REG}/REGISTER/${code}`);
            assert.ok(accItem, `Счёт ${code} должен существовать`);
            const hIds = await viewsOf(accItem, 'USER');
            assert.ok(hIds.includes('turnovers'), `У счёта ${code} должен быть обработчик turnovers`);
            assert.ok(hIds.includes('analysis'), `У счёта ${code} должен быть обработчик analysis`);
            assert.ok(hIds.includes('postings'), `У счёта ${code} должен быть обработчик postings`);
        }

        const virtItem = await WORK.get_item(`${REG}/CATALOGS/Клиенты`);
        const virtIds = await viewsOf(virtItem, 'USER');
        assert.ok(virtIds.includes('virtual'), 'У виртуального справочника Клиенты должен быть обработчик virtual');

        const ordersItem = await WORK.get_item(`${REG}/OPERATIONS/Заказы`);
        const ordersIds = await viewsOf(ordersItem, 'USER');
        assert.ok(ordersIds.includes('objects'), 'У класса Заказы должен быть обработчик objects');
    });

    it('данные справочников, документов и бухгалтерского журнала импортированы со 100% балансом ОСВ', async () => {
        if (!fs.existsSync(DB_FILE)) return;
        const db = await openDataDb(DB_FILE);
        try {
            await refreshClasses(db, ROOT_DIR);

            // Справочники
            const contractors = queryObjects(db, { cid: `${REG}/CATALOGS/Субъекты/Юр. лица`, limit: 1 });
            assert.ok(contractors.total >= 325, `Ожидалось >= 325 контрагентов, получено ${contractors.total}`);

            const orgList = queryObjects(db, { cid: `${REG}/CATALOGS/Список организаций`, limit: 1 });
            assert.equal(orgList.total, 2896);

            const interviewers = queryObjects(db, { cid: `${REG}/CATALOGS/Интервьюеры`, limit: 1 });
            assert.equal(interviewers.total, 231);

            // Первичные документы
            const orders = queryObjects(db, { cid: `${REG}/OPERATIONS/Заказы`, limit: 1 });
            assert.equal(orders.total, 2650);

            const payOrders = queryObjects(db, { cid: `${REG}/OPERATIONS/Платёжное поручение`, limit: 1 });
            assert.equal(payOrders.total, 2798);

            // ОСВ (trialBalance)
            const tb = trialBalance(db, { account: `${REG}/REGISTER` });
            assert.equal(tb.rows.length, 23);
            assert.equal(tb.total.turnover.debit, 152764401.39);
            assert.equal(tb.total.turnover.credit, 152764401.39);
            assert.equal(tb.total.closing.debit, 3345272.04);
            assert.equal(tb.total.closing.credit, 3345272.04);

            // Виртуальные справочники
            const clients = virtualMembers(db, { cid: `${REG}/CATALOGS/Клиенты` });
            assert.equal(clients.items.length, 63);

            const suppliers = virtualMembers(db, { cid: `${REG}/CATALOGS/Поставщики` });
            assert.equal(suppliers.items.length, 35);

            const employees = virtualMembers(db, { cid: `${REG}/CATALOGS/Сотрудники` });
            assert.equal(employees.items.length, 9);
            assert.ok(employees.items.some(e => e.title.includes('Перепелкина') && e.ext?.body?.position));

            // Обороты счёта и Карточка проводки
            const turn = accountTurnovers(db, { account: `${REG}/REGISTER/62`, groupBy: 'year' });
            assert.ok(turn.groups.length >= 15);
            assert.ok(turn.items.length > 0);

            const card = accountCard(db, { account: `${REG}/REGISTER/01` });
            assert.equal(card.closing.debit, 93285.84);

            const entry = readEntry(db, 1);
            assert.ok(entry?.debit?.account);
            assert.ok(entry?.credit?.account);
            assert.ok(entry?.operation?.id);
        } finally {
            db.close();
        }
    });
});

const BIS_BASE = '/ORGANIZATIONS/Бизнес Интер Софт';
const BIS_REG = `${BIS_BASE}/MODULES/Register`;
const BIS_DB_FILE = path.join(ROOT_DIR, 'ORGANIZATIONS', 'Бизнес Интер Софт', '$base', '#system', 'work.db');
const HAS_BIS = fs.existsSync(path.join(ROOT_DIR, 'ORGANIZATIONS', 'Бизнес Интер Софт', '$base', 'class.js'));

describe('Миграция ООО «Бизнес Интер Софт» (ODANT -> WORK)', { skip: !HAS_BIS }, () => {
    before(async () => {
        globalThis.WORK ??= new $server();
        await WORK.init;
    });

    it('каркас организации, подразделений, всех классов и изолированной БД развёрнут без ошибок схемы', async () => {
        const orgItem = await WORK.get_item(BIS_BASE);
        assert.ok(orgItem, 'Узел /ORGANIZATIONS/Бизнес Интер Софт должен существовать');
        await orgItem.init;
        assert.equal(orgItem.type, '$base');
        assert.equal(orgItem.DATA.label, 'ООО «Бизнес Интер Софт»');
        assert.equal(orgItem.DATA.inn, '6234049193');
        assert.equal(orgItem.DATA.kpp, '623401001');

        for (const sub of ['accounting', 'orders', 'hr', 'development']) {
            const unit = await WORK.get_item(`${BIS_BASE}/${sub}`);
            assert.ok(unit, `Подразделение ${sub} должно существовать`);
            await unit.init;
            assert.equal(unit.type, '$structure');
        }

        assert.ok(fs.existsSync(BIS_DB_FILE), 'work.db Бизнес Интер Софт должна быть создана');
        const db = await openDataDb(BIS_DB_FILE);
        try {
            await refreshClasses(db, ROOT_DIR);
            const cids = db.prepare('SELECT cid FROM classes WHERE path LIKE ?').all(`${BIS_BASE}/%`).map(r => r.cid);
            assert.ok(cids.length >= 80, `Ожидалось не менее 80 классов, найдено ${cids.length}`);
            for (const cid of cids) {
                const errs = checkSchema(db, cid);
                assert.deepEqual(errs, [], `Ошибки схемы у ${cid}: ${errs.join('; ')}`);
            }

            const tb = trialBalance(db, { account: `${BIS_REG}/REGISTER` });
            assert.equal(tb.rows.length, 47);
            assert.equal(tb.total.turnover.debit, 1282321088.85);
            assert.equal(tb.total.turnover.credit, 1282321088.85);
            assert.equal(tb.total.closing.debit, 115903865.71);
            assert.equal(tb.total.closing.credit, 115903865.71);
        } finally {
            db.close();
        }
    });
});

describe('Архивация $base и развёртывание из архива в /ORGANIZATIONS', () => {
    before(async () => {
        globalThis.WORK ??= new $server();
        await WORK.init;
    });

    it('хендлер «Архивация» у $base и «Загрузить из архива» у /ORGANIZATIONS: полный цикл упаковки и распаковки базы', async () => {
        const maslotorg = await WORK.get_item('/ORGANIZATIONS/Маслоторг');
        assert.ok(maslotorg, 'Организация Маслоторг должна существовать');
        const baseMethods = await maslotorg.handlers({ path: '/methods', role: 'BOSS' });
        const archiveHandler = (baseMethods?.items || []).find(i => i.id === 'archive');
        assert.ok(archiveHandler, 'У $base должен быть хендлер archive');
        assert.equal(archiveHandler.label, 'Архивация');
        assert.equal(!!archiveHandler.isService, false);

        const orgsDomain = await WORK.get_item('/ORGANIZATIONS');
        assert.ok(orgsDomain, 'Домен /ORGANIZATIONS должен существовать');
        const domainMethods = await orgsDomain.handlers({ path: '/methods', role: 'ADMIN' });
        const restoreHandler = (domainMethods?.items || []).find(i => i.id === 'restore');
        assert.ok(restoreHandler, 'У /ORGANIZATIONS должен быть хендлер restore');
        assert.equal(restoreHandler.label, 'Загрузить из архива');
        assert.equal(restoreHandler.isButton, true);

        // Полный цикл export_archive -> import_archive под новым именем
        const tempName = 'Маслоторг_Копия_Тест';
        const tempDir = path.join(ROOT_DIR, 'ORGANIZATIONS', tempName);
        const { closeBaseDb } = await import('../sources/data/db.js');
        try {
            const zipBuf = await maslotorg.export_archive({});
            assert.ok(Buffer.isBuffer(zipBuf) && zipBuf.length > 1000, 'export_archive должен вернуть непустой ZIP-буфер');
            assert.equal(zipBuf[0], 0x50);
            assert.equal(zipBuf[1], 0x4b);

            const imported = await orgsDomain.import_archive({
                name: tempName,
                post: zipBuf,
                session: { $user: WORK },
            });
            assert.equal(imported.ok, true);
            assert.equal(imported.id, tempName);
            assert.equal(imported.path, `/ORGANIZATIONS/${tempName}`);
            assert.ok(fs.existsSync(path.join(tempDir, '$base', 'class.js')), 'Паспорт $base/class.js должен быть распакован');
            assert.ok(fs.existsSync(path.join(tempDir, '$base', '#system', 'work.db')), 'БД work.db должна быть распакована');
        } finally {
            await closeBaseDb(`/ORGANIZATIONS/${tempName}`);
            if (fs.existsSync(tempDir))
                fs.rmSync(tempDir, { recursive: true, force: true });
            orgsDomain.reset();
        }
    });
});
