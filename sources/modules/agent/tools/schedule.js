/**
 * schedule — повторяющиеся и отложенные запуски текущей задачи (.task) от имени пользователя.
 */
import * as S from '../scheduler.js';

export const scheduleTools = [
    {
        name: 'schedule',
        // создание отложенных запусков и отправка уведомлений после чтения внешнего содержимого — только с подтверждением (taint.js)
        outbound: args => args?.action === 'create' || args?.action === 'send',
        description: 'Расписание этой задачи и уведомления в мессенджеры (Telegram/MAX): create — запускать по времени с текстом prompt (сводка по понедельникам, каждые 15 мин, напоминание к дате; scope: personal или department); list — расписания; cancel — удалить; link — получить одноразовый код привязки Telegram/MAX; unlink — отвязать; status — проверить бота точки и привязки; send — отправить уведомление в мессенджер.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'list', 'cancel', 'link', 'unlink', 'status', 'send'] },
                prompt: { type: 'string', description: 'Что делать при каждом запуске (create) или текст уведомления (send)' },
                at: { type: 'string', description: 'Время ЧЧ:ММ (create; для date — обязательно)' },
                days: { type: 'array', items: { type: 'integer' }, description: 'Дни недели 1–7 (1 — пн); по умолчанию ежедневно' },
                workdays: { type: 'boolean', description: 'По рабочим дням (пн–пт) — вместо days' },
                every: { type: 'integer', description: 'Или интервал в минутах (от 15)' },
                once: { type: 'string', description: 'Или однократно: дата-время ISO' },
                date: { type: 'string', description: 'Или календарная дата YYYY-MM-DD (с at; 9.8)' },
                repeat: { type: 'string', enum: ['monthly', 'yearly'], description: 'Для date: monthly — каждый месяц в это число, yearly — каждый год в эту дату' },
                scope: { type: 'string', enum: ['personal', 'department'], description: 'Доставка уведомления: personal (лично владельцу) или department (общее по подразделению)' },
                channel: { type: 'string', enum: ['telegram', 'max'], description: 'Мессенджер (для link / unlink)' },
                label: { type: 'string', description: 'Короткое название расписания или заголовок уведомления' },
                id: { type: 'string', description: 'id расписания (cancel)' },
                all: { type: 'boolean', description: 'list: все расписания пользователя, а не только этой задачи' },
            },
            required: ['action'],
        },
        permission(args, ctx) {
            if (args?.action === 'send') {
                const target = args.scope === 'department' ? 'всему подразделению' : 'лично вам';
                return { verdict: 'ask', reason: `отправить уведомление (${target}): ${String(args.prompt || args.label || '').slice(0, 200)}` };
            }
            if (args?.action !== 'create')
                return { verdict: 'allow' };
            if (ctx?.host?.allowed?.has?.('schedule'))
                return { verdict: 'allow' };
            const when = args.once ? 'однократно ' + args.once
                : args.date ? 'календарь ' + args.date + (args.repeat ? ' повтор ' + args.repeat : '') + ' в ' + (args.at || '?')
                : args.every ? 'каждые ' + args.every + ' мин'
                : (args.at || '?') + (args.workdays ? ' по рабочим дням' : args.days ? ' по дням ' + args.days.join(',') : ' ежедневно');
            return { verdict: 'ask', reason: 'запускать задачу по расписанию (' + when + '): ' + String(args.prompt || '').slice(0, 200) };
        },
        async run(args, ctx) {
            const uid = ctx?.session?.uid;
            if (!uid || ctx.session.principal?.kind === 'node')
                throw new Error('расписание доступно только пользователю сервера');
            const task = ctx.task?.path;
            const point = ctx.place || task || '/';
            switch (args.action) {
                case 'create': {
                    if (!task)
                        throw new Error('расписание создаётся из задачи (.task): разовый запуск его не поддерживает');
                    const s = await S.createSchedule({
                        uid, task, label: args.label, prompt: args.prompt, tz: ctx.tz,
                        rule: {
                            at: args.at, days: args.days, workdays: args.workdays,
                            every: args.every, once: args.once, date: args.date,
                            repeat: args.repeat, scope: args.scope,
                        },
                    });
                    return 'создано расписание ' + s.id + ': ' + s.when + ' (' + s.tz + '), ближайший запуск ' + s.next;
                }
                case 'list': {
                    const list = await S.listSchedules({ uid, task: args.all ? undefined : task });
                    if (!list.length)
                        return 'расписаний нет';
                    return list.map(s => s.id + '  ' + s.when + '  «' + s.label + '»  следующий: ' + (s.next || '—')
                        + (s.enabled ? '' : '  [выключено]') + (s.lastError ? '  ошибка: ' + s.lastError : '')
                        + (args.all ? '  ' + s.task : '')).join('\n');
                }
                case 'cancel':
                    await S.cancelSchedule({ uid, id: args.id });
                    return 'расписание ' + args.id + ' удалено';
                case 'link': {
                    const N = await import('../../notify/index.js');
                    const res = await N.createLinkCode({
                        uid,
                        point,
                        target: args.scope === 'department' ? 'group' : 'user',
                        channel: args.channel || '',
                    });
                    const botDesc = res.bot
                        ? `боту «${res.bot.label}» (${res.bot.kind}${res.bot.username ? ', @' + res.bot.username : ''})`
                        : `боту (${res.channel})`;
                    return `Код привязки: ${res.code} (действует 15 мин).\nОтправьте ${botDesc} сообщение:\n${res.command}`
                        + (res.deepLink ? `\nПрямая ссылка: ${res.deepLink}` : '');
                }
                case 'unlink': {
                    const N = await import('../../notify/index.js');
                    await N.unbindUserChat(uid, { channel: args.channel || '' });
                    return 'Привязка мессенджера удалена' + (args.channel ? ` (${args.channel})` : '');
                }
                case 'status': {
                    const N = await import('../../notify/index.js');
                    const st = await N.getPointMessengerStatus(point, { uid });
                    const botLine = st.effectiveBot
                        ? `Бот точки «${st.pointLabel}»: ${st.effectiveBot.label} (${st.effectiveBot.kind}${st.effectiveBot.username ? ' @' + st.effectiveBot.username : ''}${st.effectiveBot.inherited ? ', унаследован от ' + st.effectiveBot.sourcePath : ', собственный'})`
                        : `Бот точки «${st.pointLabel}»: не настроен`;
                    const tg = st.currentUser?.telegram;
                    const mx = st.currentUser?.max;
                    const userLine = `Личные привязки (${uid}): Telegram — ${tg ? 'привязан (' + (tg.username ? '@' + tg.username : tg.chatId) + ')' : 'нет'}, MAX — ${mx ? 'привязан (' + (mx.username || mx.chatId) + ')' : 'нет'}`;
                    const groupLine = st.groupChatId ? `\nОбщий чат подразделения: ${st.groupTitle || st.groupChatId}` : '';
                    return `${botLine}\n${userLine}${groupLine}`;
                }
                case 'send': {
                    const N = await import('../../notify/index.js');
                    const msg = {
                        title: args.label || 'Уведомление WORK',
                        body: String(args.prompt || '').trim(),
                        data: { url: task || '' },
                    };
                    if (args.scope === 'department') {
                        const r = await N.notifyDepartment(point, msg);
                        return r.delivered
                            ? `Отправлено подразделению «${r.pointPath}» (в группу: ${r.groupDelivered ? 'да' : 'нет'}, участникам лично: ${r.membersDelivered.length})`
                            : `Не удалось доставить в мессенджер (участников: ${r.memberCount}, отправлен web-push fallback: ${r.fallbackUids.length})`;
                    }
                    const r = await N.notifyPersonal(uid, msg, { point });
                    return r.delivered
                        ? `Уведомление доставлено в ${r.channel} (бот «${r.botLabel || r.botId}»)`
                        : `Мессенджер не подключён (${r.reason || r.error || 'fallback web-push'})`;
                }
                default:
                    throw new Error('action: create | list | cancel | link | unlink | status | send');
            }
        },
    },
];
