/**
 * Пакет ai/ (данные агента в дереве): субагенты, навыки, system.md сверены с реальными инструментами ядра.
 * Ловит рецепты, которые ссылаются на несуществующие инструменты и параметры, и расхождения индексов.
 */
import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../sources/modules/agent/util.js';
import { workTools } from '../sources/modules/agent/tools/work.js';
import { docTools } from '../sources/modules/agent/tools/docs.js';
import { memoryTools } from '../sources/modules/agent/tools/memory.js';
import { webTools } from '../sources/modules/agent/tools/services.js';
import { connectTools } from '../sources/modules/agent/tools/connect.js';
import { browseTools } from '../sources/modules/agent/tools/browse.js';
import { metaTools } from '../sources/modules/agent/tools/meta.js';
import { scheduleTools } from '../sources/modules/agent/tools/schedule.js';
import { osFileTools } from '../sources/modules/agent/tools/os-files.js';
import { osProcTools } from '../sources/modules/agent/tools/os-proc.js';
import { netTools } from '../sources/modules/agent/tools/net.js';
import { sandboxTools } from '../sources/modules/agent/tools/sandbox.js';
import { computerTools } from '../sources/modules/agent/tools/computer.js';
import { browserTools } from '../sources/modules/agent/tools/browser.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const AI = path.join(ROOT, '$server/$folder/$class/ai');
const PLACE_SKILLS = [path.join(ROOT, 'DATA/REGISTER/$register/ai/skills')];
const MAX_DESCRIPTION = 400; // список в system обрезается: смысл должен уместиться
const SUBAGENT_DENY = ['ask_user', 'todo_write', 'save_skill', 'connect_service', 'disconnect_service', 'schedule'];
const REQUIRES = ['system', 'sandbox'];

const TOOLS = [...workTools, ...docTools, ...memoryTools, ...webTools, ...connectTools, ...browseTools, ...metaTools,
    ...scheduleTools, ...osFileTools, ...osProcTools, ...netTools, ...sandboxTools, ...computerTools, ...browserTools];
const BY_NAME = new Map(TOOLS.map(t => [t.name, t]));
/** Инструменты, имена которых зависят от установленных сервисов (svc_<сервис>_<метод>, mcp_…). */
const dynamic = name => /^(svc|mcp)_/.test(name);
const matches = (mask, name) => new RegExp('^' + mask.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(name);

function docs(dir) {
    if (!fs.existsSync(dir))
        return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'readme.md').sort().map(file => {
        const text = fs.readFileSync(path.join(dir, file), 'utf-8');
        return { file, ...parseFrontmatter(text), text };
    });
}
const agents = docs(path.join(AI, 'agents'));
const skills = docs(path.join(AI, 'skills'));
const placeSkills = PLACE_SKILLS.flatMap(docs);
const read = rel => fs.readFileSync(path.join(AI, rel), 'utf-8');

