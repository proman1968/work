/**
 * Действия во внешних сервисах от имени пользователя:
 *   connections      — какие аккаунты подключены (без секретов);
 *   connect_service  — попросить человека подключить аккаунт (вход/регистрация — только им, в карточке);
 *   http_request     — запрос к API (с подключением или публичный). Чтение (GET) — без вопросов,
 *                      любое изменение (POST/PUT/PATCH/DELETE) — всегда с явным подтверждением, без «разрешить всегда»;
 *   disconnect_service — удалить подключение (с подтверждением).
 */
import { log } from '../log.js';
import * as C from '../connections.js';
import { clip } from '../util.js';
import { urlCarriesData } from '../taint.js';
import { guardedRequest } from '../../../host/net-guard.js';
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
        description: 'Подключённые аккаунты пользователя во внешних сервисах и каталог готовых коннекторов (Google, Яндекс, Microsoft, GitHub, GitLab, Slack, Telegram, HubSpot, Битрикс24, amoCRM, Notion, API по токену). С параметром catalog=true или category показывает каталог готовых интеграций по категориям (mail, calendar, drive, messenger, crm, code, custom).',
        parameters: {
            type: 'object',
            properties: {
                catalog: { type: 'boolean', description: 'Показать каталог готовых коннекторов' },
                category: { type: 'string', enum: C.CATEGORIES, description: 'Фильтр каталога: mail | calendar | drive | messenger | crm | code | custom' },
            },
        },
        async run(args, ctx) {
            const list = await C.list(uidOf(ctx));
            const connectedText = list.length
                ? list.map(c => '- ' + c.name + ' — ' + c.label + (c.base_url ? ', API ' + c.base_url : '') + (c.scopes?.length ? ', доступ: ' + c.scopes.join(' ') : '') + (c.expires ? ', токен до ' + c.expires + (c.refreshable ? ' (обновляется)' : '') : '')).join('\n')
                : 'Подключений нет. Для действий в сервисе попроси подключение: connect_service.';
            if (!args?.catalog && !args?.category)
                return connectedText;
            const cat = C.catalog(args.category);
            const catLines = cat.map(p => '- ' + p.provider + ' (' + p.label + ') [' + p.categories.join(', ') + '] — вход: ' + p.auth
                + (p.base_url ? ', API: ' + p.base_url : '')
                + (p.scopes.length ? ', доступы: ' + p.scopes.join(', ') : '')
                + (p.docs ? ', док: ' + p.docs : ''));
            return 'Подключено:\n' + connectedText + '\n\nКаталог готовых подключений' + (args.category ? ' (' + args.category + ')' : '') + ':\n' + (catLines.join('\n') || 'пусто');
        },
    },
    {
        name: 'connect_service',
        planSafe: true,
        outbound: true, // подключение аккаунта по подсказке из внешнего содержимого — только с подтверждением (taint.js)
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
        untrusted: true,
        outbound: args => !READ.has(String(args?.method || 'GET').toUpperCase()) || urlCarriesData(args),
        description: 'Запрос к API внешнего сервиса. connection — подключённый аккаунт (авторизация подставится сама), url — полный или путь от base_url подключения. Пример Google Calendar: POST /calendar/v3/calendars/primary/events. Любое изменение (не GET) пользователь подтверждает явно — опиши в reason, что именно сделаешь. GET с данными в адресе (длинные или текстовые параметры) — тоже с подтверждения.',
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
            if (READ.has(m)) {
                // чтение, но адрес уносит данные контекста — человек должен видеть, что уходит (8.2)
                if (urlCarriesData(args))
                    return { verdict: 'ask', noAlways: true, reason: 'в адресе запроса уходят данные (параметры URL): ' + String(args?.url || '') };
                return { verdict: 'allow' };
            }
            return { verdict: 'ask', noAlways: true, reason: (args?.reason ? args.reason + ' — ' : '') + 'действие во внешнем сервисе: ' + m + ' ' + (args?.url || '') };
        },
        async run(args, ctx) {
            const method = String(args.method || 'GET').toUpperCase();
            let headers = { Accept: 'application/json, text/plain, */*', 'User-Agent': 'ODANT-WORK/1.0' };
            let base = '';
            // заголовки подключения (авторизация, свой заголовок токена) не должны уходить на чужой домен при редиректе
            let sensitiveHeaders = [];
            if (args.connection) {
                const a = await C.authHeaders(uidOf(ctx), String(args.connection));
                headers = { ...headers, ...a.headers };
                sensitiveHeaders = Object.keys(a.headers || {});
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
            else if (args.connection) {
                // авторизация подключения не покидает его адрес: абсолютный url — только origin подключения
                const baseOrigin = base ? new URL(base).origin : null;
                if (!baseOrigin || new URL(href).origin !== baseOrigin)
                    throw new Error('запрос с connection — только на адрес подключения' + (baseOrigin ? ' (' + baseOrigin + ')' : '')
                        + '; для другого адреса вызывай http_request без connection');
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
            // каждый переход (и сам адрес) проверяется по DNS, IP закрепляется; редиректы — вручную (net-guard)
            const res = await guardedRequest(url.href, {
                method, headers, body, sensitiveHeaders,
                maxRedirects: 5, maxBytes: 5 * 1024 * 1024, timeoutMs: 30000,
                signal: ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
            });
            const text = res.body.toString('utf-8');
            let data = text;
            try {
                data = JSON.parse(text);
            }
            catch (e) { log.debug('connect.json', e); /* не JSON */ }
            const moved = res.redirects ? ' (после перенаправления: ' + new URL(res.url).origin + new URL(res.url).pathname + ')' : '';
            if (res.status < 200 || res.status >= 300)
                return { error: 'HTTP ' + res.status + moved + ': ' + clip(typeof data === 'string' ? data : JSON.stringify(data), 1500) };
            return 'HTTP ' + res.status + moved + '\n' + clip(typeof data === 'string' ? data : JSON.stringify(data, null, 2), 20000);
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
    {
        name: 'a2a_call',
        risk: 'danger',
        untrusted: true,
        outbound: args => String(args?.action || 'send') !== 'discover' || urlCarriesData(args),
        description: 'Общение с агентами других систем по протоколу A2A (Agent-to-Agent, 9.9): discover — прочитать карточку внешнего агента (/.well-known/agent.json); send — отправить поручение внешнему агенту (JSON-RPC tasks/send) и получить ответ. Отправка поручения всегда с подтверждения человека; ответ помечается как внешние данные.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['discover', 'send'], description: 'discover (карточка агента) | send (отправить поручение)' },
                url: { type: 'string', description: 'Адрес внешнего агента (https://…)' },
                prompt: { type: 'string', description: 'Текст поручения внешнему агенту (для action=send)' },
                connection: { type: 'string', description: 'Имя подключения из connections для авторизации (необязательно)' },
                reason: { type: 'string', description: 'Зачем обращаемся к внешнему агенту (для подтверждения человеком)' },
            },
            required: ['action', 'url'],
        },
        permission(args) {
            if (args?.action === 'discover') {
                if (urlCarriesData(args))
                    return { verdict: 'ask', noAlways: true, reason: 'в адресе запроса карточки A2A уходят данные: ' + String(args?.url || '') };
                return { verdict: 'allow' };
            }
            return {
                verdict: 'ask',
                noAlways: true,
                reason: (args?.reason ? args.reason + ' — ' : '') + 'поручение внешнему агенту (A2A): ' + String(args?.url || ''),
            };
        },
        async run(args, ctx) {
            let headers = { Accept: 'application/json', 'User-Agent': 'ODANT-WORK-A2A/1.0' };
            let sensitiveHeaders = [];
            let base = '';
            if (args.connection) {
                const a = await C.authHeaders(uidOf(ctx), String(args.connection));
                headers = { ...headers, ...a.headers };
                sensitiveHeaders = Object.keys(a.headers || {});
                base = a.base_url || '';
            }
            let href = String(args.url || '').trim();
            if (!/^https?:\/\//i.test(href)) {
                if (!base)
                    throw new Error('a2a_call: укажи полный http(s) URL или connection с base_url');
                href = base.replace(/\/+$/, '') + '/' + href.replace(/^\/+/, '');
            }
            else if (args.connection) {
                const baseOrigin = base ? new URL(base).origin : null;
                if (!baseOrigin || new URL(href).origin !== baseOrigin)
                    throw new Error('a2a_call: запрос с connection — только на адрес подключения' + (baseOrigin ? ' (' + baseOrigin + ')' : ''));
            }
            const targetUrl = C.assertPublicUrl(href);
            const sig = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
            if (args.action === 'discover') {
                const cardUrl = targetUrl.pathname.endsWith('.json')
                    ? targetUrl.href
                    : targetUrl.origin + '/.well-known/agent.json';
                if (ctx.entry)
                    ctx.entry.url = cardUrl;
                const res = await guardedRequest(cardUrl, { method: 'GET', headers, sensitiveHeaders, maxRedirects: 3, maxBytes: 1024 * 1024, timeoutMs: 20000, signal: sig });
                if (res.status < 200 || res.status >= 300)
                    return { error: 'A2A discover HTTP ' + res.status };
                const card = JSON.parse(res.body.toString('utf-8'));
                const skills = Array.isArray(card.skills) ? card.skills.map(s => s.name || s.id).filter(Boolean).join(', ') : '';
                return 'Карточка A2A-агента «' + (card.name || targetUrl.host) + '»:\n'
                    + (card.description ? card.description + '\n' : '')
                    + 'URL: ' + (card.url || targetUrl.origin + '/a2a')
                    + (skills ? '\nНавыки: ' + skills : '');
            }
            const promptText = String(args.prompt || '').trim();
            if (!promptText)
                throw new Error('a2a_call: для action=send нужен непустой prompt');
            const rpcUrl = targetUrl.pathname === '/' || targetUrl.pathname === '' ? targetUrl.origin + '/a2a' : targetUrl.href;
            if (ctx.entry)
                ctx.entry.url = rpcUrl;
            const rpcBody = JSON.stringify({
                jsonrpc: '2.0',
                id: 'a2a-' + Date.now(),
                method: 'tasks/send',
                params: {
                    id: 'task-' + Date.now(),
                    message: { role: 'user', parts: [{ type: 'text', text: promptText }] },
                },
            });
            const res = await guardedRequest(rpcUrl, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
                body: rpcBody,
                sensitiveHeaders,
                maxRedirects: 2,
                maxBytes: 2 * 1024 * 1024,
                timeoutMs: 60000,
                signal: sig,
            });
            const raw = res.body.toString('utf-8');
            if (res.status < 200 || res.status >= 300)
                return { error: 'A2A HTTP ' + res.status + ': ' + clip(raw, 1000) };
            let rpc;
            try {
                rpc = JSON.parse(raw);
            }
            catch {
                return clip(raw, 10000);
            }
            if (rpc?.error)
                return { error: 'A2A error: ' + (rpc.error.message || JSON.stringify(rpc.error)) };
            const task = rpc?.result || rpc;
            const state = task?.status?.state || 'unknown';
            const parts = task?.status?.message?.parts || task?.artifacts?.flatMap(a => a.parts || []) || [];
            const text = parts.filter(p => p?.type === 'text' || p?.text).map(p => p.text).join('\n').trim();
            return 'A2A [' + state + ']:\n' + clip(text || JSON.stringify(task, null, 2), 15000);
        },
    },
];
