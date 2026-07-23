import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    appendFunctionArgs,
    parseFunctionArgs,
    toOpenAiTools,
    normalizeOpenAiMessages,
} from '../MODELS/$ai/$folder/$class/$ai/methods/streamChat/$method/class.js';
import {
    isBrokenFcArgs,
    sanitizeToolArgsForHistory,
    stripFcTrailer,
    taskHasSuccessfulSave,
    formatToolResultMessages,
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

describe('toOpenAiTools', () => {
    it('wraps functions as type function tools', () => {
        const tools = toOpenAiTools([
            { name: 'save_file', description: 'x', parameters: { type: 'object' } },
        ]);
        assert.equal(tools.length, 1);
        assert.equal(tools[0].type, 'function');
        assert.equal(tools[0].function.name, 'save_file');
    });

    it('empty / non-array → []', () => {
        assert.deepEqual(toOpenAiTools([]), []);
        assert.deepEqual(toOpenAiTools(null), []);
    });
});

describe('normalizeOpenAiMessages', () => {
    it('converts role function to tool and upgrades function_call', () => {
        const out = normalizeOpenAiMessages([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hi' },
            {
                role: 'assistant',
                content: '',
                function_call: { name: 'save_file', arguments: { filename: 'a.html' } },
            },
            { role: 'function', name: 'save_file', content: '{"ok":true}' },
        ]);
        assert.equal(out.some(m => m.role === 'function'), false);
        const asst = out.find(m => m.role === 'assistant' && m.tool_calls);
        assert.ok(asst);
        assert.equal(asst.tool_calls[0].function.name, 'save_file');
        const tool = out.find(m => m.role === 'tool');
        assert.ok(tool);
        assert.equal(tool.tool_call_id, asst.tool_calls[0].id);
    });

    it('injects user if missing', () => {
        const out = normalizeOpenAiMessages([
            { role: 'system', content: 'sys' },
            { role: 'assistant', content: 'ok' },
        ]);
        assert.ok(out.some(m => m.role === 'user' && m.content === 'Продолжай.'));
    });
});

describe('formatToolResultMessages', () => {
    const entry = {
        tool: 'save_file',
        args: { filename: 'presentation.html', post: '<html/>' },
        content: '{"ok":true}',
    };

    it('openai → tool_calls + role tool', () => {
        const msgs = formatToolResultMessages(entry, 'openai', 'call_save_file_0');
        assert.equal(msgs.length, 2);
        assert.equal(msgs[0].role, 'assistant');
        assert.equal(msgs[0].content, null);
        assert.equal(msgs[0].tool_calls[0].id, 'call_save_file_0');
        assert.equal(msgs[0].tool_calls[0].function.name, 'save_file');
        assert.equal(typeof msgs[0].tool_calls[0].function.arguments, 'string');
        assert.equal(msgs[1].role, 'tool');
        assert.equal(msgs[1].tool_call_id, 'call_save_file_0');
    });

    it('gigachat → function_call + role function', () => {
        const msgs = formatToolResultMessages(entry, 'gigachat', 'x');
        assert.equal(msgs[0].role, 'assistant');
        assert.ok(msgs[0].function_call);
        assert.equal(msgs[0].function_call.name, 'save_file');
        assert.equal(msgs[1].role, 'function');
        assert.equal(msgs[1].name, 'save_file');
    });
});
