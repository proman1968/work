/**
 * Сессия задачи (.task, версия 2) — тонкий хост ленты для цикла агента.
 *
 * Тело файла (JSON):
 *   { type:'task', version:2, name, title, created, model, effort, mode:'auto'|'ask'|'plan',
 *     status:'idle'|'running'|'waiting'|'stopped'|'error'|'limit',
 *     items:[…лента, см. loop.js…], todos:[{content,status}], allowed:[имена инструментов],
 *     waiting?:{ kind:'approval'|'question', item, call } }
 *
 * Состояние выполнения — в памяти процесса по файлу: AbortController, ожидания человека,
 * замок (одна петля на файл). Лента на диске — всегда целостна (атомарная запись),
 * поэтому рестарт сервера не теряет работу: незакрытые вызовы помечаются interrupted,
 * ожидание подтверждения/ответа принимается и после рестарта.
 *
 * События в UI (session.send): chat.start / chat.done (занятость), task.state { status },
 * task.delta { item, field, token } (стрим), { path } — файл изменился (перечитать).
 */
import { runLoop, maybeCompact } from './loop.js';
import { createEnv, llmFor } from './index.js';
import { genId } from './util.js';

const RUNS = new Map();
const MODES = ['auto', 'ask', 'plan'];

function stateOf(file) {
    const key = file.dir || file.path;
    let s = RUNS.get(key);
    if (!s)
        RUNS.set(key, s = { key, body: null, controller: null, waiters: new Map(), running: null, writing: null, again: false });
    s.file = file;
    return s;
}

/** Нормализация тела; v1 (старый движок) → v2 одноразово. */
export function normalizeBody(raw) {
    const body = raw && typeof raw === 'object' ? raw : {};
    if (body.version !== 2) {
        const legacy = Array.isArray(body.items) && body.items.length && !body.version;
        const items = legacy ? migrateLegacy(body.items) : (Array.isArray(body.items) ? body.items : []);
        for (const k of ['using_blocks', 'goal', 'skill', 'todo', 'halt', 'waiting', 'system', 'pursue'])
            delete body[k];
        body.items = items;
        body.version = 2;
        if (legacy)
            body.legacy = true;
    }
    body.type = 'task';
    body.items ??= [];
    body.todos ??= [];
    body.allowed ??= [];
    if (!MODES.includes(body.mode))
        body.mode = body.mode === 'build' || body.mode === 'do' ? 'auto' : 'auto';
    body.status ??= 'idle';
    return body;
}

function migrateLegacy(blocks) {
    const out = [];
    const walk = (list, depth) => {
        for (const b of list || []) {
            if (!b || b.hidden)
                continue;
            if (b.type === 'prompt' && depth === 0) {
                out.push({ id: b.id || genId(), type: 'user', time: b.time || Date.now(), content: String(b.content || '') });
                continue;
            }
            if (b.content && !b.ignore) {
                const head = b.label && depth > 0 ? '**' + b.label + '**\n\n' : '';
                out.push({ id: b.id || genId(), type: 'assistant', time: b.time || Date.now(), content: head + String(b.content), legacy: b.type, error: b.error || undefined });
            }
            if (Array.isArray(b.items))
                walk(b.items, depth + 1);
        }
    };
    walk(blocks, 0);
    return out;
}

/** Тело: в работе — из памяти, иначе с диска (его могли поменять снаружи). */
export async function getBody(file) {
    const s = stateOf(file);
    if (s.running && s.body)
        return s.body;
    let raw = '';
    try {
        raw = String(await file.load({ encoding: 'utf-8' }) ?? '');
    }
    catch { /* нового файла ещё нет */ }
    let parsed = {};
    try {
        parsed = raw.trim() ? JSON.parse(raw) : {};
    }
    catch {
        parsed = { items: [{ id: genId(), type: 'error', time: Date.now(), content: 'Файл задачи повреждён (не JSON) — начата новая лента.' }] };
    }
    s.body = normalizeBody(parsed);
    return s.body;
}

