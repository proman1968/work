/**
 * Серверный хаб и CDP-движок для настоящего Chrome пользователя через расширение MV3 (chrome_*):
 *   - Расширение подключается по WebSocket на `/~chrome` (только localhost/LAN) и авторизуется
 *     персональным токеном `wmcp.<uid>.<секрет>` в первом auth-кадре (никаких cookies,
 *     никаких токенов в URL, никакой фоновой утилиты в терминале).
 *   - Логика снимка (AX-дерево с `[ref]`), кликов, ввода текста и проверки доменов живёт здесь
 *     в одном месте на сервере, а расширение — тонкий транспорт поверх `chrome.debugger`.
 *   - Безопасность:
 *     * По умолчанию при подключении включён режим «только просмотр» (`readOnly: true`);
 *     * Реестр операций `CHROME_OPS` с явным булевым признаком `mutates` (fail-closed);
 *     * Домен-скоуп на задачу + проверка конечного URL после каждого перехода/клика (защита от редиректов);
 *     * Произвольный `Runtime.evaluate` запрещён жёстко (только фиксированные read-only выражения);
 *     * Агент работает только в своей сгруппированной вкладке; если человек закрыл или перехватил её —
 *       действие немедленно останавливается без переключения на чужие вкладки;
 *     * Все действия пишутся в аудит безопасности (`chrome_bridge`) без паролей, текста ввода и токенов.
 */
import { randomBytes } from 'node:crypto';
import { verifyToken } from '../mcp/tokens.js';
import { clientAllowed } from '../mcp/server.js';
import { audit } from '../../server/access/audit.js';
import { assertPageUrl } from '../agent/tools/browse.js';

const CMD_TIMEOUT_MS = 30_000;
const AUTH_TIMEOUT_MS = 5_000;
const HISTORY_MAX = 50;
const MAX_SNAPSHOT_CHARS = 9_000;
const MAX_SNAPSHOT_ITEMS = 400;

export const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
    'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'tab', 'spinbutton', 'slider', 'togglebutton',
]);

export const EXPR_LOCATION_HREF = 'location.href';
export const EXPR_DOCUMENT_TITLE = 'document.title';
export const EXPR_READY_STATE = 'document.readyState';

/** Разрешённые выражения для Runtime.evaluate — произвольный JS запрещён жёстко. */
export const ALLOWED_EVAL_EXPRS = new Set([
    EXPR_LOCATION_HREF,
    EXPR_DOCUMENT_TITLE,
    EXPR_READY_STATE,
]);

/** Белый список CDP-методов, которые сервер имеет право отправлять в расширение. */
export const ALLOWED_CDP_METHODS = new Set([
    'Accessibility.getFullAXTree',
    'DOM.scrollIntoViewIfNeeded',
    'DOM.getBoxModel',
    'DOM.focus',
    'Input.dispatchMouseEvent',
    'Input.insertText',
    'Input.dispatchKeyEvent',
    'Page.navigate',
    'Page.reload',
    'Page.getNavigationHistory',
    'Page.navigateToHistoryEntry',
    'Page.captureScreenshot',
    'Runtime.evaluate',
]);

/** Проверка безопасности CDP-вызова (белый список методов + запрет произвольного eval). */
export function assertSafeCdpCall(method, params = {}) {
    const m = String(method || '');
    if (!ALLOWED_CDP_METHODS.has(m))
        throw new Error('chrome: запрещённый метод CDP «' + m + '»');
    if (m === 'Runtime.evaluate') {
        const expr = String(params?.expression || '');
        if (!ALLOWED_EVAL_EXPRS.has(expr))
            throw new Error('chrome: произвольный Runtime.evaluate запрещён');
    }
}

/** Активные подключения Chrome по uid пользователя: uid → ChromeConn. */
const connections = new Map();

function recordChromeLog(conn, entry) {
    const item = { time: new Date().toISOString(), ...entry };
    conn.history.push(item);
    if (conn.history.length > HISTORY_MAX)
        conn.history.shift();
    audit('chrome_bridge', { uid: conn.uid, ...entry });
}

