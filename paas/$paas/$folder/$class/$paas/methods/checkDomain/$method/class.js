export default {
    async execute(params = {}, post) {
        const body = typeof post === 'string' ? safeParse(post) : (post || params);
        const raw = String(body?.subdomain ?? body?.name ?? params.subdomain ?? '').trim();

        if (!raw)
            return { valid: false, message: 'Укажите имя хоста' };
        if (raw.length < 2)
            return { valid: false, message: 'Слишком короткое имя (минимум 2 символа)' };
        if (raw.length > 63)
            return { valid: false, message: 'Слишком длинное имя (максимум 63 символа)' };
        if (/[^a-zA-Z0-9-]/.test(raw))
            return { valid: false, message: 'Допустимы только латинские буквы, цифры и дефис' };
        if (/^-+|-+$/.test(raw))
            return { valid: false, message: 'Имя не должно начинаться или заканчиваться дефисом' };

        const subdomain = raw.toLowerCase();
        const reserved = new Set(['www', 'api', 'mail', 'ftp', 'admin', 'root', 'services', 'paas', 'nodes']);
        if (reserved.has(subdomain))
            return { valid: false, message: 'Имя занято системой' };

        const existing = await WORK.get_item('/PAAS/' + subdomain, 0, undefined, { user: globalThis.WORK });
        if (existing?.type === '$paas')
            return { valid: false, message: 'Имя уже занято' };

        return { valid: true };
    },
};

function safeParse(s) {
    try { return JSON.parse(s); }
    catch { return null; }
}
