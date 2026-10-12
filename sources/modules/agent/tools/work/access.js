/**
 * Права WORK: access, assign, escalate.
 * Тела — из прежнего tools/work.js (байт-в-байт); общие вызовы — ./common.js.
 */
import { absPath, mustItem, classOf, callAs, resolvePeople } from './common.js';
import { isAccessDenied } from '../../util.js';
import { FS } from '../../../../server/index.js';

export const access = {
        name: 'access',
        readonly: true,
        description: 'Права на элемент WORK: область (зона роли / система / лента / секреты), какие роли точки его читают и меняют, кто назначен на эти роли (локально и сверху), твои роли здесь. Для аудита доступа и объяснения отказов.',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'WORK-путь элемента (по умолчанию место задачи)' } },
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            const target = Array.isArray(item) ? item.at(-1) : item;
            const point = target instanceof FS.$class ? target : classOf(target);
            if (!point)
                throw new Error('access: нет класса-владельца');
            await callAs(point, 'assertAccess', {}, ctx).catch(e => { if (isAccessDenied(e)) throw e; });
            const { POLICY } = FS.$class;
            await point.init;
            const declared = await point.declared_roles;
            const area = point.areaOf(target);
            const rows = [];
            for (const [id, role] of Object.entries(declared)) {
                const local = point._roleIds(id, declared).filter(u => u !== 'GUEST');
                const inherited = [];
                if (POLICY.isSystemRole(id))
                    for (let p = point.$parent; p; p = p.$parent)
                        if (p instanceof FS.$class) {
                            await p.init;
                            const pd = p._declaredRolesSync();
                            if (pd[id])
                                inherited.push(...p._roleIds(id, pd).map(u => u + ' (из ' + (p.path || '/') + ')'));
                        }
                rows.push({
                    role: id, label: role.label, system: POLICY.isSystemRole(id),
                    principals: role.principals,
                    read: POLICY.canRead(role, area, { logsContainer: !(target instanceof FS.$file) }),
                    change: POLICY.canWrite(role, area, { local: true, executable: POLICY.isExecutablePath(target.path, point.path) }),
                    assigned: local, inherited,
                });
            }
            const open = (point.DATA?.['#security']?.USER || []).includes('GUEST');
            return JSON.stringify({
                path: target.path, point: point.path || '/', area,
                openToAll: open || undefined,
                yourRoles: await point.roles({ session: ctx?.session }),
                roles: rows,
                note: 'Плюс видят: WORK ADMIN (всё), владельцы лент, в которых есть запись с этим путём (receivers). Системные пути /$server, /sources, /oda видны всем.',
            }, null, 1);
        },
    };

export const assign = {
        name: 'assign',
        risk: 'write',
        outbound: true, // смена прав доступа после чтения внешнего содержимого — только с подтверждением (taint.js)
        target: args => absPath(String(args?.path || '') + '/class.js', null),
        description: 'Назначить или снять пользователей (или узлы сети) на роль класса: меняет только #security собственного class.js. Роль — объявленная в точке (ADMIN, BOSS, USER, GUEST, прикладные). Требует прав администратора.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь класса' },
                role: { type: 'string', description: 'Роль (USER, BOSS, CUSTOMER…)' },
                add: { type: 'array', items: { type: 'string' }, description: 'Кого назначить: uid, ФИО или id узла сети' },
                remove: { type: 'array', items: { type: 'string' }, description: 'Кого снять' },
            },
            required: ['path', 'role'],
        },
        async run(args, ctx) {
            const cls = await mustItem(args.path, ctx);
            if (!(cls instanceof FS.$class))
                throw new Error('assign: ' + absPath(args.path, ctx) + ' — не класс');
            const declared = await cls.declared_roles;
            const role = declared[String(args.role || '').toUpperCase()];
            if (!role)
                throw new Error('роль «' + args.role + '» не объявлена в точке; есть: ' + Object.keys(declared).join(', '));
            const ids = async list => {
                const out = [];
                for (const x of list || []) {
                    const s = String(x).trim();
                    if (/^[0-9A-F]{15}$/i.test(s))
                        out.push(s.toUpperCase()); // узел сети
                    else
                        out.push(...(await resolvePeople([s])).map(p => p.id));
                }
                return out;
            };
            const add = await ids(args.add), remove = new Set(await ids(args.remove));
            if (!add.length && !remove.size)
                throw new Error('assign: нужен add или remove');
            if (add.some(u => /^[0-9A-F]{15}$/.test(u)) && !role.principals?.includes('node'))
                throw new Error('роль ' + role.id + ' нельзя выдать узлу сети');
            // только собственный слой (без склейки с предками — иначе наследуемое осело бы в class.js точки)
            const own = await cls.meta_file;
            const text = own ? await own.load({ encoding: 'utf-8', session: ctx?.session }) : '';
            const data = text ? (await FS.$class.importScript(String(text))) || {} : {};
            const copy = { ...data };
            const sec = { ...(copy['#security'] || {}) };
            const list = new Set([...(sec[role.id] || [])].filter(u => !remove.has(u)));
            for (const u of add)
                list.add(u);
            sec[role.id] = [...list];
            copy['#security'] = sec;
            await callAs(cls.meta_folder, 'save_file', {
                filename: 'class.js',
                post: 'export default ' + FS.$class.toScript(copy),
                message: 'роль ' + role.id + ': ' + [add.length ? '+' + add.join(',') : '', remove.size ? '−' + [...remove].join(',') : ''].filter(Boolean).join(' '),
            }, ctx, 'ADMIN');
            cls.reset();
            return 'роль ' + role.id + ' в ' + cls.path + ': ' + (sec[role.id].join(', ') || 'никого');
        },
    };

