import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    appendFunctionArgs,
    parseFunctionArgs,
    toOpenAiTools,
    normalizeOpenAiMessages,
    sanitizeGigaChatFunctions,
    sanitizeGigaChatMessages,
} from '../MODELS/$ai/$folder/$class/$ai/methods/streamChat/$method/class.js';
import {
    isBrokenFcArgs,
    sanitizeToolArgsForHistory,
    stripFcTrailer,
    taskHasSuccessfulSave,
    formatToolResultMessages,
    ensureNamedFunction,
    collectFunctionNamesFromMessages,
    prepareFunctionsForStream,
    resolveFunctionCallMode,
    stepNeedsForcedSaveFile,
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

describe('sanitizeGigaChatFunctions', () => {
    it('strips _servicePath and keeps save_file', () => {
        const cleaned = sanitizeGigaChatFunctions([
            {
                name: 'save_file',
                description: 'save',
                parameters: {
                    type: 'object',
                    properties: { filename: { type: 'string' } },
                    required: ['filename'],
                },
                _servicePath: '/SERVICES/x',
            },
            { name: 'bad' },
        ]);
        assert.equal(cleaned.length, 2);
        assert.equal(cleaned[0].name, 'save_file');
        assert.equal(cleaned[0]._servicePath, undefined);
        assert.deepEqual(Object.keys(cleaned[0]).sort(), ['description', 'name', 'parameters']);
        assert.equal(cleaned[1].parameters.type, 'object');
        assert.ok(cleaned[1].parameters.properties);
    });
});

describe('ensureNamedFunction / prepareFunctionsForStream', () => {
    const template = {
        name: 'save_file',
        description: 'harness',
        parameters: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] },
    };

    it('adds save_file even when write_file exists', () => {
        const fns = [{ name: 'write_file', description: 'w', parameters: { type: 'object', properties: {} } }];
        ensureNamedFunction(fns, 'save_file', template);
        assert.ok(fns.some(f => f.name === 'save_file'));
        assert.ok(fns.some(f => f.name === 'write_file'));
    });

    it('prepares force: harness save_file first (replaces schema)', () => {
        const fns = [
            { name: 'navigate', description: 'n', parameters: { type: 'object', properties: {} } },
            {
                name: 'save_file',
                description: 'schema dirty',
                parameters: { type: 'object', properties: {} },
            },
        ];
        const messages = [
            { role: 'assistant', content: '', function_call: { name: 'save_file', arguments: {} } },
            { role: 'function', name: 'save_file', content: '{}' },
        ];
        const prepared = prepareFunctionsForStream(fns, messages, { name: 'save_file' });
        assert.equal(prepared.function_call.name, 'save_file');
        assert.equal(prepared.functions[0].name, 'save_file');
        assert.match(prepared.functions[0].description, /history|файл|артефакт/i);
        assert.ok(prepared.functions.some(f => f.name === 'navigate'));
    });

    it('collectFunctionNamesFromMessages', () => {
        const names = collectFunctionNamesFromMessages([
            { role: 'assistant', function_call: { name: 'save_file' } },
            { role: 'function', name: 'ask_user', content: '{}' },
        ]);
        assert.ok(names.includes('save_file'));
        assert.ok(names.includes('ask_user'));
    });

    it('resolveFunctionCallMode requires save_file by name', () => {
        const step = { description: 'Создать файл presentation.html' };
        assert.equal(resolveFunctionCallMode('execute', step, [{ name: 'write_file' }]), 'auto');
        assert.deepEqual(
            resolveFunctionCallMode('execute', step, [{ name: 'save_file' }]),
            { name: 'save_file' },
        );
        assert.equal(stepNeedsForcedSaveFile(step, [{ name: 'write_file' }]), false);
    });
});

describe('sanitizeGigaChatMessages', () => {
    it('keeps paired save_file when allowed', () => {
        const fns = [{ name: 'save_file' }];
        const msgs = sanitizeGigaChatMessages([
            { role: 'user', content: 'go' },
            { role: 'assistant', content: '', function_call: { name: 'save_file', arguments: { filename: 'a.html' } } },
            { role: 'function', name: 'save_file', content: '{"ok":true}' },
        ], fns);
        assert.equal(msgs[1].function_call.name, 'save_file');
        assert.equal(msgs[2].role, 'function');
    });

    it('strips orphan save_file when not in functions', () => {
        const msgs = sanitizeGigaChatMessages([
            { role: 'assistant', content: '', function_call: { name: 'save_file', arguments: {} } },
            { role: 'function', name: 'save_file', content: '{}' },
        ], []);
        assert.equal(msgs.some(m => m.function_call), false);
        assert.equal(msgs.some(m => m.role === 'function'), false);
        assert.ok(msgs.some(m => m.role === 'assistant' && /save_file/.test(m.content)));
    });
});
