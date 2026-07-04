import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as CORE from '../server/index.js';

export const DIALOGUE_SKILL_ID = 'Диалог';
export const CLARIFY_SKILL_ID = 'Уточнение задачи';
export const PLANNING_SKILL_ID = 'Планирование';

export const ROUTE_MODES = {
    EXECUTE: 'execute',
    CHOICE: 'choice',
    CLARIFY: 'clarify',
    DIALOGUE: 'dialogue',
};

const MIN_SCORE = 0.42;
const LEADER_GAP = 0.07;
const WEAK_SCORE = 0.28;

const SYSTEM_SKILL_IDS = new Set([
    DIALOGUE_SKILL_ID,
    CLARIFY_SKILL_ID,
    PLANNING_SKILL_ID,
]);

let skillCatalogCache = null;
let skillCatalogCacheTime = 0;
const CACHE_TTL = 60_000;

async function walkSkillDataFiles(skillsDir) {
    const results = [];
    async function walk(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const ent of entries) {
            if (!ent.isDirectory())
                continue;
            const full = path.join(dir, ent.name);
            if (ent.name === '$skill') {
                // Surface: $skill/data.js (keywords for routing)
                const surfacePath = path.join(full, 'data.js');
                try {
                    await fs.access(surfacePath);
                    results.push(surfacePath);
                }
                catch { /* no surface data.js */ }
                // Deep: $skill/$storage/$skill/data.js (execute, METADATA)
                const deepPath = path.join(full, '$storage', '$skill', 'data.js');
                try {
                    await fs.access(deepPath);
                    results.push(deepPath);
                }
                catch { /* no deep data.js */ }
                // Continue recursing for nested skills
            }
            await walk(full);
        }
    }
    await walk(skillsDir);
    return results;
}

function skillMetaFromPath(dataPath, skillsRoot) {
    const rel = path.relative(skillsRoot, dataPath).replace(/\\/g, '/');
    const parts = rel.split('/');
    const skillIdx = parts.indexOf('$skill');
    const id = skillIdx > 0 ? parts[skillIdx - 1] : parts[0];
    const workPath = '/skills/' + parts.slice(0, skillIdx).join('/');
    return { id, path: workPath, dataPath };
}

export async function loadSkillCatalog(workRoot = process.cwd()) {
    const skillsRoot = path.join(workRoot, 'skills');
    const dataFiles = await walkSkillDataFiles(skillsRoot);
    const byId = new Map();
    for (const dataPath of dataFiles) {
        try {
            const mod = await import(pathToFileURL(dataPath).href + '?v=' + Date.now());
            const data = mod.default || mod;
            const meta = skillMetaFromPath(dataPath, skillsRoot);
            const id = meta.id;
            if (id === '$skill')
                continue;
            const isDeep = dataPath.includes('$storage');
            const existing = byId.get(id);
            if (!existing) {
                byId.set(id, {
                    ...meta,
                    keywords: String(data.keywords ?? '').trim(),
                    services: data.services,
                    hasExecute: typeof data.execute === 'function',
                    label: data.label || id,
                    icon: data.icon || 'carbon:settings',
                    fields: data.METADATA?.FIELDS?.fields || data.metadata?.FIELDS?.fields || [],
                    isDeep,
                });
            }
            else if (isDeep && !existing.isDeep) {
                // Deep file overrides execute, METADATA, services
                existing.hasExecute = typeof data.execute === 'function';
                existing.services = data.services || existing.services;
                existing.label = data.label || existing.label;
                existing.icon = data.icon || existing.icon;
                existing.fields = data.METADATA?.FIELDS?.fields || data.metadata?.FIELDS?.fields || existing.fields;
                existing.isDeep = true;
                if (!existing.keywords && data.keywords)
                    existing.keywords = String(data.keywords).trim();
            }
            else if (!isDeep && !existing.keywords && data.keywords) {
                // Surface file supplements keywords if deep had none
                existing.keywords = String(data.keywords).trim();
            }
        }
        catch (e) {
            console.warn('[skill-router] load', dataPath, e.message);
        }
    }
    const skills = [...byId.values()].filter(s =>
        s.keywords || s.hasExecute || s.services?.length,
    );
    return skills;
}

export async function getSkillCatalog() {
    const workRoot = globalThis.WORK?.dir || process.cwd();
    const now = Date.now();
    if (skillCatalogCache && now - skillCatalogCacheTime < CACHE_TTL)
        return skillCatalogCache;
    skillCatalogCache = await loadSkillCatalog(workRoot);
    skillCatalogCacheTime = now;
    return skillCatalogCache;
}

export function keywordFallbackScore(query, skills) {
    const q = String(query ?? '').toLowerCase();
    const qTokens = q.split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 2);
    return skills.map(skill => {
        const hay = `${skill.id} ${skill.keywords}`.toLowerCase();
        let hits = 0;
        for (const token of qTokens) {
            if (hay.includes(token))
                hits++;
        }
        const sim = qTokens.length ? hits / qTokens.length : 0;
        return { ...skill, sim };
    }).sort((a, b) => b.sim - a.sim);
}

export async function scoreSkills(prompt, skills, embedFn) {
    const query = String(prompt ?? '').trim();
    if (!query || !skills.length)
        return [];

    const embed = embedFn || (async text => {
        const { xenova } = await import('../modules/embeddings/embeddings.js');
        return xenova.embedding(text);
    });

    let queryVec;
    try {
        queryVec = await embed(query);
    }
    catch (e) {
        console.warn('[skill-router] embedding failed', e.message);
        return keywordFallbackScore(query, skills);
    }

    if (!queryVec?.length)
        return keywordFallbackScore(query, skills);

    const scored = [];
    for (const skill of skills) {
        const text = `${skill.id}\n${skill.keywords}`.trim();
        if (!text)
            continue;
        let vec;
        try {
            vec = skill._embedding || await embed(text);
            skill._embedding = vec;
        }
        catch {
            continue;
        }
        const sim = CORE.$folder.cosineSimilarityDense(queryVec, vec);
        scored.push({ ...skill, sim });
    }
    return scored.sort((a, b) => b.sim - a.sim);
}

