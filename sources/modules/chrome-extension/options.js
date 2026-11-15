const serverEl = document.getElementById('serverUrl');
const tokenEl = document.getElementById('token');
const statusEl = document.getElementById('statusBox');
const openWorkBtn = document.getElementById('openWorkBtn');

function validHttpUrl(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin + u.pathname.replace(/\/+$/, '') : '';
    }
    catch {
        return '';
    }
}

function updateOpenBtn() {
    openWorkBtn.disabled = !validHttpUrl(serverEl.value);
}

/** Поддержка вставки готовой JSON-строки `{"server":...,"token":...}` из модалки профиля. */
function maybeParseBridgePayload(raw) {
    const s = String(raw || '').trim();
    if (!s.startsWith('{'))
        return false;
    try {
        const obj = JSON.parse(s);
        if (obj && typeof obj === 'object' && typeof obj.token === 'string') {
            if (typeof obj.server === 'string' && validHttpUrl(obj.server))
                serverEl.value = validHttpUrl(obj.server);
            tokenEl.value = obj.token.trim();
            updateOpenBtn();
            return true;
        }
    }
    catch { /* не JSON — оставляем как есть */ }
    return false;
}

function renderStatus(st) {
    if (!st) {
        statusEl.className = 'status';
        statusEl.textContent = 'Не настроено. Укажите адрес WORK и токен из профиля («Подключения» → «Токен для подключения»).';
        return;
    }
    statusEl.className = 'status ' + (st.state === 'connected' ? 'ok' : (st.state === 'error' ? 'err' : ''));
    let text = st.message || st.state;
    if (/Invalid token|Auth required|4401/i.test(text))
        text += ' — проверьте или перевыпустите токен в профиле WORK (аватар → «Подключения» → «Токен для подключения»).';
    statusEl.textContent = text;
}

async function load() {
    const data = await chrome.storage.local.get(['serverUrl', 'token', 'lastStatus']);
    serverEl.value = data.serverUrl || 'http://localhost:8001';
    tokenEl.value = data.token || '';
    updateOpenBtn();
    renderStatus(data.lastStatus);
}

serverEl.addEventListener('input', updateOpenBtn);

tokenEl.addEventListener('input', () => {
    maybeParseBridgePayload(tokenEl.value);
});

openWorkBtn.addEventListener('click', () => {
    const url = validHttpUrl(serverEl.value);
    if (!url) {
        renderStatus({ state: 'error', message: 'Укажите корректный адрес сервера WORK (http:// или https://).' });
        return;
    }
    chrome.tabs.create({ url });
});

document.getElementById('saveBtn').addEventListener('click', async () => {
    maybeParseBridgePayload(tokenEl.value);
    const serverUrl = validHttpUrl(serverEl.value);
    const token = tokenEl.value.trim();
    if (!serverUrl || !token) {
        renderStatus({
            state: 'error',
            message: 'Заполните адрес сервера WORK и токен (профиль WORK → «Подключения» → «Токен для подключения»).',
        });
        return;
    }
    serverEl.value = serverUrl;
    await chrome.storage.local.set({ serverUrl, token });
    await chrome.runtime.sendMessage({ type: 'reconnect' });
    setTimeout(load, 500);
});

document.getElementById('clearBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove(['token']);
    tokenEl.value = '';
    await chrome.runtime.sendMessage({ type: 'disconnect' });
    setTimeout(load, 200);
});

chrome.storage.onChanged.addListener(changes => {
    if (changes.lastStatus)
        renderStatus(changes.lastStatus.newValue);
});

load();
