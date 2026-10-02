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
import { metaTools } from '../sources/modules/agent/tools/meta.js';
import * as session from '../sources/modules/agent/session.js';
import { findPendingTasks } from '../sources/modules/agent/recovery.js';
import { lineDiff } from '../sources/modules/agent/diff.js';
import { parseFrontmatter } from '../sources/modules/agent/util.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHILD_UID = 'EU00000000000001';
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
    write('$server/$folder/$class/ai/agents/general.md', '---\nname: general\ndescription: исполнитель\ntools: *\n---\nВыполни поручение.');
    write('$server/$folder/$class/ai/skills/hello.md', '---\nname: hello\ndescription: поздороваться\n---\nСкажи привет.');
    write('$server/$folder/$class/ai/skills/readme.md', '# не навык');
    // тип .task — настоящий слой проекта
    for (const rel of ['$server/$folder/$file/$task/class.js'])
        write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
    write('BOX/$class/class.js', `export default { label: 'Коробка', '#security': { USERS: ['${CHILD_UID}'] } }`);
    write(`USERS/${CHILD_UID}/$user/class.js`, `export default { label: 'Тестовый пользователь' }`);
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
    it('битый длинный JSON аргументов объясняет обрезку и советует append', async () => {
        const items = [{ id: 'u', type: 'user', content: 'html' }];
        await runLoop({ llm: scripted([
            { calls: [{ name: 'write', args: { raw: '{"path":"/BOX/doc/x.html","content":"' + 'x'.repeat(2000) } }] },
            { text: 'попробую частями' },
        ]), system: 'S', items, tools: workTools, host: mkHost() });
        const call = items.find(i => i.tools)?.tools[0];
        assert.equal(call.status, 'error');
        assert.match(call.error, /20\d\d символов/);
        assert.match(call.error, /append/);
    });
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

    it('пустой ход (только рассуждение) — сам «дальше» со скрытой подсказкой, без ошибки в ленте', async () => {
        const log = [];
        const items = [{ id: 'u', type: 'user', content: 'x' }];
        const res = await runLoop({ llm: scripted([{ reasoning: 'думаю…' }, { text: 'готово' }], log), system: 'S', items, tools: [], host: mkHost() });
        assert.equal(res.status, 'done');
        assert.equal(items.length, 2);
        assert.equal(items[1].content, 'готово');
        assert.match(log[1].messages.at(-1).content, /пустым/);
    });

    it('пустые ходы подряд — ошибка с причиной; в контекст модели она не идёт', async () => {
        const items = [{ id: 'u', type: 'user', content: 'x' }];
        const res = await runLoop({ llm: scripted([{ reasoning: 'a' }, { reasoning: 'b' }, { reasoning: 'c' }]), system: 'S', items, tools: [], host: mkHost() });
        assert.equal(res.status, 'error');
        assert.equal(items.length, 2);
        assert.match(items[1].content, /пустой ответ.*рассуждение/);
        assert.equal(toMessages('S', items).length, 2);
    });

    it('поток оборвался без [DONE] и finish_reason — повтор хода', async () => {
        let n = 0;
        const llm = {
            name: 'mock', contextTokens: 100000,
            async *stream() {
                if (n++ === 0) {
                    yield { type: 'finish', reason: null, done: false };
                    return;
                }
                yield 'ok';
                yield { type: 'finish', reason: 'stop', done: true };
            },
        };
        const items = [{ id: 'u', type: 'user', content: 'x' }];
        const res = await runLoop({ llm, system: 'S', items, tools: [], host: mkHost() });
        assert.equal(res.status, 'done');
        assert.equal(n, 2);
        assert.equal(items[1].content, 'ok');
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
        assert.match(c.entry.snapshot, /\/\.new\.md\/history\/[^/]+\/[^/]+\.md$/);
        assert.equal(await tool('read').run({ path: c.entry.snapshot }, ctx()).then(s => s.includes('альфа')), true);
        await assert.rejects(() => tool('edit').run({ path: '/BOX/doc/new.md', old_string: 'бета', new_string: 'гамма' }, ctx()), /2 раз/);
        await new Promise(r => setTimeout(r, 5));
        const c2 = ctx();
        await tool('edit').run({ path: '/BOX/doc/new.md', old_string: 'альфа', new_string: 'АЛЬФА' }, c2);
        assert.notEqual(c.entry.snapshot, c2.entry.snapshot);
        assert.match(await tool('read').run({ path: c.entry.snapshot }, ctx()), /альфа/);
        assert.doesNotMatch(await tool('read').run({ path: c.entry.snapshot }, ctx()), /АЛЬФА/);
        assert.equal(fs.readFileSync(path.join(tmp, 'BOX/doc/new.md'), 'utf-8'), 'АЛЬФА\nбета\nбета\n');
        assert.equal(c2.entry.diff.added, 1);
        assert.equal(c2.entry.diff.removed, 1);
        assert.ok(fs.existsSync(path.join(tmp, 'BOX/doc/.new.md/history')));
    });

    it('записи задачи помечаются mainContext и не шумят в общей ленте', async () => {
        const readLogRows = () => {
            const out = [];
            const walk = dir => {
                for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                    const p = path.join(dir, e.name);
                    if (e.isDirectory())
                        walk(p);
                    else if (e.name.endsWith('.logs')) {
                        try {
                            out.push(JSON.parse(fs.readFileSync(p, 'utf-8')));
                        }
                        catch { /* не строка лога */ }
                    }
                }
            };
            walk(tmp);
            return out;
        };
        const taskCtx = () => ({ entry: {}, place: null, task: { path: '/BOX/task/42.task' } });
        const c = taskCtx();
        await tool('write').run({ path: '/BOX/doc/pub.md', content: 'v1' }, c);
        await tool('append').run({ path: c.entry.path, content: 'v2' }, taskCtx());
        const marked = readLogRows().filter(r => String(r.path || '').includes('.pub.md/history'));
        assert.ok(marked.length >= 2);
        assert.ok(marked.every(r => r.mainContext === '/BOX/task/42.task'));
        await tool('write').run({ path: '/BOX/doc/plain.md', content: 'x' }, ctx());
        const plain = readLogRows().filter(r => String(r.path || '').includes('.plain.md/history'));
        assert.ok(plain.length >= 1);
        assert.ok(plain.every(r => !r.mainContext));
    });

    it('write во вложенную несуществующую папку', async () => {
        await tool('write').run({ path: '/BOX/doc/sub/deep.txt', content: 'x' }, ctx());
        assert.ok(fs.existsSync(path.join(tmp, 'BOX/doc/sub/deep.txt')));
    });

    it('write + append: большой HTML пишется частями, каждый шаг остаётся в истории', async () => {
        const first = ctx(), second = ctx();
        await tool('write').run({ path: '/BOX/doc/slides.html', content: '<html>\n' }, first);
        await tool('append').run({ path: first.entry.path, content: '<section>Слайд 1</section>\n' }, second);
        assert.equal(fs.readFileSync(path.join(tmp, 'BOX/doc/slides.html'), 'utf-8'), '<html>\n<section>Слайд 1</section>\n');
        assert.notEqual(first.entry.snapshot, second.entry.snapshot);
        const old = await WORK.get_item(first.entry.snapshot);
        assert.equal(await old.load({ encoding: 'utf-8' }), '<html>\n');
        await assert.rejects(() => tool('append').run({ path: '/BOX/doc/missing.html', content: 'x' }, ctx()), /не найдено/);
    });

    it('два сохранения одного файла в одну миллисекунду не перезаписывают снимок', async () => {
        const folder = await WORK.get_item('/BOX/doc');
        const time = Date.now();
        const first = await folder.save_file({ filename: 'collision.md', post: 'первая версия', time });
        const second = await folder.save_file({ filename: 'collision.md', post: 'вторая версия', time });
        assert.notEqual(first.path, second.path);
        assert.match(await tool('read').run({ path: first.path }, ctx()), /первая версия/);
        assert.match(await tool('read').run({ path: second.path }, ctx()), /вторая версия/);
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

    it('геопозиция в system: координаты → город; без координат — запрет выводить город из tz', async () => {
        const place = await WORK.get_item('/BOX');
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, json: async () => ({ address: { city: 'Рязань', state: 'Рязанская область', country: 'Россия' } }) });
        try {
            const withGeo = await (await createEnv({ place, host: { mode: 'auto' }, location: { lat: 54.6281, lon: 39.7457, tz: 'Europe/Moscow' } })).makeSystem();
            assert.match(withGeo, /Рязань/);
            assert.match(withGeo, /54\.6281, 39\.7457/);
        }
        finally {
            globalThis.fetch = realFetch;
        }
        const noGeo = await (await createEnv({ place, host: { mode: 'auto' }, location: { tz: 'Europe/Moscow' } })).makeSystem();
        assert.match(noGeo, /Местоположение пользователя неизвестно/);
        assert.match(noGeo, /Не выводи город из часового пояса/);
        assert.doesNotMatch(noGeo, /Местоположение пользователя: \d/);
    });

    it('роль USER в system: запрет искать os_/net_ и поручать их субагенту', async () => {
        const place = await WORK.get_item('/BOX');
        const sys = await (await createEnv({ place, host: { mode: 'auto' }, role: 'USER' })).makeSystem();
        assert.match(sys, /запустить в роли ADMIN/);
        assert.match(sys, /os_\*\/net_\*\/shell у тебя нет в списке/);
        assert.match(sys, /не поручай такую работу субагенту/);
    });

    it('субагент в роли USER не получает net_/os_/shell сверх набора (делегирование не эскалирует)', async () => {
        const place = await WORK.get_item('/BOX');
        const env = await createEnv({ place, host: { mode: 'auto' }, role: 'USER' });
        const tools = await env.makeTools({ name: 'it-admin', meta: { tools: 'os_*, net_*, shell, ls, read, find, write, access, call' } }, 1);
        assert.ok(!tools.some(t => t.name.startsWith('net_') || t.name.startsWith('os_') || t.name === 'shell'));
        assert.ok(tools.some(t => t.name === 'ls'));
        const { metaTools } = await import('../sources/modules/agent/tools/meta.js');
        assert.match(metaTools.find(t => t.name === 'task').description, /той же роли задачи/);
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
    it('продолжимый субагент: отдельная задача, сообщение после завершения, статус и остановка', async () => {
        const parent = await newTask('parent-child');
        const point = await WORK.get_item('/BOX');
        const user = await (await WORK.$users).get_item('//' + CHILD_UID);
        const actor = { uid: CHILD_UID, $user: user, principal: { kind: 'user', id: CHILD_UID }, send() {} };
        const env = await createEnv({ place: point, session: actor, host: mkHost(), role: 'USER' });
        const ctx = { task: parent, session: actor, role: 'USER', place: point, env, depth: 0,
            entry: {}, llm: { name: '/MODELS/mock' } };
        globalThis.__MOCK_STREAM__ = scripted([{ text: 'Первый отчёт' }, { text: 'Второй отчёт' }]).stream;
        const start = metaTools.find(t => t.name === 'agent_start');
        const result = await start.run({ agent: 'general', prompt: 'Исследуй /BOX', description: 'Долгая работа' }, ctx);
        assert.match(result, /Продолжимый агент/);
        assert.match(ctx.entry.path, new RegExp('\\.' + CHILD_UID + '\\.task$'));
        const child = await WORK.get_item(ctx.entry.path);
        await session.idle(child);
        const body = await session.getBody(child);
        assert.equal(body.parentTask, parent.path);
        assert.equal(body.ownerUid, CHILD_UID);
        assert.equal(body.childAgent, 'general');
        assert.equal(body.role, 'USER');
        assert.equal(body.items.at(-1).content, 'Первый отчёт');
        const status = metaTools.find(t => t.name === 'agent_status');
        assert.equal((await status.run({ path: child.path }, ctx)).status, 'idle');
        assert.match((await status.run({ path: child.path }, ctx)).last, /Первый отчёт/);
        await metaTools.find(t => t.name === 'agent_message').run({ path: child.path, prompt: 'Добавь подробности' }, ctx);
        await session.idle(child);
        assert.equal((await session.getBody(child)).items.at(-1).content, 'Второй отчёт');
        await metaTools.find(t => t.name === 'agent_stop').run({ path: child.path }, ctx);
        assert.equal((await session.getBody(child)).status, 'stopped');
        await assert.rejects(() => status.run({ path: parent.path }, ctx), /не принадлежит|не найдена/);
        const anotherParent = await newTask('other-parent');
        const outsider = { ...ctx, task: anotherParent };
        await assert.rejects(() => status.run({ path: child.path }, outsider), /не принадлежит/);
    });
    it('после рестарта находит задачи только в рабочей зоне, не в history', async () => {
        const rel = 'RECOVERY/$class/USER/task/2026-10-01/1790800000000.EU00000000000001.task';
        write(rel, JSON.stringify({ version: 2, status: 'running', items: [] }));
        write('RECOVERY/doc/history/task/2026-10-01/1790800000001.EU00000000000001.task', JSON.stringify({ version: 2, status: 'running' }));
        const pending = await findPendingTasks(tmp);
        assert.ok(pending.some(t => t.path === '/' + rel.replaceAll('\\', '/') && t.uid === 'EU00000000000001'));
        assert.ok(!pending.some(t => t.path.includes('/history/')));
    });

    it('не повторяет после рестарта начатое изменяющее действие: нужна ручная проверка', async () => {
        const rel = 'RECOVERY/$class/USER/task/2026-10-01/1790800000002.EU00000000000001.task';
        write(rel, JSON.stringify({ version: 2, status: 'running', items: [
            { id: 'a1', type: 'assistant', content: '', tools: [{ id: 'send1', name: 'send', status: 'running', args: { message: 'письмо' } }] },
        ] }));
        const file = { dir: path.join(tmp, rel), path: '/' + rel, short: '/' + rel,
            load: ({ encoding }) => fsp.readFile(file.dir, encoding), reset() {} };
        const old = process.env.WORK_TEST;
        process.env.WORK_TEST = '1';
        try {
            const res = await session.recover(file, { uid: 'EU00000000000001', send() {} });
            assert.equal(res.status, 'needs_review');
            const body = await session.getBody(file);
            assert.equal(body.status, 'needs_review');
            assert.equal(body.items[0].tools[0].status, 'interrupted');
            assert.match(body.items.at(-1).content, /НЕ повторено автоматически/);
            assert.match((await session.prompt(file, { prompt: '' })).error, /Сначала проверьте результат/);
        }
        finally { if (old == null) delete process.env.WORK_TEST; else process.env.WORK_TEST = old; }
    });

    it('сохраняет ожидание вопроса после рестарта, не запускает модель заново', async () => {
        const rel = 'RECOVERY/$class/USER/task/2026-10-01/1790800000003.EU00000000000001.task';
        write(rel, JSON.stringify({ version: 2, status: 'waiting', waiting: { kind: 'question', call: 'q1', item: 'a1' }, items: [
            { id: 'a1', type: 'assistant', tools: [{ id: 'q1', name: 'ask_user', status: 'waiting', args: { question: 'Какой город?' } }] },
        ] }));
        const file = { dir: path.join(tmp, rel), path: '/' + rel, short: '/' + rel,
            load: ({ encoding }) => fsp.readFile(file.dir, encoding), reset() {} };
        const old = process.env.WORK_TEST;
        process.env.WORK_TEST = '1';
        try {
            const res = await session.recover(file, { uid: 'EU00000000000001', send() {} });
            assert.equal(res.status, 'waiting');
            assert.equal((await session.getBody(file)).waiting.call, 'q1');
            assert.equal((await session.message(file, { session: { uid: CHILD_UID }, prompt: 'дополнительный контекст' })).queued, true);
            assert.equal((await session.getBody(file)).waiting.call, 'q1');
            assert.equal((await session.getBody(file)).queue[0].content, 'дополнительный контекст');
        }
        finally { if (old == null) delete process.env.WORK_TEST; else process.env.WORK_TEST = old; }
    });

    it('publish: отметить/снять/посмотреть результаты; чужой снимок отклоняется', async () => {
        const writeTool = workTools.find(t => t.name === 'write');
        const wc = { entry: {}, place: null };
        await writeTool.run({ path: '/BOX/doc/pub2.md', content: 'итог' }, wc);
        const snap = wc.entry.snapshot;
        const rel = 'RECOVERY/$class/USER/task/2026-10-01/1790800000005.EU00000000000001.task';
        write(rel, JSON.stringify({ version: 2, status: 'idle', items: [
            { id: 'a1', type: 'assistant', content: '', time: 1, tools: [
                { id: 'w1', name: 'write', status: 'ok', path: '/BOX/doc/pub2.md', snapshot: snap },
            ] },
        ] }));
        const file = { dir: path.join(tmp, rel), path: '/' + rel, short: '/' + rel,
            load: ({ encoding }) => fsp.readFile(file.dir, encoding), reset() {} };
        const publish = metaTools.find(t => t.name === 'publish');
        const pctx = { task: file, session: { uid: CHILD_UID }, entry: {} };
        await assert.rejects(
            () => publish.run({ snapshot: '/BOX/doc/.x.md/history/2026-10-01/1.X.md' }, pctx), /не из этой задачи/);
        await publish.run({ snapshot: snap, title: 'Итог' }, pctx);
        await publish.run({ snapshot: snap }, pctx);
        assert.equal((await session.getBody(file)).results.length, 1);
        assert.match(await publish.run({ action: 'list' }, pctx), /Итог/);
        assert.match(await publish.run({ snapshot: snap, action: 'remove' }, pctx), /не отмечены/);
        assert.equal((await session.getBody(file)).results.length, 0);
    });

    it('завершение публикует результаты в запись задачи (владелец и кабинет)', async () => {
        const calls = [];
        const owner = { path: '/BOX', append_log_includes: async p => { calls.push(['owner', p]); return { includes: p.includePaths }; } };
        const cab = { path: '/USERS//X', append_log_includes: async p => { calls.push(['cab', p]); return { includes: p.includePaths }; } };
        const rel = 'RECOVERY/$class/USER/task/2026-10-01/1790800000006.EU00000000000001.task';
        write(rel, JSON.stringify({ version: 2, status: 'idle', items: [] }));
        const file = { dir: path.join(tmp, rel), path: '/' + rel, short: '/' + rel,
            load: ({ encoding }) => fsp.readFile(file.dir, encoding), reset() {}, $owner: owner };
        const ses = { uid: 'X', $user: cab };
        await session.addTaskResult(file, { snapshot: '/S/1.md', title: 'Один' }, ses);
        await session.addTaskResult(file, { snapshot: '/S/2.md' }, ses);
        assert.equal(await session.publishTaskResults(file, ses), 2);
        assert.equal(calls.length, 2);
        for (const [, p] of calls) {
            assert.equal(p.entryPath, file.path);
            assert.deepEqual(p.includePaths, ['/S/1.md', '/S/2.md']);
        }
        const bare = { path: '/RECOVERY/other.task', $owner: owner };
        assert.equal(await session.publishTaskResults(bare, ses), 0);
        assert.equal(calls.length, 2);
    });

    it('автоматически продолжает безопасный ход с сохранённой задачей', async () => {
        const rel = 'RECOVERY/$class/USER/task/2026-10-01/1790800000004.EU00000000000001.task';
        write(rel, JSON.stringify({ version: 2, status: 'running', model: '/MODELS/mock', items: [
            { id: 'u1', type: 'user', content: 'продолжи' },
            { id: 'a1', type: 'assistant', content: '', tools: [{ id: 'read1', name: 'read', status: 'running', args: { path: '/BOX/doc/note.md' } }] },
        ] }));
        const file = { dir: path.join(tmp, rel), path: '/' + rel, short: '/' + rel,
            load: ({ encoding }) => fsp.readFile(file.dir, encoding), reset() {} };
        const old = process.env.WORK_TEST;
        process.env.WORK_TEST = '1';
        globalThis.__MOCK_STREAM__ = scripted([{ text: 'Продолжено после рестарта' }]).stream;
        try {
            assert.equal((await session.recover(file, { uid: CHILD_UID, send() {} })).status, 'resumed');
            await session.idle(file);
            const body = await session.getBody(file);
            assert.equal(body.status, 'idle');
            assert.equal(body.items[1].tools[0].status, 'interrupted');
            assert.equal(body.items.at(-1).content, 'Продолжено после рестарта');
        }
        finally { if (old == null) delete process.env.WORK_TEST; else process.env.WORK_TEST = old; }
    });
    async function newTask(name) {
        const box = await WORK.get_item('/BOX');
        // .task — файл данных: ядро само кладёт его в {папка}/{день}/{время}.{uid}.task
        const log = await box.meta_folder.save_file({ folder: 'USER', filename: name + '.task', post: JSON.stringify({ name, items: [] }), skip_file_handler: true });
        const file = await WORK.get_item(log.logFullPath || log.path);
        assert.ok(file, 'файл задачи: ' + JSON.stringify(log));
        await file.init;
        return file;
    }

    it('prompt → фон → ответ на диске; замок — пустой prompt во время работы «занят»', async () => {
        const file = await newTask('t1');
        globalThis.__MOCK_STREAM__ = scripted([{ text: 'Готово.', delayMs: 2 }]).stream;
        assert.equal((await session.prompt(file, { prompt: 'сделай' })).ok, true);
        const busy = await session.prompt(file, { prompt: '' });
        assert.equal(busy.busy, true); // пустая реплика во время работы — «занят»; с текстом — очередь (тест ниже)
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

    it('реплика во время работы — в очередь, агент получает её следующим ходом', async () => {
        const file = await newTask('t5');
        const seen = [];
        let release;
        const gate = new Promise(r => release = r);
        globalThis.__MOCK_STREAM__ = (req) => (async function* () {
            seen.push(req.messages.filter(m => m.role === 'user').map(m => m.content));
            if (seen.length === 1) {
                await gate;
                yield { type: 'tool_calls', calls: [{ id: 'x1', name: 'ls', arguments: { path: '/BOX' } }] };
                return;
            }
            yield 'учёл: ' + req.messages.filter(m => m.role === 'user').at(-1).content;
        })();
        await session.prompt(file, { prompt: 'первое' });
        const q = await session.prompt(file, { prompt: 'и ещё вот это' });
        assert.equal(q.queued, true);
        release();
        const body = await session.idle(file);
        assert.ok(!body.queue);
        assert.deepEqual(seen[1], ['первое', 'и ещё вот это']);
        assert.equal(body.items.at(-1).content, 'учёл: и ещё вот это');
    });

    it('картинка во вложении уходит модели только при vision', async () => {
        const { toMessages } = await import('../sources/modules/agent/loop.js');
        const items = [{ id: 'u', type: 'user', content: 'что на фото', attachments: [{ path: '/BOX/a.png', name: 'a.png' }] }];
        const plain = toMessages('', items);
        assert.equal(typeof plain[0].content, 'string');
        const withImg = toMessages('', items, new Map([['/BOX/a.png', 'data:image/png;base64,AAA']]));
        assert.equal(withImg[0].content[1].image_url.url, 'data:image/png;base64,AAA');
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
