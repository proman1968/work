/**
 * Журнал безопасности: вход/выход, регистрация, отказы в доступе, действия ADMIN, запросы узлов сети.
 * JSON Lines по дням в `.index/audit/YYYY-MM-DD.jsonl` (вне дерева WORK, не индексируется и не отдаётся по HTTP).
 * Запись асинхронная и не должна ронять основной вызов.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join('.index', 'audit');
let queue = Promise.resolve();

function subjectOf(params) {
    const s = params?.session;
    if (!s)
        return { subject: 'system' };
    if (s.$user === globalThis.WORK)
        return { subject: 'WORK' };
    const p = s.principal;
    return {
        subject: p?.id || s.uid || 'anonymous',
        kind: p?.kind || (s.uid ? 'user' : 'anonymous'),
        actor: p?.actor,
        role: params.role,
        ip: s.ip,
    };
}

/**
 * @param {string} event deny | admin | login | login_fail | register | logout | node | …
 * @param {object} [data] {path, method, reason, params, …}
 */
export function audit(event, data = {}) {
    const { params, ...rest } = data;
    const row = { time: new Date().toISOString(), event, ...subjectOf(params), ...rest };
    if (process.env.WORK_AUDIT === '0')
        return;
    queue = queue.then(async () => {
        try {
            await fs.promises.mkdir(DIR, { recursive: true });
            await fs.promises.appendFile(path.join(DIR, row.time.slice(0, 10) + '.jsonl'), JSON.stringify(row) + '\n');
        }
        catch { /* журнал не должен ронять вызов */ }
    });
}

/** Записи журнала за день (по убыванию времени). */
export async function readAudit(day = new Date().toISOString().slice(0, 10), limit = 500) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
        throw new Error('day: YYYY-MM-DD');
    await queue;
    try {
        const text = await fs.promises.readFile(path.join(DIR, day + '.jsonl'), 'utf-8');
        return text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).reverse().slice(0, limit);
    }
    catch {
        return [];
    }
}