export function detectCompositePrompt(prompt) {
    const text = String(prompt ?? '').toLowerCase();
    if (!text.trim())
        return false;
    if (/\b(и потом|затем|после этого|сначала .{3,} потом|потом .{3,} и)\b/u.test(text))
        return true;
    if (/\b\d+[.)]\s+\S/u.test(text))
        return true;
    const verbs = ['найди', 'нарисуй', 'создай', 'отправь', 'сгенерируй', 'напиши', 'спланируй', 'сделай'];
    let hits = 0;
    for (const verb of verbs) {
        if (text.includes(verb))
            hits++;
    }
    return hits >= 2;
}

export function classifyRoute(scoredSkills, options = {}) {
    const minScore = options.minScore ?? MIN_SCORE;
    const weakScore = options.weakScore ?? WEAK_SCORE;
    const dialogueSkill = options.dialogueSkill || null;
    const clarifySkill = options.clarifySkill || null;
    const dialogueId = options.dialogueId ?? DIALOGUE_SKILL_ID;

    if (!scoredSkills.length) {
        return {
            mode: ROUTE_MODES.DIALOGUE,
            skills: dialogueSkill ? [dialogueSkill] : [],
            scores: [],
        };
    }

    const above = scoredSkills.filter(item => item.sim >= minScore);
    if (!above.length) {
        const weak = scoredSkills.filter(item => item.sim >= weakScore).slice(0, 5);
        if (weak.length >= 2) {
            return {
                mode: ROUTE_MODES.CLARIFY,
                skills: weak,
                scores: scoredSkills.slice(0, 5),
                clarifySkill,
            };
        }
        return {
            mode: ROUTE_MODES.DIALOGUE,
            skills: dialogueSkill ? [dialogueSkill] : [],
            scores: scoredSkills.slice(0, 3),
        };
    }

    const top = above[0];
    const second = above[1];
    if (!second || (top.sim - second.sim) >= LEADER_GAP) {
        return {
            mode: ROUTE_MODES.EXECUTE,
            skills: [top],
            scores: above.slice(0, 3),
        };
    }

    const leaders = CORE.$folder.filterRagData(
        above.map(item => ({ ...item })),
        options.sensitivity ?? 0.5,
    );
    if (leaders.length === 1) {
        return {
            mode: ROUTE_MODES.EXECUTE,
            skills: leaders,
            scores: above.slice(0, 3),
        };
    }
    if (leaders.length > 1) {
        const hasDialogue = leaders.some(item => item.id === dialogueId);
        return {
            mode: hasDialogue ? ROUTE_MODES.DIALOGUE : ROUTE_MODES.CHOICE,
            skills: hasDialogue ? leaders.filter(item => item.id === dialogueId) : leaders,
            scores: above.slice(0, 5),
            clarifySkill,
        };
    }

    return {
        mode: ROUTE_MODES.DIALOGUE,
        skills: dialogueSkill ? [dialogueSkill] : [top],
        scores: above.slice(0, 3),
    };
}

export async function routeSkill(prompt, options = {}) {
    const catalog = options.skills ?? await getSkillCatalog();
    const dialogueSkill = catalog.find(item => item.id === DIALOGUE_SKILL_ID) || null;
    const clarifySkill = catalog.find(item => item.id === CLARIFY_SKILL_ID) || null;
    const planningSkill = catalog.find(item => item.id === PLANNING_SKILL_ID) || null;

    if (detectCompositePrompt(prompt) && planningSkill) {
        return {
            prompt: String(prompt ?? '').trim(),
            dialogueSkill,
            clarifySkill,
            mode: ROUTE_MODES.EXECUTE,
            skills: [planningSkill],
            scores: [],
        };
    }

    const routable = catalog.filter(item => !SYSTEM_SKILL_IDS.has(item.id));
    const scored = await scoreSkills(prompt, routable, options.embedFn);
    const route = classifyRoute(scored, { dialogueSkill, clarifySkill, ...options });
    return {
        prompt: String(prompt ?? '').trim(),
        dialogueSkill,
        clarifySkill,
        ...route,
    };
}

export function buildTaskSkillBody(prompt, route) {
    const executeSkill = route.skills?.[0];
    const interactive = route.mode === ROUTE_MODES.EXECUTE
        || route.mode === ROUTE_MODES.CHOICE
        || route.mode === ROUTE_MODES.CLARIFY;
    return {
        prompt: String(prompt ?? '').trim(),
        route: route.mode,
        skills: (route.skills || []).map(item => ({
            id: item.id,
            path: item.path,
            sim: item.sim,
        })),
        scores: (route.scores || []).map(item => ({
            id: item.id,
            sim: item.sim,
        })),
        disabled: !interactive || route.mode === ROUTE_MODES.DIALOGUE,
    };
}

export function dialogueSystemExtras(route) {
    if (route.mode === ROUTE_MODES.CLARIFY)
        return 'Запрос пользователя неоднозначен. Задай короткие уточняющие вопросы.';
    return '';
}

export async function saveTaskSkill(storage, prompt, route, params = {}) {
    const body = buildTaskSkillBody(prompt, route);
    return storage.save_file({
        filename: 'task.skill',
        post: JSON.stringify(body, null, 2),
        encoding: 'utf-8',
        user: WORK,
        sender: WORK.id,
        logAuthor: params.logAuthor,
        ignore_save_logs: true,
    });
}
