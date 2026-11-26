import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { closeBaseDb } from '../sources/data/db.js';
import { closeIndexDb } from '../sources/host/index-db.js';
import * as LINKS from '../sources/server/access/links.js';
import * as TRIG from '../sources/modules/agent/triggers.js';
import { askTwin, MAX_TWIN_DEPTH } from '../sources/modules/agent/twin-bus.js';
import { createEnv } from '../sources/modules/agent/index.js';
import * as S from '../sources/modules/agent/scheduler.js';

const BOSS_UID = 'U_PRO_BOSS';
const USER_UID = 'U_PRO_USER';

function as(uid) {
    return { session: { uid, principal: { kind: 'user', id: uid } } };
}

describe('Проактивность Агентов $structure, when-предикаты, twin_ask и карточки подтверждения', () => {
    let tmpDir, prevCwd, prevWork, prevDev;

    before(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-proactivity-'));
        const write = (rel, text) => {
            const p = path.join(tmpDir, rel);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, text, 'utf8');
        };
        write('$server/class.js', `export default { '#security': { BOSS: ['WORK_ADMIN'] } }`);
        write('$server/$folder/class.js', `export default {}`);
        write('$server/$folder/$file/class.js', `export default {}`);
        write('$server/$folder/$class/$domain/class.js', `export default { label: 'Домен' }`);
        write('$server/$folder/$class/$structure/class.js', `export default {}`);
        write('$server/$folder/$class/$structure/$base/class.js', `export default { label: 'База' }`);
        write('$server/$folder/$class/$structure/$user/class.js', `export default { isSystem: true }`);
        write('$server/$folder/$class/$operation/class.js', `export default { label: 'Операция' }`);
        write('$server/$folder/$class/$module/class.js', `export default { label: 'Модуль' }`);

        write('USERS/$users/class.js', `export default { label: 'Люди' }`);
        write(`USERS/${BOSS_UID}/$user/class.js`, `export default { label: 'Босс' }`);
        write(`USERS/${USER_UID}/$user/class.js`, `export default { label: 'Менеджер' }`);

        write('ORGANIZATIONS/$domain/class.js', `export default { label: 'Организации', archiveType: '$base' }`);
        write('ORGANIZATIONS/OrgOne/$base/class.js', `export default { label: 'Орг 1', '#security': { BOSS: ['${BOSS_UID}'] } }`);
        write('ORGANIZATIONS/OrgOne/MODULES/$domain/class.js', `export default { label: 'Модули' }`);
        write('ORGANIZATIONS/OrgOne/MODULES/Reg/$module/class.js', `export default { label: 'Учёт' }`);
        write('ORGANIZATIONS/OrgOne/MODULES/Reg/SALE/$operation/class.js', `export default {
            label: 'Реализация',
            METADATA: { FIELDS: [{ id: 'sum', label: 'Сумма', type: 'number' }] }
        }`);
        write('ORGANIZATIONS/OrgOne/sales/$structure/class.js', `export default {
            label: 'Продажи',
            '#security': {
                ROLES: [{ id: 'mgr', label: 'Менеджер', USERS: ['${USER_UID}'], LINKS: [{ id: '/ORGANIZATIONS/OrgOne/MODULES/Reg/SALE', access: 'create' }] }]
            }
        }`);
        write('ORGANIZATIONS/OrgOne/warehouse/$structure/class.js', `export default {
            label: 'Склад',
            '#security': { USER: ['${USER_UID}'] }
        }`);
        write('ORGANIZATIONS/OrgTwo/$base/class.js', `export default { label: 'Чужая Орг', '#security': { BOSS: ['OTHER_BOSS'] } }`);

        prevCwd = process.cwd();
        prevWork = globalThis.WORK;
        prevDev = process.env.WORK_DEV;
        delete process.env.WORK_DEV;
        process.chdir(tmpDir);
        globalThis.WORK = new $server();
        await globalThis.WORK.init;
        LINKS.reset();
        TRIG.resetTriggerCache();
    });

    after(async () => {
        await TRIG.idleTriggers();
        TRIG.setTriggerRunner(null);
        TRIG.resetTriggerCache();
        try { closeIndexDb?.(); } catch {}
        await closeBaseDb('').catch(() => {});
        await closeBaseDb('/ORGANIZATIONS/OrgOne').catch(() => {});
        await closeBaseDb('/ORGANIZATIONS/OrgTwo').catch(() => {});
        process.chdir(prevCwd);
        globalThis.WORK = prevWork;
        if (prevDev !== undefined)
            process.env.WORK_DEV = prevDev;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('правила узла: BOSS сохраняет через agent_rule_save, USER получает отказ, db:register + when + template + approval + chat_action', async () => {
        const sales = await WORK.get_item('/ORGANIZATIONS/OrgOne/sales');
        const saleCls = await WORK.get_item('/ORGANIZATIONS/OrgOne/MODULES/Reg/SALE');

        await assert.rejects(
            () => sales.agent_rule_save({ ...as(USER_UID), name: 'hack', on: 'db:register', as: USER_UID }),
            /Доступ запрещён/
        );

        await sales.agent_rule_save({
            ...as(BOSS_UID),
            post: {
                name: 'big-sale',
                on: 'db:register',
                class: '/ORGANIZATIONS/OrgOne/MODULES/Reg/SALE',
                when: 'sum > 100000',
                template: 'Крупная продажа: {{sum}} руб.',
                approval: true,
                as: BOSS_UID,
                notify: ['BOSS'],
                cooldownSec: 60,
            },
        });

        const rules = await sales.agent_rules_list(as(BOSS_UID));
        assert.ok(rules.triggers.some(t => t.name === 'big-sale' && t.own && t.approval));

        let llmCalls = 0;
        TRIG.setTriggerRunner(async () => { llmCalls++; return { status: 'done', content: 'llm' }; });

        // Мелкая продажа — when ложно, триггер не запускается
        const small = await saleCls.db_create({ ...as(USER_UID), body: { sum: 50000 } });
        await saleCls.db_register({ ...as(USER_UID), id: small.id });
        await TRIG.idleTriggers();
        assert.equal(llmCalls, 0);

        const bossThreadsBefore = await sales.chat_threads_list(as(BOSS_UID));
        assert.equal(bossThreadsBefore.length, 0);

        // Крупная продажа — when истинно, template срабатывает без вызова LLM и шлёт карточку подтверждения BOSS
        const big = await saleCls.db_create({ ...as(USER_UID), body: { sum: 150000 } });
        await saleCls.db_register({ ...as(USER_UID), id: big.id });
        await TRIG.idleTriggers();
        assert.equal(llmCalls, 0, 'при наличии template LLM не вызывается');

        const bossThreadsAfter = await sales.chat_threads_list(as(BOSS_UID));
        assert.equal(bossThreadsAfter.length, 1);
        const msgList = await sales.chat_messages_list({ ...as(BOSS_UID), threadId: bossThreadsAfter[0].id });
        assert.equal(msgList.messages.length, 1);
        const card = msgList.messages[0];
        assert.equal(card.sender, '$twin');
        assert.equal(card.kind, 'approval');
        assert.equal(card.meta.status, 'pending');
        assert.match(card.content, /Крупная продажа: 150000 руб\./);

        // Повторное срабатывание на тот же объект подавляется cooldownSec
        await TRIG.onDbEvent('db:register', { basePath: '/ORGANIZATIONS/OrgOne', cls: { path: saleCls.path }, obj: { ...big, body: { sum: 150000 } } });
        await TRIG.idleTriggers();
        const msgList2 = await sales.chat_messages_list({ ...as(BOSS_UID), threadId: bossThreadsAfter[0].id });
        assert.equal(msgList2.messages.length, 1);

        // Подтверждение карточки через chat_action
        const actRes = await sales.chat_action({ ...as(BOSS_UID), threadId: bossThreadsAfter[0].id, messageId: card.id, action: 'approve' });
        assert.equal(actRes.ok, true);
        assert.equal(actRes.message.meta.status, 'approved');
        assert.equal(actRes.message.meta.resolvedBy, BOSS_UID);
    });

    it('chat:message триггер срабатывает на входящее сообщение и не зацикливается от ответа $twin', async () => {
        const sales = await WORK.get_item('/ORGANIZATIONS/OrgOne/sales');
        await sales.agent_rule_save({
            ...as(BOSS_UID),
            post: {
                name: 'auto-reply',
                on: 'chat:message',
                when: "content != ''",
                as: BOSS_UID,
                notify: [USER_UID],
                body: 'Помоги пользователю с вопросом',
            },
        });
        let runs = 0;
        TRIG.setTriggerRunner(async ({ prompt }) => {
            runs++;
            assert.match(prompt, /Помоги пользователю с вопросом/);
            return { status: 'done', content: 'Ответ проактивного Агента' };
        });

        const t = await sales.chat_thread_open(as(USER_UID));
        await sales.chat_send({ ...as(USER_UID), threadId: t.id, message: 'Есть остатки масла?' });
        await TRIG.idleTriggers();
        assert.equal(runs, 1, 'триггер отработал ровно один раз без зацикливания на ответ $twin');

        const msgs = await sales.chat_messages_list({ ...as(USER_UID), threadId: t.id });
        assert.equal(msgs.messages.length, 2);
        assert.equal(msgs.messages[1].sender, '$twin');
        assert.match(msgs.messages[1].content, /Ответ проактивного Агента/);
    });

    it('twin_ask: межагентный канал внутри организации, запрет циклов/глубины/чужой организации и вырезка Control Plane', async () => {
        const res = await askTwin({
            fromPath: '/ORGANIZATIONS/OrgOne/sales',
            targetPath: '/ORGANIZATIONS/OrgOne/warehouse',
            question: 'Сколько литров на складе?',
            session: as(USER_UID).session,
            runner: async ({ place, session, mode }) => {
                assert.equal(place.path, '/ORGANIZATIONS/OrgOne/warehouse');
                assert.equal(mode, 'ask');
                assert.equal(session.twinCall.depth, 1);
                // Проверяем, что в createEnv при twinCall инструменты Control Plane физически не монтируются
                const env = await createEnv({ place, session, role: 'USER' });
                const tools = await env.makeTools(null);
                const names = new Set(tools.map(t => t.name));
                assert.ok(!names.has('create_class') && !names.has('update_class') && !names.has('delete_class') && !names.has('assign') && !names.has('shell'),
                    'Control Plane инструменты вырезаны при межагентном вызове');
                return { status: 'done', content: 'На складе 500 л' };
            },
        });
        assert.equal(res.ok, true);
        assert.equal(res.answer, 'На складе 500 л');

        await assert.rejects(
            () => askTwin({
                fromPath: '/ORGANIZATIONS/OrgOne/sales',
                targetPath: '/ORGANIZATIONS/OrgOne/warehouse',
                question: 'Цикл',
                session: as(USER_UID).session,
                visited: ['/ORGANIZATIONS/OrgOne/sales', '/ORGANIZATIONS/OrgOne/warehouse'],
                runner: async () => ({}),
            }),
            /обнаружен цикл/
        );

        await assert.rejects(
            () => askTwin({
                fromPath: '/ORGANIZATIONS/OrgOne/sales',
                targetPath: '/ORGANIZATIONS/OrgOne/warehouse',
                question: 'Глубина',
                session: as(USER_UID).session,
                depth: MAX_TWIN_DEPTH,
                runner: async () => ({}),
            }),
            /превышена максимальная глубина/
        );

        await assert.rejects(
            () => askTwin({
                fromPath: '/ORGANIZATIONS/OrgOne/sales',
                targetPath: '/ORGANIZATIONS/OrgTwo',
                question: 'Чужая база',
                session: as(USER_UID).session,
                runner: async () => ({}),
            }),
            /границы организации/
        );
    });

    it('расписание узла: BOSS создаёт расписание nodePath через agent_schedule_save', async () => {
        const sales = await WORK.get_item('/ORGANIZATIONS/OrgOne/sales');
        const created = await sales.agent_schedule_save({
            ...as(BOSS_UID),
            post: { label: 'Сводка продаж', prompt: 'Собери итог дня', rule: { every: 60 } },
        });
        assert.equal(created.nodePath, '/ORGANIZATIONS/OrgOne/sales');
        assert.equal(created.enabled, true);

        const rules = await sales.agent_rules_list(as(BOSS_UID));
        assert.ok(rules.schedules.some(s => s.id === created.id));
        await S.cancelSchedule({ uid: BOSS_UID, id: created.id });
    });

    it('субъектность $structure-двойника, инструменты самонастройки и тихая сводка (молчит при 0 событий, шлёт при наличии)', async () => {
        const { createEnv } = await import('../sources/modules/agent/index.js');
        const { collectQuietDigest, runQuietDigests } = await import('../sources/modules/agent/node-rules.js');
        const sales = await WORK.get_item('/ORGANIZATIONS/OrgOne/sales');
        const warehouse = await WORK.get_item('/ORGANIZATIONS/OrgOne/warehouse');

        const structSysMd = fs.readFileSync(path.join(prevCwd, '$server/$folder/$class/$structure/ai/system.md'), 'utf8');
        assert.match(structSysMd, /Субъектность цифрового двойника узла/i, 'файл субъектности $structure/ai/system.md существует');

        const bossUser = await WORK.get_item('/USERS/' + BOSS_UID);
        const env = await createEnv({ place: sales, session: { ...as(BOSS_UID).session, $user: bossUser } });
        const sysPrompt = await env.makeSystem();
        assert.match(sysPrompt, /цифровой двойник подразделения «Продажи»/i, 'в системном контексте указана субъектность подразделения');
        assert.match(sysPrompt, /Собеседник \(кто обратился\):/i, 'собеседник отделён от идентичности узла');

        const bossTools = await env.makeTools();
        assert.ok(bossTools.some(t => t.name === 'twin_rule_save'), 'BOSS имеет инструмент самонастройки правил twin_rule_save');
        assert.ok(bossTools.some(t => t.name === 'twin_schedule_save'), 'BOSS имеет инструмент самонастройки расписаний twin_schedule_save');

        const svcEnv = await createEnv({ place: sales, session: { ...as(BOSS_UID).session, twinCall: { fromPath: '/', depth: 1 } } });
        const svcTools = await svcEnv.makeTools();
        assert.equal(svcTools.some(t => t.name === 'twin_rule_save'), false, 'в Service Plane инструменты настройки правил вырезаны');

        // На чистом узле warehouse (без зависших карточек/обращений) тихая сводка молчит,
        // даже если пользователь ранее создавал .task-задачу (task_path != '')
        const { dbForThreadStorage } = await import('../sources/server/chat-threads.js');
        const db = await dbForThreadStorage(warehouse, 'twin');
        const oldTs = Date.now() - 2 * 3600_000;
        const tid = `twin:/ORGANIZATIONS/OrgOne/warehouse:${USER_UID}`;
        db.prepare(`INSERT OR IGNORE INTO chat_threads (id, kind, node_path, title, created_by, created, updated) VALUES (?, 'twin', '/ORGANIZATIONS/OrgOne/warehouse', 'Склад', ?, ?, ?)`)
            .run(tid, USER_UID, oldTs, oldTs);
        db.prepare(`INSERT OR IGNORE INTO chat_participants (thread_id, uid, role, last_read_id, joined) VALUES (?, ?, 'member', 0, ?)`)
            .run(tid, USER_UID, oldTs);
        db.prepare(`INSERT INTO chat_messages (thread_id, sender, kind, content, reply_to, mentions, attachments, task_path, meta, created) VALUES (?, ?, 'text', 'Создана задача', NULL, '[]', '[]', '/ORGANIZATIONS/OrgOne/warehouse/~/task/t1.task', '{}', ?)`)
            .run(tid, USER_UID, oldTs);

        const emptyDig = await collectQuietDigest(warehouse);
        assert.equal(emptyDig.events.length, 0, 'на тихом узле (только .task) 0 событий');
        const silentRes = await runQuietDigests({ nodes: [warehouse] });
        assert.equal(silentRes.length, 0, 'при 0 событий тихая сводка не спамит');

        // Если в узле есть ожидающая карточка approval старше 1 часа — тихая сводка отправляется BOSS
        db.prepare(`INSERT INTO chat_messages (thread_id, sender, kind, content, reply_to, mentions, attachments, task_path, meta, created) VALUES (?, '$twin', 'approval', 'Списание сверх нормы', NULL, '[]', '[]', '', '{"status":"pending"}', ?)`)
            .run(tid, oldTs);

        const activeRes = await runQuietDigests({ nodes: [warehouse] });
        assert.equal(activeRes.length, 1, 'при наличии реального события отправлена сводка');
        assert.equal(activeRes[0].bossUid, BOSS_UID);

        // Встроенный autoReply на прямое сообщение в twin-чат (на узле без явного правила chat:message)
        TRIG.setTriggerRunner(null);
        const { onChatEvent, idleTriggers } = await import('../sources/modules/agent/triggers.js');
        globalThis.__workDefaultTwinRunner = async ({ prompt }) => ({ status: 'done', content: 'Принято складом: ' + prompt });
        try {
            const msgRes = await onChatEvent({
                storage: warehouse,
                thread: { id: `twin:/ORGANIZATIONS/OrgOne/warehouse:${USER_UID}`, kind: 'twin', nodePath: '/ORGANIZATIONS/OrgOne/warehouse' },
                message: { id: 999, sender: USER_UID, kind: 'text', content: 'Проверь остатки', taskPath: '' },
                params: as(USER_UID),
            });
            assert.ok(msgRes >= 1);
            await idleTriggers();
            const threadMsgs = await warehouse.chat_messages_list({ ...as(USER_UID), kind: 'twin' });
            assert.ok(threadMsgs.messages.some(m => m.sender === '$twin' && m.content.includes('Принято складом: Проверь остатки')));
        }
        finally {
            delete globalThis.__workDefaultTwinRunner;
        }
    });

    it('ODANT-маска времени (YYYY-MM-05T10:15:00), системная инструкция (ai/system.md), доступ подразделений как участников роли и фиксация таски босса', async () => {
        // 1. ODANT-маска времени в scheduler.js
        const maskRule = S.normalizeRule({ mask: 'YYYY-MM-05T10:15:00' });
        assert.equal(maskRule.mask, 'YYYY-MM-05T10:15:00');
        assert.match(S.describeRule(maskRule), /5-е число месяца.*10:15/);
        const fromMs = Date.parse('2026-11-10T08:00:00Z');
        const nextIso = new Date(S.nextRun(maskRule, 'Europe/Moscow', fromMs)).toISOString();
        assert.equal(nextIso, '2026-12-05T07:15:00.000Z');

        const dailyMask = S.normalizeRule({ mask: 'YYYY-MM-DDT09:00:00', days: [1, 2, 3, 4, 5] });
        assert.match(S.describeRule(dailyMask), /по будням в 09:00/);

        // 2. Системная инструкция узла (ai/system.md): чтение унаследованной и сохранение своей
        const orgOne = await WORK.get_item('/ORGANIZATIONS/OrgOne');
        await orgOne.agent_system_save({
            ...as(BOSS_UID),
            post: { text: 'Общее правило организации: отвечай вежливо и точно.', replace: false },
        });
        const sales = await WORK.get_item('/ORGANIZATIONS/OrgOne/sales');
        await sales.agent_system_save({
            ...as(BOSS_UID),
            post: { text: 'Ты главный менеджер по продажам.', replace: false },
        });
        const sysInfo = await sales.agent_system_get(as(BOSS_UID));
        assert.equal(sysInfo.text, 'Ты главный менеджер по продажам.');
        assert.equal(sysInfo.replace, false);
        assert.ok(Array.isArray(sysInfo.inherited) && sysInfo.inherited.some(l => l.text.includes('Общее правило организации')), 'видны унаследованные правила сверху');

        // Обычный сотрудник не может менять инструкцию узла
        await assert.rejects(
            () => sales.agent_system_save({ ...as(USER_UID), post: { text: 'взлом' } }),
            /Доступ запрещён/
        );

        // 3. Доступные классы, подразделения и security_update (ровно 1 BOSS + подразделение как участник роли)
        const clsTree = await sales.agent_available_classes(as(BOSS_UID));
        assert.ok(clsTree.roots.some(r => JSON.stringify(r).includes('/ORGANIZATIONS/OrgOne/MODULES/Reg/SALE')), 'виден класс реализации в модуле организации');

        const structs = await sales.agent_structures_list(as(BOSS_UID));
        assert.ok(structs.structures.some(s => s.path === '/ORGANIZATIONS/OrgOne/warehouse'), 'список подразделений включает warehouse');

        // Выдаём подразделению /ORGANIZATIONS/OrgOne/warehouse роль в sales на чтение SALE
        await sales.security_update({
            ...as(BOSS_UID),
            post: {
                security: {
                    BOSS: [BOSS_UID, USER_UID], // проверка обрезки до 1 BOSS
                    ROLES: [{
                        id: 'for_warehouse',
                        label: 'Доступ для Склада',
                        USERS: ['/ORGANIZATIONS/OrgOne/warehouse'],
                        LINKS: [{ id: '/ORGANIZATIONS/OrgOne/MODULES/Reg/SALE', access: 'read' }],
                    }],
                },
                title: 'Настроен доступ для Склада',
            },
        });
        assert.equal(sales.DATA['#security'].BOSS.length, 1, 'BOSS на точку сохраняется только один');
        assert.equal(await sales.hasNodeRole('/ORGANIZATIONS/OrgOne/warehouse'), true);
        LINKS.reset();

        // Пользователь USER_UID не имеет прямых ролей в sales, но действует из warehouse через twin_ask:
        // доступ открывается ТОЛЬКО к роли подразделения warehouse (twinRoleOnly = true)
        const saleCls = await WORK.get_item('/ORGANIZATIONS/OrgOne/MODULES/Reg/SALE');
        const askRes = await askTwin({
            fromPath: '/ORGANIZATIONS/OrgOne/warehouse',
            targetPath: '/ORGANIZATIONS/OrgOne/sales',
            question: 'Дай сводку продаж',
            session: as(USER_UID).session,
            runner: async ({ place, session }) => {
                assert.equal(session.twinRoleOnly, true, 'включён ограниченный режим роли подразделения');
                const r = await place.roles({ session });
                assert.deepEqual(r, ['USER'], 'в целевом узле выдана только роль USER без прав BOSS');
                assert.equal(await LINKS.dataAccess(saleCls, { session }), 'read', 'привязанный класс доступен строго на чтение');
                return { status: 'done', content: 'Продажи за период: 200 000' };
            },
        });
        assert.equal(askRes.ok, true);
        assert.match(askRes.answer, /Продажи за период/);

        // 4. Все новые методы вкладок Системы зарегистрированы в gateway.js (MEMBERS)
        const { MEMBERS, resolveMember } = await import('../sources/server/access/gateway.js');
        for (const m of ['agent_system_get', 'agent_system_save', 'agent_available_classes', 'agent_structures_list', 'agent_network_nodes', 'agent_staff_context', 'agent_base_module_install', 'agent_base_class_create', 'agent_tasks_list', 'security_update']) {
            assert.ok(MEMBERS[m], `метод ${m} зарегистрирован в gateway.js MEMBERS`);
            assert.ok(resolveMember(sales, m), `метод ${m} разрешается на $structure`);
        }

        // 4.1 Единый контекст agent_staff_context: унаследованный BOSS сверху и дерево классов $base
        const staffCtx = await sales.agent_staff_context(as(BOSS_UID));
        assert.ok(staffCtx.inheritedBoss || staffCtx.users.some(u => u.id === BOSS_UID));
        assert.ok(Array.isArray(staffCtx.baseClasses) && staffCtx.baseClasses.some(m => m.id === 'Reg'), 'в контексте роли есть модули вышестоящего $base');
        assert.equal(staffCtx.basePath, '/ORGANIZATIONS/OrgOne');

        // 5. Узлы сети (/NODES) как активные участники ролей: agent_network_nodes и доступ node_principal
        fs.mkdirSync(path.join(tmpDir, 'NODES/$node'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'NODES/$node/class.js'), 'export default { label: "Сеть" }', 'utf8');
        fs.mkdirSync(path.join(tmpDir, 'NODES/partner-1/$node'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'NODES/partner-1/$node/class.js'), `export default { label: "Сервер Партнёра", host_id: "AABBCCDDEEFF001", origin: "https://partner.example" }`, 'utf8');
        WORK.reset?.();
        const netRes = await sales.agent_network_nodes(as(BOSS_UID));
        assert.ok(netRes.nodes.some(n => n.id === 'partner-1' && n.principalId === 'AABBCCDDEEFF001' && n.label === 'Сервер Партнёра'));

        await sales.security_update({
            ...as(BOSS_UID),
            post: {
                security: {
                    BOSS: [BOSS_UID],
                    ROLES: [{
                        id: 'partner_role',
                        label: 'Доступ партнёрского сервера',
                        USERS: ['AABBCCDDEEFF001'],
                        LINKS: [{ id: '/ORGANIZATIONS/OrgOne/MODULES/Reg/SALE', access: 'read' }],
                    }],
                },
                title: 'Добавлен сервер сети в роль',
            },
        });
        LINKS.reset();
        const nodeSession = {
            uid: 'AABBCCDDEEFF001',
            principal: { kind: 'node', id: 'AABBCCDDEEFF001', roles: ['USER'] },
        };
        assert.deepEqual(await sales.roles({ session: nodeSession }), ['USER'], 'удалённый сервер сети получает роль USER в подразделении');
        assert.equal(await LINKS.dataAccess(saleCls, { session: nodeSession }), 'read', 'удалённый сервер сети получает доступ к привязанному классу роли');
        const grants = await WORK.node_grants({ session: nodeSession });
        assert.ok(grants.some(g => g.point === '/ORGANIZATIONS/OrgOne/sales' && g.role === 'USER'), 'node_grants видит назначение узла на подразделение');
    });
});
