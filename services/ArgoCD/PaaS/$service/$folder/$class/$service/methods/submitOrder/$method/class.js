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

        const product = body.product;
        if (!product || typeof product !== 'object')
            throw new Error('Нет снимка продукта');

        const input = (body.input && typeof body.input === 'object') ? body.input : {};
        const domainName = normalizeDomainName(input.domainName);
        if (!domainName)
            throw new Error('Укажите имя домена');

        const $Link = String(body.$Link || '').trim();
        if (!$Link)
            throw new Error('Нет ссылки на заявку ($Link)');

        const existing = await WORK.get_item('/PAAS/' + domainName, 0, undefined, { user: globalThis.WORK });
        if (existing?.type === '$paas')
            throw new Error('Имя домена "' + domainName + '" уже занято');

        const order = {
            status: '',
            $Link,
            product,
            input: { domainName },
        };

        await service.save_file({
            filename: 'pass.order',
            post: JSON.stringify(order, null, 2),
            encoding: 'utf-8',
            message: domainName + ' / ' + (product.label || product.id || ''),
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

function normalizeDomainName(raw) {
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
