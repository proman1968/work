export default {
    async execute(params = {}, post) {
        const uid = params.user?.uid;
        if (!uid)
            throw new Error('Требуется авторизация');

        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || this;
        const body = typeof post === 'string' ? P.safeParse(post) : (post || params);
        const data = body?.request || body;
        const check = P.validateProposalData(data, { staticCfg: P.getStaticFields(offering) });
        if (!check.valid)
            return { ok: false, ...check };

        const request = {
            ...check.normalized,
            buyer: uid,
            created: Date.now(),
            status: 'pending',
        };

        await offering.save_file({
            filename: 'proposal.json',
            post: JSON.stringify(request, null, 2),
            encoding: 'utf-8',
            message: request.subdomain || request.planId || 'request',
            role: 'USER',
            user: params.user,
            skip_file_handler: true,
        });

        return { ok: true, request };
    },
};