/** Атомарная запись (tmp + rename), с коалесцированием частых сохранений. */
async function save(s, session) {
    if (s.writing) {
        s.again = true;
        return s.writing;
    }
    s.writing = (async () => {
        do {
            s.again = false;
            s.body.updated = Date.now();
            const text = JSON.stringify(s.body, null, 2);
            const dir = s.file.dir;
            const tmp = dir + '.tmp';
            try {
                await WORK.fsp.writeFile(tmp, text, 'utf-8');
                try {
                    await WORK.fsp.rename(tmp, dir);
                }
                catch {
                    await WORK.fsp.unlink(dir).catch(() => {});
                    await WORK.fsp.rename(tmp, dir);
                }
            }
            catch {
                await WORK.fsp.writeFile(dir, text, 'utf-8');
            }
            try {
                s.file.reset?.();
            }
            catch { /* кэш файла */ }
        } while (s.again);
    })();
    try {
        await s.writing;
    }
    finally {
        s.writing = null;
    }
    session?.send?.({ path: s.file.short });
}

function send(s, session, event) {
    session?.send?.({ ...event, path: s.file.short });
}

function setStatus(s, session, status) {
    s.body.status = status;
    send(s, session, { type: 'task.state', status });
}

function findCall(items, callId) {
    for (const it of items || []) {
        for (const t of it.tools || []) {
            if (t.id === callId)
                return { entry: t, item: it };
            const deep = findCall(t.items, callId);
            if (deep)
                return deep;
        }
    }
    return null;
}

/** Работа короче — без push о завершении (человек, скорее всего, ещё смотрит). */
export const PUSH_DONE_MIN_MS = 20_000;

/**
 * Push пользователю: задача ждёт его / закончила долгую работу / упала.
 * Показывать ли — решает service worker: если вкладка WORK видима и в фокусе, уведомление не показывается.
 */
async function pushNotify(s, session, kind, text) {
    const uid = session?.uid;
    if (!uid || process.env.WORK_TEST)
        return;
    const title = { waiting: 'Задача ждёт вас', done: 'Задача выполнена', error: 'Задача прервана ошибкой' }[kind] || 'Задача';
    const name = String(s.body?.title || s.body?.name || 'Задача').slice(0, 80);
    const path = String(s.file.path || '');
    const url = encodeURI(path + '/~/handlers//form/index.html');
    try {
        const { sendPushNotification, removePushSubscription } = await import('../../host/push.js');
        await sendPushNotification({
            receivers: [uid],
            message: {
                type: 'task:' + path, tag: 'task:' + path, title,
                body: name + (text ? '\n' + String(text).replace(/\s+/g, ' ').slice(0, 160) : ''),
                data: { url, kind: 'task' },
                requireInteraction: kind === 'waiting',
                renotify: kind === 'waiting',
            },
        }, removePushSubscription);
    }
    catch (e) {
        console.warn('[task push]', e.message);
    }
}

function lastAnswer(body) {
    const it = [...(body.items || [])].reverse().find(i => i.type === 'assistant' && i.content && !i.error);
    return String(it?.content || '').split('\n').find(l => l.trim()) || '';
}

function makeHost(s, session) {
    const body = s.body;
    return {
        get mode() { return body.mode; },
        get signal() { return s.controller?.signal; },
        allowed: {
            has: n => body.allowed.includes(n),
            add: n => { if (!body.allowed.includes(n)) body.allowed.push(n); },
        },
        save: () => save(s, session),
        emit: e => send(s, session, { ...e, type: 'task.delta' }),
        setTodos: todos => { body.todos = todos; },
        /** Очередь реплик, пришедших во время работы: цикл забирает их между ходами. */
        takeQueue: () => {
            const q = body.queue || [];
            delete body.queue;
            return q;
        },
        /** Состав контекста последнего хода (оценка): лимит модели, system, схемы инструментов, диалог. */
        noteContext: c => { body.context = { ...c, time: Date.now() }; },
        wait: req => {
            body.waiting = { kind: req.kind, item: req.item, call: req.call };
            setStatus(s, session, 'waiting');
            send(s, session, { type: 'chat.done' });
            const p = new Promise(resolve => s.waiters.set(req.call, resolve));
            save(s, session);
            const hit = findCall(body.items, req.call)?.entry;
            pushNotify(s, session, 'waiting', req.kind === 'question' ? req.question
                : req.kind === 'connect' ? 'подключить ' + (hit?.connect?.label || hit?.connect?.provider || 'сервис')
                    : 'разрешить: ' + (req.reason || req.tool || ''));
            return p.then(res => {
                delete body.waiting;
                if (!s.controller?.signal.aborted) {
                    setStatus(s, session, 'running');
                    send(s, session, { type: 'chat.start' });
                }
                return res;
            });
        },
    };
}

