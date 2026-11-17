import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FS } from '../sources/server/index.js';
import { $server } from '../sources/server/server.js';
import * as POLICY from '../sources/server/access/policy.js';
import * as REFS from '../sources/server/access/refs.js';
import { closeIndexDb } from '../sources/host/index-db.js';

/**
 * Модель доступа «Точки × Роли × Ленты» (sources/server/access):
 * зона = папка роли (собственная и унаследованная по ~), вне зон — система;
 * ADMIN меняет всё и видит секреты, BOSS видит систему и логи вниз по дереву;
 * остальные пишут только в свою зону где назначены;
 * лента точки — системным ролям целиком, остальным свои записи;
 * лента пользователя открывает то, на что указывает.
 */

let tmp;
let prevCwd;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

const as = (uid, role) => ({ session: { uid }, role });

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-access-'));
    write('$server/class.js', `export default { label: 'WORK-ACCESS', '#security': { BOSS: ['w1'] } }`);
    write('$server/$folder/class.js', `export default {}`);
    write('$server/$folder/$class/class.js', `export default {}`);
    write('$server/$folder/$file/class.js', `export default {}`);
    write('$server/$folder/$file/$md/class.js', `export default {}`);
    for (const u of ['a1', 'b1', 'w1', 'u1', 'u2', 'c1'])
        write(`USERS/${u}/$user/class.js`, `export default { label: '${u}' }`);
    write('ORG/$class/class.js', `export default { label: 'ORG', '#security': { BOSS: ['b1'], USER: ['u2'] } }`);
    write('ORG/$class/BOSS/plan.md', '# План руководителя');
    write('ORG/$class/$folder/USER/instr.md', '# Инструкция для исполнителей ниже');
    write('ORG/$class/$folder/BOSS/order.md', '# Распоряжение руководителям ниже');
    write('ORG/DEPT/$class/class.js', `export default {
    label: 'DEPT',
    ROLES: { CUSTOMER: { label: 'Покупатель' } },
    '#security': { USER: ['u1'], CUSTOMER: ['c1'] }
}`);
    write('ORG/DEPT/$class/USER/work.md', 'рабочий файл');
    write('ORG/DEPT/$class/BOSS/boss.md', 'файл руководителя отдела');
    write('ORG/DEPT/$class/CUSTOMER/price.md', 'прайс');
    write('ORG/DEPT/$class/readme.md', 'о подразделении');
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    closeIndexDb();
    process.chdir(prevCwd);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* занято */ }
});