export function hostnameOf(rawUrl) {
    try {
        return new URL(String(rawUrl || '')).hostname.toLowerCase();
    }
    catch {
        return '';
    }
}

/** Проверка Origin при WS-подключении на `/~chrome`: расширение, без Origin или тот же хост (для тестов). */
export function chromeOriginAllowed(req) {
    const origin = String(req?.headers?.origin || '').trim();
    if (!origin)
        return true;
    if (/^(chrome|edge)-extension:\/\/[a-z0-9_-]+$/i.test(origin))
        return true;
    try {
        return new URL(origin).host.toLowerCase() === String(req?.headers?.host || '').trim().toLowerCase();
    }
    catch {
        return false;
    }
}

/** Построить карту интерактивных [ref] и читаемое дерево из Accessibility.getFullAXTree (как cdp.py). */
export function buildAxMap(nodes) {
    const refs = new Map();
    const items = [];
    let n = 0;
    for (const node of (Array.isArray(nodes) ? nodes : [])) {
        const role = String(node?.role?.value || '');
        const name = String(node?.name?.value || '');
        const val = String(node?.value?.value || '');
        const checked = String(node?.checked?.value || '').toLowerCase();
        if (INTERACTIVE_ROLES.has(role) && (name || role === 'textbox' || role === 'searchbox' || role === 'combobox')) {
            n += 1;
            refs.set(n, node);
            const state = role === 'checkbox' ? (checked === 'true' ? ' [x]' : ' [ ]') : '';
            items.push({
                ref: n,
                role,
                name,
                value: val,
                state,
                backend: node.backendDOMNodeId,
            });
        }
        else if ((role === 'heading' || role === 'StaticText' || role === 'image' || role === 'link') && name && items.length < MAX_SNAPSHOT_ITEMS) {
            items.push({ role, name: name.slice(0, 160) });
        }
    }
    return { refs, items };
}

/** Отформатировать текстовый снимок страницы в едином с cdp.py формате. */
export function formatSnapshotText(url, title, items) {
    const lines = ['Страница: ' + (title || '(без названия)') + ' — ' + (url || '')];
    for (const it of items) {
        if (it.ref != null) {
            const extra = it.value ? ('="' + it.value + '"') : '';
            lines.push('[' + it.ref + '] ' + it.role + ' "' + it.name + '"' + extra + (it.state || ''));
        }
        else {
            lines.push('    ' + it.role + ': "' + it.name + '"');
        }
    }
    return lines.join('\n').slice(0, MAX_SNAPSHOT_CHARS);
}

/** Реестр операций Chrome-моста с обязательным флагом mutates. */
export const CHROME_OPS = Object.freeze({
    status: Object.freeze({ mutates: false }),
    snapshot: Object.freeze({ mutates: false }),
    screenshot: Object.freeze({ mutates: false }),
    open: Object.freeze({ mutates: true }),
    click: Object.freeze({ mutates: true }),
    type: Object.freeze({ mutates: true }),
    nav: Object.freeze({ mutates: true }),
});

/** Проверка: изменяет ли операция браузер (неизвестная операция — fail-closed = true). */
export function isChromeMutatingOp(op) {
    const def = CHROME_OPS[String(op || '')];
    return def ? Boolean(def.mutates) : true;
}

/**
 * Зарегистрировать подключение Chrome-расширения пользователя.
 * По умолчанию `readOnly: true` (переключается человеком через `chrome_mode`).
 */
