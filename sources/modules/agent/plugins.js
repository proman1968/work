/**
 * Плагины агента (9.9, экосистема интеграций): установка пакетом
 * (навыки + субагенты + хуки + MCP-серверы) в слой ai/plugins/<name>/.
 *
 * Структура пакета плагина в ai/plugins/<name>/:
 *   plugin.json        — { name, version, description, enabled, hooks?, mcp? }
 *   skills/<id>.md     — навыки плагина (фронтматтер name, description)
 *   agents/<id>.md     — субагенты плагина (фронтматтер name, description, tools, maxTurns)
 *   hooks/<event>.js   — модули хуков (pre_tool, post_tool, on_stop, on_compact)
 *
 * MCP-серверы из manifest.mcp ({ <srv>: { command, args, env } | { url, headers } })
 * синхронизируются в /SERVICES/plugin-<name>-<srv>/$service/class.js (наследуют $service:
 * пул процессов, Streamable HTTP, резолв secret:ФАЙЛ). Открытые секреты в manifest.mcp
 * запрещены — только ссылки secret:<имя>.
 * Управлять плагинами (install/enable/disable/remove) может только ADMIN.
 */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './util.js';
import { HOOK_EVENTS } from './hooks.js';
import { isAdmin } from './system.js';
import { resetServiceRegistry } from './tools/services.js';

export const PLUGIN_ID = /^[a-z0-9][a-z0-9_-]{0,48}$/;
const SUBAGENT_DENY = new Set(['ask_user', 'todo_write', 'save_skill', 'connect_service', 'disconnect_service', 'schedule', 'git_push']);
const SECRET_KEY_NAME = /(key|token|secret|auth|password|bearer|credential)/i;

/**
 * Проверить манифест и содержимое пакета плагина до записи на диск.
 * Ловит невалидные имена (обход пути), запрещённые инструменты субагентов и открытые секреты в MCP.
 */
