/**
 * schedule — повторяющиеся и отложенные запуски текущей задачи (.task) от имени пользователя.
 */
import * as S from '../scheduler.js';

export const scheduleTools = [
    {
        name: 'schedule',
        description: 'Расписание этой задачи: create — запускать её по времени с текстом prompt (сводка по понедельникам, ежедневная проверка, напоминание к дате); list — расписания пользователя; cancel — удалить. Запуск идёт от имени пользователя; действия с подтверждением будут ждать его.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'list', 'cancel'] },
                prompt: { type: 'string', description: 'Что делать при каждом запуске (create)' },
                at: { type: 'string', description: 'Время ЧЧ:ММ (create)' },
                days: { type: 'array', items: { type: 'integer' }, description: 'Дни недели 1–7 (1 — пн); по умолчанию ежедневно' },
                every: { type: 'integer', description: 'Или интервал в минутах (от 15)' },
                once: { type: 'string', description: 'Или однократно: дата-время ISO' },
                label: { type: 'string', description: 'Короткое название расписания' },
                id: { type: 'string', description: 'id расписания (cancel)' },
                all: { type: 'boolean', description: 'list: все расписания пользователя, а не только этой задачи' },
            },
            required: ['action'],
        },
        permission(args, ctx) {
            if (args?.action !== 'create')
                return { verdict: 'allow' };
            if (ctx?.host?.allowed?.has?.('schedule'))
                return { verdict: 'allow' };
            const when = args.once ? 'однократно ' + args.once : args.every ? 'каждые ' + args.every + ' мин' : (args.at || '?') + (args.days ? ' по дням ' + args.days.join(',') : ' ежедневно');
            return { verdict: 'ask', reason: 'запускать задачу по расписанию (' + when + '): ' + String(args.prompt || '').slice(0, 200) };
        },
        async run(args, ctx) {
            const uid = ctx?.session?.uid;
            if (!uid || ctx.session.principal?.kind === 'node')
                throw new Error('расписание доступно только пользователю сервера');
            const task = ctx.task?.path;
            switch (args.action) {
                case 'create': {
                    if (!task)
                        throw new Error('расписание создаётся из задачи (.task): разовый запуск его не поддерживает');
                    const s = await S.createSchedule({
                        uid, task, label: args.label, prompt: args.prompt, tz: ctx.tz,
                        rule: { at: args.at, days: args.days, every: args.every, once: args.once },
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
                default:
                    throw new Error('action: create | list | cancel');
            }
        },
    },
];
