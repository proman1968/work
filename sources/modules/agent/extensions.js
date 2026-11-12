/**
 * Управление внешними расширениями ИИ WORK (`sources/modules/agent/extensions.js`):
 *  1. Внешние навыки (`Skills`):
 *     - поддержка папочного стандарта `<id>/SKILL.md` (OpenCode / Claude Code / AgentSkills.io) и плоского `<id>.md`;
 *     - автообнаружение локально установленных на хосте навыков (`~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`);
 *     - импорт навыков в 1 клик с хоста, по URL / GitHub-ссылке или из текста `SKILL.md`;
 *     - явная активация навыков по упоминанию `@<skill-id>` в чате / задаче / Консультанте.
 *  2. MCP-серверы в `/SERVICES`:
 *     - каталог установленных MCP-серверов и коннекторов `/SERVICES`;
 *     - установка из стандартного JSON (`{ "mcpServers": { ... } }` / `{ "mcp": { ... } }`), из пресетов или формы;
 *     - живая проверка `mcp_list_tools`, включение/выключение и удаление MCP-серверов.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter, stringifyFrontmatter } from './util.js';
import { isAdmin } from './system.js';
import { resetServiceRegistry } from './tools/services.js';
import { ENGINE_AI, loadDocs } from './resources.js';

export const SKILL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const SECRET_KEY_NAME = /(key|token|secret|auth|password|bearer|credential)/i;

/** Пресеты популярных MCP-серверов для быстрой установки в /SERVICES. */
export const MCP_PRESETS = [
    {
        id: 'filesystem',
        label: 'Filesystem MCP',
        description: 'Доступ к разрешённым локальным каталогам через официальный @modelcontextprotocol/server-filesystem',
        icon: 'carbon:folder-details',
        transport: 'stdio',
        mcp: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
        },
    },
    {
        id: 'git',
        label: 'Git MCP',
        description: 'Чтение истории, веток, diff и коммитов репозитория через mcp-server-git',
        icon: 'carbon:branch',
        transport: 'stdio',
        mcp: {
            command: 'uvx',
            args: ['mcp-server-git', '--repository', '.'],
        },
    },
    {
        id: 'fetch',
        label: 'Fetch MCP',
        description: 'Загрузка веб-страниц и конвертация HTML в Markdown для ИИ-агентов',
        icon: 'carbon:earth',
        transport: 'stdio',
        mcp: {
            command: 'uvx',
            args: ['mcp-server-fetch'],
        },
    },
    {
        id: 'memory',
        label: 'Knowledge Graph Memory',
        description: 'Графовая долговременная память сущностей и связей (@modelcontextprotocol/server-memory)',
        icon: 'carbon:network-4',
        transport: 'stdio',
        mcp: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory'],
        },
    },
    {
        id: 'playwright',
        label: 'Playwright Browser MCP',
        description: 'Управление браузером, снапшоты DOM и автоматизация веб-интерфейсов (@playwright/mcp)',
        icon: 'carbon:application-web',
        transport: 'stdio',
        mcp: {
            command: 'npx',
            args: ['-y', '@playwright/mcp@latest'],
        },
    },
    {
        id: 'postgres',
        label: 'PostgreSQL MCP',
        description: 'Инспекция схемы и безопасные SQL-запросы к БД PostgreSQL',
        icon: 'carbon:data-base',
        transport: 'stdio',
        mcp: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
        },
    },
    {
        id: 'github',
        label: 'GitHub MCP',
        description: 'Работа с репозиториями, Issues, Pull Requests и кодом на GitHub (токен через secret:github_token)',
        icon: 'carbon:logo-github',
        transport: 'stdio',
        mcp: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'secret:github_token' },
        },
    },
    {
        id: 'remote-http',
        label: 'Remote HTTP MCP',
        description: 'Подключение внешнего MCP-сервера по протоколу Streamable HTTP / SSE',
        icon: 'carbon:cloud-service-management',
        transport: 'http',
        mcp: {
            url: 'https://example.com/mcp',
            headers: { Authorization: 'secret:mcp_token' },
        },
    },
];

/** Каталоги на компьютере пользователя, где живут навыки OpenCode / Claude / AgentSkills. */
export function getHostSkillRoots() {
    const home = os.homedir();
    const roots = [
        { source: 'opencode', label: 'OpenCode', dir: path.join(home, '.config', 'opencode', 'skills') },
        { source: 'opencode', label: 'OpenCode', dir: path.join(home, '.opencode', 'skills') },
        { source: 'claude', label: 'Claude Code', dir: path.join(home, '.claude', 'skills') },
        { source: 'agents', label: 'AgentSkills', dir: path.join(home, '.agents', 'skills') },
    ];
    if (process.env.APPDATA) {
        roots.push({ source: 'opencode', label: 'OpenCode', dir: path.join(process.env.APPDATA, 'opencode', 'skills') });
    }
    const seen = new Set();
    return roots.filter(r => {
        const norm = path.resolve(r.dir).toLowerCase();
        if (seen.has(norm))
            return false;
        seen.add(norm);
        return fs.existsSync(r.dir);
    });
}

