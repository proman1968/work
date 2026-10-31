/**
 * Данные агента из дерева (не код ядра):
 *   ai/system.md        — правила агента (слои дописываются; `replace: true` во фронтматтере — заменить)
 *   ai/config.js        — { model, fallbackModels, subagentModel, compactModel, limits, imageModel, maxTurns, hooks };
 *                          hooks слоёв складываются (см. hooks.js), остальное — ближний перекрывает
 *                          (fallbackModels — 9.1: запасные модели при сбое основной до первого токена;
 *                          subagentModel/compactModel/limits — 9.2: дешёвая модель субагентов/сжатия и дневные лимиты;
 *                          private — 9.6: режим «данные не покидают сервер», ЛИПКИЙ — включение нельзя снять ниже)
 *   ai/agents/*.md      — субагенты (фронтматтер: name, description, tools, model, maxTurns, requires)
 *   ai/skills/*.md      — навыки (фронтматтер: name, description, requires; тело — инструкция)
 *
 * Слои: пакет движка /$server/$folder/$class/ai, затем метапапки классов от корня к месту задачи
 * (<класс>/$тип/ai/…). Ближний слой перекрывает дальний по имени — место уточняет общее.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFrontmatter } from './util.js';
import { FS } from '../../server/index.js';
import { HOOK_EVENTS, emptyHooks } from './hooks.js';
import { PLUGIN_ID } from './plugins.js';

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
        const dir = meta && await safe(() => meta._get_next_item('ai', FS.$folder));
        if (dir && !Array.isArray(dir) && dir.path !== engine?.path) {
            dir.reset?.();
            dirs.push({ dir, scope: cls.path, owner: cls });
        }
    }
    return dirs;
}

async function textOf(file) {
    return String(await file.load({ encoding: 'utf-8' }) ?? '');
}

/** Включённые плагины слоя ai/plugins/<id> → [{ id, dir, scope, meta }]. */
async function enabledPluginsOf(aiDir, scope) {
    if (!aiDir?.dir)
        return [];
    const base = path.join(aiDir.dir, 'plugins');
    let entries;
    try {
        entries = await fsp.readdir(base, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const out = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory() || !PLUGIN_ID.test(e.name))
            continue;
        const pDir = path.join(base, e.name);
        try {
            const meta = JSON.parse(await fsp.readFile(path.join(pDir, 'plugin.json'), 'utf-8'));
            if (meta && meta.enabled !== false)
                out.push({ id: meta.name || e.name, dir: pDir, workPath: aiDir.path + '/plugins/' + e.name, scope: scope + ':plugin:' + (meta.name || e.name), meta });
        }
        catch { /* битый манифест — пропуск */ }
    }
    return out;
}

