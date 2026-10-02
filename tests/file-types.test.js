/**
 * Типы файлов: в `$data` — только `$data`; `.ics`/`.task` пишутся точками
 * в зону роли; builder сохраняет STATIC+FIELDS в класс, а не в тип.
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
const ADMIN = 'FA000000000001', USER1 = 'FU000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } }, role: 'USER' });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function copy(rel) {
    write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-filetypes-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    copy('$server/$folder/$file/$data/class.js');
    copy('$server/$folder/$file/$ics/class.js');
    copy('$server/$folder/$file/$task/class.js');
    copy('$server/$folder/$file/$eml/class.js');
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Исполнитель']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('BOX/$class/class.js', `export default { label: 'Коробка', '#security': { USERS: ['${USER1}'] } }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

function pointFiles(zone, ext) {
    const root = path.join(tmp, zone);
    if (!fs.existsSync(root))
        return [];
    return fs.readdirSync(root, { recursive: true })
        .filter(f => String(f).endsWith('.' + ext) && !String(f).split(path.sep).some(s => s.startsWith('.')));
}

describe('типы файлов', () => {
    it('data_types — только [$data]', async () => {
        const box = await WORK.get_item('/BOX');
        const types = await box.data_types;
        assert.deepEqual(types.map(t => t.id), ['$data']);
        assert.equal(await box.is_data_type('x.data'), true);
        assert.equal(await box.is_data_type('x.ics'), true);
        assert.equal(await box.is_data_type('x.task'), true);
        assert.equal(await box.is_data_type('x.md'), false);
    });

    it('.ics пишется точкой в зону роли', async () => {
        const box = await WORK.get_item('/BOX');
        const log = await box.meta_folder.save_file({ folder: 'USER', filename: 'встреча.ics',
            post: JSON.stringify({ summary: 'Созвон', start: '2026-10-02T10:00' }) });
        const files = pointFiles('BOX/$class/USER', 'ics');
        assert.equal(files.length, 1);
        const body = JSON.parse(fs.readFileSync(path.join(tmp, 'BOX/$class/USER', files[0]), 'utf-8'));
        assert.equal(body.summary, 'Созвон');
        assert.ok(log.logFullPath || log.path);
    });

    it('.task пишется точкой в зону роли', async () => {
        const box = await WORK.get_item('/BOX');
        await box.meta_folder.save_file({ folder: 'USER', filename: 't1.task',
            post: JSON.stringify({ name: 'Задача', items: [] }), skip_file_handler: true });
        const files = pointFiles('BOX/$class/USER', 'task');
        assert.equal(files.length, 1);
    });
});

describe('builder сохраняет схему в класс', () => {
    it('STATIC+FIELDS уходят в body класса, в тип ничего не пишется', async () => {
        const builder = (await import('../$server/$folder/$class/handlers/pages/form/builder/$handler/builder.js')).default;
        globalThis.CORE ??= {};
        globalThis.CORE.$field ??= class {
            constructor(data) { this.DATA = data; }
        };
        globalThis.CORE.$class ??= { fieldsList: (f) => Array.isArray(f) ? f : (f?.fields || []) };
        const body = { label: 'K', METADATA: { STATIC: [{ id: 'a' }], FIELDS: [{ id: 'b' }] } };
        const saved = [];
        const item = {
            role: 'USER',
            body: Promise.resolve(body),
            $fields: Promise.resolve({ DATA: { fields: [{ id: 'a' }, { id: 'c', type: 'Number' }] } }),
            metadata: Promise.resolve(body.METADATA),
            save: async (b, p) => { saved.push({ b, p }); },
        };
        const h = Object.assign(Object.create(builder), { $item: item });
        await h.save();
        assert.equal(saved.length, 1);
        assert.deepEqual(saved[0].b.METADATA.STATIC.map(f => f.id), ['a', 'c']);
        assert.deepEqual(saved[0].b.METADATA.FIELDS, [{ id: 'b' }]);
        assert.deepEqual(saved[0].p, { role: 'USER' });
    });
});