export function validatePluginManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
        throw new Error('plugin: нужен объект manifest { name, version, description, skills?, agents?, hooks?, mcp? }');
    const name = String(manifest.name || '').trim();
    if (!PLUGIN_ID.test(name))
        throw new Error('plugin: недопустимое имя плагина «' + name + '» (строчные латинские буквы, цифры, _ и -)');
    const version = String(manifest.version || '1.0.0').trim();
    const description = String(manifest.description || '').trim();
    if (description.length < 5)
        throw new Error('plugin: укажи description плагина (не короче 5 символов)');

    const skills = {};
    if (manifest.skills != null) {
        if (typeof manifest.skills !== 'object' || Array.isArray(manifest.skills))
            throw new Error('plugin: skills должен быть объектом { имя: markdown }');
        for (const [rawId, text] of Object.entries(manifest.skills)) {
            const id = String(rawId).replace(/\.md$/i, '');
            if (!PLUGIN_ID.test(id))
                throw new Error('plugin: недопустимое имя навыка «' + rawId + '»');
            const md = String(text || '');
            const { meta, body } = parseFrontmatter(md);
            if (!String(meta.description || '').trim() || !String(body || '').trim())
                throw new Error('plugin: навык «' + id + '» должен иметь фронтматтер с description и непустое тело');
            skills[id] = md.startsWith('---') ? md : `---\nname: ${id}\ndescription: ${meta.description}\n---\n${body}`;
        }
    }

    const agents = {};
    if (manifest.agents != null) {
        if (typeof manifest.agents !== 'object' || Array.isArray(manifest.agents))
            throw new Error('plugin: agents должен быть объектом { имя: markdown }');
        for (const [rawId, text] of Object.entries(manifest.agents)) {
            const id = String(rawId).replace(/\.md$/i, '');
            if (!PLUGIN_ID.test(id))
                throw new Error('plugin: недопустимое имя субагента «' + rawId + '»');
            const md = String(text || '');
            const { meta, body } = parseFrontmatter(md);
            if (!String(meta.description || '').trim() || !String(body || '').trim())
                throw new Error('plugin: субагент «' + id + '» должен иметь фронтматтер с description и непустое тело');
            const tools = Array.isArray(meta.tools) ? meta.tools : [];
            for (const t of tools)
                if (SUBAGENT_DENY.has(String(t)))
                    throw new Error('plugin: субагенту «' + id + '» запрещён инструмент «' + t + '»');
            agents[id] = md;
        }
    }

    const hooks = {};
    if (manifest.hooks != null) {
        if (typeof manifest.hooks !== 'object' || Array.isArray(manifest.hooks))
            throw new Error('plugin: hooks должен быть объектом { событие: код_модуля_js }');
        for (const [ev, code] of Object.entries(manifest.hooks)) {
            if (!HOOK_EVENTS.includes(ev))
                throw new Error('plugin: неизвестное событие хука «' + ev + '» (допустимы: ' + HOOK_EVENTS.join(', ') + ')');
            const src = String(code || '').trim();
            if (!src)
                throw new Error('plugin: пустой код хука «' + ev + '»');
            hooks[ev] = src;
        }
    }

    const mcp = {};
    if (manifest.mcp != null) {
        if (typeof manifest.mcp !== 'object' || Array.isArray(manifest.mcp))
            throw new Error('plugin: mcp должен быть объектом { имя: { command, args, env } | { url, headers } }');
        for (const [srvId, cfg] of Object.entries(manifest.mcp)) {
            if (!PLUGIN_ID.test(srvId))
                throw new Error('plugin: недопустимое имя MCP-сервера «' + srvId + '»');
            if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg))
                throw new Error('plugin: mcp.' + srvId + ' должен быть объектом');
            const hasCmd = typeof cfg.command === 'string' && cfg.command.trim().length > 0;
            const hasUrl = typeof cfg.url === 'string' && /^https?:\/\//i.test(cfg.url.trim());
            if (!hasCmd && !hasUrl)
                throw new Error('plugin: mcp.' + srvId + ' требует command (stdio) или http(s) url (remote)');
            for (const bag of [cfg.env, cfg.headers]) {
                if (!bag || typeof bag !== 'object')
                    continue;
                for (const [k, v] of Object.entries(bag)) {
                    const val = String(v ?? '').trim();
                    if (SECRET_KEY_NAME.test(k) && val && !val.startsWith('secret:'))
                        throw new Error('plugin: в mcp.' + srvId + ' (' + k + ') запрещены открытые секреты — используйте ссылку secret:<файл>');
                }
            }
            mcp[srvId] = hasUrl
                ? { url: cfg.url.trim(), ...(cfg.headers ? { headers: cfg.headers } : {}) }
                : { command: cfg.command.trim(), ...(Array.isArray(cfg.args) ? { args: cfg.args.map(String) } : {}), ...(cfg.env ? { env: cfg.env } : {}) };
        }
    }

    return {
        name,
        version,
        description,
        enabled: manifest.enabled !== false,
        skills,
        agents,
        hooks,
        mcp,
    };
}

/** Папка ai/ целевого слоя на диске (по умолчанию — пакет движка). */
async function resolveAiDir(scopePath) {
    const clean = String(scopePath || '').trim();
    if (!clean || clean === 'engine' || clean === '/$server/$folder/$class/ai') {
        const dir = path.join(process.cwd(), '$server', '$folder', '$class', 'ai');
        return { dir, scope: 'engine', item: await globalThis.WORK?.get_item?.('/$server/$folder/$class/ai').catch(() => null) };
    }
    const cls = await globalThis.WORK?.get_item?.(clean).catch(() => null);
    if (!cls || Array.isArray(cls) || !cls.meta_folder)
        throw new Error('plugin: класс слоя не найден: ' + clean);
    const meta = await cls.meta_folder;
    const dir = path.join(meta.dir, 'ai');
    return { dir, scope: cls.path, item: await meta.get_item('ai').catch(() => null), meta };
}

