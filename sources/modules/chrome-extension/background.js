/**
 * Service worker расширения WORK Chrome Bridge (MV3).
 * Тонкий транспорт: принимает команды от сервера WORK по WebSocket `/~chrome`,
 * создаёт/группирует только собственную вкладку агента («WORK») и транслирует
 * разрешённые CDP-вызовы через `chrome.debugger`. Чужие вкладки не трогает никогда.
 */

const ALLOWED_CDP_METHODS = new Set([
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

const ALLOWED_EVAL_EXPRS = new Set([
    'location.href',
    'document.title',
    'document.readyState',
]);

let ws = null;
let agentTabId = null;
let attachedTabId = null;
let pingTimer = null;
let reconnectTimer = null;
let connecting = false;

function wsUrlFromServer(serverUrl) {
    const u = new URL(String(serverUrl || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
        throw new Error('Нужен адрес http:// или https://');
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = u.pathname.replace(/\/+$/, '');
    return proto + '//' + u.host + basePath + '/~chrome';
}

async function setStatus(state, message, extra = {}) {
    await chrome.storage.local.set({
        lastStatus: {
            state,
            message: String(message || ''),
            updatedAt: new Date().toISOString(),
            ...extra,
        },
    });
}

function sendFrame(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
        return true;
    }
    return false;
}

async function restoreTabId() {
    if (agentTabId != null)
        return agentTabId;
    try {
        const stored = await chrome.storage.session.get('agentTabId');
        if (typeof stored?.agentTabId === 'number')
            agentTabId = stored.agentTabId;
    }
    catch { /* storage.session может быть недоступен */ }
    return agentTabId;
}

async function saveTabId(tabId) {
    agentTabId = tabId;
    try {
        if (tabId == null)
            await chrome.storage.session.remove('agentTabId');
        else
            await chrome.storage.session.set({ agentTabId: tabId });
    }
    catch { /* не критично */ }
}

async function ensureAgentTab(initialUrl = 'about:blank') {
    await restoreTabId();
    if (agentTabId != null) {
        try {
            const tab = await chrome.tabs.get(agentTabId);
            if (tab?.id) {
                if (attachedTabId !== tab.id) {
                    await chrome.debugger.attach({ tabId: tab.id }, '1.3');
                    attachedTabId = tab.id;
                }
                return { tabId: tab.id };
            }
        }
        catch {
            await saveTabId(null);
            attachedTabId = null;
        }
    }
    const created = await chrome.tabs.create({ url: initialUrl, active: false });
    if (!created?.id)
        throw new Error('Не удалось создать вкладку агента');
    await saveTabId(created.id);
    try {
        const groupId = await chrome.tabs.group({ tabIds: [created.id] });
        if (chrome.tabGroups?.update)
            await chrome.tabGroups.update(groupId, { title: 'WORK', color: 'blue' });
    }
    catch { /* группировка опциональна */ }
    await chrome.debugger.attach({ tabId: created.id }, '1.3');
    attachedTabId = created.id;
    return { tabId: created.id };
}

async function runCdp(tabId, method, params) {
    const m = String(method || '');
    if (!ALLOWED_CDP_METHODS.has(m))
        throw new Error('Запрещённый метод CDP: ' + m);
    if (m === 'Runtime.evaluate' && !ALLOWED_EVAL_EXPRS.has(String(params?.expression || '')))
        throw new Error('Произвольный Runtime.evaluate запрещён');
    if (tabId !== agentTabId)
        throw new Error('Доступ разрешён только к собственной вкладке агента');
    if (attachedTabId !== tabId) {
        await chrome.debugger.attach({ tabId }, '1.3');
        attachedTabId = tabId;
    }
    return chrome.debugger.sendCommand({ tabId }, m, params || {});
}

async function handleRpc(msg) {
    const id = msg.id;
    try {
        let result;
        if (msg.op === 'ensure_tab')
            result = await ensureAgentTab(msg.url || 'about:blank');
        else if (msg.op === 'cdp')
            result = await runCdp(msg.tabId, msg.method, msg.params);
        else if (msg.op === 'close_tab') {
            if (agentTabId != null) {
                const tid = agentTabId;
                await saveTabId(null);
                attachedTabId = null;
                try { await chrome.debugger.detach({ tabId: tid }); } catch {}
                try { await chrome.tabs.remove(tid); } catch {}
            }
            result = { closed: true };
        }
        else
            throw new Error('Неизвестная операция: ' + String(msg.op || ''));
        sendFrame({ id, ok: true, result });
    }
    catch (e) {
        sendFrame({ id, ok: false, error: String(e?.message || e) });
    }
}

function stopTimers() {
    if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
    }
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleReconnect(delayMs = 5000) {
    if (reconnectTimer)
        return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, delayMs);
}

export async function connect(force = false) {
    if (connecting)
        return;
    if (ws && ws.readyState === WebSocket.OPEN && !force)
        return;
    if (force && ws) {
        try { ws.close(); } catch {}
        ws = null;
    }
    const { serverUrl, token } = await chrome.storage.local.get(['serverUrl', 'token']);
    if (!serverUrl || !token) {
        await setStatus('unconfigured', 'Укажите адрес WORK и токен wmcp в настройках расширения.');
        return;
    }
    let endpoint;
    try {
        endpoint = wsUrlFromServer(serverUrl);
    }
    catch (e) {
        await setStatus('error', e.message);
        return;
    }
    connecting = true;
    await setStatus('connecting', 'Подключение к ' + serverUrl + '…');
    try {
        const socket = new WebSocket(endpoint);
        ws = socket;
        socket.addEventListener('open', () => {
            connecting = false;
            const manifest = chrome.runtime.getManifest();
            socket.send(JSON.stringify({
                type: 'auth',
                token: String(token).trim(),
                extensionVersion: manifest.version,
                browserName: navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome',
            }));
            stopTimers();
            pingTimer = setInterval(() => {
                sendFrame({ type: 'ping' });
            }, 20_000);
        });
        socket.addEventListener('message', async ev => {
            let msg;
            try { msg = JSON.parse(String(ev.data || '')); } catch { return; }
            if (msg.type === 'auth_ok') {
                await setStatus('connected', 'Подключено к WORK (uid: ' + msg.uid + ')', { uid: msg.uid, readOnly: Boolean(msg.readOnly) });
                return;
            }
            if (msg.type === 'pong')
                return;
            if (msg.id)
                await handleRpc(msg);
        });
        socket.addEventListener('close', async ev => {
            connecting = false;
            stopTimers();
            if (ws === socket)
                ws = null;
            const reason = ev.reason || ('код ' + ev.code);
            await setStatus('disconnected', 'Отключено: ' + reason);
            if (ev.code !== 4401 && ev.code !== 4403 && ev.code !== 4000)
                scheduleReconnect(5000);
        });
        socket.addEventListener('error', async () => {
            connecting = false;
            await setStatus('error', 'Не удалось подключиться к ' + serverUrl);
        });
    }
    catch (e) {
        connecting = false;
        await setStatus('error', String(e?.message || e));
        scheduleReconnect(5000);
    }
}

chrome.debugger.onDetach.addListener(async (source, reason) => {
    if (source?.tabId != null && source.tabId === agentTabId) {
        const tid = source.tabId;
        await saveTabId(null);
        attachedTabId = null;
        sendFrame({ type: 'tab_detached', tabId: tid, reason });
    }
});

chrome.tabs.onRemoved.addListener(async tabId => {
    if (tabId === agentTabId) {
        await saveTabId(null);
        attachedTabId = null;
        sendFrame({ type: 'tab_closed', tabId });
    }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'reconnect') {
        connect(true).then(() => sendResponse({ ok: true }));
        return true;
    }
    if (msg?.type === 'disconnect') {
        stopTimers();
        if (ws) {
            try { ws.close(1000, 'manual'); } catch {}
            ws = null;
        }
        setStatus('disconnected', 'Отключено вручную').then(() => sendResponse({ ok: true }));
        return true;
    }
    return false;
});

chrome.alarms.create('work-chrome-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'work-chrome-keepalive')
        connect(false);
});
chrome.runtime.onInstalled.addListener(() => connect(false));
chrome.runtime.onStartup.addListener(() => connect(false));
connect(false);