export function registerChromeBridge({ uid, transport, browserName = 'Chrome', extensionVersion = '0.1.0', readOnly = true }) {
    if (!uid)
        throw new Error('chrome: нужен uid пользователя');
    const prev = connections.get(String(uid));
    if (prev && prev.transport !== transport) {
        for (const [, p] of prev.pending)
            p.reject(new Error('новое подключение Chrome заменило предыдущее'));
        prev.pending.clear();
        try { prev.transport?.close?.(4000, 'replaced'); } catch { /* уже закрыт */ }
    }
    const conn = {
        uid: String(uid),
        id: prev?.id || ('chr-' + randomBytes(6).toString('hex')),
        transport,
        browserName: String(browserName || 'Chrome'),
        extensionVersion: String(extensionVersion || '0.1.0'),
        readOnly: Boolean(readOnly),
        tabId: null,
        lastUrl: '',
        lastTitle: '',
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        pending: new Map(),
        history: prev?.history || [],
        refsByTab: new Map(),
        allowedDomainsByScope: prev?.allowedDomainsByScope || new Map(),
    };
    connections.set(conn.uid, conn);
    recordChromeLog(conn, { action: 'connect', browser: conn.browserName, readOnly: conn.readOnly, outcome: 'ok' });
    return conn;
}

/** Отключить Chrome-мост пользователя. */
export function unregisterChromeBridge(uid, reason = 'расширение Chrome отключилось') {
    const conn = connections.get(String(uid || ''));
    if (!conn)
        return false;
    for (const [, p] of conn.pending)
        p.reject(new Error(reason));
    conn.pending.clear();
    conn.refsByTab.clear();
    conn.tabId = null;
    connections.delete(conn.uid);
    return true;
}

/** Получить активное подключение Chrome ТОЛЬКО для владельца uid. */
export function getChromeForUser(uid) {
    return connections.get(String(uid || '')) || null;
}

/** Переключить режим «только просмотр» (readOnly) для Chrome пользователя. */
export function setChromeReadOnly(uid, readOnly) {
    const conn = getChromeForUser(uid);
    if (!conn)
        throw new Error('расширение WORK Chrome Bridge не подключено');
    conn.readOnly = Boolean(readOnly);
    conn.lastSeen = Date.now();
    recordChromeLog(conn, { action: 'mode', readOnly: conn.readOnly, outcome: 'ok' });
    return { uid: conn.uid, readOnly: conn.readOnly };
}

function scopeKeyOf(scopeKey) {
    return String(scopeKey || 'default');
}

export function getChromeAllowedDomains(uid, scopeKey) {
    const conn = getChromeForUser(uid);
    if (!conn)
        return [];
    const set = conn.allowedDomainsByScope.get(scopeKeyOf(scopeKey));
    return set ? [...set] : [];
}

export function isChromeDomainAllowed(uid, scopeKey, hostname) {
    const conn = getChromeForUser(uid);
    const h = String(hostname || '').toLowerCase();
    if (!conn || !h)
        return false;
    const set = conn.allowedDomainsByScope.get(scopeKeyOf(scopeKey));
    return Boolean(set && set.has(h));
}

export function approveChromeDomain(uid, scopeKey, hostname) {
    const conn = getChromeForUser(uid);
    const h = String(hostname || '').toLowerCase();
    if (!conn || !h)
        return;
    const key = scopeKeyOf(scopeKey);
    let set = conn.allowedDomainsByScope.get(key);
    if (!set) {
        set = new Set();
        conn.allowedDomainsByScope.set(key, set);
    }
    set.add(h);
}

export function clearChromeDomains(uid, scopeKey) {
    const conn = getChromeForUser(uid);
    if (!conn)
        return;
    conn.allowedDomainsByScope.delete(scopeKeyOf(scopeKey));
}

function sendRpc(conn, payload) {
    return new Promise((resolve, reject) => {
        const id = 'cr-' + randomBytes(6).toString('hex');
        const timer = setTimeout(() => {
            conn.pending.delete(id);
            reject(new Error('chrome: таймаут ответа от расширения (' + (payload.op || payload.method || '?') + ')'));
        }, CMD_TIMEOUT_MS);
        conn.pending.set(id, {
            resolve: v => { clearTimeout(timer); resolve(v); },
            reject: e => { clearTimeout(timer); reject(e); },
        });
        try {
            conn.transport.send({ id, ...payload });
        }
        catch (e) {
            clearTimeout(timer);
            conn.pending.delete(id);
            reject(e);
        }
    });
}