/** Документы *.md каталога sub по слоям (включая включённые плагины ai/plugins/<id>) → Map(name → { name, meta, body, path, scope }). */
export async function loadDocs(place, sub) {
    const out = new Map();
    for (const { dir, scope } of await aiDirs(place)) {
        // 9.9: сначала документы из включённых плагинов этого слоя, затем собственные файлы слоя (могут уточнить плагин)
        for (const p of await enabledPluginsOf(dir, scope)) {
            const subDir = path.join(p.dir, sub);
            let files;
            try {
                files = await fsp.readdir(subDir);
            }
            catch { continue; }
            for (const f of files.sort()) {
                if (!/\.md$/i.test(f) || /^readme\.md$/i.test(f))
                    continue;
                const text = await safe(() => fsp.readFile(path.join(subDir, f), 'utf-8'), '');
                const { meta, body } = parseFrontmatter(text);
                const name = String(meta.name || f.replace(/\.md$/i, ''));
                out.set(name, { name, meta, body, path: p.workPath + '/' + sub + '/' + f, scope: p.scope });
            }
        }
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

/**
 * system.md по слоям: базовые правила движка всегда первыми, правила места дописываются после.
 * Слой, которому нужно заменить всё накопленное, начинает файл фронтматтером `replace: true`.
 */
export async function loadSystem(place) {
    let text = '';
    for (const { dir } of await aiDirs(place)) {
        const f = await safe(() => dir.get_item('system.md'));
        if (!f || Array.isArray(f))
            continue;
        const { meta, body } = parseFrontmatter(await safe(() => textOf(f), ''));
        if (!body)
            continue;
        text = !text || meta.replace === true ? body : text + '\n\n' + body;
    }
    return text;
}

/** Данные config.js каждого слоя по порядку (движок → место): [{ scope, dir, data }]. */
async function configLayers(place) {
    const out = [];
    for (const { dir, scope } of await aiDirs(place)) {
        const f = await safe(() => dir.get_item('config.js'));
        if (!f || Array.isArray(f))
            continue;
        const mod = await safe(() => f.importScript(), null);
        const data = mod && typeof mod === 'object' ? (mod.default && typeof mod.default === 'object' ? mod.default : mod) : null;
        if (data && typeof data === 'object')
            out.push({ scope, dir, data });
    }
    return out;
}

/** config.js слоями (объединение, ближний перекрывает). Ключ hooks сюда не входит — см. loadHooks (хуки складываются). */
export async function loadConfig(place) {
    const cfg = {};
    for (const { data } of await configLayers(place)) {
        const { hooks: _hooks, ...rest } = data;
        Object.assign(cfg, rest);
    }
    return cfg;
}

/**
 * 9.6: режим «данные не покидают сервер» места (`private: true` в ai/config.js слоя).
 * ЛИПКИЙ: включение на любом слое (движок → классы → место) нельзя снять ниже —
 * чувствительное место не «раззамывается» более глубокой настройкой (fail-closed).
 * @param {any} place место задачи
 * @returns {Promise<boolean>}
 */
export async function isPrivatePlace(place) {
    for (const { data } of await configLayers(place))
        if (data.private === true)
            return true;
    return false;
}

/** Модуль хука — только из папки hooks/ того же слоя ai/ (системная область: писать может лишь ADMIN). */
const HOOK_MODULE = /^hooks\/[\w.-]+\.m?js$/;

/**
 * Хуки по слоям (hooks.js): списки событий копятся от движка к месту задачи.
 * Элемент — функция или 'hooks/<имя>.js' (default-экспорт или экспорт с именем события).
 * Сбои загрузки не роняют агента: попадают в errors.
 * @returns {Promise<{pre_tool: Array, post_tool: Array, on_stop: Array, on_compact: Array, errors: Array}>}
 */
export async function loadHooks(place) {
    const hooks = emptyHooks();
    // 9.9: хуки из включённых плагинов ai/plugins/<id>/hooks/<event>.js
    for (const { dir, scope } of await aiDirs(place)) {
        for (const p of await enabledPluginsOf(dir, scope)) {
            const hDir = path.join(p.dir, 'hooks');
            for (const event of HOOK_EVENTS) {
                let hFile = path.join(hDir, event + '.mjs');
                let st = await safe(() => fsp.stat(hFile), null);
                if (!st) {
                    hFile = path.join(hDir, event + '.js');
                    st = await safe(() => fsp.stat(hFile), null);
                }
                if (!st)
                    continue;
                const mod = await safe(() => import(pathToFileURL(hFile).href + '?t=' + st.mtimeMs), null);
                const fn = typeof mod === 'function' ? mod : (typeof mod?.default === 'function' ? mod.default : (typeof mod?.[event] === 'function' ? mod[event] : null));
                if (fn)
                    hooks[event].push({ fn, name: 'plugin:' + p.id + '/' + event + '.js', scope: p.scope });
                else
                    hooks.errors.push({ scope: p.scope, event, error: 'модуль хука плагина ' + event + '.js не экспортирует функцию' });
            }
        }
    }
    for (const { scope, dir, data } of await configLayers(place)) {
        const spec = data.hooks;
        if (spec == null)
            continue;
        if (typeof spec !== 'object' || Array.isArray(spec)) {
            hooks.errors.push({ scope, error: 'hooks должен быть объектом { событие: [хуки] }' });
            continue;
        }
        for (const key of Object.keys(spec))
            if (!HOOK_EVENTS.includes(key))
                hooks.errors.push({ scope, event: key, error: 'неизвестное событие (есть: ' + HOOK_EVENTS.join(', ') + ')' });
        for (const event of HOOK_EVENTS) {
            const list = spec[event] == null ? [] : (Array.isArray(spec[event]) ? spec[event] : [spec[event]]);
            for (const [i, item] of list.entries()) {
                if (typeof item === 'function') {
                    hooks[event].push({ fn: item, name: item.name || event + '#' + i, scope });
                    continue;
                }
                if (typeof item !== 'string' || !HOOK_MODULE.test(item) || item.includes('..')) {
                    hooks.errors.push({ scope, event, error: 'хук: функция или модуль hooks/<имя>.js в папке ai/ этого слоя, получено ' + JSON.stringify(item) });
                    continue;
                }
                const hooksDir = await safe(() => dir.get_item('hooks'));
                const file = hooksDir && !Array.isArray(hooksDir) ? await safe(() => hooksDir.get_item(item.slice('hooks/'.length))) : null;
                const mod = file && !Array.isArray(file) ? await safe(() => file.importScript(), null) : null;
                // importScript отдаёт `module.default || module`: default-функция приходит сама, иначе — пространство имён экспортов
                const fn = typeof mod === 'function' ? mod : (typeof mod?.default === 'function' ? mod.default : (typeof mod?.[event] === 'function' ? mod[event] : null));
                if (fn)
                    hooks[event].push({ fn, name: item, scope });
                else
                    hooks.errors.push({ scope, event, error: 'модуль хука ' + item + ' не найден или не экспортирует функцию' });
            }
        }
    }
    return hooks;
}

/** Каталог ai/skills места задачи для записи нового навыка. */
export async function skillsFolderFor(place) {
    const meta = place?.meta_folder;
    if (!meta)
        throw new Error('у места нет метапапки для навыков');
    return meta;
}
