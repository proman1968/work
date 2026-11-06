/**
 * Тесты каналов уведомлений в мессенджеры Telegram и MAX (`sources/modules/notify/`):
 *  - адаптеры Telegram Bot API и MAX Bot API (getMe, sendMessage, getUpdates);
 *  - привязка ботов к точкам $structure / $base / $server с шифрованием secret-box и наследованием вверх;
 *  - одноразовые коды привязки личных чатов пользователей и групповых чатов подразделений (/start <CODE>);
 *  - формальное членство пользователей в подразделении через #security (BOSS, ADMIN, USER, ROLES);
 *  - персональная (notifyPersonal) и общая по подразделению (notifyDepartment) доставка + расписания (every: 15).
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    telegramAdapter,
    maxAdapter,
    savePointConfig,
    readPointConfig,
    resolveBotForPoint,
    resolveBotForUser,
    getPointMemberUids,
    findUserPoints,
    createLinkCode,
    pollBotUpdates,
    readUserBindings,
    unbindUserChat,
    notifyPersonal,
    notifyDepartment,
    notifyScheduledRun,
    getPointMessengerStatus,
    _resetNotifyStateForTests,
} from '../sources/modules/notify/index.js';
import * as S from '../sources/modules/agent/scheduler.js';
import { scheduleTools } from '../sources/modules/agent/tools/schedule.js';
import { closeIndexDb } from '../sources/host/index-db.js';

const ROOT_CWD = process.cwd();
let tmpDir = '';

function writeJsonOrJs(rel, content) {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

describe('Каналы уведомлений Telegram / MAX и привязка к $structure', () => {
    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-notify-test-'));
        process.chdir(tmpDir);

        // Структура организации и подразделений с #security (BOSS, ADMIN, USER, ROLES)
        writeJsonOrJs('$server/class.js', 'export default { isSystem: true };\n');
        writeJsonOrJs('ORGANIZATIONS/Маслоторг/$base/class.js', `export default {
    label: "Маслоторг",
    "#security": {
        "ADMIN": ["U_ADMIN"],
        "BOSS": ["U_ORG_BOSS"]
    }
};\n`);
        writeJsonOrJs('ORGANIZATIONS/Маслоторг/sales/$structure/class.js', `export default {
    label: "Отдел продаж",
    "#security": {
        "BOSS": ["U_SALES_BOSS"],
        "USER": ["U_MANAGER1"],
        "ROLES": [
            {
                "id": "cashier",
                "label": "Кассир",
                "USERS": ["U_CASHIER"],
                "LINKS": []
            }
        ]
    }
};\n`);
        writeJsonOrJs('ORGANIZATIONS/Маслоторг/sales/south/$structure/class.js', `export default {
    label: "Южный филиал",
    "#security": {
        "USER": ["U_SOUTH"]
    }
};\n`);
        for (const uid of ['U_ADMIN', 'U_ORG_BOSS', 'U_SALES_BOSS', 'U_MANAGER1', 'U_CASHIER', 'U_SOUTH']) {
            writeJsonOrJs(`USERS/${uid}/$user/class.js`, `export default { label: "${uid}" };\n`);
        }
    });

    after(async () => {
        _resetNotifyStateForTests();
        await closeIndexDb();
        process.chdir(ROOT_CWD);
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { /* ignore */ }
    });

    it('адаптеры Telegram и MAX: extractCommandCode, getMe, sendMessage, getUpdates', async () => {
        assert.equal(telegramAdapter.extractCommandCode('/start ab12cd34'), 'AB12CD34');
        assert.equal(telegramAdapter.extractCommandCode('/start@maslotorg_bot k9m8p7x6'), 'K9M8P7X6');
        assert.equal(telegramAdapter.extractCommandCode('ZX98CV76'), 'ZX98CV76');
        assert.equal(telegramAdapter.extractCommandCode('обычный текст с пробелами'), '');

        const calls = [];
        const prevFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts = {}) => {
            calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
            if (String(url).includes('/getMe')) {
                return {
                    ok: true,
                    json: async () => ({ ok: true, result: { id: 777, is_bot: true, first_name: 'Маслоторг Бот', username: 'maslotorg_bot' } }),
                };
            }
            if (String(url).includes('/sendMessage')) {
                return {
                    ok: true,
                    json: async () => ({ ok: true, result: { message_id: 42 } }),
                };
            }
            if (String(url).includes('/me?')) {
                return {
                    ok: true,
                    json: async () => ({ user_id: 888, name: 'MAX Маслоторг', username: 'max_maslotorg_bot', is_bot: true }),
                };
            }
            if (String(url).includes('/messages?')) {
                return {
                    ok: true,
                    json: async () => ({ message: { body: { mid: 'mid_99' } } }),
                };
            }
            return { ok: true, json: async () => ({ ok: true, result: [] }) };
        };

        try {
            const tgMe = await telegramAdapter.getMe('123456:TG_TOKEN');
            assert.equal(tgMe.username, 'maslotorg_bot');
            const tgSend = await telegramAdapter.sendMessage('123456:TG_TOKEN', { chatId: '100500', text: 'Привет из WORK' });
            assert.equal(tgSend.ok, true);
            assert.equal(tgSend.messageId, 42);

            const maxMe = await maxAdapter.getMe('MAX_SECRET_TOKEN');
            assert.equal(maxMe.username, 'max_maslotorg_bot');
            const maxSend = await maxAdapter.sendMessage('MAX_SECRET_TOKEN', { chatId: '200600', text: 'Привет в MAX' });
            assert.equal(maxSend.ok, true);
            assert.equal(maxSend.messageId, 'mid_99');
        }
        finally {
            globalThis.fetch = prevFetch;
        }
    });

    it('привязка ботов к точкам $structure / $base / $server и наследование от вышестоящей точки', async () => {
        // 1. На корневом сервере задаём резервный бот
        await savePointConfig('/', {
            bot: {
                id: 'bot_server',
                kind: 'telegram',
                label: 'Серверный бот WORK',
                token: '111111:SERVER_SECRET_TOKEN',
                username: 'work_server_bot',
                enabled: true,
            },
        });

        // Секрет на диске зашифрован (secret-box v2) и сохраняет токен при повторном сохранении с маской
        const rawDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, '$server/#secret/messengers.json'), 'utf-8'));
        assert.equal(rawDisk.v, 2, 'конфиг бота должен шифроваться через secret-box');

        // 2. Пока у организации и подразделений нет своих ботов — они наследуют серверного бота
        const salesInheritedFromServer = await resolveBotForPoint('/ORGANIZATIONS/Маслоторг/sales');
        assert.equal(salesInheritedFromServer.bot.id, 'bot_server');
        assert.equal(salesInheritedFromServer.inherited, true);
        assert.equal(salesInheritedFromServer.sourcePath, '/');

        // 3. Привязываем бот к организации $base «Маслоторг»
        await savePointConfig('/ORGANIZATIONS/Маслоторг', {
            bot: {
                id: 'bot_maslotorg',
                kind: 'telegram',
                label: 'Бот Маслоторг',
                token: '222222:MASLOTORG_TOKEN_XYZ',
                username: 'maslotorg_bot',
                enabled: true,
            },
        });

        // Подразделение sales и его дочерний филиал south автоматически наследуют бот Маслоторга
        const salesRes = await resolveBotForPoint('/ORGANIZATIONS/Маслоторг/sales');
        assert.equal(salesRes.bot.id, 'bot_maslotorg');
        assert.equal(salesRes.inherited, true);
        assert.equal(salesRes.sourcePath, '/ORGANIZATIONS/Маслоторг');

        const southRes1 = await resolveBotForPoint('/ORGANIZATIONS/Маслоторг/sales/south');
        assert.equal(southRes1.bot.id, 'bot_maslotorg');
        assert.equal(southRes1.inherited, true);
        assert.equal(southRes1.sourcePath, '/ORGANIZATIONS/Маслоторг');

        // 4. Привязываем к дочернему подразделению south собственный бот MAX
        await savePointConfig('/ORGANIZATIONS/Маслоторг/sales/south', {
            bot: {
                id: 'bot_south_max',
                kind: 'max',
                label: 'MAX Южный филиал',
                token: '333333:SOUTH_MAX_TOKEN',
                username: 'south_max_bot',
                enabled: true,
            },
        });

        // Обновление метаданных с маскированным токеном не затирает реальный токен
        await savePointConfig('/ORGANIZATIONS/Маслоторг/sales/south', {
            bot: {
                id: 'bot_south_max',
                kind: 'max',
                label: 'MAX Юг (обновлён)',
                token: '333333***OKEN',
                username: 'south_max_bot',
                enabled: true,
            },
        });
        const southCfg = await readPointConfig('/ORGANIZATIONS/Маслоторг/sales/south');
        assert.equal(southCfg.bot.token, '333333:SOUTH_MAX_TOKEN');
        assert.equal(southCfg.bot.label, 'MAX Юг (обновлён)');

        const southRes2 = await resolveBotForPoint('/ORGANIZATIONS/Маслоторг/sales/south');
        assert.equal(southRes2.bot.id, 'bot_south_max');
        assert.equal(southRes2.inherited, false);
        assert.equal(southRes2.sourcePath, '/ORGANIZATIONS/Маслоторг/sales/south');

        // 5. Сбрасываем собственный бот у south -> снова наследует от Маслоторга
        await savePointConfig('/ORGANIZATIONS/Маслоторг/sales/south', { bot: null });
        const southRes3 = await resolveBotForPoint('/ORGANIZATIONS/Маслоторг/sales/south');
        assert.equal(southRes3.bot.id, 'bot_maslotorg');
        assert.equal(southRes3.inherited, true);
    });

    it('формальная привязка пользователей к подразделению через #security (BOSS, USER, ROLES)', async () => {
        const salesMembers = await getPointMemberUids('/ORGANIZATIONS/Маслоторг/sales');
        assert.deepEqual(
            salesMembers.sort(),
            ['U_CASHIER', 'U_MANAGER1', 'U_SALES_BOSS'].sort(),
            'участники точки включают BOSS, USER и сотрудников рабочих мест ROLES',
        );

        const cashierPoints = await findUserPoints('U_CASHIER');
        assert.ok(cashierPoints.some(p => p.path === '/ORGANIZATIONS/Маслоторг/sales'));

        // Даже если задача кассира создана в личном кабинете /USERS/U_CASHIER, резолвер находит бот его подразделения
        const botForCashier = await resolveBotForUser('U_CASHIER', '/USERS/U_CASHIER');
        assert.equal(botForCashier.bot.id, 'bot_maslotorg');
    });

    it('привязка личных чатов и группового чата подразделения по одноразовым кодам (/start <CODE>) и доставка', async () => {
        const sentMessages = [];
        let fakeUpdates = [];
        const prevFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts = {}) => {
            const u = String(url);
            if (u.includes('/getUpdates')) {
                const batch = fakeUpdates;
                fakeUpdates = [];
                return { ok: true, json: async () => ({ ok: true, result: batch }) };
            }
            if (u.includes('/sendMessage')) {
                const body = JSON.parse(opts.body);
                sentMessages.push({ url: u, chatId: body.chat_id, text: body.text });
                return { ok: true, json: async () => ({ ok: true, result: { message_id: sentMessages.length } }) };
            }
            return { ok: true, json: async () => ({ ok: true, result: [] }) };
        };

        try {
            // 1. Генерируем одноразовые коды для руководителя (U_SALES_BOSS) и кассира (U_CASHIER)
            const bossCode = await createLinkCode({
                uid: 'U_SALES_BOSS',
                point: '/ORGANIZATIONS/Маслоторг/sales',
                target: 'user',
            });
            const cashierCode = await createLinkCode({
                uid: 'U_CASHIER',
                point: '/ORGANIZATIONS/Маслоторг/sales',
                target: 'user',
            });
            assert.match(bossCode.command, /^\/start [A-Z0-9]{8}$/);
            assert.match(bossCode.deepLink, /^https:\/\/t\.me\/maslotorg_bot\?start=/);

            // 2. Пользователи пишут боту /start <CODE> в личные сообщения
            fakeUpdates = [
                {
                    update_id: 101,
                    message: {
                        message_id: 1,
                        from: { id: 5001, username: 'sales_boss_tg', first_name: 'Игорь' },
                        chat: { id: 5001, type: 'private', username: 'sales_boss_tg', first_name: 'Игорь' },
                        text: bossCode.command,
                    },
                },
                {
                    update_id: 102,
                    message: {
                        message_id: 2,
                        from: { id: 5002, username: 'cashier_tg', first_name: 'Анна' },
                        chat: { id: 5002, type: 'private', username: 'cashier_tg', first_name: 'Анна' },
                        text: cashierCode.command,
                    },
                },
            ];

            const resolved = await resolveBotForPoint('/ORGANIZATIONS/Маслоторг/sales');
            const matched = await pollBotUpdates(resolved.bot);
            assert.equal(matched.length, 2);

            const bossBind = await readUserBindings('U_SALES_BOSS');
            assert.equal(bossBind.chats.telegram.chatId, '5001');
            assert.equal(bossBind.chats.telegram.username, 'sales_boss_tg');

            // 3. Персональное уведомление кассиру
            sentMessages.length = 0;
            const personalRes = await notifyPersonal('U_CASHIER', {
                title: '⏰ Напоминание',
                body: 'Проверить кассовую смену',
            }, { point: '/ORGANIZATIONS/Маслоторг/sales' });
            assert.equal(personalRes.delivered, true);
            assert.equal(sentMessages.length, 1);
            assert.equal(sentMessages[0].chatId, '5002');
            assert.match(sentMessages[0].text, /Проверить кассовую смену/);

            // 4. Общее уведомление подразделения (пока нет общего чата группы — уходит веером привязанным участникам отдела!)
            sentMessages.length = 0;
            const deptRes1 = await notifyDepartment('/ORGANIZATIONS/Маслоторг/sales', {
                title: 'Планёрка отдела',
                body: 'Сводный отчёт по продажам готов',
            });
            assert.equal(deptRes1.delivered, true);
            assert.equal(deptRes1.groupDelivered, false);
            assert.equal(deptRes1.membersDelivered.length, 2, 'два привязанных участника (BOSS и кассир) получили в Telegram');
            assert.deepEqual(deptRes1.fallbackUids, ['U_MANAGER1'], 'непривязанный менеджер попадает в список web-push fallback');

            // 5. Привязываем групповой чат подразделения по коду группы
            const groupCode = await createLinkCode({
                uid: 'U_ADMIN',
                point: '/ORGANIZATIONS/Маслоторг/sales',
                target: 'group',
            });
            fakeUpdates = [
                {
                    update_id: 103,
                    message: {
                        message_id: 3,
                        from: { id: 5001, username: 'sales_boss_tg' },
                        chat: { id: -100998877, type: 'supergroup', title: 'Чат отдела продаж' },
                        text: groupCode.command,
                    },
                },
            ];
            const groupMatched = await pollBotUpdates(resolved.bot);
            assert.equal(groupMatched.length, 1);
            assert.equal(groupMatched[0].type, 'group');

            // Теперь общее сообщение подразделения уходит в привязанный групповой чат!
            sentMessages.length = 0;
            const deptRes2 = await notifyDepartment('/ORGANIZATIONS/Маслоторг/sales', {
                title: 'Еженедельный отчёт',
                body: 'Выручка за неделю: 3.4 млн ₽',
            });
            assert.equal(deptRes2.delivered, true);
            assert.equal(deptRes2.groupDelivered, true);
            assert.equal(sentMessages[0].chatId, '-100998877');
            assert.match(sentMessages[0].text, /Отдел продаж/);

            // 6. Инструмент schedule и доставка напоминания каждые 15 минут
            const schedTool = scheduleTools.find(t => t.name === 'schedule');
            const ctx = {
                session: { uid: 'U_CASHIER' },
                place: '/ORGANIZATIONS/Маслоторг/sales',
                task: { path: '/ORGANIZATIONS/Маслоторг/sales/$structure/task/2026-11-06/1.U_CASHIER.task' },
                tz: 'Europe/Moscow',
            };
            const createdMsg = await schedTool.run({
                action: 'create',
                every: 15,
                prompt: 'Напоминание каждые 15 минут',
                label: 'Перекур 15 мин',
            }, ctx);
            assert.match(createdMsg, /каждые 15 мин/);

            const statusText = await schedTool.run({ action: 'status' }, ctx);
            assert.match(statusText, /БотМаслоторг|Бот Маслоторг/);
            assert.match(statusText, /@cashier_tg/);

            const [schedRow] = await S.listSchedules({ uid: 'U_CASHIER' });
            sentMessages.length = 0;
            const schedNotify = await notifyScheduledRun({
                schedule: schedRow,
                file: { path: schedRow.task },
                answer: 'Пора размяться и проверить почту!',
            });
            assert.equal(schedNotify.delivered, true);
            assert.equal(sentMessages.length, 1);
            assert.equal(sentMessages[0].chatId, '5002');
            assert.match(sentMessages[0].text, /Перекур 15 мин/);
            assert.match(sentMessages[0].text, /Пора размяться/);

            // 7. Статус для UI и отвязка
            const uiStatus = await getPointMessengerStatus('/ORGANIZATIONS/Маслоторг/sales', { uid: 'U_CASHIER' });
            assert.equal(uiStatus.effectiveBot.id, 'bot_maslotorg');
            assert.equal(uiStatus.groupChatId, '-100998877');
            assert.equal(uiStatus.members.length, 3);

            await unbindUserChat('U_CASHIER', { channel: 'telegram' });
            const afterUnbind = await readUserBindings('U_CASHIER');
            assert.equal(afterUnbind.chats.telegram, undefined);
        }
        finally {
            globalThis.fetch = prevFetch;
        }
    });
});
