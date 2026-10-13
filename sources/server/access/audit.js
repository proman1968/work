/**
 * Журнал безопасности: вход/выход, регистрация, отказы в доступе, действия ADMIN, запросы узлов сети.
 * JSON Lines по дням в `.index/audit/YYYY-MM-DD.jsonl` (вне дерева WORK, не индексируется и не отдаётся по HTTP).
 * Запись асинхронная и не должна ронять основной вызов.
 *
 * 8.2: строки связаны цепочкой хешей (правка или удаление строки обнаруживается `verifyAudit`),
 * сбой записи считается и сигнализируется, а выключение журнала (`WORK_AUDIT=0`) вне тестов запрещено.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = path.join('.index', 'audit');
let queue = Promise.resolve();
let failures = 0;
/** последний хеш дня (продолжение цепочки после рестарта процесса) */
const chains = new Map();

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const fileOfDay = day => path.join(DIR, day + '.jsonl');

async function lastHashOfDay(day) {
    if (chains.has(day))
        return chains.get(day);
    let prev = null;
    try {
        const text = await fs.promises.readFile(fileOfDay(day), 'utf-8');
        const lines = text.split('\n').filter(Boolean);
        const last = lines.at(-1);
        if (last) {
            try { prev = JSON.parse(last).hash || null; } catch { prev = null; }
        }
    }
    catch { /* нового дня ещё нет */ }
    chains.set(day, prev);
    return prev;
}

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

/** Сколько записей не попало в журнал (сигнал «журнал не работает»). */
export function auditFailures() {
    return failures;
}

/**
 * @param {string} event deny | admin | login | login_fail | register | logout | node | …
 * @param {object} [data] {path, method, reason, params, …}
 */
export function audit(event, data = {}) {
    if (process.env.WORK_AUDIT === '0') {
        if (process.env.WORK_TEST === '1')
            return;
        // выключение журнала безопасности — не опция эксплуатации: подмена скрыла бы следы
        throw new Error('журнал безопасности нельзя выключить (WORK_AUDIT=0) вне тестов');
    }
    const { params, ...rest } = data;
    const time = new Date().toISOString();
    const body = { time, event, ...subjectOf(params), ...rest };
    queue = queue.then(async () => {
        try {
            await fs.promises.mkdir(DIR, { recursive: true });
            const day = time.slice(0, 10);
            const row = { ...body, prev: await lastHashOfDay(day) };
            const hash = sha(JSON.stringify(row));
            chains.set(day, hash);
            await fs.promises.appendFile(fileOfDay(day), JSON.stringify({ ...row, hash }) + '\n');
        }
        catch (e) {
            failures++;
            if (failures === 1 || failures % 10 === 0)
                console.warn('[audit] сбой записи журнала безопасности (сбоев: ' + failures + '):', e?.message || e);
        }
    });
}

/**
 * Проверить цепочку хешей дня: каждая строка дословно хешируется и связана с предыдущей.
 * @returns {Promise<{ ok: boolean, lines: number, broken: number|null, reason?: string }>}
 */
export async function verifyAudit(day = new Date().toISOString().slice(0, 10)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
        throw new Error('day: YYYY-MM-DD');
    await queue;
    let text;
    try {
        text = await fs.promises.readFile(fileOfDay(day), 'utf-8');
    }
    catch {
        return { ok: true, lines: 0, broken: null };
    }
    const lines = text.split('\n').filter(Boolean);
    let prev = null;
    for (let i = 0; i < lines.length; i++) {
        let row;
        try {
            row = JSON.parse(lines[i]);
        }
        catch {
            return { ok: false, lines, broken: i, reason: 'строка ' + i + ' не разбирается' };
        }
        const { hash, ...rest } = row;
        if (typeof hash !== 'string' || sha(JSON.stringify(rest)) !== hash)
            return { ok: false, lines: lines.length, broken: i, reason: 'строка ' + i + ' изменена (хеш не сходится)' };
        if ((row.prev || null) !== prev)
            return { ok: false, lines: lines.length, broken: i, reason: 'строка ' + i + ' выпала или вставлена (связь с предыдущей нарушена)' };
        prev = hash;
    }
    return { ok: true, lines: lines.length, broken: null };
}

/** Записи журнала за день (по убыванию времени). */
export async function readAudit(day = new Date().toISOString().slice(0, 10), limit = 500) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
        throw new Error('day: YYYY-MM-DD');
    await queue;
    try {
        const text = await fs.promises.readFile(fileOfDay(day), 'utf-8');
        return text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).reverse().slice(0, limit);
    }
    catch {
        return [];
    }
}
