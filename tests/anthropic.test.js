/**
 * Нативный Anthropic Messages API (hardening 2.3): преобразование сообщений и инструментов, точки кэша,
 * thinking с подписью, разбор SSE (параллельные tool_use, input_json_delta, usage с кэшем), сквозной запрос.
 */
import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import aiDef, {
    anthropicUrl, toAnthropicTools, toAnthropicMessages, buildAnthropicRequest, createAnthropicParser,
    ANTHROPIC_VOLATILE_PREFIX, ANTHROPIC_VERSION,
} from '../MODELS/$ai/$folder/$class/$ai/class.js';
import { toMessages, runLoop, VOLATILE_HEAD } from '../sources/modules/agent/loop.js';

const EPH = { type: 'ephemeral' };
const fn = (name, props = {}) => ({ type: 'function', function: { name, description: 'd ' + name, parameters: { type: 'object', properties: props } } });
const ai = { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x', capabilities: ['chat', 'stream', 'functions', 'effort'] };
const countBreakpoints = body => JSON.stringify(body).split('"cache_control"').length - 1;

describe('anthropicUrl', () => {
    it('хост, /v1, /v1/messages и устаревший /chat/completions → Messages API', () => {
        assert.equal(anthropicUrl('https://api.anthropic.com'), 'https://api.anthropic.com/v1/messages');
        assert.equal(anthropicUrl('https://api.anthropic.com/'), 'https://api.anthropic.com/v1/messages');
        assert.equal(anthropicUrl('https://gw.example/v1'), 'https://gw.example/v1/messages');
        assert.equal(anthropicUrl('https://gw.example/v1/messages'), 'https://gw.example/v1/messages');
        assert.equal(anthropicUrl('https://gw.example/anthropic/v1/chat/completions'), 'https://gw.example/anthropic/v1/messages');
        assert.equal(anthropicUrl('https://gw.example/prefix'), 'https://gw.example/prefix/v1/messages');
    });
    it('префикс изменчивой части совпадает с VOLATILE_HEAD цикла (иначе точка кэша встанет не туда)', () => {
        assert.ok(VOLATILE_HEAD.startsWith(ANTHROPIC_VOLATILE_PREFIX));
    });
});

describe('toAnthropicTools', () => {
    it('схема → input_schema; cache_control только на последнем; пусто → undefined; кэш выключается', () => {
        const t = toAnthropicTools([fn('a', { x: { type: 'string' } }), fn('b')]);
        assert.deepEqual(t[0], { name: 'a', description: 'd a', input_schema: { type: 'object', properties: { x: { type: 'string' } } } });
        assert.equal(t[0].cache_control, undefined);
        assert.deepEqual(t[1].cache_control, EPH);
        assert.equal(toAnthropicTools([]), undefined);
        assert.equal(toAnthropicTools(null), undefined);
        assert.equal(toAnthropicTools([fn('a')], { cache: false })[0].cache_control, undefined);
        assert.deepEqual(toAnthropicTools([{ function: { name: 'z' } }])[0].input_schema, { type: 'object', properties: {} });
    });
});

describe('toAnthropicMessages', () => {
    it('system → блоки с cache_control на последнем; user/assistant как есть; пустой текст пропускается', () => {
        const r = toAnthropicMessages([
            { role: 'system', content: 'СТАБИЛЬНАЯ ЧАСТЬ' },
            { role: 'user', content: 'привет' },
            { role: 'assistant', content: '' },
            { role: 'assistant', content: 'здравствуйте' },
        ]);
        assert.deepEqual(r.system, [{ type: 'text', text: 'СТАБИЛЬНАЯ ЧАСТЬ', cache_control: EPH }]);
        assert.deepEqual(r.messages.map(m => m.role), ['user', 'assistant']);
        assert.deepEqual(r.messages[1].content, [{ type: 'text', text: 'здравствуйте', cache_control: EPH }], 'последний блок истории — точка кэша');
        assert.equal(toAnthropicMessages([{ role: 'user', content: 'x' }]).system, undefined);
    });

    it('вызовы инструментов: tool_calls → tool_use (input — объект), tool → tool_result в ОДНОМ user-сообщении, is_error по тексту', () => {
        const r = toAnthropicMessages([
            { role: 'user', content: 'работай' },
            { role: 'assistant', content: 'смотрю', tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'ls', arguments: '{"path":"/A"}' } },
                { id: 'c2', type: 'function', function: { name: 'read', arguments: 'мусор' } },
            ] },
            { role: 'tool', tool_call_id: 'c1', content: 'a\nb' },
            { role: 'tool', tool_call_id: 'c2', content: 'Ошибка: нет файла' },
        ], { cache: false });
        assert.deepEqual(r.messages[1].content, [
            { type: 'text', text: 'смотрю' },
            { type: 'tool_use', id: 'c1', name: 'ls', input: { path: '/A' } },
            { type: 'tool_use', id: 'c2', name: 'read', input: {} },
        ]);
        assert.equal(r.messages.length, 3);
        assert.deepEqual(r.messages[2], { role: 'user', content: [
            { type: 'tool_result', tool_use_id: 'c1', content: 'a\nb' },
            { type: 'tool_result', tool_use_id: 'c2', content: 'Ошибка: нет файла', is_error: true },
        ] });
        const wrapped = toAnthropicMessages([{ role: 'user', content: 'x' }, { role: 'assistant', content: '', tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'c', content: '<untrusted source="f" id="1">\nОшибка: HTTP 500\n</untrusted id="1">' }], { cache: false });
        assert.equal(wrapped.messages[2].content[0].is_error, true);
    });

    it('реплика, затесавшаяся между вызовом и результатом, не ломает порядок: tool_result всё равно первые', () => {
        const r = toAnthropicMessages([
            { role: 'user', content: 'x' },
            { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'ls', arguments: '{}' } }] },
            { role: 'user', content: 'вставка' },
            { role: 'tool', tool_call_id: 'c1', content: 'ok' },
        ], { cache: false });
        assert.deepEqual(r.messages[2].content.map(b => b.type), ['tool_result', 'text']);
    });

    it('после tool_result изменчивый хвост и скриншоты — в том же user-сообщении ПОСЛЕ результатов', () => {
        const r = toAnthropicMessages([
            { role: 'user', content: 'x' },
            { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'ls', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'c1', content: 'ok' },
            { role: 'user', content: VOLATILE_HEAD + 'Сейчас: 10:00' },
            { role: 'user', content: [{ type: 'text', text: '[Скриншоты]' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
        ], { cache: false });
        assert.equal(r.messages.length, 3);
        assert.deepEqual(r.messages[2].content.map(b => b.type), ['tool_result', 'text', 'text', 'image']);
        assert.deepEqual(r.messages[2].content[3], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    });

    it('точка кэша истории — последний блок ДО изменчивого хвоста (хвост не кэшируется); всего не больше 3 точек вместе с system и tools', () => {
        const messages = [
            { role: 'system', content: 'S' },
            { role: 'user', content: 'x' },
            { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'ls', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'c1', content: 'ok' },
            { role: 'user', content: VOLATILE_HEAD + 'Сейчас: 10:00' },
        ];
        const body = buildAnthropicRequest(ai, { messages }, [fn('ls')]);
        const last = body.messages.at(-1).content;
        assert.deepEqual(last[0], { type: 'tool_result', tool_use_id: 'c1', content: 'ok', cache_control: EPH });
        assert.equal(last[1].cache_control, undefined, 'хвост не кэшируется');
        assert.equal(countBreakpoints(body), 3);
        assert.deepEqual(body.tools.at(-1).cache_control, EPH);
        assert.deepEqual(body.system.at(-1).cache_control, EPH);
    });

    it('без хвоста точка кэша — на последнем блоке (реплика человека); promptCache:false — точек нет', () => {
        const messages = [{ role: 'system', content: 'S' }, { role: 'user', content: 'вопрос' }];
        const body = buildAnthropicRequest(ai, { messages }, null);
        assert.deepEqual(body.messages[0].content[0], { type: 'text', text: 'вопрос', cache_control: EPH });
        assert.equal(countBreakpoints(buildAnthropicRequest({ ...ai, promptCache: false }, { messages }, [fn('ls')])), 0);
    });

    it('соседние сообщения одной роли склеиваются; первое сообщение — user; картинка по URL', () => {
        const r = toAnthropicMessages([
            { role: 'assistant', content: 'я первый' },
            { role: 'user', content: 'раз' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x.test/a.png' } }] },
        ], { cache: false });
        assert.equal(r.messages[0].role, 'user');
        assert.equal(r.messages[0].content[0].text, 'Продолжай.');
        assert.deepEqual(r.messages.map(m => m.role), ['user', 'assistant', 'user']);
        assert.deepEqual(r.messages[2].content.at(-1), { type: 'image', source: { type: 'url', url: 'https://x.test/a.png' } });
    });

    it('блоки размышлений включаются только при thinking и идут первыми; неперечисляемое свойство не попадает в JSON цикла', () => {
        const blocks = [{ type: 'thinking', thinking: 'думаю', signature: 'SIG' }, { type: 'redacted_thinking', data: 'ENC' }];
        const asst = { id: 'a', type: 'assistant', content: 'ответ', thinkingBlocks: blocks, tools: [{ id: 'c1', name: 'ls', args: {}, status: 'ok', result: 'ok' }] };
        const msgs = toMessages('S', [{ id: 'u', type: 'user', content: 'x' }, asst]);
        const m = msgs.find(x => x.role === 'assistant');
        assert.equal(m.thinking_blocks, blocks);
        assert.ok(!JSON.stringify(msgs).includes('SIG'), 'подпись утекла в JSON сообщений');
        assert.ok(!('thinking_blocks' in { ...m }), 'свойство копируется спредом');
        const on = toAnthropicMessages(msgs, { thinking: true, cache: false }).messages.find(x => x.role === 'assistant');
        assert.deepEqual(on.content.slice(0, 2), blocks);
        assert.equal(on.content[2].text, 'ответ');
        const off = toAnthropicMessages(msgs, { thinking: false, cache: false }).messages.find(x => x.role === 'assistant');
        assert.ok(!off.content.some(b => b.type === 'thinking' || b.type === 'redacted_thinking'));
    });
});

describe('buildAnthropicRequest', () => {
    const base = { messages: [{ role: 'user', content: 'x' }] };

    it('основа: model, max_tokens (по умолчанию 8192, maxOutput модели и запроса), stream, temperature, stop', () => {
        let b = buildAnthropicRequest(ai, { ...base, temperature: 0.3, stop: 'END' });
        assert.deepEqual([b.model, b.max_tokens, b.stream, b.temperature, b.stop_sequences], ['claude-x', 8192, true, 0.3, ['END']]);
        assert.equal(buildAnthropicRequest({ ...ai, maxOutput: 4000 }, base).max_tokens, 4000);
        assert.equal(buildAnthropicRequest({ ...ai, maxOutput: 4000 }, { ...base, maxOutput: 1234 }).max_tokens, 1234);
        assert.equal(buildAnthropicRequest(ai, base).tools, undefined);
        assert.equal(buildAnthropicRequest(ai, base).tool_choice, undefined);
    });

    it('effort → thinking.budget_tokens (меньше max_tokens, минимум 1024); с thinking temperature не передаётся', () => {
        const mk = (effort, maxOutput) => buildAnthropicRequest(ai, { ...base, effort, maxOutput });
        assert.deepEqual(mk('low', 16000).thinking, { type: 'enabled', budget_tokens: 2048 });
        assert.deepEqual(mk('medium', 16000).thinking, { type: 'enabled', budget_tokens: 8192 });
        assert.deepEqual(mk('high', 64000).thinking, { type: 'enabled', budget_tokens: 16384 });
        assert.deepEqual(mk(true, 16000).thinking, { type: 'enabled', budget_tokens: 8192 });
        assert.deepEqual(mk('max', 16000).thinking, { type: 'enabled', budget_tokens: 16000 - 1024 }, 'урезан до max_tokens − 1024');
        assert.equal(mk('medium', 16000).temperature, undefined);
        assert.equal(mk('high', 1500).thinking, undefined, 'бюджет < 1024 — thinking не включается');
        assert.equal(mk('high', 1500).temperature, 0.7);
        assert.equal(mk('off', 16000).thinking, undefined);
        assert.equal(mk(undefined, 16000).thinking, undefined);
        assert.equal(buildAnthropicRequest({ ...ai, capabilities: ['chat'] }, { ...base, effort: 'high', maxOutput: 16000 }).thinking, undefined, 'у модели нет capability effort');
    });

    it('tool_choice: auto/none/required/конкретная функция/параллельные вызовы; с thinking принудительный выбор → auto', () => {
        const tools = [fn('ls')];
        const tc = o => buildAnthropicRequest(ai, { ...base, ...o }, tools).tool_choice;
        assert.deepEqual(tc({}), { type: 'auto' });
        assert.deepEqual(tc({ function_call: 'none' }), { type: 'none' });
        assert.deepEqual(tc({ tool_choice: 'required' }), { type: 'any' });
        assert.deepEqual(tc({ function_call: { name: 'ls' } }), { type: 'tool', name: 'ls' });
        assert.deepEqual(tc({ parallel_tool_calls: false }), { type: 'auto', disable_parallel_tool_use: true });
        assert.deepEqual(tc({ function_call: { name: 'ls' }, effort: 'medium', maxOutput: 16000 }), { type: 'auto' });
    });
});

/** Реальная последовательность событий Messages API: текст + два параллельных tool_use с фрагментами JSON. */
const sse = (type, data) => 'event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n';
const eventsToolRound = [
    sse('message_start', { message: { id: 'm1', usage: { input_tokens: 120, cache_read_input_tokens: 800, cache_creation_input_tokens: 50, output_tokens: 1 } } }),
    sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    sse('ping', {}),
    sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Смотрю ' } }),
    sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'файлы.' } }),
    sse('content_block_stop', { index: 0 }),
    sse('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'ls', input: {} } }),
    sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '' } }),
    sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"path": "/A' } }),
    sse('content_block_start', { index: 2, content_block: { type: 'tool_use', id: 'toolu_2', name: 'read', input: {} } }),
    sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: 'BC"}' } }),
    sse('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":"/B/x.md","limit":5}' } }),
    sse('content_block_stop', { index: 1 }),
    sse('content_block_stop', { index: 2 }),
    sse('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 77 } }),
    sse('message_stop', {}),
];
const parse = (events, model = 'claude-x') => {
    const p = createAnthropicParser(model);
    const out = [];
    for (const e of events)
        out.push(...p.feed(e));
    out.push(...p.end());
    return out;
};
const parseSse = text => parse(text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))));