/** Прочитать навык из папки `<dir>/<id>/SKILL.md` или файла `<dir>/<id>.md`. */
export function readSkillFromDiskEntry(parentDir, entry) {
    const fullPath = path.join(parentDir, entry.name);
    if (entry.isDirectory()) {
        if (!SKILL_ID_RE.test(entry.name))
            return null;
        const skillFile = ['SKILL.md', 'skill.md', entry.name + '.md']
            .map(f => path.join(fullPath, f))
            .find(p => fs.existsSync(p));
        if (!skillFile)
            return null;
        const raw = fs.readFileSync(skillFile, 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        const id = String(meta.name || entry.name).trim();
        const extraFiles = [];
        try {
            for (const sub of fs.readdirSync(fullPath)) {
                if (sub.toLowerCase() !== 'skill.md')
                    extraFiles.push(sub);
            }
        }
        catch { /* ignore */ }
        return {
            id,
            name: id,
            description: String(meta.description || '').trim(),
            meta,
            body: String(body || '').trim(),
            raw,
            isFolder: true,
            dirPath: fullPath,
            filePath: skillFile,
            extraFiles,
        };
    }
    if (entry.isFile() && /\.md$/i.test(entry.name) && !/^readme\.md$/i.test(entry.name)) {
        const baseId = entry.name.replace(/\.md$/i, '');
        if (!SKILL_ID_RE.test(baseId))
            return null;
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        const id = String(meta.name || baseId).trim();
        return {
            id,
            name: id,
            description: String(meta.description || '').trim(),
            meta,
            body: String(body || '').trim(),
            raw,
            isFolder: false,
            dirPath: parentDir,
            filePath: fullPath,
            extraFiles: [],
        };
    }
    return null;
}

/** Обнаружить все навыки, установленные на хосте в OpenCode / Claude Code. */
export function discoverHostSkills() {
    const found = [];
    const seenIds = new Set();
    for (const root of getHostSkillRoots()) {
        let entries = [];
        try {
            entries = fs.readdirSync(root.dir, { withFileTypes: true });
        }
        catch { continue; }
        for (const entry of entries) {
            try {
                const parsed = readSkillFromDiskEntry(root.dir, entry);
                if (!parsed || !parsed.body || seenIds.has(parsed.id))
                    continue;
                seenIds.add(parsed.id);
                found.push({
                    id: parsed.id,
                    name: parsed.name,
                    description: parsed.description || 'Внешний навык из ' + root.label,
                    source: root.source,
                    sourceLabel: root.label,
                    isFolder: parsed.isFolder,
                    hostDir: parsed.dirPath,
                    filePath: parsed.filePath,
                    extraFiles: parsed.extraFiles,
                    preview: parsed.body.slice(0, 300),
                });
            }
            catch { /* ignore broken skill */ }
        }
    }
    return found;
}

/** Определить дисковую папку `ai/skills` для `scope` ('global' или WORK-путь класса). */
export async function resolveSkillsTargetDir(scope = 'global', place = null) {
    const clean = String(scope || 'global').trim();
    if (!clean || clean === 'global' || clean === 'engine' || clean === ENGINE_AI) {
        const dir = path.join(process.cwd(), '$server', '$folder', '$class', 'ai', 'skills');
        return {
            dir,
            scope: 'global',
            workPath: ENGINE_AI + '/skills',
            folderItem: await globalThis.WORK?.get_item?.(ENGINE_AI).catch(() => null),
        };
    }
    const targetCls = (clean === 'place' && place)
        ? place
        : await globalThis.WORK?.get_item?.(clean).catch(() => null);
    const meta = await targetCls?.meta_folder;
    if (!meta?.dir)
        throw new Error('skills: целевой класс не найден или не имеет метапапки: ' + clean);
    return {
        dir: path.join(meta.dir, 'ai', 'skills'),
        scope: targetCls.path,
        workPath: meta.path + '/ai/skills',
        folderItem: meta,
    };
}

/** Сбросить кэш папки `ai/skills` в живом дереве WORK. */
async function resetSkillsTree(target) {
    try {
        target?.folderItem?.reset?.();
        const skillsFolder = await globalThis.WORK?.get_item?.(target.workPath).catch(() => null);
        skillsFolder?.reset?.();
    }
    catch { /* ignore */ }
}

/** Рекурсивное копирование директории навыка (включая scripts/, references/, SKILL.md). */
async function copyDirRecursive(srcDir, destDir) {
    await fsp.mkdir(destDir, { recursive: true });
    const entries = await fsp.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules')
            continue;
        const s = path.join(srcDir, entry.name);
        const d = path.join(destDir, entry.name);
        if (entry.isDirectory())
            await copyDirRecursive(s, d);
        else if (entry.isFile())
            await fsp.copyFile(s, d);
    }
}

