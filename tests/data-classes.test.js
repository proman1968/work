/**
 * БД данных и кэш дерева классов (sources/data/db.js, classes.js).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDataDb, migrate, tx, MIGRATIONS } from '../sources/data/db.js';
import {
    scanClasses, syncClasses, refreshClasses, getClass, descendants, ancestors, children, isLeaf, classesOfType, plainData,
} from '../sources/data/classes.js';

let tmp;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

before(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-data-classes-'));
    write('DATA/$domain/class.js', `export default { label: 'Данные' }`);
    // журнал и счета
    write('DATA/REGISTER/$register/class.js', `export default { label: 'Журнал' }`);
    write('DATA/REGISTER/$register/$folder/$class/$account/class.js', `export default { label: 'Счёт (тип)' }`);
    write('DATA/REGISTER/62/$account/class.js', `export default { label: 'Расчёты с покупателями',
        METADATA: { FIELDS: [{ id: 'counterparty', type: 'Link', catalog: '/DATA/CATALOGS/SUBJECTS', analytic: true }] } }`);
    write('DATA/REGISTER/62/62.01/$account/class.js', `export default { label: 'Расчёты в рублях' }`);
    write('DATA/REGISTER/62/62.02/$account/class.js', `export default { label: 'Авансы' }`);
    write('DATA/REGISTER/62/62.02/history/x/$account/class.js', `export default { label: 'мусор' }`);
    // операции: функции и геттеры не попадают в данные
    write('DATA/OPERATIONS/$operation/class.js', `export default { label: 'Операции',
        async post() { return WORK.never(); },
        get broken() { throw new Error('геттер не должен вызываться'); },
        METADATA: { FIELDS: [{ id: 'sum', type: 'Number' }] } }`);
    write('DATA/OPERATIONS/ПРОДАЖА/$operation/class.js', `export default { label: 'Продажа', AUTO_REGISTER: false,
        METADATA: { POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '/DATA/REGISTER/62/62.01' }, credit: { account: '/DATA/REGISTER/90' } }] } }`);
    // папка с двумя метапапками
    write('DATA/CATALOGS/$catalog/class.js', `export default { label: 'Справочники' }`);
    write('DATA/CATALOGS/SUBJECTS/$catalog/class.js', `export default { label: 'Субъекты' }`);
    write('DATA/CATALOGS/SUBJECTS/$virtual/class.js', `export default { label: 'Субъекты-виртуал' }`);
    // класс без class.js — cid = путь
    fs.mkdirSync(path.join(tmp, 'DATA/CATALOGS/EMPTY/$catalog'), { recursive: true });
    // структура
    write('BASE/$base/class.js', `export default { label: 'Организация' }`);
    write('BASE/SALES/$structure/class.js', `export default { label: 'Отдел продаж' }`);
    write('BASE/SALES/#secret/x/$structure/class.js', `export default { label: 'секрет' }`);
});

after(async () => {
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('БД данных', () => {
    it('миграции применяются один раз; повторный migrate ничего не делает', async () => {
        const db = await openDataDb(':memory:');
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
        assert.equal(migrate(db), MIGRATIONS.length);
        const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(r => r.name);
        for (const t of ['classes', 'class_tree', 'objects', 'object_versions', 'refs', 'objects_fts', 'entries', 'entry_analytics', 'settings'])
            assert.ok(tables.includes(t), t);
        db.close();
    });

    it('tx: откат при ошибке, вложенные транзакции через savepoint', async () => {
        const db = await openDataDb(':memory:');
        const put = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, v);
        assert.throws(() => tx(db, () => { put('a', '1'); throw new Error('стоп'); }), /стоп/);
        assert.equal(db.prepare('SELECT count(*) n FROM settings').get().n, 0);
        tx(db, () => {
            put('outer', '1');
            assert.throws(() => tx(db, () => { put('inner', '1'); throw new Error('внутри'); }));
            tx(db, () => put('inner2', '1'));
        });
        assert.deepEqual(db.prepare('SELECT key FROM settings ORDER BY key').all().map(r => r.key), ['inner2', 'outer']);
        assert.throws(() => tx(db, async () => put('async', '1')), /синхронной/);
        assert.equal(db.prepare(`SELECT count(*) n FROM settings WHERE key = 'async'`).get().n, 0);
        db.close();
    });

    it('файл БД создаётся вместе с папкой', async () => {
        const file = path.join(tmp, '.data', 'work.db');
        const db = await openDataDb(file);
        db.close();
        assert.ok(fs.existsSync(file));
    });
});

describe('кэш дерева классов', () => {
    let db, scan;

    before(async () => {
        db = await openDataDb(':memory:');
        scan = await scanClasses(tmp);
        syncClasses(db, scan.classes);
    });

    after(() => db.close());

    it('находит классы, пропускает метапапки, history и #-папки', () => {
        const paths = scan.classes.map(c => c.path).sort();
        assert.deepEqual(paths, [
            '/BASE', '/BASE/SALES', '/DATA', '/DATA/CATALOGS', '/DATA/CATALOGS/EMPTY', '/DATA/CATALOGS/SUBJECTS',
            '/DATA/OPERATIONS', '/DATA/OPERATIONS/ПРОДАЖА', '/DATA/REGISTER', '/DATA/REGISTER/62',
            '/DATA/REGISTER/62/62.01', '/DATA/REGISTER/62/62.02',
        ]);
    });

    it('сообщает о нескольких метапапках в одной папке', () => {
        assert.ok(scan.problems.some(p => p.includes('/DATA/CATALOGS/SUBJECTS') && p.includes('выбран $catalog')));
    });

    it('cid всегда равен пути; тип — метапапка; собственный слой без функций и геттеров', () => {
        assert.equal(getClass(db, '/DATA/REGISTER/62').cid, '/DATA/REGISTER/62');
        assert.equal(getClass(db, '/DATA/REGISTER/62').type, '$account');
        assert.equal(getClass(db, '/DATA/CATALOGS/EMPTY').cid, '/DATA/CATALOGS/EMPTY');
        assert.equal(getClass(db, '/DATA/CATALOGS/EMPTY').label, 'EMPTY');
        const ops = getClass(db, '/DATA/OPERATIONS');
        assert.deepEqual(Object.keys(ops.own).sort(), ['METADATA', 'label']);
        assert.equal(getClass(db, '/DATA/OPERATIONS/ПРОДАЖА').own.METADATA.POSTINGS[0].debit.account, '/DATA/REGISTER/62/62.01');
        assert.equal(getClass(db, '/нет'), null);
    });

    it('иерархия: родитель — ближайший класс-предок по пути', () => {
        assert.equal(getClass(db, '/DATA/REGISTER/62/62.01').parent, '/DATA/REGISTER/62');
        assert.equal(getClass(db, '/DATA/REGISTER/62').parent, '/DATA/REGISTER');
        assert.equal(getClass(db, '/DATA/REGISTER').parent, '/DATA');
        assert.equal(getClass(db, '/DATA').parent, null);
        assert.equal(getClass(db, '/BASE/SALES').parent, '/BASE');
    });

    it('потомки и предки по замыканию', () => {
        assert.deepEqual(descendants(db, '/DATA/REGISTER/62'), ['/DATA/REGISTER/62', '/DATA/REGISTER/62/62.01', '/DATA/REGISTER/62/62.02']);
        assert.deepEqual(descendants(db, '/DATA/REGISTER/62', { self: false }), ['/DATA/REGISTER/62/62.01', '/DATA/REGISTER/62/62.02']);
        assert.deepEqual(ancestors(db, '/DATA/REGISTER/62/62.02').map(c => c.cid), ['/DATA', '/DATA/REGISTER', '/DATA/REGISTER/62', '/DATA/REGISTER/62/62.02']);
        assert.deepEqual(ancestors(db, '/DATA/REGISTER/62/62.02', { self: false }).map(c => c.cid), ['/DATA', '/DATA/REGISTER', '/DATA/REGISTER/62']);
        // по названию: «Авансы» раньше «Расчёты в рублях»
        assert.deepEqual(children(db, '/DATA/REGISTER/62').map(c => c.cid), ['/DATA/REGISTER/62/62.02', '/DATA/REGISTER/62/62.01']);
        assert.equal(isLeaf(db, '/DATA/REGISTER/62/62.01'), true);
        assert.equal(isLeaf(db, '/DATA/REGISTER/62'), false);
        assert.deepEqual(classesOfType(db, '$account').map(c => c.cid), ['/DATA/REGISTER/62', '/DATA/REGISTER/62/62.01', '/DATA/REGISTER/62/62.02']);
        assert.deepEqual(classesOfType(db, ['$base', '$structure']).map(c => c.cid), ['/BASE', '/BASE/SALES']);
    });

    it('повторная синхронизация без изменений ничего не пишет', () => {
        assert.deepEqual(syncClasses(db, scan.classes), { total: scan.classes.length, changed: 0, removed: 0 });
    });

    it('перенос класса: путь и замыкание обновляются; удалённые классы уходят', async () => {
        fs.renameSync(path.join(tmp, 'DATA/REGISTER/62/62.02'), path.join(tmp, 'DATA/REGISTER/62/62.01/62.02'));
        fs.rmSync(path.join(tmp, 'DATA/CATALOGS/EMPTY'), { recursive: true });
        const res = await refreshClasses(db, tmp);
        assert.equal(res.removed, 2); // старый путь 62.02 и EMPTY ушли, новый 62.01/62.02 добавлен
        assert.equal(getClass(db, '/DATA/REGISTER/62/62.01/62.02').path, '/DATA/REGISTER/62/62.01/62.02');
        assert.equal(getClass(db, '/DATA/REGISTER/62/62.01/62.02').parent, '/DATA/REGISTER/62/62.01');
        assert.deepEqual(descendants(db, '/DATA/REGISTER/62/62.01'), ['/DATA/REGISTER/62/62.01', '/DATA/REGISTER/62/62.01/62.02']);
        assert.equal(getClass(db, '/DATA/CATALOGS/EMPTY'), null);
    });

    it('правка class.js подхватывается при следующем сканировании', async () => {
        const file = path.join(tmp, 'DATA/REGISTER/62/$account/class.js');
        fs.writeFileSync(file, `export default { label: 'Покупатели и заказчики' }`, 'utf-8');
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(file, later, later);
        const res = await refreshClasses(db, tmp);
        assert.equal(res.changed, 1);
        assert.equal(getClass(db, '/DATA/REGISTER/62').label, 'Покупатели и заказчики');
    });

    it('plainData: массивы и вложенные объекты, без функций', () => {
        assert.deepEqual(plainData({ a: [1, () => 1, { b: 2, f() {} }], s: Symbol('x') }), { a: [1, null, { b: 2 }] });
    });
});
