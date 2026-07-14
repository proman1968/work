import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../oda/reactor.js';
import { $folder, $class, $user, $file } from '../sources/server/index.js';

describe('fs class static steps', () => {
    for (const [name, Cls] of Object.entries({ $folder, $user, $file })) {
        it(`${name}.steps is initialized`, () => {
            assert.ok(Cls.steps);
            assert.equal(typeof Cls.steps, 'object');
            assert.equal(Cls.steps['$user'], undefined);
        });
    }
});
