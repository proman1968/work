import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import aiDef, { resolveKey, toGigaChatMessages } from '../MODELS/$ai/$folder/$class/$ai/class.js';

function sseLine(obj) {
    return 'data: ' + JSON.stringify(obj) + '\n';
}

let lastBody;
function installWork(chunks) {
    async function* fakeRes() {
        for (const c of chunks)
            yield Buffer.from(c);
    }
    globalThis.WORK = {
        https: {
            request(_opts, cb) {
                queueMicrotask(() => cb(Object.assign(fakeRes(), { statusCode: 200 })));
                return { on() {}, setTimeout() {}, destroy() {}, write(b) { lastBody = JSON.parse(b); }, end() {} };
            },
        },
    };
}

async function collect(ai, opts) {
    let out = '';
    const events = [];
    for await (const t of aiDef.streamChat.call(ai, opts))
        if (typeof t === 'string')
            out += t;
        else
            events.push(t);
    return { out, events };
}

const ai = {
    protocol: 'openai',
    baseUrl: 'https://x.test/v1/chat',
    model: 'm',
};
const messages = [{ role: 'user', content: 'hi' }];

describe('streamChat SSE: рваные чанки собираются без потерь', () => {
    it('строка, разорванная границей чанка, не глотается', async () => {
        const l1 = sseLine({ choices: [{ delta: { content: 'display:flex;' } }] });
        const l2 = sseLine({ choices: [{ delta: { content: 'padding: 16px;' } }] });
        const l3 = 'data: [DONE]\n';
        const all = l1 + l2 + l3;
        // рвём в неудобных местах: внутри JSON и внутри префикса
        const chunks = [all.slice(0, 10), all.slice(10, 25), all.slice(25, 41), all.slice(41)];
        installWork(chunks);
        assert.equal((await collect(ai, { messages })).out, 'display:flex;padding: 16px;');
    });

    it('многобайтный символ, разрезанный границей чанка, не портится', async () => {
        const all = Buffer.from(sseLine({ choices: [{ delta: { content: 'Расчёты' } }] }) + 'data: [DONE]\n');
        const cut = all.indexOf(Buffer.from('ё')) + 1; // посередине двухбайтного «ё»
        async function* fakeRes() { yield all.subarray(0, cut); yield all.subarray(cut); }
        globalThis.WORK = { https: { request(_o, cb) { queueMicrotask(() => cb(Object.assign(fakeRes(), { statusCode: 200 }))); return { on() {}, setTimeout() {}, destroy() {}, write() {}, end() {} }; } } };
        assert.equal((await collect(ai, { messages })).out, 'Расчёты');
    });

    it('целые строки по чанкам — поведение без изменений', async () => {
        installWork([
            sseLine({ choices: [{ delta: { content: 'a' } }] }),
            sseLine({ choices: [{ delta: { content: 'b' } }] }),
            'data: [DONE]\n',
        ]);
        assert.equal((await collect(ai, { messages })).out, 'ab');
    });
});

describe('streamChat: нативные tool_calls', () => {
    it('параллельные вызовы собираются по index, отдаются одним событием', async () => {
        installWork([
            sseLine({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'ls', arguments: '{"pa' } }] } }] }),
            sseLine({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'read', arguments: '{"path":"/B"}' } }] } }] }),
            sseLine({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"/A"}' } }] } }] }),
            sseLine({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
            'data: [DONE]\n',
        ]);
        const tools = [{ type: 'function', function: { name: 'ls', parameters: { type: 'object', properties: {} } } }];
        const { events } = await collect(ai, { messages, tools });
        assert.deepEqual(lastBody.tools, tools);
        const tc = events.find(e => e.type === 'tool_calls');
        assert.deepEqual(tc.calls, [
            { id: 'c1', name: 'ls', arguments: { path: '/A' } },
            { id: 'c2', name: 'read', arguments: { path: '/B' } },
        ]);
    });

    it('конец ответа: finish_reason и [DONE] — событие finish; обрыв — done:false', async () => {
        installWork([sseLine({ choices: [{ delta: { content: 'a' }, finish_reason: 'length' }] }), 'data: [DONE]\n']);
        let fin = (await collect(ai, { messages })).events.find(e => e.type === 'finish');
        assert.equal(fin.reason, 'length');
        assert.equal(fin.done, true);
        installWork([sseLine({ choices: [{ delta: { content: 'a' } }] })]);
        fin = (await collect(ai, { messages })).events.find(e => e.type === 'finish');
        assert.equal(fin.reason, null);
        assert.equal(fin.done, false);
    });

    it('ошибка в SSE-потоке — исключение, а не тишина', async () => {
        installWork([sseLine({ error: { message: 'boom' } })]);
        await assert.rejects(() => collect(ai, { messages }), /boom/);
    });
});

describe('ключи моделей', () => {
    it('литерал / env: / secret: вверх по родителям', async () => {
        assert.equal(await resolveKey({}, 'sk-1'), 'sk-1');
        process.env.WORK_TEST_KEY = 'k-env';
        assert.equal(await resolveKey({}, 'env:WORK_TEST_KEY'), 'k-env');
        const provider = { read_secret: async ({ filename }) => filename === 'odant.json' ? { apiKey: 'k-sec' } : {} };
        const model = { read_secret: async () => ({}), $parent: provider };
        assert.equal(await resolveKey(model, 'secret:odant.json'), 'k-sec');
        await assert.rejects(() => resolveKey(model, 'secret:none.json'), /нет секрета/);
    });

    it('GigaChat: tool_calls → function_call, tool → function', () => {
        const out = toGigaChatMessages([
            { role: 'user', content: 'x' },
            { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'ls', arguments: '{"path":"/"}' } }] },
            { role: 'tool', tool_call_id: 'a', content: 'ok' },
        ]);
        assert.deepEqual(out[1].function_call, { name: 'ls', arguments: { path: '/' } });
        assert.deepEqual(out[2], { role: 'function', name: 'ls', content: 'ok' });
    });
});