/** Роль задачи по месту её файла: `<метапапка>/<РОЛЬ>/…/x.task` → РОЛЬ; вне зон — null. */
export function taskRole(file) {
    try {
        const point = file.$owner || file.$class;
        const area = point?.areaOf?.(file);
        return area?.kind === 'zone' ? area.role : null;
    }
    catch {
        return null;
    }
}

/** Запуск петли (фоном). Возвращает сразу; ход работы — событиями и сохранениями. */
function start(s, session, file) {
    const body = s.body;
    s.controller = new AbortController();
    s.startedAt = Date.now();
    setStatus(s, session, 'running');
    send(s, session, { type: 'chat.start' });
    const host = makeHost(s, session);
    s.running = (async () => {
        try {
            const place = file.$class || file.$owner || null;
            // роль задачи — зона, в которой лежит .task (её создали, работая в этой роли; клиент подменить не может)
            body.role = taskRole(file) || body.role;
            const env = await createEnv({ place, session, host, tz: body.tz, location: body.location, role: body.role });
            const model = body.model || await env.defaultModel();
            body.model = model;
            const llm = await llmFor(model);
            const res = await runLoop({
                llm,
                system: () => env.makeSystem(),
                items: body.items,
                tools: await env.makeTools(),
                host,
                ctx: { session, place, env, task: file, tz: body.tz, role: body.role },
                loadImage: env.loadImage,
                effort: body.effort,
                maxTurns: Number(env.config.maxTurns) || undefined,
            });
            body.status = res.status === 'done' ? 'idle' : res.status;
        }
        catch (e) {
            if (!e?.reported)
                body.items.push({ id: genId(), type: 'error', time: Date.now(), content: String(e?.message || e) });
            body.status = 'error';
        }
        finally {
            delete body.waiting;
            s.waiters.clear();
            const aborted = !!s.controller?.signal.aborted;
            s.controller = null;
            // реплики, пришедшие под конец (или при стопе), не теряются: в ленту; без стопа — новый прогон
            const rest = body.queue || [];
            delete body.queue;
            for (const u of rest)
                body.items.push({ ...u, queued: undefined });
            if (rest.length && !aborted && body.status !== 'error') {
                await save(s, session);
                s.running = null;
                start(s, session, file);
                return;
            }
            await save(s, session);
            s.running = null;
            send(s, session, { type: 'task.state', status: body.status });
            send(s, session, { type: 'chat.done' });
            if (!aborted && body.status === 'error')
                pushNotify(s, session, 'error', [...body.items].reverse().find(i => i.type === 'error' || i.error)?.content);
            else if (!aborted && body.status === 'idle' && Date.now() - s.startedAt >= PUSH_DONE_MIN_MS)
                pushNotify(s, session, 'done', lastAnswer(body));
        }
    })();
    return s.running;
}

/** Ожидание, пережившее рестарт: ответ применяется к ленте без живого waiter. */
function applyOffline(body, reply) {
    const w = body.waiting;
    delete body.waiting;
    if (!w)
        return false;
    const hit = findCall(body.items, w.call);
    if (!hit)
        return false;
    const { entry } = hit;
    if (w.kind === 'question') {
        entry.status = 'ok';
        if (reply.values) {
            entry.values = reply.values;
            entry.result = 'Ответ (форма):\n' + Object.entries(reply.values).map(([k, v]) => '- ' + k + ': ' + v).join('\n');
        }
        else {
            entry.answer = String(reply.content || '');
            entry.result = 'Ответ человека: ' + entry.answer;
        }
        return true;
    }
    if (reply.accept) {
        entry.status = 'approved';
        if (reply.always && !entry.noAlways && !body.allowed.includes(entry.name))
            body.allowed.push(entry.name);
    }
    else {
        entry.status = 'denied';
        if (reply.content)
            entry.answer = String(reply.content);
    }
    return true;
}

/**
 * Сообщение человека. Идёт работа: ответ на вопрос/отказ с комментарием на подтверждение,
 * иначе «занят». Нет работы: реплика в ленту и запуск.
 */
