/**
 * Автоиспытания агента по 15 направлениям (9.14, продолжение 7.4):
 *   - DIMENSIONS: 15 направлений оценки агента (соответствуют таблице 7.1 scorecard);
 *   - summarizeEvalRun(results, opts): сводка прогона — общие метрики, разбивка по 15 направлениям,
 *     расчёт стоимости в $ (по тарифам модели pricing или списаниям в лентах) и времени (totalMs / avgMs);
 *   - compareEvalRuns(beforeRun, afterRun): сравнение двух прогонов «до/после» — регрессии (задачи, которые
 *     проходили раньше и упали теперь), улучшения, дельта по каждому из 15 направлений, дельта времени и стоимости;
 *   - formatEvalSummary / formatEvalComparison: читаемый табличный вывод для CLI (scripts/agent-eval.mjs).
 */
import { costOf } from './cost.js';

export const DIMENSIONS = [
    { id: 1, title: 'Инструменты (файлы, поиск, запуск, веб)' },
    { id: 2, title: 'Память и знания организации' },
    { id: 3, title: 'Субагенты и оркестрация' },
    { id: 4, title: 'Компьютер и браузер' },
    { id: 5, title: 'Безопасность и согласования' },
    { id: 6, title: 'Откат ошибок агента' },
    { id: 7, title: 'Интеграции (MCP, подключения, A2A)' },
    { id: 8, title: 'Расписания и события' },
    { id: 9, title: 'Голос' },
    { id: 10, title: 'Мобильность и уведомления' },
    { id: 11, title: 'Наблюдаемость и стоимость' },
    { id: 12, title: 'Выбор моделей и приватность' },
    { id: 13, title: 'Работа с кодом (git, патчи, LSP)' },
    { id: 14, title: 'Документы и отчёты' },
    { id: 15, title: 'Оргструктура, права, люди + ИИ' },
];

const DIM_BY_ID = new Map(DIMENSIONS.map(d => [d.id, d]));

function round6(n) {
    return +(Number(n) || 0).toFixed(6);
}

/**
 * Посчитать сводку прогона эталонных задач по всем 15 направлениям, стоимости и времени.
 * @param {Array<any>} results массив результатов задач
 * @param {{ model?: string, pricing?: { input: number, output: number } | null, at?: string, version?: string }} [opts]
 */
export function summarizeEvalRun(results = [], opts = {}) {
    const pricing = opts.pricing || null;
    const enriched = results.map(r => {
        const failed = Array.isArray(r.failed) ? r.failed : [];
        const ok = failed.length === 0;
        const ms = Math.max(0, Number(r.ms) || 0);
        const tok = {
            prompt: Number(r.tokens?.prompt) || 0,
            completion: Number(r.tokens?.completion) || 0,
            cached: Number(r.tokens?.cached) || 0,
            cacheWrite: Number(r.tokens?.cacheWrite) || 0,
        };
        const calcCost = r.costUsd != null && Number.isFinite(Number(r.costUsd)) && Number(r.costUsd) > 0
            ? round6(r.costUsd)
            : (costOf(tok, pricing) ?? 0);
        const dim = DIM_BY_ID.has(Number(r.dimension)) ? Number(r.dimension) : 1;
        return {
            ...r,
            dimension: dim,
            ok,
            failed,
            ms,
            tokens: tok,
            costUsd: round6(calcCost),
        };
    });

    const total = enriched.length;
    const passed = enriched.filter(r => r.ok).length;
    const passRate = total ? Math.round((passed / total) * 1000) / 10 : 0;
    const totalMs = enriched.reduce((s, r) => s + r.ms, 0);
    const avgMs = total ? Math.round(totalMs / total) : 0;
    const tokens = enriched.reduce((a, r) => ({
        prompt: a.prompt + r.tokens.prompt,
        completion: a.completion + r.tokens.completion,
        cached: a.cached + r.tokens.cached,
        cacheWrite: a.cacheWrite + r.tokens.cacheWrite,
    }), { prompt: 0, completion: 0, cached: 0, cacheWrite: 0 });
    const cacheShare = tokens.prompt ? Math.round((tokens.cached / tokens.prompt) * 100) : 0;
    const costUsd = round6(enriched.reduce((s, r) => s + r.costUsd, 0));

    const byDimension = DIMENSIONS.map(d => {
        const group = enriched.filter(r => r.dimension === d.id);
        const gTotal = group.length;
        const gPassed = group.filter(r => r.ok).length;
        const gMs = group.reduce((s, r) => s + r.ms, 0);
        const gCost = round6(group.reduce((s, r) => s + r.costUsd, 0));
        return {
            id: d.id,
            title: d.title,
            passed: gPassed,
            total: gTotal,
            passRate: gTotal ? Math.round((gPassed / gTotal) * 1000) / 10 : 0,
            ms: gMs,
            costUsd: gCost,
        };
    });

    return {
        model: opts.model || 'по умолчанию',
        version: opts.version || null,
        at: opts.at || new Date().toISOString(),
        pricing,
        passed,
        total,
        passRate,
        totalMs,
        avgMs,
        tokens: { ...tokens, cacheShare },
        costUsd,
        byDimension,
        results: enriched,
    };
}

