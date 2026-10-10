/** Подъём .task после рестарта: сканируем рабочие зоны, не трогаем history и системные деревья. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { recover, idle } from './session.js';

const SKIP = new Set(['.git', '.index', '.RAG', 'node_modules', 'history', 'logs', '#secret', '#system', 'sources', 'oda', 'tests', 'scripts']);
const TASK_PATH = /(?:^|\/)task\/\d{4}-\d{2}-\d{2}\/\d+\.([^.\/]+)\.task$/i;

export async function findPendingTasks(root = '.', max = 10_000) {
    const found = [];
    const walk = async rel => {
        if (found.length >= max)
            return;
        let entries;
        try { entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            if (found.length >= max)
                break;
            const next = path.join(rel, e.name);
            if (e.isDirectory() && !e.isSymbolicLink() && !SKIP.has(e.name) && !e.name.startsWith('.'))
                await walk(next);
            else if (e.isFile()) {
                const p = next.replace(/\\/g, '/');
                const match = p.match(TASK_PATH);
                if (!match)
                    continue;
                try {
                    const stat = await fs.stat(path.join(root, next));
                    if (stat.size > 20 * 1024 * 1024)
                        continue;
                    const body = JSON.parse(await fs.readFile(path.join(root, next), 'utf8'));
                    if (body.version !== 2) {
                        if (body.status === 'running' || body.status === 'waiting')
                            console.warn('[agent recovery] unsupported task version', p, body.version);
                        continue;
                    }
                    if (body.status === 'running' || body.status === 'waiting')
                        found.push({ path: '/' + p, uid: match[1], status: body.status });
                }
                catch (err) { console.warn('[agent recovery] unreadable', p, err.message); }
            }
        }
    };
    await walk('');
    return found;
}

/** Запустить ограниченное число восстановленных задач; ожидающие действия не занимают слот. */
export async function recoverTasks({ root = '.', maxActive = 3 } = {}) {
    const jobs = await findPendingTasks(root);
    const queue = jobs.filter(j => j.status === 'running');
    const waiting = jobs.filter(j => j.status === 'waiting');
    const userCache = new Map();
    const restore = async job => {
        const WORK = globalThis.WORK;
        let user = userCache.get(job.uid);
        if (!user) {
            user = await (await WORK.$users)?.get_item('//' + job.uid);
            if (Array.isArray(user)) user = user[0];
            if (!user) throw new Error('пользователь не найден: ' + job.uid);
            userCache.set(job.uid, user);
        }
        const file = await WORK.get_item(job.path);
        if (!file || Array.isArray(file) || typeof file.load !== 'function')
            throw new Error('задача не найдена: ' + job.path);
        let pause;
        const waitingAgain = new Promise(resolve => { pause = resolve; });
        const session = { uid: job.uid, $user: user, principal: Object.freeze({ kind: 'user', id: job.uid }), recovered: true, sockets: {},
            send(event) { if (event.type === 'task.state' && event.status === 'waiting') pause(); } };
        await file.assertAccess({ session }, 'read');
        const outcome = await recover(file, session);
        if (outcome.status === 'resumed')
            await Promise.race([idle(file), waitingAgain]); // ожидающий человека агент не держит слот
        return outcome.status;
    };
    for (const job of waiting)
        restore(job).catch(e => console.warn('[agent recovery]', job.path, e.message));
    let index = 0;
    const next = () => {
        if (index >= queue.length)
            return;
        const job = queue[index++];
        restore(job).catch(e => console.warn('[agent recovery]', job.path, e.message)).finally(next);
    };
    for (let i = 0; i < Math.min(Math.max(1, maxActive), queue.length); i++)
        next();
    return { found: jobs.length, queued: queue.length, waiting: waiting.length };
}
