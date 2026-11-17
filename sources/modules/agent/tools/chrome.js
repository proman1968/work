/**
 * Инструменты управления настоящим Chrome пользователя через расширение WORK Chrome Bridge:
 *   chrome_status   — статус подключения расширения, режим «только просмотр» (readOnly), домены задачи и журнал;
 *   chrome_mode     — переключить режим «только просмотр» (readOnly) с подтверждением человека;
 *   chrome_open     — открыть http/https-адрес в собственной сгруппированной вкладке агента (с одобрением домена);
 *   chrome_snapshot — текстовый снимок страницы с пронумерованными элементами [ref] (работает и в readOnly);
 *   chrome_click    — клик по [ref] (с подтверждением человека + проверка домена после перехода);
 *   chrome_type     — ввод текста в поле [ref] (без паролей! Для паролей — chrome_handoff);
 *   chrome_nav      — назад / вперёд / обновить (с подтверждением + проверка домена);
 *   chrome_handoff  — передать управление человеку (вход, 2FA, капча, пароль) со скриншотом и вопросом.
 *
 * Безопасность:
 *   - Видимы ТОЛЬКО когда расширение Chrome подключено для текущего пользователя (uid);
 *   - Режим «только просмотр» (`readOnly: true`) включён по умолчанию при каждом подключении;
 *   - Все изменяющие действия требуют отдельного подтверждения (`noAlways: true`);
 *   - Разрешённые домены привязаны только к текущей задаче (в памяти); редирект на чужой домен останавливается;
 *   - Пароли в `chrome_type` не передаются — используйте `chrome_handoff`;
 *   - Произвольный JS (`eval`) запрещён жёстко;
 *   - Все результаты страниц помечены `untrusted: true` (изоляция чужого содержимого, taint.js).
 */
import { randomBytes } from 'node:crypto';
import {
    getChromeForUser, setChromeReadOnly, getChromeAllowedDomains,
    isChromeDomainAllowed, hostnameOf,
    chromeOpen, chromeSnapshot, chromeClick, chromeType, chromeNav, chromeScreenshot,
} from '../../bridge/chrome.js';
import { assertPageUrl } from './browse.js';
import { askEach, askScoped } from '../system.js';

function chromePageScope(ctx) {
    const uid = ctx?.session?.uid;
    const conn = uid ? getChromeForUser(uid) : null;
    let host = '';
    try {
        if (conn?.lastUrl)
            host = hostnameOf(conn.lastUrl);
    }
    catch { /* ignore */ }
    return {
        key: host ? 'chrome:page:' + host : 'chrome:page',
        label: host
            ? 'клики, ввод и навигация на сайте «' + host + '» в этой задаче'
            : 'клики, ввод и навигация в открытой вкладке Chrome в этой задаче',
        buttonLabel: 'Разрешить подобные',
    };
}

const hostScopes = new WeakMap();

function scopeKeyOf(ctx) {
    if (ctx?.host && typeof ctx.host === 'object') {
        let id = hostScopes.get(ctx.host);
        if (!id) {
            id = 'task-' + randomBytes(6).toString('hex');
            hostScopes.set(ctx.host, id);
        }
        return id;
    }
    return String(ctx?.session?.id || 'default');
}

function uidOf(ctx) {
    const uid = ctx?.session?.uid;
    if (!uid)
        throw new Error('Управление Chrome пользователя доступно после входа в систему.');
    return String(uid);
}

/** Видимы в списке инструментов, только когда расширение Chrome подключено к WORK для этого uid. */
export function chromeBridgeAvailable(session) {
    const uid = session?.uid;
    return Boolean(uid && getChromeForUser(uid));
}

function fmtSnap(snap) {
    if (!snap || typeof snap !== 'object')
        return String(snap ?? '');
    return snap.text || ('Страница: ' + (snap.title || '(без названия)') + ' — ' + (snap.url || ''));
}

