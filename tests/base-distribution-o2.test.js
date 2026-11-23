import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
import { checkSchema, classSchema } from '../sources/data/schema.js';
import { createObject, queryObjects } from '../sources/data/objects.js';
import {
    RF_REGIONS,
    buildInitialMvdUnits,
    searchOfflineKladr,
    seedKladrToDb,
    importKladrRows,
} from '../sources/modules/kladr/index.js';
import {
    buildBasePassportClassJs,
    scaffoldBaseOrganizationSync,
} from '../sources/server/class/base-template.js';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('Очередь 2: Модули Geo (миксин Карта + form/map), KLADR (+ МВД в Паспорт), Process (BPMN + Планировщик + Гант)', () => {
    it('1. /MODULES/Geo: миксин Карта передаёт поля coords/shape и представление form/map в Склады, Транспорт и Геоточки', async () => {
        const db = await openDataDb(':memory:');
        try {
            const res = await refreshClasses(db, ROOT);
            assert.deepEqual(res.problems, []);
            for (const p of ['/MODULES/Geo/Координаты', '/MODULES/Geo/Шейп', '/MODULES/Geo/Карта', '/MODULES/Geo/Геоточки']) {
                assert.ok(getClass(db, p), `${p} должен существовать`);
                assert.deepEqual(checkSchema(db, p), [], `${p} без ошибок схемы`);
            }
            const whSchema = classSchema(db, '/MODULES/Register/CATALOGS/Склады');
            assert.ok(whSchema.types.includes('/MODULES/Geo/Карта'));
            assert.ok(whSchema.fields.some(f => f.id === 'coords' && f.type === 'struct'));
            assert.ok(whSchema.fields.some(f => f.id === 'shape' && f.type === 'struct'));

            const prevWork = globalThis.WORK;
            globalThis.WORK = new $server();
            try {
                const geoPts = await WORK.get_item('/MODULES/Geo/Геоточки');
                const wh = await WORK.get_item('/MODULES/Register/CATALOGS/Склады');
                const geoViews = ((await geoPts.handlers({ path: '//form', role: 'USER' }))?.items || []).map(i => i.id);
                const whViews = ((await wh.handlers({ path: '//form', role: 'USER' }))?.items || []).map(i => i.id);
                assert.ok(geoViews.includes('map'), `Геоточки должны иметь представление map (получено: ${geoViews.join(', ')})`);
                assert.ok(whViews.includes('map'), `Склады с миксином Карта должны наследовать представление map (получено: ${whViews.join(', ')})`);
            }
            finally {
                globalThis.WORK = prevWork;
            }
        }
        finally {
            db.close();
        }
    });

    it('2. /MODULES/KLADR: 89 субъектов РФ, оффлайн-поиск МВД, засеивание БД, импорт и связка с Паспорт', async () => {
        assert.equal(RF_REGIONS.length, 89, 'Все 89 субъектов РФ');
        assert.ok(buildInitialMvdUnits().length >= 89, 'Справочник МВД покрывает все субъекты РФ');

        const mvdHits = searchOfflineKladr({ kind: 'mvd', query: '620-001' });
        assert.ok(mvdHits.some(x => x.code === '620-001' && x.name.includes('Рязанской')));
        const regHits = searchOfflineKladr({ kind: 'region', query: 'Свердлов' });
        assert.equal(regHits[0]?.code, '66');

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-kladr-'));
        const prevCwd = process.cwd();
        try {
            fs.cpSync(path.join(ROOT, 'MODULES'), path.join(tmp, 'MODULES'), { recursive: true });
            fs.cpSync(path.join(ROOT, 'ORGANIZATIONS/$domain'), path.join(tmp, 'ORGANIZATIONS/$domain'), { recursive: true });
            const orgDir = path.join(tmp, 'ORGANIZATIONS', 'КладрТест');
            fs.mkdirSync(path.join(orgDir, '$base'), { recursive: true });
            fs.writeFileSync(path.join(orgDir, '$base', 'class.js'), buildBasePassportClassJs({ id: 'КладрТест', preset: 'standard' }));
            scaffoldBaseOrganizationSync({ targetDir: orgDir, orgId: 'КладрТест', modulesRoot: path.join(tmp, 'MODULES'), preset: 'standard' });

            process.chdir(tmp);
            const seeded = await seedKladrToDb({ pointPath: '/ORGANIZATIONS/КладрТест', rootDir: tmp });
            assert.equal(seeded.ok, true);
            assert.equal(seeded.regionsAdded, 89);
            assert.ok(seeded.citiesAdded >= 89);
            assert.ok(seeded.mvdAdded >= 89);

            const imp = await importKladrRows({
                pointPath: '/ORGANIZATIONS/КладрТест',
                kind: 'mvd',
                rows: [{ code: '770-999', name: 'ОВМ ОМВД Тестовый отдел', region_code: '77' }],
                rootDir: tmp,
            });
            assert.equal(imp.inserted, 1);

            // Проверка создания физлица со ссылкой паспорта на /MODULES/KLADR/Подразделения МВД
            const dbFile = path.join(orgDir, '$base', '#system', 'work.db');
            const db = await openDataDb(dbFile);
            await refreshClasses(db, tmp);
            for (const c of classesOfType(db, DATA_TYPES)) {
                assert.deepEqual(checkSchema(db, c.cid), [], `Ошибки схемы ${c.path}`);
            }
            const mvdRows = queryObjects(db, {
                cid: '/ORGANIZATIONS/КладрТест/MODULES/KLADR/Подразделения МВД',
                search: '770-999',
            }).items || [];
            assert.equal(mvdRows.length, 1);
            const person = createObject(db, {
                cid: '/ORGANIZATIONS/КладрТест/MODULES/Register/CATALOGS/Субъекты/Физ. лица',
                body: {
                    fio: { last_name: 'Орлов', first_name: 'Дмитрий', middle_name: 'Игоревич' },
                    passport: {
                        series: '4510',
                        number: '123456',
                        issued_unit_code: '770-999',
                        issued_unit: mvdRows[0].id,
                    },
                },
            });
            assert.equal(person.body.passport.issued_unit, mvdRows[0].id);
            db.close();
            await closeBaseDb('/ORGANIZATIONS/КладрТест').catch(() => {});
        }
        finally {
            process.chdir(prevCwd);
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows EBUSY on sqlite */ }
        }
    });

    it('3. /MODULES/Process: BPMN, Задачи и этапы, представления bpmn / scheduler / gantt и подключение по умолчанию', async () => {
        const db = await openDataDb(':memory:');
        try {
            await refreshClasses(db, ROOT);
            for (const p of ['/MODULES/Process/Схемы процессов', '/MODULES/Process/Задачи и этапы']) {
                assert.ok(getClass(db, p), `${p} должен существовать`);
                assert.deepEqual(checkSchema(db, p), [], `${p} без ошибок схемы`);
            }
            const tasksSchema = classSchema(db, '/MODULES/Process/Задачи и этапы');
            for (const f of ['process_ref', 'parent_task', 'depends_on', 'start_at', 'due_at', 'duration_hours', 'progress', 'assignee', 'status', 'priority']) {
                assert.ok(tasksSchema.fields.some(x => x.id === f), `Поле ${f} в Задачи и этапы`);
            }

            const prevWork = globalThis.WORK;
            globalThis.WORK = new $server();
            try {
                const schemasItem = await WORK.get_item('/MODULES/Process/Схемы процессов');
                const tasksItem = await WORK.get_item('/MODULES/Process/Задачи и этапы');
                const rootItem = WORK;
                const schemaViews = ((await schemasItem.handlers({ path: '//form', role: 'USER' }))?.items || []).map(i => i.id);
                const taskViews = ((await tasksItem.handlers({ path: '//form', role: 'USER' }))?.items || []).map(i => i.id);
                const rootViews = ((await rootItem.handlers({ path: '//form', role: 'USER' }))?.items || []).map(i => i.id);

                assert.ok(schemaViews.includes('bpmn'), `У Схем процессов должно быть представление bpmn (получено: ${schemaViews.join(', ')})`);
                assert.ok(taskViews.includes('scheduler') && taskViews.includes('gantt'), `У Задач и этапов должны быть scheduler и gantt (получено: ${taskViews.join(', ')})`);
                assert.ok(rootViews.includes('scheduler') && rootViews.includes('gantt'), `В корне WORK (соло-режим) должны быть scheduler и gantt (получено: ${rootViews.join(', ')})`);
            }
            finally {
                globalThis.WORK = prevWork;
            }
        }
        finally {
            db.close();
        }
    });
});
