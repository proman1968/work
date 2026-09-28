/**
 * Живой прогон агента через HTTP dev-сервера: создать .task (save_file → on_save → агент), дождаться конца, вывести ленту.
 * node scripts/agent-run.mjs "промпт" [порт=8011] [папка=/USERS/<uid>/$user/USER/task/demo] [таймаут_с=240]
 * Инструмент разработчика (матрица сценариев агента), не часть сервера.
 */
import fs from 'node:fs';
import path from 'node:path';

const [prompt, port = '8011', folder = '/USERS/CA4E097FF6C1D387/$user/USER/task/demo', timeoutS = '240'] = process.argv.slice(2);
if (!prompt) {
    console.log('usage: node scripts/agent-run.mjs "промпт" [порт] [папка] [таймаут_с]');
    process.exit(1);
}
const base = 'http://localhost:' + port;
const url = base + encodeURI(folder) + '?save_file&filename=run.task&prompt=' + encodeURIComponent(prompt);
const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'run', items: [] }) });
const log = await res.json();
const disk = path.join(process.cwd(), decodeURI(log.path));
console.log('task:', log.path);
const t0 = Date.now();
let body;
for (;;) {
    await new Promise(r => setTimeout(r, 1500));
    try {
        body = JSON.parse(fs.readFileSync(disk, 'utf-8'));
    }
    catch { continue; }
    if (body.version === 2 && body.items.length > 1 && !['running'].includes(body.status))
        break;
    if (Date.now() - t0 > Number(timeoutS) * 1000) {
        console.log('ТАЙМАУТ, статус', body.status);
        break;
    }
}
const show = (items, pad = '') => {
    for (const it of items || []) {
        if (it.type === 'user')
            console.log(pad + '👤 ' + it.content);
        else if (it.type === 'assistant') {
            if (it.content)
                console.log(pad + '🤖 ' + it.content.replace(/\n/g, '\n' + pad + '   '));
            for (const t of it.tools || []) {
                console.log(pad + '   ⚙ ' + t.name + ' ' + JSON.stringify(t.args).slice(0, 160) + ' → ' + t.status + (t.error ? ': ' + t.error : '') + (t.result ? ' | ' + String(t.result).replace(/\s+/g, ' ').slice(0, 140) : ''));
                if (t.items)
                    show(t.items, pad + '      ');
            }
        }
        else
            console.log(pad + '[' + it.type + '] ' + String(it.content || '').slice(0, 300));
    }
};
show(body.items);
console.log('статус:', body.status, '| ходов:', body.items.filter(i => i.type === 'assistant').length, '|', Math.round((Date.now() - t0) / 1000) + 'с');
