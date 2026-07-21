import '../../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { $class } from '../../sources/server/index.js';
import { $server } from '../../sources/server/server.js';

describe('SYS PROTECTED zone', () => {
    it('_isSysProtectedPath matches /SYS and descendants', async () => {
        globalThis.WORK = new $server();
        const root = await WORK.get_item('/SYS');
        const licenses = await WORK.get_item('/SYS/Licenses');
        assert.ok(root instanceof $class);
        assert.ok(licenses instanceof $class);
        assert.ok(root._isSysProtectedPath(root));
        assert.ok(root._isSysProtectedPath(licenses));
        assert.ok(!root._isSysProtectedPath(await WORK.get_item('/services')));
    });

    it('resolveZone returns PROTECTED for /SYS/', async () => {
        globalThis.WORK = new $server();
        const licenses = await WORK.get_item('/SYS/Licenses');
        assert.equal(licenses.resolveZone(licenses), $class.ZONES.PROTECTED);
    });

    it('canWrite denies humans on SYS paths', async () => {
        globalThis.WORK = new $server();
        const licenses = await WORK.get_item('/SYS/Licenses');
        const admin = { uid: 'admin-uid', role: 'ADMIN' };
        assert.equal(await licenses.canWrite(licenses, { user: admin }), false);
        assert.equal(await licenses.canWrite(licenses, { user: globalThis.WORK }), true);
    });
});
