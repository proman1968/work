import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    appendFunctionArgs,
    parseFunctionArgs,
} from '../models/$ai/$folder/$class/$ai/methods/streamChat/$method/class.js';
import {
    isBrokenFcArgs,
    sanitizeToolArgsForHistory,
    stripFcTrailer,
    taskHasSuccessfulSave,
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

describe('stripFcTrailer', () => {
    it('removes trailing } and </function>', () => {
        const html = '<html><body>ok</body></html>';
        assert.equal(stripFcTrailer(html + '\n}\n</function>'), html);
        assert.equal(stripFcTrailer(html + '}\n</function>'), html);
        assert.equal(stripFcTrailer(html), html);
    });

    it('does not strip bare closing brace from JSON', () => {
        assert.equal(stripFcTrailer('{"a":1}'), '{"a":1}');
    });

    it('handles empty', () => {
        assert.equal(stripFcTrailer(''), '');
        assert.equal(stripFcTrailer(null), '');
    });
});

describe('taskHasSuccessfulSave', () => {
    it('true when ok save_file tool_result in ribbon', () => {
        assert.equal(taskHasSuccessfulSave({
            ribbon: [
                { type: 'tool_result', tool: 'save_file', ok: true },
            ],
        }), true);
        assert.equal(taskHasSuccessfulSave({
            ribbon: [
                { type: 'tool_result', tool: 'write_file', ok: true },
            ],
        }), true);
    });

    it('false when missing, not ok, or other tool', () => {
        assert.equal(taskHasSuccessfulSave({ ribbon: [] }), false);
        assert.equal(taskHasSuccessfulSave({
            ribbon: [{ type: 'tool_result', tool: 'save_file', ok: false }],
        }), false);
        assert.equal(taskHasSuccessfulSave({
            ribbon: [{ type: 'tool_result', tool: 'ask_user', ok: true }],
        }), false);
        assert.equal(taskHasSuccessfulSave(null), false);
    });
});
