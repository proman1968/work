/**
 * Флаги строки дерева, которые сервер отдаёт сразу в данных элемента,
 * чтобы клиент не ходил за ними запросами на каждую строку:
 * roleIds (uid ролей) и hasItems у вложенных в info с глубиной.
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

const ADMIN = 'FA000000000001', BOSS = 'FB000000000001', USER1 = 'FU000000000001', USER2 = 'FU000000000002';
let tmp, prev;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-flags-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    for (const uid of [ADMIN, BOSS, USER1, USER2])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${uid}' }`);
    write('WITH/$class/class.js', `export default { label: 'С описанием', '#security': { BOSSES: ['${BOSS}'], USERS: ['${USER1}', '${USER2}', 'GUEST'] } }`);
    write('WITH/$class/readme.md', '# описание');
    write('WITHOUT/$class/class.js', `export default { label: 'Без описания' }`);
    write('PLAIN/doc/readme.MD', '# в папке');
    write('PLAIN/empty/note.txt', 'x');
    write('PLAIN/$class/class.js', `export default { label: 'Папки' }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('флаги строки дерева', () => {
    it('readme_merged: свой слой, иначе ближайший непустой по ~', async () => {
        const withR = await WORK.get_item('/WITH');
        const without = await WORK.get_item('/WITHOUT');
        const own = await withR.readme_merged({});
        assert.ok(own.text.includes('описание'), 'свой слой');
        assert.ok(String(own.path).endsWith('readme.md'), 'путь файла: ' + own.path);
        const parent = await without.readme_merged({});
        assert.equal(typeof parent.text, 'string');
    });

    it('roleIds: uid по ролям, литерал GUEST отброшен; без назначений — пустые массивы', async () => {
        const withR = await WORK.get_item('/WITH');
        const without = await WORK.get_item('/WITHOUT');
        assert.deepEqual((await withR.info({})).roleIds, { ADMIN: [], BOSS: [BOSS], USER: [USER1, USER2], GUEST: [] });
        assert.deepEqual((await without.info({})).roleIds, { ADMIN: [], BOSS: [], USER: [], GUEST: [] });
        const root = await WORK.get_item('/');
        const list = JSON.parse(JSON.stringify(await root.items));
        assert.deepEqual(list.find(i => i.id === 'WITH').roleIds.USER, [USER1, USER2], 'в списке @items');
    });

    it('info deep: у вложенных hasItems совпадает с реальными items, у корня — по своему списку', async () => {
        const root = await WORK.get_item('/');
        const res = await root.info({ deep: 2 });
        assert.equal(res.hasItems, true);
        const walk = async (node) => {
            const item = await WORK.get_item(node.path || '/');
            const real = ((await item.items) || []).length > 0;
            assert.equal(node.hasItems, real, node.path);
            for (const c of node.items || [])
                await walk(c);
        };
        for (const c of res.items)
            await walk(c);
        const plain = res.items.find(i => i.id === 'PLAIN');
        assert.ok(Array.isArray(plain.items), 'класс раскрыт');
        const empty = plain.items.find(i => i.id === 'empty');
        assert.equal(empty.hasItems, true, 'папка с файлом');
        assert.equal(empty.items, undefined, 'глубина исчерпана — список не отдан');
        const without = res.items.find(i => i.id === 'WITHOUT');
        assert.deepEqual(without.items, [], 'пустой класс — пустой список');
        assert.equal(without.hasItems, false);
    });

    it('info deep без вложенного режима не добавляет hasItems (прежний ответ)', async () => {
        const withR = await WORK.get_item('/WITH');
        assert.equal('hasItems' in (await withR.info({})), false);
        assert.equal('hasItems' in (await withR.info({ hasItems: 'true' })), false, 'снаружи флаг не включить строкой');
    });

    it("branch: 'classes' — вглубь только по классам, папки одним уровнем с hasItems", async () => {
        const plain = await WORK.get_item('/PLAIN');
        const res = await plain.info({ deep: 3, branch: 'classes' });
        const doc = res.items.find(i => i.id === 'doc');
        assert.equal(doc.items, undefined, 'папка не раскрыта');
        assert.equal(doc.hasItems, true);
        const all = await plain.info({ deep: 3 });
        assert.ok(Array.isArray(all.items.find(i => i.id === 'doc').items), 'без branch — раскрыта');
    });

    it('roleIds совпадает со старым ответом users/bosses', async () => {
        const withR = await WORK.get_item('/WITH');
        const info = await withR.info({});
        assert.deepEqual((await withR.users).map(u => u.id), info.roleIds.USER);
        assert.deepEqual((await withR.bosses).map(u => u.id), info.roleIds.BOSS);
    });
});
