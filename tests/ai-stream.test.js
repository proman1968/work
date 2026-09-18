import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import aiDef from '../MODELS/$ai/class.js';

function sseLine(obj) {
    return 'data: ' + JSON.stringify(obj) + '\n';
}

function installWork(chunks) {
    async function* fakeRes() {
        for (const c of chunks)
            yield Buffer.from(c);
    }
    globalThis.getAuthHeaders = async () => ({ 'Content-Type': 'application/json' });
    globalThis.normalizeOpenAiMessages = (m) => m;
    globalThis.applyEffort = () => {};
    globalThis.WORK = {
        https: {
            request(_opts, cb) {
                queueMicrotask(() => cb(fakeRes()));
                return { on() {}, write() {}, end() {} };
            },
        },
    };
}

async function collect(ai, messages) {
    let out = '';
    for await (const t of aiDef.streamChat.call(ai, { messages }))
        if (typeof t === 'string')
            out += t;
    return out;
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
        assert.equal(await collect(ai, messages), 'display:flex;padding: 16px;');
    });

    it('целые строки по чанкам — поведение без изменений', async () => {
        installWork([
            sseLine({ choices: [{ delta: { content: 'a' } }] }),
            sseLine({ choices: [{ delta: { content: 'b' } }] }),
            'data: [DONE]\n',
        ]);
        assert.equal(await collect(ai, messages), 'ab');
    });
});
