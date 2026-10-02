/**
 * Виртуальный справочник: строки — объекты реестра в состоянии счёта на дату,
 * местные расширения — в overlay.json, принадлежность — только по журналу.
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

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN = 'VA000000000001', USER1 = 'VU000000000001', NOBODY = 'VN000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function copy(rel) {
    write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

const SEC = `'#security': { USERS: ['${USER1}'] }`;
const PERSON = `{ id: 'person', type: 'Link', catalog: '/DATA/CATALOGS/K', analytic: true }`;

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-virtual-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Кадровик'], [NOBODY, 'Чужой']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    copy('DATA/CATALOGS/$catalog/class.js');
    copy('DATA/CATALOGS/$catalog/$folder/$class/$registry/class.js');
    copy('DATA/CATALOGS/$catalog/$folder/$class/$virtual/class.js');
    copy('DATA/REGISTER/$register/class.js');
    copy('DATA/REGISTER/$register/$folder/$class/$account/class.js');
    copy('DATA/OPERATIONS/$operation/class.js');
    copy('DATA/OPERATIONS/$operation/$folder/$class/$operation/class.js');
    process.chdir(tmp);
    globalThis.WORK = new $server();
    const admin = as(ADMIN);
    const cats = await WORK.get_item('/DATA/CATALOGS');
    await cats.create({ id: 'K', type: '$registry', post: `export default { label: 'Люди', ${SEC},
        METADATA: { FIELDS: [{ id: 'name', required: true }] } }`, ...admin });
    await cats.create({ id: 'G', type: '$registry', post: `export default { label: 'Группа', ${SEC} }`, ...admin });
    const gv = await WORK.get_item('/DATA/CATALOGS/G');
    await gv.create({ id: 'V', type: '$virtual', post: `export default { label: 'Активные', ${SEC},
        SOURCE: { registry: '/DATA/CATALOGS/K', account: '/DATA/REGISTER/VAC', slot: 'person' },
        OVERLAY: [{ id: 'until', label: 'До' }] }`, ...admin });
    const reg = await WORK.get_item('/DATA/REGISTER');
    const vac = `METADATA: { FIELDS: [${PERSON}],
        INDEXES: [{ id: 'turnover', kind: 'turnover', by: ['person'], measures: { qty_in: 'sum', qty_out: 'sum' } }] }`;
    await reg.create({ id: 'VAC', type: '$account', post: `export default { label: 'Состояние', ${SEC}, ${vac} }`, ...admin });
    await reg.create({ id: 'BASE', type: '$account', post: `export default { label: 'База', ${SEC}, ${vac} }`, ...admin });
    const ops = await WORK.get_item('/DATA/OPERATIONS');
    const mkop = (id, label, debit, credit) => ops.create({ id, type: '$operation',
        post: `export default { label: '${label}', ${SEC},
            METADATA: { FIELDS: [{ id: 'name' }, { id: 'person', type: 'Link', catalog: '/DATA/CATALOGS/K', required: true }],
                POSTINGS: [{ id: 'main', amount: 0, quantity: 1,
                    debit: { account: '${debit}', analytics: { person: 'person' } },
                    credit: { account: '${credit}', analytics: { person: 'person' } } }] } }`, ...admin });
    await mkop('GO', 'Вход', '/DATA/REGISTER/VAC', '/DATA/REGISTER/BASE');
    await mkop('BACK', 'Выход', '/DATA/REGISTER/BASE', '/DATA/REGISTER/VAC');
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('виртуальный справочник', () => {
    let emp;
    it('пусто до движений', async () => {
        const virt = await WORK.get_item('/DATA/CATALOGS/G/V');
        assert.deepEqual(await virt.browse(as(USER1)), []);
        const k = await WORK.get_item('/DATA/CATALOGS/K');
        emp = (await k.create_object({ filename: 'e.data', post: { name: 'Иван' }, ...as(USER1) })).id;
        assert.deepEqual(await virt.browse(as(USER1)), [], 'сам факт объекта не включает');
    });

    it('вход — в списке, расширение сохраняется и видно', async () => {
        const virt = await WORK.get_item('/DATA/CATALOGS/G/V');
        const go = await WORK.get_item('/DATA/OPERATIONS/GO');
        const o = await go.create_object({ filename: 'g.data', post: { name: 'Вход', person: emp }, ...as(USER1) });
        await go.post({ id: o.id, ...as(USER1) });
        const rows = await virt.browse(as(USER1));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, emp);
        assert.equal(rows[0].name, 'Иван');
        assert.deepEqual(rows[0].overlay, {});
        await virt.overlay_save({ id: emp, post: { id: emp, fields: { until: 'завтра' } }, ...as(USER1) });
        assert.deepEqual((await virt.browse(as(USER1)))[0].overlay, { until: 'завтра' });
    });

    it('выход — из списка, на прошлую дату — тоже', async () => {
        const virt = await WORK.get_item('/DATA/CATALOGS/G/V');
        const back = await WORK.get_item('/DATA/OPERATIONS/BACK');
        const o = await back.create_object({ filename: 'b.data', post: { name: 'Выход', person: emp }, ...as(USER1) });
        await back.post({ id: o.id, ...as(USER1) });
        assert.deepEqual(await virt.browse(as(USER1)), []);
        assert.deepEqual(await virt.browse({ at: '2000-01-01', ...as(USER1) }), []);
    });

    it('проверки: чужой источник, чужое поле, чужому — запрет', async () => {
        const virt = await WORK.get_item('/DATA/CATALOGS/G/V');
        await assert.rejects(virt.overlay_save({ id: emp, post: { id: emp, fields: { hacker: 1 } }, ...as(USER1) }), /нет поля/);
        await assert.rejects(invoke(virt, 'browse', as(NOBODY)), /Доступ запрещён/);
        const rows = await invoke(virt, 'browse', as(USER1));
        assert.ok(Array.isArray(rows));
    });

    it('источник без оборота по слоту — ошибка', async () => {
        const reg = await WORK.get_item('/DATA/REGISTER');
        await reg.create({ id: 'PLAIN', type: '$account', post: `export default { label: 'Без индекса', ${SEC} }`, ...as(ADMIN) });
        const gv = await WORK.get_item('/DATA/CATALOGS/G');
        await gv.create({ id: 'VB', type: '$virtual', post: `export default { label: 'Битый', ${SEC},
            SOURCE: { registry: '/DATA/CATALOGS/K', account: '/DATA/REGISTER/PLAIN', slot: 'person' } }`, ...as(ADMIN) });
        const vb = await WORK.get_item('/DATA/CATALOGS/G/VB');
        await assert.rejects(vb.browse(as(USER1)), /оборот|слот/);
    });
});