describe('разбор потока Messages API', () => {
    it('текст, два параллельных tool_use с фрагментами JSON, usage с кэшем, finish', () => {
        const ev = parseSse(eventsToolRound.join(''));
        assert.equal(ev.filter(e => typeof e === 'string').join(''), 'Смотрю файлы.');
        const calls = ev.find(e => e.type === 'tool_calls').calls;
        assert.deepEqual(calls, [
            { id: 'toolu_1', name: 'ls', arguments: { path: '/ABC' } },
            { id: 'toolu_2', name: 'read', arguments: { path: '/B/x.md', limit: 5 } },
        ]);
        assert.deepEqual(ev.find(e => e.type === 'usage'), {
            type: 'usage', prompt_tokens: 970, completion_tokens: 77, total_tokens: 1047, cached_tokens: 800, cache_creation_tokens: 50,
        });
        assert.deepEqual(ev.find(e => e.type === 'finish'), { type: 'finish', reason: 'tool_calls', done: true });
    });

    it('tool_use без аргументов → {}; оборванный JSON аргументов → {raw} (цикл объяснит обрезку)', () => {
        const run = args => parse([
            { type: 'message_start', message: { usage: { input_tokens: 1 } } },
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'f', input: {} } },
            ...(args == null ? [] : [{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args } }]),
            { type: 'message_delta', delta: { stop_reason: args == null ? 'tool_use' : 'max_tokens' }, usage: { output_tokens: 3 } },
            { type: 'message_stop' },
        ]);
        assert.deepEqual(run(null).find(e => e.type === 'tool_calls').calls[0].arguments, {});
        const cut = run('{"content":"длинный текст без конца');
        assert.deepEqual(cut.find(e => e.type === 'tool_calls').calls[0].arguments, { raw: '{"content":"длинный текст без конца' });
        assert.equal(cut.find(e => e.type === 'finish').reason, 'length');
    });

    it('thinking: reasoning стримится, блок с подписью и redacted_thinking возвращаются одним событием', () => {
        const ev = parse([
            { type: 'message_start', message: { usage: { input_tokens: 10 } } },
            { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Сначала ' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'проверю.' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'EqQB' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'ABC' } },
            { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'ENCRYPTED' } },
            { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Готово' } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
            { type: 'message_stop' },
        ]);
        assert.deepEqual(ev.filter(e => e.type === 'reasoning').map(e => e.content), ['Сначала ', 'проверю.']);
        assert.deepEqual(ev.find(e => e.type === 'thinking_blocks').blocks, [
            { type: 'thinking', thinking: 'Сначала проверю.', signature: 'EqQBABC' },
            { type: 'redacted_thinking', data: 'ENCRYPTED' },
        ]);
        assert.equal(ev.find(e => e.type === 'finish').reason, 'stop');
        assert.ok(!ev.some(e => e.type === 'tool_calls'));
    });

    it('stop_reason → finish.reason: end_turn/stop_sequence → stop, max_tokens → length, refusal → content_filter', () => {
        const reason = stop => parse([{ type: 'message_delta', delta: { stop_reason: stop } }, { type: 'message_stop' }]).find(e => e.type === 'finish').reason;
        assert.deepEqual(['end_turn', 'stop_sequence', 'tool_use', 'max_tokens', 'refusal', 'pause_turn'].map(reason),
            ['stop', 'stop', 'tool_calls', 'length', 'content_filter', 'pause_turn']);
    });

    it('поток без message_stop — finish.done=false, причины нет (цикл повторит ход); событие error — исключение с текстом провайдера', () => {
        const ev = parse([{ type: 'message_start', message: { usage: { input_tokens: 5 } } }]);
        assert.deepEqual(ev.find(e => e.type === 'finish'), { type: 'finish', reason: null, done: false });
        assert.throws(() => parse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]), /LLM claude-x: Overloaded/);
    });

    it('usage из message_delta (кумулятивный) перекрывает message_start; без кэша cached_tokens = 0', () => {
        const u = parse([
            { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1 } } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } },
            { type: 'message_stop' },
        ]).find(e => e.type === 'usage');
        assert.deepEqual([u.prompt_tokens, u.completion_tokens, u.cached_tokens, u.cache_creation_tokens], [100, 42, 0, 0]);
    });
});

