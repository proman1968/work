import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    appendFunctionArgs,
    parseFunctionArgs,
} from '../models/$ai/$folder/$class/$ai/methods/streamChat/$method/class.js';
import {
    isBrokenFcArgs,
    sanitizeToolArgsForHistory,
} from '../$server/$folder/$file/$ai/methods/prompt/$method/class.js';

describe('appendFunctionArgs', () => {
    it('object args (GigaChat) → JSON string with filename/post', () => {
        const acc = appendFunctionArgs('', {
            filename: 'presentation.html',
            post: '<html/>',
        });
        assert.equal(acc, '{"filename":"presentation.html","post":"<html/>"}');
        const parsed = parseFunctionArgs(acc);
        assert.equal(parsed.filename, 'presentation.html');
        assert.equal(parsed.post, '<html/>');
    });

    it('string chunks stream → склейка JSON', () => {
        let acc = '';
        acc = appendFunctionArgs(acc, '{"filename":"a.html",');
        acc = appendFunctionArgs(acc, '"post":"hi"}');
        assert.deepEqual(parseFunctionArgs(acc), { filename: 'a.html', post: 'hi' });
    });

    it('object after empty does not become [object Object]', () => {
        const acc = appendFunctionArgs('', { name: 'x.md', content: 'y' });
        assert.notEqual(acc, '[object Object]');
        assert.ok(!acc.includes('[object Object]'));
        assert.equal(parseFunctionArgs(acc).name, 'x.md');
    });

    it('merges object onto existing JSON object acc', () => {
        let acc = appendFunctionArgs('', { filename: 'a.html' });
        acc = appendFunctionArgs(acc, { post: 'body' });
        assert.deepEqual(parseFunctionArgs(acc), { filename: 'a.html', post: 'body' });
    });
});

describe('parseFunctionArgs', () => {
    it('"[object Object]" → {}', () => {
        assert.deepEqual(parseFunctionArgs('[object Object]'), {});
    });

    it('{ raw: "[object Object]" } → {}', () => {
        assert.deepEqual(parseFunctionArgs({ raw: '[object Object]' }), {});
        assert.deepEqual(parseFunctionArgs('{"raw":"[object Object]"}'), {});
    });

    it('empty → {}', () => {
        assert.deepEqual(parseFunctionArgs(''), {});
        assert.deepEqual(parseFunctionArgs(null), {});
    });
});

describe('isBrokenFcArgs / sanitizeToolArgsForHistory', () => {
    it('detects broken raw', () => {
        assert.equal(isBrokenFcArgs({ raw: '[object Object]' }), true);
        assert.equal(isBrokenFcArgs({ filename: 'a.html' }), false);
        assert.equal(isBrokenFcArgs(null), false);
    });

    it('sanitize strips [object Object] raw', () => {
        assert.deepEqual(sanitizeToolArgsForHistory({ raw: '[object Object]' }), {});
        assert.deepEqual(
            sanitizeToolArgsForHistory({ raw: '[object Object]', filename: 'a.html' }),
            { filename: 'a.html' },
        );
        assert.deepEqual(
            sanitizeToolArgsForHistory({ filename: 'a.html', post: 'x' }),
            { filename: 'a.html', post: 'x' },
        );
    });
});