function handleTabDetached(conn, tabId, reason) {
    if (conn.tabId != null && tabId != null && conn.tabId !== tabId)
        return;
    const oldTab = conn.tabId;
    conn.tabId = null;
    if (oldTab != null)
        conn.refsByTab.delete(oldTab);
    for (const [, p] of conn.pending)
        p.reject(new Error('пользователь закрыл или перехватил вкладку агента (' + (reason || 'detach') + ')'));
    conn.pending.clear();
    recordChromeLog(conn, { action: 'tab_detach', domain: hostnameOf(conn.lastUrl), outcome: 'human_takeover' });
}

/** Принять входящее сообщение от расширения (или тестового транспорта). */
export function onChromeTransportMessage(conn, msg) {
    if (!conn || !msg || typeof msg !== 'object')
        return;
    conn.lastSeen = Date.now();
    if (msg.type === 'ping') {
        try { conn.transport.send({ type: 'pong' }); } catch { /* закрыт */ }
        return;
    }
    if (msg.type === 'tab_detached' || msg.type === 'tab_closed') {
        handleTabDetached(conn, msg.tabId, msg.reason || msg.type);
        return;
    }
    if (msg.id && conn.pending.has(msg.id)) {
        const p = conn.pending.get(msg.id);
        conn.pending.delete(msg.id);
        if (msg.ok === false || msg.error)
            p.reject(new Error(String(msg.error || 'ошибка расширения Chrome')));
        else
            p.resolve(msg.result);
    }
}

async function cdpCall(conn, tabId, method, params = {}) {
    assertSafeCdpCall(method, params);
    return sendRpc(conn, { op: 'cdp', tabId, method, params });
}

async function evalFixed(conn, tabId, expr) {
    const r = await cdpCall(conn, tabId, 'Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r?.exceptionDetails)
        throw new Error('chrome: ошибка чтения страницы');
    return r?.result?.value;
}

async function waitReady(conn, tabId, timeoutMs = 15_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try {
            if (await evalFixed(conn, tabId, EXPR_READY_STATE) === 'complete')
                return;
        }
        catch {
            // страница может перезагружаться в этот момент
        }
        await new Promise(r => setTimeout(r, 250));
    }
}

function requireConn(uid) {
    const conn = getChromeForUser(uid);
    if (!conn)
        throw new Error('Расширение WORK Chrome Bridge не подключено для вашей учётной записи.');
    return conn;
}

function assertWritable(conn, op) {
    if (conn.readOnly && isChromeMutatingOp(op)) {
        recordChromeLog(conn, { action: op, domain: hostnameOf(conn.lastUrl), readOnly: true, outcome: 'denied_readonly' });
        throw new Error('Chrome в режиме «только просмотр» (readOnly): вызовите chrome_mode { readOnly: false } для разрешения действий.');
    }
}

function assertAllowedDomain(conn, scopeKey, url, action) {
    const host = hostnameOf(url);
    if (!host || !isChromeDomainAllowed(conn.uid, scopeKey, host)) {
        if (conn.tabId != null)
            conn.refsByTab.delete(conn.tabId);
        recordChromeLog(conn, { action, domain: host || 'unknown', outcome: 'denied_domain' });
        throw new Error(
            'Переход или действие на домене «' + (host || url || '?') + '» остановлено: '
            + 'домен не входит в список разрешённых для этой задачи. '
            + 'Подтвердите новый домен вызовом chrome_open или спросите человека.'
        );
    }
    return host;
}