describe('streamChat: protocol anthropic сквозной запрос', () => {
    let seen;
    function install(chunks) {
        async function* fakeRes() { for (const c of chunks) yield Buffer.from(c); }
        globalThis.WORK = {
            https: {
                request(opts, cb) {
                    seen = { opts };
                    queueMicrotask(() => cb(Object.assign(fakeRes(), { statusCode: 200 })));
                    return { on() {}, setTimeout() {}, destroy() {}, write(b) { seen.body = JSON.parse(b); }, end() {} };
                },
            },
        };
    }
    const collect = async options => {
        const out = { text: '', events: [] };
        for await (const t of aiDef.streamChat.call({ ...ai, apiKey: 'sk-ant-example-not-a-real-key' }, options))
            typeof t === 'string' ? out.text += t : out.events.push(t);
        return out;
    };

    it('адрес /v1/messages, заголовки x-api-key + anthropic-version, тело в нативном формате, события адаптера', async () => {
        install(eventsToolRound);
        const r = await collect({
            messages: [{ role: 'system', content: 'СТАБИЛЬНАЯ ЧАСТЬ' }, { role: 'user', content: 'работай' }, { role: 'user', content: VOLATILE_HEAD + 'Сейчас: 10:00' }],
            tools: [fn('ls'), fn('read')], maxOutput: 4096,
        });
        assert.equal(seen.opts.path, '/v1/messages');
        assert.equal(seen.opts.hostname, 'api.anthropic.com');
        assert.equal(seen.opts.headers['x-api-key'], 'sk-ant-example-not-a-real-key');
        assert.equal(seen.opts.headers['anthropic-version'], ANTHROPIC_VERSION);
        assert.equal(seen.opts.headers.Authorization, undefined);
        assert.equal(seen.body.model, 'claude-x');
        assert.equal(seen.body.max_tokens, 4096);
        assert.deepEqual(seen.body.system, [{ type: 'text', text: 'СТАБИЛЬНАЯ ЧАСТЬ', cache_control: EPH }]);
        assert.deepEqual(seen.body.tools.map(t => t.name), ['ls', 'read']);
        assert.equal(seen.body.messages.length, 1);
        assert.equal(seen.body.messages[0].content[0].cache_control.type, 'ephemeral', 'точка кэша на реплике человека, до хвоста');
        assert.equal(seen.body.stream_options, undefined);
        assert.equal(r.text, 'Смотрю файлы.');
        assert.deepEqual(r.events.map(e => e.type), ['tool_calls', 'usage', 'finish']);
        assert.equal(r.events.find(e => e.type === 'tool_calls').calls.length, 2);
        assert.equal(r.events.find(e => e.type === 'usage').prompt_tokens, 970);
    });

    it('HTTP-ошибка провайдера — исключение с телом ответа (ретраи цикла и 401/403 как раньше)', async () => {
        globalThis.WORK = { https: { request(_o, cb) {
            // ошибочный ответ адаптер читает событиями data/end, как настоящий http.IncomingMessage
            const res = new EventEmitter();
            res.statusCode = 401;
            queueMicrotask(() => {
                cb(res);
                res.emit('data', Buffer.from('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'));
                res.emit('end');
            });
            return { on() {}, setTimeout() {}, destroy() {}, write() {}, end() {} };
        } } };
        await assert.rejects(collect({ messages: [{ role: 'user', content: 'x' }] }), /stream error 401.*invalid x-api-key/);
    });

    it('OpenAI-совместимые протоколы не тронуты: тело в формате chat.completions', async () => {
        install(['data: [DONE]\n']);
        for await (const _ of aiDef.streamChat.call({ protocol: 'openai', baseUrl: 'https://x.test/v1/chat/completions', model: 'm' }, { messages: [{ role: 'user', content: 'x' }] })) { /* drain */ }
        assert.equal(seen.opts.path, '/v1/chat/completions');
        assert.equal(seen.body.stream_options.include_usage, true);
        assert.equal(seen.body.system, undefined);
    });
});

