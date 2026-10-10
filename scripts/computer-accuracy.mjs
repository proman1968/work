/**
 * Проверка точности управления экраном живой моделью (тратит вызовы модели!).
 *   node scripts/computer-accuracy.mjs [model=/MODELS/odant/Qwen3.8 27b]
 * Сценарий: на свежем work-computer открыт терминал; модель должна набрать
 * `echo hello-123`, нажать Enter и подтвердить результат скриншотом.
 * Успех оценивает человек по скриншотам (сохраняются в accuracy-*.png).
 */
import '../sources/reactor.js';
import fs from 'node:fs';
import { $server } from '../sources/server/server.js';
import { createEnv, llmFor, DEFAULT_MODEL } from '../sources/modules/agent/index.js';
import { runLoop } from '../sources/modules/agent/loop.js';

const modelPath = process.argv[2] || DEFAULT_MODEL;
globalThis.WORK = new $server();
await WORK.children;

const session = { uid: 'eval' };
const place = await WORK.get_item('/USERS').catch(() => WORK);
const env = await createEnv({ place, session, host: { mode: 'auto' } });
const all = await env.makeTools();
const tools = all.filter(t => t.name.startsWith('computer_') || t.name.startsWith('sandbox_'));
console.log('tools:', tools.map(t => t.name).join(', '));
const llm = await llmFor(modelPath);
console.log('model:', llm.name, 'vision:', llm.vision, 'context:', llm.contextTokens);

const host = {
    mode: 'auto', signal: new AbortController().signal, allowed: new Set(),
    save: async () => {}, emit: () => {},
};
const items = [{
    id: 'u0', type: 'user', time: Date.now(),
    content: 'На твоём компьютере (work-computer) открыт терминал на весь экран. '
        + 'Задача: набери в нём команду `echo hello-123` и нажми Enter. '
        + 'Сначала сделай computer_screenshot и целься по нему (координаты — пиксели 1280×800). '
        + 'Текст вводи только латиницей через type, Enter — через key. '
        + 'После ввода сделай ещё скриншот и напиши, видишь ли строку hello-123 в терминале.',
}];
const res = await runLoop({
    llm, system: () => env.makeSystem(), items, tools, host,
    ctx: { session, place, env }, loadImage: env.loadImage, maxTurns: 12,
});
let shots = 0;
for (const it of items) {
    if (it.type === 'assistant' && it.content)
        console.log('🤖 ' + it.content.slice(0, 500));
    for (const t of it.tools || []) {
        console.log('  ⚙ ' + t.name + ' ' + JSON.stringify(t.args).slice(0, 160) + ' → ' + t.status + (t.error ? ': ' + t.error.slice(0, 200) : ''));
        for (const s of t.images || []) {
            shots++;
            fs.writeFileSync('accuracy-' + shots + '.png', Buffer.from(s.url.split(',')[1], 'base64'));
        }
    }
}
console.log('статус:', res.status, '| скриншотов сохранено:', shots);
