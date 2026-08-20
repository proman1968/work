import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as CORE from '../sources/server/index.js';
import { execItemMethod } from '../sources/host/http-server.js';

// assertAccess (class.js) пропускает проверку, если session.$user === globalThis.WORK:
// при отсутствии WORK (undefined) любая сессия без $user совпадает и проверка молчит.
// Мок WORK без роли ADMIN, чтобы ветки доступа отрабатывали по-настоящему.
let prevWork;

before(() => {
    prevWork = globalThis.WORK;
    globalThis.WORK = { roles: async () => [] };
});

after(() => {
    globalThis.WORK = prevWork;
});

// В unit-тестах нет WORK.$folder, поэтому геттер _methods ядра (доступ к ~/methods/*)
// падал бы с TypeError, который tryHandlerMethod глотает (catch {}) — тест проходил,
// но консоль засорялась и ветка хендлеров не тестировалась. Заглушка _methods
// отдаёт собственный набор хендлеров теста (__handlers) и позволяет проверить
// ветку tryHandlerMethod по-настоящему.
const withStubMethods = (Base) => class extends Base {
    get _methods() {
        return Promise.resolve(this.__handlers || {});
    }
};

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
        class TestFolder extends withStubMethods(CORE.$folder) {}
        const folder = new TestFolder({ id: 'test' });
        folder.path = '/test';
        await assert.rejects(
            () => execItemMethod(folder, 'missing_method', {}, { method: 'GET' }),
            /Unknown method/
        );
    });

    it('runs ~/methods/* handler branch (tryHandlerMethod)', async () => {
        class TestFolder extends withStubMethods(CORE.$folder) {}
        const folder = new TestFolder({ id: 'test' });
        folder.path = '/test';
        folder.__handlers = {
            ping: {
                async execute(p) {
                    return { called: true, ctxIsItem: p.$context === folder };
                },
            },
        };
        const result = await execItemMethod(folder, 'ping', {}, { method: 'POST' });
        assert.deepEqual(result, { called: true, ctxIsItem: true });
    });

    it('class method wins over handler with same name', async () => {
        class TestFolder extends withStubMethods(CORE.$folder) {
            async ping() {
                return { fromClass: true };
            }
        }
        const folder = new TestFolder({ id: 'test' });
        folder.path = '/test';
        folder.__handlers = { ping: { async execute() { return { fromHandler: true }; } } };
        const result = await execItemMethod(folder, 'ping', {}, { method: 'POST' });
        assert.deepEqual(result, { fromClass: true });
    });

    it('blocks delete for non-admin user', async () => {
        class TestClass extends CORE.$class {
            get admins() {
                return [{ id: 'admin1' }];
            }
        }
        const storage = new TestClass({ id: 'group' });
        storage.path = '/root/test/$group';
        Object.defineProperty(storage, '$class', { get: () => storage });
        await assert.rejects(
            () => execItemMethod(storage, 'delete', { session: { uid: 'user1' } }, { method: 'GET' }),
            /Доступ запрещён/
        );
    });

    it('blocks save_file for guest session', async () => {
        // Доступ проверяет класс-владелец: у реальных папок он есть всегда (корень — WORK).
        class TestClass extends CORE.$class {}
        const owner = new TestClass({ id: 'group' });
        owner.path = '/root/test/$group';
        Object.defineProperty(owner, '$class', { get: () => owner });

        class TestFolder extends withStubMethods(CORE.$folder) {}
        const folder = new TestFolder({ id: 'sources' });
        folder.path = '/sources';
        Object.defineProperty(folder, '$class', { get: () => owner });
        await assert.rejects(
            () => execItemMethod(folder, 'save_file', { session: { ssid: 'guest' } }, { method: 'POST' }),
            /Доступ запрещён/
        );
    });

    it('passes params.post to prototype methods when request.post is empty', async () => {
        class TestClass extends CORE.$class {
            async save_message(params, post) {
                return { post, paramsPost: params.post };
            }
        }
        const storage = new TestClass({ id: '$user' });
        storage.path = '/USERS/TEST/$user';
        Object.defineProperty(storage, '$class', { get: () => storage });
        const body = {
            files: [{ originalFilename: 'sample.txt' }],
            message: 'hello',
        };
        const params = { message: 'hello', post: body, session: { uid: 'TEST' } };
        const result = await execItemMethod(storage, 'save_message', params, { method: 'POST' });
        assert.equal(result.post, body);
        assert.equal(result.paramsPost, body);
    });
});
