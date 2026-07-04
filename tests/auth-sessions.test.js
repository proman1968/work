import '../oda/reactor.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { $server } from '../sources/server/$server.js';
import { authMethods } from '../sources/host/auth-methods.js';
import * as Security from '../sources/host/security.js';

describe('user_exit sessions', () => {
    beforeEach(() => {
        $server.users = {};
    });

    it('clears all HTTP sessions with the same uid', async () => {
        const tab1 = $server.get_user('tab1');
        const tab2 = $server.get_user('tab2');
        tab1.uid = 'U1';
        tab1.$user = { id: 'U1' };
        tab1.credentials = { uid: 'U1' };
        tab2.uid = 'U1';
        tab2.$user = { id: 'U1' };

        await authMethods.user_exit.call($server.prototype, { user: tab1, post: {} });

        assert.equal(tab1.uid, undefined);
        assert.equal(tab2.uid, undefined);
        assert.equal(Security.resolveUid({ user: tab1 }), null);
        assert.equal(Security.resolveUid({ user: tab2 }), null);
    });

    it('clears only current session when uid is absent', async () => {
        const guest = $server.get_user('guest');
        guest.check_code = '1234';

        await authMethods.user_exit.call($server.prototype, { user: guest, post: {} });

        assert.equal(guest.uid, undefined);
        assert.equal(guest.check_code, '1234');
    });
});

describe('broadcastAuthChanged', () => {
    beforeEach(() => {
        $server.users = {};
    });

    it('sends auth-changed to all sockets of affected sessions on exit', async () => {
        const tab1 = $server.get_user('tab1');
        const tab2 = $server.get_user('tab2');
        tab1.uid = 'U1';
        tab2.uid = 'U1';
        const messages = [];
        const ws = { readyState: 1, send: (msg) => messages.push(JSON.parse(msg)) };
        tab1.sockets.a = { ws, events: new Set() };
        tab2.sockets.b = { ws, events: new Set() };

        await authMethods.user_exit.call($server.prototype, { user: tab1, post: {} });

        assert.equal(messages.length, 2);
        assert.equal(messages[0].type, 'auth-changed');
        assert.equal(messages[0].reason, 'logout');
        assert.equal(messages[0].uid, '');
    });
});
