/**
 * Протокол A2A (Agent-to-Agent) и REST/SDK для встраивания (9.9, экосистема интеграций):
 *   GET  /.well-known/agent.json — публичная карточка A2A-агента WORK (навыки/субагенты, версия, схема входа);
 *   POST /a2a                    — JSON-RPC 2.0 сервер A2A: методы tasks/send (и message/send), tasks/get, tasks/cancel;
 *   POST /api/agent              — REST-эндпоинт для встраивания в порталы/CRM ({ place, prompt, agent, mode });
 *   GET  /sdk/work-agent.js      — готовый JS SDK (WorkAgentClient + виджет чата без innerHTML) для браузера и Node.js.
 *
 * Безопасность:
 *   - Авторизация /a2a и /api/agent — только по персональному токену Bearer `wmcp.<uid>.<секрет>` (sources/modules/mcp/tokens.js);
 *   - Доступ только с localhost и частной сети (isLanAddress / clientAllowed), защита от перебора токенов (429 после 10 ошибок);
 *   - Права на целевой класс (place) проверяются ядром WORK от имени пользователя и роли токена (assertAccess read);
 *   - Входящее сообщение A2A от чужого агента оборачивается в <untrusted source="a2a:…"> (taint.js): инструкции из него
 *     не могут незаметно вызвать внешние/опасные действия;
 *   - Задачи A2A изолированы по владельцу (uid): прочитать (tasks/get) или отменить (tasks/cancel) чужую задачу нельзя;
 *   - Выключить точку: WORK_A2A=0.
 */
import { randomBytes } from 'node:crypto';
import { verifyToken } from '../mcp/tokens.js';
import { isLanAddress, clientAllowed, originAllowed } from '../mcp/server.js';
import { runOnce } from '../agent/index.js';
import { loadDocs } from '../agent/resources.js';
import { getItem, callAs } from '../agent/tools/work.js';
import { wrapUntrusted, newNonce } from '../agent/taint.js';
import { audit } from '../../server/access/audit.js';

const BODY_MAX = 1024 * 1024;
const MAX_PROMPT = 20000;
const TASK_TTL_MS = 60 * 60_000;
const MAX_TASKS_PER_USER = 50;
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 10 * 60_000;

/** Задачи A2A в памяти: id → { id, uid, place, createdAt, controller, snapshot }. */
const a2aTasks = new Map();
const failures = new Map();

const okRpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const failRpc = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function reply(response, status, body, headers = {}) {
    const isStr = typeof body === 'string';
    const text = body == null ? '' : (isStr ? body : JSON.stringify(body));
    response.writeHead(status, {
        'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
    });
    response.end(text);
}

async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const c of request) {
        size += c.length;
        if (size > BODY_MAX)
            throw Object.assign(new Error('тело запроса больше 1 МБ'), { status: 413 });
        chunks.push(c);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    }
    catch {
        throw Object.assign(new Error('Parse error'), { rpc: -32700, status: 400 });
    }
}

function throttled(ip) {
    const f = failures.get(ip);
    return !!f && f.n >= FAIL_LIMIT && Date.now() - f.at < FAIL_WINDOW_MS;
}

function noteFail(ip) {
    const f = failures.get(ip);
    if (!f || Date.now() - f.at > FAIL_WINDOW_MS)
        failures.set(ip, { n: 1, at: Date.now() });
    else
        f.n++;
}

async function coreSession(auth, ip) {
    const users = await globalThis.WORK?.$users;
    const $user = await users?.get_item?.('//' + auth.uid);
    if (!$user || Array.isArray($user))
        return null;
    return {
        ephemeral: true,
        ssid: 'a2a:' + auth.tokenId,
        sockets: {},
        uid: auth.uid,
        id: auth.uid,
        $user,
        role: auth.role || undefined,
        principal: Object.freeze({ kind: 'user', id: auth.uid }),
        ip,
        send() {},
    };
}

function gcTasks() {
    const now = Date.now();
    for (const [id, t] of a2aTasks)
        if (now - t.createdAt > TASK_TTL_MS)
            a2aTasks.delete(id);
}

