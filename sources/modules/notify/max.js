/**
 * Адаптер MAX Bot API (`sources/modules/notify/max.js`, https://botapi.max.ru).
 * Поддерживает проверку токена (`getMe`), отправку сообщений (`sendMessage`)
 * и опрос событий (`getUpdates` — `bot_started` с payload кода и `message_created` с `/start <CODE>`).
 */
import { extractCommandCode } from './telegram.js';

export const DEFAULT_MAX_API = 'https://botapi.max.ru';

function buildUrl(token, route, query = {}, apiUrl = DEFAULT_MAX_API) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken)
        throw new Error('MAX: не задан токен бота');
    const base = String(apiUrl || DEFAULT_MAX_API).replace(/\/+$/, '');
    const qs = new URLSearchParams({ access_token: cleanToken });
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '')
            qs.set(k, String(v));
    }
    return `${base}/${String(route).replace(/^\/+/, '')}?${qs.toString()}`;
}

export async function getMe(token, { apiUrl } = {}) {
    const cleanToken = String(token || '').trim();
    const url = buildUrl(cleanToken, 'me', {}, apiUrl);
    const res = await globalThis.fetch(url, {
        method: 'GET',
        headers: { Authorization: cleanToken },
    });
    const data = await res.json().catch(() => ({}));
    const r = data?.result || data;
    if (!res.ok || data?.ok === false || (!r?.user_id && !r?.id && !r?.username && !r?.name))
        throw new Error('MAX getMe: ' + (data?.message || data?.description || res.statusText || res.status));
    return {
        id: String(r.user_id ?? r.id ?? ''),
        username: String(r.username || ''),
        name: String(r.name || r.first_name || r.username || ''),
        isBot: r.is_bot !== false,
    };
}

export async function sendMessage(token, { chatId, userId, text, apiUrl } = {}) {
    const cleanToken = String(token || '').trim();
    const targetChat = String(chatId ?? '').trim();
    const targetUser = String(userId ?? '').trim();
    if (!targetChat && !targetUser)
        throw new Error('MAX sendMessage: не указан chatId или userId');
    const bodyText = String(text ?? '').trim();
    if (!bodyText)
        throw new Error('MAX sendMessage: пустой текст сообщения');

    const query = targetChat ? { chat_id: targetChat } : { user_id: targetUser };
    const url = buildUrl(cleanToken, 'messages', query, apiUrl);
    const payload = {
        text: bodyText.slice(0, 4000),
        ...(targetChat ? { chat_id: targetChat } : {}),
        ...(targetUser ? { user_id: targetUser } : {}),
    };
    const res = await globalThis.fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: cleanToken,
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false)
        throw new Error('MAX sendMessage: ' + (data?.message || data?.description || res.statusText || res.status));
    return {
        ok: true,
        channel: 'max',
        chatId: targetChat || targetUser,
        messageId: data?.message?.body?.mid ?? data?.result?.message_id ?? null,
    };
}

export async function getUpdates(token, { offset = 0, timeout = 0, limit = 50, apiUrl } = {}) {
    const cleanToken = String(token || '').trim();
    const url = buildUrl(cleanToken, 'updates', {
        marker: offset > 0 ? offset : undefined,
        timeout,
        limit,
    }, apiUrl);
    const res = await globalThis.fetch(url, {
        method: 'GET',
        headers: { Authorization: cleanToken },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false)
        throw new Error('MAX getUpdates: ' + (data?.message || data?.description || res.statusText || res.status));

    const list = Array.isArray(data?.updates)
        ? data.updates
        : (Array.isArray(data?.result) ? data.result : []);
    let nextOffset = Number(data?.marker ?? offset) || 0;
    const events = [];

    for (const u of list) {
        const markerNum = Number(u?.marker ?? u?.update_id ?? u?.timestamp);
        if (Number.isFinite(markerNum) && markerNum + 1 > nextOffset && data?.marker == null)
            nextOffset = markerNum + 1;

        const uType = String(u?.update_type || '');
        if (uType === 'bot_started') {
            const chatId = String(u.chat_id ?? u.user?.user_id ?? '');
            if (!chatId)
                continue;
            const user = u.user || {};
            const username = String(user.username || '');
            const firstName = String(user.name || user.first_name || username || chatId);
            const rawPayload = String(u.payload || '').trim();
            const code = extractCommandCode(rawPayload) || (/^[A-Za-z0-9_-]{4,24}$/.test(rawPayload) ? rawPayload.toUpperCase() : '');
            events.push({
                channel: 'max',
                updateId: markerNum || 0,
                chatId,
                chatType: 'private',
                chatTitle: firstName,
                userId: user.user_id != null ? String(user.user_id) : chatId,
                username,
                firstName,
                text: rawPayload ? `/start ${rawPayload}` : '/start',
                code,
            });
            continue;
        }

        if (uType === 'bot_added') {
            const chatId = String(u.chat_id ?? '');
            if (!chatId)
                continue;
            events.push({
                channel: 'max',
                updateId: markerNum || 0,
                chatId,
                chatType: 'group',
                chatTitle: String(u.title || chatId),
                userId: String(u.user?.user_id ?? ''),
                username: String(u.user?.username || ''),
                firstName: String(u.user?.name || ''),
                text: '',
                code: '',
            });
            continue;
        }

        const msg = u?.message || u;
        const recipient = msg?.recipient || {};
        const sender = msg?.sender || msg?.from || u?.user || {};
        const chatObj = msg?.chat || {};
        const chatId = String(recipient.chat_id ?? chatObj.id ?? u?.chat_id ?? sender.user_id ?? sender.id ?? '');
        if (!chatId)
            continue;
        const rawChatType = String(recipient.chat_type || chatObj.type || 'dialog');
        const isGroup = rawChatType === 'chat' || rawChatType === 'channel' || rawChatType === 'group' || rawChatType === 'supergroup';
        const username = String(sender.username || chatObj.username || '');
        const firstName = String(sender.name || [sender.first_name, sender.last_name].filter(Boolean).join(' ') || username || chatId);
        const chatTitle = String(recipient.title || chatObj.title || u?.title || firstName || chatId);
        const text = String(msg?.body?.text ?? msg?.text ?? '').trim();
        const code = extractCommandCode(text);
        events.push({
            channel: 'max',
            updateId: markerNum || 0,
            chatId,
            chatType: isGroup ? 'group' : 'private',
            chatTitle,
            userId: String(sender.user_id ?? sender.id ?? chatId),
            username,
            firstName,
            text,
            code,
        });
    }

    return { events, nextOffset };
}
