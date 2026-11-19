import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

process.env.WORK_TEST = '1';
process.env.WORK_NO_BROWSER = '1';
process.env.WORK_PREWARM = '0';
process.env.WORK_RAG = '0';
process.env.WORK_WATCH = '0';
process.env.WORK_RECOVER = '0';
process.env.WORK_SCHEDULE = '0';
process.env.WORK_NOTIFY = '0';
process.env.WORK_SWEEP = '0';
process.env.WORK_RESUME_DOWNLOADS = '0';

import '../sources/reactor.js';
globalThis.ODA ??= function () {};
import '../sources/server/index.js';
import { $server } from '../sources/server/server.js';
import { closeBaseDb } from '../sources/data/db.js';
import {
    exportDistroToFolderSync,
    createDistroZipStream,
} from '../sources/server/class/distro.js';

globalThis.WORK ??= new $server();

test('1. Чистый корень WORK и виртуальная системная папка SYSTEM', async () => {
    const rootItems = await WORK.items;
    const rootIds = rootItems.map(i => i.id);

    // Основные разделы и документация на месте
    assert.ok(rootIds.includes('ORGANIZATIONS'), 'ORGANIZATIONS должен быть в корне WORK');
    assert.ok(rootIds.includes('PROJECTS'), 'PROJECTS должен быть в корне WORK');
    assert.ok(rootIds.includes('MODULES'), 'MODULES должен быть в корне WORK');
    assert.ok(rootIds.includes('SYSTEM'), 'Папка SYSTEM должна быть в корне WORK');
    assert.ok(rootIds.includes('readme.md'), 'readme.md должен оставаться снаружи в корне WORK');

    // PROJECTS идёт сразу после ORGANIZATIONS
    const orgIdx = rootIds.indexOf('ORGANIZATIONS');
    const projIdx = rootIds.indexOf('PROJECTS');
    assert.equal(projIdx, orgIdx + 1, 'Раздел PROJECTS должен располагаться сразу после ORGANIZATIONS');

    // Системные папки, конфиги и мусор разработки убраны из корня WORK.items
    for (const movedOrHidden of [
        'oda', 'sources', 'scripts', 'rules',
        'AGENTS.md', 'config.json', 'package.json', 'run.mjs', 'sw.js', 'favicon.ico', 'logo.png',
        'node_modules', 'tests', 'torus', 'license-server', 'package-lock.json', 'eslint.config.js', 'jsconfig.json', 'publish.cmd',
    ]) {
        assert.ok(!rootIds.includes(movedOrHidden), `${movedOrHidden} не должен торчать снаружи в корне WORK.items`);
    }

    // Внутри папки SYSTEM находятся системные папки и файлы с их нативными корневыми путями
    const sysFolder = await WORK.get_item('/SYSTEM');
    assert.ok(sysFolder, 'Узел /SYSTEM должен резолвиться через WORK.get_item');
    const sysItems = await sysFolder.items;
    const sysIds = sysItems.map(i => i.id);
    for (const expectedSys of ['oda', 'sources', 'scripts', 'rules', 'package.json', 'run.mjs']) {
        assert.ok(sysIds.includes(expectedSys), `${expectedSys} должен быть внутри /SYSTEM`);
    }
    const sourcesInSys = sysItems.find(i => i.id === 'sources');
    assert.equal(sourcesInSys.path, '/sources', 'Элементы внутри SYSTEM сохраняют нативный путь (/sources)');

    // Нативный путь /sources/work.js и алиас /SYSTEM/sources/work.js возвращают один и тот же файл
    const directWorkJs = await WORK.get_item('/sources/work.js');
    const aliasedWorkJs = await WORK.get_item('/SYSTEM/sources/work.js');
    assert.ok(directWorkJs, '/sources/work.js должен резолвиться напрямую');
    assert.ok(aliasedWorkJs, '/SYSTEM/sources/work.js должен резолвиться как алиас');
    assert.equal(aliasedWorkJs.path, '/sources/work.js');
});