async function takeSnapshotOnTab(conn, tabId) {
    const url = String(await evalFixed(conn, tabId, EXPR_LOCATION_HREF) || '');
    const title = String(await evalFixed(conn, tabId, EXPR_DOCUMENT_TITLE) || '');
    const tree = await cdpCall(conn, tabId, 'Accessibility.getFullAXTree', {});
    const { refs, items } = buildAxMap(tree?.nodes || []);
    conn.refsByTab.set(tabId, refs);
    conn.lastUrl = url;
    conn.lastTitle = title;
    return { url, title, text: formatSnapshotText(url, title, items), refCount: refs.size };
}

function requireTab(conn) {
    if (conn.tabId == null)
        throw new Error('Вкладка агента в Chrome ещё не открыта (или была закрыта человеком) — сначала вызовите chrome_open.');
    return conn.tabId;
}

/** Открыть URL в собственной сгруппированной вкладке агента (чужие вкладки не трогаются). */
export async function chromeOpen(uid, scopeKey, rawUrl) {
    const conn = requireConn(uid);
    const href = assertPageUrl(rawUrl);
    const targetHost = hostnameOf(href);
    assertWritable(conn, 'open');
    approveChromeDomain(uid, scopeKey, targetHost);

    try {
        if (conn.tabId == null) {
            const tab = await sendRpc(conn, { op: 'ensure_tab', url: 'about:blank' });
            if (!tab?.tabId)
                throw new Error('не удалось создать вкладку агента в Chrome');
            conn.tabId = tab.tabId;
        }
        await cdpCall(conn, conn.tabId, 'Page.navigate', { url: href });
        await waitReady(conn, conn.tabId);
        const snap = await takeSnapshotOnTab(conn, conn.tabId);
        const finalHost = assertAllowedDomain(conn, scopeKey, snap.url, 'open');
        recordChromeLog(conn, { action: 'open', domain: finalHost, outcome: 'ok' });
        return snap;
    }
    catch (e) {
        recordChromeLog(conn, { action: 'open', domain: targetHost, outcome: 'error', error: String(e?.message || e).slice(0, 160) });
        throw e;
    }
}

/** Снять текстовый снимок [ref] текущей вкладки агента (разрешено и в readOnly). */
export async function chromeSnapshot(uid) {
    const conn = requireConn(uid);
    const tabId = requireTab(conn);
    const snap = await takeSnapshotOnTab(conn, tabId);
    recordChromeLog(conn, { action: 'snapshot', domain: hostnameOf(snap.url), outcome: 'ok' });
    return snap;
}

/** Клик по [ref] на текущей вкладке агента + проверка домена после возможного перехода. */
export async function chromeClick(uid, scopeKey, refNum) {
    const conn = requireConn(uid);
    assertWritable(conn, 'click');
    const tabId = requireTab(conn);
    const curUrl = String(await evalFixed(conn, tabId, EXPR_LOCATION_HREF) || conn.lastUrl || '');
    const curHost = assertAllowedDomain(conn, scopeKey, curUrl, 'click');

    const n = Number(refNum);
    const refs = conn.refsByTab.get(tabId);
    const node = refs?.get(n);
    if (!node || !node.backendDOMNodeId)
        throw new Error('нет элемента [' + n + '] — обновите chrome_snapshot');

    try {
        await cdpCall(conn, tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: node.backendDOMNodeId }).catch(() => {});
        const box = await cdpCall(conn, tabId, 'DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId });
        const q = box?.model?.content || [];
        if (q.length < 8)
            throw new Error('элемент [' + n + '] без координат (скрыт?)');
        const x = (q[0] + q[4]) / 2;
        const y = (q[1] + q[5]) / 2;
        for (const type of ['mousePressed', 'mouseReleased']) {
            await cdpCall(conn, tabId, 'Input.dispatchMouseEvent', {
                type, x, y, button: 'left', buttons: 1, clickCount: 1,
            });
        }
        const t0 = Date.now();
        let finalUrl = curUrl;
        while (Date.now() - t0 < 4_000) {
            await new Promise(r => setTimeout(r, 250));
            try {
                const nowUrl = String(await evalFixed(conn, tabId, EXPR_LOCATION_HREF) || '');
                if (nowUrl && nowUrl !== curUrl) {
                    finalUrl = nowUrl;
                    await waitReady(conn, tabId, 10_000);
                    finalUrl = String(await evalFixed(conn, tabId, EXPR_LOCATION_HREF) || nowUrl);
                    break;
                }
            }
            catch { /* ждём навигацию */ }
        }
        conn.lastUrl = finalUrl;
        assertAllowedDomain(conn, scopeKey, finalUrl, 'click');
        const role = String(node?.role?.value || '');
        const name = String(node?.name?.value || '');
        recordChromeLog(conn, { action: 'click', domain: curHost, ref: n, outcome: 'ok' });
        return {
            label: 'клик [' + n + '] ' + role + ' "' + name + '"',
            x: Math.round(x),
            y: Math.round(y),
            url: finalUrl,
        };
    }
    catch (e) {
        recordChromeLog(conn, { action: 'click', domain: curHost, ref: n, outcome: 'error', error: String(e?.message || e).slice(0, 160) });
        throw e;
    }
}

