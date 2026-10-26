/**
 * Инструменты разработчика (этап 6.2): grep/glob — арены work и sandbox.
 * Права по папкам и файлам, системные #-зоны не перечисляются, .eml и external-source
 * помечают ход untrusted; песочница — на фейковом Docker (ripgrep эмулируется по файлам).
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { $server } from '../sources/server/server.js';
import { devSearchTools, globToRegExp } from '../sources/modules/agent/tools/dev/search.js';
import { apply_patch, parsePatch, applyHunks } from '../sources/modules/agent/tools/dev/patch.js';
import { git_status, git_diff, git_log, git_show, git_blame, git_branch, git_commit, git_push } from '../sources/modules/agent/tools/dev/git.js';
import { run_checks } from '../sources/modules/agent/tools/dev/checks.js';
import { lsp_diagnostics, lsp_definition, lsp_references, lsp_rename, symbolAt } from '../sources/modules/agent/tools/dev/lsp.js';
import { createEnv } from '../sources/modules/agent/index.js';
import { decide } from '../sources/modules/agent/permissions.js';
import { collectUndo, applyUndo } from '../sources/modules/agent/undo.js';
import { getItem, writeFile, callAs } from '../sources/modules/agent/tools/work/common.js';
import { fakeDocker } from './helpers/fake-docker.js';
import { setDockerForTests, resetDockerForTests } from '../sources/modules/sandbox/driver.js';
import { ensureComputer, writeText, setNetwork } from '../sources/modules/sandbox/manager.js';
import { loadSandboxConfig } from '../sources/modules/sandbox/config.js';
import { markExternal, unmarkExternal, resetExternalSources } from '../sources/server/external-source.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const UID = 'DU00000000000001';
const ADMIN = 'admin';
let tmp, root, previous;
const grep = devSearchTools.find(t => t.name === 'grep');
const glob = devSearchTools.find(t => t.name === 'glob');

function write(p, data) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data, 'utf8');
}

function mkCtx(uid = UID, extra = {}) {
    return {
        entry: {},
        place: null,
        session: { uid },
        host: { mode: 'auto', allowed: new Set() },
        signal: new AbortController().signal,
        ...extra,
    };
}

before(async () => {
    previous = process.cwd();
    const tempRoot = path.join(process.env.TEMP || os.tmpdir(), 'opencode');
    await fsp.mkdir(tempRoot, { recursive: true });
    tmp = await fsp.mkdtemp(path.join(tempRoot, 'dev-tools-'));
    root = path.join(tmp, 'work');
    write(path.join(root, '$server/class.js'), `export default { '#security': { ADMIN: ['admin'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(path.join(root, p, 'class.js'), 'export default {}');
    write(path.join(root, 'BOX/$class/class.js'), `export default { label: 'К', '#security': { USER: ['${UID}'] } }`);
    write(path.join(root, 'BOX/$class/ai/memory.md'), 'память места\n');
    write(path.join(root, 'BOX/doc/a.md'), 'первая UNIQUE строка\nобычная строка\nтретья UNIQUE строка\n');
    write(path.join(root, 'BOX/doc/deep/b.js'), 'function greet() { return "UNIQUE"; } // case test\n');
    write(path.join(root, 'BOX/doc/letter.eml'), 'текст письма UNIQUE\n');
    write(path.join(root, 'BOX/doc/upl.md'), 'загруженный UNIQUE файл\n');
    write(path.join(root, 'BOX/doc/bin.dat'), '\0\0\0' + 'UNIQUE' + '\0');
    write(path.join(root, 'BOX/doc/trash.md'), 'мусор для удаления\n');
    write(path.join(root, 'BOX/doc/big.md'), 'x'.repeat(300 * 1024) + '\nUNIQUE внутри большого\n');
    // 6.5: TypeScript для диагностики и навигации
    write(path.join(root, 'SRC/mod.ts'), 'export function hello() { return 1; }\nexport const num: number = "not a number";\nconst y = hello();\n');
    // ловушка границы слова: helloWorld — НЕ вхождение hello
    write(path.join(root, 'SRC/other.ts'), 'const helloWorld = 1;\nconst other = 2;\n');
    // R15 (8.38): таблица для читателей чужих файлов
    write(path.join(root, 'BOX/doc/table.csv'), 'имя,возраст\nАнна,30\n');
    write(path.join(root, 'PRIV/$class/class.js'), `export default { label: 'Ч', '#security': { ADMIN: ['admin'] } }`);
    write(path.join(root, 'PRIV/x.md'), 'здесь HIDDENWORD\n');
    write(path.join(root, `USERS/${UID}/$user/class.js`), `export default { label: 'U' }`);
    write(path.join(root, `USERS/${UID}/$user/#secret/notes.md`), 'мой HIDDENWORD в заметках\n');
    write(path.join(root, 'MODELS/$class/class.js'), `export default { label: 'М', '#security': { USER: ['${UID}'] } }`);
    write(path.join(root, 'MODELS/m1/$ai/class.js'), `export default { model: 'm1' } // MODELWORD\n`);
    // 6.6: проверки сервера — скрипты package.json + #system/dev.json
    write(path.join(root, 'package.json'), JSON.stringify({
        name: 'dev-tools-test', private: true,
        scripts: { 'echo-ok': 'node -e "console.log(42)"', 'boom': 'node -e "process.exit(3)"' },
    }, null, 2));
    write(path.join(root, '#system/dev.json'), JSON.stringify({ checks: { hello: 'node -e "console.log(7)"' } }));
    // 6.5: TypeScript для диагностики и навигации
    write(path.join(root, 'SRC/mod.ts'), 'export function hello() { return 1; }\nexport const num: number = "not a number";\nconst y = hello();\n');
    // ловушка границы слова: helloWorld — НЕ вхождение hello
    write(path.join(root, 'SRC/other.ts'), 'const helloWorld = 1;\nconst other = 2;\n');
    // 6.7: агент-разработчик — настоящий файл движка (копия, как $task в agent-core)
    write(path.join(root, '$server/$folder/$class/ai/agents/developer.md'),
        fs.readFileSync(path.join(ROOT, '$server', '$folder', '$class', 'ai', 'agents', 'developer.md'), 'utf-8'));
    process.chdir(root);
    globalThis.WORK = new $server();
    // 6.4: git-репозиторий в корне тестового дерева (арена work) — скрытая .git в обходы не попадает
    execSync('git init -b main', { cwd: root });
    execSync('git config user.email work@test', { cwd: root });
    execSync('git config user.name "Work Test"', { cwd: root });
    execSync('git add BOX/doc/a.md', { cwd: root });
    execSync('git commit -m initial', { cwd: root });
});

after(async () => {
    resetDockerForTests();
    resetExternalSources();
    await new Promise(r => setTimeout(r, 300));
    process.chdir(previous);
    try {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
    catch { /* windows: индексная БД ещё держит файл */ }
});