export const chromeTools = [
    {
        name: 'chrome_status',
        readonly: true,
        description: 'Состояние расширения WORK Chrome Bridge в вашем браузере: подключено ли, включён ли режим «только просмотр» (readOnly), открытая вкладка агента, разрешённые в этой задаче домены и журнал последних действий.',
        parameters: { type: 'object', properties: {} },
        async run(_args, ctx) {
            const uid = uidOf(ctx);
            const conn = getChromeForUser(uid);
            if (!conn)
                return 'Расширение WORK Chrome Bridge не подключено.';
            const domains = getChromeAllowedDomains(uid, scopeKeyOf(ctx));
            const recent = conn.history.slice(-10).map(h =>
                '  ' + h.time.slice(11, 19) + ' ' + h.action
                + (h.domain ? ' (' + h.domain + ')' : '')
                + (h.ref != null ? ' [' + h.ref + ']' : '')
                + ' → ' + h.outcome
            ).join('\n');
            return 'Браузер: ' + conn.browserName + ' (расширение v' + conn.extensionVersion + ')\n'
                + 'Режим: ' + (conn.readOnly ? 'ТОЛЬКО ПРОСМОТР (readOnly — изменения запрещены)' : 'действия с подтверждением каждого шага') + '\n'
                + 'Вкладка агента: ' + (conn.tabId != null ? (conn.lastTitle || '(открыта)') + ' — ' + (conn.lastUrl || 'about:blank') : 'не открыта') + '\n'
                + 'Разрешённые домены задачи: ' + (domains.join(', ') || 'нет') + '\n'
                + 'Журнал Chrome-моста:\n' + (recent || '  (пусто)');
        },
    },
    {
        name: 'chrome_mode',
        risk: 'write',
        description: 'Включить или выключить режим «только просмотр» (readOnly) для вашего Chrome. В режиме readOnly=true агент может только снимать снимки (chrome_snapshot) и передавать экран человеку (chrome_handoff); любые открытия страниц, клики и ввод заблокированы.',
        parameters: {
            type: 'object',
            properties: {
                readOnly: { type: 'boolean', description: 'true — только просмотр; false — разрешить действия с подтверждением' },
            },
            required: ['readOnly'],
        },
        permission: askEach(args => args?.readOnly
            ? 'включить режим «только просмотр» для вашего Chrome'
            : 'разрешить агенту действия в вашем Chrome (каждый клик и ввод всё равно потребует подтверждения)'),
        async run(args, ctx) {
            const r = setChromeReadOnly(uidOf(ctx), Boolean(args?.readOnly));
            return 'Режим Chrome пользователя: ' + (r.readOnly ? 'только просмотр (readOnly)' : 'действия с подтверждением') + '.';
        },
    },
    {
        name: 'chrome_open',
        risk: 'write',
        outbound: true,
        untrusted: true,
        description: 'Открыть адрес http/https в собственной сгруппированной вкладке агента в вашем Chrome (чужие вкладки не трогаются). Возвращает текстовый снимок с [ref]. При первом обращении к домену спрашивает разрешение для этой задачи.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Адрес http:// или https://' },
            },
            required: ['url'],
        },
        permission(args, ctx) {
            let host = '';
            try {
                host = hostnameOf(assertPageUrl(args?.url));
            }
            catch (e) {
                return { verdict: 'deny', reason: e.message };
            }
            const uid = ctx?.session?.uid;
            if (uid && isChromeDomainAllowed(uid, scopeKeyOf(ctx), host))
                return { verdict: 'allow' };
            return {
                verdict: 'ask',
                noAlways: true,
                reason: 'открыть сайт ' + host + ' в вашем Chrome и добавить домен в список разрешённых для этой задачи',
            };
        },
        async run(args, ctx) {
            const snap = await chromeOpen(uidOf(ctx), scopeKeyOf(ctx), args?.url);
            return fmtSnap(snap);
        },
    },
    {
        name: 'chrome_snapshot',
        readonly: true,
        untrusted: true,
        description: 'Текстовый снимок текущей вкладки агента в Chrome: заголовок, URL и интерактивные элементы с номерами [ref]. Работает и в режиме readOnly.',
        parameters: { type: 'object', properties: {} },
        async run(_args, ctx) {
            const snap = await chromeSnapshot(uidOf(ctx));
            return fmtSnap(snap);
        },
    },
    {
        name: 'chrome_click',
        risk: 'danger',
        outbound: true,
        untrusted: true,
        description: 'Клик по элементу [ref] из последнего chrome_snapshot. Требует подтверждения человека и отключённого readOnly. Если клик увёл вкладку на новый домен, агент остановится и попросит подтвердить его.',
        parameters: {
            type: 'object',
            properties: {
                ref: { type: 'integer', description: 'Номер элемента [ref] из chrome_snapshot' },
                reason: { type: 'string', description: 'Что и зачем нажимаем (увидит человек при подтверждении)' },
            },
            required: ['ref'],
        },
        permission: askScoped(args => (args?.reason ? args.reason + ' — ' : '') + 'клик по элементу [' + args?.ref + '] в вашем Chrome'),
        approvalScope: (_args, ctx) => chromePageScope(ctx),
        async run(args, ctx) {
            const r = await chromeClick(uidOf(ctx), scopeKeyOf(ctx), args?.ref);
            return r.label + ' — проверьте результат новым chrome_snapshot.';
        },
    },
    {
        name: 'chrome_type',
        risk: 'danger',
        outbound: true,
        untrusted: true,
        description: 'Ввести текст в поле [ref] в вашем Chrome. Пароли, коды и секреты сюда передавать ЗАПРЕЩЕНО — для входа и паролей используйте chrome_handoff.',
        parameters: {
            type: 'object',
            properties: {
                ref: { type: 'integer', description: 'Номер поля [ref] из chrome_snapshot' },
                text: { type: 'string', description: 'Обычный текст (НЕ пароль и НЕ токен)' },
                submit: { type: 'boolean', description: 'Нажать Enter после ввода' },
                reason: { type: 'string', description: 'Что и зачем вводим (увидит человек при подтверждении)' },
            },
            required: ['ref', 'text'],
        },
        permission: askScoped(args => (args?.reason ? args.reason + ' — ' : '') + 'ввод текста в поле [' + args?.ref + '] в вашем Chrome'),
        approvalScope: (_args, ctx) => chromePageScope(ctx),
        async run(args, ctx) {
            const r = await chromeType(uidOf(ctx), scopeKeyOf(ctx), args?.ref, args?.text, Boolean(args?.submit));
            return r.label + ' — проверьте результат новым chrome_snapshot.';
        },
    },
    {
        name: 'chrome_nav',
        risk: 'write',
        outbound: true,
        untrusted: true,
        description: 'Навигация во вкладке агента Chrome: назад (back), вперёд (forward) или обновить (reload).',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['back', 'forward', 'reload'], description: 'Действие навигации' },
            },
            required: ['action'],
        },
        permission: askScoped(args => 'навигация в вашем Chrome: ' + String(args?.action || 'reload')),
        approvalScope: (_args, ctx) => chromePageScope(ctx),
        async run(args, ctx) {
            const snap = await chromeNav(uidOf(ctx), scopeKeyOf(ctx), args?.action);
            return fmtSnap(snap);
        },
    },
    {
        name: 'chrome_handoff',
        risk: 'write',
        description: 'Передать управление человеку в его Chrome (логин, пароль, 2FA, капча, оплата или подтверждение): прикладывает скриншот текущей вкладки и ждёт ответа человека.',
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Что именно нужно сделать человеку в браузере' },
            },
            required: ['reason'],
        },
        async run(args, ctx) {
            const uid = uidOf(ctx);
            const conn = getChromeForUser(uid);
            if (!conn)
                throw new Error('Расширение WORK Chrome Bridge не подключено.');
            const png = await chromeScreenshot(uid);
            const host = ctx?.host;
            const entry = ctx?.entry;
            const turn = ctx?.turn;
            if (typeof host?.wait !== 'function') {
                return 'Человек недоступен (автономный запуск). Опиши, что нужно сделать в Chrome вручную.'
                    + (png ? ' Скриншот приложен.' : '');
            }
            if (entry)
                entry.status = 'waiting';
            await host.save?.();
            const res = await host.wait({
                kind: 'question',
                item: turn?.id,
                call: entry?.id,
                question: 'Ваш Chrome ждёт вас (' + (conn.lastUrl || 'вкладка агента') + '): '
                    + (args?.reason || 'нужно ваше действие в браузере'),
            }) || {};
            if (entry)
                entry.status = 'running';
            const answer = String(res.content ?? res.answer ?? '').trim();
            if (answer && entry)
                entry.answer = answer;
            const afterPng = await chromeScreenshot(uid);
            const shot = afterPng || png;
            const out = answer
                ? 'Ответ человека: ' + answer + ' (обновите chrome_snapshot, если страница изменилась).'
                : 'Человек завершил шаг без текста — обновите chrome_snapshot.';
            if (!shot)
                return out;
            return { text: out + ' Скриншот вкладки приложен.', images: [{ png: shot, label: 'вкладка Chrome после ответа человека' }] };
        },
    },
];
