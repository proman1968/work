import fsp from "node:fs/promises";
import readline from 'readline';
import { WebGpu } from './src/core/web-gpu.js';
import { LLM } from './src/core/llm.js';

// Принудительно заставляем консоль Node.js выводить UTF-8 без кракозябр
if (process.stdout.setEncoding) 
    process.stdout.setEncoding('utf-8');

const gpu = await WebGpu.create();
const config = { gpu, embSize: 32, vocabSize: 2 ** 15, layersCount: 1, testMode: false};
config.folder = `./models/mamba/${config.embSize}-${config.layersCount}-${config.vocabSize}`;
const model = new LLM(config);
await model.load();
console.log("paramCount", model.paramCount.toLocaleString());
let corpus = await fsp.readFile('./dataset/sample.txt', 'utf-8');
// let corpus = await fsp.readFile('./dataset/text_corpus.txt', 'utf-8');
// for(let i = 0; i < 5; i++)
    await model.trainEmbedding(corpus);
await model.train(corpus)
console.log("paramCount", model.paramCount.toLocaleString());
// Генерация текста
// const generated = await model.generate("Hello", 50);
// console.log(generated);