export async function prompt(file, params = {}) {
    params = argsOf(params);
    const s = stateOf(file);
    const session = params.session;
    const body = await getBody(file);
    const text = String(params.prompt ?? params.post?.prompt ?? params.text ?? '').trim();
    const attachments = normAttachments(params.attachments ?? params.post?.attachments ?? params.includes ?? params.post?.includes);
    if (s.running) {
        const w = body.waiting;
        if (w && s.waiters.has(w.call)) {
            const resolve = s.waiters.get(w.call);
            s.waiters.delete(w.call);
            resolve(w.kind === 'question' ? { content: text } : { accept: false, content: text });
            return { ok: true, answered: w.kind };
        }
        if (!text && !attachments.length)
            return { ok: false, busy: true, error: 'задача выполняется' };
        // реплика во время работы — в очередь: агент получит её между шагами
        (body.queue ??= []).push({ id: genId(), type: 'user', time: Date.now(), content: text, queued: true, ...(attachments.length ? { attachments } : {}) });
        await save(s, session);
        return { ok: true, queued: true };
    }
    if (body.waiting) {
        // ожидание пережило рестарт: текст — ответ на вопрос или отказ с комментарием
        const w = body.waiting;
        applyOffline(body, w.kind === 'question' ? { content: text } : { accept: false, content: text });
    }
    else if (text || attachments.length) {
        body.items.push({ id: genId(), type: 'user', time: Date.now(), content: text, ...(attachments.length ? { attachments } : {}) });
        if (!body.title)
            body.title = text.split('\n')[0].slice(0, 80);
    }
    if (params.location && typeof params.location === 'object')
        body.location = params.location;
    if (params.tz || params.location?.tz)
        body.tz = String(params.tz || params.location.tz);
    if (params.mode && MODES.includes(params.mode))
        body.mode = params.mode;
    if (params.model)
        body.model = params.model;
    start(s, session, file);
    return { ok: true };
}

/** Аргументы HTTP: query + тело POST (JSON-строка или объект). Query побеждает. */
function argsOf(params = {}) {
    let post = params.post;
    if (typeof post === 'string' || Buffer.isBuffer?.(post)) {
        try {
            post = JSON.parse(String(post));
        }
        catch {
            post = null;
        }
    }
    const out = { ...(post && typeof post === 'object' && !Array.isArray(post) ? post : {}), ...params };
    delete out.post;
    if (typeof out.values === 'string') {
        try {
            out.values = JSON.parse(out.values);
        }
        catch { /* строка */ }
    }
    return out;
}

function normAttachments(list) {
    if (!list)
        return [];
    if (typeof list === 'string') {
        try {
            list = JSON.parse(list);
        }
        catch { /* одиночный путь */ }
    }
    const arr = Array.isArray(list) ? list : [list];
    return arr.map(a => typeof a === 'string' ? { path: a, name: a.split('/').pop() } : a).filter(a => a?.path);
}

/** Подтверждение вызова / ответ формой. { call, accept, always, content, values } */
export async function approve(file, params = {}) {
    const s = stateOf(file);
    const p = argsOf(params);
    const body = await getBody(file);
    const call = p.call || body.waiting?.call;
    const reply = {
        accept: p.accept === true || p.accept === 'true',
        always: p.always === true || p.always === 'true',
        content: p.content,
        values: p.values && typeof p.values === 'object' ? p.values : undefined,
    };
    if (call && s.waiters.has(call)) {
        const resolve = s.waiters.get(call);
        s.waiters.delete(call);
        resolve(reply);
        return { ok: true };
    }
    if (s.running)
        return { ok: false, error: 'нет ожидания ' + call };
    if (!applyOffline(body, reply))
        return { ok: false, error: 'нет ожидания' };
    start(s, p.session, file);
    return { ok: true, resumed: true };
}

/** Стоп: оборвать стрим/инструмент, снять ожидания. */
export async function stop(file, params = {}) {
    const s = stateOf(file);
    const body = await getBody(file);
    if (s.controller) {
        s.controller.abort();
        for (const resolve of s.waiters.values())
            resolve({ stopped: true });
        s.waiters.clear();
        await s.running?.catch?.(() => {});
    }
    else if (body.waiting) {
        const hit = findCall(body.items, body.waiting.call);
        if (hit)
            hit.entry.status = 'interrupted';
        delete body.waiting;
    }
    body.status = 'stopped';
    await save(s, params.session);
    send(s, params.session, { type: 'task.state', status: 'stopped' });
    send(s, params.session, { type: 'chat.done' });
    return { ok: true, stopped: true };
}