/** `tool key=value …` в тексте рецептов (вне блоков кода). */
function toolCalls(text) {
    const plain = text.replace(/```[\s\S]*?```/g, '');
    const out = [];
    for (const m of plain.matchAll(/`([^`\n]+)`/g)) {
        const span = m[1].trim();
        const name = span.split(/[\s=]/)[0];
        if (!/^[a-z][a-z0-9_]*$/.test(name) || !BY_NAME.has(name))
            continue;
        const args = [...span.slice(name.length).matchAll(/(?:^|\s)([a-z_]+)=(\S*)/g)].map(a => ({ key: a[1], value: a[2] }));
        out.push({ span, name, args });
    }
    return out;
}

describe('ai/: субагенты', () => {
    it('фронтматтер: имя = файл, описание, допустимые поля', () => {
        assert.ok(agents.length >= 12);
        const names = new Set();
        for (const a of agents) {
            const id = a.file.replace(/\.md$/, '');
            assert.equal(a.meta.name, id, a.file + ': name должен совпадать с именем файла');
            assert.ok(!names.has(id), a.file + ': дубль');
            names.add(id);
            assert.ok(String(a.meta.description || '').length > 20, a.file + ': нет description');
            assert.ok(a.meta.description.length <= MAX_DESCRIPTION, a.file + ': description длиннее ' + MAX_DESCRIPTION + ' (' + a.meta.description.length + ')');
            assert.ok(a.body.length > 50, a.file + ': пустая роль');
            assert.ok(Number(a.meta.maxTurns) > 0, a.file + ': нужен maxTurns');
            assert.ok(a.meta.tools === 'readonly' || a.meta.tools === '*' || Array.isArray(a.meta.tools), a.file + ': tools — readonly | * | список');
            for (const r of [].concat(a.meta.requires ?? []))
                assert.ok(REQUIRES.includes(r), a.file + ': requires ' + r);
        }
    });

    it('tools: каждая маска находит инструмент; запрещённых субагенту нет; ОС — только с requires: system', () => {
        for (const a of agents.filter(a => Array.isArray(a.meta.tools))) {
            for (const mask of a.meta.tools) {
                assert.ok(!SUBAGENT_DENY.includes(mask), a.file + ': ' + mask + ' недоступен субагентам');
                assert.ok(dynamic(mask) || TOOLS.some(t => matches(mask, t.name)), a.file + ': нет инструмента «' + mask + '»');
            }
            if (a.meta.tools.some(m => /^(os_|net_|shell$)/.test(m)))
                assert.ok([].concat(a.meta.requires ?? []).includes('system'), a.file + ': ОС/сеть требуют requires: system');
            if (a.meta.tools.some(m => /^(computer_|browser_|sandbox_)/.test(m)))
                assert.ok([].concat(a.meta.requires ?? []).includes('sandbox'), a.file + ': песочнице нужен requires: sandbox');
        }
    });

    it('call: [методы] — только вместе с инструментом call', () => {
        for (const a of agents.filter(a => a.meta.call !== undefined)) {
            assert.ok(Array.isArray(a.meta.call) && a.meta.call.length, a.file + ': call — непустой список');
            assert.ok(Array.isArray(a.meta.tools) && a.meta.tools.includes('call'), a.file + ': call без инструмента call');
        }
        // «только чтение» держится кодом: у аудитора call ограничен
        assert.ok(agents.find(a => a.file === 'auditor.md').meta.call);
    });

    it('индекс agents/readme.md содержит каждого субагента', () => {
        const index = read('agents/readme.md');
        for (const a of agents)
            assert.ok(index.includes('(' + a.file + ')'), a.file + ' нет в agents/readme.md');
        for (const [, file] of index.matchAll(/\]\(([\w-]+\.md)\)/g))
            assert.ok(agents.some(a => a.file === file), 'в readme несуществующий ' + file);
    });
});

describe('ai/: навыки', () => {
    it('фронтматтер: имя = файл, описание, requires', () => {
        const names = new Set();
        for (const s of [...skills, ...placeSkills]) {
            const id = s.file.replace(/\.md$/, '');
            assert.equal(s.meta.name, id, s.file + ': name должен совпадать с именем файла');
            assert.ok(!names.has(id), s.file + ': дубль');
            names.add(id);
            assert.ok(String(s.meta.description || '').length > 20, s.file + ': нет description');
            assert.ok(s.meta.description.length <= MAX_DESCRIPTION, s.file + ': description длиннее ' + MAX_DESCRIPTION + ' (' + s.meta.description.length + ')');
            assert.ok(s.body.length > 100, s.file + ': пустой рецепт');
            for (const r of [].concat(s.meta.requires ?? []))
                assert.ok(REQUIRES.includes(r), s.file + ': requires ' + r);
        }
        assert.ok(skills.length >= 20);
    });

    it('индекс skills/readme.md содержит каждый навык пакета', () => {
        const index = read('skills/readme.md');
        for (const s of skills)
            assert.ok(index.includes('(' + s.file + ')'), s.file + ' нет в skills/readme.md');
        for (const [, file] of index.matchAll(/\]\(([\w-]+\.md)\)/g))
            assert.ok(skills.some(s => s.file === file), 'в readme несуществующий ' + file);
    });

    it('навыки, привязанные к месту, не лежат в пакете движка', () => {
        assert.ok(!skills.some(s => s.file === 'register-accounts.md'));
        assert.ok(placeSkills.some(s => s.file === 'register-accounts.md'));
    });
});

describe('ai/: рецепты сверены с инструментами ядра', () => {
    const all = [...agents, ...skills, ...placeSkills];

    it('инструменты ОС, сети и компьютера, названные в тексте, существуют', () => {
        for (const d of all) {
            const plain = d.text.replace(/```[\s\S]*?```/g, '');
            for (const [, token] of plain.matchAll(/`((?:os|net|computer|browser|sandbox)_[a-z_*]+)/g))
                assert.ok(TOOLS.some(t => matches(token, t.name)), d.file + ': нет инструмента «' + token + '»');
        }
    });

    it('параметры вида `инструмент ключ=значение` существуют в схеме инструмента', () => {
        let checked = 0;
        for (const d of all) {
            for (const call of toolCalls(d.text)) {
                const tool = BY_NAME.get(call.name);
                const props = tool.parameters?.properties || {};
                for (const { key, value } of call.args) {
                    assert.ok(key in props, d.file + ': у «' + call.name + '» нет параметра «' + key + '» (' + call.span + ')');
                    const allowed = props[key].enum;
                    if (allowed && /^[a-z_]+$/.test(value))
                        assert.ok(allowed.includes(value), d.file + ': «' + key + '=' + value + '» вне ' + allowed.join('|'));
                    checked++;
                }
            }
        }
        assert.ok(checked > 50, 'проверено параметров: ' + checked);
    });

    it('агенты с явным списком tools имеют инструменты, нужные их рецепту', () => {
        for (const a of agents.filter(a => Array.isArray(a.meta.tools))) {
            const have = name => a.meta.tools.some(m => matches(m, name)) || name === 'skill';
            // вызовом считается запись с параметрами (`send kind=order …`); простое упоминание («это делает assign») — нет
            for (const call of toolCalls(a.body).filter(c => c.args.length)) {
                if (SUBAGENT_DENY.includes(call.name) || dynamic(call.name))
                    continue;
                assert.ok(have(call.name), a.file + ': в роли вызывается `' + call.name + '`, а в tools его нет');
            }
        }
    });
});

