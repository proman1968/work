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
 * Smoke-тесты ядра на изолированном дереве (песочница в tmp).
 * Фиксируют инварианты, которые обязаны пережить рефакторинг:
 * 1. get_item: имя, ~, ~/x, *
 * 2. collect_tilde: порядок слоёв, SELF (meta_folder) — последний
 * 3. Сборка DATA из цепочки class.js (merge + import)
 * 4. save_file → снимок в history/YYYY-MM-DD → запись лога → триггер on_save
 * 5. steps файла по расширению ($file → $smoke)
 */

let tmp;
let prevCwd;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-smoke-'));

    write('$server/class.js', `export default { label: 'WORK-SMOKE' }`);
    write('$server/$folder/class.js', `export default { fromFolderLayer: true }`);
    write('$server/$folder/$class/class.js', `export default { fromClassLayer: true }`);
    write('$server/$folder/$file/$smoke/class.js', `export default { smokeType: true }`);
    write('$server/$folder/$file/$smoke/triggers/on_save/$trigger/class.js',
        `export default {
    async execute(p) {
        globalThis.__SMOKE_ON_SAVE__ = (globalThis.__SMOKE_ON_SAVE__ || 0) + 1;
        globalThis.__SMOKE_LAST_LOG__ = p.logFullPath || null;
    }
}`);
    write('BOX/$class/class.js', `export default { label: 'BOX', selfMarker: 'self' }`);

    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    // Дать асинхронным on_save-цепочкам от последних save_file завершиться,
    // прежде чем сносить песочницу (иначе триггер и rm воюют за каталоги).
    await new Promise(r => setTimeout(r, 1000));
    process.chdir(prevCwd);
    try {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
    catch { /* windows: файлы могут быть заняты, tmp почистит ОС */ }
});

describe('get_item: базовый синтаксис путей', () => {
    it('находит класс по имени', async () => {
        const box = await WORK.get_item('/BOX');
        assert.ok(box, 'BOX должен находиться');
        assert.ok(box instanceof FS.$class, 'BOX должен быть $class');
        assert.equal(box.type, '$class');
    });

    it('~ возвращает слои наследования, ~/class.js — только class.js', async () => {
        const box = await WORK.get_item('/BOX');
        const files = await box.get_item('~/class.js');
        assert.ok(Array.isArray(files), '~/class.js должен вернуть массив слоёв');
        assert.ok(files.length >= 2, 'минимум глобальный слой + SELF');
        assert.ok(files.every(f => f.id === 'class.js'));
    });

    it('* возвращает детей папки', async () => {
        const items = await WORK.get_item('/BOX/*');
        assert.ok(Array.isArray(items));
    });
});

describe('collect_tilde: порядок слоёв', () => {
    it('SELF (meta_folder) — последний слой в ~/class.js', async () => {
        const box = await WORK.get_item('/BOX');
        const files = await box.get_item('~/class.js');
        const last = files[files.length - 1];
        assert.match(
            last.real_dir.replaceAll('\\', '/'),
            /BOX\/\$class\/class\.js$/,
            'последний слой — собственный class.js из метапапки',
        );
    });
});

describe('сборка DATA из цепочки class.js', () => {
    it('info() собирает DATA из всех слоёв (init)', async () => {
        const box = await WORK.get_item('/BOX');
        await box.info();
        assert.equal(box.DATA.selfMarker, 'self', 'SELF-слой в DATA');
        assert.equal(box.DATA.fromFolderLayer, true, 'слой $folder в DATA');
        assert.equal(box.DATA.label, 'BOX');
    });

    it('load() возвращает merged-скрипт с данными всех слоёв', async () => {
        const box = await WORK.get_item('/BOX');
        const script = await box.load();
        assert.ok(typeof script === 'string' && script.includes('export default'));
        assert.ok(script.includes('selfMarker'), 'merged содержит SELF-данные');
        assert.ok(script.includes('fromFolderLayer'), 'merged содержит данные слоя $folder');
    });
});

describe('steps файла по расширению', () => {
    it('файл .smoke получает цепочку [$file, $smoke]', async () => {
        const box = await WORK.get_item('/BOX');
        const file = await box._get_item('probe.smoke', FS.$file);
        assert.deepEqual(await file.type_chain, ['$file', '$smoke']);
    });
});

