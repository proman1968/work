// Консольный запуск сценариев из test/experiments.js (те же, что в браузерном стенде index.html).
// node test/bench.mjs --only=M1,R2 [--seed=1] [--seeds=3] [--ste | --cfg='{...}'] [параметры теста]
// Параметры: --steps --maxd --layers --emb (M1); --lines --epochs --layers --modes (R2); --nobptt --bpttK
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebGpu } from '../src/core/web-gpu.js';
import { LLM } from '../src/core/llm.js';
import { createExperiments, withSeed, DEFAULT_STE } from './experiments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
}));
const seeds = Number(args.seeds ?? 1);
const seed0 = Number(args.seed ?? 1);
args.cfg = args.cfg ? JSON.parse(args.cfg) : (args.ste ? DEFAULT_STE : {});

const files = { sample: '../dataset/sample.txt', corpus: '../dataset/text_corpus.txt' };
// Слои создают папку модели в конструкторе — держим ее во временной и удаляем на выходе
const tmpRoot = path.join(os.tmpdir(), 'binnet-bench-' + process.pid);
const gpu = await WebGpu.create();
const tests = createExperiments({
    gpu, LLM,
    loadText: (name) => fsp.readFile(path.join(__dirname, files[name]), 'utf-8'),
    folder: path.join(tmpRoot, 'none'),
    onProgress: args.verbose ? (t) => console.log('  ' + t) : () => {},
});

const names = args.only ? String(args.only).split(',') : ['S1', 'S2', 'S6', 'S7', 'R1'];
const summary = {};
for (const name of names) {
    summary[name] = [];
    for (let s = 0; s < seeds; s++) {
        const t0 = performance.now();
        let r;
        try { r = await withSeed(seed0 + s, () => tests[name](args)); }
        catch (e) { r = { pass: false, details: 'ОШИБКА: ' + (e.stack || e.message) }; }
        const sec = ((performance.now() - t0) / 1000).toFixed(1);
        summary[name].push(r);
        console.log(`${r.pass ? 'PASS' : 'FAIL'} ${name} seed=${seed0 + s} ${sec}s ${r.tps ? Math.round(r.tps) + ' tok/s' : ''} — ${r.details}`);
    }
}
if (seeds > 1) {
    console.log('\nИтог по зернам:');
    for (const [name, rs] of Object.entries(summary)) {
        const passed = rs.filter(r => r.pass).length;
        const acc = rs.reduce((s, r) => s + (r.acc ?? 0), 0) / rs.length;
        console.log(`${name}: ${passed}/${rs.length} PASS, метрика ${acc.toFixed(3)}`);
    }
}
await fsp.rm(tmpRoot, { recursive: true, force: true });
process.exit(0);