/** Преобразовать GitHub-ссылку на файл или папку навыка в прямую raw-ссылку на SKILL.md. */
export function normalizeSkillUrl(rawUrl) {
    const u = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(u))
        throw new Error('Укажите корректный HTTP/HTTPS URL навыка');
    // https://github.com/<owner>/<repo>/blob/<branch>/<path>
    const blobMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i.exec(u);
    if (blobMatch)
        return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}/${blobMatch[4]}`;
    // https://github.com/<owner>/<repo>/tree/<branch>/<path>
    const treeMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/i.exec(u);
    if (treeMatch) {
        const subPath = treeMatch[4].replace(/\/+$/, '');
        return /\.md$/i.test(subPath)
            ? `https://raw.githubusercontent.com/${treeMatch[1]}/${treeMatch[2]}/${treeMatch[3]}/${subPath}`
            : `https://raw.githubusercontent.com/${treeMatch[1]}/${treeMatch[2]}/${treeMatch[3]}/${subPath}/SKILL.md`;
    }
    return u;
}

/**
 * Установить внешний навык в WORK:
 *  - `sourceType: 'host'` (`hostId` — например `'grill-me'` из `~/.config/opencode/skills`)
 *  - `sourceType: 'url'` (`url` — ссылка на `SKILL.md` или папку на GitHub)
 *  - `sourceType: 'content'` (`id`, `description`, `content` — текст Markdown / `SKILL.md`)
 */
export async function installExternalSkill(params = {}, ctx = {}) {
    if (ctx?.session && !(await isAdmin(ctx.session)))
        throw new Error('Доступ запрещён: устанавливать навыки может только руководитель (BOSS)');

    const scope = params.scope || 'global';
    const target = await resolveSkillsTargetDir(scope, params.place || ctx?.env?.place);
    await fsp.mkdir(target.dir, { recursive: true });

    const sourceType = String(params.sourceType || (params.hostId ? 'host' : (params.url ? 'url' : 'content'))).toLowerCase();

    if (sourceType === 'host') {
        const hostId = String(params.hostId || params.id || '').trim();
        const hostSkills = discoverHostSkills();
        const hit = hostSkills.find(s => s.id.toLowerCase() === hostId.toLowerCase());
        if (!hit)
            throw new Error(`Навык «${hostId}» не найден в локальных каталогах OpenCode / Claude`);

        if (hit.isFolder) {
            const destFolder = path.join(target.dir, hit.id);
            await fsp.rm(destFolder, { recursive: true, force: true }).catch(() => {});
            await copyDirRecursive(hit.hostDir, destFolder);
            await resetSkillsTree(target);
            return {
                id: hit.id,
                name: hit.name,
                description: hit.description,
                scope: target.scope,
                path: `${target.workPath}/${hit.id}/SKILL.md`,
                source: hit.sourceLabel,
            };
        }
        const destFile = path.join(target.dir, hit.id + '.md');
        await fsp.copyFile(hit.filePath, destFile);
        await resetSkillsTree(target);
        return {
            id: hit.id,
            name: hit.name,
            description: hit.description,
            scope: target.scope,
            path: `${target.workPath}/${hit.id}.md`,
            source: hit.sourceLabel,
        };
    }

    let rawMd = '';
    let fallbackId = String(params.id || params.name || '').trim();

    if (sourceType === 'url') {
        const fetchUrl = normalizeSkillUrl(params.url);
        const { guardedGet } = await import('../../host/net-guard.js');
        const res = await guardedGet(fetchUrl, { maxBytes: 2 * 1024 * 1024, timeoutMs: 20000 });
        if (res.status < 200 || res.status >= 300)
            throw new Error(`Не удалось скачать навык по адресу ${fetchUrl} (HTTP ${res.status})`);
        rawMd = res.body.toString('utf-8');
        if (!fallbackId) {
            const parts = new URL(fetchUrl).pathname.split('/').filter(Boolean);
            const last = parts.pop() || 'skill';
            fallbackId = /^skill\.md$/i.test(last) ? (parts.pop() || 'skill') : last.replace(/\.md$/i, '');
        }
    }
    else {
        rawMd = String(params.content || params.markdown || '').trim();
    }

    if (!rawMd)
        throw new Error('Пустое содержимое навыка');

    const { meta, body } = parseFrontmatter(rawMd);
    const id = String(meta.name || fallbackId || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id || !SKILL_ID_RE.test(id))
        throw new Error('Укажите корректное имя навыка латиницей (например grill-me)');

    const description = String(meta.description || params.description || 'Пользовательский навык ' + id).trim();
    const finalMd = rawMd.startsWith('---')
        ? rawMd
        : stringifyFrontmatter({ name: id, description, created: new Date().toISOString().slice(0, 10) }, body || rawMd);

    const useFolder = Boolean(params.asFolder);
    let savedWorkPath;
    if (useFolder) {
        const destFolder = path.join(target.dir, id);
        await fsp.mkdir(destFolder, { recursive: true });
        await fsp.writeFile(path.join(destFolder, 'SKILL.md'), finalMd, 'utf-8');
        savedWorkPath = `${target.workPath}/${id}/SKILL.md`;
    }
    else {
        await fsp.writeFile(path.join(target.dir, id + '.md'), finalMd, 'utf-8');
        savedWorkPath = `${target.workPath}/${id}.md`;
    }

    await resetSkillsTree(target);
    return {
        id,
        name: id,
        description,
        scope: target.scope,
        path: savedWorkPath,
        source: sourceType,
    };
}

