/**
 * Наследование схемы по дереву операций: FIELDS уровней складываются (слияние по id),
 * to_inherit:false не уходит вниз, проводка листа пользуется унаследованными полями.
 * Distributive лежат файлами (как их пишет save), чтобы не зависеть от виртуальных слоёв.
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

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN = 'HA000000000001', USER1 = 'HU000000000001';
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

const SEC = (uid) => `'#security': { USERS: ['${uid}'] }`;
const cls = (label, fields, extra = '') => `export default { label: '${label}', ${SEC(USER1)},
    METADATA: { FIELDS: [${fields}] }${extra} }`;
const dist = (fields) => `export default { METADATA: { FIELDS: [${fields}] } }`;
const NF = `{ id: 'name', required: true }, { id: 'time', type: 'timestamp' }`;

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-inhops-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Бухгалтер']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    copy('DATA/REGISTER/$register/class.js');
    copy('DATA/REGISTER/$register/$folder/$class/$account/class.js');
    copy('DATA/REGISTER/$register/$folder/$class/$register/class.js');
    copy('DATA/OPERATIONS/$operation/class.js');
    copy('DATA/OPERATIONS/$operation/$folder/$class/$operation/class.js');
    write('DATA/CATALOGS/$class/class.js', `export default { label: 'Справочники' }`);
    write('DATA/CATALOGS/K/$catalog/class.js', `export default { label: 'Контрагенты', ${SEC(USER1)},
        METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
    const admin = as(ADMIN);
    process.chdir(tmp);
    globalThis.WORK = new $server();
    const reg = await WORK.get_item('/DATA/REGISTER');
    await reg.create({ id: '51', type: '$account', post: `export default { label: 'Касса', ${SEC(USER1)} }`, ...admin });
    await reg.create({ id: '68', type: '$account', post: `export default { label: 'Налоги', ${SEC(USER1)} }`, ...admin });
    const ops = await WORK.get_item('/DATA/OPERATIONS');
    await ops.create({ id: 'PAY', type: '$operation',
        post: cls('Платежи', `${NF}, { id: 'sum', type: 'Number', required: true }`), ...admin });
    write('DATA/OPERATIONS/PAY/$operation/$folder/$class/$operation/class.js',
        dist(`${NF}, { id: 'sum', type: 'Number', required: true }`));
    const pay = await WORK.get_item('/DATA/OPERATIONS/PAY');
    await pay.create({ id: 'CASH', type: '$operation',
        post: cls('Наличные', `{ id: 'internal', to_inherit: false }, { id: 'kassa', required: true }`), ...admin });
    write('DATA/OPERATIONS/PAY/CASH/$operation/$folder/$class/$operation/class.js',
        dist(`{ id: 'kassa', required: true }`));
    const cash = await WORK.get_item('/DATA/OPERATIONS/PAY/CASH');
    await cash.create({ id: 'TAX', type: '$operation', post: `export default { label: 'Налог', ${SEC(USER1)},
        METADATA: { POSTINGS: [{ id: 'main', amount: 'sum',
            debit: { account: '/DATA/REGISTER/68' }, credit: { account: '/DATA/REGISTER/51' } }] } }`, ...admin });
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('дерево операций', () => {
    it('лист видит поля всех уровней, to_inherit:false — нет', async () => {
        const tax = await WORK.get_item('/DATA/OPERATIONS/PAY/CASH/TAX');
        const ids = (tax.METADATA?.FIELDS || []).map(f => f.id);
        assert.deepEqual(ids, ['name', 'time', 'sum', 'kassa']);
    });

    it('проводка листа пользуется унаследованными полями', async () => {
        const tax = await WORK.get_item('/DATA/OPERATIONS/PAY/CASH/TAX');
        const o = await tax.create_object({ filename: 't.data', post: { name: 'Налог', sum: 200, kassa: '1' }, ...as(USER1) });
        await tax.post({ id: o.id, ...as(USER1) });
        const d = await (await WORK.get_item('/DATA/REGISTER/68')).query({ ...as(USER1) });
        assert.equal(d.length, 1);
        assert.equal(d[0].body.debit, 200);
        assert.equal(d[0].body.source, '/DATA/OPERATIONS/PAY/CASH/TAX/' + o.id);
    });

    it('без обязательного поля предков объект не создаётся', async () => {
        const tax = await WORK.get_item('/DATA/OPERATIONS/PAY/CASH/TAX');
        await assert.rejects(tax.create_object({ filename: 'bad.data', post: { name: 'Без суммы', kassa: '1' }, ...as(USER1) }), /sum/);
    });

    it('save публикует схему уровня в его distributive', async () => {
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        await ops.create({ id: 'MID', type: '$operation',
            post: cls('Середина', `{ id: 'mid' }`), ...as(ADMIN) });
        const mid = await WORK.get_item('/DATA/OPERATIONS/MID');
        await mid.save({ post: cls('Середина', `{ id: 'mid' }`).replace(/^export default /, ''), ...as(ADMIN) });
        const distPath = path.join(tmp, 'DATA/OPERATIONS/MID/$operation/$folder/$class/$operation/class.js');
        assert.ok(fs.existsSync(distPath), 'distributive записан');
        const text = fs.readFileSync(distPath, 'utf-8');
        assert.ok(text.includes(`id: 'mid'`) || text.includes(`id: "mid"`), 'схема уровня опубликована');
    });
});