/** Откат ленты к реплике id (она и всё после удаляются; текст — назад в поле ввода). */
export async function revert(file, params = {}) {
    params = argsOf(params);
    const s = stateOf(file);
    const id = params.id ?? params.post?.id;
    if (!id)
        return { ok: false, error: 'id required' };
    if (s.running)
        await stop(file, params);
    const body = await getBody(file);
    const idx = body.items.findIndex(i => i.id === id);
    if (idx < 0)
        return { ok: false, error: 'элемент не найден' };
    const removed = body.items.splice(idx);
    // сжатые элементы до точки отката снова живые, если сводка ушла
    if (removed.some(i => i.type === 'summary') && !body.items.some(i => i.type === 'summary'))
        for (const it of body.items)
            delete it.compacted;
    body.todos = lastTodos(body.items);
    delete body.waiting;
    body.status = 'idle';
    await save(s, params.session);
    const first = removed[0];
    return {
        ok: true,
        prompt: first?.type === 'user' ? String(first.content || '') : '',
        attachments: first?.attachments || [],
    };
}

function lastTodos(items) {
    for (let i = items.length - 1; i >= 0; i--) {
        const t = [...(items[i].tools || [])].reverse().find(x => x.name === 'todo_write' && x.status === 'ok');
        if (t)
            return (t.args?.todos || []).map(x => ({ content: String(x.content), status: x.status }));
    }
    return [];
}

/**
 * Подключение аккаунта из карточки connect_service (данные вводит человек, в ленту не пишутся):
 * { call, origin, client_id?, client_secret?, token?, base_url? } → { auth_url } (окно входа) | { ok } (токен сохранён).
 * По завершении входа (OAuth callback) ожидание вызова снимается с accept:true — агент продолжает.
 */
export async function connectStart(file, params = {}) {
    const p = argsOf(params);
    const body = await getBody(file);
    const hit = findCall(body.items, p.call);
    const c = hit?.entry?.connect;
    if (!c || hit.entry.status !== 'waiting')
        return { ok: false, error: 'нет ожидающего подключения' };
    const C = await import('./connections.js');
    const done = () => approve(file, { call: p.call, accept: true, session: p.session }).catch(() => {});
    try {
        return await C.start({
            uid: p.session?.uid, name: c.name, provider: c.provider, scopes: c.scopes,
            base_url: p.base_url || c.base_url, token: p.token, header: p.header,
            client_id: p.client_id, client_secret: p.client_secret, origin: p.origin, onDone: done,
        });
    }
    catch (e) {
        return { ok: false, error: String(e.message || e) };
    }
}

/** Отменить реплику из очереди. { id } */
export async function unqueue(file, params = {}) {
    const p = argsOf(params);
    const s = stateOf(file);
    const body = await getBody(file);
    const before = (body.queue || []).length;
    body.queue = (body.queue || []).filter(u => u.id !== p.id);
    if (!body.queue.length)
        delete body.queue;
    await save(s, p.session);
    return { ok: (body.queue || []).length < before };
}

/** Настройки задачи: model / effort / mode. */
export async function configure(file, params = {}) {
    const s = stateOf(file);
    const p = argsOf(params);
    const body = await getBody(file);
    if (p.model)
        body.model = String(p.model);
    if (p.effort != null)
        body.effort = String(p.effort);
    if (p.mode != null) {
        if (!MODES.includes(p.mode))
            return { ok: false, error: 'mode: ' + MODES.join('|') };
        body.mode = p.mode;
    }
    await save(s, p.session);
    return { ok: true, model: body.model, effort: body.effort, mode: body.mode };
}

/** Принудительное сжатие контекста. */
export async function compact(file, params = {}) {
    const s = stateOf(file);
    if (s.running)
        return { ok: false, error: 'задача выполняется' };
    const body = await getBody(file);
    const place = file.$class || file.$owner || null;
    const host = { mode: body.mode, signal: undefined, save: () => save(s, params.session) };
    const env = await createEnv({ place, session: params.session, host });
    const llm = await llmFor(body.model || await env.defaultModel());
    const done = await maybeCompact({ llm, items: body.items, host, system: await env.makeSystem(), force: true });
    return { ok: done };
}

/** Для тестов/диагностики: дождаться окончания текущей петли. */
export async function idle(file) {
    const s = stateOf(file);
    while (s.running)
        await s.running.catch(() => {});
    return s.body;
}

export function isRunning(file) {
    return !!stateOf(file).running;
}
