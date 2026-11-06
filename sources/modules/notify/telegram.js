/**
 * Адаптер Telegram Bot API (`sources/modules/notify/telegram.js`).
 * Поддерживает проверку токена (`getMe`), отправку сообщений (`sendMessage`)
 * и опрос входящих команд привязки (`getUpdates` — `/start <CODE>` в личных и групповых чатах).
 */

export const DEFAULT_TELEGRAM_API = 'https://api.telegram.org';

/** Извлечь одноразовый код привязки из `/start CODE`, `/bind CODE`, `/link CODE` или просто `CODE`. */
export function extractCommandCode(text = '') {
    const clean = String(text || '').trim();
    if (!clean)
        return '';
    const m = clean.match(/^(?:\/(?:start|bind|link)(?:@[\w_]+)?\s+)([A-Za-z0-9_-]{4,24})$/i)
        || clean.match(/^([A-Z0-9]{6,12})$/);
    return m ? m[1].toUpperCase() : '';
}

function buildUrl(token, method, query = {}, apiUrl = DEFAULT_TELEGRAM_API) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken)
        throw new Error('Telegram: не задан токен бота');
    const base = String(apiUrl || DEFAULT_TELEGRAM_API).replace(/\/+$/, '');
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '')
            qs.set(k, String(v));
    }
    const suffix = qs.toString() ? '?' + qs.toString() : '';
    return `${base}/bot${cleanToken}/${method}${suffix}`;
}

export async function getMe(token, { apiUrl } = {}) {
    const url = buildUrl(token, 'getMe', {}, apiUrl);
    const res = await globalThis.fetch(url, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || !data?.result)
        throw new Error('Telegram getMe: ' + (data?.description || res.statusText || res.status));
    const r = data.result;
    return {
        id: String(r.id ?? ''),
        username: String(r.username || ''),
        name: String(r.first_name || r.username || ''),
        isBot: r.is_bot !== false,
    };
}

export async function sendMessage(token, { chatId, text, parseMode, apiUrl } = {}) {
    const target = String(chatId ?? '').trim();
    if (!target)
        throw new Error('Telegram sendMessage: не указан chatId');
    const bodyText = String(text ?? '').trim();
    if (!bodyText)
        throw new Error('Telegram sendMessage: пустой текст сообщения');
    const url = buildUrl(token, 'sendMessage', {}, apiUrl);
    const payload = {
        chat_id: target,
        text: bodyText.slice(0, 4000),
        disable_web_page_preview: true,
    };
    if (parseMode)
        payload.parse_mode = parseMode;
    const res = await globalThis.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false)
        throw new Error('Telegram sendMessage: ' + (data?.description || res.statusText || res.status));
    return {
        ok: true,
        channel: 'telegram',
        chatId: target,
        messageId: data?.result?.message_id ?? null,
    };
}

export async function getUpdates(token, { offset = 0, timeout = 0, limit = 50, apiUrl } = {}) {
    const url = buildUrl(token, 'getUpdates', {
        offset: offset > 0 ? offset : undefined,
        timeout,
        limit,
    }, apiUrl);
    const res = await globalThis.fetch(url, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false)
        throw new Error('Telegram getUpdates: ' + (data?.description || res.statusText || res.status));
    const list = Array.isArray(data?.result) ? data.result : [];
    let nextOffset = Number(offset) || 0;
    const events = [];

    for (const u of list) {
        const uidNum = Number(u?.update_id);
        if (Number.isFinite(uidNum) && uidNum + 1 > nextOffset)
            nextOffset = uidNum + 1;
        const msg = u?.message || u?.channel_post || u?.my_chat_member;
        if (!msg)
            continue;
        const chat = msg.chat || {};
        if (chat.id === undefined || chat.id === null)
            continue;
        const chatId = String(chat.id);
        const rawType = String(chat.type || 'private');
        const isGroup = rawType === 'group' || rawType === 'supergroup' || rawType === 'channel';
        const from = msg.from || msg.sender_chat || {};
        const username = String(from.username || chat.username || '');
        const firstName = [from.first_name, from.last_name].filter(Boolean).join(' ')
            || String(chat.title || username || '');
        const chatTitle = String(chat.title || firstName || username || chatId);
        const text = String(msg.text || msg.caption || '').trim();
        const code = extractCommandCode(text);
        events.push({
            channel: 'telegram',
            updateId: uidNum,
            chatId,
            chatType: isGroup ? 'group' : 'private',
            chatTitle,
            userId: from.id != null ? String(from.id) : chatId,
            username,
            firstName,
            text,
            code,
        });
    }
    return { events, nextOffset };
}
