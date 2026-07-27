export default {
    async execute(params = {}, post) {
        const uid = params.user?.uid || params.user?.$user?.id;
        if (!uid)
            throw new Error('Требуется авторизация');

        const service = params.$context
            || params.$service
            || (this && typeof this.save_file === 'function' ? this : null)
            || await resolveService(params);
        if (!service?.save_file)
            throw new Error('PaaS-сервис не найден');

        let body = typeof post === 'string' ? safeParse(post) : (post || params.post || params.order || {});
        if (typeof body === 'string')
            body = safeParse(body);
        if (!body || typeof body !== 'object')
            throw new Error('Пустая заявка');

        const tariff = String(body.tariff || '').trim();
        const subdomain = normalizeSubdomain(body.subdomain || body.host || body.name);
        if (!tariff)
            throw new Error('Не выбран тариф');
        const known = ['СТАРТ', 'БИЗНЕС', 'ПРЕДПРИЯТИЕ', 'ENTERPRISE'];
        if (!service.tariffs?.includes?.(tariff) && !known.includes(tariff))
            throw new Error('Неизвестный тариф: ' + tariff);
        if (!subdomain)
            throw new Error('Укажите имя хоста (поддомен)');

        let baseDomain = service.baseDomain ?? service.DATA?.baseDomain;
        if (baseDomain && typeof baseDomain.then === 'function')
            baseDomain = await baseDomain;
        baseDomain = String(baseDomain || '').replace(/^\.+/, '');

        const fqdn = baseDomain ? (subdomain + '.' + baseDomain) : '';
        const url = fqdn ? ('https://' + fqdn) : '';

        const existing = await WORK.get_item('/PAAS/' + subdomain, 0, undefined, { user: globalThis.WORK });
        if (existing?.type === '$paas')
            throw new Error('Имя хоста "' + subdomain + '" уже занято');

        const order = {
            tariff,
            subdomain,
            fqdn,
            url,
            buyer: uid,
            created: Date.now(),
            paasPath: '/PAAS/' + subdomain,
        };

        await service.save_file({
            filename: 'pass.order',
            post: JSON.stringify(order, null, 2),
            encoding: 'utf-8',
            message: order.subdomain + ' / ' + order.tariff,
            user: globalThis.WORK,
            logAuthor: params.user,
            skip_file_handler: true,
        });

        return { ok: true, order };
    },
};

async function resolveService(params) {
    if (params.$service?.save_file)
        return params.$service;
    if (params.$context?.save_file)
        return params.$context;
    return WORK.get_item(params.servicePath || '/SERVICES/ArgoCD/PaaS');
}

function normalizeSubdomain(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^-+|-+$/g, '');
}

function safeParse(s) {
    try { return JSON.parse(s); }
    catch { return null; }
}
