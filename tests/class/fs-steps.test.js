import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../sources/reactor.js';
import { $class } from '../../sources/server/index.js';

describe('$class.steps', () => {
    it('steps map is initialized', () => {
        assert.ok($class.steps);
        assert.equal(typeof $class.steps, 'object');
        assert.equal($class.steps['$user'], undefined);
    });
});
