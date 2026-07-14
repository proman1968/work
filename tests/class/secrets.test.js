import '../../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as CORE from '../../sources/server/index.js';

describe('$class secrets', () => {
    it('read_secret and save_secret roundtrip for admin', async () => {
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
            get admins() {
                return [{ id: 'admin1' }];
            }
        }
        const item = new TestClass();
        const user = { uid: 'admin1', $user: { id: 'admin1' } };
        await item.save_secret({ name: 'testmodule', user, post: { value: 42 } });
        const data = await item.read_secret({ name: 'testmodule', user });
        assert.equal(data.value, 42);
        fs.rmSync(item._tmp, { recursive: true, force: true });
    });

    it('save_secret rejects non-admin', async () => {
        class TestClass extends CORE.$class {
            get admins() {
                return [{ id: 'admin1' }];
            }
        }
        const item = new TestClass();
        await assert.rejects(
            () => item.save_secret({ name: 'testmodule', user: { uid: 'other' }, post: {} }),
            /Доступ запрещён/
        );
    });
});
