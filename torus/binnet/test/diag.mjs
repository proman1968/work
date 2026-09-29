// Диагностика STE: сколько бит переключается за эпоху по слоям и масштаб градиентов.
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebGpu } from '../src/core/web-gpu.js';
import { LLM } from '../src/core/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfgArg = process.argv.find(a => a.startsWith('--cfg='));
const extra = cfgArg ? JSON.parse(cfgArg.slice(6)) : {};
let s = 1;
Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

const gpu = await WebGpu.create();
const log = console.log; console.log = () => {};
const llm = new LLM(Object.assign({ gpu, vocabSize: 1024, embSize: 8, layersCount: 1, learn: 'ste', folder: path.join(os.tmpdir(), 'binnet-diag', 'none') }, extra));
await llm.load();
console.log = log;
await llm.forward({ tokenIdx: 1, targetIdx: 1 });
const text = (await fsp.readFile(path.join(__dirname, '../dataset/sample.txt'), 'utf-8')).split('\n').filter(l => l.trim());
const train = text.slice(0, Math.floor(text.length * 0.8)).join('\n');

const L = llm.layers[0];
const mats = { emb: llm.embedding.params.embeddings, in: L.projIn.params.weights, forget: L.projForget.params.weights, add: L.projAdd.params.weights, out: L.projOut.params.weights, head: llm.head.params.weights };
const pop = (x) => { x >>>= 0; let c = 0; while (x) { c++; x &= x - 1; } return c; };
async function snap() { const r = {}; for (const [k, v] of Object.entries(mats)) r[k] = Uint32Array.from(await gpu.readData(v)); return r; }
async function density(buf) { const a = await gpu.readData(buf); let c = 0; for (const x of a) c += pop(x); return (c / (a.length * 32)).toFixed(2); }
async function absMean(buf) { const a = await gpu.readData(buf); let s = 0; for (const x of a) s += Math.abs(x); return (s / a.length).toExponential(2); }

for (let ep = 0; ep < 4; ep++) {
    const headOnly = ep < 2;
    const before = await snap();
    const r = await llm.train(train, { epochs: 1, headOnlyEpochs: headOnly ? 1 : 0 });
    const after = await snap();
    const flips = Object.fromEntries(Object.keys(mats).map(k => {
        let d = 0; for (let i = 0; i < before[k].length; i++) d += pop(before[k][i] ^ after[k][i]);
        return [k, (d / (before[k].length * 32) * 100).toFixed(2) + '%'];
    }));
    console.log(`ep${ep} ${headOnly ? 'head' : 'full'} acc=${r.history[0].acc.toFixed(3)} tokens=${r.history[0].tokens}`, flips);
}
console.log('плотность единиц: conv', await density(L.convOutput), 'state', await density(L.mambaMemory.state), 'fg', await density(L.projForget.output), 'add', await density(L.projAdd.output), 'out', await density(L.projOut.output));
console.log('|grad|: head.gIn', await absMean(llm.head.gIn), 'out.gIn', await absMean(L.projOut.gIn), 'forget.gIn', await absMean(L.projForget.gIn), 'add.gIn', await absMean(L.projAdd.gIn), 'in.gIn', await absMean(L.projIn.gIn));
console.log('доля живых ga: out', await (async () => { const a = await gpu.readData(L.projOut.gA); return (a.filter(x => x !== 0).length / a.length).toFixed(2); })());
process.exit(0);