/** Удалить навык из выбранного слоя. */
export async function removeInstalledSkill(params = {}, ctx = {}) {
    if (ctx?.session && !(await isAdmin(ctx.session)))
        throw new Error('Доступ запрещён: удалять навыки может только руководитель (BOSS)');
    const id = String(params.id || params.name || '').trim();
    if (!id || !SKILL_ID_RE.test(id))
        throw new Error('Некорректное имя навыка');
    const target = await resolveSkillsTargetDir(params.scope || 'global', params.place || ctx?.env?.place);
    const fileTarget = path.join(target.dir, id + '.md');
    const folderTarget = path.join(target.dir, id);
    let removed = false;
    if (fs.existsSync(folderTarget)) {
        await fsp.rm(folderTarget, { recursive: true, force: true });
        removed = true;
    }
    if (fs.existsSync(fileTarget)) {
        await fsp.rm(fileTarget, { force: true });
        removed = true;
    }
    if (!removed)
        throw new Error(`Навык «${id}» не найден в ${target.workPath}`);
    await resetSkillsTree(target);
    return { id, removed: true, scope: target.scope };
}

/** Базовые прикладные инструменты ИИ для быстрого вызова через @ в строке промпта. */
export const PROMPT_TOOLS_CATALOG = [
    { id: 'report', description: 'Построить учётный отчёт: Ведомость (sheet), Обороты (turnovers), Анализ счёта (analysis), Проводки (postings), Журнал (journal)' },
    { id: 'register_operation', description: 'Зарегистрировать и провести хозяйственную операцию с двойной записью' },
    { id: 'find_objects', description: 'Найти объекты в справочниках и документах учётного ядра по фильтрам' },
    { id: 'describe_class', description: 'Прочитать схему класса (METADATA.FIELDS, ANALYTICS, OVERLAY) и доступные виды' },
    { id: 'write_table', description: 'Сохранить таблицу или выгрузку в файл Excel (.xlsx) или .csv' },
    { id: 'read_table', description: 'Прочитать строки и листы из таблицы .xlsx или .csv' },
    { id: 'create_office_file', description: 'Создать офисный документ Word (.docx), таблицу Excel (.xlsx) или презентацию (.pptx)' },
    { id: 'export_presentation', description: 'Сформировать презентацию .pptx или .pdf по списку слайдов' },
    { id: 'export_pdf', description: 'Сформировать защищённый печатный документ .pdf из HTML' },
    { id: 'web_search', description: 'Поиск актуальной информации в интернете через коннекторы /SERVICES' },
    { id: 'web_fetch', description: 'Прочитать содержимое веб-страницы по URL' },
    { id: 'install_skill', description: 'Установить внешний навык (SKILL.md) из OpenCode, Claude или GitHub' },
];

/** Полный список установленных в WORK навыков + найденных на хосте навыков OpenCode/Claude. */
export async function listSkillsCatalog(place = null) {
    const docsMap = await loadDocs(place, 'skills');
    const installed = [...docsMap.values()].map(s => ({
        id: s.name,
        name: s.name,
        description: String(s.meta?.description || '').trim(),
        requires: s.meta?.requires || null,
        path: s.path,
        scope: s.scope,
        isFolder: /\/SKILL\.md$/i.test(String(s.path || '')),
        bodyPreview: String(s.body || '').slice(0, 400),
        body: String(s.body || ''),
    }));
    const installedSet = new Set(installed.map(s => s.id.toLowerCase()));
    const hostSkills = discoverHostSkills().map(h => ({
        ...h,
        installedInWork: installedSet.has(h.id.toLowerCase()),
    }));
    return { installed, hostSkills };
}

/**
 * Собрать быстрый каталог автодополнения `@` для `work-prompt-bar` (как в OpenCode):
 *  - `skills` — навыки WORK + внешние навыки OpenCode/Claude на ПК;
 *  - `agents` — субагенты WORK (`analyst`, `explore`, `general`, `auditor`, `developer` и др.);
 *  - `tools`  — прикладные инструменты и подключённые MCP-серверы из `/SERVICES`.
 */