describe('globToRegExp: перевод шаблона', () => {
    it('** любая глубина, * внутри сегмента, ? один символ', () => {
        const re = globToRegExp('**/*.js');
        assert.ok(re.test('a/b/c.js') && re.test('c.js'), 'любая глубина');
        assert.ok(!re.test('a/b/c.jsx'), 'суффикс целиком');
        assert.ok(globToRegExp('src/**/*.test.js').test('src/x/y.test.js'), 'префикс сегментом');
        assert.ok(!globToRegExp('src/**/*.test.js').test('other/x/y.test.js'), 'чужой префикс');
        assert.ok(globToRegExp('a?c.md').test('abc.md') && !globToRegExp('a?c.md').test('ac.md'), 'один символ');
        assert.ok(!globToRegExp('*.md').test('x/a.md'), 'звёздочка не пересекает сегменты');
        assert.throws(() => globToRegExp('/abs.js'), /glob-шаблон/);
        assert.throws(() => globToRegExp('../x.js'), /glob-шаблон/);
    });
});

describe('glob: арена work', () => {
    it('шаблон без «/» — имена на любой глубине; exclude убирает; без прав в папку не заходим', async () => {
        const out = await glob.run({ path: '/BOX', pattern: '*.md' }, mkCtx());
        assert.match(out, /BOX\/doc\/a\.md/, 'вложенный .md найден');
        assert.doesNotMatch(out, /b\.js/, '.js не .md');
        const ex = await glob.run({ path: '/BOX', pattern: '*.md', exclude: 'a.md' }, mkCtx());
        assert.doesNotMatch(ex, /a\.md/, 'исключённый шаблон убран');
        assert.match(ex, /upl\.md/, 'остальное на месте');
    });
    it('чужая зона без прав: имена файлов внутри не раскрываются; админ видит', async () => {
        const mine = await glob.run({ path: '/', pattern: '**/*.md' }, mkCtx(UID));
        assert.doesNotMatch(mine, /PRIV\/x\.md/, 'без прав имя файла чужой зоны не показано');
        const adm = await glob.run({ path: '/', pattern: '**/*.md' }, mkCtx(ADMIN));
        assert.match(adm, /PRIV\/x\.md/, 'админ видит');
        assert.doesNotMatch(adm, /#secret/, 'системная зона не перечисляется даже админом');
    });
    it('код в $-зонах (MODELS/…/$ai/class.js) находится админом; содержимое класса модели скрыто от обычной роли', async () => {
        const out = await glob.run({ path: '/', pattern: '**/*.js' }, mkCtx(ADMIN));
        assert.match(out, /MODELS\/m1\/\$ai\/class\.js/, '$-метазона найдена');
        const hit = await grep.run({ path: '/', text: 'MODELWORD' }, mkCtx(ADMIN));
        assert.match(hit, /MODELS\/m1\/\$ai\/class\.js:1:/, 'содержимое $-зоны читается админом');
        const mine = await grep.run({ path: '/', text: 'MODELWORD' }, mkCtx(UID));
        assert.equal(mine, 'ничего не найдено', 'внутрь чужого класса модели обычная роль не заходит');
    });
    it('кривой шаблон — понятная ошибка', async () => {
        await assert.rejects(glob.run({ path: '/BOX', pattern: '../*.md' }, mkCtx()), /glob-шаблон/);
    });
});

describe('grep: арена work', () => {
    it('совпадения с контекстом, регистр, маска файлов; счётчик в конце', async () => {
        const e = {};
        const out = await grep.run({ path: '/BOX', text: 'UNIQUE', context: 1 }, mkCtx(UID, { entry: e }));
        assert.match(out, /BOX\/doc\/a\.md:1: первая UNIQUE строка/);
        assert.match(out, /BOX\/doc\/a\.md-2- обычная строка/, 'контекст до/после');
        assert.match(out, /--/, 'разделитель между группами');
        assert.match(out, /deep\/b\.js:1:/);
        assert.match(out, /совпадений \d+ в \d+ файлах/);
        const ci = await grep.run({ path: '/BOX/doc', text: 'CASE TEST' }, mkCtx());
        assert.match(ci, /b\.js:1:/, 'без caseSensitive находится без учёта регистра');
        const cs = await grep.run({ path: '/BOX/doc', text: 'CASE TEST', caseSensitive: true }, mkCtx());
        assert.doesNotMatch(cs, /b\.js:1:/, 'с caseSensitive не находится');
        const masked = await grep.run({ path: '/BOX', text: 'UNIQUE', glob: '*.js' }, mkCtx());
        assert.match(masked, /b\.js:1:/);
        assert.doesNotMatch(masked, /a\.md:1:/, 'маска отсекла .md');
        await assert.rejects(grep.run({ path: '/BOX', regex: '([' }, mkCtx()), /некорректное регулярное/);
    });
    it('бинарный и большой файлы пропускаются', async () => {
        const out = await grep.run({ path: '/BOX/doc', text: 'UNIQUE' }, mkCtx());
        assert.doesNotMatch(out, /bin\.dat/, 'бинарный пропущен');
        assert.doesNotMatch(out, /big\.md/, 'больше 256 КБ пропущен');
    });
    it('права: чужая зона не читается; #-зона не перечисляется даже админом', async () => {
        const mine = await grep.run({ path: '/', text: 'HIDDENWORD' }, mkCtx(UID));
        assert.equal(mine, 'ничего не найдено', 'без прав совпадений чужой зоны нет');
        const adm = await grep.run({ path: '/', text: 'HIDDENWORD' }, mkCtx(ADMIN));
        assert.match(adm, /PRIV\/x\.md:1: здесь HIDDENWORD/, 'админ читает');
        assert.doesNotMatch(adm, /#secret/, 'системная зона не показана админу');
    });
    it('чужие файлы в результатах помечают ход untrusted (.eml и загрузка)', async () => {
        const eEml = {};
        await grep.run({ path: '/BOX/doc', text: 'UNIQUE' }, mkCtx(UID, { entry: eEml }));
        assert.equal(eEml.untrusted, true, 'совпадение в .eml не помечено чужим');
        markExternal('/BOX/doc/upl.md', 'upload');
        const eUpl = {};
        await grep.run({ path: '/BOX/doc', text: 'UNIQUE', glob: 'upl.md' }, mkCtx(UID, { entry: eUpl }));
        assert.equal(eUpl.untrusted, true, 'файл из загрузки не помечен чужим');
        unmarkExternal('/BOX/doc/upl.md');
        const eClean = {};
        await grep.run({ path: '/BOX/doc', text: 'UNIQUE', glob: 'a.md' }, mkCtx(UID, { entry: eClean }));
        assert.equal(eClean.untrusted, undefined, 'свои файлы ход не заражают');
    });
});

describe('grep/glob: арена sandbox', () => {
    it('находят по файлам контейнера; пусто; маска; интернет — untrusted', async () => {
        const docker = fakeDocker();
        setDockerForTests(docker);
        const cfg = loadSandboxConfig();
        const pc = await ensureComputer(docker, 'sbx-user', 'main', cfg);
        await writeText(docker, pc.id, '/workspace/src/app.js', 'function UNIQUE thing() {}\n', cfg);
        await writeText(docker, pc.id, '/workspace/src/readme.md', 'описание UNIQUE\n', cfg);
        const e1 = {};
        const out = await grep.run({ where: 'sandbox', text: 'UNIQUE' }, mkCtx('sbx-user', { entry: e1 }));
        assert.match(out, /src\/app\.js:1: function UNIQUE thing/);
        assert.match(out, /readme\.md:1: /);
        assert.equal(e1.untrusted, undefined, 'без интернета вывод не чужой');
        const masked = await grep.run({ where: 'sandbox', text: 'UNIQUE', glob: '*.js' }, mkCtx('sbx-user'));
        assert.match(masked, /app\.js/);
        assert.doesNotMatch(masked, /readme\.md/, 'маска не отсекла .md');
        const none = await grep.run({ where: 'sandbox', text: 'НЕТТАКОГО' }, mkCtx('sbx-user'));
        assert.match(none, /ничего не найдено/);
        const files = await glob.run({ where: 'sandbox', pattern: '*.js' }, mkCtx('sbx-user'));
        assert.match(files, /src\/app\.js/);
        assert.doesNotMatch(files, /readme\.md/, 'glob по маске не отсёк .md');
        await setNetwork(docker, pc.id, true, cfg);
        const e2 = {};
        await grep.run({ where: 'sandbox', text: 'UNIQUE' }, mkCtx('sbx-user', { entry: e2 }));
        assert.equal(e2.untrusted, true, 'с включённым интернетом вывод не помечен чужим');
        await setNetwork(docker, pc.id, false, cfg);
        resetDockerForTests();
    });
    it('без Docker — понятная ошибка, арена work работает', async () => {
        setDockerForTests(null); // «Docker недоступен» (без reset — он снял бы подмену)
        await assert.rejects(grep.run({ where: 'sandbox', text: 'x' }, mkCtx()), /песочница недоступна/);
        const out = await grep.run({ path: '/BOX/doc', text: 'UNIQUE' }, mkCtx());
        assert.match(out, /a\.md:1:/, 'арена work не зависит от Docker');
    });
});

describe('состав и режимы', () => {
    it('readonly: разрешены всегда, в т.ч. режим plan; входят в набор субагента readonly', async () => {
        assert.equal(grep.readonly, true);
        assert.equal((await decide(grep, { text: 'x' }, { host: { mode: 'plan' } })).verdict, 'allow');
        assert.equal((await decide(glob, { pattern: '*.js' }, { host: { mode: 'plan' } })).verdict, 'allow');
        const env = await createEnv({ place: WORK, session: { uid: UID } });
        const names = (await env.makeTools()).map(t => t.name);
        assert.ok(names.includes('grep') && names.includes('glob'), 'в основном наборе');
        const ro = (await env.makeTools({ meta: { tools: 'readonly' } })).map(t => t.name);
        assert.ok(ro.includes('grep') && ro.includes('glob'), 'в readonly-наборе субагента');
    });
});

// ── 6.3 (final): apply_patch ───────────────────────────────────────────────

const P = lines => lines.join('\n');

describe('parsePatch / applyHunks: разбор и применение', () => {
    it('секции Add/Update/Delete/Move; ханки применяются к строкам точно', () => {
        const ops = parsePatch(P([
            '*** Begin Patch',
            '*** Add File: a.md',
            '+один',
            '',
            '+два',
            '*** End Patch',
        ]));
        assert.equal(ops.length, 1);
        assert.equal(ops[0].kind, 'add');
        assert.equal(ops[0].path, 'a.md');
        assert.equal(ops[0].content.join('|'), 'один||два');
        const after = applyHunks('x\ny\nz\n', [{ lines: [
            { k: ' ', v: 'x' },
            { k: '-', v: 'y' },
            { k: '+', v: 'Y' },
            { k: ' ', v: 'z' },
        ] }], 't');
        assert.equal(after, 'x\nY\nz\n');
    });
    it('ошибки формата понятные', () => {
        assert.throws(() => parsePatch('нет начала'), /Begin Patch/);
        assert.throws(() => parsePatch('*** Begin Patch\n*** Add File: a\n+x'), /End Patch/);
        assert.throws(() => parsePatch(P(['*** Begin Patch', '*** Add File: a', 'без плюса', '*** End Patch'])), /без «\+»/);
        assert.throws(() => parsePatch(P(['*** Begin Patch', '*** Move File: a', '*** End Patch'])), /Move to/);
        assert.throws(() => parsePatch(P(['*** Begin Patch', '*** Add File: a', '+x', '*** Add File: a', '+y', '*** End Patch'])), /дважды/);
        assert.throws(() => parsePatch(P(['*** Begin Patch', '*** Update File: a', '@@', '+только плюс', '*** End Patch'])), /без строк для замены/);
    });
    it('ханк не найден или неоднозначен — ошибка, текст не меняется', () => {
        assert.throws(() => applyHunks('a\nb\n', [{ lines: [{ k: ' ', v: 'нет' }] }], 'f'), /не найден/);
        assert.throws(() => applyHunks('q\nq\n', [{ lines: [{ k: ' ', v: 'q' }] }], 'f'), /встречается 2 раз/);
        assert.throws(() => applyHunks('b\nb\nb\n', [{ lines: [
            { k: ' ', v: 'b' }, { k: '-', v: 'b' }, { k: '+', v: 'c' },
        ] }], 'f'), /встречается 2 раз/);
    });
});

describe('apply_patch: арена work', () => {
    let patchEntry = null; // карточка применения из первого теста: второй откатывает её
    const FULL = P([
        '*** Begin Patch',
        '*** Add File: /BOX/doc/added.md',
        '+новый файл',
        '+вторая строка',
        '*** Update File: /BOX/doc/a.md',
        '@@',
        ' первая UNIQUE строка',
        '-обычная строка',
        '+обычная строка (правка)',
        '*** Move File: /BOX/doc/upl.md',
        '*** Move to: /BOX/doc/renamed.md',
        '*** Delete File: /BOX/doc/trash.md',
        '*** End Patch',
    ]);

    it('создать/изменить/переместить/удалить одним вызовом; карточка с diff и записями отката на каждый файл', async () => {
        const entry = {};
        patchEntry = entry; // следующий тест откатывает именно это применение
        const out = await apply_patch.run({ patch: FULL }, mkCtx(ADMIN, { entry }));
        assert.match(out, /применён патч: 4 файлов/);
        assert.match(out, /создан .*added\.md/);
        assert.match(out, /изменён .*a\.md \(\+\d+ −\d+\)/);
        assert.match(out, /перемещён .*upl\.md → .*renamed\.md/);
        assert.match(out, /удалён .*trash\.md/);
        assert.equal(entry.undoList.length, 5, 'create + modify + (move: create+delete) + delete');
        assert.match(entry.diff, /## .*added\.md/);
        assert.match(entry.diff, /## .*a\.md/);
        // содержимое: правка применена, новый файл на месте, старое имя исчезло
        const g = await grep.run({ path: '/BOX', text: 'обычная строка (правка)' }, mkCtx(UID));
        assert.match(g, /a\.md:2:/);
        const found = await glob.run({ path: '/BOX', pattern: '**/*.md' }, mkCtx(UID));
        assert.match(found, /renamed\.md/);
        assert.doesNotMatch(found, /upl\.md/);
        assert.match(found, /added\.md/);
    });

    it('откат ленты (collectUndo + applyUndo) возвращает все файлы патча', async () => {
        assert.ok(patchEntry, 'предыдущий тест применил патч');
        const items = [{ id: 'a', type: 'assistant', time: 1, tools: [{ id: 't1', name: 'apply_patch', status: 'ok', ...patchEntry }] }];
        const { undo } = collectUndo(items);
        assert.equal(undo.length, 5, 'undoList разворачивается в записи по файлам');
        const uctx = mkCtx(ADMIN);
        const rep = await applyUndo(undo, {
            getItem: p => getItem(p, uctx),
            callAs: (item, method, args) => callAs(item, method, args, uctx),
            writeFile: (p, text) => writeFile(p, text, uctx),
        });
        assert.equal(rep.skipped.length, 0, 'пропусков нет: ' + JSON.stringify(rep.skipped));
        assert.equal(rep.reverted.length, 5);
        // всё как было: правки нет, добавленного нет, переименование отменено, удалённый вернулся
        const g = await grep.run({ path: '/BOX', text: 'обычная строка (правка)' }, mkCtx(UID));
        assert.equal(g, 'ничего не найдено');
        const found = await glob.run({ path: '/BOX', pattern: '**/*.md' }, mkCtx(UID));
        assert.match(found, /upl\.md/, 'перемещённый вернулся на старое имя');
        assert.doesNotMatch(found, /renamed\.md/);
        assert.doesNotMatch(found, /added\.md/, 'созданный удалён откатом');
        const dat = await glob.run({ path: '/BOX', pattern: '**/trash.md' }, mkCtx(UID));
        assert.match(dat, /trash\.md/, 'удалённый восстановлен');
    });

    it('права: USER не правит папки класса; атомарно и при отказе прав', async () => {
        const mem = P([
            '*** Begin Patch',
            '*** Update File: /BOX/doc/a.md',
            '@@',
            ' первая UNIQUE строка',
            '*** End Patch',
        ]);
        await assert.rejects(apply_patch.run({ patch: mem }, mkCtx(UID)), /Доступ запрещён|сбой/);
        const g = await grep.run({ path: '/BOX', text: 'обычная строка' }, mkCtx(UID));
        assert.match(g, /a\.md:2:/, 'файл не тронут');
    });

    it('атомарно: один битый ханк — ничего не записано', async () => {
        const bad = P([
            '*** Begin Patch',
            '*** Add File: /BOX/doc/broken-added.md',
            '+появлюсь?',
            '*** Update File: /BOX/doc/a.md',
            '@@',
            ' строки, которой нет',
            '*** End Patch',
        ]);
        await assert.rejects(apply_patch.run({ patch: bad }, mkCtx(ADMIN)), /не найден/);
        const found = await glob.run({ path: '/BOX', pattern: '**/broken-added.md' }, mkCtx(UID));
        assert.match(found, /ничего не найдено/, 'файл из упавшего патча не создан');
        const g = await grep.run({ path: '/BOX', text: 'обычная строка' }, mkCtx(UID));
        assert.match(g, /a\.md:2:/, 'исходный файл не тронут');
    });

    it('файл памяти ai/memory.md — отказ (F30); защищённая зона — подтверждение', async () => {
        const mem = P([
            '*** Begin Patch',
            '*** Update File: /BOX/$class/ai/memory.md',
            '@@',
            ' память места',
            '+новое правило из патча',
            '*** End Patch',
        ]);
        await assert.rejects(apply_patch.run({ patch: mem }, mkCtx(ADMIN)), /memory/);
        const sys = P([
            '*** Begin Patch',
            '*** Update File: /sources/x.js',
            '@@',
            '*** End Patch',
        ]);
        assert.equal((await decide(apply_patch, { patch: sys }, { host: { mode: 'auto' } })).verdict, 'ask',
            'системный код — с вопроса (как у write/edit)');
        const sbxVerdict = await decide(apply_patch, { where: 'sandbox', patch: sys }, { host: { mode: 'auto' } });
        assert.equal(sbxVerdict.verdict, 'allow', 'песочница — без вопроса в auto');
    });

    it('Add поверх существующего файла — отказ (не перезаписывает молча)', async () => {
        const over = P([
            '*** Begin Patch',
            '*** Add File: /BOX/doc/a.md',
            '+перезапись без спроса?',
            '*** End Patch',
        ]);
        await assert.rejects(apply_patch.run({ patch: over }, mkCtx(ADMIN)), /уже есть/);
    });
});

describe('apply_patch: арена sandbox', () => {
    it('добавить/изменить/переместить/удалить; баки вычищены', async () => {
        const docker = fakeDocker();
        setDockerForTests(docker);
        const cfg = loadSandboxConfig();
        const pc = await ensureComputer(docker, 'sbx-user', 'main', cfg);
        await writeText(docker, pc.id, '/workspace/src/app.js', 'function hello() {}\n', cfg);
        await writeText(docker, pc.id, '/workspace/src/old.md', 'старый текст\n', cfg);
        await writeText(docker, pc.id, '/workspace/src/extra.md', 'лишний\n', cfg);
        const patch = P([
            '*** Begin Patch',
            '*** Add File: new.js',
            '+console.log("hi");',
            '*** Update File: src/app.js',
            '@@',
            ' function hello() {}',
            '+function world() {}',
            '*** Move File: src/old.md',
            '*** Move to: src/moved.md',
            '*** Delete File: src/extra.md',
            '*** End Patch',
        ]);
        const entry = {};
        const out = await apply_patch.run({ where: 'sandbox', patch }, mkCtx('sbx-user', { entry }));
        assert.match(out, /применён патч: 4 файлов/);
        assert.match(out, /изменён .*src\/app\.js/);
        const g = await grep.run({ where: 'sandbox', text: 'world' }, mkCtx('sbx-user'));
        assert.match(g, /src\/app\.js:2:/);
        const files = await glob.run({ where: 'sandbox', pattern: '*' }, mkCtx('sbx-user'));
        assert.match(files, /new\.js/);
        assert.match(files, /moved\.md/);
        assert.doesNotMatch(files, /extra\.md/, 'удалённого нет');
        assert.doesNotMatch(files, /old\.md/, 'перемещённого нет');
        for (const junk of ['**/*.ap-bak', '**/*.ap-tmp'])
            assert.match(await glob.run({ where: 'sandbox', pattern: junk }, mkCtx('sbx-user')), /ничего не найдено/, junk + ' вычищен');
        assert.match(entry.diff, /## .*src\/app\.js/);
        resetDockerForTests();
    });

    it('сбой записи в песочнице — записанное откачено из баков', async () => {
        const docker = fakeDocker({ failMvOn: 2 }); // первый mv (app.js) проходит, второй (gone.js) падает
        setDockerForTests(docker);
        const cfg = loadSandboxConfig();
        const pc = await ensureComputer(docker, 'sbx-user', 'main', cfg);
        await writeText(docker, pc.id, '/workspace/src/app.js', 'function hello() {}\n', cfg);
        const patch = P([
            '*** Begin Patch',
            '*** Update File: src/app.js',
            '@@',
            ' function hello() {}',
            '+function world() {}',
            '*** Add File: gone.js',
            '+создамусь и исчезну',
            '*** End Patch',
        ]);
        // app.js применён, gone.js падает: откат возвращает app.js из бака и убирает мусор
        await assert.rejects(apply_patch.run({ where: 'sandbox', patch }, mkCtx('sbx-user')), /откачено/);
        const files = await glob.run({ where: 'sandbox', pattern: '*' }, mkCtx('sbx-user'));
        assert.doesNotMatch(files, /gone\.js/, 'созданное убрано откатом');
        assert.doesNotMatch(files, /\.ap-bak|\.ap-tmp/, 'баки и временные вычищены и после сбоя');
        const g = await grep.run({ where: 'sandbox', text: 'world' }, mkCtx('sbx-user'));
        assert.equal(g, 'ничего не найдено', 'app.js вернулся к прежнему виду из бака');
        resetDockerForTests();
    });

    it('валидация до записи: обновление несуществующего — отказ без изменений', async () => {
        const docker = fakeDocker();
        setDockerForTests(docker);
        const cfg = loadSandboxConfig();
        const pc = await ensureComputer(docker, 'sbx-user', 'main', cfg);
        const patch = P([
            '*** Begin Patch',
            '*** Add File: solo.js',
            '+x',
            '*** Update File: src/no-such.js',
            '@@',
            ' контекст',
            '*** End Patch',
        ]);
        await assert.rejects(apply_patch.run({ where: 'sandbox', patch }, mkCtx('sbx-user')), /не найден/);
        const files = await glob.run({ where: 'sandbox', pattern: 'solo.js' }, mkCtx('sbx-user'));
        assert.match(files, /ничего не найдено/, 'из упавшего патча ничего не создано');
        resetDockerForTests();
    });
});

// ── 6.4 (final): git ───────────────────────────────────────────────────────

describe('git: арена work', () => {
    it('чтения: status/diff/log/show/blame — сразу, вывод git', async () => {
        const st = await git_status.run({}, mkCtx(ADMIN));
        assert.match(st, /## main/);
        const log = await git_log.run({ limit: 5 }, mkCtx(ADMIN));
        assert.match(log, /initial/, 'коммит в истории');
        const show = await git_show.run({ ref: 'HEAD' }, mkCtx(ADMIN));
        assert.match(show, /BOX\/doc\/a\.md/, 'файл коммита');
        const blame = await git_blame.run({ path: 'BOX/doc/a.md' }, mkCtx(ADMIN));
        assert.match(blame, /первая UNIQUE строка/, 'строки файла с авторством');
        const diff = await git_diff.run({ path: 'BOX/doc/a.md' }, mkCtx(ADMIN));
        assert.match(diff, /(пусто|diff|UNIQUE)/, 'diff без ошибок');
        assert.equal((await decide(git_status, {}, { host: { mode: 'plan' } })).verdict, 'allow', 'readonly — в plan-режиме');
    });
    it('только администратору: USER — отказ с подсказкой песочницы', async () => {
        await assert.rejects(git_status.run({}, mkCtx(UID)), /только администратору/);
        assert.equal((await decide(git_branch, { branch: 'x' }, { host: { mode: 'auto' } })).verdict, 'allow', 'создание ветки — risk write');
    });
    it('валидации: ref-инъекция опций, пути вне репозитория, имена веток', async () => {
        await assert.rejects(git_show.run({ ref: '--upload-pack=x' }, mkCtx(ADMIN)), /недопустимое значение ref/);
        await assert.rejects(git_show.run({ ref: '../.git/config' }, mkCtx(ADMIN)), /недопустимое значение ref/);
        await assert.rejects(git_diff.run({ path: '../../secret' }, mkCtx(ADMIN)), /недопустимый путь/);
        await assert.rejects(git_blame.run({ path: '-опция' }, mkCtx(ADMIN)), /недопустимый путь/);
        await assert.rejects(git_branch.run({ branch: '../evil' }, mkCtx(ADMIN)), /недопустимое значение имя ветки/);
        await assert.rejects(git_commit.run({ message: 'x', paths: ['../evil'] }, mkCtx(ADMIN)), /недопустимый путь/);
        await assert.rejects(git_push.run({ remote: '-oОпция' }, mkCtx(ADMIN)), /недопустимый remote/);
    });
    it('git_commit: коммит создаётся, хеш в ответе, появляется в log; подтверждение каждый раз', async () => {
        assert.equal((await decide(git_commit, { message: 'тест' }, { host: { mode: 'auto', allowed: new Set(['git_commit']) } })).verdict, 'ask',
            'даже с «разрешить всегда» — вопрос');
        assert.equal((await decide(git_commit, { message: 'тест' }, { host: { mode: 'auto' } })).noAlways, true, 'без «разрешить всегда»');
        const before = await git_log.run({ limit: 1 }, mkCtx(ADMIN));
        const out = await git_commit.run({ message: 'коммит из теста', paths: ['BOX/doc/deep/b.js'] }, mkCtx(ADMIN));
        assert.match(out, /коммит из теста/);
        assert.match(out, /\([0-9a-f]{7,}\)/, 'хеш в ответе');
        const after = await git_log.run({ limit: 1 }, mkCtx(ADMIN));
        assert.notEqual(before, after, 'новый коммит в истории');
        const branch = await git_branch.run({ branch: 'feature-x' }, mkCtx(ADMIN));
        assert.match(branch, /пусто|создана|\(пусто\)/);
    });
    it('git_push: настоящий push в bare-репозиторий; подтверждение без «всегда», заражённый ход — вопрос', async () => {
        const v = await decide(git_push, { remote: 'origin' }, { host: { mode: 'auto', allowed: new Set(['git_push']) } });
        assert.equal(v.verdict, 'ask');
        assert.equal(v.noAlways, true, 'без «разрешить всегда»');
        const tainted = await decide(git_push, { remote: 'origin' }, { host: { mode: 'auto', allowed: new Set(['git_push']) }, tainted: ['web_fetch'] });
        assert.equal(tainted.verdict, 'ask', 'в заражённом ходе — вопрос');
        assert.equal(tainted.noAlways, true);
        const bareRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dev-bare-'));
        const bare = path.join(bareRoot, 'bare.git');
        execSync('git init --bare -b main bare.git', { cwd: bareRoot });
        execSync('git remote add origin "' + bare + '"', { cwd: root });
        try {
            const out = await git_push.run({ remote: 'origin', ref: 'main' }, mkCtx(ADMIN));
            assert.match(out, /отправлено|main|→|пусто|\(пусто\)/);
            const head = execSync('git --git-dir="' + bare + '" rev-parse --short HEAD', { encoding: 'utf8' }).trim();
            assert.match(head, /^[0-9a-f]{7,}$/, 'коммит дошёл до bare-репозитория');
        }
        finally {
            execSync('git remote remove origin', { cwd: root }).toString();
            await fsp.rm(bareRoot, { recursive: true, force: true }).catch(() => {});
        }
    });
    it('субагенту push не выдаётся, остальные git_* — по явной маске', async () => {
        const env = await createEnv({ place: WORK, session: { uid: ADMIN } });
        const main = (await env.makeTools()).map(t => t.name);
        assert.ok(main.includes('git_push') && main.includes('git_commit'), 'в основном наборе');
        const sub = (await env.makeTools({ meta: { tools: 'git_*' } })).map(t => t.name);
        assert.ok(sub.includes('git_commit') && sub.includes('git_status'), 'по маске — остальные git');
        assert.ok(!sub.includes('git_push'), 'push субагенту не выдаётся');
        const all = (await env.makeTools({ meta: { tools: '*' } })).map(t => t.name);
        assert.ok(!all.includes('git_push'), 'даже «*» не включает push');
    });
});

describe('git: арена sandbox', () => {
    it('те же инструменты через docker exec (массив аргументов без sh)', async () => {
        const docker = fakeDocker();
        setDockerForTests(docker);
        const st = await git_status.run({ where: 'sandbox' }, mkCtx('sbx-user'));
        assert.match(st, /## main/, 'вывод git песочницы');
        const log = await git_log.run({ where: 'sandbox' }, mkCtx('sbx-user'));
        assert.match(log, /initial commit/, 'история песочницы');
        const commit = await git_commit.run({ where: 'sandbox', message: 'sandbox коммит', paths: ['src/app.js'] }, mkCtx('sbx-user'));
        assert.match(commit, /1234567|sandbox коммит/, 'коммит в песочнице');
        const show = await git_show.run({ where: 'sandbox', ref: 'HEAD' }, mkCtx('sbx-user'));
        assert.match(show, /commit HEAD/, 'ref передаётся аргументом');
        await assert.rejects(git_show.run({ where: 'sandbox', ref: '--upload-pack=x' }, mkCtx('sbx-user')), /недопустимое значение ref/);
        resetDockerForTests();
    });
});

// ── 6.6 (final): run_checks ────────────────────────────────────────────────

describe('run_checks', () => {
    it('арена work: список без name; проверки из dev.json и package.json; код возврата', async () => {
        const list = await run_checks.run({ where: 'work' }, mkCtx(ADMIN));
        assert.match(list, /доступные проверки/);
        assert.match(list, /hello/);
        assert.match(list, /echo-ok/);
        const dev = await run_checks.run({ where: 'work', name: 'hello' }, mkCtx(ADMIN));
        assert.match(dev, /код возврата 0/);
        assert.match(dev, /7/, 'вывод проверки из #system/dev.json');
        const script = await run_checks.run({ where: 'work', name: 'echo-ok' }, mkCtx(ADMIN));
        assert.match(script, /код возврата 0/);
        assert.match(script, /42/, 'вывод скрипта package.json');
        const fail = await run_checks.run({ where: 'work', name: 'boom' }, mkCtx(ADMIN));
        assert.match(fail, /код возврата 3/, 'код возврата не провала');
    });
    it('только администратору; неизвестная проверка — отказ со списком', async () => {
        await assert.rejects(run_checks.run({ where: 'work', name: 'echo-ok' }, mkCtx(UID)), /только администратору/);
        await assert.rejects(run_checks.run({ where: 'work', name: 'no-such-check' }, mkCtx(ADMIN)), /нет проверки/);
    });
    it('подтверждение: work — вопрос каждый раз (без «всегда»), список и песочница — свободно', async () => {
        const v = await decide(run_checks, { where: 'work', name: 'echo-ok' }, { host: { mode: 'auto', allowed: new Set(['run_checks']) } });
        assert.equal(v.verdict, 'ask', 'даже с «разрешить всегда» — вопрос');
        assert.equal(v.noAlways, true, '«разрешить всегда» не предлагается');
        assert.equal((await decide(run_checks, { where: 'work' }, { host: { mode: 'ask' } })).verdict, 'allow', 'список — чтение, не запуск');
        assert.equal((await decide(run_checks, { where: 'sandbox', command: 'npm test' }, { host: { mode: 'auto' } })).verdict, 'allow');
    });
    it('арена sandbox: свободная команда, вывод с потолком (начало+конец), интернет — untrusted', async () => {
        const docker = fakeDocker();
        setDockerForTests(docker);
        const cfg = loadSandboxConfig();
        const pc = await ensureComputer(docker, 'sbx-user', 'main', cfg);
        const e1 = {};
        const ok = await run_checks.run({ where: 'sandbox', command: 'echo multi' }, mkCtx('sbx-user', { entry: e1 }));
        assert.match(ok, /код возврата 0/);
        assert.match(ok, /line1/);
        assert.match(ok, /\[stderr\]/, 'stderr не показан');
        assert.equal(e1.untrusted, undefined, 'без интернета вывод не чужой');
        const big = await run_checks.run({ where: 'sandbox', command: 'echo ' + 'x'.repeat(40 * 1024) }, mkCtx('sbx-user'));
        assert.match(big, /пропущено \d+ символов вывода/, 'потолок вывода не работает');
        const hang = await run_checks.run({ where: 'sandbox', command: 'hang' }, mkCtx('sbx-user'));
        assert.match(hang, /таймаут/, 'код 124 не показан как таймаут');
        await setNetwork(docker, pc.id, true, cfg);
        const e2 = {};
        await run_checks.run({ where: 'sandbox', command: 'echo ok' }, mkCtx('sbx-user', { entry: e2 }));
        assert.equal(e2.untrusted, true, 'с включённым интернетом чужой код не помечен');
        await setNetwork(docker, pc.id, false, cfg);
        resetDockerForTests();
    });
    it('run_checks в основном наборе; субагенту — по явной маске run_checks', async () => {
        const env = await createEnv({ place: WORK, session: { uid: UID } });
        const names = (await env.makeTools()).map(t => t.name);
        assert.ok(names.includes('run_checks'), 'в основном наборе');
        const sub = (await env.makeTools({ meta: { tools: 'run_checks' } })).map(t => t.name);
        assert.ok(sub.includes('run_checks'), 'по маске');
    });
});

// ── 6.5 (final): lsp ───────────────────────────────────────────────────────

describe('lsp: символ под позицией (юнит)', () => {
    it('слово под колонкой; пробел/конец строки — пусто', () => {
        const at = symbolAt('const y = hello();\n', 1, 11);
        assert.equal(at?.symbol, 'hello', 'идентификатор под позицией');
        assert.equal(symbolAt('const y =  hello();\n', 1, 9), null, 'позиция в пробеле — не слово');
        assert.equal(symbolAt('abc def\n', 1, 1)?.symbol, 'abc', 'начало строки');
        assert.equal(symbolAt('abc\n', 2, 1), null, 'нет строки');
        assert.equal(symbolAt('abc def\n', 1, 99), null, 'за концом строки');
    });
});

describe('lsp: арена work', () => {
    it('диагностика настоящим tsc: ошибка с позицией', async () => {
        const out = await lsp_diagnostics.run({ path: '/SRC/mod.ts' }, mkCtx(ADMIN));
        assert.match(out, /TS2322/, 'компилятор не нашёл ошибку типов');
        assert.match(out, /mod\.ts\(2,/, 'позиция ошибки');
    }, 90_000);
    it('определение и вхождения символа под позицией', async () => {
        const def = await lsp_definition.run({ path: '/SRC/mod.ts', line: 3, column: 11 }, mkCtx(ADMIN));
        assert.match(def, /hello/, 'символ не распознан');
        assert.match(def, /mod\.ts:1/, 'объявление не найдено');
        const refs = await lsp_references.run({ path: '/SRC/mod.ts', line: 3, column: 11 }, mkCtx(ADMIN));
        assert.match(refs, /вхождения «hello»: 2/, 'объявление + использование');
        assert.match(refs, /\[объявление\]/, 'объявление не помечено');
    }, 60_000);
    it('rename — только план: файл не меняется', async () => {
        const plan = await lsp_rename.run({ path: '/SRC/mod.ts', line: 3, column: 11, new_name: 'greeting' }, mkCtx(ADMIN));
        assert.match(plan, /hello» → «greeting/, 'план не назван');
        assert.match(plan, /edit или apply_patch/, 'нет подсказки о применении');
        const g = await grep.run({ path: '/SRC', text: 'hello' }, mkCtx(ADMIN));
        assert.match(g, /mod\.ts:1:/, 'файл изменён rename-ом — а он readonly');
    }, 60_000);
    it('только администратору; язык файла и позиция проверяются', async () => {
        await assert.rejects(lsp_diagnostics.run({ path: '/SRC/mod.ts' }, mkCtx(UID)), /только администратору/);
        await assert.rejects(lsp_definition.run({ path: '/SRC/mod.ts', line: 3, column: 11 }, mkCtx(UID)), /только администратору/);
        await assert.rejects(lsp_definition.run({ path: '/BOX/doc/a.md', line: 1, column: 5 }, mkCtx(ADMIN)), /не поддерживается/);
        await assert.rejects(lsp_definition.run({ path: '/SRC/mod.ts', line: 1, column: 7 }, mkCtx(ADMIN)), /нет идентификатора/,
            'позиция в пробеле должна отказать');
    }, 60_000);
});

describe('lsp: арена sandbox', () => {
    it('диагностика, определение, вхождения; интернет — untrusted', async () => {
        const docker = fakeDocker();
        setDockerForTests(docker);
        const cfg = loadSandboxConfig();
        const pc = await ensureComputer(docker, 'sbx-user', 'main', cfg);
        await writeText(docker, pc.id, '/workspace/src/mod.ts',
            'export function hello() { return 1; }\nexport const num: number = "not a number";\nconst y = hello();\n', cfg);
        const diag = await lsp_diagnostics.run({ where: 'sandbox', path: 'src/mod.ts' }, mkCtx('sbx-user'));
        assert.match(diag, /TS-test/, 'эмуляция tsc не вызвана');
        assert.match(diag, /mod\.ts\(2,/, 'позиция ошибки');
        const def = await lsp_definition.run({ where: 'sandbox', path: 'src/mod.ts', line: 3, column: 11 }, mkCtx('sbx-user'));
        assert.match(def, /mod\.ts:1/, 'объявление не найдено (rg --column --word-match)');
        const refs = await lsp_references.run({ where: 'sandbox', path: 'src/mod.ts', line: 3, column: 11 }, mkCtx('sbx-user'));
        assert.match(refs, /вхождения «hello»: 2/);
        await assert.rejects(lsp_rename.run({ where: 'sandbox', path: '../../etc/x.ts', line: 1, column: 1 }, mkCtx('sbx-user')), /вне рабочей папки|нужен путь/,
            'путь вне песочницы не отбит');
        await setNetwork(docker, pc.id, true, cfg);
        const e = {};
        await lsp_references.run({ where: 'sandbox', path: 'src/mod.ts', line: 3, column: 11 }, mkCtx('sbx-user', { entry: e }));
        assert.equal(e.untrusted, true, 'с включённым интернетом чужой код не помечен');
        await setNetwork(docker, pc.id, false, cfg);
        resetDockerForTests();
    });
    it('lsp-инструменты в основном наборе', async () => {
        const env = await createEnv({ place: WORK, session: { uid: UID } });
        const names = (await env.makeTools()).map(t => t.name);
        for (const n of ['lsp_diagnostics', 'lsp_definition', 'lsp_references', 'lsp_rename'])
            assert.ok(names.includes(n), n);
    });
});

// ── 6.7 (final): агент-разработчик ─────────────────────────────────────────

describe('developer: субагент-разработчик', () => {
    const devFile = () => fs.readFileSync(path.join(ROOT, '$server', '$folder', '$class', 'ai', 'agents', 'developer.md'), 'utf-8');
    const devDef = async () => (await import('../sources/modules/agent/util.js')).parseFrontmatter(devFile());

    it('фронтматтер: маски инструментов, requires — обе арены', async () => {
        const def = await devDef();
        assert.equal(def.meta.name, 'developer');
        assert.ok(Array.isArray(def.meta.tools) && def.meta.tools.length > 5, 'маски — список');
        assert.deepEqual(def.meta.requires, ['system', 'sandbox'], 'требуется хотя бы одна арена');
        assert.ok(def.body.includes('apply_patch'), 'тело не ведёт к правкам инструментами правки');
    });

    it('виден, когда доступна ХОТЯ БЫ ОДНА арена; без арен — скрыт', async () => {
        // админ без Docker: арена work есть — виден
        setDockerForTests(null); // «Docker недоступен» (подмена сбрасывает кэш доступности)
        const adm = await createEnv({ place: WORK, session: { uid: ADMIN } });
        assert.ok(adm.agents.has('developer'), 'админ без Docker не видит developer (арена work недоступна?)');
        // не-админ без Docker: ни одной арены — скрыт
        const user = await createEnv({ place: WORK, session: { uid: UID } });
        assert.ok(!user.agents.has('developer'), 'без арен developer всё равно виден');
        // не-админ С Docker: арена sandbox есть — виден (ИЛИ, не И)
        setDockerForTests(fakeDocker());
        const dockerUser = await createEnv({ place: WORK, session: { uid: UID } });
        assert.ok(dockerUser.agents.has('developer'), 'не-админ с Docker не видит developer (требуется И вместо ИЛИ?)');
        resetDockerForTests();
    });

    it('набор: инструменты разработчика есть, git_push и os_* — нет', async () => {
        const env = await createEnv({ place: WORK, session: { uid: ADMIN } });
        const def = await devDef();
        const names = (await env.makeTools(def, 0)).map(t => t.name);
        for (const want of ['grep', 'glob', 'apply_patch', 'git_commit', 'git_status', 'run_checks', 'lsp_diagnostics', 'lsp_rename', 'read', 'edit'])
            assert.ok(names.includes(want), want + ' нет в наборе developer');
        assert.ok(!names.includes('git_push'), 'push выдан субагенту');
        assert.ok(!names.some(n => n.startsWith('os_')), 'инструменты ОС попали в набор без requires: system');
        // skill добавляется всегда
        assert.ok(names.includes('skill'));
    });

    it('пересечение с родителем: readonly-родитель не даёт developer правку', async () => {
        const env = await createEnv({ place: WORK, session: { uid: ADMIN } });
        const def = await devDef();
        const parent = await env.makeTools({ meta: { tools: 'readonly' } });
        const names = (await env.makeTools(def, 1, parent)).map(t => t.name);
        assert.ok(names.includes('grep') && names.includes('read'), 'чтение должно остаться');
        assert.ok(!names.includes('apply_patch') && !names.includes('edit'), 'делегирование расширило права записи');
    });
});

// ── R15 (final 8.38): читатели чужих файлов помечают ход ──────────────────

describe('R15: чужой текст помечают все читатели', () => {
    it('юнит markUntrustedByPaths: письмо и внешний источник; свои файлы — чисто', async () => {
        const { markUntrustedByPaths } = await import('../sources/modules/agent/tools/work/common.js');
        const eml = { entry: {} };
        await markUntrustedByPaths(['/BOX/doc/mail.eml'], eml);
        assert.equal(eml.entry.untrusted, true, 'письмо не помечено');
        markExternal('/BOX/doc/uploaded.csv', 'upload');
        const ext = { entry: {} };
        await markUntrustedByPaths(['/BOX/doc/uploaded.csv'], ext);
        assert.equal(ext.entry.untrusted, true, 'файл из загрузки не помечен');
        unmarkExternal('/BOX/doc/uploaded.csv');
        const own = { entry: {} };
        await markUntrustedByPaths(['/BOX/doc/a.md'], own);
        assert.equal(own.entry.untrusted, undefined, 'свой файл заражает ход');
        const empty = { entry: {} };
        await markUntrustedByPaths([], empty);
        await markUntrustedByPaths([null, ''], empty);
        assert.equal(empty.entry.untrusted, undefined, 'пустые пути заражают');
    });
    it('find: найденные строки письма — чужой текст', async () => {
        const { find } = await import('../sources/modules/agent/tools/work/fs.js');
        const e = {};
        const out = await find.run({ path: '/BOX/doc', text: 'UNIQUE' }, mkCtx(ADMIN, { entry: e }));
        assert.match(out, /letter\.eml:\d+:/, 'в результатах нет письма — тест пуст');
        assert.equal(e.untrusted, true, 'find не помечает чужой файл');
        const own = {};
        await find.run({ path: '/BOX/doc', text: 'мусор' }, mkCtx(ADMIN, { entry: own }));
        assert.equal(own.untrusted, undefined, 'свои файлы заражают');
    });
    it('read_table и import_objects: загруженная таблица — чужой текст', async () => {
        const { docTools } = await import('../sources/modules/agent/tools/docs.js');
        const readTable = docTools.find(t => t.name === 'read_table');
        const importObjects = docTools.find(t => t.name === 'import_objects');
        markExternal('/BOX/doc/table.csv', 'upload');
        const e1 = {};
        const rows = await readTable.run({ path: '/BOX/doc/table.csv' }, mkCtx(ADMIN, { entry: e1 }));
        assert.match(JSON.stringify(rows), /Анна/);
        assert.equal(e1.untrusted, true, 'read_table читает загруженную таблицу как свою');
        const e2 = {};
        // /BOX — не класс учётного ядра: импорт откажет, но таблица уже помечена
        await importObjects.run({ path: '/BOX', source: '/BOX/doc/table.csv', dry_run: true }, mkCtx(ADMIN, { entry: e2 })).catch(() => {});
        assert.equal(e2.untrusted, true, 'import_objects читает загруженную таблицу как свою');
        unmarkExternal('/BOX/doc/table.csv');
        const own = {};
        await readTable.run({ path: '/BOX/doc/table.csv' }, mkCtx(ADMIN, { entry: own }));
        assert.equal(own.untrusted, undefined, 'своя таблица заражает ход');
    });
});
