/**
 * Штатные инструменты ИИ-агента для работы с Календарём (.ics) и Почтой (.eml) WORK:
 *  - calendar_list, calendar_save
 *  - mail_list, mail_read, mail_refresh, mail_draft, mail_send
 */
import * as MAILCAL from '../../../server/class/mail-calendar.js';

async function resolveTargetPlace(pathArg, ctx) {
    const p = String(pathArg || '').trim();
    if (!p)
        return ctx?.place || globalThis.WORK;
    if (ctx?.place && (ctx.place.path === p || ctx.place.short === p))
        return ctx.place;
    const item = await globalThis.WORK?.get_item?.(p).catch(() => null);
    if (!item)
        throw new Error(`Узел не найден: ${p}`);
    return item;
}

export const calendarListTool = {
    name: 'calendar_list',
    label: 'Просмотр календаря',
    description: 'Показать события календаря узла за диапазон дат (включая повторяющиеся встречи, задачи со сроком, расписания ИИ и свободные окна).',
    readonly: true,
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь узла (по умолчанию текущий узел)' },
            from: { type: 'string', description: 'Начало периода YYYY-MM-DD (по умолчанию сегодня)' },
            to: { type: 'string', description: 'Конец периода YYYY-MM-DD (по умолчанию равен from)' },
            includeTasks: { type: 'boolean', description: 'Включить задачи со сроком' },
            includeSchedules: { type: 'boolean', description: 'Включить регулярные расписания ИИ' },
            withFreeSlots: { type: 'boolean', description: 'Рассчитать свободные окна (09:00–18:00)' },
            attendee: { type: 'string', description: 'Фильтр по uid участника/организатора' },
        },
    },
    async run(args, ctx) {
        const place = await resolveTargetPlace(args?.path, ctx);
        return MAILCAL.calendarList(place, {
            ...args,
            session: ctx?.session,
        });
    },
};

export const calendarSaveTool = {
    name: 'calendar_save',
    label: 'Сохранение встречи в календаре',
    description: 'Создать, изменить, перенести или отменить событие календаря (.ics) с проверкой накладок по времени и синхронизацией приглашений участникам.',
    risk: 'write',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь узла (по умолчанию текущий узел)' },
            uid: { type: 'string', description: 'UID существующей встречи для изменения/переноса/отмены' },
            summary: { type: 'string', description: 'Название события/встречи' },
            start: { type: 'string', description: 'Дата/время начала (ISO, например 2026-11-26T10:00:00+03:00)' },
            end: { type: 'string', description: 'Дата/время окончания (ISO)' },
            allDay: { type: 'boolean', description: 'Событие на весь день' },
            location: { type: 'string', description: 'Место или ссылка на созвон' },
            description: { type: 'string', description: 'Описание / повестка' },
            attendees: { type: 'array', items: { type: 'string' }, description: 'Список uid коллег-участников' },
            externalEmails: { type: 'array', items: { type: 'string' }, description: 'Внешние email участников' },
            recurrence: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'], description: 'Правило повторения' },
            reminderMin: { type: 'number', description: 'Напоминание за N минут (0, 15, 60, 1440)' },
            category: { type: 'string', enum: ['meeting', 'important', 'personal', 'client'], description: 'Категория/цвет события' },
            status: { type: 'string', enum: ['confirmed', 'cancelled'], description: 'cancelled — отменить встречу' },
            allowConflict: { type: 'boolean', description: 'true — сохранить даже при наложении по времени с другой встречей' },
        },
        required: ['start', 'end'],
    },
    async run(args, ctx) {
        const place = await resolveTargetPlace(args?.path, ctx);
        if (args?.status !== 'cancelled' && !args?.allowConflict && !args?.allDay) {
            const fromDay = String(args.start).slice(0, 10);
            const toDay = String(args.end).slice(0, 10);
            const existing = await MAILCAL.calendarList(place, { from: fromDay, to: toDay, session: ctx?.session });
            const reqStart = Date.parse(args.start);
            const reqEnd = Date.parse(args.end);
            const conflicts = (existing?.events || []).filter(ev => {
                if (ev.kind !== 'event' || ev.allDay)
                    return false;
                if (args.uid && ev.uid === args.uid)
                    return false;
                const s = Date.parse(ev.start);
                const e = Date.parse(ev.end);
                return Number.isFinite(s) && Number.isFinite(e) && s < reqEnd && e > reqStart;
            });
            if (conflicts.length) {
                return {
                    ok: false,
                    conflict: true,
                    message: `Обнаружено пересечение по времени (${conflicts.length}): ${conflicts.map(c => `${c.summary} (${c.start})`).join('; ')}. Выберите свободное окно или передайте allowConflict: true.`,
                    conflicts: conflicts.map(c => ({ uid: c.uid, summary: c.summary, start: c.start, end: c.end })),
                };
            }
        }
        return MAILCAL.calendarSave(place, {
            ...args,
            session: ctx?.session,
        });
    },
};