test('2. Раздел /PROJECTS и тип $project (рабочие места без подразделений $structure)', async () => {
    const projectsDomain = await WORK.get_item('/PROJECTS');
    assert.ok(projectsDomain, 'Домен /PROJECTS должен существовать');
    await projectsDomain.init;
    assert.equal(projectsDomain.DATA?.label, 'Проекты');

    const allowedInProjects = await projectsDomain.allowed_child_types;
    assert.ok(allowedInProjects.includes('$project'), 'В /PROJECTS должен быть разрешён дочерний тип $project');

    const testProjId = '__ТестПроект__';
    const testProjDir = path.resolve('PROJECTS', testProjId);
    try {
        if (fs.existsSync(testProjDir))
            fs.rmSync(testProjDir, { recursive: true, force: true });

        await projectsDomain.create({
            id: testProjId,
            label: 'Тестовый Проект Альфа',
            type: '$project',
            preset: 'standard',
            modules: 'Register,Geo',
        });

        const proj = await WORK.get_item(`/PROJECTS/${testProjId}`);
        assert.ok(proj, 'Созданный проект должен находиться в /PROJECTS');
        assert.equal(proj.type, '$project');
        await proj.init;
        assert.equal(proj.DATA?.label, 'Тестовый Проект Альфа');
        assert.equal(proj.DATA?.code, 'PRJ-001');

        // В проекте нет подразделений $structure — создавать $structure внутри $project запрещено
        const allowedInProj = await proj.allowed_child_types;
        assert.ok(!allowedInProj.includes('$structure'), 'Внутри $project не должно быть разрешено создание $structure');
        assert.ok(allowedInProj.includes('$module'), 'Внутри $project разрешено подключение $module');

        await assert.rejects(
            () => proj.create({ id: 'dept1', type: '$structure' }),
            /нельзя создать тип \$structure/i,
            'Попытка создать подразделение $structure внутри $project должна отклоняться'
        );

        // Рабочие места (ROLES) настроены прямо на самом $project
        const placesRes = await proj.places();
        assert.ok(Array.isArray(placesRes.places) && placesRes.places.length >= 3, 'В проекте должны быть рабочие места pm, team, stakeholders');
        const placeIds = placesRes.places.map(p => p.id);
        assert.ok(placeIds.includes('pm'));
        assert.ok(placeIds.includes('team'));
        assert.ok(placeIds.includes('stakeholders'));

        // Архивация проекта ($project -> .zip)
        const zipBuf = await proj.export_archive();
        assert.ok(Buffer.isBuffer(zipBuf) && zipBuf.length > 100, 'export_archive должен возвращать ZIP-буфер проекта');
    }
    finally {
        await closeBaseDb(`/PROJECTS/${testProjId}`).catch(() => {});
        if (fs.existsSync(testProjDir))
            fs.rmSync(testProjDir, { recursive: true, force: true });
        projectsDomain.reset();
    }
});

