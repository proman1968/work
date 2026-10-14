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
import { $server } from '../sources/server/server.js';
import { devSearchTools, globToRegExp } from '../sources/modules/agent/tools/dev/search.js';
import { createEnv } from '../sources/modules/agent/index.js';
import { decide } from '../sources/modules/agent/permissions.js';
import { fakeDocker } from './helpers/fake-docker.js';
import { setDockerForTests, resetDockerForTests } from '../sources/modules/sandbox/driver.js';
import { ensureComputer, writeText, setNetwork } from '../sources/modules/sandbox/manager.js';
import { loadSandboxConfig } from '../sources/modules/sandbox/config.js';
import { markExternal, unmarkExternal, resetExternalSources } from '../sources/server/external-source.js';

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
    write(path.join(root, 'BOX/doc/a.md'), 'первая UNIQUE строка\nобычная строка\nтретья UNIQUE строка\n');
    write(path.join(root, 'BOX/doc/deep/b.js'), 'function greet() { return "UNIQUE"; } // case test\n');
    write(path.join(root, 'BOX/doc/letter.eml'), 'текст письма UNIQUE\n');
    write(path.join(root, 'BOX/doc/upl.md'), 'загруженный UNIQUE файл\n');
    write(path.join(root, 'BOX/doc/bin.dat'), '\0\0\0' + 'UNIQUE' + '\0');
    write(path.join(root, 'BOX/doc/big.md'), 'x'.repeat(300 * 1024) + '\nUNIQUE внутри большого\n');
    write(path.join(root, 'PRIV/$class/class.js'), `export default { label: 'Ч', '#security': { ADMIN: ['admin'] } }`);
    write(path.join(root, 'PRIV/x.md'), 'здесь HIDDENWORD\n');
    write(path.join(root, `USERS/${UID}/$user/class.js`), `export default { label: 'U' }`);
    write(path.join(root, `USERS/${UID}/$user/#secret/notes.md`), 'мой HIDDENWORD в заметках\n');
    write(path.join(root, 'MODELS/$class/class.js'), `export default { label: 'М', '#security': { USER: ['${UID}'] } }`);
    write(path.join(root, 'MODELS/m1/$ai/class.js'), `export default { model: 'm1' } // MODELWORD\n`);
    process.chdir(root);
    globalThis.WORK = new $server();
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