export const mailListTool = {
    name: 'mail_list',
    label: 'Список писем',
    description: 'Показать список писем узла по папкам (inbox, drafts, outbox, trash, all) с поиском и фильтром непрочитанных.',
    readonly: true,
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь узла (по умолчанию текущий узел)' },
            box: { type: 'string', enum: ['all', 'inbox', 'drafts', 'outbox', 'trash'], description: 'Папка (по умолчанию inbox)' },
            q: { type: 'string', description: 'Поиск по теме, адресу или тексту' },
            address: { type: 'string', description: 'Фильтр по подключённому ящику' },
            unreadOnly: { type: 'boolean', description: 'Только непрочитанные' },
            limit: { type: 'number', description: 'Максимум писем (по умолчанию 50)' },
        },
    },
    async run(args, ctx) {
        const place = await resolveTargetPlace(args?.path, ctx);
        const [acc, list] = await Promise.all([
            MAILCAL.mailAccounts(place, { session: ctx?.session }).catch(() => ({ accounts: [] })),
            MAILCAL.mailList(place, {
                box: args?.box || 'inbox',
                q: args?.q || '',
                address: args?.address || '',
                unreadOnly: args?.unreadOnly === true,
                limit: args?.limit || 50,
                session: ctx?.session,
            }),
        ]);
        return { accounts: acc.accounts, ...list };
    },
};

export const mailReadTool = {
    name: 'mail_read',
    label: 'Чтение письма',
    description: 'Прочитать полное содержимое письма (.eml) по path или uid. Содержимое писем помечается как внешние данные (<untrusted>).',
    readonly: true,
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь файла письма .eml' },
            uid: { type: 'string', description: 'UID письма (если path неизвестен)' },
            nodePath: { type: 'string', description: 'WORK-путь узла (по умолчанию текущий узел)' },
            markRead: { type: 'boolean', description: 'Отметить прочитанным (по умолчанию false при чтении агентом)' },
        },
    },
    async run(args, ctx) {
        const place = await resolveTargetPlace(args?.nodePath, ctx);
        const msg = await MAILCAL.mailRead(place, {
            path: args?.path,
            uid: args?.uid,
            markRead: args?.markRead === true,
            session: ctx?.session,
        });
        if (ctx?.entry)
            ctx.entry.untrusted = true;
        return msg;
    },
};

export const mailRefreshTool = {
    name: 'mail_refresh',
    label: 'Проверка новой почты',
    description: 'Запросить свежие входящие письма с почтового сервера (IMAP) для настроенных ящиков узла.',
    risk: 'write',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь узла (по умолчанию текущий узел)' },
        },
    },
    async run(args, ctx) {
        const place = await resolveTargetPlace(args?.path, ctx);
        return MAILCAL.mailRefresh(place, { session: ctx?.session });
    },
};

export const mailDraftTool = {
    name: 'mail_draft',
    label: 'Черновик и статус письма',
    description: 'Сохранить/обновить черновик письма в папке «Черновики» (action=draft) или изменить статус/папку письма (read/unread/trash/restore).',
    risk: 'write',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь узла (по умолчанию текущий узел)' },
            action: { type: 'string', enum: ['draft', 'read', 'unread', 'trash', 'restore'], description: 'Действие (по умолчанию draft)' },
            messagePath: { type: 'string', description: 'Путь письма для read/unread/trash/restore' },
            uid: { type: 'string', description: 'UID черновика или письма' },
            from: { type: 'string', description: 'Адрес отправителя (из ящиков узла)' },
            to: { type: 'string', description: 'Получатель(и) через запятую' },
            cc: { type: 'string', description: 'Копия (через запятую)' },
            subject: { type: 'string', description: 'Тема письма' },
            body: { type: 'string', description: 'Текст письма' },
            inReplyTo: { type: 'string', description: 'Message-ID исходного письма при ответе' },
        },
    },
    async run(args, ctx) {
        const place = await resolveTargetPlace(args?.path, ctx);
        const act = String(args?.action || 'draft');
        if (act === 'draft') {
            return MAILCAL.mailDraftSave(place, {
                uid: args?.uid,
                from: args?.from,
                to: args?.to,
                cc: args?.cc,
                subject: args?.subject,
                body: args?.body,
                inReplyTo: args?.inReplyTo,
                session: ctx?.session,
            });
        }
        return MAILCAL.mailState(place, {
            path: args?.messagePath,
            uid: args?.uid,
            ...(act === 'read' ? { read: true } : {}),
            ...(act === 'unread' ? { read: false } : {}),
            ...(act === 'trash' ? { box: 'trash' } : {}),
            ...(act === 'restore' ? { restore: true } : {}),
            session: ctx?.session,
        });
    },
};

export const mailSendTool = {
    name: 'mail_send',
    label: 'Отправка письма наружу',
    description: 'Отправить письмо по электронной почте через настроенный ящик узла. Всегда требует явного подтверждения человека (для черновика без отправки используй mail_draft).',
    risk: 'danger',
    outbound: true,
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь узла (по умолчанию текущий узел)' },
            from: { type: 'string', description: 'Адрес отправителя' },
            to: { type: 'string', description: 'Получатель(и) через запятую' },
            cc: { type: 'string', description: 'Копия' },
            subject: { type: 'string', description: 'Тема письма' },
            body: { type: 'string', description: 'Текст письма' },
            draftUid: { type: 'string', description: 'UID черновика (если отправляем сохранённый черновик)' },
            inReplyTo: { type: 'string', description: 'Message-ID исходного письма' },
        },
        required: ['to', 'subject', 'body'],
    },
    async run(args, ctx) {
        const place = await resolveTargetPlace(args?.path, ctx);
        return MAILCAL.mailSend(place, {
            from: args?.from,
            to: args?.to,
            cc: args?.cc,
            subject: args?.subject,
            body: args?.body,
            draftUid: args?.draftUid,
            inReplyTo: args?.inReplyTo,
            session: ctx?.session,
        });
    },
};

export const calendarMailTools = [
    calendarListTool,
    calendarSaveTool,
    mailListTool,
    mailReadTool,
    mailRefreshTool,
    mailDraftTool,
    mailSendTool,
];
