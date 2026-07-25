import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../sources/reactor.js';
import { $folder, $class, $user, $file } from '../sources/server/index.js';

describe('fs class static type_chain', () => {
    for (const [name, Cls] of Object.entries({ $folder, $user, $file })) {
        it(`${name}.type_chain is initialized`, () => {
            assert.ok(Cls.type_chain);
            assert.equal(typeof Cls.type_chain, 'object');
            assert.equal(Cls.type_chain['$user'], undefined);
        });
    }
});
