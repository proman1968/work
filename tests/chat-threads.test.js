import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { openDataDb, closeBaseDb } from '../sources/data/db.js';
import { closeIndexDb } from '../sources/host/index-db.js';
import * as REFS from '../sources/server/access/refs.js';
import * as LINKS from '../sources/server/access/links.js';
import { ACCESSORIES, sanitizeLook } from '../$server/$folder/lib/dot/dot-math.js';

const BOSS_UID = 'U_BOSS_1';
const USER1_UID = 'U_EMP_1';
const USER2_UID = 'U_EMP_2';
const CLIENT_UID = 'U_CLIENT_1';
const OUTSIDER_UID = 'U_OUTSIDER_1';

function as(uid) {
    return { session: { uid, principal: { kind: 'user', id: uid } } };
}

describe('Ядро бесед мессенджера (chat_threads, WebSocket-события, visible_contacts, work-dot)', () => {
    let tmpDir, prevCwd, prevWork, prevDev;

    before(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-chat-threads-'));
        const write = (rel, text) => {
            const p = path.join(tmpDir, rel);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, text, 'utf8');
        };
        write('$server/class.js', `export default { '#security': { BOSS: ['WORK_ADMIN'] } }`);
        write('$server/$folder/class.js', `export default {}`);
        write('$server/$folder/$file/class.js', `export default {}`);
        write('$server/$folder/$file/$txt/class.js', `export default {}`);
        write('$server/$folder/$class/$domain/class.js', `export default { label: 'Домен' }`);
        write('$server/$folder/$class/$structure/class.js', `export default {}`);
        write('$server/$folder/$class/$structure/$base/class.js', `export default { label: 'База' }`);
        write('$server/$folder/$class/$structure/$user/class.js', `export default { isSystem: true }`);

        write('USERS/$users/class.js', `export default { label: 'Люди' }`);
        write(`USERS/${BOSS_UID}/$user/class.js`, `export default { label: 'Босс Орг' }`);
        write(`USERS/${USER1_UID}/$user/class.js`, `export default { label: 'Иван' }`);
        write(`USERS/${USER2_UID}/$user/class.js`, `export default { label: 'Пётр' }`);
        write(`USERS/${CLIENT_UID}/$user/class.js`, `export default { label: 'Клиент ООО' }`);
        write(`USERS/${OUTSIDER_UID}/$user/class.js`, `export default { label: 'Чужой' }`);

        write('ORGANIZATIONS/$domain/class.js', `export default { label: 'Организации', archiveType: '$base' }`);
        write('PROJECTS/$domain/class.js', `export default { label: 'Проекты', archiveType: '$project' }`);
        write('NODES/$node/class.js', `export default { label: 'Сеть' }`);
        write('SERVICES/$service/class.js', `export default { label: 'Сервисы и MCP' }`);
        write('ORGANIZATIONS/OrgOne/$base/class.js', `export default { label: 'Орг Один', '#security': { BOSS: ['${BOSS_UID}'] } }`);
        write('ORGANIZATIONS/OrgOne/sales/$structure/class.js', `export default {
            label: 'Продажи',
            '#security': {
                ROLES: [
                    { id: 'mgr', label: 'Менеджеры', USERS: ['${USER1_UID}', '${USER2_UID}'] },
                    { id: 'clients', label: 'Клиенты', external: true, USERS: ['${CLIENT_UID}'] }
                ]
            }
        }`);
        write('ORGANIZATIONS/OrgOne/sales/$structure/offer.txt', 'Коммерческое предложение для пересылки');
        write('ORGANIZATIONS/OrgTwo/$base/class.js', `export default { label: 'Орг Два', '#security': { USER: ['${OUTSIDER_UID}'] } }`);

        prevCwd = process.cwd();
        prevWork = globalThis.WORK;
        prevDev = process.env.WORK_DEV;
        delete process.env.WORK_DEV;
        process.chdir(tmpDir);
        globalThis.WORK = new $server();
        await globalThis.WORK.init;
        LINKS.reset();
    });

    after(async () => {
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

    it('миграция №6 создаёт таблицы chat_threads, chat_participants, chat_messages', async () => {
        const db = await openDataDb(':memory:');
        try {
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
            assert.ok(tables.includes('chat_threads'));
            assert.ok(tables.includes('chat_participants'));
            assert.ok(tables.includes('chat_messages'));
        }
        finally {
            db.close();
        }
    });

    it('персональные twin-диалоги с Агентом подразделения изолированы друг от друга, но видны BOSS в режиме audit', async () => {
        const sales = await WORK.get_item('/ORGANIZATIONS/OrgOne/sales');
        const t1 = await sales.chat_thread_open(as(USER1_UID));
        const t2 = await sales.chat_thread_open(as(USER2_UID));
        const tClient = await sales.chat_thread_open(as(CLIENT_UID));

        assert.equal(t1.kind, 'twin');
        assert.notEqual(t1.id, t2.id);
        assert.equal(tClient.participants[0].role, 'client');

        await sales.chat_send({ ...as(USER1_UID), threadId: t1.id, message: 'Запрос Ивана по продажам' });
        await sales.chat_send({ ...as(USER2_UID), threadId: t2.id, message: 'Секретный черновик Петра' });
        await sales.chat_send({ ...as(CLIENT_UID), threadId: tClient.id, message: 'Где мой заказ?' });

        // Пользователь видит только свою беседу
        const mine1 = await sales.chat_threads_list(as(USER1_UID));
        assert.deepEqual(mine1.map(t => t.id), [t1.id]);

        // Чужой twin-диалог USER1 читать не может
        await assert.rejects(
            () => sales.chat_messages_list({ ...as(USER1_UID), threadId: t2.id }),
            /Доступ запрещён/
        );
        // Режим audit недоступен обычному USER
        await assert.rejects(
            () => sales.chat_threads_list({ ...as(USER1_UID), mode: 'audit' }),
            /Доступ запрещён/
        );

        // BOSS видит все взаимодействия пользователей и клиентов с Агентом отдела
        const audit = await sales.chat_threads_list({ ...as(BOSS_UID), mode: 'audit' });
        assert.equal(audit.length, 3);
        const msgView = await sales.chat_messages_list({ ...as(BOSS_UID), threadId: t2.id });
        assert.equal(msgView.messages[0].content, 'Секретный черновик Петра');
    });

    it('личные DM 1:1 (включая свой $user), непрочитанные счётчики, chat_mark_read, приватность от BOSS и доступ к вложениям', async () => {
        const u2Node = await WORK.get_item(`/USERS/${USER2_UID}`);
        const u1Node = await WORK.get_item(`/USERS/${USER1_UID}`);

        // Чат со своим $user-двойником
        const selfThread = await u1Node.chat_thread_open(as(USER1_UID));
        assert.equal(selfThread.kind, 'dm');
        assert.equal(selfThread.id, `dm:${USER1_UID}|${USER1_UID}`);
        await u1Node.chat_send({ ...as(USER1_UID), threadId: selfThread.id, message: 'Заметка самому себе' });

        // DM Иван -> Пётр с прикреплённым файлом из отдела продаж
        const dm = await u2Node.chat_thread_open(as(USER1_UID));
        assert.equal(dm.kind, 'dm');
        const sent = await u2Node.chat_send({
            ...as(USER1_UID),
            threadId: dm.id,
            message: 'Посмотри КП',
            attachments: [{ path: '/ORGANIZATIONS/OrgOne/sales/$structure/offer.txt', name: 'offer.txt' }],
        });
        assert.equal(sent.attachments.length, 1);

        // Вложение в DM открывает доступ к конкретному файлу через REFS
        assert.equal(await REFS.visible(USER2_UID, '/ORGANIZATIONS/OrgOne/sales/$structure/offer.txt'), true);

        // Непрочитанное у Петра = 1, после mark_read = 0
        const unreadBefore = await WORK.chat_unread_summary(as(USER2_UID));
        assert.equal(unreadBefore.byPeer[USER1_UID], 1);
        assert.equal(unreadBefore.total, 1);

        await u1Node.chat_mark_read({ ...as(USER2_UID), threadId: dm.id, lastMessageId: sent.id });
        const unreadAfter = await WORK.chat_unread_summary(as(USER2_UID));
        assert.equal(unreadAfter.total, 0);

        // Twin-сообщение от имени $twin в подразделении OrgOne/sales попадает в глобальный WORK.chat_unread_summary и обнуляется markRead
        const sales = await WORK.get_item('/ORGANIZATIONS/OrgOne/sales');
        await sales.chat_send({ uid: USER1_UID, asTwin: true, message: 'Уведомление отдела продаж' });
        const twinUnreadBefore = await WORK.chat_unread_summary(as(USER1_UID));
        assert.equal(twinUnreadBefore.byNode['/ORGANIZATIONS/OrgOne/sales'], 1);
        const markRes = await sales.chat_mark_read({ ...as(USER1_UID), threadId: `twin:/ORGANIZATIONS/OrgOne/sales:${USER1_UID}` });
        assert.equal(markRes.kind, 'twin');
        assert.equal(markRes.nodePath, '/ORGANIZATIONS/OrgOne/sales');
        const twinUnreadAfter = await WORK.chat_unread_summary(as(USER1_UID));
        assert.equal(twinUnreadAfter.byNode['/ORGANIZATIONS/OrgOne/sales'] || 0, 0);

        // Личная переписка людей приватна даже от BOSS организации
        await assert.rejects(
            () => u2Node.chat_messages_list({ ...as(BOSS_UID), threadId: dm.id }),
            /Доступ запрещён/
        );
    });

    it('visible_contacts возвращает себя первым, коллег, внешних клиентов с пометкой external и скрывает чужую организацию', async () => {
        const contacts = await WORK.visible_contacts(as(USER1_UID));
        assert.equal(contacts[0].id, USER1_UID);
        assert.equal(contacts[0].self, true);

        const ids = contacts.map(c => c.id);
        assert.ok(ids.includes(USER2_UID), 'коллега по OrgOne виден');
        assert.ok(ids.includes(BOSS_UID), 'руководитель OrgOne виден');
        assert.ok(ids.includes(CLIENT_UID), 'клиент OrgOne виден');
        assert.ok(!ids.includes(OUTSIDER_UID), 'пользователь чужой организации OrgTwo скрыт');

        const clientEntry = contacts.find(c => c.id === CLIENT_UID);
        assert.equal(clientEntry.external, true);
        const bossEntry = contacts.find(c => c.id === BOSS_UID);
        assert.equal(bossEntry.external, false);
    });

    it('раздел USERS в корне расположен сразу под PROJECTS и скрыт от внешних клиентов (CLIENT)', async () => {
        const usersNode = await WORK.get_item('/USERS');
        assert.equal(await usersNode.allowAccess(as(BOSS_UID)), true, 'BOSS видит /USERS');
        assert.equal(await usersNode.allowAccess(as(USER1_UID)), true, 'сотрудник USER видит /USERS');
        assert.equal(await usersNode.allowAccess(as(CLIENT_UID)), false, 'внешний CLIENT не видит /USERS в дереве');

        const rootInfo = await WORK.info({ deep: 1 });
        const ids = (rootInfo?.items || []).map(it => it.id);
        assert.ok(ids.indexOf('ORGANIZATIONS') >= 0 && ids.indexOf('PROJECTS') > ids.indexOf('ORGANIZATIONS'));
        assert.equal(ids.indexOf('USERS'), ids.indexOf('PROJECTS') + 1, 'USERS идёт сразу после PROJECTS');
        assert.equal(ids.indexOf('NODES'), ids.indexOf('USERS') + 1, 'NODES (Сеть) идёт сразу под USERS');
        assert.ok(ids.indexOf('SERVICES') > ids.indexOf('NODES'));
    });

    it('work-dot поддерживает профессиональные аксессуары (wrench, tie, calc, headphones)', () => {
        for (const acc of ['glasses', 'cap', 'wrench', 'tie', 'calc', 'headphones']) {
            assert.ok(ACCESSORIES.includes(acc));
            assert.equal(sanitizeLook({ accessory: acc }).accessory, acc);
        }
        assert.equal(sanitizeLook({ accessory: 'unknown' }).accessory, 'none');
    });
});
