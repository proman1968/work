/**
 * Лента и журнал WORK: send, logs.
 * Тела — из прежнего tools/work.js (байт-в-байт); общие вызовы — ./common.js.
 */
import { absPath, mustItem, classOf, callAs, resolvePeople } from './common.js';
import { clip } from '../../util.js';

export const send = {
        name: 'send',
        risk: 'write',
        // сообщение людям — действие наружу (taint.js); запись в ленту без получателей — нет
        outbound: args => (Array.isArray(args?.to) ? args.to.length : (args?.to ? 1 : 0)) > 0,
        description: 'Записать в ленту точки сообщение или поручение и доставить его получателям (их кабинетам): текст, вложения (видимые тебе файлы WORK), срок. Поручение — kind:"order" с due; отчёт об исполнении — kind:"done" с reply_to (id поручения).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Точка (класс), в ленту которой пишется запись; по умолчанию место задачи' },
                message: { type: 'string', description: 'Текст' },
                to: { type: 'array', items: { type: 'string' }, description: 'Получатели: uid или ФИО/название пользователя' },
                kind: { type: 'string', enum: ['message', 'order', 'done', 'reject', 'remind'], description: 'Вид записи (по умолчанию message)' },
                due: { type: 'string', description: 'Срок YYYY-MM-DD (для order/remind)' },
                reply_to: { type: 'string', description: 'id записи, на которую это ответ (из результата send или ленты)' },
                includes: { type: 'array', items: { type: 'string' }, description: 'WORK-пути вложений' },
            },
            required: ['message'],
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            const cls = classOf(item) || item;
            if (typeof cls.save_message !== 'function')
                throw new Error('send: у ' + cls.path + ' нет ленты');
            // ядро молча отбрасывает кривые срок и ссылку — модель должна узнать об ошибке сразу
            const due = args.due == null || args.due === '' ? undefined : String(args.due).trim();
            if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due))
                throw new Error('send: срок due — YYYY-MM-DD, получено «' + due + '»');
            const replyTo = args.reply_to == null || args.reply_to === '' ? undefined : String(args.reply_to).trim().replace(/^[#]|^id=/, '');
            if (replyTo && !/^[\w.@-]{1,80}:\d{10,16}$/.test(replyTo) && !/^\//.test(replyTo))
                throw new Error('send: reply_to — id записи вида «автор:время» (из результата send или поля id= в logs), получено «' + replyTo + '»');
            const receivers = await resolvePeople(args.to || []);
            const row = await callAs(cls, 'save_message', {
                message: String(args.message),
                receivers: receivers.map(r => r.id),
                includes: (args.includes || []).map(p => absPath(p, ctx)),
                kind: args.kind || (due ? 'order' : 'message'),
                due, reply_to: replyTo,
            }, ctx);
            return 'записано в ленту ' + cls.path + ' (id ' + row.id + ')'
                + (receivers.length ? '; получатели: ' + receivers.map(r => r.label + ' [' + r.id + ']').join(', ') : '');
        },
    };

export const logs = {
        name: 'logs',
        readonly: true,
        description: 'Журнал событий класса (кто, что, когда сделал): даты с записями или записи за день/диапазон.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь класса (по умолчанию место задачи)' },
                day: { type: 'string', description: 'День YYYY-MM-DD' },
                from: { type: 'string', description: 'Начало диапазона YYYY-MM-DD' },
                to: { type: 'string', description: 'Конец диапазона YYYY-MM-DD' },
                dates: { type: 'boolean', description: 'Только список дат с записями' },
                limit: { type: 'integer', description: 'Сколько последних записей показать (по умолчанию 200, максимум 1000)' },
            },
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            const cls = classOf(item) || item;
            if (typeof cls.logs !== 'function')
                throw new Error('у ' + cls.path + ' нет журнала');
            if (args.dates)
                return callAs(cls, 'logs', { mode: 'dates' }, ctx);
            const q = { mode: 'bodies' };
            for (const k of ['day', 'from', 'to'])
                if (args[k])
                    q[k] = args[k];
            const rows = await callAs(cls, 'logs', q, ctx);
            const list = Array.isArray(rows) ? rows : (rows?.items || rows?.rows || []);
            if (!list.length)
                return 'записей нет' + (args.day ? ' за ' + args.day : '') + ' (попробуй dates:true)';
            // журнал отсортирован от новых к старым: берём последние события, выводим по времени
            const limit = Math.min(1000, Math.max(1, Number(args.limit) || 200));
            const shown = list.slice(0, limit).reverse();
            const head = list.length > limit
                ? 'показаны последние ' + limit + ' из ' + list.length + ' записей (сузь период или увеличь limit)\n'
                : 'записей: ' + list.length + '\n';
            return head + shown.map(r => {
                const t = r.time ? new Date(r.time).toISOString().replace('T', ' ').slice(0, 16) : '';
                const who = r.actor ? r.sender + ' (' + r.actor + ')' : r.sender;
                const to = r.receivers?.length ? '→ ' + [].concat(r.receivers).join(',') : '';
                const meta = [r.kind && r.kind !== 'message' ? r.kind : '', r.due ? 'срок ' + r.due : '', r.reply_to ? 'на ' + r.reply_to : '']
                    .filter(Boolean).join(', ');
                const id = r.sender && r.time ? 'id=' + r.sender + ':' + r.time : '';
                return [t, id, who, to, meta ? '{' + meta + '}' : '', r.ext ? '[' + r.ext + ']' : '', r.path || '', r.content ? '— ' + clip(String(r.content), 300) : ''].filter(Boolean).join(' ');
            }).join('\n');
        },
    };
