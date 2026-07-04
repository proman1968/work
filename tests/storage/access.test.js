import '../../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as Security from '../../sources/host/security.js';
import * as CORE from '../../sources/server/index.js';

describe('isAssignedOnStorage', () => {
    it('false when no user boundary', async () => {
        const storage = { DATA: {}, users: Promise.resolve([{ id: 'u1' }]) };
        assert.equal(await Security.isAssignedOnStorage(storage, { user: { uid: 'u1' } }), false);
    });

    it('true when uid in users list', async () => {
        const storage = {
            DATA: { '#security': { users: ['u1'] } },
            users: Promise.resolve([{ id: 'u1' }, { id: 'u2' }]),
        };
        assert.equal(await Security.isAssignedOnStorage(storage, { user: { uid: 'u1' } }), true);
        assert.equal(await Security.isAssignedOnStorage(storage, { user: { uid: 'u3' } }), false);
    });
});

describe('hasStorageAccess', () => {
    it('pass-through when parent assigned and child has no users', async () => {
        class ParentStorage extends CORE.$storage {
            get users() { return Promise.resolve([{ id: 'u1' }]); }
            get admins() { return Promise.resolve([]); }
        }
        class ChildStorage extends CORE.$storage {
            get users() { return Promise.resolve([]); }
            get admins() { return Promise.resolve([]); }
        }
        const parentS = new ParentStorage({ id: 'group' });
        parentS.path = '/root/a/$group';
        parentS.DATA = { '#security': { users: ['u1'] } };
        const childS = new ChildStorage({ id: 'group' });
        childS.path = '/root/a/$group/sales/$group';
        childS.DATA = {};
        childS.parent = parentS;

        assert.equal(await Security.hasStorageAccess(childS, { user: { uid: 'u1' } }), true);
        assert.equal(await Security.hasStorageAccess(childS, { user: { uid: 'u2' } }), false);
    });

    it('blocked when storage has users and uid not listed', async () => {
        class S extends CORE.$storage {
            get users() { return Promise.resolve([{ id: 'u2' }]); }
            get admins() { return Promise.resolve([]); }
        }
        const storage = new S({ id: 'group' });
        storage.path = '/root/x/$group';
        storage.DATA = { '#security': { users: ['u2'] } };
        assert.equal(await Security.hasStorageAccess(storage, { user: { uid: 'u1' } }), false);
    });
});