export const escalate = {
        name: 'escalate',
        risk: 'write',
        description: 'Запросить у ответственного то, на что не хватает прав (доступ к точке/файлу, назначение роли, решение): находит руководителя точки (BOSS), выше по дереву — вышестоящего, иначе администратора, и отправляет ему поручение из кабинета пользователя. Используй после «Доступ запрещён», вместо попыток обойти отказ.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'К чему нужен доступ (WORK-путь)' },
                need: { type: 'string', description: 'Что нужно: read | write | role:<РОЛЬ> | decision' },
                reason: { type: 'string', description: 'Зачем — по-человечески, для ответственного' },
            },
            required: ['path', 'reason'],
        },
        async run(args, ctx) {
            const uid = ctx?.session?.uid;
            if (!uid || ctx.session.principal?.kind === 'node')
                throw new Error('escalate: только пользователь сервера');
            const p = absPath(args.path, ctx);
            // ближайший класс по пути (сам элемент может быть недоступен — идём по сегментам)
            const segs = p.split('/').filter(Boolean);
            let point = null;
            while (segs.length && !point) {
                const it = await WORK.get_item('/' + segs.join('/')).catch(() => null);
                const cls = Array.isArray(it) ? null : (it instanceof FS.$class ? it : it?.$class);
                if (cls && cls !== WORK)
                    point = cls;
                segs.pop();
            }
            point ??= WORK;
            await point.init;
            const pick = async list => (await list || []).map(u => u.id).filter(id => id && id !== uid);
            let to = await pick(point.bosses), whom = 'руководитель ' + (point.path || '/');
            if (!to.length) { to = await pick(point.allBosses); whom = 'вышестоящий руководитель'; }
            if (!to.length) { to = await pick(point.allAdmins); whom = 'администратор'; }
            if (!to.length) { to = await pick(WORK.admins); whom = 'администратор WORK'; }
            if (!to.length)
                throw new Error('escalate: не найден ответственный за ' + (point.path || '/'));
            let cab = await (await WORK.$users).get_item('//' + uid);
            if (Array.isArray(cab))
                cab = cab[0];
            const need = String(args.need || 'read');
            const row = await callAs(cab, 'save_message', {
                kind: 'order',
                receivers: to.slice(0, 5),
                message: 'Запрос: ' + need + ' — ' + p + '\nПричина: ' + String(args.reason).slice(0, 1500)
                    + '\n(Ответ: done — выполнено, reject — отказ.)',
            }, ctx);
            return 'запрос отправлен (' + whom + ': ' + to.slice(0, 5).join(', ') + '), id ' + row.id + '. Ответ придёт в ленту кабинета.';
        },
    };
