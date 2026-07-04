import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevMode } from '../sources/host/config.js';

describe('config', () => {
    it('parseDevMode is false by default', () => {
        assert.equal(parseDevMode({}), false);
        assert.equal(parseDevMode({ WORK_DEV: '' }), false);
        assert.equal(parseDevMode({ WORK_DEV: 'false' }), false);
    });

    it('parseDevMode respects truthy values', () => {
        assert.equal(parseDevMode({ WORK_DEV: 'true' }), true);
        assert.equal(parseDevMode({ WORK_DEV: '1' }), true);
        assert.equal(parseDevMode({ WORK_DEV: 'yes' }), true);
    });
});
