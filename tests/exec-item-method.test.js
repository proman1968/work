import '../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as CORE from '../sources/server/index.js';
import { execItemMethod } from '../sources/host/http-server.js';

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

    it('throws on unknown method', async () => {
        class TestFolder extends CORE.$folder {}
        const folder = new TestFolder({ id: 'test' });
        folder.path = '/test';
        await assert.rejects(
            () => execItemMethod(folder, 'missing_method', {}, { method: 'GET' }),
            /Unknown method/
        );
    });

    it('blocks delete for non-admin user', async () => {
        class TestStorage extends CORE.$storage {
            get admins() {
                return [{ id: 'admin1' }];
            }
        }
        const storage = new TestStorage({ id: 'group' });
        storage.path = '/root/test/$group';
        Object.defineProperty(storage, '$storage', { get: () => storage });
        await assert.rejects(
            () => execItemMethod(storage, 'delete', { user: { uid: 'user1' } }, { method: 'GET' }),
            /Доступ запрещён/
        );
    });

    it('blocks save_file for guest session', async () => {
        class TestFolder extends CORE.$folder {}
        const folder = new TestFolder({ id: 'sources' });
        folder.path = '/sources';
        await assert.rejects(
            () => execItemMethod(folder, 'save_file', { user: { ssid: 'guest' } }, { method: 'POST' }),
            /Доступ запрещён/
        );
    });

    it('passes params.post to prototype methods when request.post is empty', async () => {
        class TestStorage extends CORE.$storage {
            async task_reply(params, post) {
                return { post, paramsPost: params.post };
            }
        }
        const storage = new TestStorage({ id: '$user' });
        storage.path = '/users/TEST/$user';
        Object.defineProperty(storage, '$storage', { get: () => storage });
        const body = {
            files: [{ originalFilename: 'sample.txt' }],
            message: { originalFilename: 'message.txt' },
        };
        const params = { taskPath: '/task.ai', post: body, user: { uid: 'TEST' } };
        const result = await execItemMethod(storage, 'task_reply', params, { method: 'POST' });
        assert.equal(result.post, body);
        assert.equal(result.paramsPost, body);
    });
});
