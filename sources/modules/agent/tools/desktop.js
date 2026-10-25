/**
 * Инструменты управления настоящим компьютером пользователя через агент-«мост» (9.12, в дополнение к песочнице):
 *   desktop_status   — подключён ли мост на ПК пользователя, режим «только просмотр» (readOnly), папка, журнал;
 *   desktop_mode     — включить/выключить режим «только просмотр» (readOnly) с подтверждением человека;
 *   desktop_file     — осмотр (ls), чтение (read) и запись (write) файлов в выделенной папке на ПК пользователя;
 *   desktop_windows  — список открытых окон на компьютере пользователя;
 *   desktop_app      — запуск разрешённой программы (open) или переключение окна (focus) на ПК пользователя.
 *
 * Безопасность:
 *   - Строгая привязка к владельцу сессии (uid): агент видит только мост текущего пользователя;
 *   - Каждое действие на ПК (запись файла, запуск программы, фокус окна, смена режима) требует
 *     отдельного подтверждения человека (verdict: 'ask', noAlways: true — без «разрешить всегда»);
 *   - В режиме «только просмотр» (readOnly: true) любые изменяющие/активные команды блокируются;
 *   - Данные с ПК пользователя помечаются как внешние (untrusted: true).
 */
import { getBridgeForUser, setBridgeReadOnly, dispatchBridgeCommand } from '../../bridge/hub.js';
import { clip } from '../util.js';

function uidOf(ctx) {
    const uid = ctx?.session?.uid;
    if (!uid)
        throw new Error('Управление компьютером пользователя доступно после входа в систему.');
    return String(uid);
}

/** Видимы в списке инструментов, когда у пользователя подключён мост (или при явной проверке). */
export function desktopBridgeAvailable(session) {
    const uid = session?.uid;
    return Boolean(uid && getBridgeForUser(uid));
}