describe('policy: чистые правила', () => {
    it('область — первая папка после последнего $-сегмента', () => {
        const roles = ['ADMIN', 'BOSS', 'USER', 'GUEST', 'CUSTOMER'];
        assert.deepEqual(POLICY.areaOfPath('/A/$class/USER/x.md', '/A', roles), { kind: 'zone', role: 'USER' });
        assert.deepEqual(POLICY.areaOfPath('/A/$class/$folder/$class/$structure/BOSS/x.md', '/A', roles), { kind: 'zone', role: 'BOSS' });
        assert.deepEqual(POLICY.areaOfPath('/A/$class/logs/2026-01-01/1.u.logs', '/A', roles), { kind: 'logs' });
        assert.deepEqual(POLICY.areaOfPath('/A/$class/#secret/k.json', '/A', roles), { kind: 'secret' });
        assert.deepEqual(POLICY.areaOfPath('/A/$class/handlers/x.md', '/A', roles), { kind: 'system' });
        assert.deepEqual(POLICY.areaOfPath('/A/plain/x.md', '/A', roles), { kind: 'system' });
        assert.deepEqual(POLICY.areaOfPath('/A/$class/CUSTOMER/p.md', '/A', roles), { kind: 'zone', role: 'CUSTOMER' });
    });

    it('чтение и запись по ролям', () => {
        const R = POLICY.normalizeRoles({ CUSTOMER: {} });
        const zone = r => ({ kind: 'zone', role: r });
        assert.equal(POLICY.canRead(R.USER, zone('USER')), true);
        assert.equal(POLICY.canRead(R.USER, zone('BOSS')), false);
        assert.equal(POLICY.canRead(R.USER, { kind: 'system' }), true);
        assert.equal(POLICY.canRead(R.USER, { kind: 'logs' }), false, 'USER не видит ленту точки');
        assert.equal(POLICY.canRead(R.USER, { kind: 'logs' }, { ownEntry: true }), true, 'но видит свои записи');
        assert.equal(POLICY.canRead(R.BOSS, zone('USER')), true, 'BOSS видит всё');
        assert.equal(POLICY.canRead(R.BOSS, { kind: 'secret' }), true, 'BOSS видит и секреты');
        assert.equal(POLICY.canRead(R.CUSTOMER, zone('CUSTOMER')), true, 'прикладная роль — как USER');
        assert.equal(POLICY.canWrite(R.USER, zone('USER'), { local: true }), true);
        assert.equal(POLICY.canWrite(R.USER, { kind: 'system' }, { local: true }), false);
        assert.equal(POLICY.canWrite(R.BOSS, zone('BOSS'), { local: false }), true, 'BOSS пишет в своей точке и ниже');
        assert.equal(POLICY.canWrite(R.BOSS, { kind: 'system' }), true);
    });

    it('normalizeRoles: базовые + прикладные, мусор отбрасывается', () => {
        const R = POLICY.normalizeRoles({ CUSTOMER: { label: 'Покупатель', color: 'green', scope: 'bad', write: 'all' }, lower: {}, BOSS: { label: 'Шеф', principals: ['user', 'node'] } });
        assert.equal(R.CUSTOMER.label, 'Покупатель');
        assert.equal(R.CUSTOMER.color, 'green');
        assert.equal(R.CUSTOMER.scope, undefined, 'полей поведения больше нет');
        assert.deepEqual(R.CUSTOMER.principals, ['user', 'node']);
        assert.equal(R.BOSS.label, 'Шеф');
        assert.deepEqual(R.BOSS.principals, ['user'], 'системные роли — только пользователи');
        assert.equal(R.lower, undefined);
        assert.ok(POLICY.isSystemRole('BOSS') && !POLICY.isSystemRole('USER') && !POLICY.isSystemRole('CUSTOMER'));
    });
});

