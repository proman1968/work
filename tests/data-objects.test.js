/**
 * API объектов DATA: create/update/delete/read (версии, deleted), query по поддереву,
 * правило «только лист» в create/create_object, split.
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

const ADMIN = 'DA000000000001', USER1 = 'DU000000000001', GUEST1 = 'DG000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

const FIELDS = `METADATA: { FIELDS: [
    { id: 'name', required: true }, { id: 'time', type: 'timestamp', required: true },
    { id: 'code', label: 'Код', required: true }, { id: 'price', label: 'Цена', type: 'Number' },
] }`;

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-dataobj-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Исполнитель'], [GUEST1, 'Гость']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('ORG/$class/class.js', `export default { label: 'ORG', '#security': { USERS: ['${USER1}'] }, ${FIELDS} }`);
    write('PARENT/$class/class.js', `export default { label: 'Родитель', '#security': { USERS: ['${USER1}'] }, ${FIELDS} }`);
    write('PARENT/CHILD/$class/class.js', `export default { label: 'Ребёнок', '#security': { USERS: ['${USER1}'] }, ${FIELDS} }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

/** Файлы объектов класса (листья .data без истории). */
function dataFiles(cls = 'ORG') {
    const root = path.join(tmp, cls, '$class/DATA');
    if (!fs.existsSync(root))
        return [];
    return fs.readdirSync(root, { recursive: true })
        .filter(f => String(f).endsWith('.data') && !String(f).split(path.sep).some(s => s.startsWith('.')));
}

/** id объекта из результата записи (путь …/DATA/<дата>/{time}.{uid}.data). */
function idOf(log) {
    return path.basename(log.path).replace(/\.data$/, '');
}