/** Ввести текст в поле [ref] (пароли запрещены — используйте chrome_handoff). */
export async function chromeType(uid, scopeKey, refNum, text, submit = false) {
    const conn = requireConn(uid);
    assertWritable(conn, 'type');
    const tabId = requireTab(conn);
    const curUrl = String(await evalFixed(conn, tabId, EXPR_LOCATION_HREF) || conn.lastUrl || '');
    const curHost = assertAllowedDomain(conn, scopeKey, curUrl, 'type');

    const str = String(text ?? '');
    if (!str)
        throw new Error('пустой ввод');
    const n = Number(refNum);
    const refs = conn.refsByTab.get(tabId);
    const node = refs?.get(n);
    if (!node || !node.backendDOMNodeId)
        throw new Error('нет элемента [' + n + '] — обновите chrome_snapshot');

    try {
        await cdpCall(conn, tabId, 'DOM.focus', { backendNodeId: node.backendDOMNodeId });
        await cdpCall(conn, tabId, 'Input.insertText', { text: str });
        if (submit) {
            for (const type of ['keyDown', 'keyUp']) {
                await cdpCall(conn, tabId, 'Input.dispatchKeyEvent', {
                    type,
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13,
                    text: type === 'keyDown' ? '\r' : '',
                });
            }
            await new Promise(r => setTimeout(r, 400));
            const finalUrl = String(await evalFixed(conn, tabId, EXPR_LOCATION_HREF) || curUrl);
            conn.lastUrl = finalUrl;
            assertAllowedDomain(conn, scopeKey, finalUrl, 'type');
        }
        // Важно: в аудит никогда не пишем введённый текст
        recordChromeLog(conn, { action: 'type', domain: curHost, ref: n, chars: str.length, outcome: 'ok' });
        const preview = str.slice(0, 40) + (str.length > 40 ? '…' : '');
        return { label: 'ввод «' + preview + '» в [' + n + ']', chars: str.length };
    }
    catch (e) {
        recordChromeLog(conn, { action: 'type', domain: curHost, ref: n, outcome: 'error', error: String(e?.message || e).slice(0, 160) });
        throw e;
    }
}