export async function getPromptMentionsCatalog(place = null) {
    const [skillsCat, agentsMap, mcpCat] = await Promise.all([
        listSkillsCatalog(place),
        loadDocs(place, 'agents'),
        listMcpCatalog().catch(() => ({ mcpServers: [], connectors: [] })),
    ]);

    const skills = [];
    const seenSkills = new Set();
    // Поднимаем grill-me и недавно добавленные внешние навыки в начало списка
    const sortedInstalled = [...skillsCat.installed].sort((a, b) => {
        if (a.id === 'grill-me') return -1;
        if (b.id === 'grill-me') return 1;
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.id.localeCompare(b.id);
    });
    for (const s of sortedInstalled) {
        seenSkills.add(s.id.toLowerCase());
        skills.push({
            kind: 'skill',
            id: s.id,
            description: s.description || 'Навык ИИ',
            icon: 'carbon:notebook',
        });
    }
    for (const h of skillsCat.hostSkills) {
        if (seenSkills.has(h.id.toLowerCase()))
            continue;
        seenSkills.add(h.id.toLowerCase());
        skills.push({
            kind: 'skill',
            id: h.id,
            description: h.description || `Навык из ${h.sourceLabel}`,
            icon: 'carbon:notebook',
        });
    }

    const agents = [...agentsMap.values()]
        .sort((a, b) => {
            const prio = ['general', 'explore', 'analyst', 'operator', 'auditor', 'developer', 'builder'];
            const ia = prio.indexOf(a.name);
            const ib = prio.indexOf(b.name);
            if (ia !== -1 || ib !== -1)
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            return a.name.localeCompare(b.name);
        })
        .map(a => ({
            kind: 'agent',
            id: a.name,
            description: String(a.meta?.description || 'Субагент WORK').trim(),
            icon: 'bootstrap:robot',
        }));

    const tools = PROMPT_TOOLS_CATALOG.map(t => ({
        kind: 'tool',
        id: t.id,
        description: t.description,
        icon: 'carbon:tools',
    }));

    for (const srv of (mcpCat.mcpServers || [])) {
        if (!srv.enabled)
            continue;
        tools.unshift({
            kind: 'mcp',
            id: 'mcp_' + srv.id,
            description: `${srv.label}: ${srv.description || 'инструменты MCP-сервера'} (${srv.path})`,
            icon: 'carbon:plug',
        });
    }

    return { skills, agents, tools };
}

/**
 * Найти в сообщении пользователя явные вызовы навыков `@<skill-name>` (например `@grill-me`)
 * и вернуть массив `{ name, description, body, path }` для автоматической подстановки в контекст.
 */
export function extractMentionedSkills(promptText, skillsMap) {
    const text = String(promptText || '');
    if (!text.includes('@'))
        return [];
    const matches = [...text.matchAll(/(?:^|[\s(])@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})\b/g)];
    if (!matches.length)
        return [];

    const activated = [];
    const seen = new Set();
    let hostCache = null;

    for (const m of matches) {
        const rawId = m[1];
        const keyLower = rawId.toLowerCase();
        if (seen.has(keyLower))
            continue;

        let found = skillsMap?.get?.(rawId) || skillsMap?.get?.(keyLower);
        if (!found && skillsMap instanceof Map) {
            for (const [k, v] of skillsMap.entries()) {
                if (String(k).toLowerCase() === keyLower) {
                    found = v;
                    break;
                }
            }
        }
        // Если навык ещё не скопирован в WORK, но стоит локально в OpenCode / Claude — подхватываем на лету!
        if (!found) {
            hostCache ??= discoverHostSkills();
            const hostHit = hostCache.find(h => h.id.toLowerCase() === keyLower);
            if (hostHit) {
                try {
                    const raw = fs.readFileSync(hostHit.filePath, 'utf-8');
                    const { meta, body } = parseFrontmatter(raw);
                    found = {
                        name: hostHit.id,
                        meta,
                        body,
                        path: hostHit.filePath,
                        baseDir: hostHit.hostDir,
                    };
                }
                catch { /* ignore */ }
            }
        }

        if (found && found.body) {
            seen.add(keyLower);
            activated.push({
                name: found.name || rawId,
                description: found.meta?.description || '',
                body: found.body,
                path: found.path || '',
                baseDir: found.baseDir || '',
            });
        }
    }
    return activated;
}

/** Сформировать блок `<skill_content>` для явно вызванных через `@<skill>` навыков. */
export function formatMentionedSkillsBlock(activatedSkills = []) {
    if (!Array.isArray(activatedSkills) || !activatedSkills.length)
        return '';
    return activatedSkills.map(s => [
        `<skill_content name="${s.name}">`,
        `# Skill: ${s.name}`,
        s.description ? `\n${s.description}\n` : '',
        s.body,
        s.baseDir ? `\nBase directory for this skill: ${s.baseDir}` : '',
        `</skill_content>`,
    ].filter(Boolean).join('\n')).join('\n\n');
}

/**
 * Найти в сообщении пользователя явные упоминания субагентов `@<agent>` и инструментов `@<tool>` / `@mcp_<srv>`
 * и вернуть текстовый блок директив для системного контекста хода.
 */