/** Собрать карточку A2A-агента WORK (/.well-known/agent.json). */
export async function buildAgentCard(origin = 'http://localhost:8001') {
    const agentsMap = await loadDocs(null, 'agents').catch(() => new Map());
    const skills = [];
    for (const [id, doc] of agentsMap) {
        if (doc?.meta?.requires)
            continue; // системные субагенты наружу не рекламируем
        skills.push({
            id,
            name: id,
            description: String(doc?.meta?.description || id),
            tags: ['work', id],
        });
    }
    const base = String(origin || 'http://localhost:8001').replace(/\/+$/, '');
    return {
        name: globalThis.WORK?.label || 'WORK Agent',
        description: 'Агент системы управления организацией WORK (протокол A2A и REST API)',
        url: base + '/a2a',
        version: '1.0.0',
        protocolVersion: '0.2.1',
        capabilities: {
            streaming: false,
            pushNotifications: false,
            stateTransitionHistory: true,
        },
        authentication: {
            schemes: ['Bearer'],
        },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills,
    };
}

/** Извлечь текст из A2A message ({ parts: [{ type: 'text', text }] }) или строки. */
export function extractA2aText(params) {
    if (typeof params?.prompt === 'string' && params.prompt.trim())
        return params.prompt.trim();
    const parts = Array.isArray(params?.message?.parts) ? params.message.parts : [];
    const texts = parts
        .filter(p => p && (p.type === 'text' || p.kind === 'text' || typeof p.text === 'string'))
        .map(p => String(p.text || '').trim())
        .filter(Boolean);
    return texts.join('\n').trim();
}

/** Проверить сетевой доступ и Bearer-токен запроса. */
async function authenticateRequest(request, response) {
    if (!clientAllowed(request)) {
        reply(response, 403, { error: 'Доступ только с этого компьютера или локальной сети' });
        return null;
    }
    if (!originAllowed(request)) {
        reply(response, 403, { error: 'Недопустимый Origin' });
        return null;
    }
    const ip = String(request.socket?.remoteAddress || '');
    if (throttled(ip)) {
        reply(response, 429, { error: 'Слишком много неудачных попыток — подождите 10 минут' }, { 'Retry-After': '600' });
        return null;
    }
    const hdr = String(request.headers.authorization || '');
    const rawToken = /^Bearer\s+(\S+)$/i.exec(hdr)?.[1] || '';
    const auth = await verifyToken(rawToken);
    if (!auth) {
        noteFail(ip);
        await audit({ event: 'a2a_auth', outcome: 'invalid_token', ip });
        reply(response, 401, { error: 'Нужен действительный заголовок Authorization: Bearer <токен>' }, { 'WWW-Authenticate': 'Bearer realm="WORK"' });
        return null;
    }
    const session = await coreSession(auth, ip);
    if (!session) {
        noteFail(ip);
        reply(response, 401, { error: 'Пользователь токена не найден' });
        return null;
    }
    return { auth, session, ip };
}

/** Проверить доступ пользователя токена к месту (place) и вернуть элемент класса/папки. */
async function resolveAuthorizedPlace(placePath, session) {
    const p = String(placePath || '/').trim() || '/';
    const ctx = { session, role: session.role, place: globalThis.WORK };
    const item = p === '/' ? globalThis.WORK : await getItem(p, ctx);
    if (!item || Array.isArray(item))
        throw Object.assign(new Error('Место не найдено: ' + p), { code: -32004, status: 404 });
    await callAs(item, 'assertAccess', { level: 'read' }, ctx);
    return item;
}

/** Сформировать стандартный объект A2A Task. */
function makeTaskSnapshot(id, state, text) {
    return {
        id,
        status: {
            state,
            timestamp: new Date().toISOString(),
            message: {
                role: 'agent',
                parts: [{ type: 'text', text: String(text || '') }],
            },
        },
        artifacts: text
            ? [{ name: 'response', parts: [{ type: 'text', text: String(text) }] }]
            : [],
    };
}