/**
 * Сравнить два прогона автоиспытаний («до» и «после»):
 * выявляет регрессии (было ok → стало FAIL), улучшения (было FAIL → стало ok),
 * сдвиги по каждому из 15 направлений, а также разницу во времени и стоимости.
 */
export function compareEvalRuns(beforeRun, afterRun) {
    const b = beforeRun?.byDimension ? beforeRun : summarizeEvalRun(beforeRun?.results || [], beforeRun || {});
    const a = afterRun?.byDimension ? afterRun : summarizeEvalRun(afterRun?.results || [], afterRun || {});

    const bMap = new Map((b.results || []).map(r => [r.name, r]));
    const aMap = new Map((a.results || []).map(r => [r.name, r]));

    const regressions = [];
    const improvements = [];
    for (const [name, afterCase] of aMap) {
        const beforeCase = bMap.get(name);
        if (!beforeCase)
            continue;
        const wasOk = beforeCase.ok ?? !(beforeCase.failed?.length);
        const isOk = afterCase.ok ?? !(afterCase.failed?.length);
        if (wasOk && !isOk)
            regressions.push({ name, dimension: afterCase.dimension, failed: afterCase.failed || [] });
        else if (!wasOk && isOk)
            improvements.push({ name, dimension: afterCase.dimension });
    }

    const bDimMap = new Map((b.byDimension || []).map(d => [d.id, d]));
    const aDimMap = new Map((a.byDimension || []).map(d => [d.id, d]));
    const dimensions = DIMENSIONS.map(d => {
        const bd = bDimMap.get(d.id) || { passed: 0, total: 0, ms: 0, costUsd: 0 };
        const ad = aDimMap.get(d.id) || { passed: 0, total: 0, ms: 0, costUsd: 0 };
        return {
            id: d.id,
            title: d.title,
            beforePassed: bd.passed,
            beforeTotal: bd.total,
            afterPassed: ad.passed,
            afterTotal: ad.total,
            deltaPassed: ad.passed - bd.passed,
            deltaMs: ad.ms - bd.ms,
            deltaCostUsd: round6(ad.costUsd - bd.costUsd),
        };
    });

    return {
        before: { model: b.model, at: b.at, passed: b.passed, total: b.total, passRate: b.passRate, totalMs: b.totalMs, costUsd: b.costUsd, tokens: b.tokens },
        after: { model: a.model, at: a.at, passed: a.passed, total: a.total, passRate: a.passRate, totalMs: a.totalMs, costUsd: a.costUsd, tokens: a.tokens },
        deltaPassed: a.passed - b.passed,
        deltaPassRate: +(a.passRate - b.passRate).toFixed(1),
        deltaMs: a.totalMs - b.totalMs,
        deltaCostUsd: round6(a.costUsd - b.costUsd),
        deltaPromptTokens: (a.tokens?.prompt || 0) - (b.tokens?.prompt || 0),
        regressions,
        improvements,
        dimensions,
    };
}