describe('ядро: canSee / canWrite по модели', () => {
    it('USER видит систему, свою зону и унаследованную зону, но не зону BOSS', async () => {
        const dept = await WORK.get_item('/ORG/DEPT');
        const meta = dept.meta_folder;
        const p = as('u1');
        assert.equal(await dept.canSee(await meta.get_item('USER/work.md'), p), true);
        assert.equal(await dept.canSee(await meta.get_item('readme.md'), p), true, 'система точки');
        assert.equal(await dept.canSee(await meta.get_item('BOSS/boss.md'), p), false, 'зона BOSS закрыта');
        assert.equal(await dept.canSee(await meta.get_item('CUSTOMER/price.md'), p), false, 'зона CUSTOMER закрыта');
        const instr = await WORK.get_item('/ORG/DEPT/$class/$folder/USER/instr.md');
        assert.ok(instr, 'инструкция из $folder/USER вышестоящего класса видна по наследованию');
        assert.equal(await dept.canSee(instr, p), true, 'USER видит унаследованную зону USER');
        const order = await WORK.get_item('/ORG/DEPT/$class/$folder/BOSS/order.md');
        assert.equal(await dept.canSee(order, p), false, 'унаследованная зона BOSS закрыта');
    });

    it('BOSS вышестоящей точки видит и меняет всё ниже по дереву', async () => {
        const dept = await WORK.get_item('/ORG/DEPT');
        const org = await WORK.get_item('/ORG');
        assert.deepEqual(await dept.roles(as('b1')), ['BOSS'], 'BOSS наследуется вниз');
        assert.equal(await dept.canSee(await dept.meta_folder.get_item('USER/work.md'), as('b1')), true);
        const deptBoss = await dept.meta_folder._get_next_item('BOSS', FS.$folder);
        assert.equal(await dept.canWrite(deptBoss, as('b1', 'BOSS')), true, 'BOSS родителя управляет и дочерним отделом');
        const orgBoss = await org.meta_folder._get_next_item('BOSS', FS.$folder);
        assert.equal(await org.canWrite(orgBoss, as('b1', 'BOSS')), true, 'в ORG назначен');
        const orgDist = await org.meta_folder.get_item('$folder/BOSS/order.md');
        assert.equal(await org.canWrite(orgDist, as('b1', 'BOSS')), true, 'распределяемый слой $folder/BOSS — тоже своя зона');
    });

    it('USER вышестоящей точки не видит нижестоящую (роли действуют в своей точке)', async () => {
        const dept = await WORK.get_item('/ORG/DEPT');
        assert.deepEqual(await dept.roles(as('u2')), []);
        assert.equal(await dept.canSee(await dept.meta_folder.get_item('readme.md'), as('u2')), false);
    });

    it('BOSS корня WORK (он же $structure) пишет в системные пути своей точки, USER — нет', async () => {
        // Корень WORK — это $server, наследник $structure, поэтому BOSS корня обязан проходить
        // туда, куда пишется .task промпта с корня (/$server/task), и системные пути /$server.
        const L = FS.$class.ACCESS_LEVEL;
        const task = await WORK.meta_folder._get_next_item('task', FS.$folder);
        assert.deepEqual(await WORK.roles(as('w1')), ['BOSS'], 'w1 назначен BOSS корня в $server/class.js');
        assert.equal(await WORK.canWrite(task, as('w1', 'BOSS')), true, 'BOSS корня пишет в /$server/task');
        await WORK.assertAccess({ ...as('w1', 'BOSS'), filename: 'prompt.task' }, L.WRITE, task);
        await WORK.assertAccess(as('w1', 'BOSS'), L.WRITE, WORK);
        assert.equal(await WORK.canWrite(task, as('u1', 'USER')), false, 'USER не пишет в системные метаданные корня');
        await assert.rejects(
            WORK.assertAccess({ ...as('u1', 'USER'), filename: 'prompt.task' }, L.WRITE, task),
            /Доступ запрещён/,
        );
        await assert.rejects(
            WORK.assertAccess({ ...as('w1', 'USER'), filename: 'prompt.task' }, L.WRITE, task),
            /Доступ запрещён/,
            'принудительный role=USER не обходит ограничения системных путей',
        );
    });

    it('work_zone через шлюз: возвращает единое хранилище точки, рабочие файлы доступны на запись, а системные метаданные защищены от не-админов', async () => {
        const { invoke, canRead } = await import('../sources/server/access/gateway.js');
        const dept = await WORK.get_item('/ORG/DEPT');
        const storage = await invoke(dept, 'work_zone', { role: 'USER', session: { uid: 'u1' } });
        assert.equal(storage.path, dept.storage_folder.path, 'work_zone возвращает единое хранилище (meta_folder) без подпапки роли');
        assert.equal(await canRead(storage, { session: { uid: 'u1' } }), true);
        // Сотрудник USER может сохранять обычные файлы в общее хранилище подразделения
        assert.equal(await dept.canWrite(storage, { ...as('u1', 'USER'), filename: 'contract.docx', folder: 'docx' }), true);
        // Но НЕ может менять системные метаданные (class.js, readme.md, $folder/..., handlers/..., #secret/...)
        assert.equal(await dept.canWrite(storage, { ...as('u1', 'USER'), filename: 'class.js' }), false, 'не-админ не может менять class.js');
        assert.equal(await dept.canWrite(storage, { ...as('u1', 'USER'), filename: 'readme.md' }), false, 'не-админ не может менять системный readme.md');
        assert.equal(await dept.canWrite(storage, { ...as('u1', 'USER'), folder: '$folder', filename: 'class.js' }), false, 'не-админ не может менять слои $folder');
        assert.equal(await dept.canWrite(storage, { ...as('u1', 'USER'), folder: 'handlers', filename: 'hack.js' }), false, 'не-админ не может писать в handlers');
        assert.equal(await dept.canWrite(storage, { ...as('u1', 'USER'), folder: '#secret', filename: 'k.json' }), false, 'не-админ не может писать в #secret');
    });

    it('прикладная роль CUSTOMER: назначение, зона, запись', async () => {
        const dept = await WORK.get_item('/ORG/DEPT');
        const declared = await dept.declared_roles;
        assert.ok(declared.CUSTOMER, 'роль объявлена в ROLES class.js');
        assert.deepEqual(await dept.roles(as('c1')), ['CUSTOMER']);
        const price = await dept.meta_folder.get_item('CUSTOMER/price.md');
        assert.equal(await dept.canSee(price, as('c1')), true);
        assert.equal(await dept.canSee(await dept.meta_folder.get_item('USER/work.md'), as('c1')), false);
        const zone = await dept.work_zone({ role: 'CUSTOMER' });
        assert.equal(await dept.canWrite(zone, as('c1', 'CUSTOMER')), true);
        const members = await dept.members({ role: 'CUSTOMER' });
        assert.deepEqual(members.map(u => u.id), ['c1']);
    });

    it('лента открывает то, на что указывает запись', async () => {
        const dept = await WORK.get_item('/ORG/DEPT');
        const boss = await dept.meta_folder.get_item('BOSS/boss.md');
        assert.equal(await dept.canSee(boss, as('u1')), false);
        await REFS.addRow('u1', { time: Date.now(), path: boss.path });
        assert.equal(await dept.canSee(boss, as('u1')), true, 'после записи в ленте u1');
        assert.equal(await dept.canSee(boss, as('c1')), false, 'другим — нет');
    });

    it('лента точки: USER видит только свои записи, BOSS — все', async () => {
        const dept = await WORK.get_item('/ORG/DEPT');
        write('ORG/DEPT/$class/logs/2026-01-01/1.x.logs', JSON.stringify({ time: 1, sender: 'u1', content: 'моё' }));
        write('ORG/DEPT/$class/logs/2026-01-01/2.x.logs', JSON.stringify({ time: 2, sender: 'zz', content: 'чужое' }));
        dept.reset();
        dept.meta_folder.reset();
        const mine = await WORK.get_item('/ORG/DEPT/$class/logs/2026-01-01/1.x.logs');
        const other = await WORK.get_item('/ORG/DEPT/$class/logs/2026-01-01/2.x.logs');
        assert.equal(await dept.canSee(mine, as('u1')), true);
        assert.equal(await dept.canSee(other, as('u1')), false);
        assert.equal(await dept.canSee(other, as('b1')), true);
    });

    it('save_message: нельзя вложить то, чего не видишь', async () => {
        const dept = await WORK.get_item('/ORG/DEPT');
        const secret = '/ORG/$class/BOSS/plan.md';
        await assert.rejects(
            dept.save_message({ ...as('u1', 'USER'), message: 'смотри', includes: [secret] }),
            /Доступ запрещён/,
        );
    });

    it('документооборот подразделения: двойной лог (подразделение + личный кабинет + получатели) и chatSource (по умолчанию свой лог, local — только BOSS)', async () => {
        const dept = await WORK.get_item('/ORG/DEPT');
        const u1Cab = await WORK.get_item('/USERS/u1');
        const u2Cab = await WORK.get_item('/USERS/u2');

        // 1. По умолчанию для всех (включая BOSS) chatSource возвращает личный кабинет пользователя
        assert.equal(await dept.chatSource(as('u1', 'USER')), '/USERS//u1', 'USER по умолчанию -> личный кабинет');
        assert.equal(await dept.chatSource(as('b1', 'BOSS')), '/USERS//b1', 'BOSS по умолчанию -> личный кабинет');
        assert.equal(await dept.chatSource({ session: { uid: 'b1' } }), '/USERS//b1', 'BOSS без local -> личный кабинет');

        // Местный лог точки возвращается только при явном local: true и роли BOSS; у обычного USER local игнорируется
        assert.equal(await dept.chatSource({ ...as('b1', 'BOSS'), local: true }), '/ORG/DEPT', 'BOSS с local: true -> лог подразделения');
        assert.equal(await dept.chatSource({ session: { uid: 'b1' }, local: true }), '/ORG/DEPT', 'BOSS по ролям точки с local: true -> лог подразделения');
        assert.equal(await dept.chatSource({ ...as('u1', 'USER'), local: true }), '/USERS//u1', 'USER с local: true -> всё равно личный кабинет');
        assert.equal(await dept.chatSource({ session: { uid: 'u1' }, local: true }), '/USERS//u1', 'USER без роли BOSS с local: true -> личный кабинет');

        // 2. Отправка сообщения в подразделении с получателем u2 пишет в лог подразделения, в кабинет автора u1 и в кабинет получателя u2
        const msg = 'Документ согласован #' + Date.now();
        await dept.save_message({ ...as('u1', 'USER'), message: msg, receivers: ['u2'] });

        const deptRows = await dept.read_log_bodies({ role: 'BOSS', session: { uid: 'b1' } });
        const u1Rows = await u1Cab.read_log_bodies({ session: { uid: 'u1' } });
        const u2Rows = await u2Cab.read_log_bodies({ session: { uid: 'u2' } });

        assert.ok(deptRows.some(r => r.content === msg && r.sender === 'u1'), 'запись попала в лог подразделения');
        assert.ok(u1Rows.some(r => r.content === msg && r.sender === 'u1'), 'запись попала в личный лог автора u1');
        assert.ok(u2Rows.some(r => r.content === msg && r.sender === 'u1' && r.receivers?.includes('u2')), 'запись попала в личный лог получателя u2');
    });
});

