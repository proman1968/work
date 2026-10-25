// @ts-check
/**
 * Стоимость и бюджеты (9.2):
 *   - тарифы моделей — `pricing: { input, output }` в карточке `MODELS/…` ($ за миллион токенов;
 *     кэш-чтение считается по цене входа — консервативно, тарифов кэша не вводим);
 *   - учёт каждого хода — таблица `agent_usage` в `.index/work.db` (токены и деньги на
 *     задачу/пользователя/место/день); БД недоступна — предупреждение в лог, ход не роняем;
 *   - дневные лимиты — `ai/config.js limits: { dayTokens, dayCost }` ($ и токены на пользователя
 *     в день; ADMIN задаёт в слое; без настройки — лимитов нет): исчерпаны — цикл останавливается
 *     со статусом `limit` и пояснением в ленте;
 *   - дешёвая модель для субагентов (`subagentModel`) и сжатия (`compactModel`) — `ai/config.js`.
 *
 * Списание — из реального `usage` провайдера (loop.js): после каждого хода с ответом модели.
 */
import { log } from './log.js';
import { registerSchema, indexDb } from '../../host/index-db.js';

registerSchema(`CREATE TABLE IF NOT EXISTS agent_usage(
  time INTEGER NOT NULL,
  day TEXT NOT NULL,
  uid TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  task TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  prompt INTEGER NOT NULL DEFAULT 0,
  completion INTEGER NOT NULL DEFAULT 0,
  cached INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS agent_usage_day ON agent_usage(day, uid);`);

/** Стоимость хода в $ (тарифы $/Мток; без тарифа — null: не считаем и не показываем). */
export function costOf(usage, pricing) {
    if (!usage || !pricing || !Number.isFinite(Number(pricing.input)) || !Number.isFinite(Number(pricing.output)))
        return null;
    const inTok = (Number(usage.prompt) || 0) + (Number(usage.cached) || 0); // кэш — по цене входа
    const outTok = Number(usage.completion) || 0;
    return +(inTok / 1e6 * Number(pricing.input) + outTok / 1e6 * Number(pricing.output)).toFixed(6);
}

/** Записать расход хода. Сбой БД не роняет ход: предупреждение, работа продолжается. */
export async function recordUsage({ uid, place, task, model, usage, cost }) {
    if (!usage)
        return;
    try {
        const db = await indexDb();
        if (!db)
            return;
        const day = new Date().toISOString().slice(0, 10);
        db.prepare('INSERT INTO agent_usage(time, day, uid, place, task, model, prompt, completion, cached, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(Date.now(), day,
                String(uid || 'anonymous').slice(0, 64),
                String(place || '').slice(0, 200),
                String(task || '').slice(0, 200),
                String(model || '').slice(0, 200),
                Math.round(Number(usage.prompt) || 0),
                Math.round(Number(usage.completion) || 0),
                Math.round(Number(usage.cached) || 0),
                Number(cost) || 0);
    }
    catch (e) {
        log.warn('учёт стоимости: БД недоступна — расход не записан: ' + String(e?.message || e).slice(0, 120));
    }
}

/**
 * Суммы расхода за период: day ('YYYY-MM-DD') или month ('YYYY-MM-DD'/'YYYY-MM'); uid не задан — по всем.
 * @param {{ day?: string, month?: string, uid?: string }} [opts]
 */
export async function usageTotals({ day, month, uid } = {}) {
    const db = await indexDb();
    if (!db)
        return { tokens: 0, cost: 0, rows: 0 };
    const when = [];
    const args = [];
    if (day) {
        when.push('day = ?');
        args.push(String(day));
    }
    else if (month) {
        when.push('day LIKE ?');
        args.push(String(month).slice(0, 7) + '%');
    }
    else {
        when.push('day = ?');
        args.push(new Date().toISOString().slice(0, 10));
    }
    if (uid) {
        when.push('uid = ?');
        args.push(String(uid));
    }
    try {
        const row = db.prepare('SELECT COUNT(*) AS rows, SUM(prompt + completion + cached) AS tokens, SUM(cost) AS cost FROM agent_usage WHERE ' + when.join(' AND ')).get(...args);
        return { tokens: Number(row?.tokens) || 0, cost: Number(row?.cost) || 0, rows: Number(row?.rows) || 0 };
    }
    catch (e) {
        log.warn('учёт стоимости: чтение не вышло: ' + String(e?.message || e).slice(0, 120));
        return { tokens: 0, cost: 0, rows: 0 };
    }
}

/**
 * Разбивка расхода по пользователям за период (9.3, панель): [{ uid, turns, tokens, cost }].
 * @param {{ day?: string, month?: string, limit?: number }} [opts]
 */
export async function usageByUser({ day, month, limit = 10 } = {}) {
    const db = await indexDb();
    if (!db)
        return [];
    const where = day ? 'day = ?' : 'day LIKE ?';
    const arg = day ? String(day) : (String(month || new Date().toISOString().slice(0, 7)).slice(0, 7) + '%');
    try {
        const rows = db.prepare('SELECT uid, COUNT(*) AS turns, SUM(prompt + completion + cached) AS tokens, SUM(cost) AS cost FROM agent_usage WHERE ' + where + ' GROUP BY uid ORDER BY cost DESC, tokens DESC LIMIT ?')
            .all(arg, Math.min(100, Math.max(1, Number(limit) || 10)));
        return rows.map(r => ({ uid: r.uid, turns: Number(r.turns) || 0, tokens: Number(r.tokens) || 0, cost: Number(r.cost) || 0 }));
    }
    catch (e) {
        log.warn('учёт стоимости: разбивка не вышла: ' + String(e?.message || e).slice(0, 120));
        return [];
    }
}

/**
 * Дневной лимит пользователя (ai/config.js limits: { dayTokens, dayCost }): исчерпан?
 * @returns {Promise<null | { reason: string, spent: { tokens: number, cost: number } }>} null — лимита нет или не исчерпан
 */
export async function budgetExceeded({ config, uid }) {
    const limits = config?.limits || {};
    const dayTokens = Number(limits.dayTokens) || 0;
    const dayCost = Number(limits.dayCost) || 0;
    if (!dayTokens && !dayCost)
        return null;
    const spent = await usageTotals({ uid });
    if (dayTokens && spent.tokens >= dayTokens)
        return { reason: 'дневной лимит токенов (' + dayTokens.toLocaleString('ru-RU') + ') исчерпан (потрачено ' + spent.tokens.toLocaleString('ru-RU') + ') — попросите администратора поднять limits.dayTokens или подождите завтра', spent };
    if (dayCost && spent.cost >= dayCost)
        return { reason: 'дневной лимит стоимости ($' + dayCost + ') исчерпан (потрачено $' + spent.cost.toFixed(2) + ') — попросите администратора поднять limits.dayCost или подождите завтра', spent };
    return null;
}

/** Формат денег для человека: $0.0123 → «$0.0123». */
export function money(cost) {
    return cost == null ? '' : '$' + (+Number(cost).toFixed(4));
}
