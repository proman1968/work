export default {
    label: 'on_save (.order)',
    icon: 'carbon:flow',
    async execute(params = {}) {
        const orderFile = params.$context;
        if (!orderFile) return;

        let body;
        try {
            const raw = await orderFile.load({ encoding: 'utf-8' });
            body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch { return; }

        if (!body || (body.status && body.status !== 'pending'))
            return;

        const service = orderFile.$class || orderFile.$owner || orderFile.$class
            || await WORK.get_item('/SERVICES/ArgoCD/PaaS/prod');
        if (!service) return;

        const methods = await service._methods;
        const provision = methods?.provision;
        if (typeof provision?.execute !== 'function') {
            console.warn('[paas.req] provision method not found');
            return;
        }

        provision.execute({
            $context: orderFile,
            $service: service,
            order: body,
            user: params.user,
        }).catch(e => {
            console.warn('[paas.req] provision error:', e.message);
        });
    },
};