describe('объекты DATA', () => {
    let id1, id2;

    it('create_object: USER пишет, чужой — отказ, поля проверяются', async () => {
        const org = await WORK.get_item('/ORG');
        const log = await org.create_object({ filename: 'товар1.data', post: { name: 'Молоко', code: 'A1', price: 89.9 }, ...as(USER1) });
        assert.match(log.path, /\/DATA\/\d{4}-\d{2}-\d{2}\//);
        id1 = idOf(log);
        assert.match(id1, /^\d+\.DU000000000001$/);
        const body = JSON.parse(fs.readFileSync(path.join(tmp, 'ORG/$class/DATA', dataFiles()[0]), 'utf-8'));
        assert.equal(body.name, 'Молоко', 'name из тела, не из имени файла');
        await assert.rejects(org.create_object({ filename: 'x.data', post: { name: 'x' }, ...as(GUEST1) }), /Доступ запрещён/);
        await assert.rejects(org.create_object({ filename: 'y.data', post: { name: 'y' }, ...as(USER1) }), /code/, 'нет обязательного code');
        await assert.rejects(org.create_object({ filename: 'z.data', post: { name: 'z', code: 'Z', price: 'много' }, ...as(USER1) }), /не число/);
        const co = await org.create_object({ filename: 'w.data', post: { name: 'Строка', code: 'W', price: '120' }, ...as(USER1) });
        id2 = idOf(co);
        const wb = JSON.parse(fs.readFileSync(path.join(tmp, 'ORG/$class/DATA', dataFiles().find(f => f.endsWith(id2 + '.data'))), 'utf-8'));
        assert.equal(wb.price, 120, 'строка приведена к числу');
        await org.delete_object({ id: id2, ...as(USER1) });
    });

    it('update_object: версия на месте, прежняя — в истории', async () => {
        const org = await WORK.get_item('/ORG');
        await org.update_object({ id: id1, post: { price: 95 }, ...as(USER1) });
        const ro = await org.read_object({ id: id1, ...as(USER1) });
        assert.equal(ro.body.price, 95);
        assert.equal(ro.body.code, 'A1', 'остальные поля сохранены');
        assert.equal(ro.body.name, 'Молоко');
        assert.equal(ro.name, 'Молоко');
        const abs = path.join(tmp, 'ORG/$class/DATA', dataFiles().find(f => f.endsWith(id1 + '.data')));
        const hist = path.join(path.dirname(abs), '.' + path.basename(abs), 'history');
        const snaps = fs.readdirSync(hist, { recursive: true }).filter(f => String(f).endsWith('.data'));
        assert.equal(snaps.length, 1);
        const old = JSON.parse(fs.readFileSync(path.join(hist, snaps[0]), 'utf-8'));
        assert.equal(old.price, 89.9);
        await assert.rejects(org.update_object({ id: '1.X', post: {}, ...as(USER1) }), /нет объекта/);
    });

    it('query: where, период, поддерево того же типа', async () => {
        const child = await WORK.get_item('/PARENT/CHILD');
        await child.create_object({ filename: 'цех.data', post: { name: 'Цех', code: 'D1', price: 10 }, ...as(USER1) });
        const kids = await (await WORK.get_item('/PARENT')).query({ order: 'asc', ...as(USER1) });
        assert.deepEqual(kids.map(r => r.point), ['/PARENT/CHILD']);
        const org = await WORK.get_item('/ORG');
        const cheap = await org.query({ where: { price: { gte: 50 } }, ...as(USER1) });
        assert.deepEqual(cheap.map(r => r.name), ['Молоко']);
        const now = Date.now();
        const inRange = await org.query({ from: now - 86400000, to: now + 86400000, ...as(USER1) });
        assert.equal(inRange.length, 1);
        const empty = await org.query({ from: '2000-01-01', to: '2000-01-02', ...as(USER1) });
        assert.equal(empty.length, 0, 'чужие дни не открываются');
    });

    it('create: тот же тип при DATA — только через split; объекты — только в листьях', async () => {
        const org = await WORK.get_item('/ORG');
        await assert.rejects(org.create({ id: 'NEW', type: '$class', post: `export default { label: 'New' }`, ...as(ADMIN) }), /split/);
        await org.create({ id: 'SPRAV', type: '$catalog', post: `export default { label: 'Справка' }`, ...as(ADMIN) });
        assert.equal((await WORK.get_item('/ORG/SPRAV')).type, '$catalog');
        const parent = await WORK.get_item('/PARENT');
        await assert.rejects(parent.create_object({ filename: 'q.data', post: { name: 'q', code: 'Q' }, ...as(USER1) }), /листьях/, 'у PARENT есть однотипный ребёнок');
        const child = await WORK.get_item('/PARENT/CHILD');
        await child.create_object({ filename: 'ok.data', post: { name: 'Ок', code: 'OK' }, ...as(USER1) });
    });

    it('delete_object: отметка deleted, query скрывает, restore возвращает', async () => {
        const org = await WORK.get_item('/ORG');
        await org.delete_object({ id: id1, ...as(USER1) });
        const gone = await org.read_object({ id: id1, ...as(USER1) });
        assert.equal(gone.body.deleted, true);
        assert.ok(gone.body.deleted_at);
        const visible = await org.query({ ...as(USER1) });
        assert.ok(!visible.some(r => r.name === 'Молоко'));
        const withDeleted = await org.query({ include_deleted: true, ...as(USER1) });
        assert.ok(withDeleted.some(r => r.name === 'Молоко' && r.body.deleted));
        await assert.rejects(org.update_object({ id: id1, post: {}, ...as(USER1) }), /удалён/);
        await org.update_object({ id: id1, post: {}, restore: true, ...as(USER1) });
        const back = await org.read_object({ id: id1, ...as(USER1) });
        assert.equal(back.body.deleted, undefined);
    });

    it('split: перенос DATA в потомка (создаёт его при отсутствии)', async () => {
        const org = await WORK.get_item('/ORG');
        await assert.rejects(org.split({ child: 'SPRAV', ...as(ADMIN) }), /тип \$catalog ≠ \$class/);
        await assert.rejects(org.split({ child: '/NOPE', ...as(ADMIN) }), /нет класса/);
        const res = await org.split({ child: 'ARCH', ...as(ADMIN) });
        assert.ok(res, 'факт split записан');
        assert.deepEqual(dataFiles('ORG'), []);
        assert.equal(fs.existsSync(path.join(tmp, 'ORG/$class/DATA')), false);
        const archFiles = dataFiles('ORG/ARCH');
        assert.ok(archFiles.length >= 1, 'объекты ORG переехали: ' + archFiles.join(','));
        await assert.rejects(org.split({ child: 'ARCH2', ...as(USER1) }), /Доступ запрещён/);
    });
});