describe('ai/: system.md, config.js, prompt', () => {
    it('system.md: правила безопасности и честности на месте', () => {
        const sys = read('system.md');
        assert.match(sys, /данные/);
        assert.match(sys, /escalate/);
        assert.match(sys, /Секреты/);
        assert.ok(sys.length < 6000, 'system.md растёт — это токены каждого запроса: ' + sys.length);
    });

    it('config.js: модель задана', async () => {
        const cfg = (await import('file:///' + path.join(AI, 'config.js').replace(/\\/g, '/'))).default;
        assert.match(cfg.model, /^\/MODELS\//);
    });

    it('prompt: пустой запрос отклоняется до запуска модели', async () => {
        const { default: method } = await import('file:///' + path.join(AI, 'prompt/$method/class.js').replace(/\\/g, '/'));
        await assert.rejects(method.execute({ prompt: '   ' }), /пустой запрос/);
        await assert.rejects(method.execute({ post: { x: 1 } }), /пустой запрос/);
        await assert.rejects(method.execute({ prompt: 'x'.repeat(20001) }), /слишком длинный/);
    });

    it('сумма описаний субагентов и навыков укладывается в бюджет system', () => {
        const total = [...agents, ...skills, ...placeSkills].reduce((n, d) => n + Math.min(400, d.meta.description.length) + d.meta.name.length + 4, 0);
        assert.ok(total < 16000, 'списки агентов и навыков в system: ' + total + ' символов');
    });
});
