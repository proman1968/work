/**
 * Прогон эталонных задач агента (tests/eval/cases.js, 15 направлений scorecard) на настоящей модели
 * в изолированной песочнице и сравнение версий «до/после» (9.14):
 *
 *   npm run eval -- [--model "/MODELS/odant/Qwen3.8 27b"] [--dimension 13] [--case delegate] [--baseline before.json]
 *   npm run eval -- --compare .index/eval/before.json .index/eval/after.json
 *
 * Итог — таблица задач, сводка по 15 направлениям, время (общая/средняя), токены и стоимость в $
 * (из тарифов модели pricing или --price-in / --price-out), плюс сохранение в .index/eval/<дата>.json.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { summarizeEvalRun, compareEvalRuns, formatEvalSummary, formatEvalComparison } from '../sources/modules/agent/eval.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('case');
const onlyDim = opt('dimension') ? Number(opt('dimension')) : undefined;
const model = opt('model');
const baselineFile = opt('baseline');
const priceIn = opt('price-in');
const priceOut = opt('price-out');
const keep = args.includes('--keep');

const cmpIdx = args.indexOf('--compare');
if (cmpIdx >= 0) {
    const f1 = args[cmpIdx + 1];
    const f2 = args[cmpIdx + 2];
    if (!f1 || !f2) {
        console.error('Использование: node scripts/agent-eval.mjs --compare <до.json> <после.json>');
        process.exit(2);
    }
    const beforeRun = JSON.parse(fs.readFileSync(path.resolve(f1), 'utf-8'));
    const afterRun = JSON.parse(fs.readFileSync(path.resolve(f2), 'utf-8'));
    const diff = compareEvalRuns(beforeRun, afterRun);
    console.log(formatEvalComparison(diff));
    process.exit(diff.regressions.length ? 1 : 0);
}

process.env.WORK_TEST ??= '1';
process.env.WORK_AUDIT = '0';
// общий кэш моделей эмбеддингов между прогонами (иначе каждый прогон качал бы сотни МБ)
process.env.WORK_RAG_CACHE ??= path.join(os.tmpdir(), 'opencode', 'work-hf-cache');

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

/** usage всех ответов ленты (включая вложенные ленты субагентов) — для замера стоимости и доли кэша. */
function usageOf(items, acc = { prompt: 0, completion: 0, cached: 0, cacheWrite: 0, cost: 0, answers: 0 }) {
    for (const it of items || []) {
        if (it?.type === 'assistant' && it.usage?.prompt) {
            acc.prompt += Number(it.usage.prompt) || 0;
            acc.completion += Number(it.usage.completion) || 0;
            acc.cached += Number(it.usage.cached) || 0;
            acc.cacheWrite += Number(it.usage.cacheWrite) || 0;
            acc.cost += Number(it.usage.cost) || 0;
            acc.answers++;
        }
        for (const t of it?.tools || [])
            usageOf(t.items, acc);
    }
    return acc;
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
    const result = { name: c.name, dimension: c.dimension || 1, about: c.about, failed: [], tools: [], ms: 0 };
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
        const u = usageOf(res.items);
        if (u.answers) {
            result.tokens = { prompt: u.prompt, completion: u.completion, cached: u.cached, cacheWrite: u.cacheWrite, answers: u.answers };
            if (u.cost > 0)
                result.costUsd = +u.cost.toFixed(6);
        }
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
            else if (ch.noFile) {
                ok = !files.some(f => ch.noFile.test(f));
                why = 'есть файл ' + ch.noFile;
            }
            else if (ch.toolDenied) {
                ok = !calls.some(x => x.name === ch.toolDenied && x.status === 'ok');
                why = ch.toolDenied + ' выполнен без подтверждения';
            }
            else if (ch.feedNone) {
                const dir = path.join(tmp, ch.feedNone.feed, fs.existsSync(path.join(tmp, ch.feedNone.feed)) ? (fs.readdirSync(path.join(tmp, ch.feedNone.feed)).find(n => n[0] === '$') || '') : '', 'logs');
                const texts = fs.existsSync(dir) ? walk(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf-8')) : [];
                ok = !texts.some(x => ch.feedNone.match.test(x));
                why = 'в ленте ' + ch.feedNone.feed + ' есть запись по ' + ch.feedNone.match;
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
const list = CASES.filter(c => (!only || c.name === only) && (!onlyDim || Number(c.dimension) === onlyDim));
if (!list.length) {
    console.error('нет подходящих задач; есть: ' + CASES.map(c => c.name + '[' + c.dimension + ']').join(', '));
    process.exit(2);
}
const results = [];
for (const c of list) {
    process.stdout.write('▶ [' + c.dimension + '] ' + c.name + ' … ');
    const r = await runCase(c, imports);
    results.push(r);
    console.log(r.failed.length ? 'FAIL' : 'ok', '(' + Math.round(r.ms / 1000) + ' с, ходов ' + (r.turns ?? '?') + ', инструменты: ' + (r.tools.join(', ') || '—') + ')');
    for (const f of r.failed)
        console.log('    ✗ ' + f);
    for (const e of r.toolErrors || [])
        console.log('    ! ' + e);
}
const pricing = priceIn != null && priceOut != null
    ? { input: Number(priceIn), output: Number(priceOut) }
    : null;
const summary = summarizeEvalRun(results, { model: model || 'по умолчанию', pricing });
console.log('\n' + formatEvalSummary(summary));

const outDir = path.join(ROOT, '.index', 'eval');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log('\nРезультаты: ' + out);

if (baselineFile) {
    const beforeRun = JSON.parse(fs.readFileSync(path.resolve(baselineFile), 'utf-8'));
    const diff = compareEvalRuns(beforeRun, summary);
    console.log('\n' + formatEvalComparison(diff));
    if (diff.regressions.length)
        process.exit(1);
}
process.exit(summary.passed === summary.total ? 0 : 1);
