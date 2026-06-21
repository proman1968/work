import '../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as CORE from '../sources/server.js';
import { execItemMethod } from '../sources/server/exec-item-method.js';

describe('execItemMethod', () => {
    it('returns non-folder items as-is', () => {
        const item = { path: '/test' };
        assert.equal(execItemMethod(item, 'info', {}, { method: 'GET' }), item);
    });

    it('calls folder info method', async () => {
        class TestFolder extends CORE.$folder {
            async info() {
                return { ok: true, path: this.path };
            }
        }
        const folder = new TestFolder({ id: 'test' });
        folder.path = '/test';
        const result = await execItemMethod(folder, 'info', {}, { method: 'GET' });
        assert.deepEqual(result, { ok: true, path: '/test' });
    });
});
