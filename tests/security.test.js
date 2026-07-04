import '../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as Security from '../sources/host/security.js';
import * as CORE from '../sources/server/index.js';

describe('security helpers', () => {
    it('resolveUid prefers $user.id', () => {
        assert.equal(Security.resolveUid({ user: { uid: 'a', $user: { id: 'b' } } }), 'b');
        assert.equal(Security.resolveUid({ user: { uid: 'a' } }), 'a');
        assert.equal(Security.resolveUid({}), null);
    });

    it('resolveUid null without user.uid even if $user present', () => {
        assert.equal(Security.resolveUid({ user: { $user: { id: 'b' } } }), null);
    });

    it('hasUserBoundary when users list is non-empty', () => {
        assert.equal(Security.hasUserBoundary({ DATA: { '#security': { users: ['u1'] } } }), true);
        assert.equal(Security.hasUserBoundary({ DATA: { '#security': { users: [] } } }), false);
        assert.equal(Security.hasUserBoundary({ DATA: {} }), false);
    });

    it('isUserCabinetPath', () => {
        assert.equal(Security.isUserCabinetPath('/users//ABC/$user/text'), true);
        assert.equal(Security.isUserCabinetPath('/users/ABC/$user/logs'), true);
        assert.equal(Security.isUserCabinetPath('/root/meeting/$group'), false);
    });

    it('isOwnUserCabinetPath', () => {
        assert.equal(Security.isOwnUserCabinetPath('/users//U1/$user/text', 'U1'), true);
        assert.equal(Security.isOwnUserCabinetPath('/users//U2/$user/text', 'U1'), false);
    });

    it('isSecurityEnabled is false in WORK_DEV', () => {
        assert.equal(Security.isSecurityEnabled({ WORK_DEV: 'true' }), false);
        assert.equal(Security.isSecurityEnabled({}), true);
    });

    it('is$serverPath', () => {
        assert.equal(Security.is$serverPath('/$server'), true);
        assert.equal(Security.is$serverPath('/$server/$folder/lib'), true);
        assert.equal(Security.is$serverPath('/root'), false);
    });

    it('isInsideMetaFolder for user cabinet content', () => {
        assert.equal(Security.isInsideMetaFolder({ path: '/users//U1/$user/text', id: 'text' }), true);
        assert.equal(Security.isInsideMetaFolder({ path: '/users//U1/$user', id: '$user' }), false);
    });
});

describe('assertMethodAccess', () => {
    it('blocks load when item is not visible', async () => {
        const storage = {
            path: '/root/secret/$group',
            id: '$group',
            type: '$group',
            DATA: { '#security': { users: ['other'] } },
            users: Promise.resolve([{ id: 'other' }]),
            admins: Promise.resolve([]),
        };
        const file = { path: '/root/secret/$group/$structure/doc.txt', id: 'doc.txt' };
        await assert.rejects(
            () => Security.assertMethodAccess(file, 'load', { user: { uid: 'u1' } }),
            /Доступ запрещён/
        );
    });

    it('allows load for visible system file', async () => {
        await Security.assertMethodAccess(
            { path: '/README.md', type: '$file' },
            'load',
            { user: { ssid: 'guest' } }
        );
    });

    it('resolveMethodAccessLevel uses POST default', () => {
        class TestFile extends CORE.$file {}
        const file = new TestFile({ id: 'x' });
        assert.equal(Security.resolveMethodAccessLevel('save', file), Security.ACCESS_LEVEL.WRITE);
        assert.equal(Security.resolveMethodAccessLevel('load', file), Security.ACCESS_LEVEL.READ);
    });
});

describe('assertCanExecuteMethod', () => {
    it('blocks delete for regular user', async () => {
        class TestStorage extends CORE.$storage {
            get admins() {
                return [{ id: 'admin1' }];
            }
        }
        const storage = new TestStorage({ id: 'group' });
        storage.path = '/root/test/$group';
        Object.defineProperty(storage, '$storage', { get: () => storage });

        await assert.rejects(
            () => Security.assertCanExecuteMethod(storage, 'delete', { user: { uid: 'user1' } }),
            /Доступ запрещён/
        );
    });

    it('allows delete for admin', async () => {
        class TestStorage extends CORE.$storage {
            get admins() {
                return [{ id: 'admin1' }];
            }
        }
        const storage = new TestStorage({ id: 'group' });
        Object.defineProperty(storage, '$storage', { get: () => storage });

        await Security.assertCanExecuteMethod(storage, 'delete', { user: { uid: 'admin1' } });
    });

    it('skips guard without uid', async () => {
        class TestFolder extends CORE.$folder {}
        const folder = new TestFolder({ id: 'x' });
        await Security.assertCanExecuteMethod(folder, 'delete', {});
    });

    it('blocks save for guest session without uid', async () => {
        class TestFolder extends CORE.$folder {}
        const folder = new TestFolder({ id: 'sources' });
        folder.path = '/sources';
        await assert.rejects(
            () => Security.assertCanExecuteMethod(folder, 'save_file', { user: { ssid: 'x' } }),
            /Доступ запрещён/
        );
    });

    it('blocks delete for guest session without uid', async () => {
        class TestFolder extends CORE.$folder {}
        const folder = new TestFolder({ id: 'x' });
        await assert.rejects(
            () => Security.assertCanExecuteMethod(folder, 'delete', { user: { ssid: 'x' } }),
            /Доступ запрещён/
        );
    });

    it('skips guard in WORK_DEV', async () => {
        const prev = process.env.WORK_DEV;
        process.env.WORK_DEV = 'true';
        try {
            class TestStorage extends CORE.$storage {
                get admins() {
                    return [{ id: 'admin1' }];
                }
            }
            const storage = new TestStorage({ id: 'group' });
            Object.defineProperty(storage, '$storage', { get: () => storage });
            await Security.assertCanExecuteMethod(storage, 'delete', { user: { uid: 'user1' } });
        }
        finally {
            if (prev === undefined)
                delete process.env.WORK_DEV;
            else
                process.env.WORK_DEV = prev;
        }
    });
});

