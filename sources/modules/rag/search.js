/**
 * Поиск: контексты (точка × роль × близость) → кандидаты-документы по проекциям →
 * гибридное ранжирование чанков (вектор + BM25, слияние RRF) × вес контекста и слоя →
 * не больше perDoc фрагментов на документ → повторная проверка canSee на выходе.
 * Одинаковое содержимое (снимки, копии записей лент) сворачивается: чанк один на hash,
 * он приписывается ближайшему видимому документу.
 */
import { CONFIG } from './config.js';
import * as store from './store.js';
import { embed } from './embedder.js';
import { buildContexts, scopeDocs, feedDocs, layerWeight } from './scope.js';
import { invalidate, pending } from './indexer.js';

function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++)
        s += a[i] * b[i];
    return s;
}

/** FTS5-запрос: токены запроса с усечением окончаний (грубая морфология), через OR. */
export function ftsQuery(text) {
    const tokens = String(text || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
    const uniq = [...new Set(tokens)].slice(0, 24);
    return uniq.map(t => {
        const stem = t.length > 5 ? t.slice(0, Math.max(4, t.length - 2)) : t;
        return '"' + stem.replace(/"/g, '') + '"*';
    }).join(' OR ');
}

function kindsFilter(kinds) {
    if (!kinds)
        return null;
    const list = Array.isArray(kinds) ? kinds : String(kinds).split(',');
    const set = new Set(list.map(s => String(s).trim()).filter(Boolean));
    return set.size ? set : null;
}

/**
 * Собрать кандидатов: физический путь → лучший (по весу) виртуальный вид.
 */
async function collectCandidates(point, params, filter = {}) {
    const ctx = await buildContexts(point, params);
    const cands = new Map();
    const prefix = filter.prefix || '';
    const offer = (doc, context, weight) => {
        if (filter.kinds && !filter.kinds.has(doc.kind))
            return;
        if (prefix && !(doc.virtual === prefix || doc.virtual.startsWith(prefix + '/')))
            return;
        const prev = cands.get(doc.path);
        if (!prev || prev.weight < weight)
            cands.set(doc.path, { doc, context, weight });
    };
    for (const c of ctx.contexts) {
        const docs = await scopeDocs(c.cls, c.role, ctx.uid);
        for (const d of docs)
            offer(d, c, c.weight * layerWeight(d.rank));
        if (c.kind === 'cabinet' && ctx.uid) {
            const feed = await feedDocs(ctx.uid, p => invalidate(p, { force: true }));
            for (const d of feed)
                offer(d, c, c.weight * 0.95);
        }
    }
    return { ...ctx, cands };
}

/**
 * Семантический поиск от точки.
 * @param {object} point Элемент ($class / папка / файл)
 * @param {object} params {prompt, k, role, rings, kinds, session}
 */
export async function search(point, params = {}) {
    const query = String(params.prompt ?? params.query ?? params.text ?? params.post ?? '').trim();
    if (!query)
        throw new Error('semantic_search: пустой запрос (prompt)');
    if (!await store.open())
        throw new Error('semantic_search: индекс недоступен (node:sqlite)');
    const S = CONFIG.search;
    const k = Math.max(1, Math.min(50, Number(params.k) || S.k));
    const { FS } = await import('../../server/index.js');
    const prefix = point instanceof FS.$class ? '' : point.path;
    const { contexts, cands, uid, system } = await collectCandidates(point, params, {
        kinds: kindsFilter(params.kinds), prefix,
    });

    // содержимое → лучший кандидат (для одинаковых hash)
    const byHash = new Map();
    for (const c of cands.values()) {
        const prev = byHash.get(c.doc.hash);
        if (!prev || prev.weight < c.weight)
            byHash.set(c.doc.hash, c);
    }
    const summary = contexts.map(c => ({ point: c.cls.path || '/', role: c.role.id, weight: +c.weight.toFixed(3), kind: c.kind }));
    if (!byHash.size)
        return { query, results: [], contexts: summary, pending: pending() };

    const [qvec] = await embed([query]);
    const vec = [];
    for (const hash of byHash.keys()) {
        for (const { id, vec: v } of store.vectorsOf(hash)) {
            const s = dot(qvec, v);
            if (s >= S.minVectorSim)
                vec.push({ id, hash, s });
        }
    }
    vec.sort((a, b) => b.s - a.s);
    vec.length = Math.min(vec.length, 400);
    const fts = store.ftsSearch(ftsQuery(query), S.ftsLimit).filter(r => byHash.has(r.hash));

    const scored = new Map();
    const bump = (id, hash, add, field, value) => {
        let e = scored.get(id);
        if (!e)
            scored.set(id, e = { id, hash, rrf: 0, sim: 0, bm25: null });
        e.rrf += add;
        if (field)
            e[field] = value;
    };
    vec.forEach((r, i) => bump(r.id, r.hash, 1 / (S.rrfK + i + 1), 'sim', r.s));
    fts.forEach((r, i) => bump(r.id, r.hash, 1 / (S.rrfK + i + 1), 'bm25', r.score));

    const ranked = [...scored.values()]
        .map(e => {
            const cand = byHash.get(e.hash);
            return { ...e, cand, score: e.rrf * cand.weight };
        })
        .sort((a, b) => b.score - a.score);

    const perDoc = new Map();
    const picked = [];
    for (const r of ranked) {
        if (picked.length >= k * 3)
            break;
        const n = perDoc.get(r.cand.doc.path) || 0;
        if (n >= S.perDoc)
            continue;
        perDoc.set(r.cand.doc.path, n + 1);
        picked.push(r);
    }

    // повторная проверка прав на выходе (та же политика, что при открытии файла)
    const results = [];
    const texts = new Map(store.chunksByIds(picked.map(r => r.id)).map(c => [c.id, c]));
    for (const r of picked) {
        if (results.length >= k)
            break;
        const { doc, context } = r.cand;
        if (!system && context.kind !== 'cabinet' && !doc.feed) {
            let meta = null;
            try { meta = doc.meta ? JSON.parse(doc.meta) : null; } catch { /* без meta */ }
            const descriptor = { path: doc.virtual, $class: context.cls, descriptor: true, logRow: doc.kind === 'log' ? meta : null };
            const ok = await context.cls.canSee(descriptor, { session: params.session, role: context.role.id })
                .catch(() => false);
            if (!ok)
                continue;
        }
        const chunk = texts.get(r.id);
        if (!chunk)
            continue;
        results.push({
            path: doc.virtual,
            source: doc.virtual !== doc.path ? doc.path : undefined,
            point: context.cls.path || '/',
            role: context.role.id === 'OWNER' ? undefined : context.role.id,
            via: context.kind,
            kind: doc.kind,
            title: doc.title,
            heading: chunk.heading || undefined,
            text: chunk.text,
            start: chunk.start,
            end: chunk.end,
            score: +r.score.toFixed(5),
            sim: r.sim ? +r.sim.toFixed(3) : undefined,
        });
    }
    return { query, results, contexts: summary, pending: pending(), uid: system ? undefined : uid };
}

function matchCond(v, cond) {
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        for (const [op, x] of Object.entries(cond)) {
            switch (op) {
                case 'eq': if (v != x) return false; break;
                case 'ne': if (v == x) return false; break;
                case 'gt': if (!(v > x)) return false; break;
                case 'gte': if (!(v >= x)) return false; break;
                case 'lt': if (!(v < x)) return false; break;
                case 'lte': if (!(v <= x)) return false; break;
                case 'contains': if (!String(v ?? '').toLowerCase().includes(String(x).toLowerCase())) return false; break;
                case 'in': if (!Array.isArray(x) || !x.includes(v)) return false; break;
                default: return false;
            }
        }
        return true;
    }
    return v == cond;
}

/**
 * Структурный запрос по объектам данных в тех же контекстах и с теми же правами, что поиск.
 * @param {object} point
 * @param {object} params {type, where, limit, session, role, rings}
 */
export async function queryObjects(point, params = {}) {
    if (!await store.open())
        throw new Error('query_objects: индекс недоступен (node:sqlite)');
    const { FS } = await import('../../server/index.js');
    const prefix = point instanceof FS.$class ? '' : point.path;
    let where = params.where;
    if (typeof where === 'string') {
        try { where = JSON.parse(where); } catch { where = null; }
    }
    const type = params.type ? String(params.type).replace(/^[.$]/, '').toLowerCase() : '';
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 50));
    const { cands } = await collectCandidates(point, params, { kinds: new Set(['object']), prefix });
    const out = [];
    for (const { doc, context, weight } of cands.values()) {
        let meta = null;
        try { meta = doc.meta ? JSON.parse(doc.meta) : null; } catch { continue; }
        if (!meta || (type && meta.type !== type))
            continue;
        const fields = meta.fields || {};
        if (where && typeof where === 'object' && !Object.entries(where).every(([f, c]) => matchCond(fields[f], c)))
            continue;
        out.push({
            path: doc.virtual,
            point: context.cls.path || '/',
            role: context.role.id === 'OWNER' ? undefined : context.role.id,
            type: meta.type,
            title: doc.title,
            time: meta.time,
            fields,
            weight,
        });
    }
    out.sort((a, b) => (b.weight - a.weight) || ((b.time || 0) - (a.time || 0)));
    return out.slice(0, limit).map(({ weight, ...o }) => o);
}