/** Синхронизировать MCP-серверы плагина с каталогом /SERVICES. */
async function syncPluginMcp(pluginName, mcpMap, enabled) {
    const servicesRoot = path.join(process.cwd(), 'SERVICES');
    if (!fs.existsSync(servicesRoot))
        return;
    for (const [srvId, cfg] of Object.entries(mcpMap || {})) {
        const folderName = 'plugin-' + pluginName + '-' + srvId;
        const srvDir = path.join(servicesRoot, folderName, '$service');
        await fsp.mkdir(srvDir, { recursive: true });
        const spec = {
            label: pluginName + ':' + srvId,
            description: 'MCP-сервер плагина ' + pluginName,
            enabled: Boolean(enabled),
            mcp: cfg,
        };
        await fsp.writeFile(path.join(srvDir, 'class.js'), 'export default ' + JSON.stringify(spec, null, 4) + ';\n', 'utf-8');
    }
    resetServiceRegistry();
}

/** Удалить MCP-серверы плагина из /SERVICES. */
async function removePluginMcp(pluginName, mcpMap) {
    const servicesRoot = path.join(process.cwd(), 'SERVICES');
    for (const srvId of Object.keys(mcpMap || {})) {
        const folderName = 'plugin-' + pluginName + '-' + srvId;
        await fsp.rm(path.join(servicesRoot, folderName), { recursive: true, force: true }).catch(() => {});
    }
    resetServiceRegistry();
}

/** Сбросить кэши реактивного дерева для папки ai/ слоя. */
async function resetAiTree(target) {
    try {
        target.meta?.reset?.();
        const ai = target.item || (target.meta ? await target.meta.get_item('ai').catch(() => null) : await globalThis.WORK?.get_item?.('/$server/$folder/$class/ai').catch(() => null));
        ai?.reset?.();
        const pf = await ai?.get_item?.('plugins').catch(() => null);
        pf?.reset?.();
    }
    catch { /* вне живого дерева */ }
}

/**
 * Установить плагин в слой ai/plugins/<name>/ (только ADMIN).
 */
export async function installPlugin({ scope, manifest }, ctx) {
    if (!(await isAdmin(ctx?.session)))
        throw new Error('Доступ запрещён: устанавливать плагины может только администратор');
    const clean = validatePluginManifest(manifest);
    const target = await resolveAiDir(scope);
    const pluginDir = path.join(target.dir, 'plugins', clean.name);
    await fsp.rm(pluginDir, { recursive: true, force: true });
    await fsp.mkdir(pluginDir, { recursive: true });

    for (const [id, md] of Object.entries(clean.skills)) {
        const d = path.join(pluginDir, 'skills');
        await fsp.mkdir(d, { recursive: true });
        await fsp.writeFile(path.join(d, id + '.md'), md, 'utf-8');
    }
    for (const [id, md] of Object.entries(clean.agents)) {
        const d = path.join(pluginDir, 'agents');
        await fsp.mkdir(d, { recursive: true });
        await fsp.writeFile(path.join(d, id + '.md'), md, 'utf-8');
    }
    for (const [ev, code] of Object.entries(clean.hooks)) {
        const d = path.join(pluginDir, 'hooks');
        await fsp.mkdir(d, { recursive: true });
        await fsp.writeFile(path.join(d, ev + '.mjs'), code, 'utf-8');
    }

    const metaJson = {
        name: clean.name,
        version: clean.version,
        description: clean.description,
        enabled: clean.enabled,
        hooks: Object.keys(clean.hooks),
        mcp: clean.mcp,
        installedAt: Date.now(),
    };
    await fsp.writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(metaJson, null, 2), 'utf-8');
    if (Object.keys(clean.mcp).length)
        await syncPluginMcp(clean.name, clean.mcp, clean.enabled);
    await resetAiTree(target);
    return {
        name: clean.name,
        version: clean.version,
        scope: target.scope,
        enabled: clean.enabled,
        skills: Object.keys(clean.skills),
        agents: Object.keys(clean.agents),
        hooks: Object.keys(clean.hooks),
        mcp: Object.keys(clean.mcp),
    };
}

