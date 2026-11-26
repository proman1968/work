import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLicenseServerApp } from '../license-server/src/index.js';
import { MEMBERS } from '../sources/server/access/gateway.js';
import {
    createSupportTicketFromWork,
    listSupportTicketsForWork,
    replySupportTicketFromWork,
    markSupportTicketRead,
    fetchSupportMediaFromWork,
    relaySupportRemoteFromWork,
} from '../sources/modules/support/index.js';

const PNG_1X1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Служба поддержки WORK → work.odant.org, роль SUPPORT и встроенный Remote Desktop', () => {
    let tmpDir;
    let workDir;
    let hubApp;
    let hubServer;
    let hubUrl;
    let prevHubEnv;

    before(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-sup-test-'));
        workDir = path.join(tmpDir, 'work-node');
        fs.mkdirSync(path.join(workDir, '#system'), { recursive: true });
        fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({ name: 'odant-work', version: '1.0.80' }), 'utf8');

        hubApp = createLicenseServerApp({
            dataDir: path.join(tmpDir, 'hub-data'),
            publicOrigin: 'http://127.0.0.1:0',
            autoRecover: false,
        });
        hubServer = await hubApp.listen(0, '127.0.0.1');
        const addr = hubServer.address();
        hubUrl = `http://127.0.0.1:${addr.port}`;
        prevHubEnv = process.env.WORK_SUPPORT_HUB_URL;
        process.env.WORK_SUPPORT_HUB_URL = hubUrl;
    });

    after(async () => {
        if (prevHubEnv === undefined) delete process.env.WORK_SUPPORT_HUB_URL;
        else process.env.WORK_SUPPORT_HUB_URL = prevHubEnv;
        if (hubServer) {
            await new Promise(resolve => hubServer.close(resolve));
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('gateway.js и folder.js регистрируют методы support_* с уровнем L.USER', () => {
        for (const m of ['support_list', 'support_create', 'support_reply', 'support_mark_read', 'support_media', 'support_remote']) {
            assert.equal(MEMBERS[m], 'user', `${m} доступен вошедшим пользователям (L.USER)`);
        }
        const folderSrc = fs.readFileSync(path.resolve('sources/client/folder.js'), 'utf8');
        assert.ok(folderSrc.includes("method.startsWith('support_')"), 'ответы support_* не оборачиваются в WORK.__bind');
    });

    it('Роль SUPPORT в /admin: ограниченный доступ (только тикеты и закреплённые клиенты) и запрет настроек ADMIN', async () => {
        const adm = hubApp.store.registerOrLoginUser({ email: 'adm@odant.org', name: 'Главный Админ', ofertaAccepted: true });
        const sup1 = hubApp.store.registerOrLoginUser({ email: 'sup1@odant.org', name: 'Инженер Первый', ofertaAccepted: true });
        const sup2 = hubApp.store.registerOrLoginUser({ email: 'sup2@odant.org', name: 'Инженер Второй', ofertaAccepted: true });
        const client1 = hubApp.store.registerOrLoginUser({ email: 'cli1@org.ru', name: 'Клиент Первый', companyName: 'ООО Альфа', ofertaAccepted: true });
        const client2 = hubApp.store.registerOrLoginUser({ email: 'cli2@org.ru', name: 'Клиент Второй', companyName: 'ООО Бета', ofertaAccepted: true });

        assert.equal(adm.role, 'ADMIN');

        // ADMIN назначает роль SUPPORT и закрепляет sup1 за client1, sup2 за client2
        const r1 = await fetch(`${hubUrl}/api/admin/users/role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adm.sessionKey}` },
            body: JSON.stringify({ userId: sup1.userId, role: 'SUPPORT' }),
        }).then(r => r.json());
        assert.equal(r1.user.role, 'SUPPORT');
        assert.equal(r1.user.isSupport, true);
        assert.equal(r1.user.isAdmin, false);

        await fetch(`${hubUrl}/api/admin/users/role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adm.sessionKey}` },
            body: JSON.stringify({ userId: sup2.userId, role: 'SUPPORT' }),
        });

        await fetch(`${hubUrl}/api/admin/clients/assign-support`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adm.sessionKey}` },
            body: JSON.stringify({ userId: client1.userId, supportIds: [sup1.userId] }),
        });
        await fetch(`${hubUrl}/api/admin/clients/assign-support`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adm.sessionKey}` },
            body: JSON.stringify({ userId: client2.userId, supportIds: [sup2.userId] }),
        });

        // SUPPORT входит в /api/admin/me и /api/admin/overview
        const meRes = await fetch(`${hubUrl}/api/admin/me`, {
            headers: { 'Authorization': `Bearer ${sup1.sessionKey}` },
        }).then(r => r.json());
        assert.equal(meRes.authenticated, true);
        assert.equal(meRes.role, 'SUPPORT');

        const ovSup1 = await fetch(`${hubUrl}/api/admin/overview`, {
            headers: { 'Authorization': `Bearer ${sup1.sessionKey}` },
        }).then(r => r.json());
        assert.equal(ovSup1.role, 'SUPPORT');
        assert.equal(ovSup1.settings, null, 'SUPPORT не получает секретные настройки SMTP/ЮKassa/ботов');
        assert.equal(ovSup1.orders.length, 0);
        assert.equal(ovSup1.users.length, 1);
        assert.equal(ovSup1.users[0].email, 'cli1@org.ru', 'SUPPORT видит только закреплённого за собой клиента');

        // SUPPORT не может менять роли или настройки SMTP
        const forbidRole = await fetch(`${hubUrl}/api/admin/users/role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sup1.sessionKey}` },
            body: JSON.stringify({ userId: sup1.userId, role: 'ADMIN' }),
        });
        assert.equal(forbidRole.status, 401);

        const forbidBackup = await fetch(`${hubUrl}/api/admin/backup/export`, {
            headers: { 'Authorization': `Bearer ${sup1.sessionKey}` },
        });
        assert.equal(forbidBackup.status, 401);
    });

    it('Полный цикл WORK → work.odant.org: скриншот, изоляция USER/BOSS, контроль SUPPORT, ответ и Remote Desktop', async () => {
        const adm = hubApp.store._findUser('adm@odant.org');
        const sup1 = hubApp.store._findUser('sup1@odant.org');
        const sup2 = hubApp.store._findUser('sup2@odant.org');

        const fakeStorage = {
            dir: workDir,
            label: 'WORK-Demo',
            DATA: { label: 'WORK-Demo' },
            constructor: {
                resolveUid(p) { return p?.session?.uid || null; },
            },
            async roles(p) {
                return p?.session?.uid === 'BOSS_1' ? ['BOSS'] : ['USER'];
            },
        };

        // 1. Пользователь U1 отправляет обращение со скриншотом (без обязательной лицензии — пробное)
        const created1 = await createSupportTicketFromWork(fakeStorage, {
            session: { uid: 'U1' },
            post: {
                text: 'Не открывается отчёт по остаткам',
                userName: 'Иван Петров',
                includeTech: true,
                techContext: { url: 'http://localhost:8001/#/', focusedPath: '/ORGANIZATIONS/O1' },
                attachments: [{
                    name: 'screen.png',
                    mime: 'image/png',
                    dataBase64: `data:image/png;base64,${PNG_1X1_B64}`,
                }],
            },
        });
        assert.equal(created1.ok, true);
        assert.ok(created1.ticket.ticketId.startsWith('TCK-'));
        assert.equal(created1.ticket.attachments.length, 1);

        // 2. Пользователь U2 создаёт своё обращение
        const created2 = await createSupportTicketFromWork(fakeStorage, {
            session: { uid: 'U2' },
            post: { text: 'Вопрос по правам доступа', userName: 'Мария Сидорова' },
        });
        assert.equal(created2.ok, true);

        // 3. Изоляция в WORK: U1 видит только своё, BOSS видит оба
        const listU1 = await listSupportTicketsForWork(fakeStorage, { session: { uid: 'U1' } });
        assert.equal(listU1.tickets.length, 1);
        assert.equal(listU1.tickets[0].ticketId, created1.ticket.ticketId);

        const listBoss = await listSupportTicketsForWork(fakeStorage, { session: { uid: 'BOSS_1' } });
        assert.equal(listBoss.tickets.length, 2);

        // 4. Загрузка медиафайла через WORK-прокси (U2 отказ, U1 успех)
        await assert.rejects(
            () => fetchSupportMediaFromWork(fakeStorage, {
                session: { uid: 'U2' },
                ticketId: created1.ticket.ticketId,
                file: created1.ticket.attachments[0].id,
            }),
            /Нет доступа/
        );
        const mediaU1 = await fetchSupportMediaFromWork(fakeStorage, {
            session: { uid: 'U1' },
            ticketId: created1.ticket.ticketId,
            file: created1.ticket.attachments[0].id,
        });
        assert.ok(mediaU1.dataUrl.startsWith('data:image/png;base64,'));

        // 5. Инженер sup1 видит непривязанное обращение в общей очереди, берёт на контроль и отвечает
        const ovSup1 = await fetch(`${hubUrl}/api/admin/overview`, {
            headers: { 'Authorization': `Bearer ${sup1.sessionKey}` },
        }).then(r => r.json());
        assert.ok(ovSup1.tickets.some(t => t.ticketId === created1.ticket.ticketId));

        const taken = await fetch(`${hubUrl}/api/admin/tickets/${encodeURIComponent(created1.ticket.ticketId)}/take`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sup1.sessionKey}` },
            body: JSON.stringify({}),
        }).then(r => r.json());
        assert.equal(taken.status, 'in_progress');
        assert.equal(taken.assignedSupportId, sup1.userId);

        // После взятия в работу sup1 второй инженер sup2 уже НЕ имеет доступа к чужому тикету
        const takeBySup2 = await fetch(`${hubUrl}/api/admin/tickets/${encodeURIComponent(created1.ticket.ticketId)}/take`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sup2.sessionKey}` },
            body: JSON.stringify({}),
        });
        assert.equal(takeBySup2.status, 403);

        // sup1 отвечает по тикету
        const replied = await fetch(`${hubUrl}/api/admin/tickets/${encodeURIComponent(created1.ticket.ticketId)}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sup1.sessionKey}` },
            body: JSON.stringify({ text: 'Принял в работу, проверьте права, можем подключиться к экрану.' }),
        }).then(r => r.json());
        assert.equal(replied.status, 'answered');

        // 6. Оператор sup1 запрашивает Remote Desktop -> U1 видит запрос и непрочитанный ответ
        await fetch(`${hubUrl}/api/support/remote/${encodeURIComponent(created1.ticket.ticketId)}/operator`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sup1.sessionKey}` },
            body: JSON.stringify({ action: 'request' }),
        });

        const syncedU1 = await listSupportTicketsForWork(fakeStorage, { session: { uid: 'U1' } });
        assert.equal(syncedU1.unreadTotal, 1);
        assert.equal(syncedU1.remoteRequests, 1);
        assert.equal(syncedU1.tickets[0].remote.state, 'requested');

        // Сброс непрочитанности
        await markSupportTicketRead(fakeStorage, { session: { uid: 'U1' }, post: { ticketId: created1.ticket.ticketId } });
        const afterRead = await listSupportTicketsForWork(fakeStorage, { session: { uid: 'U1' } });
        assert.equal(afterRead.unreadTotal, 0);

        // 7. Проверка защиты режимов Remote Desktop: в view разрешён только pointer, в control — click/input
        await relaySupportRemoteFromWork(fakeStorage, {
            session: { uid: 'U1' },
            post: { ticketId: created1.ticket.ticketId, action: 'start', mode: 'view' },
        });
        await fetch(`${hubUrl}/api/support/remote/${encodeURIComponent(created1.ticket.ticketId)}/operator`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sup1.sessionKey}` },
            body: JSON.stringify({
                action: 'control',
                events: [
                    { type: 'pointer', x: 0.2, y: 0.3 },
                    { type: 'click', x: 0.2, y: 0.3 },
                    { type: 'input', text: 'hack' },
                ],
            }),
        });
        const pollView = await relaySupportRemoteFromWork(fakeStorage, {
            session: { uid: 'U1' },
            post: { ticketId: created1.ticket.ticketId, action: 'poll' },
        });
        assert.equal(pollView.remote.controlEvents.length, 1, 'в режиме Только просмотр click и input отсечены');
        assert.equal(pollView.remote.controlEvents[0].type, 'pointer');

        // Клиент переключается на управление -> click разрешён
        await relaySupportRemoteFromWork(fakeStorage, {
            session: { uid: 'U1' },
            post: { ticketId: created1.ticket.ticketId, action: 'mode', mode: 'control' },
        });
        await fetch(`${hubUrl}/api/support/remote/${encodeURIComponent(created1.ticket.ticketId)}/operator`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sup1.sessionKey}` },
            body: JSON.stringify({
                action: 'control',
                events: [{ type: 'click', x: 0.5, y: 0.5 }],
            }),
        });
        const pollCtrl = await relaySupportRemoteFromWork(fakeStorage, {
            session: { uid: 'U1' },
            post: { ticketId: created1.ticket.ticketId, action: 'poll' },
        });
        assert.equal(pollCtrl.remote.controlEvents.length, 1);
        assert.equal(pollCtrl.remote.controlEvents[0].type, 'click');

        // Ответ клиента в существующий тикет
        const clientReply = await replySupportTicketFromWork(fakeStorage, {
            session: { uid: 'U1' },
            post: { ticketId: created1.ticket.ticketId, text: 'Спасибо, проблема решена!' },
        });
        assert.equal(clientReply.ok, true);
        assert.equal(clientReply.ticket.messages.length, 3);

        // ADMIN видит все тикеты
        const ovAdm = await fetch(`${hubUrl}/api/admin/overview`, {
            headers: { 'Authorization': `Bearer ${adm.sessionKey}` },
        }).then(r => r.json());
        assert.ok(ovAdm.tickets.length >= 2);
    });

    it('Адаптивность портала work.odant.org и PWA-манифеста WORK: модалки с 100dvh, скролл таблиц и safe-area', async () => {
        const css = await fetch(`${hubUrl}/assets/landing.css`).then(r => r.text());
        assert.ok(css.includes('100dvh'), 'landing.css использует 100dvh для модалок и виджета');
        assert.ok(css.includes('safe-area-inset-bottom'), 'landing.css учитывает safe-area-inset');
        assert.ok(css.includes('.inv-grid') && css.includes('.req-subgrid'), 'адаптивные сетки кабинета вынесены в CSS-классы');
        assert.ok(!css.includes('.top-actions .btn-primary { display: none; }'), 'главная кнопка действия не скрывается на мобильных');

        const manifest = JSON.parse(fs.readFileSync(path.resolve('sources/manifest.json'), 'utf8'));
        assert.equal(manifest.theme_color, '#4b0082');
        assert.equal(manifest.lang, 'ru');
        assert.ok(manifest.icons.some(i => String(i.purpose || '').includes('maskable')), 'манифест содержит maskable-иконки');
    });
});
