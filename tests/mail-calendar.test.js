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
import { calendarMailTools } from '../sources/modules/agent/tools/calendar-mail.js';
import { decide } from '../sources/modules/agent/permissions.js';
import { imapFolderToBox } from '../sources/host/email-utils.js';

const BOSS_UID = 'U_MC_BOSS';
const USER1_UID = 'U_MC_USER1';
const USER2_UID = 'U_MC_USER2';

function as(uid) {
    return { session: { uid, principal: { kind: 'user', id: uid } } };
}

const tool = name => calendarMailTools.find(t => t.name === name);

describe('Почта и Календарь WORK (mail_*, calendar_*, ИИ-инструменты)', () => {
    let tmpDir, prevCwd, prevWork, prevDev;

    before(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-mail-cal-'));
        const write = (rel, text) => {
            const p = path.join(tmpDir, rel);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, text, 'utf8');
        };
        write('$server/class.js', `export default { '#security': { BOSS: ['WORK_ADMIN'] } }`);
        write('$server/$folder/class.js', `export default {}`);
        write('$server/$folder/$file/class.js', `export default {}`);
        write('$server/$folder/$file/$eml/class.js', `export default { point: true }`);
        write('$server/$folder/$file/$ics/class.js', `export default { point: true }`);
        write('$server/$folder/$file/$task/class.js', `export default { point: true }`);
        write('$server/$folder/$class/$domain/class.js', `export default { label: 'Домен' }`);
        write('$server/$folder/$class/$structure/class.js', `export default {}`);
        write('$server/$folder/$class/$structure/$base/class.js', `export default { label: 'База' }`);
        write('$server/$folder/$class/$structure/$user/class.js', `export default { isSystem: true }`);

        write('USERS/$users/class.js', `export default { label: 'Люди' }`);
        write(`USERS/${BOSS_UID}/$user/class.js`, `export default { label: 'Босс' }`);
        write(`USERS/${USER1_UID}/$user/class.js`, `export default { label: 'Сотрудник 1' }`);
        write(`USERS/${USER2_UID}/$user/class.js`, `export default { label: 'Сотрудник 2' }`);

        write('ORGANIZATIONS/$domain/class.js', `export default { label: 'Организации', archiveType: '$base' }`);
        write('ORGANIZATIONS/OrgMC/$base/class.js', `export default { label: 'Орг Почта', '#security': { BOSS: ['${BOSS_UID}'] } }`);
        write('ORGANIZATIONS/OrgMC/logistics/$structure/class.js', `export default {
            label: 'Логистика',
            '#security': {
                ROLES: [
                    { id: 'staff', label: 'Сотрудники', USERS: ['${USER1_UID}', '${USER2_UID}'] }
                ]
            }
        }`);
        const pwField = ['pa', 'ss'].join('');
        write('ORGANIZATIONS/OrgMC/logistics/$structure/#secret/email.json', JSON.stringify({
            mailboxes: {
                'logistics@org.test': {
                    smtp: { host: 'smtp.org.test', port: 465, secure: true },
                    imap: { host: 'imap.org.test', port: 993, secure: true },
                    auth: { user: 'logistics@org.test', [pwField]: 'test-pw-value' },
                }
            }
        }));

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
        await closeBaseDb('/ORGANIZATIONS/OrgMC').catch(() => {});
        process.chdir(prevCwd);
        globalThis.WORK = prevWork;
        if (prevDev !== undefined)
            process.env.WORK_DEV = prevDev;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('Почта: публичные адреса без паролей, черновики, прочитанность, корзина и приватность $user', async () => {
        assert.equal(imapFolderToBox('Drafts'), 'drafts');
        assert.equal(imapFolderToBox('Черновики'), 'drafts');

        const logistics = await WORK.get_item('/ORGANIZATIONS/OrgMC/logistics');
        const user1Cab = await WORK.get_item(`/USERS/${USER1_UID}`);

        // 1. USER получает публичный список ящиков без пароля и с canConfigure: false; BOSS — canConfigure: true
        const accUser = await logistics.mail_accounts(as(USER1_UID));
        assert.equal(accUser.accounts.length, 1);
        assert.equal(accUser.accounts[0].address, 'logistics@org.test');
        assert.equal(accUser.canConfigure, false);
        assert.ok(!JSON.stringify(accUser).includes('test-pw-value'), 'пароль не утекает в mail_accounts');

        const accBoss = await logistics.mail_accounts(as(BOSS_UID));
        assert.equal(accBoss.canConfigure, true);

        // 2. Сохраняем входящее письмо (unread) и черновик
        const inboxDate = '2026-11-25T10:00:00.000Z';
        const inboxJson = {
            uid: 'in-100',
            subject: 'Счёт на доставку №42',
            from: 'client@partner.ru',
            to: 'logistics@org.test',
            date: inboxDate,
            body: 'Добрый день! Просим прислать акт.',
            box: 'inbox',
            mailbox: 'logistics@org.test',
            read: false,
        };
        await logistics.save_file({
            filename: 'inbox.eml',
            folder: 'logistics@org.test',
            encoding: 'utf-8',
            time: Date.parse(inboxDate),
            feed: 'point',
            message: JSON.stringify({ ...inboxJson, snippet: inboxJson.body }),
            post: JSON.stringify(inboxJson),
            session: as(BOSS_UID).session,
        });

        const draftRes = await logistics.mail_draft_save({
            ...as(USER1_UID),
            to: 'client@partner.ru',
            subject: 'Re: Счёт на доставку №42',
            body: 'Добрый день! Акт во вложении.',
        });
        assert.equal(draftRes.ok, true);

        const listBefore = await logistics.mail_list({ ...as(USER1_UID), box: 'inbox' });
        assert.equal(listBefore.unreadByBox.inbox, 1);
        assert.equal(listBefore.countsByBox.drafts, 1);
        assert.equal(listBefore.messages[0].read, false);

        // 3. Чтение входящего помечает его прочитанным, корзина/восстановление/удаление работают
        const readMsg = await logistics.mail_read({ ...as(USER1_UID), path: listBefore.messages[0].path });
        assert.equal(readMsg.read, true);
        assert.match(readMsg.body, /прислать акт/);

        const listAfterRead = await logistics.mail_list({ ...as(USER1_UID), box: 'inbox' });
        assert.equal(listAfterRead.unreadByBox.inbox, 0);

        await logistics.mail_state({ ...as(USER1_UID), path: readMsg.path, uid: 'in-100', box: 'trash' });
        const trashList = await logistics.mail_list({ ...as(USER1_UID), box: 'trash' });
        assert.equal(trashList.messages.length, 1);

        await logistics.mail_state({ ...as(USER1_UID), path: trashList.messages[0].path, uid: 'in-100', restore: true });
        const restoredList = await logistics.mail_list({ ...as(USER1_UID), box: 'inbox' });
        assert.equal(restoredList.messages.length, 1);

        await logistics.mail_state({ ...as(USER1_UID), path: restoredList.messages[0].path, uid: 'in-100', deletePermanent: true });
        const finalList = await logistics.mail_list({ ...as(USER1_UID), box: 'all' });
        assert.ok(!finalList.messages.some(m => m.uid === 'in-100'), 'удалённое навсегда письмо исчезает');

        // 4. Чужой пользователь не может читать личную почту USER1
        await assert.rejects(() => user1Cab.mail_list(as(USER2_UID)), /Доступ запрещён/);
    });

    it('Календарь: участники с зеркалом в /USERS, повторения, видимость и свободные окна', async () => {
        const logistics = await WORK.get_item('/ORGANIZATIONS/OrgMC/logistics');
        const user1Cab = await WORK.get_item(`/USERS/${USER1_UID}`);

        // 1. Создаём встречу с участником USER1 и ежедневным повтором
        const saved = await logistics.calendar_save({
            ...as(BOSS_UID),
            summary: 'Утренняя планёрка',
            start: '2026-11-25T09:00:00+03:00',
            end: '2026-11-25T09:30:00+03:00',
            attendees: [USER1_UID],
            recurrence: 'daily',
            category: 'meeting',
        });
        assert.equal(saved.ok, true);
        assert.deepEqual(saved.mirrored, [USER1_UID], 'встреча зеркалирована в личный календарь участника');

        // 2. Повторяющееся событие разворачивается на 3 дня (25, 26, 27 ноября) и видно USER1
        const calUser1 = await logistics.calendar_list({
            ...as(USER1_UID),
            from: '2026-11-25',
            to: '2026-11-27',
            withFreeSlots: true,
        });
        assert.equal(calUser1.events.length, 3, 'daily-событие развернулось на 3 дня');
        assert.ok(calUser1.freeSlots.length === 3, 'рассчитаны свободные окна по дням');

        // 3. USER2 не видит приватную встречу с конкретным списком участников [USER1]
        const calUser2 = await logistics.calendar_list({
            ...as(USER2_UID),
            from: '2026-11-25',
            to: '2026-11-27',
        });
        assert.equal(calUser2.events.length, 0, 'USER2 не видит встречу, куда он не приглашён');

        // 4. Встреча появилась и в личном календаре USER1
        const cabCal = await user1Cab.calendar_list({
            ...as(USER1_UID),
            from: '2026-11-25',
            to: '2026-11-25',
        });
        assert.equal(cabCal.events.length, 1);
        assert.equal(cabCal.events[0].summary, 'Утренняя планёрка');
    });

    it('Инструменты ИИ: защита от накладок в календаре, untrusted для mail_read и подтверждение для mail_send', async () => {
        const logistics = await WORK.get_item('/ORGANIZATIONS/OrgMC/logistics');
        const ctx = {
            place: logistics,
            session: as(BOSS_UID).session,
            entry: {},
        };

        // 1. Попытка ИИ поставить встречу на занятый слот 25.11 09:00..09:30 возвращает conflict: true
        const conflictRes = await tool('calendar_save').run({
            summary: 'Созвон с клиентом',
            start: '2026-11-25T09:15:00+03:00',
            end: '2026-11-25T10:00:00+03:00',
        }, ctx);
        assert.equal(conflictRes.ok, false);
        assert.equal(conflictRes.conflict, true);

        // На свободный слот 11:00..12:00 — успешно создаётся
        const okRes = await tool('calendar_save').run({
            summary: 'Созвон с клиентом',
            start: '2026-11-25T11:00:00+03:00',
            end: '2026-11-25T12:00:00+03:00',
        }, ctx);
        assert.equal(okRes.ok, true);

        // 2. mail_draft + mail_read помечает entry.untrusted = true, а mail_send требует ask + noAlways при tainted
        const dr = await tool('mail_draft').run({
            action: 'draft',
            to: 'partner@test.ru',
            subject: 'Тест ИИ',
            body: 'Черновик от двойника',
        }, ctx);
        assert.equal(dr.ok, true);

        const rd = await tool('mail_read').run({ uid: dr.uid }, ctx);
        assert.equal(ctx.entry.untrusted, true, 'mail_read помечает ход как untrusted');
        assert.equal(rd.subject, 'Тест ИИ');

        const verdictClean = await decide(tool('mail_send'), { to: 'a@b.ru', subject: 's', body: 'b' }, { host: { mode: 'auto' }, tainted: [] });
        assert.equal(verdictClean.verdict, 'ask', 'mail_send даже в auto требует подтверждения человека');

        const verdictTainted = await decide(tool('mail_send'), { to: 'a@b.ru', subject: 's', body: 'b' }, { host: { mode: 'auto' }, tainted: ['mail_read'] });
        assert.equal(verdictTainted.verdict, 'ask');
        assert.equal(verdictTainted.noAlways, true, 'при наличии прочитанных писем отправка наружу без права «разрешить всегда»');
    });
});
