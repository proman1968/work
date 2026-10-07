/**
 * Живая проверка браузерных инструментов моделью (тратит вызовы модели!).
 *   node scripts/browser-accuracy.mjs [model]
 * Подтверждения (включение сети) принимаются автоматически — только для проверки.
 */
import '../sources/reactor.js';
import { $server } from '../sources/server/server.js';
import { createEnv, llmFor, DEFAULT_MODEL } from '../sources/modules/agent/index.js';
import { runLoop } from '../sources/modules/agent/loop.js';

const modelPath = process.argv[2] || DEFAULT_MODEL;
globalThis.WORK = new $server();
await WORK.children;
const session = { uid: 'eval' };
const place = await WORK.get_item('/USERS').catch(() => WORK);
const env = await createEnv({ place, session, host: { mode: 'auto' } });
const tools = (await env.makeTools()).filter(t => /^(computer_|browser_|sandbox_)/.test(t.name));
const llm = await llmFor(modelPath);
const asked = [];
const host = {
    mode: 'auto', signal: new AbortController().signal, allowed: new Set(),
    save: async () => {}, emit: () => {},
    wait: async req => { asked.push(req.tool + ': ' + (req.reason || '')); return { accept: true }; },
};
const items = [{
    id: 'u0', type: 'user', time: Date.now(),
    content: 'Открой в браузере https://example.com и перейди по единственной ссылке на странице. '
        + 'Скажи заголовок страницы, на которую попал. Используй browser_snapshot и ref, скриншоты не нужны.',
}];
const res = await runLoop({
    llm, system: () => env.makeSystem(), items, tools, host,
    ctx: { session, place, env }, loadImage: env.loadImage, maxTurns: 14,
});
for (const it of items) {
    if (it.type === 'assistant' && it.content)
        console.log('🤖 ' + it.content.slice(0, 400));
    for (const t of it.tools || [])
        console.log('  ⚙ ' + t.name + ' ' + JSON.stringify(t.args).slice(0, 120) + ' → ' + t.status + (t.error ? ': ' + t.error.slice(0, 160) : ''));
}
console.log('подтверждения:', asked);
console.log('статус:', res.status);