describe('canSee', () => {
    it('logged user sees users branch', async () => {
        assert.equal(await Security.canSee({ path: '/users/$users', id: '$users' }, { user: { uid: 'u1' } }), true);
    });

    it('guest sees system at WORK root, not $storage or users', async () => {
        const guest = { user: { ssid: 'x' } };
        assert.equal(await Security.canSee({ path: '/users//U1/$user/text', id: 'text' }, guest), false);
        assert.equal(await Security.canSee({ path: '/users//U1', id: 'U1' }, guest), false);
        assert.equal(await Security.canSee({ path: '/users', id: 'users', type: '$user' }, guest), false);
        assert.equal(await Security.canSee({ path: '/root/meeting/$group', id: '$group' }, guest), false);
        assert.equal(await Security.canSee({ path: '/root', id: 'root', type: '$base' }, guest), false);
        assert.equal(await Security.canSee({ path: '/nodes', id: 'nodes', type: '$node' }, guest), false);
        assert.equal(await Security.canSee({ path: '/paas', id: 'paas', type: '$paas' }, guest), false);
        assert.equal(await Security.canSee({ path: '/sources', id: 'sources', type: '$folder' }, guest), true);
        assert.equal(await Security.canSee(
            { id: 'explorer.js', path: '/$server/$folder/lib/explorer/explorer.js' },
            guest
        ), true);
    });

    it('guest sees files at WORK root', async () => {
        const work = { id: 'WORK', path: '' };
        assert.equal(await Security.canSee(
            { id: 'README.md', path: '/README.md', parent: work },
            { user: { ssid: 'x' } }
        ), true);
        assert.equal(await Security.canSee(
            { id: 'favicon.ico', path: '/favicon.ico', parent: work },
            { user: { ssid: 'x' } }
        ), true);
    });

    it('own user cabinet content', async () => {
        assert.equal(await Security.canSee({ path: '/users//U1/$user/text', id: 'text' }, { user: { uid: 'U1' } }), true);
    });

    it('foreign cabinet hides meta content', async () => {
        assert.equal(await Security.canSee({ path: '/users//U2/$user/call', id: 'call' }, { user: { uid: 'U1' } }), false);
        assert.equal(await Security.canSee({ path: '/users//U2/$user/logs', id: 'logs' }, { user: { uid: 'U1' } }), false);
    });

    it('foreign cabinet shows shell', async () => {
        assert.equal(await Security.canSee({ path: '/users//U2/$user', id: '$user' }, { user: { uid: 'U1' } }), true);
        assert.equal(await Security.canSee({ path: '/users//U2', id: 'U2' }, { user: { uid: 'U1' } }), true);
    });

    it('assigned user sees system zone of storage', async () => {
        class HandlerFolder extends CORE.$folder {
            get isType() { return true; }
            get isMetaFolder() { return false; }
        }
        const handler = new HandlerFolder({ id: '$handler' });
        handler.path = '/root/meeting/$group/$handler';
        handler.type = '$handler';
        const storage = {
            path: '/root/meeting/$group',
            DATA: { '#security': { users: ['u1'] } },
            users: Promise.resolve([{ id: 'u1' }]),
            admins: Promise.resolve([]),
        };
        Object.defineProperty(handler, '$storage', { get: () => storage });
        Object.defineProperty(handler, 'parent', { get: () => storage });
        assert.equal(await Security.canSee(handler, { user: { uid: 'u1' } }), true);
    });

    it('unassigned user does not see data storage', async () => {
        const storage = {
            path: '/root/secret/$group',
            id: '$group',
            DATA: { '#security': { users: ['other'] } },
            users: Promise.resolve([{ id: 'other' }]),
            admins: Promise.resolve([]),
        };
        assert.equal(await Security.canSee(storage, { user: { uid: 'u1' } }), false);
    });

    it('allows WORK root for guest session', async () => {
        assert.equal(await Security.canSee(
            { id: 'WORK', path: '' },
            { user: { ssid: 'x' } }
        ), true);
    });
});