/** Обработать JSON-RPC 2.0 запрос к /a2a. */
async function handleA2aRpc(request, response) {
    if (request.method !== 'POST') {
        reply(response, 405, { error: 'Метод не поддерживается (нужен POST)' }, { Allow: 'POST' });
        return;
    }
    const cred = await authenticateRequest(request, response);
    if (!cred)
        return;
    const { auth, session } = cred;

    let msg;
    try {
        msg = await readJson(request);
    }
    catch (e) {
        reply(response, e.status || 400, failRpc(null, e.rpc || -32700, e.message));
        return;
    }
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        reply(response, 400, failRpc(msg?.id, -32600, 'Invalid Request'));
        return;
    }

    gcTasks();
    const { id, method, params = {} } = msg;

    if (method === 'tasks/send' || method === 'message/send') {
        const text = extractA2aText(params);
        if (!text) {
            reply(response, 200, failRpc(id, -32602, 'Пустой запрос: передайте message.parts[{ type: "text", text }]'));
            return;
        }
        if (text.length > MAX_PROMPT) {
            reply(response, 200, failRpc(id, -32602, 'Слишком длинный запрос (' + text.length + ' > ' + MAX_PROMPT + ')'));
            return;
        }
        let place;
        try {
            place = await resolveAuthorizedPlace(params.metadata?.place || params.place || '/', session);
        }
        catch (e) {
            await audit({ event: 'a2a', action: method, outcome: 'deny', uid: auth.uid, role: auth.role, tokenId: auth.tokenId, target: String(params.metadata?.place || params.place || '/'), reason: e.message });
            reply(response, 200, failRpc(id, e.code || -32001, e.message || 'Доступ запрещён'));
            return;
        }
        const userTasks = [...a2aTasks.values()].filter(t => t.uid === auth.uid);
        if (userTasks.length >= MAX_TASKS_PER_USER)
            a2aTasks.delete(userTasks[0].id);

        const taskId = String(params.id || ('a2a-' + randomBytes(6).toString('hex')));
        const controller = new AbortController();
        const record = {
            id: taskId,
            uid: auth.uid,
            place: place.path || '/',
            createdAt: Date.now(),
            controller,
            snapshot: makeTaskSnapshot(taskId, 'working', ''),
        };
        a2aTasks.set(taskId, record);

        // Входящее сообщение от внешнего A2A-агента помечается как чужое содержимое (<untrusted>)
        const sender = String(params.metadata?.sender || 'external').replace(/[^\w.-]/g, '_').slice(0, 40) || 'external';
        const safePrompt = wrapUntrusted(text, 'a2a_' + sender, newNonce());
        const mode = ['auto', 'ask', 'plan'].includes(params.metadata?.mode) ? params.metadata.mode : 'auto';
        const agent = typeof params.metadata?.agent === 'string' && params.metadata.agent.trim() ? params.metadata.agent.trim() : undefined;
        const model = typeof params.metadata?.model === 'string' && params.metadata.model.trim() ? params.metadata.model.trim() : undefined;

        try {
            const res = await runOnce({
                place,
                session,
                role: session.role,
                prompt: safePrompt,
                agent,
                model,
                mode,
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)]),
            });
            const state = controller.signal.aborted || res.status === 'stopped'
                ? 'canceled'
                : (res.status === 'done' ? 'completed' : 'failed');
            record.snapshot = makeTaskSnapshot(taskId, state, res.content || '');
            record.controller = null;
            await audit({ event: 'a2a', action: method, outcome: state, uid: auth.uid, role: auth.role, tokenId: auth.tokenId, target: place.path || '/', taskId });
            reply(response, 200, okRpc(id, record.snapshot));
        }
        catch (e) {
            const state = controller.signal.aborted ? 'canceled' : 'failed';
            record.snapshot = makeTaskSnapshot(taskId, state, String(e?.message || e));
            record.controller = null;
            await audit({ event: 'a2a', action: method, outcome: 'error', uid: auth.uid, role: auth.role, tokenId: auth.tokenId, target: place.path || '/', taskId, reason: String(e?.message || e).slice(0, 200) });
            reply(response, 200, okRpc(id, record.snapshot));
        }
        return;
    }

    if (method === 'tasks/get') {
        const taskId = String(params?.id || '');
        const rec = a2aTasks.get(taskId);
        if (!rec || rec.uid !== auth.uid) {
            reply(response, 200, failRpc(id, -32001, 'Задача не найдена или принадлежит другому пользователю'));
            return;
        }
        reply(response, 200, okRpc(id, rec.snapshot));
        return;
    }

    if (method === 'tasks/cancel') {
        const taskId = String(params?.id || '');
        const rec = a2aTasks.get(taskId);
        if (!rec || rec.uid !== auth.uid) {
            reply(response, 200, failRpc(id, -32001, 'Задача не найдена или принадлежит другому пользователю'));
            return;
        }
        rec.controller?.abort();
        rec.controller = null;
        rec.snapshot = makeTaskSnapshot(rec.id, 'canceled', 'Остановлено по запросу tasks/cancel');
        await audit({ event: 'a2a', action: 'tasks/cancel', outcome: 'canceled', uid: auth.uid, role: auth.role, tokenId: auth.tokenId, taskId });
        reply(response, 200, okRpc(id, rec.snapshot));
        return;
    }

    reply(response, 200, failRpc(id, -32601, 'Метод не найден: ' + method));
}