export const desktopTools = [
    {
        name: 'desktop_status',
        readonly: true,
        description: 'Состояние агента-«моста» на настоящем компьютере пользователя (9.12, отдельно от Docker-песочницы): подключён ли мост, ОС, разрешённая папка, включён ли режим «только просмотр» (readOnly), разрешённые программы и журнал последних действий.',
        parameters: { type: 'object', properties: {} },
        async run(_args, ctx) {
            const s = getBridgeForUser(uidOf(ctx));
            if (!s)
                return 'Агент-«мост» на вашем компьютере не подключён. Запустите на ПК: node scripts/work-desktop-bridge.mjs --server <URL> --token <токен_MCP> --root <папка> [--readonly].';
            const recent = s.history.slice(-10).map(h => '  ' + h.time.slice(11, 19) + ' ' + h.action + (h.target ? ' (' + h.target + ')' : '') + ' → ' + h.outcome).join('\n');
            return 'Мост на ПК «' + s.hostname + '» (' + s.platform + '): подключён\n'
                + 'Режим: ' + (s.readOnly ? 'ТОЛЬКО ПРОСМОТР (readOnly — изменения запрещены)' : 'чтение и действия (с подтверждением каждого шага)') + '\n'
                + 'Папка: ' + s.rootDir + '\n'
                + 'Разрешённые программы: ' + (s.allowedApps.join(', ') || 'нет') + '\n'
                + 'Журнал моста:\n' + (recent || '  (пусто)');
        },
    },
    {
        name: 'desktop_mode',
        risk: 'write',
        description: 'Переключить режим «только просмотр» (readOnly) для моста на компьютере пользователя. В режиме readOnly=true любые изменения файлов, запуск программ и управление окнами заблокированы.',
        parameters: {
            type: 'object',
            properties: {
                readOnly: { type: 'boolean', description: 'true — только просмотр; false — разрешить действия с подтверждением' },
            },
            required: ['readOnly'],
        },
        permission: args => ({
            verdict: 'ask',
            noAlways: true,
            reason: args?.readOnly
                ? 'включить режим «только просмотр» на компьютере пользователя'
                : 'разрешить действия на компьютере пользователя (каждое действие всё равно спросит подтверждение)',
        }),
        async run(args, ctx) {
            const r = setBridgeReadOnly(uidOf(ctx), Boolean(args?.readOnly));
            return 'Режим моста на компьютере пользователя: ' + (r.readOnly ? 'только просмотр (readOnly)' : 'действия с подтверждением') + '.';
        },
    },
    {
        name: 'desktop_file',
        risk: 'danger',
        untrusted: true,
        description: 'Файлы в разрешённой папке на настоящем компьютере пользователя (через мост): ls — список файлов, read — прочитать текстовый файл, write — записать файл (только с подтверждением человека и если не включён режим «только просмотр»). Чувствительные файлы (.env, .ssh, ключи) и выход за пределы папки заблокированы.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['ls', 'read', 'write'], description: 'Операция над файлом/папкой на ПК пользователя' },
                path: { type: 'string', description: 'Относительный путь внутри разрешённой папки моста' },
                content: { type: 'string', description: 'Содержимое файла для action=write' },
                reason: { type: 'string', description: 'Зачем записываем файл (для подтверждения человеком)' },
            },
            required: ['action'],
        },
        permission(args) {
            if (args?.action === 'ls' || args?.action === 'read')
                return { verdict: 'allow' };
            return {
                verdict: 'ask',
                noAlways: true,
                reason: (args?.reason ? args.reason + ' — ' : '') + 'запись файла на компьютере пользователя: ' + String(args?.path || '?'),
            };
        },
        async run(args, ctx) {
            const uid = uidOf(ctx);
            if (args.action === 'ls') {
                const r = await dispatchBridgeCommand(uid, { op: 'ls', path: args.path || '.' });
                const lines = (r.items || []).map(e => (e.type === 'dir' ? '[папка] ' : '') + e.name);
                return 'ПК (' + r.path + '):\n' + (lines.join('\n') || '(пусто)');
            }
            if (args.action === 'read') {
                if (!args.path)
                    throw new Error('desktop_file: для read укажи path');
                const r = await dispatchBridgeCommand(uid, { op: 'read', path: args.path });
                return 'ПК файл ' + r.path + ' (' + r.size + ' байт):\n' + clip(String(r.content ?? ''), 20000);
            }
            if (args.action === 'write') {
                if (!args.path)
                    throw new Error('desktop_file: для write укажи path');
                const r = await dispatchBridgeCommand(uid, { op: 'write', path: args.path, content: String(args.content ?? '') });
                return 'Записан файл на ПК пользователя: ' + r.path + ' (' + r.bytes + ' байт).';
            }
            throw new Error('desktop_file: action должен быть ls | read | write');
        },
    },
    {
        name: 'desktop_windows',
        readonly: true,
        untrusted: true,
        description: 'Список открытых окон на компьютере пользователя (через мост).',
        parameters: { type: 'object', properties: {} },
        async run(_args, ctx) {
            const r = await dispatchBridgeCommand(uidOf(ctx), { op: 'windows' });
            const list = r?.windows || [];
            if (!list.length)
                return 'Открытых окон не найдено.';
            return 'Окна на ПК пользователя:\n' + list.map(w => '- [' + (w.app || 'window') + '] ' + w.title).join('\n');
        },
    },
    {
        name: 'desktop_app',
        risk: 'danger',
        untrusted: true,
        description: 'Программы и окна на настоящем компьютере пользователя (через мост): open — запустить программу из разрешённого списка моста; focus — переключить активное окно по заголовку. Каждое действие требует отдельного подтверждения человека; в режиме «только просмотр» (readOnly) заблокировано.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['open', 'focus'], description: 'open (запустить программу) | focus (активировать окно)' },
                app: { type: 'string', description: 'Имя программы из разрешённого списка моста (для action=open)' },
                args: { type: 'array', items: { type: 'string' }, description: 'Аргументы программы (без шелл-символов)' },
                title: { type: 'string', description: 'Заголовок окна (для action=focus)' },
                reason: { type: 'string', description: 'Зачем выполняем действие на ПК (для подтверждения человеком)' },
            },
            required: ['action', 'reason'],
        },
        permission(args) {
            const target = args?.action === 'open' ? ('запуск программы «' + (args?.app || '?') + '»') : ('переключение на окно «' + (args?.title || '?') + '»');
            return {
                verdict: 'ask',
                noAlways: true,
                reason: (args?.reason ? args.reason + ' — ' : '') + 'действие на компьютере пользователя: ' + target,
            };
        },
        async run(args, ctx) {
            const uid = uidOf(ctx);
            if (args.action === 'open') {
                const r = await dispatchBridgeCommand(uid, { op: 'open_app', app: args.app, args: args.args });
                return 'На ПК пользователя запущена программа «' + r.started + '» (pid ' + r.pid + ').';
            }
            if (args.action === 'focus') {
                const r = await dispatchBridgeCommand(uid, { op: 'focus_window', title: args.title });
                return 'Активное окно на ПК пользователя: «' + r.focused + '».';
            }
            throw new Error('desktop_app: action должен быть open | focus');
        },
    },
];