export function formatMentionedAgentsAndToolsBlock(promptText, agentsMap) {
    const text = String(promptText || '');
    if (!text.includes('@'))
        return '';
    const matches = [...text.matchAll(/(?:^|[\s(])@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})\b/g)];
    if (!matches.length)
        return '';

    const directives = [];
    const seen = new Set();
    const knownTools = new Map(PROMPT_TOOLS_CATALOG.map(t => [t.id.toLowerCase(), t]));

    for (const m of matches) {
        const rawId = m[1];
        const keyLower = rawId.toLowerCase();
        if (seen.has(keyLower))
            continue;

        let agentDef = agentsMap?.get?.(rawId) || agentsMap?.get?.(keyLower);
        if (!agentDef && agentsMap instanceof Map) {
            for (const [k, v] of agentsMap.entries()) {
                if (String(k).toLowerCase() === keyLower) {
                    agentDef = v;
                    break;
                }
            }
        }
        if (agentDef) {
            seen.add(keyLower);
            directives.push(
                `<agent_directive name="${agentDef.name}">\n`
                + `Пользователь явно вызвал субагента @${agentDef.name} (${agentDef.meta?.description || ''}). `
                + `Поручи выполнение этой задачи субагенту "${agentDef.name}" через инструмент task (agent="${agentDef.name}") либо строго следуй его специализации.\n`
                + `</agent_directive>`
            );
            continue;
        }

        const toolHit = knownTools.get(keyLower);
        if (toolHit) {
            seen.add(keyLower);
            directives.push(
                `<tool_directive name="${toolHit.id}">\n`
                + `Пользователь явно указал инструмент @${toolHit.id} (${toolHit.description}). Приоритетно используй инструмент "${toolHit.id}" при выполнении этого запроса.\n`
                + `</tool_directive>`
            );
            continue;
        }

        if (keyLower.startsWith('mcp_')) {
            seen.add(keyLower);
            directives.push(
                `<tool_directive name="${rawId}">\n`
                + `Пользователь явно указал MCP-инструмент/сервис @${rawId}. Используй соответствующие инструменты с префиксом "${rawId}" для выполнения запроса.\n`
                + `</tool_directive>`
            );
        }
    }
    return directives.join('\n\n');
}

// ============================================================================
// УПРАВЛЕНИЕ MCP-СЕРВЕРАМИ В /SERVICES
// ============================================================================

function normalizeMcpServerId(rawId) {
    const clean = String(rawId || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!clean || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,48}$/.test(clean))
        throw new Error(`Недопустимое имя MCP-сервера «${rawId}» (используйте латиницу, цифры, дефис или подчёркивание)`);
    return clean;
}

/**
 * Разобрать входной запрос установки MCP-сервера:
 *  - поддерживает стандартный JSON Claude Desktop / Cursor / OpenCode:
 *    `{ "mcpServers": { "my-mcp": { "command": "npx", "args": [...] } } }`
 *    или `{ "mcp": { "my-mcp": { "type": "remote", "url": "https://..." } } }`
 *  - поддерживает одиночный объект `{ id, label, description, command, args, env, url, headers }`.
 */