/** Обработать REST-запрос встраивания POST /api/agent. */
async function handleApiAgent(request, response) {
    if (request.method !== 'POST') {
        reply(response, 405, { error: 'Метод не поддерживается (нужен POST)' }, { Allow: 'POST' });
        return;
    }
    const cred = await authenticateRequest(request, response);
    if (!cred)
        return;
    const { auth, session } = cred;

    let body;
    try {
        body = await readJson(request);
    }
    catch (e) {
        reply(response, e.status || 400, { ok: false, error: e.message });
        return;
    }
    const prompt = String(body?.prompt || '').trim();
    if (!prompt) {
        reply(response, 400, { ok: false, error: 'Поле prompt обязательно' });
        return;
    }
    if (prompt.length > MAX_PROMPT) {
        reply(response, 400, { ok: false, error: 'Слишком длинный prompt (' + prompt.length + ' > ' + MAX_PROMPT + ')' });
        return;
    }
    let place;
    try {
        place = await resolveAuthorizedPlace(body?.place || '/', session);
    }
    catch (e) {
        await audit({ event: 'api_agent', action: 'prompt', outcome: 'deny', uid: auth.uid, role: auth.role, tokenId: auth.tokenId, target: String(body?.place || '/'), reason: e.message });
        reply(response, e.status || 403, { ok: false, error: e.message || 'Доступ запрещён' });
        return;
    }
    const mode = ['auto', 'ask', 'plan'].includes(body?.mode) ? body.mode : 'auto';
    const agent = typeof body?.agent === 'string' && body.agent.trim() ? body.agent.trim() : undefined;
    const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
    const id = 'api-' + randomBytes(6).toString('hex');
    try {
        const res = await runOnce({
            place,
            session,
            role: session.role,
            prompt,
            agent,
            model,
            mode,
            signal: AbortSignal.timeout(10 * 60_000),
        });
        await audit({ event: 'api_agent', action: 'prompt', outcome: res.status, uid: auth.uid, role: auth.role, tokenId: auth.tokenId, target: place.path || '/', id });
        reply(response, 200, { ok: res.status === 'done', id, status: res.status, content: res.content || '' });
    }
    catch (e) {
        await audit({ event: 'api_agent', action: 'prompt', outcome: 'error', uid: auth.uid, role: auth.role, tokenId: auth.tokenId, target: place.path || '/', id, reason: String(e?.message || e).slice(0, 200) });
        reply(response, 500, { ok: false, id, status: 'error', error: String(e?.message || e) });
    }
}

/** Клиентский SDK для встраивания WORK-агента и вызовов по REST/A2A (браузер и Node.js). */
export class WorkAgentClient {
    constructor({ baseUrl = '', token = '', fetchImpl } = {}) {
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this.token = String(token || '').trim();
        this.fetchImpl = fetchImpl || globalThis.fetch?.bind(globalThis);
    }

    _headers(extra = {}) {
        const h = { Accept: 'application/json', ...extra };
        if (this.token)
            h.Authorization = 'Bearer ' + this.token;
        return h;
    }

    async agentCard() {
        const r = await this.fetchImpl(this.baseUrl + '/.well-known/agent.json', {
            method: 'GET',
            headers: this._headers(),
        });
        if (!r.ok)
            throw new Error('HTTP ' + r.status);
        return r.json();
    }

