/**
 * Ядро агента (sources/modules/agent): цикл tool calling, инструменты WORK, разрешения, сессия .task.
 * Песочница-дерево в tmp + сценарная модель (без сети).
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { runLoop, toMessages, maybeCompact } from '../sources/modules/agent/loop.js';
import { decide, isProtectedPath } from '../sources/modules/agent/permissions.js';
import { workTools } from '../sources/modules/agent/tools/work.js';
import { createEnv, runOnce } from '../sources/modules/agent/index.js';
import * as session from '../sources/modules/agent/session.js';
import { lineDiff } from '../sources/modules/agent/diff.js';
import { parseFrontmatter } from '../sources/modules/agent/util.js';

const ROOT = path.resolve(import.meta.dirname, '..');
let tmp, prevCwd;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

/** Сценарная модель: ответы по очереди; каждый — { text?, calls?:[{name,args}], reasoning?, delayMs? }. */
function scripted(steps, log = []) {
    let i = 0;
    return {
        name: 'mock',
        contextTokens: 100000,
        requests: log,
        async *stream(req) {
            log.push(req);
            const step = typeof steps === 'function' ? steps(req, i) : steps[i];
            i++;
            if (!step)
                throw new Error('сценарий кончился на шаге ' + i);
            if (step.error)
                throw new Error(step.error);
            if (step.reasoning)
                yield { type: 'reasoning', content: step.reasoning };
            for (const t of String(step.text || '').match(/.{1,5}/gs) || []) {
                if (step.delayMs)
                    await new Promise(r => setTimeout(r, step.delayMs));
                if (req.signal?.aborted)
                    return;
                yield t;
            }
            if (step.calls)
                yield { type: 'tool_calls', calls: step.calls.map((c, k) => ({ id: 'c' + i + '_' + k, name: c.name, arguments: c.args || {} })) };
            yield { type: 'usage', prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
        },
    };
}

function mkHost(extra = {}) {
    const events = [];
    return {
        mode: 'auto',
        signal: new AbortController().signal,
        allowed: new Set(),
        saves: 0,
        events,
        async save() { this.saves++; },
        emit: e => events.push(e),
        ...extra,
    };
}

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-agent-'));
    write('$server/class.js', `export default { label: 'WORK-AGENT' }`);
    write('$server/$folder/class.js', `export default {}`);
    write('$server/$folder/$class/class.js', `export default {}`);
    write('$server/$folder/$class/ai/system.md', 'СИСТЕМА-ДВИЖКА');
    write('$server/$folder/$class/ai/config.js', `export default { model: '/MODELS/mock' }`);
    write('$server/$folder/$class/ai/agents/explore.md', '---\nname: explore\ndescription: читать\ntools: readonly\n---\nТы исследователь.');
    write('$server/$folder/$class/ai/skills/hello.md', '---\nname: hello\ndescription: поздороваться\n---\nСкажи привет.');
    write('$server/$folder/$class/ai/skills/readme.md', '# не навык');
    // тип .task — настоящий слой проекта
    for (const rel of ['$server/$folder/$file/$data/$task/class.js'])
        write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
    write('BOX/$class/class.js', `export default { label: 'Коробка' }`);
    write('BOX/$class/readme.md', '# Контракт BOX\nЗдесь лежат отчёты.');
    write('BOX/$class/ai/skills/local.md', '---\nname: local\ndescription: местный навык\n---\nТело.');
    write('BOX/doc/note.md', 'строка 1\nстрока 2\nстрока 3\n');
    write('MODELS/$class/class.js', `export default {}`);
    write('MODELS/mock/$ai/class.js', `export default {
        maxTokens: 50000,
        streamChat(req) { return globalThis.__MOCK_STREAM__(req); },
    }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    process.chdir(prevCwd);
    try {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
    catch { /* windows */ }
});

describe('loop: цикл tool calling', () => {
    it('ответ без инструментов — done, стрим дельт, usage', async () => {
        const items = [{ id: 'u', type: 'user', content: 'привет' }];
        const host = mkHost();
        const res = await runLoop({ llm: scripted([{ text: 'Здравствуйте!' }]), system: 'S', items, tools: [], host });
        assert.equal(res.status, 'done');
        assert.equal(items[1].content, 'Здравствуйте!');
        assert.ok(items[1].usage);
        assert.ok(host.events.some(e => e.field === 'content'));
    });

    it('вызов инструмента → результат в контексте → ответ', async () => {
        const log = [];
        const items = [{ id: 'u', type: 'user', content: 'что в BOX' }];
        const llm = scripted([{ calls: [{ name: 'ls', args: { path: '/BOX' } }] }, { text: 'В BOX есть doc.' }], log);
        const res = await runLoop({ llm, system: 'S', items, tools: workTools, host: mkHost() });
        assert.equal(res.status, 'done');
        const call = items[1].tools[0];
        assert.equal(call.status, 'ok');
        assert.match(call.result, /doc\//);
        const msgs = log[1].messages;
        assert.equal(msgs.at(-1).role, 'tool');
        assert.equal(msgs.at(-2).tool_calls[0].function.name, 'ls');
    });

    it('параллельные read-only вызовы в одном ходе, неизвестный инструмент и нет аргументов — ошибки модели, не крах', async () => {
        const items = [{ id: 'u', type: 'user', content: 'x' }];
        let running = 0, peak = 0;
        const slow = name => ({
            name, readonly: true, parameters: { type: 'object', properties: {} },
            async run() { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 30)); running--; return name; },
        });
        const need = { name: 'need', readonly: true, parameters: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, run: () => 'x' };
        const llm = scripted([{ calls: [{ name: 'a' }, { name: 'b' }, { name: 'nope' }, { name: 'need' }] }, { text: 'ok' }]);
        await runLoop({ llm, system: 'S', items, tools: [slow('a'), slow('b'), need], host: mkHost() });
        assert.equal(peak, 2);
        const [a, b, nope, n] = items[1].tools;
        assert.equal(a.status, 'ok');
        assert.equal(b.status, 'ok');
        assert.equal(nope.status, 'error');
        assert.match(n.error, /обязательных/);
    });

    it('разрешение: ask → человек подтверждает / отклоняет с комментарием', async () => {
        const writeTool = { name: 'danger', risk: 'danger', parameters: { type: 'object', properties: {} }, run: () => 'сделано' };
        for (const accept of [true, false]) {
            const items = [{ id: 'u', type: 'user', content: 'x' }];
            const host = mkHost({ wait: async req => { assert.equal(req.kind, 'approval'); return { accept, content: accept ? '' : 'не надо' }; } });
            await runLoop({ llm: scripted([{ calls: [{ name: 'danger' }] }, { text: 'итог' }]), system: 'S', items, tools: [writeTool], host });
            const t = items[1].tools[0];
            assert.equal(t.status, accept ? 'ok' : 'denied');
            if (!accept)
                assert.match(toMessages('', items).find(m => m.role === 'tool').content, /не надо/);
        }
    });

    it('план: инструменты записи модели не показываются', async () => {
        const log = [];
        await runLoop({ llm: scripted([{ text: 'план' }], log), system: 'S', items: [{ id: 'u', type: 'user', content: 'x' }], tools: workTools, host: mkHost({ mode: 'plan' }) });
        const names = log[0].tools.map(t => t.function.name);
        assert.ok(names.includes('read'));
        assert.ok(!names.includes('write') && !names.includes('edit') && !names.includes('call'));
    });

    it('стоп посреди стрима: частичный ответ сохраняется, статус stopped', async () => {
        const ctl = new AbortController();
        const items = [{ id: 'u', type: 'user', content: 'x' }];
        const host = mkHost({ signal: ctl.signal, emit: () => ctl.abort() });
        const res = await runLoop({ llm: scripted([{ text: 'длинный ответ', delayMs: 5 }]), system: 'S', items, tools: [], host });
        assert.equal(res.status, 'stopped');
        assert.equal(items[1].stopped, true);
        assert.ok(items[1].content.length > 0);
    });

    it('ошибка модели до первого токена — ретрай; ключ (401) — без ретрая', async () => {
        let n = 0;
        const flaky = scripted((req, i) => (n++ < 1 ? { error: '500 runner' } : { text: 'ok' }));
        const items = [{ id: 'u', type: 'user', content: 'x' }];
        assert.equal((await runLoop({ llm: flaky, system: 'S', items, tools: [], host: mkHost() })).status, 'done');
        const items2 = [{ id: 'u', type: 'user', content: 'x' }];
        await assert.rejects(() => runLoop({ llm: scripted([{ error: '401 virtual key required' }]), system: 'S', items: items2, tools: [], host: mkHost() }));
        assert.equal(items2[1].error, true);
    });

    it('сжатие: старая часть ленты → сводка, контекст начинается со сводки', async () => {
        const items = [];
        for (let k = 0; k < 6; k++) {
            items.push({ id: 'u' + k, type: 'user', content: 'вопрос ' + k + ' ' + 'x'.repeat(2000) });
            items.push({ id: 'a' + k, type: 'assistant', content: 'ответ ' + k });
        }
        const llm = { ...scripted([{ text: 'СВОДКА' }]), contextTokens: 1000 };
        const done = await maybeCompact({ llm, items, host: mkHost(), system: 'S' });
        assert.ok(done);
        const msgs = toMessages('S', items);
        assert.match(msgs[1].content, /СВОДКА/);
        assert.ok(items.filter(i => i.compacted).length >= 8);
    });

    it('незакрытые вызовы после рестарта → interrupted, модель видит честный результат', async () => {
        const items = [
            { id: 'u', type: 'user', content: 'x' },
            { id: 'a', type: 'assistant', content: '', tools: [{ id: 't1', name: 'ls', args: {}, status: 'running' }] },
        ];
        const log = [];
        await runLoop({ llm: scripted([{ text: 'продолжаю' }], log), system: 'S', items, tools: workTools, host: mkHost() });
        assert.equal(items[1].tools[0].status, 'interrupted');
        assert.match(log[0].messages.find(m => m.role === 'tool').content, /прерван/);
    });
});

describe('permissions', () => {
    it('системные пути и код — с подтверждением в auto; данные — без', async () => {
        assert.ok(isProtectedPath('/$server/x.md'));
        assert.ok(isProtectedPath('/BOX/$class/class.js'));
        assert.ok(isProtectedPath('/BOX/#security/x'));
        assert.ok(!isProtectedPath('/BOX/doc/a.md'));
        const w = workTools.find(t => t.name === 'write');
        assert.equal((await decide(w, { path: '/BOX/doc/a.md' }, { host: { mode: 'auto' } })).verdict, 'allow');
        assert.equal((await decide(w, { path: '/sources/x.js' }, { host: { mode: 'auto' } })).verdict, 'ask');
        assert.equal((await decide(w, { path: '/BOX/doc/a.md' }, { host: { mode: 'ask' } })).verdict, 'ask');
        assert.equal((await decide(w, { path: '/BOX/doc/a.md' }, { host: { mode: 'plan' } })).verdict, 'deny');
        const call = workTools.find(t => t.name === 'call');
        assert.equal((await decide(call, { path: '/BOX', method: 'delete' }, { host: { mode: 'auto' } })).verdict, 'ask');
        assert.equal((await decide(call, { path: '/BOX', method: 'get_schema' }, { host: { mode: 'ask' } })).verdict, 'allow');
    });
});

describe('инструменты WORK на песочнице', () => {
    const tool = n => workTools.find(t => t.name === n);
    const ctx = () => ({ entry: {}, place: null });

    it('ls / read класса (контракт) / read файла с номерами строк', async () => {
        assert.match(await tool('ls').run({ path: '/BOX' }, ctx()), /doc\/\s+\[папка\]/);
        const cls = await tool('read').run({ path: '/BOX' }, ctx());
        assert.match(cls, /Контракт BOX/);
        const file = await tool('read').run({ path: '/BOX/doc/note.md', offset: 2, limit: 1 }, ctx());
        assert.match(file, /^\s+2\tстрока 2/);
    });

    it('write → файл + история; edit — точечно, неоднозначность — ошибка', async () => {
        const c = ctx();
        const out = await tool('write').run({ path: '/BOX/doc/new.md', content: 'альфа\nбета\nбета\n' }, c);
        assert.match(out, /создан/);
        assert.ok(fs.existsSync(path.join(tmp, 'BOX/doc/new.md')));
        await assert.rejects(() => tool('edit').run({ path: '/BOX/doc/new.md', old_string: 'бета', new_string: 'гамма' }, ctx()), /2 раз/);
        const c2 = ctx();
        await tool('edit').run({ path: '/BOX/doc/new.md', old_string: 'альфа', new_string: 'АЛЬФА' }, c2);
        assert.equal(fs.readFileSync(path.join(tmp, 'BOX/doc/new.md'), 'utf-8'), 'АЛЬФА\nбета\nбета\n');
        assert.equal(c2.entry.diff.added, 1);
        assert.equal(c2.entry.diff.removed, 1);
        assert.ok(fs.existsSync(path.join(tmp, 'BOX/doc/.new.md/history')));
    });

    it('write во вложенную несуществующую папку', async () => {
        await tool('write').run({ path: '/BOX/doc/sub/deep.txt', content: 'x' }, ctx());
        assert.ok(fs.existsSync(path.join(tmp, 'BOX/doc/sub/deep.txt')));
    });

    it('create_class / find по имени и тексту / schema / call', async () => {
        const out = await tool('create_class').run({ parent: '/BOX', id: 'REPORTS', label: 'Отчёты' }, ctx());
        assert.match(out, /\/BOX\/REPORTS/);
        assert.ok(fs.existsSync(path.join(tmp, 'BOX/REPORTS/$class/class.js')));
        assert.match(await tool('find').run({ path: '/BOX', name: '*.md' }, ctx()), /note\.md/);
        assert.match(await tool('find').run({ path: '/BOX', text: 'строка 2' }, ctx()), /note\.md:2:/);
        assert.match(await tool('schema').run({ path: '/BOX' }, ctx()), /save_file/);
        const info = await tool('call').run({ path: '/BOX/doc/note.md', method: 'read_text' }, ctx());
        assert.match(String(info), /строка 1/);
        await assert.rejects(() => tool('call').run({ path: '/BOX', method: '_secretPath' }, ctx()), /недоступен/);
    });
});

describe('окружение: слои ai/, system, навыки, субагенты', () => {
    it('навыки движка + места, readme не навык; system собран', async () => {
        const place = await WORK.get_item('/BOX');
        const env = await createEnv({ place, host: { mode: 'auto' } });
        assert.ok(env.skills.has('hello') && env.skills.has('local'));
        assert.ok(!env.skills.has('readme'));
        assert.ok(env.agents.has('explore'));
        const sys = await env.makeSystem();
        assert.match(sys, /СИСТЕМА-ДВИЖКА/);
        assert.match(sys, /Контракт BOX/);
        assert.match(sys, /hello: поздороваться/);
        const tools = await env.makeTools(env.agents.get('explore'), 1);
        assert.ok(tools.every(t => t.readonly || t.name === 'task'));
        assert.equal(await env.defaultModel(), '/MODELS/mock');
    });

    it('субагент task: своя лента внутри вызова, отчёт — результат', async () => {
        const place = await WORK.get_item('/BOX');
        globalThis.__MOCK_STREAM__ = scripted([
            { calls: [{ name: 'task', args: { agent: 'explore', description: 'осмотр', prompt: 'что в /BOX/doc' } }] },
            { calls: [{ name: 'ls', args: { path: '/BOX/doc' } }] },
            { text: 'В doc: note.md' },
            { text: 'Готово: note.md' },
        ]).stream;
        const res = await runOnce({ place, prompt: 'осмотри' });
        assert.equal(res.status, 'done');
        const call = res.items[1].tools[0];
        assert.equal(call.agent, 'explore');
        assert.equal(call.result, 'В doc: note.md');
        assert.equal(call.items[1].tools[0].name, 'ls');
    });
});

describe('сессия .task', () => {
    async function newTask(name) {
        const box = await WORK.get_item('/BOX');
        // .task — файл данных: ядро само кладёт его в {папка}/{день}/{время}.{uid}.task
        const log = await box.meta_folder.save_file({ folder: 'USER', filename: name + '.task', post: JSON.stringify({ name, items: [] }), skip_file_handler: true });
        const file = await WORK.get_item(log.logFullPath || log.path);
        assert.ok(file, 'файл задачи: ' + JSON.stringify(log));
        await file.init;
        return file;
    }

    it('prompt → фон → ответ на диске; замок — второй prompt «занят»', async () => {
        const file = await newTask('t1');
        globalThis.__MOCK_STREAM__ = scripted([{ text: 'Готово.', delayMs: 2 }]).stream;
        assert.equal((await session.prompt(file, { prompt: 'сделай' })).ok, true);
        const busy = await session.prompt(file, { prompt: 'ещё' });
        assert.equal(busy.busy, true);
        await session.idle(file);
        const body = JSON.parse(fs.readFileSync(file.dir, 'utf-8'));
        assert.equal(body.version, 2);
        assert.equal(body.status, 'idle');
        assert.equal(body.items[1].content, 'Готово.');
        assert.equal(body.model, '/MODELS/mock');
        assert.equal(body.title, 'сделай');
    });

    it('ask_user: ожидание → ответ человека текстом → продолжение', async () => {
        const file = await newTask('t2');
        globalThis.__MOCK_STREAM__ = scripted([
            { calls: [{ name: 'ask_user', args: { question: 'Какой цвет?', options: ['красный', 'синий'] } }] },
            { text: 'Выбран синий.' },
        ]).stream;
        await session.prompt(file, { prompt: 'нарисуй' });
        for (let k = 0; k < 50 && (await session.getBody(file)).status !== 'waiting'; k++)
            await new Promise(r => setTimeout(r, 10));
        const body = await session.getBody(file);
        assert.equal(body.waiting.kind, 'question');
        assert.equal((await session.prompt(file, { prompt: 'синий' })).answered, 'question');
        await session.idle(file);
        assert.equal(body.items[1].tools[0].answer, 'синий');
        assert.equal(body.items.at(-1).content, 'Выбран синий.');
    });

    it('подтверждение, пережившее рестарт: approve применяется к ленте и работа продолжается', async () => {
        const file = await newTask('t3');
        const body = await session.getBody(file);
        body.items.push(
            { id: 'u', type: 'user', content: 'удали' },
            { id: 'a', type: 'assistant', content: '', tools: [{ id: 'k1', name: 'write', args: { path: '/BOX/doc/after.md', content: 'ok' }, status: 'approval' }] },
        );
        body.waiting = { kind: 'approval', item: 'a', call: 'k1' };
        fs.writeFileSync(file.dir, JSON.stringify(body));
        globalThis.__MOCK_STREAM__ = scripted([{ text: 'Записал.' }]).stream;
        const res = await session.approve(file, { call: 'k1', accept: true });
        assert.equal(res.resumed, true);
        const done = await session.idle(file);
        assert.equal(done.items[1].tools[0].status, 'ok');
        assert.ok(fs.existsSync(path.join(tmp, 'BOX/doc/after.md')));
        assert.equal(done.items.at(-1).content, 'Записал.');
    });

    it('revert: лента обрезается, текст возвращается; стоп', async () => {
        const file = await newTask('t4');
        globalThis.__MOCK_STREAM__ = scripted([{ text: 'один' }, { text: 'два' }]).stream;
        await session.prompt(file, { prompt: 'первый' });
        await session.idle(file);
        await session.prompt(file, { prompt: 'второй' });
        await session.idle(file);
        const body = await session.getBody(file);
        const second = body.items.find(i => i.content === 'второй');
        const r = await session.revert(file, { id: second.id });
        assert.equal(r.prompt, 'второй');
        assert.equal((await session.getBody(file)).items.length, 2);
    });

    it('старый формат (v1) мигрирует в v2', () => {
        const b = session.normalizeBody({ items: [{ type: 'prompt', content: 'вопрос' }, { type: 'explore', label: 'Осмотр', items: [{ type: 'ls', content: 'дети' }] }, { type: 'answer', content: 'ответ' }], using_blocks: ['x'], goal: {} });
        assert.equal(b.version, 2);
        assert.deepEqual(b.items.map(i => i.type), ['user', 'assistant', 'assistant']);
        assert.ok(!('goal' in b));
    });
});

describe('утилиты', () => {
    it('lineDiff и фронтматтер', () => {
        const d = lineDiff('a\nb\nc', 'a\nB\nc');
        assert.equal(d.added, 1);
        assert.match(d.text, /-b\n\+B/);
        const f = parseFrontmatter('---\nname: x\ntools: [a, b]\nn: 3\n---\nтело');
        assert.deepEqual(f.meta, { name: 'x', tools: ['a', 'b'], n: 3 });
        assert.equal(f.body, 'тело');
    });
});
