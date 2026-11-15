const statusEl = document.getElementById('status');

function render(st) {
    if (!st) {
        statusEl.className = 'box';
        statusEl.textContent = 'Не настроено — откройте «Настройки».';
        return;
    }
    statusEl.className = 'box ' + (st.state === 'connected' ? 'ok' : (st.state === 'error' ? 'err' : ''));
    statusEl.textContent = st.message || st.state;
}

async function refresh() {
    const { lastStatus } = await chrome.storage.local.get('lastStatus');
    render(lastStatus);
}

document.getElementById('reconnectBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'reconnect' });
    setTimeout(refresh, 400);
});

document.getElementById('optionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener(changes => {
    if (changes.lastStatus)
        render(changes.lastStatus.newValue);
});

refresh();
