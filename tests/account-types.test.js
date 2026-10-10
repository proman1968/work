/**
 * Этап 6: каркас типов учёта — поля проводки наследуются счётом из типа $account.
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
const ADMIN = 'TA000000000001';
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

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-acctypes-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    copy('DATA/REGISTER/$register/class.js');
    copy('DATA/REGISTER/$register/$folder/$class/$account/class.js');
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('типы учёта', () => {
    it('счёт наследует поля проводки из типа $account', async () => {
        const reg = await WORK.get_item('/DATA/REGISTER');
        await reg.create({ id: '62', type: '$account', post: `export default { label: 'Расчёты с покупателями', icon: 'carbon:wallet' }`, ...as(ADMIN) });
        const acc = await WORK.get_item('/DATA/REGISTER/62');
        assert.equal(acc.type, '$account');
        const ids = (acc.METADATA?.FIELDS || []).map(f => f.id);
        for (const f of ['source', 'entry', 'rule', 'corr_account', 'debit', 'credit', 'qty_in', 'qty_out', 'storno'])
            assert.ok(ids.includes(f), 'нет поля ' + f);
    });
});
