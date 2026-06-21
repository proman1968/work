import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    toShortPath,
    parsePathSteps,
    classifyPathStep,
    PATH_STEP,
    isMetaId,
    isSystemId,
} from '../sources/shared/path-syntax.js';
import { buildHandlerUrl, buildMethodHandlerPath } from '../sources/shared/url-builder.js';

describe('path-syntax', () => {
    it('toShortPath hides $ meta folders', () => {
        assert.equal(
            toShortPath('/root/direction/$group/text'),
            '/root/direction/~/text'
        );
    });

    it('parsePathSteps splits //uid paths', () => {
        assert.deepEqual(parsePathSteps('//uid123'), ['', '', 'uid123']);
    });

    it('classifyPathStep detects special prefixes', () => {
        assert.equal(classifyPathStep(''), PATH_STEP.EMPTY);
        assert.equal(classifyPathStep('~'), PATH_STEP.TILDE);
        assert.equal(classifyPathStep('@ancestor'), PATH_STEP.ANCESTOR);
        assert.equal(classifyPathStep('*'), PATH_STEP.WILDCARD);
        assert.equal(classifyPathStep('.'), PATH_STEP.CURRENT);
        assert.equal(classifyPathStep('file.txt'), PATH_STEP.NAME);
    });

    it('isMetaId and isSystemId', () => {
        assert.equal(isMetaId('$group'), true);
        assert.equal(isMetaId('group'), false);
        assert.equal(isSystemId('#system'), true);
    });
});

describe('url-builder', () => {
    it('buildHandlerUrl encodes handler path', () => {
        assert.equal(
            buildHandlerUrl('/root/direction/~/text', 'explorer'),
            '/root/direction/~/text/~/handlers/pages//explorer/'
        );
    });

    it('buildMethodHandlerPath', () => {
        assert.equal(buildMethodHandlerPath('info'), '~/handlers/methods/info');
    });
});