/** Текстовый отчёт одного прогона (с таблицей по 15 направлениям, временем и стоимостью). */
export function formatEvalSummary(summary) {
    const lines = [];
    lines.push('Итог: ' + summary.passed + '/' + summary.total + ' (' + summary.passRate + '%)' + (summary.model ? ' — модель ' + summary.model : ''));
    lines.push('Время: ' + (summary.totalMs / 1000).toFixed(1) + ' с (в среднем ' + (summary.avgMs / 1000).toFixed(1) + ' с/задача)');
    lines.push('Токены: вход ' + (summary.tokens?.prompt || 0) + ', выход ' + (summary.tokens?.completion || 0)
        + ', из кэша ' + (summary.tokens?.cached || 0) + ' (' + (summary.tokens?.cacheShare || 0) + '%)'
        + ' | Стоимость: $' + (summary.costUsd || 0).toFixed(4));
    lines.push('\nПо 15 направлениям:');
    for (const d of summary.byDimension || []) {
        if (!d.total)
            continue;
        lines.push('  [' + String(d.id).padStart(2, ' ') + '] ' + d.title + ': ' + d.passed + '/' + d.total
            + ' (' + (d.ms / 1000).toFixed(1) + ' с, $' + d.costUsd.toFixed(4) + ')');
    }
    return lines.join('\n');
}

/** Текстовый отчёт сравнения «до/после». */
export function formatEvalComparison(diff) {
    const sign = n => (n > 0 ? '+' + n : String(n));
    const lines = [];
    lines.push('=== Сравнение прогонов автоиспытаний (до → после) ===');
    lines.push('До:    ' + diff.before.passed + '/' + diff.before.total + ' (' + diff.before.passRate + '%), '
        + (diff.before.totalMs / 1000).toFixed(1) + ' с, $' + (diff.before.costUsd || 0).toFixed(4) + ' [' + diff.before.model + ']');
    lines.push('После: ' + diff.after.passed + '/' + diff.after.total + ' (' + diff.after.passRate + '%), '
        + (diff.after.totalMs / 1000).toFixed(1) + ' с, $' + (diff.after.costUsd || 0).toFixed(4) + ' [' + diff.after.model + ']');
    lines.push('Дельта: задач ' + sign(diff.deltaPassed) + ' (' + sign(diff.deltaPassRate) + '%), время '
        + sign(Math.round(diff.deltaMs / 100) / 10) + ' с, стоимость ' + (diff.deltaCostUsd >= 0 ? '+$' : '-$') + Math.abs(diff.deltaCostUsd).toFixed(4));

    if (diff.regressions.length) {
        lines.push('РЕГРЕССИИ (' + diff.regressions.length + '): ' + diff.regressions.map(r => r.name).join(', '));
    }
    else {
        lines.push('Регрессий нет.');
    }
    if (diff.improvements.length)
        lines.push('Улучшения (' + diff.improvements.length + '): ' + diff.improvements.map(r => r.name).join(', '));

    lines.push('\nПо направлениям:');
    for (const d of diff.dimensions) {
        if (!d.beforeTotal && !d.afterTotal)
            continue;
        lines.push('  [' + String(d.id).padStart(2, ' ') + '] ' + d.title + ': '
            + d.beforePassed + '/' + d.beforeTotal + ' → ' + d.afterPassed + '/' + d.afterTotal
            + ' (' + sign(d.deltaPassed) + ')');
    }
    return lines.join('\n');
}