    async prompt({ place = '/', prompt, agent, mode = 'auto', model } = {}) {
        const r = await this.fetchImpl(this.baseUrl + '/api/agent', {
            method: 'POST',
            headers: this._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ place, prompt, agent, mode, model }),
        });
        const data = await r.json();
        if (!r.ok || data?.ok === false)
            throw new Error(data?.error || ('HTTP ' + r.status));
        return data;
    }

    async a2aSend({ id, text, place = '/', agent, mode = 'auto', sender } = {}) {
        const r = await this.fetchImpl(this.baseUrl + '/a2a', {
            method: 'POST',
            headers: this._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: id || ('rpc-' + Date.now()),
                method: 'tasks/send',
                params: {
                    id: id || ('task-' + Date.now()),
                    message: { role: 'user', parts: [{ type: 'text', text: String(text || '') }] },
                    metadata: { place, agent, mode, sender },
                },
            }),
        });
        const data = await r.json();
        if (data?.error)
            throw new Error(data.error.message || 'A2A error');
        return data.result;
    }

    async a2aGet(taskId) {
        const r = await this.fetchImpl(this.baseUrl + '/a2a', {
            method: 'POST',
            headers: this._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ jsonrpc: '2.0', id: 'get-' + Date.now(), method: 'tasks/get', params: { id: taskId } }),
        });
        const data = await r.json();
        if (data?.error)
            throw new Error(data.error.message || 'A2A error');
        return data.result;
    }

    async a2aCancel(taskId) {
        const r = await this.fetchImpl(this.baseUrl + '/a2a', {
            method: 'POST',
            headers: this._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ jsonrpc: '2.0', id: 'cancel-' + Date.now(), method: 'tasks/cancel', params: { id: taskId } }),
        });
        const data = await r.json();
        if (data?.error)
            throw new Error(data.error.message || 'A2A error');
        return data.result;
    }

    /**
     * Встроить виджет чата в DOM-элемент container.
     * Все реплики и ответы выводятся строго через textContent (без innerHTML — защита от XSS).
     */
    mountWidget(container, { place = '/', agent, mode = 'auto', title = 'Помощник WORK', placeholder = 'Введите запрос…' } = {}) {
        const doc = container?.ownerDocument || globalThis.document;
        if (!doc || !container)
            throw new Error('mountWidget: нужен DOM-контейнер');
        const root = doc.createElement('div');
        root.className = 'work-agent-widget';
        const header = doc.createElement('div');
        header.className = 'work-agent-header';
        header.textContent = String(title);
        const logBox = doc.createElement('div');
        logBox.className = 'work-agent-messages';
        const form = doc.createElement('form');
        form.className = 'work-agent-form';
        const input = doc.createElement('input');
        input.type = 'text';
        input.placeholder = String(placeholder);
        const btn = doc.createElement('button');
        btn.type = 'submit';
        btn.textContent = 'Отправить';
        form.appendChild(input);
        form.appendChild(btn);
        root.appendChild(header);
        root.appendChild(logBox);
        root.appendChild(form);
        container.appendChild(root);

        const appendMsg = (role, text) => {
            const row = doc.createElement('div');
            row.className = 'work-agent-msg work-agent-msg-' + role;
            row.textContent = String(text ?? '');
            logBox.appendChild(row);
            return row;
        };

        const send = async text => {
            const q = String(text ?? input.value ?? '').trim();
            if (!q)
                return null;
            input.value = '';
            appendMsg('user', q);
            try {
                const res = await this.prompt({ place, prompt: q, agent, mode });
                appendMsg('agent', res.content || '');
                return res;
            }
            catch (e) {
                appendMsg('error', String(e?.message || e));
                return null;
            }
        };

        form.addEventListener?.('submit', ev => {
            ev?.preventDefault?.();
            send();
        });

        return { root, logBox, input, button: btn, send };
    }
}

export const SDK_SOURCE = `// ODANT WORK Agent SDK (ESM + global)\n`
    + WorkAgentClient.toString()
    + `\nif (typeof globalThis !== 'undefined') globalThis.WorkAgentClient = WorkAgentClient;\nexport default WorkAgentClient;\n`;

/**
 * HTTP-обработчик маршрутов A2A и SDK встраивания:
 *   GET  /.well-known/agent.json
 *   POST /a2a
 *   POST /api/agent
 *   GET  /sdk/work-agent.js
 */
export async function handleA2aHttp(request, response) {
    const rawPath = String(request.url || '').split('?')[0];
    if (process.env.WORK_A2A === '0') {
        reply(response, 404, 'A2A disabled');
        return true;
    }
    if (rawPath === '/.well-known/agent.json') {
        if (request.method !== 'GET') {
            reply(response, 405, { error: 'Нужен GET' }, { Allow: 'GET' });
            return true;
        }
        const proto = request.headers['x-forwarded-proto'] || 'http';
        const host = request.headers.host || 'localhost:8001';
        const card = await buildAgentCard(proto + '://' + host);
        reply(response, 200, card);
        return true;
    }
    if (rawPath === '/sdk/work-agent.js') {
        if (request.method !== 'GET') {
            reply(response, 405, 'Method Not Allowed', { Allow: 'GET' });
            return true;
        }
        reply(response, 200, SDK_SOURCE, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return true;
    }
    if (rawPath === '/a2a') {
        await handleA2aRpc(request, response);
        return true;
    }
    if (rawPath === '/api/agent') {
        await handleApiAgent(request, response);
        return true;
    }
    return false;
}

export { isLanAddress };
