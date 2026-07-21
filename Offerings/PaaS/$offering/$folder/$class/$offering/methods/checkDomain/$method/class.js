export default {
    async execute(params = {}, post) {
        const P = await globalThis.loadHost('offering-paas');
        const body = typeof post === 'string' ? P.safeParse(post) : (post || params);
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

        const subdomain = P.normalizeSubdomain(raw);
        const reserved = new Set(['www', 'api', 'mail', 'ftp', 'admin', 'root', 'services', 'paas', 'nodes', 'sys', 'offerings']);
        if (reserved.has(subdomain))
            return { valid: false, message: 'Имя занято системой' };

        const existing = await WORK.get_item('/paas/' + subdomain, 0, undefined, { user: globalThis.WORK });
        if (existing?.type === '$paas')
            return { valid: false, message: 'Имя уже занято' };

        return { valid: true };
    },
};
