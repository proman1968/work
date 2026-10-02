/**
 * Действия во внешних сервисах от имени пользователя:
 *   connections      — какие аккаунты подключены (без секретов);
 *   connect_service  — попросить человека подключить аккаунт (вход/регистрация — только им, в карточке);
 *   http_request     — запрос к API (с подключением или публичный). Чтение (GET) — без вопросов,
 *                      любое изменение (POST/PUT/PATCH/DELETE) — всегда с явным подтверждением, без «разрешить всегда»;
 *   disconnect_service — удалить подключение (с подтверждением).
 */
import * as C from '../connections.js';
import { clip } from '../util.js';
import { assertPageUrl } from './browse.js';

const READ = new Set(['GET', 'HEAD', 'OPTIONS']);

function uidOf(ctx) {
    const uid = ctx?.session?.uid;
    if (!uid)
        throw new Error('нет пользователя сессии — подключения доступны после входа');
    return uid;
}

export const connectTools = [
    {
        name: 'connections',
        readonly: true,
        description: 'Подключённые аккаунты пользователя во внешних сервисах (Google, Яндекс, Microsoft, GitHub, API по токену): имя, провайдер, доступы.',
        parameters: { type: 'object', properties: {} },
        async run(_args, ctx) {
            const list = await C.list(uidOf(ctx));
            if (!list.length)
                return 'Подключений нет. Для действий в сервисе попроси подключение: connect_service.';
            return list.map(c => '- ' + c.name + ' — ' + c.label + (c.base_url ? ', API ' + c.base_url : '') + (c.scopes?.length ? ', доступ: ' + c.scopes.join(' ') : '') + (c.expires ? ', токен до ' + c.expires + (c.refreshable ? ' (обновляется)' : '') : '')).join('\n');
        },
    },
    {
        name: 'connect_service',
        planSafe: true,
        description: 'Попросить пользователя подключить его аккаунт во внешнем сервисе. Вход/регистрацию он делает сам в карточке (OAuth на сайте провайдера или ввод токена) — никогда не спрашивай пароли и токены в чате. Затем используй http_request с connection=name.',
        parameters: {
            type: 'object',
            properties: {
                provider: { type: 'string', enum: Object.keys(C.PROVIDERS), description: 'google | yandex | microsoft | github | token (любой API по токену)' },
                name: { type: 'string', description: 'Имя подключения (по умолчанию = provider)' },
                scopes: { type: 'array', items: { type: 'string' }, description: 'Доступы: для google — calendar, calendar.readonly, gmail, gmail.readonly, drive, tasks, contacts; или полные scope-URL' },
                base_url: { type: 'string', description: 'Для provider=token — базовый URL API' },
                signup: { type: 'string', description: 'Страница регистрации сервиса (для человека; покажется в карточке рядом с полем токена)' },
                docs: { type: 'string', description: 'Документация API сервиса (для человека)' },
                reason: { type: 'string', description: 'Зачем нужен доступ (покажется пользователю)' },
            },
            required: ['provider', 'reason'],
        },
        async run(args, ctx) {
            const uid = uidOf(ctx);
            const name = String(args.name || args.provider);
            // ссылки для человека — та же строгая проверка, что у open_page (карточка подставляет их в iframe)
            for (const key of ['signup', 'docs']) {
                if (args[key] != null && String(args[key]).trim() !== '')
                    args[key] = assertPageUrl(args[key]);
                else
                    args[key] = undefined;
            }
            const have = (await C.list(uid)).find(c => c.name === name);
            const want = C.scopesOf(args.provider, args.scopes);
            if (have && want.every(s => have.scopes.includes(s)))
                return 'Уже подключено: ' + name + ' (' + have.label + '). Используй http_request с connection="' + name + '".';
            const { host, entry, turn } = ctx;
            if (typeof host.wait !== 'function')
                return 'Подключение делает пользователь в задаче (.task) — в разовом запуске недоступно.';
            entry.connect = {
                name, provider: args.provider, label: C.PROVIDERS[args.provider]?.label,
                scopes: want, base_url: args.base_url, reason: args.reason,
                signup: args.signup || undefined, docs: args.docs || undefined,
                need_client: C.needsClient(args.provider), console: C.PROVIDERS[args.provider]?.console,
            };
            entry.status = 'waiting';
            await host.save();
            const res = await host.wait({ kind: 'connect', item: turn.id, call: entry.id }) || {};
            entry.status = 'running';
            if (!res.accept)
                return 'Пользователь не подключил ' + (entry.connect.label || name) + (res.content ? ': ' + res.content : '') + '. Не пытайся обойти — предложи, что сделать без доступа.';
            const now = (await C.list(uid)).find(c => c.name === name);
            return now ? 'Подключено: ' + name + ' (' + now.label + '), доступ: ' + (now.scopes.join(' ') || 'базовый') + '. Дальше — http_request с connection="' + name + '".'
                : 'Подключение не найдено после входа — попроси повторить.';
        },
    },
    {
        name: 'http_request',
        risk: 'danger',
        description: 'Запрос к API внешнего сервиса. connection — подключённый аккаунт (авторизация подставится сама), url — полный или путь от base_url подключения. Пример Google Calendar: POST /calendar/v3/calendars/primary/events. Любое изменение (не GET) пользователь подтверждает явно — опиши в reason, что именно сделаешь.',
        parameters: {
            type: 'object',
            properties: {
                connection: { type: 'string', description: 'Имя подключения (из connections); без него — публичный запрос' },
                method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: 'HTTP-метод' },
                url: { type: 'string', description: 'Полный URL или путь от base_url подключения' },
                query: { type: 'object', description: 'Параметры строки запроса' },
                headers: { type: 'object', description: 'Доп. заголовки (без Authorization)' },
                body: { description: 'Тело: объект (JSON) или строка' },
                reason: { type: 'string', description: 'Что делает запрос — человеческим языком (для подтверждения)' },
            },
            required: ['method', 'url'],
        },
        permission(args) {
            const m = String(args?.method || 'GET').toUpperCase();
            if (READ.has(m))
                return { verdict: 'allow' };
            return { verdict: 'ask', noAlways: true, reason: (args?.reason ? args.reason + ' — ' : '') + 'действие во внешнем сервисе: ' + m + ' ' + (args?.url || '') };
        },
        async run(args, ctx) {
            const method = String(args.method || 'GET').toUpperCase();
            let headers = { Accept: 'application/json, text/plain, */*', 'User-Agent': 'ODANT-WORK/1.0' };
            let base = '';
            if (args.connection) {
                const a = await C.authHeaders(uidOf(ctx), String(args.connection));
                headers = { ...headers, ...a.headers };
                base = a.base_url || '';
            }
            for (const [k, v] of Object.entries(args.headers || {}))
                if (!/^authorization$/i.test(k))
                    headers[k] = String(v);
            let href = String(args.url || '');
            if (!/^https?:\/\//i.test(href)) {
                if (!base)
                    throw new Error('относительный url без подключения — укажи полный адрес');
                href = base.replace(/\/+$/, '') + '/' + href.replace(/^\/+/, '');
            }
            const url = C.assertPublicUrl(href);
            for (const [k, v] of Object.entries(args.query || {}))
                url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
            let body;
            if (args.body != null && !READ.has(method)) {
                if (typeof args.body === 'string')
                    body = args.body;
                else {
                    body = JSON.stringify(args.body);
                    headers['Content-Type'] ??= 'application/json; charset=utf-8';
                }
            }
            if (ctx.entry)
                ctx.entry.url = url.origin + url.pathname;
            const res = await fetch(url, {
                method, headers, body, redirect: 'follow',
                signal: ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
            });
            const text = await res.text();
            let data = text;
            try {
                data = JSON.parse(text);
            }
            catch { /* не JSON */ }
            if (!res.ok)
                return { error: 'HTTP ' + res.status + ': ' + clip(typeof data === 'string' ? data : JSON.stringify(data), 1500) };
            return 'HTTP ' + res.status + '\n' + clip(typeof data === 'string' ? data : JSON.stringify(data, null, 2), 20000);
        },
    },
    {
        name: 'disconnect_service',
        risk: 'danger',
        description: 'Удалить подключение аккаунта (токены будут забыты).',
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        permission: args => ({ verdict: 'ask', noAlways: true, reason: 'отключить «' + args?.name + '»' }),
        async run(args, ctx) {
            await C.remove(uidOf(ctx), String(args.name));
            return 'отключено: ' + args.name;
        },
    },
];