export function parseMcpInstallInput(input = {}) {
    let payload = input;
    if (typeof input?.json === 'string' && input.json.trim()) {
        try {
            payload = JSON.parse(input.json.trim());
        }
        catch (e) {
            throw new Error('Ошибка разбора JSON конфигурации MCP: ' + (e.message || e));
        }
    }
    else if (typeof input === 'string' && input.trim()) {
        try {
            payload = JSON.parse(input.trim());
        }
        catch (e) {
            throw new Error('Ошибка разбора JSON конфигурации MCP: ' + (e.message || e));
        }
    }

    const mapCandidate = payload?.mcpServers || (payload?.mcp && !payload.mcp.command && !payload.mcp.url ? payload.mcp : null);
    const items = [];

    if (mapCandidate && typeof mapCandidate === 'object' && !Array.isArray(mapCandidate)) {
        for (const [rawId, srvCfg] of Object.entries(mapCandidate)) {
            if (!srvCfg || typeof srvCfg !== 'object')
                continue;
            items.push({
                id: normalizeMcpServerId(rawId),
                label: srvCfg.label || rawId,
                description: srvCfg.description || `MCP-сервер ${rawId}`,
                icon: srvCfg.icon || 'carbon:plug',
                enabled: srvCfg.enabled !== false,
                cfg: srvCfg,
            });
        }
    }
    else if (payload && typeof payload === 'object') {
        const inner = payload.mcp && typeof payload.mcp === 'object' ? payload.mcp : payload;
        const id = normalizeMcpServerId(payload.id || payload.name || inner.id || inner.name || 'mcp-server');
        items.push({
            id,
            label: String(payload.label || payload.name || id).trim(),
            description: String(payload.description || `MCP-сервер ${id}`).trim(),
            icon: String(payload.icon || 'carbon:plug').trim(),
            enabled: payload.enabled !== false,
            cfg: inner,
        });
    }

    if (!items.length)
        throw new Error('Не найдено описание MCP-сервера (укажите command/args или url, либо вставьте JSON mcpServers)');

    return items.map(item => {
        const c = item.cfg || {};
        const cmd = Array.isArray(c.command) ? String(c.command[0] || '').trim() : String(c.command || '').trim();
        const extraArgs = Array.isArray(c.command) ? c.command.slice(1).map(String) : [];
        const args = [...extraArgs, ...(Array.isArray(c.args) ? c.args.map(String) : (typeof c.args === 'string' && c.args.trim() ? c.args.trim().split(/\s+/) : []))];
        const url = String(c.url || c.serverUrl || '').trim();
        const env = (c.env || c.environment) && typeof (c.env || c.environment) === 'object' ? { ...(c.env || c.environment) } : undefined;
        const headers = c.headers && typeof c.headers === 'object' ? { ...c.headers } : undefined;

        if (!cmd && !url)
            throw new Error(`MCP-сервер «${item.id}»: укажите command (для локального stdio) или url (для удалённого HTTP MCP)`);
        if (url && !/^https?:\/\//i.test(url))
            throw new Error(`MCP-сервер «${item.id}»: url должен начинаться с http:// или https://`);

        return {
            id: item.id,
            label: item.label,
            description: item.description,
            icon: item.icon,
            enabled: item.enabled,
            mcp: url
                ? { url, ...(headers && Object.keys(headers).length ? { headers } : {}) }
                : { command: cmd, ...(args.length ? { args } : {}), ...(env && Object.keys(env).length ? { env } : {}) },
        };
    });
}

/** Список всех сервисов и MCP-серверов в /SERVICES + каталог пресетов. */
export async function listMcpCatalog() {
    const servicesDir = path.join(process.cwd(), 'SERVICES');
    const mcpServers = [];
    const connectors = [];

    if (fs.existsSync(servicesDir)) {
        const entries = await fsp.readdir(servicesDir, { withFileTypes: true }).catch(() => []);
        for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (!e.isDirectory() || /^[$.#]/.test(e.name))
                continue;
            const workPath = '/SERVICES/' + e.name;
            let data = null;
            try {
                const item = await globalThis.WORK?.get_item?.(workPath);
                if (item && typeof item.import === 'function')
                    data = await item.import();
            }
            catch { /* fallback to reading class.js */ }

            if (!data) {
                try {
                    const clsFile = path.join(servicesDir, e.name, '$service', 'class.js');
                    if (fs.existsSync(clsFile)) {
                        const raw = await fsp.readFile(clsFile, 'utf-8');
                        const m = raw.match(/export\s+default\s+(\{[\s\S]*\})\s*;?\s*$/);
                        if (m)
                            data = JSON.parse(m[1]);
                    }
                }
                catch { /* ignore */ }
            }

            if (!data || typeof data !== 'object')
                continue;

            if (data.mcp && typeof data.mcp === 'object') {
                const isHttp = Boolean(data.mcp.url);
                mcpServers.push({
                    id: e.name,
                    path: workPath,
                    label: data.label || e.name,
                    description: data.description || 'MCP-сервер',
                    icon: data.icon || 'carbon:plug',
                    enabled: data.enabled !== false,
                    transport: isHttp ? 'http' : 'stdio',
                    command: data.mcp.command || '',
                    args: Array.isArray(data.mcp.args) ? data.mcp.args : [],
                    url: data.mcp.url || '',
                    envKeys: data.mcp.env ? Object.keys(data.mcp.env) : [],
                    headerKeys: data.mcp.headers ? Object.keys(data.mcp.headers) : [],
                    mcp: data.mcp,
                });
            }
            else {
                const schemaTools = data.SCHEMA && typeof data.SCHEMA === 'object' ? Object.keys(data.SCHEMA) : [];
                connectors.push({
                    id: e.name,
                    path: workPath,
                    label: data.label || e.name,
                    description: data.description || '',
                    icon: data.icon || 'carbon:api',
                    enabled: data.enabled !== false,
                    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
                    tools: schemaTools,
                });
            }
        }
    }

    return {
        mcpServers,
        connectors,
        presets: MCP_PRESETS,
    };
}

/** Установить один или несколько MCP-серверов в `/SERVICES/<id>/$service/class.js`. */
export async function installMcpServers(input = {}, ctx = {}) {
    if (ctx?.session && !(await isAdmin(ctx.session)))
        throw new Error('Доступ запрещён: устанавливать MCP-серверы может только руководитель (BOSS)');

    const specs = parseMcpInstallInput(input);
    const servicesDir = path.join(process.cwd(), 'SERVICES');
    await fsp.mkdir(servicesDir, { recursive: true });
    const installed = [];

    for (const spec of specs) {
        const srvDir = path.join(servicesDir, spec.id, '$service');
        const secretDir = path.join(srvDir, '#secret');
        await fsp.mkdir(srvDir, { recursive: true });

        // Если пользователь передал открытый токен/ключ в env или headers, автоматически прячем его в #secret/
        for (const bagName of ['env', 'headers']) {
            const bag = spec.mcp[bagName];
            if (!bag || typeof bag !== 'object')
                continue;
            for (const [k, v] of Object.entries(bag)) {
                const val = String(v ?? '').trim();
                if (SECRET_KEY_NAME.test(k) && val && !val.startsWith('secret:')) {
                    const secFile = k.toLowerCase().replace(/[^a-z0-9_-]+/g, '_') + '.txt';
                    await fsp.mkdir(secretDir, { recursive: true });
                    await fsp.writeFile(path.join(secretDir, secFile), val, 'utf-8');
                    bag[k] = 'secret:' + secFile;
                }
            }
        }

        const classData = {
            icon: spec.icon || 'carbon:plug',
            label: spec.label,
            description: spec.description,
            enabled: spec.enabled !== false,
            mcp: spec.mcp,
        };
        const code = `/** MCP-сервер ${spec.label} (/SERVICES/${spec.id}). */\nexport default ${JSON.stringify(classData, null, 4)};\n`;
        await fsp.writeFile(path.join(srvDir, 'class.js'), code, 'utf-8');
        installed.push({ id: spec.id, path: '/SERVICES/' + spec.id, label: spec.label, mcp: spec.mcp });
    }

    resetServiceRegistry();
    try {
        const srvRoot = await globalThis.WORK?.get_item?.('/SERVICES').catch(() => null);
        srvRoot?.reset?.();
    }
    catch { /* ignore */ }

    return { installed };
}

/** Включить или выключить MCP-сервер в `/SERVICES/<id>`. */
export async function setMcpServerEnabled({ id, enabled }, ctx = {}) {
    if (ctx?.session && !(await isAdmin(ctx.session)))
        throw new Error('Доступ запрещён: управлять MCP-серверами может только руководитель (BOSS)');
    const cleanId = normalizeMcpServerId(id);
    const clsFile = path.join(process.cwd(), 'SERVICES', cleanId, '$service', 'class.js');
    if (!fs.existsSync(clsFile))
        throw new Error(`MCP-сервер /SERVICES/${cleanId} не найден`);

    const item = await globalThis.WORK?.get_item?.('/SERVICES/' + cleanId).catch(() => null);
    const current = (item && typeof item.import === 'function' ? await item.import().catch(() => null) : null) || {};
    const updated = {
        icon: current.icon || 'carbon:plug',
        label: current.label || cleanId,
        description: current.description || `MCP-сервер ${cleanId}`,
        enabled: Boolean(enabled),
        mcp: current.mcp || {},
    };
    await fsp.writeFile(clsFile, `/** MCP-сервер ${updated.label} (/SERVICES/${cleanId}). */\nexport default ${JSON.stringify(updated, null, 4)};\n`, 'utf-8');
    resetServiceRegistry();
    item?.reset?.();
    return { id: cleanId, enabled: updated.enabled };
}

/** Удалить MCP-сервер `/SERVICES/<id>`. */
export async function removeMcpServer({ id }, ctx = {}) {
    if (ctx?.session && !(await isAdmin(ctx.session)))
        throw new Error('Доступ запрещён: удалять MCP-серверы может только руководитель (BOSS)');
    const cleanId = normalizeMcpServerId(id);
    const targetDir = path.join(process.cwd(), 'SERVICES', cleanId);
    if (!fs.existsSync(targetDir))
        throw new Error(`MCP-сервер /SERVICES/${cleanId} не найден`);
    await fsp.rm(targetDir, { recursive: true, force: true });
    resetServiceRegistry();
    try {
        const srvRoot = await globalThis.WORK?.get_item?.('/SERVICES').catch(() => null);
        srvRoot?.reset?.();
    }
    catch { /* ignore */ }
    return { id: cleanId, removed: true };
}

/** Проверить соединение с MCP-сервером `/SERVICES/<id>` и получить список его инструментов (`mcp_list_tools`). */
export async function inspectMcpServer({ id, place }, ctx = {}) {
    const cleanId = normalizeMcpServerId(id);
    const srvRoot = await globalThis.WORK?.get_item?.('/SERVICES').catch(() => null);
    srvRoot?.reset?.();
    const item = await globalThis.WORK?.get_item?.('/SERVICES/' + cleanId);
    if (!item || Array.isArray(item))
        throw new Error(`MCP-сервер /SERVICES/${cleanId} не найден`);
    await item.init;
    const res = await item.mcp_list_tools({
        place: place || '/SERVICES/' + cleanId,
        session: ctx?.session,
    });
    if (res?.error)
        return { id: cleanId, ok: false, error: String(res.error), tools: [] };
    const tools = Array.isArray(res?.tools) ? res.tools.map(t => ({
        name: t.name,
        agentToolName: `mcp_${cleanId}_${t.name}`.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64),
        description: t.description || '',
        required: Array.isArray(t.inputSchema?.required) ? t.inputSchema.required : [],
    })) : [];
    return { id: cleanId, ok: true, tools };
}