test('3. Создание автономного дистрибутива (папка-клон с hardlink весов + потоковый ZIP64 со STORE)', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'work-distro-test-'));
    const srcRoot = path.join(tmpRoot, 'src-work');
    const dstFolder = path.join(tmpRoot, 'out-distro-folder');

    try {
        // Соберём минимальный макет настроенной системы с моделью ИИ, организацией, проектом и пользователем
        fs.mkdirSync(path.join(srcRoot, '$server', '$folder'), { recursive: true });
        fs.writeFileSync(path.join(srcRoot, '$server', 'class.js'), 'export default { "#security": { BOSS: ["USER123"] } }\n');
        fs.writeFileSync(path.join(srcRoot, 'package.json'), JSON.stringify({ name: 'odant-work', version: '1.0.54' }));
        fs.writeFileSync(path.join(srcRoot, 'run.mjs'), '// run.mjs\n');
        fs.writeFileSync(path.join(srcRoot, 'readme.md'), '# WORK\n');

        // Настроенный модуль
        fs.mkdirSync(path.join(srcRoot, 'MODULES', 'Register', '$module'), { recursive: true });
        fs.writeFileSync(path.join(srcRoot, 'MODULES', 'Register', '$module', 'class.js'), 'export default { label: "Учёт" }\n');

        // Организация, проект, пользователь и секреты (ДОЛЖНЫ БЫТЬ ИСКЛЮЧЕНЫ из клона!)
        fs.mkdirSync(path.join(srcRoot, 'ORGANIZATIONS', '$domain'), { recursive: true });
        fs.writeFileSync(path.join(srcRoot, 'ORGANIZATIONS', '$domain', 'class.js'), 'export default { label: "Организации" }\n');
        fs.mkdirSync(path.join(srcRoot, 'ORGANIZATIONS', 'Маслоторг', '$base', '#system'), { recursive: true });
        fs.writeFileSync(path.join(srcRoot, 'ORGANIZATIONS', 'Маслоторг', '$base', '#system', 'work.db'), 'sqlite-data');

        fs.mkdirSync(path.join(srcRoot, 'PROJECTS', '$domain'), { recursive: true });
        fs.writeFileSync(path.join(srcRoot, 'PROJECTS', '$domain', 'class.js'), 'export default { label: "Проекты" }\n');
        fs.mkdirSync(path.join(srcRoot, 'PROJECTS', 'Альфа', '$project'), { recursive: true });
        fs.writeFileSync(path.join(srcRoot, 'PROJECTS', 'Альфа', '$project', 'class.js'), 'export default { label: "Альфа" }\n');

        fs.mkdirSync(path.join(srcRoot, 'USERS', '$users'), { recursive: true });
        fs.writeFileSync(path.join(srcRoot, 'USERS', '$users', 'class.js'), 'export default { label: "USERS" }\n');
        fs.mkdirSync(path.join(srcRoot, 'USERS', 'USER123', '$user'), { recursive: true });
        fs.writeFileSync(path.join(srcRoot, 'USERS', 'USER123', '$user', 'class.js'), 'export default { label: "Иван" }\n');

        fs.mkdirSync(path.join(srcRoot, '#system'), { recursive: true });
        fs.writeFileSync(path.join(srcRoot, '#system', 'node-key.json'), '{"secret":true}');
        fs.writeFileSync(path.join(srcRoot, '#system', 'sandbox.json'), '{"enabled":false}');

        // Локальная модель ИИ с файлом весов .safetensors
        const weightsDir = path.join(srcRoot, 'MODELS', 'Local', 'Qwen3-0.6B', '$ai', '#weights');
        fs.mkdirSync(weightsDir, { recursive: true });
        const fakeWeightBuf = Buffer.alloc(64 * 1024, 0x42);
        const weightFile = path.join(weightsDir, 'model.safetensors');
        fs.writeFileSync(weightFile, fakeWeightBuf);

        // 1) Сохранение дистрибутива в папку
        const report = exportDistroToFolderSync(srcRoot, dstFolder, {
            includeNodeModules: false,
            includeModels: true,
        });
        assert.equal(report.ok, true);
        assert.ok(report.hardlinkedCount >= 1, 'Файл весов .safetensors должен клонироваться через hardlink');

        // Проверим наличие ядра, модуля, весов модели и стартовых скриптов
        assert.ok(fs.existsSync(path.join(dstFolder, 'start.cmd')), 'start.cmd должен быть создан');
        assert.ok(fs.existsSync(path.join(dstFolder, 'start.sh')), 'start.sh должен быть создан');
        assert.ok(fs.existsSync(path.join(dstFolder, 'MODULES', 'Register', '$module', 'class.js')), 'Эталонный модуль должен войти в дистрибутив');
        assert.ok(fs.existsSync(path.join(dstFolder, 'MODELS', 'Local', 'Qwen3-0.6B', '$ai', '#weights', 'model.safetensors')), 'Веса локальной модели ИИ должны войти в дистрибутив');
        assert.ok(fs.existsSync(path.join(dstFolder, 'ORGANIZATIONS', '$domain', 'class.js')), 'Метапапка ORGANIZATIONS/$domain должна сохраниться');
        assert.ok(fs.existsSync(path.join(dstFolder, 'PROJECTS', '$domain', 'class.js')), 'Метапапка PROJECTS/$domain должна сохраниться');

        // Проверим, что организации, проекты, пользователи и секреты ИСКЛЮЧЕНЫ
        assert.ok(!fs.existsSync(path.join(dstFolder, 'ORGANIZATIONS', 'Маслоторг')), 'Конкретные организации не должны попадать в дистрибутив');
        assert.ok(!fs.existsSync(path.join(dstFolder, 'PROJECTS', 'Альфа')), 'Конкретные проекты не должны попадать в дистрибутив');
        assert.ok(!fs.existsSync(path.join(dstFolder, 'USERS', 'USER123')), 'Пользователи не должны попадать в дистрибутив');
        assert.ok(!fs.existsSync(path.join(dstFolder, '#system', 'node-key.json')), 'Ключи сервера не должны попадать в дистрибутив');
        const cleanServerClass = fs.readFileSync(path.join(dstFolder, '$server', 'class.js'), 'utf-8');
        assert.ok(!cleanServerClass.includes('USER123'), 'В $server/class.js дистрибутива не должно быть старых BOSS uid');

        // 2) Потоковая сборка ZIP64 (веса модели пишутся методом STORE = 0 без сжатия)
        const chunks = [];
        for await (const chunk of createDistroZipStream(srcRoot, { includeNodeModules: false, includeModels: true })) {
            chunks.push(chunk);
        }
        const zipBuf = Buffer.concat(chunks);
        const zip = new AdmZip(zipBuf);
        const weightEntry = zip.getEntry('MODELS/Local/Qwen3-0.6B/$ai/#weights/model.safetensors');
        assert.ok(weightEntry, 'Файл весов должен присутствовать в ZIP64-архиве');
        assert.equal(weightEntry.header.method, 0, 'Файл весов .safetensors должен быть записан методом STORE (0 — без сжатия)');

        const pkgEntry = zip.getEntry('package.json');
        assert.ok(pkgEntry, 'package.json должен присутствовать в ZIP-архиве');
        assert.equal(pkgEntry.header.method, 8, 'Текстовый файл package.json должен быть сжат методом DEFLATE (8)');
    }
    finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('4. Вызов distro_info через шлюз безопасности GATEWAY.invoke (без ошибки 400 not exposed)', async () => {
    const GATEWAY = await import('../sources/server/access/gateway.js');
    await WORK.init;
    const member = GATEWAY.resolveMember(WORK, 'distro_info');
    assert.ok(member, 'distro_info должен быть зарегистрирован в GATEWAY.MEMBERS');
    const expMember = GATEWAY.resolveMember(WORK, 'export_distro');
    assert.ok(expMember, 'export_distro должен быть зарегистрирован в GATEWAY.MEMBERS');

    const info = await GATEWAY.invoke(WORK, 'distro_info', { session: { $user: WORK } });
    assert.ok(info && typeof info.coreBytes === 'number' && info.coreFiles > 0, 'GATEWAY.invoke(WORK, "distro_info") должен возвращать статистику дистрибутива');
});

