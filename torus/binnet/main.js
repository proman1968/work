import fsp from "node:fs/promises";
import { WebGpu } from './src/core/web-gpu.js';
import { LLM } from './src/core/llm.js';

// Принудительно заставляем консоль Node.js выводить UTF-8 без кракозябр
if (process.stdout.setEncoding) 
    process.stdout.setEncoding('utf-8');

// node run.mjs --emb=8 --layers=1 --vocab=1024 --corpus=./dataset/sample.txt --epochs=4 --learn=ste --prompt="Квантовая"
const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));

const gpu = await WebGpu.create();
const config = {
    gpu,
    embSize: Number(args.emb ?? 8),
    layersCount: Number(args.layers ?? 1),
    vocabSize: Number(args.vocab ?? 1024),
    learn: args.learn ?? 'ste',
    testMode: false,
    // Настройки STE, подобранные на test/bench.mjs (R2)
    steLr: 1, steInit: 8, resBeta: 1,
    steLrHead: 16, steInitHead: 0,
    steLrEmb: 16, steInitEmb: 0,
};
config.folder = args.folder ?? `./models/mamba/${config.embSize}-${config.layersCount}-${config.vocabSize}${config.learn === 'ste' ? '-ste' : ''}`;
const model = new LLM(config);
await model.load();
console.log("paramCount", model.paramCount.toLocaleString());

const corpus = await fsp.readFile(args.corpus ?? './dataset/sample.txt', 'utf-8');
const epochs = Number(args.epochs ?? 1);
for (let e = 0; e < epochs; e++) {
    const t0 = performance.now();
    const r = await model.train(corpus, { epochs: 1 });
    const h = r.history[0];
    const sec = (performance.now() - t0) / 1000;
    console.log(`эпоха ${e + 1}/${epochs}: acc ${h.acc.toFixed(4)}, токенов ${h.tokens}, ${Math.round(h.tokens / sec)} ток/с`);
}
if (epochs > 0) await model.save();

if (args.prompt) {
    const generated = await model.generate(String(args.prompt), Number(args.len ?? 50));
    console.log(`«${args.prompt}» → «${generated}»`);
}
process.exit(0);
