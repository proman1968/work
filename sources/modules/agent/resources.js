/**
 * Данные агента из дерева (не код ядра):
 *   ai/system.md        — базовые правила агента
 *   ai/config.js        — { model, imageModel, maxTurns, mode }
 *   ai/agents/*.md      — субагенты (фронтматтер: name, description, tools, model)
 *   ai/skills/*.md      — навыки (фронтматтер: name, description, when; тело — инструкция)
 *
 * Слои: пакет движка /$server/$folder/$class/ai, затем метапапки классов от корня к месту задачи
 * (<класс>/$тип/ai/…). Ближний слой перекрывает дальний по имени — место уточняет общее.
 */
import { parseFrontmatter } from './util.js';
import { FS } from '../../server/index.js';

export const ENGINE_AI = '/$server/$folder/$class/ai';

async function safe(fn, fallback = null) {
    try {
        return await fn();
    }
    catch {
        return fallback;
    }
}

/** Классы от корня к месту (без корня WORK). */
function classChain(place) {
    const chain = [];
    let cur = place;
    const seen = new Set();
    while (cur && cur !== globalThis.WORK && !seen.has(cur)) {
        seen.add(cur);
        if (cur instanceof FS.$class)
            chain.unshift(cur);
        cur = cur.$parent ?? null;
    }
    return chain;
}

/** Папки ai/ по слоям: [пакет движка, …метапапки классов → место]. */
export async function aiDirs(place) {
    const dirs = [];
    const engine = await safe(() => WORK.get_item(ENGINE_AI));
    if (engine)
        dirs.push({ dir: engine, scope: 'engine' });
    for (const cls of classChain(place)) {
        const meta = await safe(() => cls.meta_folder);
        const dir = meta && await safe(() => meta.get_item('ai'));
        if (dir && !Array.isArray(dir) && dir.path !== engine?.path)
            dirs.push({ dir, scope: cls.path, owner: cls });
    }
    return dirs;
}

async function textOf(file) {
    return String(await file.load({ encoding: 'utf-8' }) ?? '');
}

/** Документы *.md каталога sub по слоям → Map(name → { name, meta, body, path, scope }). */
export async function loadDocs(place, sub) {
    const out = new Map();
    for (const { dir, scope } of await aiDirs(place)) {
        const folder = await safe(() => dir.get_item(sub));
        if (!folder || Array.isArray(folder))
            continue;
        const kids = (await safe(() => folder.children, [])) || [];
        for (const f of kids) {
            if (!/\.md$/i.test(f?.id || '') || /^readme\.md$/i.test(f.id))
                continue;
            const text = await safe(() => textOf(f), '');
            const { meta, body } = parseFrontmatter(text);
            const name = String(meta.name || f.id.replace(/\.md$/i, ''));
            out.set(name, { name, meta, body, path: f.path, scope });
        }
    }
    return out;
}

/** system.md: ближний слой (место) побеждает; пакет движка — по умолчанию. */
export async function loadSystem(place) {
    let text = '';
    for (const { dir } of await aiDirs(place)) {
        const f = await safe(() => dir.get_item('system.md'));
        if (f && !Array.isArray(f)) {
            const t = (await safe(() => textOf(f), '')).trim();
            if (t)
                text = t;
        }
    }
    return text;
}

/** config.js слоями (объединение, ближний перекрывает). */
export async function loadConfig(place) {
    const cfg = {};
    for (const { dir } of await aiDirs(place)) {
        const f = await safe(() => dir.get_item('config.js'));
        if (!f || Array.isArray(f))
            continue;
        const data = await safe(() => f.importScript(), null);
        if (data && typeof data === 'object')
            Object.assign(cfg, data.default && typeof data.default === 'object' ? data.default : data);
    }
    return cfg;
}

/** Каталог ai/skills места задачи для записи нового навыка. */
export async function skillsFolderFor(place) {
    const meta = place?.meta_folder;
    if (!meta)
        throw new Error('у места нет метапапки для навыков');
    return meta;
}
