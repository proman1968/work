/**
 * Telegram и MAX — уведомления в Telegram и российский мессенджер MAX через ботов организации.
 *
 * Настройка (администратор):
 *  - автоматически подхватывает ботов Telegram и MAX, настроенных во вкладке «Мессенджеры»
 *    (`sources/modules/notify`), либо токен из `#secret/telegram.json` (`{ "token": "…", "maxToken": "…" }`);
 *  - адресная книга `chats` ниже: имя → chat_id (или `{ telegram: 123456, max: "7890" }`),
 *    плюс автоматически включает сотрудников, привязавших свой Telegram/MAX в личном профиле `/USERS/<uid>`;
 *  - сообщение отправляется только адресатам из адресной книги / привязанным сотрудникам:
 *    агент не пишет на произвольные внешние `chat_id`.
 */
export default {
    icon: 'bootstrap:telegram',
    label: 'Telegram и MAX (Уведомления)',
    description: 'Уведомления сотрудникам и отделам в Telegram и российский мессенджер MAX через ботов организации',
    capabilities: ['notify', 'telegram', 'max'],
    enabled: true,

    /** Адресная книга: { "Иванов И.И.": 123456789, "Отдел продаж": -1001234567890 } */
    chats: {},

    SCHEMA: {
        send_message: {
            description: 'Отправить короткое уведомление в Telegram или российский мессенджер MAX адресату из адресной книги сервиса',
            params: {
                type: 'object',
                properties: {
                    to: { type: 'string', description: 'Имя адресата из адресной книги (сотрудник или подразделение)' },
                    text: { type: 'string', description: 'Текст уведомления (до 3500 символов, без секретов)' },
                    channel: { type: 'string', description: 'Канал доставки: "telegram", "max" или "auto" (по умолчанию "auto")' },
                },
                required: ['to', 'text'],
            },
        },
        contacts: {
            readonly: true,
            description: 'Список доступных адресатов (Telegram / MAX) из адресной книги сервиса',
            params: { type: 'object', properties: {} },
        },
        updates: {
            readonly: true,
            description: 'Последние обращения к боту (имя и chat_id) — чтобы администратор пополнил адресную книгу',
            params: { type: 'object', properties: {} },
        },
    },
    ACCESS: { send_message: 'call', contacts: 'read', updates: 'admin' },

    async contacts(params = {}) {
        await tgGuard(this, params);
        const book = await resolveAddressBook(this);
        return Object.keys(book);
    },

    async send_message(params = {}) {
        await tgGuard(this, params);
        const to = String(params.to || '').trim();
        const text = String(params.text || '').trim();
        const channel = String(params.channel || 'auto').trim().toLowerCase();
        if (!text || text.length > 3500)
            return { error: 'text: 1–3500 символов' };
        const book = await resolveAddressBook(this);
        const key = Object.keys(book).find(k => k.toLowerCase() === to.toLowerCase());
        if (!key)
            return { error: 'адресат «' + to + '» не в адресной книге; есть: ' + (Object.keys(book).join(', ') || 'пусто') };

        const sender = params.session?.$user?.DATA?.label || params.session?.uid || 'WORK';
        const fullText = text + '\n\n— ' + sender;
        const target = book[key];

        if (channel === 'max' || (typeof target === 'object' && target?.channel === 'max' && channel === 'auto')) {
            const chatId = typeof target === 'object' ? (target.max || target.chatId) : target;
            const res = await maxCall(this, chatId, fullText);
            return res.ok ? { ok: true, to: key, channel: 'max' } : { error: 'MAX: ' + (res.description || 'ошибка') };
        }

        const chatId = typeof target === 'object' ? (target.telegram || target.chatId) : target;
        const res = await tgCall(this, 'sendMessage', { chat_id: chatId, text: fullText, disable_web_page_preview: true });
        return res.ok ? { ok: true, to: key, channel: 'telegram' } : { error: 'Telegram: ' + (res.description || 'ошибка') };
    },

    async updates(params = {}) {
        await this.assertAccess(params, 'ADMIN');
        const res = await tgCall(this, 'getUpdates', { limit: 50, timeout: 0 });
        if (!res.ok)
            return { error: 'Telegram: ' + (res.description || 'ошибка') };
        const seen = new Map();
        for (const u of res.result || []) {
            const c = u.message?.chat || u.my_chat_member?.chat;
            if (c)
                seen.set(c.id, { chat_id: c.id, name: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username, type: c.type });
        }
        return [...seen.values()];
    },
};

const TG_LIMIT_PER_MIN = 20;
const tgRate = new Map();

async function resolveAddressBook(service) {
    const raw = { ...(service.DATA?.chats || service.chats || {}) };
    return raw;
}

/** Только вошедший пользователь сервера с доступом к сервису; ограничение частоты. */
async function tgGuard(service, params) {
    const s = params.session;
    if (s && s.$user !== globalThis.WORK) {
        if (!s.uid || s.principal?.kind === 'node')
            throw new Error('Доступ запрещён');
        if (!(await service.canSee(service, params)))
            throw new Error('Доступ запрещён');
        const now = Date.now();
        const times = (tgRate.get(s.uid) || []).filter(t => now - t < 60_000);
        if (times.length >= TG_LIMIT_PER_MIN)
            throw new Error('Telegram: не больше ' + TG_LIMIT_PER_MIN + ' сообщений в минуту');
        times.push(now);
        tgRate.set(s.uid, times);
    }
}

async function resolveBotTokens(service) {
    const secret = await service.read_secret({ filename: 'telegram.json' }).catch(() => null);
    let tgToken = secret?.token || '';
    let maxToken = secret?.maxToken || '';
    if (!tgToken || !maxToken) {
        try {
            const { pathToFileURL } = await import('node:url');
            const path = await import('node:path');
            const notifyMod = await import(pathToFileURL(path.resolve('sources/modules/notify/index.js')).href);
            const creds = notifyMod.readBotCredentials?.('/');
            if (!tgToken && creds?.telegram?.token)
                tgToken = creds.telegram.token;
            if (!maxToken && creds?.max?.token)
                maxToken = creds.max.token;
        }
        catch { /* ignore */ }
    }
    return { tgToken, maxToken };
}

async function tgCall(service, method, body) {
    const { tgToken: token } = await resolveBotTokens(service);
    if (!token || !/^\d+:[\w-]{20,}$/.test(token))
        return { ok: false, description: 'нет токена бота (#secret/telegram.json {token} или вкладка «Мессенджеры»)' };
    const res = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
    });
    return res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
}

async function maxCall(service, chatId, text) {
    const { maxToken: token } = await resolveBotTokens(service);
    if (!token)
        return { ok: false, description: 'нет токена бота MAX (настройте во вкладке «Мессенджеры» или в #secret/telegram.json {maxToken})' };
    const url = 'https://platform-api.max.ru/messages?chat_id=' + encodeURIComponent(String(chatId));
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: token,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    return res.ok ? { ok: true, result: data } : { ok: false, description: data?.message || ('HTTP ' + res.status) };
}