describe('save_file → history → log → on_save', () => {
    it('полный цикл сохранения файла', async () => {
        globalThis.__SMOKE_ON_SAVE__ = 0;
        globalThis.__SMOKE_LAST_LOG__ = null;

        const folder = await WORK.ensure_folder({ id: 'PLAIN' });
        const log = await folder.save_file({
            filename: 'note.smoke',
            post: 'hello',
            encoding: 'utf-8',
        });

        // 1. Текущий файл записан
        const current = path.join(tmp, 'PLAIN', 'note.smoke');
        assert.equal(fs.readFileSync(current, 'utf-8'), 'hello');

        // 2. Снимок в history/YYYY-MM-DD, содержимое идентично текущему
        const day = new Date().toISOString().slice(0, 10);
        const historyDir = path.join(tmp, 'PLAIN', '.note.smoke', 'history', day);
        assert.ok(fs.existsSync(historyDir), 'папка history за сегодня');
        const snapshots = fs.readdirSync(historyDir).filter(f => f.endsWith('.smoke'));
        assert.equal(snapshots.length, 1, 'ровно один снимок');
        assert.equal(fs.readFileSync(path.join(historyDir, snapshots[0]), 'utf-8'), 'hello');
        assert.match(snapshots[0], /^\d+\.[^.]+\.smoke$/, 'имя снимка: <ms>.<uid>.<ext>');

        // 3. Запись лога возвращена и указывает на снимок
        assert.ok(log, 'save_file возвращает запись лога');
        assert.ok(log.path?.includes('/history/' + day + '/'), 'log.path указывает в history');
        assert.equal(log.ext, 'smoke');

        // 4. Лог записан у ближайшего класса (WORK → $server/logs)
        const logsFile = path.join(tmp, '$server', 'logs', 'data.logs');
        assert.ok(fs.existsSync(logsFile), 'data.logs записан в мету класса');
        const row = JSON.parse(fs.readFileSync(logsFile, 'utf-8'));
        assert.equal(row.ext, 'smoke');
        // Без params.message контент файла НЕ инлайнится в лог (ядро не знает имён)
        assert.equal(row.content, undefined, 'без message контент не инлайнится');

        // 5. Триггер on_save типизатора $smoke сработал
        await new Promise(r => setTimeout(r, 800));
        assert.ok(globalThis.__SMOKE_ON_SAVE__ >= 1, 'on_save триггер вызван');
    });

    it('params.message инлайнится в log.content для любого файла', async () => {
        const folder = await WORK.get_item('/PLAIN');
        await folder.save_file({
            filename: 'anything.smoke',
            post: 'тело файла',
            message: 'видимое сообщение',
            encoding: 'utf-8',
        });
        const logsFile = path.join(tmp, '$server', 'logs', 'data.logs');
        const rows = fs.readFileSync(logsFile, 'utf-8')
            .trim().split(/\n(?=\{)/).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
        const row = rows.reverse().find(r => r.path?.includes('anything.smoke'));
        assert.ok(row, 'запись лога для anything.smoke найдена');
        assert.equal(row.content, 'видимое сообщение', 'content = params.message, а не тело файла');
    });

    it('повторное сохранение добавляет второй снимок, текущий файл перезаписан', async () => {
        const folder = await WORK.get_item('/PLAIN');
        await folder.save_file({
            filename: 'note.smoke',
            post: 'hello v2',
            encoding: 'utf-8',
        });

        const current = path.join(tmp, 'PLAIN', 'note.smoke');
        assert.equal(fs.readFileSync(current, 'utf-8'), 'hello v2');

        const day = new Date().toISOString().slice(0, 10);
        const historyDir = path.join(tmp, 'PLAIN', '.note.smoke', 'history', day);
        const snapshots = fs.readdirSync(historyDir).filter(f => f.endsWith('.smoke'));
        assert.equal(snapshots.length, 2, 'два снимка после двух сохранений');
    });

    it('сохранённый файл виден через get_item и *', async () => {
        const file = await WORK.get_item('/PLAIN/note.smoke');
        assert.ok(file, 'файл находится по пути');
        assert.equal(file.ext, 'smoke');

        const items = await WORK.get_item('/PLAIN/*');
        assert.ok(items.some(f => f.id === 'note.smoke'), '* видит файл');
    });
});
