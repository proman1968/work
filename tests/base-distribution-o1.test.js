import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

process.env.WORK_TEST = '1';
process.env.WORK_NO_BROWSER = '1';
process.env.WORK_PREWARM = '0';
process.env.WORK_RAG = '0';
process.env.WORK_WATCH = '0';
process.env.WORK_RECOVER = '0';
process.env.WORK_SCHEDULE = '0';
process.env.WORK_NOTIFY = '0';
process.env.WORK_SWEEP = '0';
process.env.WORK_RESUME_DOWNLOADS = '0';

import '../sources/reactor.js';
globalThis.ODA ??= function () {};
import '../sources/server/index.js';
import { $server } from '../sources/server/server.js';
import { openDataDb, closeBaseDb } from '../sources/data/db.js';
import { refreshClasses, getClass, classesOfType, DATA_TYPES } from '../sources/data/classes.js';
import { checkSchema, classSchema, objectTitle } from '../sources/data/schema.js';
import { createObject } from '../sources/data/objects.js';
import { formatFio, fioAllFormats, detectGender } from '../sources/data/fio.js';
import { renderPrint } from '../sources/data/print.js';
import { trialBalance } from '../sources/data/reports.js';
import {
    buildBasePassportClassJs,
    scaffoldBaseOrganizationSync,
    seedBaseTemplateDemoData,
} from '../sources/server/class/base-template.js';
import {
    _setInvitesFileForTests,
    createInvite,
    inspectInvite,
    listPointInvites,
    revokeInvite,
    consumeInvite,
} from '../sources/server/access/invites.js';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('Очередь 1: Базовая поставка (ФИО падежи, чистый Register, пресеты, инвайты, npm pack)', () => {
    it('1. Склонение ФИО по 6 падежам + инициалы + интеграция в print.js и objectTitle', async () => {
        const male = { last_name: 'Перепелкин', first_name: 'Роман', middle_name: 'Александрович' };
        assert.equal(detectGender(male), 'm');
        assert.equal(formatFio(male, 'Именительный'), 'Перепелкин Роман Александрович');
        assert.equal(formatFio(male, 'Родительный'), 'Перепелкина Романа Александровича');
        assert.equal(formatFio(male, 'Дательный'), 'Перепелкину Роману Александровичу');
        assert.equal(formatFio(male, 'Винительный'), 'Перепелкина Романа Александровича');
        assert.equal(formatFio(male, 'Творительный'), 'Перепелкиным Романом Александровичем');
        assert.equal(formatFio(male, 'Предложный'), 'Перепелкине Романе Александровиче');
        assert.equal(formatFio(male, 'Инициалы'), 'Перепелкин Р. А.');
        assert.equal(formatFio(male, 'И. О. Фамилия'), 'Р. А. Перепелкин');

        const female = { last_name: 'Смирнова', first_name: 'Анна', middle_name: 'Сергеевна' };
        assert.equal(detectGender(female), 'f');
        assert.equal(formatFio(female, 'Родительный'), 'Смирновой Анны Сергеевны');
        assert.equal(formatFio(female, 'Дательный'), 'Смирновой Анне Сергеевне');
        assert.equal(formatFio(female, 'Винительный'), 'Смирнову Анну Сергеевну');

        const indeclinable = { last_name: 'Шевченко', first_name: 'Илья', middle_name: 'Петрович' };
        assert.equal(formatFio(indeclinable, 'Дательный'), 'Шевченко Илье Петровичу');

        const all = fioAllFormats(male);
        assert.equal(Object.keys(all).length, 8);

        assert.equal(objectTitle({ fields: [] }, { fio: male }), 'Перепелкин Роман Александрович');

        // Проверка функции fio() в шаблонизаторе print.js на временном шаблоне
        const db = await openDataDb(':memory:');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-fio-print-'));
        try {
            fs.mkdirSync(path.join(tmp, 'DATA/CATALOGS/PERSONS/$catalog'), { recursive: true });
            fs.writeFileSync(path.join(tmp, 'DATA/CATALOGS/PERSONS/$catalog/class.js'), `export default {
                label: 'Персоны',
                METADATA: { FIELDS: [{ id: 'name', type: 'string' }, { id: 'fio', type: 'struct', fields: [
                    { id: 'last_name', type: 'string' }, { id: 'first_name', type: 'string' }, { id: 'middle_name', type: 'string' }
                ] }] }
            }`);
            fs.mkdirSync(path.join(tmp, 'DATA/OPERATIONS/ORDER/$operation/print'), { recursive: true });
            fs.writeFileSync(path.join(tmp, 'DATA/OPERATIONS/ORDER/$operation/class.js'), `export default {
                label: 'Приказ',
                METADATA: { FIELDS: [{ id: 'person', type: 'link', target: '/DATA/CATALOGS/PERSONS', required: true }] }
            }`);
            fs.writeFileSync(path.join(tmp, 'DATA/OPERATIONS/ORDER/$operation/print/Приказ.html'),
                '<!DOCTYPE html><html><head><title>Приказ</title></head><body>Назначить {{fio(person_obj.fio, "Винительный")}} (подпись: {{fio(person_obj.fio, "Инициалы")}})</body></html>');
            await refreshClasses(db, tmp);
            const p = createObject(db, { cid: '/DATA/CATALOGS/PERSONS', body: { fio: male } });
            assert.equal(p.title, 'Перепелкин Роман Александрович');
            const op = createObject(db, { cid: '/DATA/OPERATIONS/ORDER', body: { person: p.id } });
            const printed = await renderPrint(db, { id: op.id, name: 'Приказ', root: tmp });
            assert.match(printed.html, /Назначить Перепелкина Романа Александровича/);
            assert.match(printed.html, /подпись: Перепелкин Р\. А\./);
        }
        finally {
            db.close();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('2. Эталонный /MODULES/Register очищен от ГСМ-специфики, TestFunc, имеет счёт 67 и единый регистр типов', async () => {
        const catProtoSrc = fs.readFileSync(path.join(ROOT, 'MODULES/Register/CATALOGS/$catalog/class.js'), 'utf-8');
        assert.ok(!catProtoSrc.includes('TestFunc'), 'Отладочная TestFunc удалена');

        // Проверяем все class.js в /MODULES на отсутствие верхнего регистра типов и type: "Table"
        const badTypes = [];
        const walk = (dir) => {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) walk(full);
                else if (ent.name === 'class.js') {
                    const src = fs.readFileSync(full, 'utf-8');
                    if (/type:\s*'(Link|Money|Number|Date|DateTime|Integer|Enum|Text|String|Table|Boolean)'/.test(src))
                        badTypes.push(full);
                }
            }
        };
        walk(path.join(ROOT, 'MODULES'));
        assert.deepEqual(badTypes, [], 'Все типы полей в /MODULES в едином нижнем регистре');

        // Проверка структуры чистого /MODULES/Register в изолированном корне
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-pure-reg-'));
        try {
            fs.cpSync(path.join(ROOT, 'MODULES'), path.join(tmp, 'MODULES'), { recursive: true });
            const db = await openDataDb(':memory:');
            const res = await refreshClasses(db, tmp);
            assert.deepEqual(res.problems, []);

            for (const c of classesOfType(db, DATA_TYPES)) {
                assert.deepEqual(checkSchema(db, c.cid), [], `Ошибки схемы ${c.path}`);
            }

            assert.ok(getClass(db, '/MODULES/Register/REGISTER/67'), 'Счёт 67 добавлен в план счетов');
            assert.ok(getClass(db, '/MODULES/Register/STRUCTS/ФИО'), 'Структура ФИО добавлена');
            assert.ok(getClass(db, '/MODULES/Register/CATALOGS/Склады'), 'Склады универсальны');
            assert.equal(getClass(db, '/MODULES/Register/CATALOGS/Склады и резервуары'), null, 'Склады и резервуары убраны из эталона');
            assert.ok(getClass(db, '/MODULES/Register/OPERATIONS/Комплектация'), 'Операция Комплектация присутствует');
            assert.ok(getClass(db, '/MODULES/Register/OPERATIONS/Списание ТМЦ'), 'Операция Списание ТМЦ присутствует');
            assert.equal(getClass(db, '/MODULES/Register/OPERATIONS/Фасовка'), null, 'ГСМ-операция Фасовка убрана из эталона');

            const nom = classSchema(db, '/MODULES/Register/CATALOGS/Номенклатура');
            assert.ok(!nom.fields.some(f => f.id === 'density'), 'density убран из эталонной Номенклатуры');
            assert.ok(nom.fields.some(f => f.id === 'vat_rate'), 'vat_rate присутствует в Номенклатуре');

            const legal = classSchema(db, '/MODULES/Register/CATALOGS/Субъекты/Юр. лица');
            assert.equal(legal.fields.find(f => f.id === 'bank_accounts')?.type, 'table');
            assert.equal(legal.fields.find(f => f.id === 'ceo')?.type, 'struct');

            const c62 = classSchema(db, '/MODULES/Register/REGISTER/62');
            assert.ok(c62.fields.some(f => f.id === 'contract'), 'На 62 счёте есть аналитика Договор');
            db.close();
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('3. Создание новой организации через BASE_TEMPLATE (preset=demo) разворачивает чистую универсальную БД', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-template-org-'));
        try {
            fs.cpSync(path.join(ROOT, 'MODULES'), path.join(tmp, 'MODULES'), { recursive: true });
            fs.cpSync(path.join(ROOT, 'ORGANIZATIONS/$domain'), path.join(tmp, 'ORGANIZATIONS/$domain'), { recursive: true });
            const orgDir = path.join(tmp, 'ORGANIZATIONS', 'ТестТорг');
            fs.mkdirSync(path.join(orgDir, '$base'), { recursive: true });
            fs.writeFileSync(path.join(orgDir, '$base', 'class.js'), buildBasePassportClassJs({ id: 'ТестТорг', label: 'ООО «ТестТорг»', preset: 'demo' }));
            scaffoldBaseOrganizationSync({
                targetDir: orgDir,
                orgId: 'ТестТорг',
                modulesRoot: path.join(tmp, 'MODULES'),
                preset: 'demo',
            });
            const seeded = await seedBaseTemplateDemoData({ rootDir: tmp, orgId: 'ТестТорг' });
            assert.equal(seeded.seeded, true);
            assert.ok(seeded.objectsCount >= 15);

            const dbFile = path.join(orgDir, '$base', '#system', 'work.db');
            const db = await openDataDb(dbFile);
            await refreshClasses(db, tmp);
            const tb = trialBalance(db, { to: `${new Date().getFullYear()}-12-31` });
            assert.deepEqual(tb.total.closing.debit, tb.total.closing.credit);
            db.close();
            await closeBaseDb('/ORGANIZATIONS/ТестТорг').catch(() => {});
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('4. Одноразовые инвайты: создание, проверка, принятие и автопривязка в ROLES, отзыв и запрет повторного входа', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-invites-'));
        const invFile = path.join(tmp, 'invites.json');
        _setInvitesFileForTests(invFile);
        try {
            const deptFile = path.join(tmp, 'ORGANIZATIONS/Тест/sales/$structure/class.js');
            fs.mkdirSync(path.dirname(deptFile), { recursive: true });
            let currentData = {
                label: 'Отдел продаж',
                '#security': {
                    ROLES: [{ id: 'manager', label: 'Менеджер', USERS: [] }],
                },
            };
            const fakeItem = {
                path: '/ORGANIZATIONS/Тест/sales',
                get DATA() { return currentData; },
                init: Promise.resolve(),
                constructor: { toScript: (d) => JSON.stringify(d, null, 2) },
                async save({ post }) {
                    currentData = JSON.parse(post);
                    fs.writeFileSync(deptFile, 'export default ' + post, 'utf-8');
                },
                reset() {},
                fire() {},
            };

            const inv1 = createInvite({
                pointPath: fakeItem.path,
                pointLabel: 'Отдел продаж',
                trail: 'manager',
                placeLabel: 'Менеджер',
                channel: 'email',
                recipient: 'newbie@bis.ru',
                createdBy: 'BOSS0001',
            });
            assert.ok(inv1.token.length >= 16);
            assert.equal(inspectInvite(inv1.token).valid, true);
            assert.equal(listPointInvites(fakeItem.path).length, 1);

            const consumed = await consumeInvite({
                token: inv1.token,
                uid: 'USER999900001111',
                resolver: async () => fakeItem,
            });
            assert.equal(consumed.consumed, true);
            assert.ok(currentData['#security'].ROLES[0].USERS.includes('USER999900001111'));
            assert.equal(inspectInvite(inv1.token).status, 'used');

            // Повторное использование того же токена должно быть отклонено
            const second = await consumeInvite({
                token: inv1.token,
                uid: 'USER2222',
                resolver: async () => fakeItem,
            });
            assert.equal(second.consumed, false);
            assert.equal(second.reason, 'used');

            // Отзыв активного приглашения блокирует принятие
            const inv2 = createInvite({
                pointPath: fakeItem.path,
                trail: 'manager',
                placeLabel: 'Менеджер',
                channel: 'telegram',
            });
            revokeInvite({ pointPath: fakeItem.path, id: inv2.id });
            assert.equal(inspectInvite(inv2.token).status, 'revoked');
            const afterRevoke = await consumeInvite({
                token: inv2.token,
                uid: 'USER3333',
                resolver: async () => fakeItem,
            });
            assert.equal(afterRevoke.consumed, false);
            assert.equal(afterRevoke.reason, 'revoked');
        }
        finally {
            _setInvitesFileForTests('');
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('5. npm pack --dry-run не включает NODES/teewtew, config.json, progress.md, publish.cmd, ORGANIZATIONS/* и PROJECTS/*', () => {
        const out = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        const parsed = JSON.parse(out);
        const files = (parsed?.[0]?.files || []).map(f => f.path);
        assert.ok(files.length > 50, 'Список файлов npm pack непустой');
        for (const forbidden of ['NODES/teewtew', 'config.json', 'progress.md', 'publish.cmd', '.cursorrules', 'ORGANIZATIONS/Маслоторг', 'ORGANIZATIONS/Рога_копыта']) {
            assert.ok(!files.some(f => f === forbidden || f.startsWith(forbidden + '/')), `${forbidden} не должен попадать в npm-пакет`);
        }
        assert.ok(files.includes('MODULES/Register/STRUCTS/ФИО/$struct/class.js'), 'Структура ФИО входит в npm-пакет');
        assert.ok(files.includes('MODULES/Register/REGISTER/67/$account/class.js'), 'Счёт 67 входит в npm-пакет');
    });
});
