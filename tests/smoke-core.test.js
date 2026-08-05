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
    write('$server/$folder/$file/$smoke/class.js',
        `export default { smokeType: true, ping() { return 'pong'; } }`);
    write('$server/$folder/$file/$smoke/triggers/on_save/$trigger/class.js',
        `export default {
    async execute(p) {
        globalThis.__SMOKE_ON_SAVE__ = (globalThis.__SMOKE_ON_SAVE__ || 0) + 1;
        globalThis.__SMOKE_LAST_LOG__ = p.logFullPath || null;
        // Регрессия ai.task: методы merged class.js попадают на инстанс только после init
        await p.$context.init;
        globalThis.__SMOKE_CTX_PING__ = typeof p.$context.ping;
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

describe('Reactor#async на сервере', () => {
    // Регрессия ai.task: async(fn) без delay падал с ReferenceError,
    // т.к. в Node нет requestAnimationFrame (голый идентификатор)
    it('async(fn) без delay выполняет колбэк', async () => {
        const box = await WORK.get_item('/BOX');
        let called = false;
        assert.doesNotThrow(() => box.async(() => { called = true; }));
        await new Promise(r => setTimeout(r, 10));
        assert.equal(called, true);
    });

    it('async(fn, delay) выполняет колбэк через setTimeout', async () => {
        const box = await WORK.get_item('/BOX');
        let called = false;
        box.async(() => { called = true; }, 5);
        await new Promise(r => setTimeout(r, 50));
        assert.equal(called, true);
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

        // 6. После await $context.init методы типизатора доступны на инстансе
        // (паттерн $ai-триггера: taskFile.prompt после init)
        assert.equal(globalThis.__SMOKE_CTX_PING__, 'function',
            'метод class.js типизатора виден на $context после init');
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

describe('лог-фасад: logs / read_log_entry / append_log_includes', () => {
    const day = new Date().toISOString().slice(0, 10);

    it('logs({mode: "dates"}) содержит сегодня', async () => {
        const dates = await WORK.logs({ mode: 'dates' });
        assert.ok(Array.isArray(dates));
        assert.ok(dates.includes(day), 'сегодняшний день в списке дат');
    });

    it('logs({mode: "bodies"}) возвращает записи, mode: "index" — индекс без content', async () => {
        const rows = await WORK.logs({ mode: 'bodies', day });
        assert.ok(rows.length >= 1, 'есть записи за сегодня');
        assert.ok(rows.every(r => r.time != null));

        const flat = await WORK.logs({ mode: 'index', flat: true, day });
        assert.equal(flat.length, rows.length, 'индекс покрывает те же записи');
        assert.ok(flat.every(r => !('content' in r)), 'в индексе нет content');
    });

    it('read_log_entry находит запись, append_log_includes дописывает includes', async () => {
        const rows = await WORK.logs({ mode: 'bodies', day });
        const target = rows.find(r => r.path);
        assert.ok(target, 'есть запись с path');

        const found = await WORK.read_log_entry({ path: target.path });
        assert.ok(found, 'запись найдена по path');
        assert.equal(found.path, target.path);

        const updated = await WORK.append_log_includes({
            entryPath: target.path,
            includePaths: ['/PLAIN/extra.smoke'],
        });
        assert.ok(updated, 'append вернул обновлённую запись');
        assert.ok(updated.includes.includes('/PLAIN/extra.smoke'));

        const reread = await WORK.read_log_entry({ path: target.path });
        assert.ok(reread.includes?.includes('/PLAIN/extra.smoke'), 'includes сохранены на диске');
    });
});

describe('словарь API: members / assertAccess / work_zone / find_item', () => {
    it('members({role}) читает #security, без role — дедуплицированные все', async () => {
        write('USERS/u1/$user/class.js', `export default { label: 'U1' }`);
        write('MBOX/$class/class.js',
            `export default { label: 'MBOX', '#security': { ADMIN: 'u1', USERS: ['u1'] } }`);
        WORK.reset();

        const mbox = await WORK.get_item('/MBOX');
        const admins = await mbox.members({ role: 'ADMIN' });
        assert.equal(admins.length, 1, 'один ADMIN из #security');
        assert.equal(admins[0].id, 'u1');

        const users = await mbox.members({ role: 'USER' });
        assert.equal(users[0]?.id, 'u1');

        const bosses = await mbox.members({ role: 'BOSS' });
        assert.deepEqual(bosses, [], 'BOSS не назначен');

        const inherited = await mbox.members({ role: 'ADMIN', inherited: true });
        assert.ok(inherited.some(u => u.id === 'u1'), 'inherited включает собственного админа');

        const all = await mbox.members();
        assert.equal(all.length, 1, 'один пользователь во всех ролях — дедупликация по id');
    });

    it('work_zone({role}) даёт зону роли, get_storage — deprecated алиас', async () => {
        const mbox = await WORK.get_item('/MBOX');
        const zone = await mbox.work_zone({ role: 'USER' });
        assert.ok(zone.path.replaceAll('\\', '/').endsWith('/work'), 'USER-зона — папка work');
        const legacy = await mbox.get_storage({ role: 'USER' });
        assert.equal(legacy.path, zone.path, 'алиас возвращает ту же папку');
        const def = await mbox.work_zone({});
        assert.equal(def, mbox.meta_folder, 'без роли — метапапка');
    });

    it('assertAccess бросает при отказе, allowAccess — deprecated алиас', async () => {
        const prevWorkDev = process.env.WORK_DEV;
        const prevDev = process.env.dev;
        process.env.WORK_DEV = 'false';
        delete process.env.dev;
        try {
            const mbox = await WORK.get_item('/MBOX');
            // Без user — no-op (внутренний вызов)
            await mbox.assertAccess({}, FS.$class.ACCESS_LEVEL.READ);
            // user без uid на WRITE — отказ, через оба имени
            await assert.rejects(mbox.assertAccess({ user: {} }, FS.$class.ACCESS_LEVEL.WRITE));
            await assert.rejects(mbox.allowAccess({ user: {} }, FS.$class.ACCESS_LEVEL.WRITE));
        }
        finally {
            if (prevWorkDev === undefined) delete process.env.WORK_DEV;
            else process.env.WORK_DEV = prevWorkDev;
            if (prevDev !== undefined) process.env.dev = prevDev;
        }
    });

    it('find_item: объектная форма эквивалентна позиционной', async () => {
        const viaObj = await WORK.$folder.find_item({ name: '$smoke', types_only: true });
        assert.ok(viaObj, '$smoke найден объектной формой');
        assert.equal(viaObj.id, '$smoke');
        const viaPos = await WORK.$folder.find_item('$smoke', item => item.id?.[0] === '$');
        assert.equal(viaPos.path, viaObj.path, 'обе формы находят один элемент');
    });
});

describe('мультифайл на чистых логах: save_message / save_files', () => {
    it('save_message пишет content без физического файла', async () => {
        const marker = 'pure-msg-' + Date.now();
        const row = await WORK.save_message({ message: marker });
        assert.equal(row.content, marker);
        assert.ok(!row.path, 'без path — нет файла');
        const bodies = await WORK.logs({ mode: 'bodies', day: new Date().toISOString().slice(0, 10) });
        assert.ok(bodies.some(r => r.content === marker), 'запись видна в logs(bodies)');
    });

    it('save_files: файлы в history, одна запись content+includes, без files.pack', async () => {
        let folder = await WORK.get_item('/PLAIN');
        if (!folder)
            folder = await WORK.ensure_folder({ id: 'PLAIN' });
        const marker = 'batch-msg-' + Date.now();
        const row = await folder.save_files({
            message: marker,
            encoding: 'utf-8',
            post: {
                files: [
                    { name: 'a.smoke', buffer: Buffer.from('aaa') },
                    { name: 'b.smoke', buffer: Buffer.from('bbb') },
                ],
            },
        });
        assert.equal(row.content, marker);
        assert.ok(Array.isArray(row.includes) && row.includes.length === 2);
        assert.ok(row.includes.every(p => p.includes('.smoke')));
        assert.ok(!fs.existsSync(path.join(tmp, 'PLAIN', 'files.pack')), 'files.pack не создаётся');
        assert.ok(fs.existsSync(path.join(tmp, 'PLAIN', 'a.smoke')));
        assert.ok(fs.existsSync(path.join(tmp, 'PLAIN', 'b.smoke')));
    });

    it('save_files(ignore_save_logs) возвращает массив файловых логов', async () => {
        let folder = await WORK.get_item('/PLAIN');
        if (!folder)
            folder = await WORK.ensure_folder({ id: 'PLAIN' });
        const logs = await folder.save_files({
            ignore_save_logs: true,
            encoding: 'utf-8',
            post: {
                files: [{ name: 'c.smoke', buffer: Buffer.from('ccc') }],
            },
        });
        assert.ok(Array.isArray(logs));
        assert.equal(logs.length, 1);
        assert.ok(logs[0].path?.includes('c.smoke'));
    });
});
