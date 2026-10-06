/**
 * Стабильный кэш сервера: наблюдатель не реагирует на данные/индексы,
 * сброс элемента уведомляет только его подписчиков, прогрев не падает на плохих узлах.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { isSubscribedTo } from '../sources/server/folder.js';
import { isCodeChange } from '../sources/host/watch.js';
import { prewarm } from '../sources/host/prewarm.js';
import { closeIndexDb } from '../sources/host/index-db.js';

let tmp, prev;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-cache-'));
    write('$server/class.js', `export default { label: 'WORK' }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('X/$class/class.js', `export default { label: 'X' }`);
    write('X/Y/$class/class.js', `export default { label: 'Y' }`);
    write('X/Y/Z/$class/class.js', `export default { label: 'Z' }`);
    write('BAD/$class/class.js', `export default {`);
    write('plain/inner/note.txt', 'x');
    write('DATA/WORKPLACE/$structure/class.js', `export default { label: 'Место',
        '#security': { LINKS: [{ id: '/X', access: 'read' }] } }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('наблюдатель за кодом', () => {
    it('данные и индексы не сбрасывают кэши, код и тексты слоёв — сбрасывают', () => {
        const p = (...s) => s.join(path.sep);
        assert.equal(isCodeChange(p('REGISTER', '62', '$account', 'INDEX', 'turnover', '2026.json')), false);
        assert.equal(isCodeChange(p('REGISTER', '62', '$account', 'INDEX', 'turnover', '.meta.json')), false);
        assert.equal(isCodeChange(p('REGISTER', '62', '$account', 'DATA', '2026-02-01', 'a.json')), false);
        assert.equal(isCodeChange(p('OPERATIONS', 'SALE', '$operation', 'DATA', '2026-02-01', 'x.md')), false);
        assert.equal(isCodeChange(p('BASE', 'doc', 'history', '2026', 'a.md')), false);
        assert.equal(isCodeChange(p('REGISTER', '$register', 'class.js')), true);
        assert.equal(isCodeChange(p('BASE', 'direction', '$structure', 'class.js')), true);
        assert.equal(isCodeChange(p('SERVICES', 'Yandex', '$service', 'readme.md')), true);
        assert.equal(isCodeChange(p('oda', 'components', 'tree', 'tree.js')), true);
    });

    it('корневой класс DATA не игнорируется, его зоны — да', () => {
        const p = (...s) => s.join(path.sep);
        assert.equal(isCodeChange(p('DATA', 'REGISTER', '$register', 'class.js')), true);
        assert.equal(isCodeChange(p('DATA', 'doc', 'readme.md')), true);
        assert.equal(isCodeChange(p('DATA', '$class', 'class.js')), true);
        assert.equal(isCodeChange(p('DATA', 'REGISTER', '62', '$account', 'DATA', '2026-02-01', 'a.json')), false);
        assert.equal(isCodeChange(p('DATA', 'REGISTER', '62', '$account', 'INDEX', 'turnover', '2026.json')), false);
    });

    it('реестр ссылок заходит под корневой DATA', async () => {
        const { covering, reset } = await import('../sources/server/access/links.js');
        reset();
        assert.deepEqual(await covering('/X'), [{ structure: '/DATA/WORKPLACE', place: null, id: '/X', access: 'read' }]);
        reset();
    });
});

describe('адресная рассылка сброса', () => {
    it('isSubscribedTo: сам элемент и его свойства, но не потомки и не соседи с общим префиксом', () => {
        assert.equal(isSubscribedTo('/X', '/X'), true);
        assert.equal(isSubscribedTo('/X/@items', '/X'), true);
        assert.equal(isSubscribedTo('/X/@users', '/X'), true);
        assert.equal(isSubscribedTo('/X/Y', '/X'), false, 'потомок');
        assert.equal(isSubscribedTo('/X/Y/@items', '/X'), false, 'список потомка');
        assert.equal(isSubscribedTo('/X/@storage_folder/@items', '/X'), false);
        assert.equal(isSubscribedTo('/XY', '/X'), false, 'общий префикс имени');
        assert.equal(isSubscribedTo('/XY/@items', '/X'), false);
        assert.equal(isSubscribedTo('/@items', ''), true, 'корень');
        assert.equal(isSubscribedTo('/BASE', ''), false);
    });

    it('reset: сообщение получают только подписчики самого элемента', async () => {
        const got = { a: [], b: [], c: [] };
        const sock = (name, events) => ({ ws: { send: m => got[name].push(JSON.parse(m)) }, events });
        $server.sessions.__test = { sockets: {
            a: sock('a', ['/X/@items']),
            b: sock('b', ['/X/Y/@items', '/X/Y']),
            c: sock('c', ['/X']),
        } };
        try {
            const x = await WORK.get_item('/X');
            x.reset();
            assert.equal(got.a.length, 1, 'список X');
            assert.equal(got.a[0].path, '/X');
            assert.equal(got.b.length, 0, 'подписчики потомка не тревожатся');
            assert.equal(got.c.length, 1, 'сам X');
        }
        finally {
            delete $server.sessions.__test;
        }
    });
});

describe('прогрев', () => {
    it('проходит классы верхних уровней, плохой class.js и обычные папки не мешают', async () => {
        const r = await prewarm(WORK, 2);
        assert.ok(r.classes >= 2, 'классов: ' + r.classes);
        assert.ok(r.ms >= 0);
        const r1 = await prewarm(WORK, 1);
        assert.ok(r1.classes <= r.classes, 'глубина 1 не больше глубины 2');
        const z = await prewarm(await WORK.get_item('/X'), 1);
        assert.equal(z.classes, 1, 'только Y');
    });
});
