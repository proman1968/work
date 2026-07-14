export default {
    async execute(params = {}, post) {
        const uid = params.user?.uid || params.user?.$user?.id;
        if (!uid)
            throw new Error('Требуется авторизация');

        const service = params.$service
            || (this && typeof this.save_file === 'function' ? this : null)
            || await resolveService(params);
        if (!service?.save_file)
            throw new Error('PaaS-сервис не найден');

        let body = typeof post === 'string' ? safeParse(post) : (post || params.order || {});
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
        if (!baseDomain)
            throw new Error('Не задан baseDomain в настройках сервиса');

        const fqdn = subdomain + '.' + baseDomain;
        const url = 'https://' + fqdn;

        const existing = await WORK.get_item('/paas/' + subdomain, 0, undefined, { user: globalThis.WORK });
        if (existing?.type === '$paas')
            throw new Error('Имя хоста "' + subdomain + '" уже занято');

        const order = {
            tariff,
            subdomain,
            fqdn,
            url,
            status: 'pending',
            buyer: uid,
            created: Date.now(),
            paasPath: '/paas/' + subdomain,
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

        const methods = await service._methods;
        const provision = methods?.provision;
        let provisionResult = null;
        if (typeof provision?.execute === 'function') {
            provisionResult = await provision.execute({
                $service: service,
                order,
                user: params.user,
            });
        }

        return { ok: true, order, ...provisionResult };
    },
};

async function resolveService(params) {
    if (params.$service?.save_file)
        return params.$service;
    return WORK.get_item(params.servicePath || '/services/ArgoCD/PaaS/prod');
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