/** Навигация (back | forward | reload) по истории вкладки агента + проверка домена. */
export async function chromeNav(uid, scopeKey, action = 'reload') {
    const conn = requireConn(uid);
    assertWritable(conn, 'nav');
    const tabId = requireTab(conn);
    const curUrl = String(await evalFixed(conn, tabId, EXPR_LOCATION_HREF) || conn.lastUrl || '');
    const curHost = assertAllowedDomain(conn, scopeKey, curUrl, 'nav');

    try {
        if (action === 'back' || action === 'forward') {
            const hist = await cdpCall(conn, tabId, 'Page.getNavigationHistory', {});
            const idx = Number(hist?.currentIndex ?? -1);
            const entries = Array.isArray(hist?.entries) ? hist.entries : [];
            const nextIdx = action === 'back' ? idx - 1 : idx + 1;
            const target = entries[nextIdx];
            if (!target)
                throw new Error(action === 'back' ? 'назад идти некуда' : 'вперёд идти некуда');
            assertAllowedDomain(conn, scopeKey, target.url, 'nav');
            await cdpCall(conn, tabId, 'Page.navigateToHistoryEntry', { entryId: target.id });
        }
        else {
            await cdpCall(conn, tabId, 'Page.reload', {});
        }
        await waitReady(conn, tabId);
        const snap = await takeSnapshotOnTab(conn, tabId);
        const finalHost = assertAllowedDomain(conn, scopeKey, snap.url, 'nav');
        recordChromeLog(conn, { action: 'nav:' + action, domain: finalHost, outcome: 'ok' });
        return snap;
    }
    catch (e) {
        recordChromeLog(conn, { action: 'nav:' + action, domain: curHost, outcome: 'error', error: String(e?.message || e).slice(0, 160) });
        throw e;
    }
}

/** Скриншот текущей вкладки агента (PNG Buffer, для chrome_handoff; работает и в readOnly). */
export async function chromeScreenshot(uid) {
    const conn = getChromeForUser(uid);
    if (!conn || conn.tabId == null)
        return null;
    try {
        const res = await cdpCall(conn, conn.tabId, 'Page.captureScreenshot', { format: 'png' });
        return res?.data ? Buffer.from(res.data, 'base64') : null;
    }
    catch {
        return null;
    }
}

/**
 * Обработчик WebSocket `/~chrome` (подключается из `sources/host/websocket.js`).
 * Проверяет LAN/localhost, допустимость Origin (extension/empty/same-host) и auth-кадр с токеном `wmcp.`.
 */
export function handleChromeSocket(ws, request) {
    if (!clientAllowed(request)) {
        try { ws.close(4403, 'Chrome bridge available only from localhost or LAN'); } catch { /* уже закрыт */ }
        return;
    }
    if (!chromeOriginAllowed(request)) {
        try { ws.close(4403, 'Forbidden origin'); } catch { /* уже закрыт */ }
        return;
    }
    let authedConn = null;
    const authTimer = setTimeout(() => {
        if (!authedConn) {
            try { ws.close(4401, 'Auth timeout'); } catch { /* уже закрыт */ }
        }
    }, AUTH_TIMEOUT_MS);

    const transport = {
        send: obj => {
            if (ws.readyState === 1)
                ws.send(JSON.stringify(obj));
        },
        close: (code, reason) => {
            try { ws.close(code, reason); } catch { /* уже закрыт */ }
        },
    };

    ws.on('message', async raw => {
        let msg;
        try {
            const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf-8');
            msg = JSON.parse(text);
        }
        catch {
            return;
        }
        if (!authedConn) {
            if (msg?.type !== 'auth') {
                try { ws.close(4401, 'Auth required'); } catch { /* уже закрыт */ }
                return;
            }
            const auth = await verifyToken(String(msg.token || '')).catch(() => null);
            if (!auth) {
                try { ws.close(4401, 'Invalid token'); } catch { /* уже закрыт */ }
                return;
            }
            clearTimeout(authTimer);
            authedConn = registerChromeBridge({
                uid: auth.uid,
                transport,
                browserName: msg.browserName || 'Chrome',
                extensionVersion: msg.extensionVersion || '0.1.0',
                readOnly: true,
            });
            transport.send({ type: 'auth_ok', uid: authedConn.uid, readOnly: authedConn.readOnly });
            return;
        }
        onChromeTransportMessage(authedConn, msg);
    });

    ws.on('close', () => {
        clearTimeout(authTimer);
        if (authedConn && getChromeForUser(authedConn.uid) === authedConn)
            unregisterChromeBridge(authedConn.uid);
    });
    ws.on('error', () => {
        clearTimeout(authTimer);
    });
}
