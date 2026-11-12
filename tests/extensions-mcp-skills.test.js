import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import {
    discoverHostSkills,
    normalizeSkillUrl,
    extractMentionedSkills,
    formatMentionedSkillsBlock,
    formatMentionedAgentsAndToolsBlock,
    getPromptMentionsCatalog,
    parseMcpInstallInput,
    installExternalSkill,
    removeInstalledSkill,
    listSkillsCatalog,
    installMcpServers,
    listMcpCatalog,
    setMcpServerEnabled,
    removeMcpServer,
} from '../sources/modules/agent/extensions.js';
import { loadDocs } from '../sources/modules/agent/resources.js';

const ROOT = process.cwd();

describe('внешние навыки (SKILL.md / @skill) и управление MCP-серверами в /SERVICES', () => {
    let tmp;
    let prevCwd;
    const BOSS = 'CA4E097FF6C1D387';

    before(async () => {
        prevCwd = process.cwd();
        tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-ext-mcp-'));
        const write = (rel, data) => {
            const full = path.join(tmp, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, data);
        };
        write('$server/class.js', `export default { label: 'WORK', '#security': { BOSS: ['${BOSS}'] } }`);
        for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
            write(p + '/class.js', 'export default {}');
        write('$server/$folder/$class/ai/skills/grill-me/SKILL.md', fs.readFileSync(path.join(ROOT, '$server/$folder/$class/ai/skills/grill-me/SKILL.md'), 'utf-8'));
        write('$server/$folder/$class/ai/agents/analyst.md', fs.readFileSync(path.join(ROOT, '$server/$folder/$class/ai/agents/analyst.md'), 'utf-8'));
        write('$server/$folder/$class/ai/agents/explore.md', fs.readFileSync(path.join(ROOT, '$server/$folder/$class/ai/agents/explore.md'), 'utf-8'));
        write('SERVICES/$service/class.js', fs.readFileSync(path.join(ROOT, 'SERVICES/$service/class.js'), 'utf-8'));
        write('SERVICES/$service/$folder/$storage/$service/class.js', fs.readFileSync(path.join(ROOT, 'SERVICES/$service/$folder/$storage/$service/class.js'), 'utf-8'));
        write('SERVICES/$service/$folder/$storage/$service/handlers/pages/form/mcp/$handler/class.js', fs.readFileSync(path.join(ROOT, 'SERVICES/$service/$folder/$storage/$service/handlers/pages/form/mcp/$handler/class.js'), 'utf-8'));
        write('SERVICES/Weather/$service/class.js', fs.readFileSync(path.join(ROOT, 'SERVICES/Weather/$service/class.js'), 'utf-8'));

        process.chdir(tmp);
        globalThis.WORK = new $server();
    });

    after(async () => {
        process.chdir(prevCwd);
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    });

    it('папочный формат <id>/SKILL.md (grill-me) загружается через loadDocs и активируется по упоминанию @grill-me', async () => {
        const skills = await loadDocs(null, 'skills');
        assert.ok(skills.has('grill-me'), 'навык grill-me из папки <id>/SKILL.md загружен в карту навыков');
        const gm = skills.get('grill-me');
        assert.match(gm.meta.description, /Grill the user relentlessly/i);
        assert.match(gm.body, /design tree/i);

        const mentioned = extractMentionedSkills('@grill-me спроектируй архитектуру модуля', skills);
        assert.equal(mentioned.length, 1);
        assert.equal(mentioned[0].name, 'grill-me');

        const block = formatMentionedSkillsBlock(mentioned);
        assert.match(block, /<skill_content name="grill-me">/);
        assert.match(block, /# Skill: grill-me/);
    });

    it('normalizeSkillUrl преобразует ссылки GitHub blob и tree в прямые raw-ссылки на SKILL.md', () => {
        assert.equal(
            normalizeSkillUrl('https://github.com/anthropics/skills/blob/main/skills/grill-me/SKILL.md'),
            'https://raw.githubusercontent.com/anthropics/skills/main/skills/grill-me/SKILL.md',
        );
        assert.equal(
            normalizeSkillUrl('https://github.com/anthropics/skills/tree/main/skills/grill-me'),
            'https://raw.githubusercontent.com/anthropics/skills/main/skills/grill-me/SKILL.md',
        );
    });

    it('installExternalSkill и removeInstalledSkill устанавливают и удаляют внешние навыки, а discoverHostSkills видит локальные каталоги', async () => {
        const hostList = discoverHostSkills();
        assert.ok(Array.isArray(hostList), 'discoverHostSkills возвращает массив');

        const installed = await installExternalSkill({
            sourceType: 'content',
            id: 'custom-audit',
            content: '---\nname: custom-audit\ndescription: Проверка регламентов закупок\n---\n\nШаги проверки регламентов.',
            asFolder: true,
        }, { session: { uid: BOSS } });
        assert.equal(installed.id, 'custom-audit');
        assert.match(installed.path, /custom-audit\/SKILL\.md$/);

        const catalog = await listSkillsCatalog(null);
        assert.ok(catalog.installed.some(s => s.id === 'custom-audit'));

        const removed = await removeInstalledSkill({ id: 'custom-audit' }, { session: { uid: BOSS } });
        assert.equal(removed.removed, true);
    });

    it('parseMcpInstallInput и методы /SERVICES (mcp_install, mcp_catalog, mcp_toggle, mcp_remove) управляют MCP-серверами и прячут секреты в #secret', async () => {
        const parsed = parseMcpInstallInput({
            json: JSON.stringify({
                mcpServers: {
                    'memory-graph': {
                        command: 'npx',
                        args: ['-y', '@modelcontextprotocol/server-memory'],
                        env: { API_TOKEN: 'super-secret-123' },
                    },
                    'remote-crm': {
                        url: 'https://crm.example.com/mcp',
                        headers: { Authorization: 'Bearer tok-999' },
                    },
                },
            }),
        });
        assert.equal(parsed.length, 2);
        assert.equal(parsed[0].id, 'memory-graph');
        assert.equal(parsed[1].id, 'remote-crm');

        const servicesItem = await WORK.get_item('/SERVICES');
        await servicesItem.init;
        assert.equal(servicesItem.DATA.form, 'mcp', 'представление по умолчанию для /SERVICES — mcp');

        const installRes = await servicesItem.mcp_install({
            session: { uid: BOSS },
            post: {
                mcpServers: {
                    'memory-graph': {
                        command: 'npx',
                        args: ['-y', '@modelcontextprotocol/server-memory'],
                        env: { API_TOKEN: 'super-secret-123' },
                    },
                },
            },
        });
        assert.equal(installRes.installed.length, 1);
        assert.equal(installRes.installed[0].id, 'memory-graph');
        // Проверяем, что секрет не остался в открытом виде в class.js, а заменён на secret:api_token.txt
        assert.equal(installRes.installed[0].mcp.env.API_TOKEN, 'secret:api_token.txt');
        const clsText = fs.readFileSync(path.join(tmp, 'SERVICES/memory-graph/$service/class.js'), 'utf-8');
        assert.ok(!clsText.includes('super-secret-123'), 'открытый токен не записан в class.js');
        assert.ok(clsText.includes('secret:api_token.txt'), 'в class.js записана ссылка secret:api_token.txt');

        const cat = await servicesItem.mcp_catalog({ session: { uid: BOSS } });
        assert.equal(cat.mcpServers.length, 1);
        assert.equal(cat.mcpServers[0].id, 'memory-graph');
        assert.ok(cat.connectors.some(c => c.id === 'Weather'));
        assert.ok(cat.presets.length >= 6);
        assert.ok(cat.skills.some(s => s.id === 'grill-me'));

        // Выключение и удаление
        const toggled = await servicesItem.mcp_toggle({ session: { uid: BOSS }, id: 'memory-graph', enabled: false });
        assert.equal(toggled.enabled, false);

        const removed = await servicesItem.mcp_remove({ session: { uid: BOSS }, id: 'memory-graph' });
        assert.equal(removed.removed, true);
        const catAfter = await listMcpCatalog();
        assert.equal(catAfter.mcpServers.length, 0);
    });

    it('быстрый доступ @ в work-prompt-bar: mentions_catalog, директивы @agent / @tool и шаблон .mention-popup', async () => {
        const servicesItem = await WORK.get_item('/SERVICES');
        await servicesItem.init;
        const mentions = await servicesItem.mentions_catalog({});
        assert.ok(mentions.skills.some(s => s.id === 'grill-me'), 'в списке @ есть навык grill-me');
        assert.ok(mentions.agents.some(a => a.id === 'analyst') && mentions.agents.some(a => a.id === 'explore'), 'в списке @ есть субагенты analyst и explore');
        assert.ok(mentions.tools.some(t => t.id === 'report') && mentions.tools.some(t => t.id === 'write_table'), 'в списке @ есть прикладные инструменты');

        const agentsMap = await loadDocs(null, 'agents');
        const directives = formatMentionedAgentsAndToolsBlock('@analyst построй ОСВ через @report и проверь @mcp_filesystem', agentsMap);
        assert.match(directives, /<agent_directive name="analyst">/);
        assert.match(directives, /<tool_directive name="report">/);
        assert.match(directives, /<tool_directive name="mcp_filesystem">/);

        const barSrc = fs.readFileSync(path.join(ROOT, '$server/$folder/lib/prompt-bar/prompt-bar.js'), 'utf-8');
        assert.ok(barSrc.includes('class="mention-popup"'), 'в work-prompt-bar присутствует всплывающее меню .mention-popup');
        assert.ok(barSrc.includes('applyMention('), 'в work-prompt-bar реализована вставка выбранного @-элемента');
    });
});
