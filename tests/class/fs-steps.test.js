import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../sources/reactor.js';
import { $class } from '../../sources/server/index.js';

describe('$class.type_chain', () => {
    it('type_chain map is initialized', () => {
        assert.ok($class.type_chain);
        assert.equal(typeof $class.type_chain, 'object');
        assert.equal($class.type_chain['$user'], undefined);
    });
});
