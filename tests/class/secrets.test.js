import '../../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as CORE from '../../sources/server/index.js';

describe('$class secrets', () => {
    // ADMIN-уровень save_secret/read_secret требует роль ADMIN на корневом WORK
    class TestClass extends CORE.$class {
        constructor() {
            super({ id: 'group' });
            this._tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-secret-'));
        }
        _secretPath(name) {
            return path.join(this._tmp, name + '.json');
        }
        async _ensureSystemDir() {}
        get meta_folder() {
            return { reset() {} };
        }
    }

    function withWorkAdmin(adminUid, fn) {
        const prev = globalThis.WORK;
        globalThis.WORK = {
            async roles(p) {
                return p?.user?.uid === adminUid ? ['ADMIN'] : [];
            },
        };
        return Promise.resolve(fn()).finally(() => { globalThis.WORK = prev; });
    }

    it('read_secret and save_secret roundtrip for admin', () => withWorkAdmin('admin1', async () => {
        const item = new TestClass();
        const user = { uid: 'admin1', $user: { id: 'admin1' } };
        await item.save_secret({ name: 'testmodule', user, post: { value: 42 } });
        const data = await item.read_secret({ name: 'testmodule', user });
        assert.equal(data.value, 42);
        fs.rmSync(item._tmp, { recursive: true, force: true });
    }));

    it('save_secret вызывает необязательный хук on_secret_save слоя 2', () => withWorkAdmin('admin1', async () => {
        const item = new TestClass();
        const calls = [];
        item.on_secret_save = async ({ name, data }) => { calls.push({ name, data }); };
        const user = { uid: 'admin1', $user: { id: 'admin1' } };
        await item.save_secret({ name: 'email', user, post: { mailboxes: { 'a@b.c': {} } } });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].name, 'email');
        assert.deepEqual(Object.keys(calls[0].data.mailboxes), ['a@b.c']);
        fs.rmSync(item._tmp, { recursive: true, force: true });
    }));

    it('save_secret rejects non-admin', () => withWorkAdmin('admin1', async () => {
        const item = new TestClass();
        await assert.rejects(
            () => item.save_secret({ name: 'testmodule', user: { uid: 'other' }, post: {} }),
            /Доступ запрещён/
        );
    }));
});
