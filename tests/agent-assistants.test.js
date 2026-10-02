/**
 * Ассистенты агента: logs (последние записи), send/поручения, write_table, access, assign,
 * расписание задач, загрузка субагентов и навыков из пакета движка.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { FS } from '../sources/server/index.js';
import { workTools, resolvePeople } from '../sources/modules/agent/tools/work.js';
import { scheduleTools } from '../sources/modules/agent/tools/schedule.js';
import * as S from '../sources/modules/agent/scheduler.js';
import { createEnv } from '../sources/modules/agent/index.js';
import { closeIndexDb } from '../sources/host/index-db.js';
import { docTools, fillDocx } from '../sources/modules/agent/tools/docs.js';
import AdmZip from 'adm-zip';
import { memoryTools, memoryBlock } from '../sources/modules/agent/tools/memory.js';
import * as TRIG from '../sources/modules/agent/triggers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN = 'AD00000000000001', BOSS = 'B000000000000001', IVAN = 'C000000000000001', PETR = 'D000000000000001';
let tmp, prev;
const tool = n => workTools.find(t => t.name === n) || scheduleTools.find(t => t.name === n)
    || docTools.find(t => t.name === n) || memoryTools.find(t => t.name === n);
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } }, place: null, entry: {} });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-assist-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    // типы файлов данных проекта: лента (.logs) — запись дня, а не обычный файл
    for (const rel of ['$server/$folder/$file/$data/class.js', '$server/$folder/$file/$logs/class.js'])
        write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
    // пакет движка: настоящие субагенты и навыки проекта
    for (const dir of ['agents', 'skills'])
        for (const f of fs.readdirSync(path.join(ROOT, '$server/$folder/$class/ai', dir)))
            write('$server/$folder/$class/ai/' + dir + '/' + f, fs.readFileSync(path.join(ROOT, '$server/$folder/$class/ai', dir, f), 'utf-8'));
    for (const [uid, label] of [[ADMIN, 'Админ Главный'], [BOSS, 'Сидоров Босс'], [IVAN, 'Иванов Иван'], [PETR, 'Иванова Пётр']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('ORG/$class/class.js', `export default { label: 'ORG', '#security': { BOSSES: ['${BOSS}'], USERS: ['${IVAN}'] }, METADATA: { FIELDS: [
        { id: 'name', required: true }, { id: 'time', type: 'timestamp', required: true },
        { id: 'code', label: 'Код', required: true }, { id: 'price', label: 'Цена', type: 'Number' },
        { id: 'active', type: 'Boolean' },
    ] } }`);
    write('ORG/$class/USER/work.md', 'рабочее');
    write('ORG/$class/USER/tpl/letter.md', 'Уважаемый {{client.name}}! Счёт №{{number}} на {{sum}} руб.');
    write('ORG/$class/BOSS/plan.md', 'план');
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('люди и поручения', () => {
    it('resolvePeople: uid, точное и однозначное ФИО; неоднозначность — ошибка', async () => {
        assert.deepEqual((await resolvePeople([IVAN])).map(p => p.id), [IVAN]);
        assert.deepEqual((await resolvePeople(['иванов иван'])).map(p => p.id), [IVAN], 'точное совпадение побеждает частичное');
        await assert.rejects(resolvePeople(['Иванов']), /неоднозначно/);
        await assert.rejects(resolvePeople(['Нет Такого']), /не найден/);
    });

    it('send: поручение со сроком доставлено получателю, отчёт ссылается на id', async () => {
        const order = await tool('send').run({ path: '/ORG', message: 'Подготовь отчёт', to: ['Иванов Иван'], due: '2026-10-05' }, as(BOSS));
        const id = order.match(/id (\S+)\)/)[1];
        assert.match(id, new RegExp('^' + BOSS + ':\\d+$'));
        const done = await tool('send').run({ path: '/ORG', message: 'Готово', kind: 'done', reply_to: id }, as(IVAN));
        assert.match(done, /записано/);
        const feed = await tool('logs').run({ path: '/ORG' }, as(BOSS));
        assert.match(feed, /order, срок 2026-10-05/);
        assert.ok(feed.includes('на ' + id), 'ответ связан с поручением');
        assert.ok(feed.indexOf('Подготовь') < feed.indexOf('Готово'), 'в хронологическом порядке');
        const cabinet = await tool('logs').run({ path: '/USERS/' + IVAN }, as(IVAN));
        assert.match(cabinet, /Подготовь отчёт/, 'поручение в кабинете исполнителя');
    });

    it('save_message: sender из запроса не подменяет автора', async () => {
        const org = await WORK.get_item('/ORG');
        const row = await org.save_message({ session: { uid: IVAN }, role: 'USER', sender: BOSS, message: 'подмена' });
        assert.equal(row.sender, IVAN);
    });

    it('logs: при превышении limit — последние записи и честная пометка', async () => {
        for (let i = 0; i < 5; i++)
            await tool('send').run({ path: '/ORG', message: 'запись ' + i }, as(BOSS));
        const out = await tool('logs').run({ path: '/ORG', limit: 2 }, as(BOSS));
        assert.match(out, /показаны последние 2 из \d+/);
        assert.match(out, /запись 4/);
        assert.doesNotMatch(out, /Подготовь/);
    });
});

describe('отчёты и права', () => {
    it('write_table: xlsx с листами читается обратно', async () => {
        const res = await tool('write_table').run({
            path: '/ORG/Отчёты/итоги.xlsx',
            sheets: { 'Данные': [{ отдел: 'ORG', записей: 7 }], 'Итоги': [['Всего', 7]] },
        }, as(IVAN));
        assert.match(res, /сохранено/);
        const XLSX = await import('xlsx');
        const zone = path.join(tmp, 'ORG/$class/USER');
        const file = fs.readdirSync(zone, { recursive: true })
            .find(f => path.basename(String(f)) === 'итоги.xlsx' && fs.statSync(path.join(zone, f)).isFile());
        assert.ok(file, 'файл в зоне USER');
        const wb = XLSX.read(fs.readFileSync(path.join(tmp, 'ORG/$class/USER', file)));
        assert.deepEqual(wb.SheetNames, ['Данные', 'Итоги']);
        await assert.rejects(tool('write_table').run({ path: '/ORG/x.txt', rows: [[1]] }, as(IVAN)), /xlsx или .csv/);
    });

    it('access: область, роли, назначенные сверху', async () => {
        const r = JSON.parse(await tool('access').run({ path: '/ORG/$class/BOSS/plan.md' }, as(BOSS)));
        assert.deepEqual(r.area, { kind: 'zone', role: 'BOSS' });
        const boss = r.roles.find(x => x.role === 'BOSS'), user = r.roles.find(x => x.role === 'USER');
        assert.equal(boss.read, true);
        assert.equal(user.read, false);
        assert.deepEqual(boss.assigned, [BOSS]);
        await assert.rejects(tool('access').run({ path: '/ORG/$class/BOSS/plan.md' }, as('ZZ00000000000009')), /Доступ запрещён/);
    });

    it('assign: только ADMIN; меняет #security своего слоя без наследуемого', async () => {
        await assert.rejects(tool('assign').run({ path: '/ORG', role: 'USER', add: ['Иванова Пётр'] }, as(BOSS)), /Доступ запрещён/);
        const res = await tool('assign').run({ path: '/ORG', role: 'USER', add: ['Иванова Пётр'], remove: [IVAN] }, as(ADMIN));
        assert.match(res, new RegExp(PETR));
        const text = fs.readFileSync(path.join(tmp, 'ORG/$class/class.js'), 'utf-8');
        assert.match(text, new RegExp(PETR));
        assert.doesNotMatch(text, new RegExp(IVAN));
        assert.match(text, /BOSSES/, 'другие роли сохранены');
        const org = await WORK.get_item('/ORG');
        assert.deepEqual(await org.roles({ session: { uid: PETR } }), ['USER']);
        await assert.rejects(tool('assign').run({ path: '/ORG', role: 'NOPE', add: [IVAN] }, as(ADMIN)), /не объявлена/);
        await assert.rejects(tool('assign').run({ path: '/ORG', role: 'BOSS', add: ['25552181BAA7A14'] }, as(ADMIN)), /узлу/);
    });
});

describe('документы и таблицы', () => {
    it('read_table → import_objects: сопоставление, типы, обязательные поля, dry_run, без перезаписи', async () => {
        await tool('write_table').run({ path: '/ORG/Импорт/товары.csv', rows: [
            { 'Наименование': 'Молоко', 'Код': 'A1', 'Цена': '89,90', 'Активен': 'да' },
            { 'Наименование': 'Хлеб', 'Код': 'A2', 'Цена': '45', 'Активен': 'нет' },
            { 'Наименование': 'Хлеб', 'Код': 'A3', 'Цена': '47', 'Активен': 'да' },
        ] }, as(PETR));
        const csv = fs.readdirSync(path.join(tmp, 'ORG/$class/USER'), { recursive: true })
            .find(f => path.basename(String(f)) === 'товары.csv' && fs.statSync(path.join(tmp, 'ORG/$class/USER', f)).isFile());
        const src = '/ORG/$class/USER/' + String(csv).replace(/\\/g, '/');
        const table = JSON.parse(await tool('read_table').run({ path: src }, as(PETR)));
        assert.equal(table.total, 3);
        assert.deepEqual(table.columns, ['Наименование', 'Код', 'Цена', 'Активен']);

        const map = { 'Наименование': 'name', 'Код': 'code', 'Цена': 'price', 'Активен': 'active' };
        const bad = JSON.parse(await tool('import_objects').run({ path: '/ORG', type: 'data', source: src, map: { 'Наименование': 'name' } }, as(PETR)));
        assert.equal(bad.written, 0, 'без обязательного code — не пишем');
        assert.equal(bad.errors[0].missing[0], 'code');
        const dry = JSON.parse(await tool('import_objects').run({ path: '/ORG', type: 'data', source: src, map, dry_run: true }, as(PETR)));
        assert.equal(dry.valid, 3);
        assert.deepEqual(dry.sample[0], { name: 'Молоко', code: 'A1', price: 89.9, active: true });
        const res = JSON.parse(await tool('import_objects').run({ path: '/ORG', type: 'data', source: src, map }, as(PETR)));
        assert.equal(res.written, 3, JSON.stringify(res.failed));
        const files = fs.readdirSync(path.join(tmp, 'ORG/$class/DATA'), { recursive: true }).filter(f => String(f).endsWith('.data'));
        assert.equal(files.length, 3, 'два «Хлеба» в одну мс — разные объекты');
        const bodies = files.map(f => JSON.parse(fs.readFileSync(path.join(tmp, 'ORG/$class/DATA', f), 'utf-8')));
        assert.deepEqual(bodies.map(b => b.code).sort(), ['A1', 'A2', 'A3']);
        await assert.rejects(tool('import_objects').run({ path: '/ORG', type: 'nope', rows: [{}] }, as(PETR)), /нет типа данных \$nope/);
    });

    it('render_doc: md с вложенными полями; docx с меткой, разрезанной Word на куски, и экранированием', async () => {
        const res = await tool('render_doc').run({
            template: '/ORG/$class/USER/tpl/letter.md', path: '/ORG/Документы/письмо.md',
            data: { client: { name: 'ООО «Ромашка»' }, number: 17 },
        }, as(PETR));
        assert.match(res, /не заполнены поля: sum/);
        const out = fs.readdirSync(path.join(tmp, 'ORG/$class/USER'), { recursive: true })
            .find(f => path.basename(String(f)) === 'письмо.md' && fs.statSync(path.join(tmp, 'ORG/$class/USER', f)).isFile());
        assert.equal(fs.readFileSync(path.join(tmp, 'ORG/$class/USER', out), 'utf-8'), 'Уважаемый ООО «Ромашка»! Счёт №17 на  руб.');

        const zip = new AdmZip();
        zip.addFile('word/document.xml', Buffer.from('<w:document><w:body><w:p><w:r><w:t>Клиент: {{cli</w:t></w:r><w:r><w:t>ent}}</w:t></w:r><w:r><w:t> {{ sum }}</w:t></w:r></w:p></w:body></w:document>'));
        const filled = new AdmZip(fillDocx(zip.toBuffer(), { client: 'A & B <тест>', sum: 5 }));
        const xml = filled.readAsText('word/document.xml');
        assert.match(xml, /Клиент: A &amp; B &lt;тест&gt;/);
        assert.match(xml, / 5</);
        assert.doesNotMatch(xml, /\{\{/);
        await assert.rejects(tool('render_doc').run({ template: '/ORG/$class/USER/tpl/letter.md', path: '/ORG/x.docx' }, as(PETR)), /того же формата/);
    });
});

describe('память, эскалация, триггеры', () => {
    it('memory: память места видна только своей роли; личная — только владельцу; секреты не сохраняются', async () => {
        const org = await WORK.get_item('/ORG');
        const petr = { ...as(PETR), place: org }, boss = { ...as(BOSS), place: org };
        assert.match(await tool('memory').run({ action: 'remember', text: 'Отчёты отдела — только xlsx' }, petr), /запомнил.*роль USER/);
        assert.match(await tool('memory').run({ action: 'remember', text: 'Отчёты отдела — только xlsx' }, petr), /уже помню/);
        assert.match(await tool('memory').run({ action: 'remember', scope: 'me', text: 'Пётр любит краткие ответы' }, petr), /личная/);
        await assert.rejects(tool('memory').run({ action: 'remember', text: 'пароль: 12345' }, petr), /секреты/);
        const block = await memoryBlock(org, petr.session);
        assert.match(block, /Память места \(роль USER\)[\s\S]*xlsx/);
        assert.match(block, /Личная память[\s\S]*краткие/);
        const bossBlock = await memoryBlock(org, boss.session);
        assert.doesNotMatch(bossBlock, /xlsx/, 'память роли USER — в её зоне, у BOSS своя');
        assert.doesNotMatch(bossBlock, /краткие/, 'личная память — только владельцу');
        assert.match(await tool('memory').run({ action: 'forget', text: 'xlsx' }, petr), /забыто строк: 1/);
        assert.doesNotMatch(await memoryBlock(org, petr.session), /xlsx/);
    });

    it('escalate: запрос руководителю точки из кабинета, без доступа к самому файлу', async () => {
        write('ORG/SUB/$class/class.js', `export default { label: 'SUB' }`);
        (await WORK.get_item('/ORG')).reset();
        const res = await tool('escalate').run({ path: '/ORG/$class/BOSS/plan.md', need: 'read', reason: 'нужен план для отчёта' }, as(PETR));
        assert.match(res, new RegExp('руководитель /ORG: ' + BOSS));
        const inbox = await tool('logs').run({ path: '/USERS/' + BOSS }, as(BOSS));
        assert.match(inbox, /Запрос: read — \/ORG\/\$class\/BOSS\/plan\.md/);
        assert.match(inbox, /order/);
        // в подразделении без своего BOSS — вышестоящий
        const up = await tool('escalate').run({ path: '/ORG/SUB', need: 'role:USER', reason: 'работаю в SUB' }, as(PETR));
        assert.match(up, new RegExp('вышестоящий руководитель: ' + BOSS));
    });

    it('триггер: файл нужного вида → агент от имени as с правами точки; без цепной реакции и сверх лимита', async () => {
        write('ORG/$class/ai/triggers/new-doc.md', `---\nname: new-doc\next: md\nzone: USER\nas: ${BOSS}\nnotify: [${PETR}]\nmaxPerHour: 2\n---\nКратко перескажи новый документ.`);
        (await WORK.get_item('/ORG')).meta_folder.reset();
        TRIG.resetTriggerCache();
        const runs = [];
        const settle = async () => { await new Promise(r => setTimeout(r, 100)); await TRIG.idleTriggers(); };
        TRIG.setTriggerRunner(async o => { runs.push(o); return { status: 'done', content: 'пересказ готов' }; });
        try {
            const org = await WORK.get_item('/ORG');
            await tool('write').run({ path: '/ORG/заметка.md', content: 'текст' }, as(PETR));
            await settle();
            assert.equal(runs.length, 1);
            assert.equal(runs[0].session.uid, BOSS);
            assert.equal(runs[0].mode, 'ask', 'по умолчанию без побочных действий');
            assert.match(runs[0].prompt, /внешние данные/);
            assert.match(runs[0].prompt, /заметка\.md/);
            const feed = await tool('logs').run({ path: '/USERS/' + PETR }, as(PETR));
            assert.match(feed, /\[триггер «new-doc»\] пересказ готов/, 'результат доставлен notify');
            // запись, сделанная самим триггером, — без нового запуска
            await org.save_file({ session: { uid: BOSS, trigger: 'new-doc' }, role: 'BOSS', filename: 'x.md', post: 'x' }).catch(() => {});
            await tool('write').run({ path: '/ORG/другая.txt', content: 'не md' }, as(PETR));
            await settle();
            assert.equal(runs.length, 1, 'другое расширение и цепная запись не запускают');
            for (let i = 0; i < 3; i++)
                await tool('write').run({ path: '/ORG/n' + i + '.md', content: 'x' + i }, as(PETR));
            await settle();
            assert.equal(runs.length, 2, 'maxPerHour: 2');
        }
        finally {
            TRIG.setTriggerRunner(null);
            fs.rmSync(path.join(tmp, 'ORG/$class/ai/triggers'), { recursive: true, force: true });
            TRIG.resetTriggerCache();
        }
    });
});

describe('роль задачи', () => {
    it('администратор в роли USER: запись в зону USER (кабинет и точка), без прав ADMIN и инструментов ОС', async () => {
        const { taskRole } = await import('../sources/modules/agent/session.js');
        write('ORG/$class/class.js', fs.readFileSync(path.join(tmp, 'ORG/$class/class.js'), 'utf-8').replace("USERS: ['", "USERS: ['" + ADMIN + "', '"));
        (await WORK.get_item('/ORG')).reset();
        const ctx = { ...as(ADMIN), role: 'USER' };
        const cab = await tool('write').run({ path: '/USERS/' + ADMIN + '/work/презентация.html', content: '<p>x</p>' }, ctx);
        assert.match(cab, new RegExp('/USERS/' + ADMIN + '/\\$user/USER/'), 'кабинет — зона USER, а не ADMIN');
        const org = await tool('write').run({ path: '/ORG/итог.md', content: 'x' }, ctx);
        assert.match(org, /\/ORG\/\$class\/USER\//, 'точка — зона USER');
        // в ADMIN-задаче — как раньше, зона ADMIN
        const adm = await tool('write').run({ path: '/USERS/' + ADMIN + '/work/a.md', content: 'x' }, { ...as(ADMIN), role: 'ADMIN' });
        assert.match(adm, /\/\$user\/ADMIN\//);
        // действия администратора в роли USER — отказ с объяснением
        await assert.rejects(tool('assign').run({ path: '/ORG', role: 'USER', add: [IVAN] }, ctx), /роли USER/);
        // роль задачи — по зоне, где лежит .task
        const cabinet = await WORK.get_item('/USERS/' + ADMIN);
        const zone = await cabinet.work_zone({ role: 'USER' });
        const taskFile = FS.$file.build('x.task', await zone._get_next_item('task', FS.$folder));
        assert.equal(taskRole(taskFile), 'USER');
        // инструменты ОС/сети — только в роли ADMIN
        const asUser = await createEnv({ place: WORK, session: { uid: ADMIN }, role: 'USER' });
        assert.ok(!(await asUser.makeTools()).some(t => t.system));
        const asAdmin = await createEnv({ place: WORK, session: { uid: ADMIN }, role: 'ADMIN' });
        assert.ok((await asAdmin.makeTools()).some(t => t.system));
    });
});

describe('расписание', () => {
    it('nextRun: время в поясе, дни недели, интервал, разовое', () => {
        const from = Date.parse('2026-09-28T10:00:00Z'); // пн 13:00 МСК
        const r = S.normalizeRule({ at: '09:00', days: [1] });
        assert.equal(new Date(S.nextRun(r, 'Europe/Moscow', from)).toISOString(), '2026-10-05T06:00:00.000Z');
        assert.equal(new Date(S.nextRun(S.normalizeRule({ at: '14:30' }), 'Europe/Moscow', from)).toISOString(), '2026-09-28T11:30:00.000Z');
        assert.equal(S.nextRun(S.normalizeRule({ every: 60 }), 'UTC', from), from + 3600_000);
        assert.equal(S.nextRun(S.normalizeRule({ once: '2026-01-01T00:00:00Z' }), 'UTC', from), null);
        assert.throws(() => S.normalizeRule({ every: 5 }), /от 15/);
        assert.throws(() => S.normalizeRule({ at: '25:00' }));
        assert.throws(() => S.normalizeRule({ at: '09:00', days: [0] }), /1–7/);
    });

    it('schedule: создание из задачи, подтверждение, список, отмена; запуск от имени владельца', async () => {
        const t = tool('schedule');
        assert.equal(t.permission({ action: 'create', at: '09:00', prompt: 'сводка' }, { host: { allowed: new Set() } }).verdict, 'ask');
        assert.equal(t.permission({ action: 'list' }, {}).verdict, 'allow');
        const ctx = { ...as(BOSS), task: { path: '/ORG/$class/BOSS/task/сводка.task' }, tz: 'Europe/Moscow' };
        await assert.rejects(t.run({ action: 'create', at: '09:00', prompt: 'x' }, as(BOSS)), /из задачи/);
        const created = await t.run({ action: 'create', at: '09:00', days: [1], prompt: 'Сводка за неделю', label: 'Планёрка' }, ctx);
        const id = created.match(/расписание (\S+):/)[1];
        assert.match(await t.run({ action: 'list' }, ctx), /Планёрка/);
        assert.doesNotMatch(await t.run({ action: 'list', all: true }, as(IVAN)), /Планёрка/, 'чужие расписания не видны');
        await assert.rejects(t.run({ action: 'cancel', id }, as(IVAN)), /не найдено/);

        const runs = [];
        const [row] = await S.listSchedules({ uid: BOSS });
        const due = Date.parse(row.next) + 1000;
        const done = await S.runDue(due, async r => runs.push(r));
        assert.equal(done.length, 1);
        assert.equal(runs[0].uid, BOSS);
        assert.equal(runs[0].prompt, 'Сводка за неделю');
        const [after] = await S.listSchedules({ uid: BOSS });
        assert.ok(Date.parse(after.next) > due, 'перенесено на следующую неделю');
        // отозванный доступ — расписание выключается
        await S.runDue(Date.parse(after.next) + 1000, async () => { throw new Error('Доступ запрещён'); });
        assert.equal((await S.listSchedules({ uid: BOSS }))[0].enabled, false);
        assert.match(await t.run({ action: 'cancel', id }, ctx), /удалено/);
    });
});

describe('пакет ассистентов', () => {
    it('субагенты и навыки загружаются; схема запуска доступна только основному агенту', async () => {
        const env = await createEnv({ place: WORK, session: { uid: BOSS } });
        for (const a of ['analyst', 'secretary', 'auditor', 'builder', 'it-admin', 'integrator-1c', 'negotiator', 'reviewer'])
            assert.ok(env.agents.has(a), 'субагент ' + a);
        for (const s of ['summarize-feed', 'delegate-task', 'meeting-minutes', 'org-structure', 'onboarding',
            'doc-from-template', 'import-table', 'data-quality', 'approval-flow', 'lan-inventory', 'node-connect'])
            assert.ok(env.skills.has(s), 'навык ' + s);
        // it-admin у не-администратора не получает инструментов ОС/сети
        assert.ok(!(await env.makeTools(env.agents.get('it-admin'))).some(t => t.system));
        const admin = await createEnv({ place: WORK, session: { uid: ADMIN } });
        const itTools = (await admin.makeTools(admin.agents.get('it-admin'))).map(t => t.name);
        assert.ok(itTools.includes('net_scan') && itTools.includes('os_info'));
        // reviewer — только чтение
        assert.ok((await env.makeTools(env.agents.get('reviewer'))).every(t => t.readonly || t.name === 'task'));
        const analyst = env.agents.get('analyst');
        const names = (await env.makeTools(analyst)).map(t => t.name);
        assert.ok(names.includes('query') && names.includes('write_table'));
        assert.ok(!names.includes('assign') && !names.includes('schedule'));
        assert.ok((await env.makeTools()).some(t => t.name === 'schedule'));
    });
});