describe('цикл агента с Anthropic: блоки размышлений и токены кэша', () => {
    it('thinking_blocks и usage с записью кэша сохраняются в ленте; следующий запрос получает блоки неперечисляемым свойством', async () => {
        const log = [];
        let i = 0;
        const llm = {
            name: 'mock', contextTokens: 100000,
            async *stream(req) {
                log.push(req);
                if (i++ === 0) {
                    yield { type: 'thinking_blocks', blocks: [{ type: 'thinking', thinking: 'думаю', signature: 'SIG' }] };
                    yield { type: 'tool_calls', calls: [{ id: 'c1', name: 'ls', arguments: {} }] };
                    yield { type: 'usage', prompt_tokens: 900, completion_tokens: 20, total_tokens: 920, cached_tokens: 700, cache_creation_tokens: 100 };
                    return;
                }
                yield 'готово';
            },
        };
        const items = [{ id: 'u', type: 'user', content: 'x' }];
        const ls = { name: 'ls', readonly: true, parameters: { type: 'object', properties: {} }, run: () => 'ok' };
        await runLoop({ llm, system: 'S', items, tools: [ls], host: { mode: 'auto', signal: new AbortController().signal, allowed: new Set(), async save() {}, emit() {} } });
        const first = items.find(it => it.type === 'assistant');
        assert.deepEqual(first.thinkingBlocks, [{ type: 'thinking', thinking: 'думаю', signature: 'SIG' }]);
        assert.deepEqual(first.usage, { prompt: 900, completion: 20, total: 920, cached: 700, cacheWrite: 100 });
        const asstMsg = log[1].messages.find(m => m.role === 'assistant');
        assert.deepEqual(asstMsg.thinking_blocks, first.thinkingBlocks);
        assert.ok(!JSON.stringify(log[1].messages).includes('SIG'));
    });
});
