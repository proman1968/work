/**
 * Telegram — уведомления в Telegram через бота организации.
 *
 * Настройка (администратор):
 *  - токен бота (от @BotFather) — секрет `#secret/telegram.json` этого сервиса: { "token": "…" }
 *    (save_secret, в class.js токена нет);
 *  - адресная книга `chats` ниже: имя → chat_id (id узнаётся, когда человек напишет боту /start;
 *    метод updates покажет последние обращения);
 *  - доступ — роли на класс /SERVICES/Telegram (кому можно слать).
 * Сообщение — только адресатам из книги: агент не пишет произвольным chat_id.
 */
export default {
    icon: 'bootstrap:telegram',
    label: 'Telegram',
    description: 'Уведомления в Telegram через бота организации (адресаты — из адресной книги сервиса)',
    capabilities: ['notify', 'telegram'],
    enabled: true,

    /** Адресная книга: { "Иванов И.И.": 123456789, "Отдел продаж": -1001234567890 } */
    chats: {},

    SCHEMA: {
        send_message: {
            description: 'Отправить короткое уведомление в Telegram адресату из адресной книги сервиса',
            params: {
                type: 'object',
                properties: {
                    to: { type: 'string', description: 'Имя адресата из адресной книги' },
                    text: { type: 'string', description: 'Текст (до 3500 символов, без секретов)' },
                },
                required: ['to', 'text'],
            },
        },
        contacts: {
            readonly: true,
            description: 'Адресаты Telegram из адресной книги сервиса',
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
        return Object.keys(this.DATA?.chats || this.chats || {});
    },

    async send_message(params = {}) {
        await tgGuard(this, params);
        const to = String(params.to || '').trim();
        const text = String(params.text || '').trim();
        if (!text || text.length > 3500)
            return { error: 'text: 1–3500 символов' };
        const book = this.DATA?.chats || this.chats || {};
        const key = Object.keys(book).find(k => k.toLowerCase() === to.toLowerCase());
        if (!key)
            return { error: 'адресат «' + to + '» не в адресной книге; есть: ' + (Object.keys(book).join(', ') || 'пусто') };
        const sender = params.session?.$user?.DATA?.label || params.session?.uid || 'WORK';
        const res = await tgCall(this, 'sendMessage', { chat_id: book[key], text: text + '\n\n— ' + sender, disable_web_page_preview: true });
        return res.ok ? { ok: true, to: key } : { error: 'Telegram: ' + (res.description || 'ошибка') };
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

async function tgCall(service, method, body) {
    const secret = await service.read_secret({ filename: 'telegram.json' });
    const token = secret?.token;
    if (!token || !/^\d+:[\w-]{20,}$/.test(token))
        return { ok: false, description: 'нет токена бота (#secret/telegram.json {token})' };
    const res = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
    });
    return res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
}