/** Включить или выключить установленный плагин (только ADMIN). */
export async function setPluginEnabled({ scope, name, enabled }, ctx) {
    if (!(await isAdmin(ctx?.session)))
        throw new Error('Доступ запрещён: управлять плагинами может только администратор');
    const id = String(name || '').trim();
    if (!PLUGIN_ID.test(id))
        throw new Error('plugin: недопустимое имя плагина «' + id + '»');
    const target = await resolveAiDir(scope);
    const manifestFile = path.join(target.dir, 'plugins', id, 'plugin.json');
    let meta;
    try {
        meta = JSON.parse(await fsp.readFile(manifestFile, 'utf-8'));
    }
    catch {
        throw new Error('plugin: плагин «' + id + '» не найден в слое ' + target.scope);
    }
    meta.enabled = Boolean(enabled);
    await fsp.writeFile(manifestFile, JSON.stringify(meta, null, 2), 'utf-8');
    if (meta.mcp && Object.keys(meta.mcp).length)
        await syncPluginMcp(id, meta.mcp, meta.enabled);
    await resetAiTree(target);
    return { name: id, scope: target.scope, enabled: meta.enabled };
}

/** Удалить плагин из слоя (только ADMIN). */
export async function removePlugin({ scope, name }, ctx) {
    if (!(await isAdmin(ctx?.session)))
        throw new Error('Доступ запрещён: удалять плагины может только администратор');
    const id = String(name || '').trim();
    if (!PLUGIN_ID.test(id))
        throw new Error('plugin: недопустимое имя плагина «' + id + '»');
    const target = await resolveAiDir(scope);
    const pluginDir = path.join(target.dir, 'plugins', id);
    const manifestFile = path.join(pluginDir, 'plugin.json');
    let meta;
    try {
        meta = JSON.parse(await fsp.readFile(manifestFile, 'utf-8'));
    }
    catch {
        throw new Error('plugin: плагин «' + id + '» не найден в слое ' + target.scope);
    }
    if (meta?.mcp)
        await removePluginMcp(id, meta.mcp);
    await fsp.rm(pluginDir, { recursive: true, force: true });
    await resetAiTree(target);
    return { name: id, scope: target.scope, removed: true };
}

/** Список установленных плагинов по слоям места (aiDirs). */
export async function listPlugins(place) {
    const { aiDirs } = await import('./resources.js');
    const out = [];
    for (const { dir, scope } of await aiDirs(place)) {
        const pluginsDir = path.join(dir.dir, 'plugins');
        let entries;
        try {
            entries = await fsp.readdir(pluginsDir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (!e.isDirectory() || !PLUGIN_ID.test(e.name))
                continue;
            const pDir = path.join(pluginsDir, e.name);
            let meta;
            try {
                meta = JSON.parse(await fsp.readFile(path.join(pDir, 'plugin.json'), 'utf-8'));
            }
            catch {
                continue;
            }
            const listMd = async sub => {
                try {
                    return (await fsp.readdir(path.join(pDir, sub))).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
                }
                catch { return []; }
            };
            const listJs = async sub => {
                try {
                    return (await fsp.readdir(path.join(pDir, sub))).filter(f => /\.m?js$/.test(f)).map(f => f.replace(/\.m?js$/, ''));
                }
                catch { return []; }
            };
            out.push({
                name: meta.name || e.name,
                version: meta.version || '1.0.0',
                description: meta.description || '',
                enabled: meta.enabled !== false,
                scope,
                dir: pDir,
                skills: await listMd('skills'),
                agents: await listMd('agents'),
                hooks: await listJs('hooks'),
                mcp: Object.keys(meta.mcp || {}),
            });
        }
    }
    return out;
}