describe('allowAccess', () => {
    it('allows any level when user is WORK singleton', async () => {
        const work = { id: 'WORK', path: '' };
        const prev = globalThis.WORK;
        globalThis.WORK = work;
        try {
            await Security.allowAccess(
                { path: '/root/secret/$group', id: '$group' },
                { user: work },
                Security.ACCESS_LEVEL.ADMIN
            );
        }
        finally {
            globalThis.WORK = prev;
        }
    });

    it('does not treat forged id WORK as system user', async () => {
        await assert.rejects(
            () => Security.allowAccess(
                { path: '/sources', type: '$folder' },
                { user: { id: 'WORK' } },
                Security.ACCESS_LEVEL.WRITE
            ),
            /Доступ запрещён/
        );
    });
});

describe('canWrite', () => {
    it('guest cannot write', async () => {
        assert.equal(await Security.canWrite({ path: '/sources', type: '$folder' }, { user: { ssid: 'x' } }), false);
    });

    it('regular user cannot write system folder', async () => {
        assert.equal(await Security.canWrite({ path: '/sources', type: '$folder' }, { user: { uid: 'u1' } }), false);
    });

    it('regular user cannot write foreign data storage', async () => {
        const storage = {
            path: '/root/secret/$group',
            id: '$group',
            type: '$group',
            DATA: { '#security': { users: ['other'] } },
            users: Promise.resolve([{ id: 'other' }]),
            admins: Promise.resolve([]),
        };
        assert.equal(await Security.canWrite(storage, { user: { uid: 'u1' } }), false);
    });

    it('assigned user can write meta content in storage', async () => {
        const storage = {
            path: '/root/x/$group',
            id: '$group',
            type: '$group',
            DATA: { '#security': { users: ['u1'] } },
            users: Promise.resolve([{ id: 'u1' }]),
            admins: Promise.resolve([]),
        };
        const file = { path: '/root/x/$group/$structure/doc/file.txt', id: 'file.txt' };
        Object.defineProperty(file, '$storage', { get: () => storage });
        assert.equal(await Security.canWrite(file, { user: { uid: 'u1' } }), true);
    });

    it('assigned user cannot write system zone of storage', async () => {
        class HandlerFolder extends CORE.$folder {
            get isType() { return true; }
            get isMetaFolder() { return false; }
        }
        const storage = {
            path: '/root/x/$group',
            DATA: { '#security': { users: ['u1'] } },
            users: Promise.resolve([{ id: 'u1' }]),
            admins: Promise.resolve([]),
        };
        const handler = new HandlerFolder({ id: '$handler' });
        handler.path = '/root/x/$group/$handler';
        Object.defineProperty(handler, '$storage', { get: () => storage });
        Object.defineProperty(handler, 'parent', { get: () => storage });
        assert.equal(await Security.canWrite(handler, { user: { uid: 'u1' } }), false);
    });

    it('user can write own cabinet', async () => {
        assert.equal(await Security.canWrite(
            { path: '/users//U1/$user/text', id: 'text' },
            { user: { uid: 'U1' } }
        ), true);
    });

    it('user cannot write foreign cabinet meta', async () => {
        assert.equal(await Security.canWrite(
            { path: '/users//U2/$user/logs', id: 'logs' },
            { user: { uid: 'U1' } }
        ), false);
    });
});

describe('filterGetItemResult', () => {
    it('filters invisible children', async () => {
        const visible = { path: '/users/$users', id: '$users' };
        const hidden = {
            path: '/root/secret/$group',
            id: '$group',
            $storage: {
                path: '/root/secret/$group',
                DATA: { '#security': { users: ['other'] } },
                users: Promise.resolve([{ id: 'other' }]),
                admins: Promise.resolve([]),
            },
        };
        const params = { user: { uid: 'u1' } };
        const result = await Security.filterGetItemResult([visible, hidden], params);
        assert.equal(result.length, 1);
        assert.equal(result[0], visible);
    });
});

describe('filterInfoResult', () => {
    it('filters nested info items for guest', async () => {
        const guest = { user: { ssid: 'x' } };
        const result = await Security.filterInfoResult({
            id: 'WORK',
            path: '',
            items: [
                { id: 'sources', path: '/sources', type: '$folder' },
                { id: 'users', path: '/users', type: '$user' },
                { id: 'root', path: '/root', type: '$base' },
                {
                    id: 'secret',
                    path: '/root/secret/$group',
                    type: '$group',
                    items: [{ id: 'doc', path: '/root/secret/$group/doc' }],
                },
            ],
        }, guest);
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].id, 'sources');
    });
});