describe('RAG: проекции точки', () => {
    it('документы слоёв видны по виртуальному пути; зоны фильтруются ролью', async () => {
        const store = await import('../sources/modules/rag/store.js');
        const { scopeDocs, invalidateLayers } = await import('../sources/modules/rag/scope.js');
        await store.open();
        const put = (p) => store.upsertDoc({ path: p, kind: 'file', hash: 'h:' + p, mtime: 1, class_dir: '', title: p });
        put('/ORG/$class/$folder/USER/instr.md');
        put('/ORG/$class/$folder/BOSS/order.md');
        put('/ORG/DEPT/$class/USER/work.md');
        put('/ORG/DEPT/$class/BOSS/boss.md');
        put('/ORG/DEPT/$class/readme.md');
        invalidateLayers();
        const dept = await WORK.get_item('/ORG/DEPT');
        const declared = await dept.declared_roles;
        const userDocs = await scopeDocs(dept, declared.USER, 'u1');
        const vpaths = userDocs.map(d => d.virtual).sort();
        assert.ok(vpaths.includes('/ORG/DEPT/$class/USER/work.md'), 'своя зона');
        assert.ok(vpaths.includes('/ORG/DEPT/$class/readme.md'), 'система');
        assert.ok(vpaths.includes('/ORG/DEPT/$class/$folder/USER/instr.md'), 'унаследованная зона — виртуальный путь в точке');
        assert.ok(!vpaths.some(p => p.includes('/BOSS/')), 'зоны BOSS нет');
        const bossDocs = await scopeDocs(dept, declared.BOSS, 'b1');
        assert.ok(bossDocs.some(d => d.virtual.endsWith('/BOSS/boss.md')));
    });
});

describe('RAG: чанкер', () => {
    it('разделы по заголовкам, размер и перекрытие', async () => {
        const { chunkText } = await import('../sources/modules/rag/chunker.js');
        const para = 'Предложение номер один. '.repeat(20);
        const text = '# Раздел\n\n' + para + '\n\n' + para + '\n\n## Подраздел\n\nКороткий текст подраздела для проверки.';
        const chunks = chunkText(text, { max: 300, overlap: 50, min: 10 });
        assert.ok(chunks.length >= 3);
        assert.ok(chunks.every(c => c.text.length <= 360), 'размер с учётом перекрытия');
        assert.equal(chunks[0].heading, 'Раздел');
        assert.equal(chunks.at(-1).heading, 'Раздел › Подраздел');
        assert.ok(chunks.every(c => c.start >= 0 && c.end > c.start));
    });
});
