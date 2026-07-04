import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../oda/reactor.js';
import { $storage } from '../../sources/server/index.js';

describe('$storage.steps', () => {
    it('steps map is initialized', () => {
        assert.ok($storage.steps);
        assert.equal(typeof $storage.steps, 'object');
        assert.equal($storage.steps['$user'], undefined);
    });
});