test('5. Предустановленный набор российских Сервисов и MCP в /SERVICES (ЦБ РФ, DaData/ЕГРЮЛ/БИК, Производственный календарь РФ, 1С, Битрикс24, Яндекс.Диск)', async () => {
    const { listMcpCatalog } = await import('../sources/modules/agent/extensions.js');
    const catalog = await listMcpCatalog();
    const connectorIds = catalog.connectors.map(c => c.id);

    // ArgoCD удалён, а российские сервисы предустановлены
    assert.ok(!connectorIds.includes('ArgoCD'), 'ArgoCD должен быть убран из /SERVICES');
    for (const expectedId of ['CBR', 'DaData', 'RuCalendar', '1C', 'Bitrix24', 'YandexDisk', 'Telegram', 'Yandex', 'SearXNG', 'DuckDuckGo', 'Weather']) {
        assert.ok(connectorIds.includes(expectedId), `Сервис ${expectedId} должен присутствовать в /SERVICES`);
    }

    // Пресеты MCP включают российские шаблоны
    const presetIds = catalog.presets.map(p => p.id);
    for (const pId of ['1c-mcp', 'yandex-tracker', 'gitverse', 'diadoc-edo', 'marketplaces-ru', 'postgres', 'playwright', 'filesystem']) {
        assert.ok(presetIds.includes(pId), `Пресет MCP ${pId} должен быть в витрине MCP_PRESETS`);
    }

    // Проверка DaData.validate_requisites (контрольные разряды ИНН, ОГРН, БИК и расчётного счёта)
    const dadata = (await import('../SERVICES/DaData/$service/class.js')).default;
    const validCheck = await dadata.validate_requisites({
        inn: '7707083893',              // ПАО Сбербанк (валидный 10-значный ИНН)
        ogrn: '1027700132195',          // ПАО Сбербанк (валидный 13-значный ОГРН)
        bik: '044525225',               // БИК Сбербанка
        account: '40702810938000000000' // Проверим ключевание
    });
    assert.equal(validCheck.inn.valid, true, 'ИНН 7707083893 должен проходить проверку ФНС');
    assert.equal(validCheck.ogrn.valid, true, 'ОГРН 1027700132195 должен проходить проверку ФНС');

    const badInn = await dadata.validate_requisites({ inn: '7707083890' });
    assert.equal(badInn.ok, false);
    assert.equal(badInn.inn.valid, false, 'Битый ИНН должен отклоняться проверкой контрольной суммы');

    // Проверка Производственного календаря РФ (RuCalendar)
    const ruCal = (await import('../SERVICES/RuCalendar/$service/class.js')).default;
    const victoryDay = await ruCal.check_date({ date: '2026-05-09' });
    assert.equal(victoryDay.isHoliday, true);
    assert.equal(victoryDay.isWorking, false);
    assert.match(victoryDay.holidayName, /День Победы/);

    const period = await ruCal.workdays_between({ from: '2026-05-01', to: '2026-05-11' });
    assert.equal(period.calendarDays, 11);
    assert.equal(period.holidaysCount, 2); // 1 мая и 9 мая
    assert.equal(period.workingDays, 5);   // 4, 5, 6, 7, 8 мая (8 мая — сокращённый предпраздничный, 11 мая — перенос)

    const deadline = await ruCal.add_workdays({ date: '2026-04-30', days: 1 });
    assert.equal(deadline.resultDate, '2026-05-04', 'Следующий рабочий день после 30.04.2026 — 04.05.2026 (с учётом 1–3 мая)');
});

