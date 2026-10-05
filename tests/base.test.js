/**
 * Этап 12.1: BASE — организация. Тип $base задаёт реквизиты в METADATA.STATIC
 * (схема одна на всех), значения — в class.js каждой организации (свои).
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
const ADMIN = 'BA000000000001';
let tmp, prev;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function copy(rel) {
    write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

const REQUISITES = ['inn', 'kpp', 'ogrn', 'address', 'phone', 'email', 'bank', 'bik', 'account', 'corr'];

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-base-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write(`USERS/${ADMIN}/$user/class.js`, `export default { label: 'Админ' }`);
    write('BASE/$base/class.js', `export default { label: 'Рога', inn: '111' }`);
    write('BASE/filial/$base/class.js', `export default { label: 'Копыта', inn: '222' }`);
    copy('$server/$folder/$class/$structure/$base/class.js');
    copy('BASE/$base/$folder/$class/$structure/$base/class.js');
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('организация', () => {
    it('тип задаёт схему реквизитов, корень и филиал её видят', async () => {
        for (const p of ['/BASE', '/BASE/filial']) {
            const cls = await WORK.get_item(p);
            assert.equal(cls.type, '$base');
            assert.deepEqual((cls.METADATA?.STATIC || []).map(f => f.id), REQUISITES);
        }
    });

    it('значения реквизитов — свои у каждой организации', async () => {
        const root = await WORK.get_item('/BASE');
        const filial = await WORK.get_item('/BASE/filial');
        assert.equal(root.DATA?.inn, '111');
        assert.equal(filial.DATA?.inn, '222');
        assert.equal(root.DATA?.label, 'Рога');
    });
});
