/**
 * Прогон эталонных задач агента (tests/eval/cases.js) на настоящей модели в изолированной песочнице:
 * копия $server (типы, пакет ai) и MODELS (с ключами) во временную папку + файлы задачи.
 * Рабочее дерево WORK не трогается.
 *
 *   node scripts/agent-eval.mjs [--model /MODELS/odant/Qwen3.8 27b] [--case delegate] [--keep]
 *
 * Итог — таблица задач (ok/fail, какие проверки не прошли, ходов, время) и файл
 * .index/eval/<дата>.json для сравнения моделей и версий промптов.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('case');
const model = opt('model');
const keep = args.includes('--keep');

process.env.WORK_TEST ??= '1';
process.env.WORK_AUDIT = '0';

const SKIP = /[\\/](node_modules|history|logs|\.RAG|\.index)([\\/]|$)/;

async function copyTree(from, to) {
    await fsp.cp(from, to, { recursive: true, filter: src => !SKIP.test(src) });
}

function write(root, rel, content) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function walk(dir, base = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p, base) : [path.relative(base, p).replace(/\\/g, '/')];
    });
}

function toolsCalled(items) {
    const out = [];
    for (const it of items || [])
        for (const t of it.tools || []) {
            out.push({ name: t.name, status: t.status, error: t.error });
            out.push(...toolsCalled(t.items));
        }
    return out;
}

async function runCase(c, imports) {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-eval-'));
    const prev = process.cwd();
    await copyTree(path.join(ROOT, '$server'), path.join(tmp, '$server'));
    await copyTree(path.join(ROOT, 'MODELS'), path.join(tmp, 'MODELS'));
    for (const [rel, content] of Object.entries(c.files || {}))
        write(tmp, rel, content);
    process.chdir(tmp);
    const t0 = Date.now();
    const result = { name: c.name, about: c.about, failed: [], tools: [], ms: 0 };
    try {
        globalThis.WORK = new imports.$server();
        await WORK.children;
        if (c.rag) {
            const indexer = await import('../sources/modules/rag/indexer.js');
            await indexer.indexPath('/' + c.place.split('/').filter(Boolean)[0], {});
            indexer.start({ watch: false, reconcileDelayMs: 1e9 });
            indexer.invalidate('.' + c.place);
            while (indexer.status().queue || indexer.status().running)
                await new Promise(r => setTimeout(r, 200));
        }
        const place = await WORK.get_item(c.place);
        const user = await (await WORK.$users).get_item('//' + c.as);
        const session = { uid: c.as, $user: user, principal: { kind: 'user', id: c.as } };
        const res = await imports.runOnce({ place, session, prompt: c.prompt, model, signal: AbortSignal.timeout(10 * 60_000) });
        const calls = toolsCalled(res.items);
        result.tools = calls.map(t => t.name + (t.status !== 'ok' ? '(' + t.status + ')' : ''));
        result.toolErrors = calls.filter(t => t.error).map(t => t.name + ': ' + String(t.error).slice(0, 300));
        result.turns = res.items.filter(i => i.type === 'assistant').length;
        result.answer = res.content;
        const files = walk(tmp);
        for (const ch of c.checks) {
            let ok = true, why = '';
            if (ch.status) { ok = res.status === ch.status; why = 'статус ' + res.status; }
            else if (ch.tool) { ok = calls.some(t => t.name === ch.tool && t.status === 'ok'); why = 'не вызван ' + ch.tool; }
            else if (ch.noTool) { ok = !calls.some(t => t.name === ch.noTool); why = 'вызван ' + ch.noTool; }
            else if (ch.answer) { ok = ch.answer.test(res.content || ''); why = 'ответ не содержит ' + ch.answer; }
            else if (ch.noAnswer) { ok = !ch.noAnswer.test(res.content || ''); why = 'ответ содержит ' + ch.noAnswer; }
            else if (ch.file) {
                const hit = files.filter(f => ch.file.test(f));
                ok = hit.length > 0 && (!ch.match || hit.some(f => ch.match.test(fs.readFileSync(path.join(tmp, f), 'utf-8'))));
                why = 'нет файла ' + ch.file + (ch.match ? ' с ' + ch.match : '');
            }
            else if (ch.feed) {
                const dir = path.join(tmp, ch.feed, fs.readdirSync(path.join(tmp, ch.feed)).find(n => n[0] === '$') || '', 'logs');
                const texts = fs.existsSync(dir) ? walk(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf-8')) : [];
                ok = texts.some(t => ch.match.test(t));
                why = 'нет записи в ленте ' + ch.feed + ' по ' + ch.match;
            }
            if (!ok)
                result.failed.push(why);
        }
    }
    catch (e) {
        result.failed.push('исключение: ' + (e?.message || e));
    }
    finally {
        result.ms = Date.now() - t0;
        process.chdir(prev);
        if (!keep)
            await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
        else
            result.sandbox = tmp;
    }
    return result;
}

await import('../sources/reactor.js');
await import('../sources/server/index.js');
const imports = {
    $server: (await import('../sources/server/server.js')).$server,
    runOnce: (await import('../sources/modules/agent/index.js')).runOnce,
};
const { CASES } = await import('../tests/eval/cases.js');
const list = CASES.filter(c => !only || c.name === only);
if (!list.length) {
    console.error('нет задачи ' + only + '; есть: ' + CASES.map(c => c.name).join(', '));
    process.exit(2);
}
const results = [];
for (const c of list) {
    process.stdout.write('▶ ' + c.name + ' … ');
    const r = await runCase(c, imports);
    results.push(r);
    console.log(r.failed.length ? 'FAIL' : 'ok', '(' + Math.round(r.ms / 1000) + ' с, ходов ' + (r.turns ?? '?') + ', инструменты: ' + (r.tools.join(', ') || '—') + ')');
    for (const f of r.failed)
        console.log('    ✗ ' + f);
    for (const e of r.toolErrors || [])
        console.log('    ! ' + e);
}
const passed = results.filter(r => !r.failed.length).length;
console.log('\nИтог: ' + passed + '/' + results.length + (model ? ' — модель ' + model : ''));
const outDir = path.join(ROOT, '.index', 'eval');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
fs.writeFileSync(out, JSON.stringify({ model: model || 'по умолчанию', at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
console.log('Результаты: ' + out);
process.exit(passed === results.length ? 0 : 1);
