import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FS } from '../sources/server/index.js';
import { $server } from '../sources/server/server.js';

/**
 * Тесты геттеров children / inherit_children ($folder).
 * Фиксируют инварианты, которые обязаны пережить рефакторинг:
 * 1. Оба геттера содержат собственные файлы папки.
 * 2. Наследуемые НЕ-типы попадают в оба геттера.
 * 3. Наследуемые ТИПЫ ($-папки) от прямого предка скрыты в children,
 *    но присутствуют в inherit_children (поток для ~/tilde).
 * 4. Оба геттера дедуплицируют по id.
 * 5. _collect_own возвращает только собственные файлы (без наследования).
 */

let tmp;
let prevCwd;

function write(rel, content = '') {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function ids(list) {
    return list.map(f => f.id);
}

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-children-'));

    write('$server/class.js', `export default { label: 'WORK' }`);
    write('$server/$folder/class.js', `export default { fromFolder: true }`);
    write('$server/$folder/$class/class.js', `export default { fromClass: true }`);
    write('$server/$folder/$file/class.js', `export default { fromFile: true }`);
    write('$server/$folder/$file/$smoke/class.js', `export default { smoke: true }`);
    // Класс BOX с метапапками $class и $file (типизирован как $file).
    write('BOX/$class/class.js', `export default { label: 'BOX' }`);
    write('BOX/$file/class.js', `export default { label: 'BOX-file' }`);
    write('BOX/own.txt', 'own');
    // Общий (наследуемый) файл и типы из типа $folder.
    write('$server/$folder/shared.txt', 'shared');
    write('$server/$folder/$class/shared-class.txt', 'shared-class');

    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    process.chdir(prevCwd);
    try {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
    catch { /* windows: файлы могут быть заняты, tmp почистит ОС */ }
});

describe('$folder.children vs inherit_children', () => {
    it('собственные файлы и типы присутствуют в обоих геттерах', async () => {
        const file = await WORK.get_item('/$server/$folder/$file');
        const children = await file.children;
        const inheritChildren = await file.inherit_children;

        for (const id of ['class.js', '$smoke'])
            assert.ok(ids(children).includes(id), `children содержит собственный ${id}`);
        for (const id of ['class.js', '$smoke'])
            assert.ok(ids(inheritChildren).includes(id), `inherit_children содержит собственный ${id}`);

        const box = await WORK.get_item('/BOX');
        const boxChildren = await box.children;
        const boxInherit = await box.inherit_children;
        for (const id of ['own.txt', '$class', '$file'])
            assert.ok(ids(boxChildren).includes(id), `children BOX содержит ${id}`);
        assert.ok(ids(boxInherit).includes('own.txt'), 'inherit_children BOX содержит own.txt');
    });

    it('наследуемые НЕ-типы попадают в оба геттера', async () => {
        const file = await WORK.get_item('/$server/$folder/$file');
        const children = await file.children;
        const inheritChildren = await file.inherit_children;

        assert.ok(ids(children).includes('shared.txt'), 'children наследует shared.txt');
        assert.ok(ids(inheritChildren).includes('shared.txt'), 'inherit_children наследует shared.txt');
        const own = await file._collect_own();
        assert.ok(!ids(own).includes('shared.txt'), '_collect_own не содержит наследуемого shared.txt');
    });

    it('наследуемые ТИПЫ от прямого предка скрыты в children, но есть в inherit_children', async () => {
        const file = await WORK.get_item('/$server/$folder/$file');
        const children = await file.children;
        const inheritChildren = await file.inherit_children;

        // Родитель типа $file — тип $folder; его типы ($class, $file) наследуются.
        for (const t of ['$class', '$file'])
            assert.ok(!ids(children).includes(t), `children скрывает наследуемый тип ${t}`);
        for (const t of ['$class', '$file'])
            assert.ok(ids(inheritChildren).includes(t), `inherit_children содержит наследуемый тип ${t}`);

        // Собственный тип $smoke — НЕ наследуемый, остаётся видимым в children.
        assert.ok(ids(children).includes('$smoke'), 'собственный тип $smoke виден в children');
    });

    it('дедупликация по id в обоих геттерах', async () => {
        for (const p of ['/$server/$folder/$file', '/$server/$folder/$class', '/BOX']) {
            const f = await WORK.get_item(p);
            for (const list of [await f.children, await f.inherit_children]) {
                const seen = ids(list);
                assert.equal(new Set(seen).size, seen.length, `нет дублей id у ${p}`);
            }
        }
    });

    it('собственная типизация класса не скрывает типы', async () => {
        // BOX наследует $folder-тип через свой $file-тип (виден в обоих геттерах).
        const meta = await WORK.get_item('/BOX/$file');
        const children = await meta.children;
        const inheritChildren = await meta.inherit_children;
        assert.ok(ids(children).includes('$folder'), 'children BOX/$file содержит $folder');
        assert.ok(ids(inheritChildren).includes('$folder'), 'inherit_children BOX/$file содержит $folder');
    });
});