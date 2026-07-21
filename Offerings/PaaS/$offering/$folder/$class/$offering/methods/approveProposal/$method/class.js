async function systemMethod(path, method, post = {}) {
    const item = await WORK.get_item(path, 0, undefined, { user: globalThis.WORK });
    const methods = await item?._methods;
    const handler = methods?.[method];
    if (!handler?.execute)
        throw new Error(`Method ${method} not found on ${path}`);
    return handler.execute({ user: globalThis.WORK, $context: item }, post);
}

export default {
    async execute(params = {}, post) {
        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || this;
        await offering.info?.();
        if (!P.canManageOffering(offering, params))
            throw new Error('Нет доступа');

        const body = typeof post === 'string' ? P.safeParse(post) : (post || params);
        const proposal = body?.proposal || body;
        if (!proposal?.subdomain)
            throw new Error('proposal required');

        await systemMethod('/SYS/Licenses', 'issue', {
            subject: proposal.subdomain,
            planId: proposal.planId,
            holder: proposal.buyer,
            terms: { limits: proposal.limits || {} },
        });

        const methods = await offering._methods;
        let provisionResult = null;
        if (typeof methods?.provision?.execute === 'function') {
            provisionResult = await methods.provision.execute({
                $context: offering,
                $offering: offering,
                proposal,
                user: params.user,
            });
        }

        proposal.status = 'approved';
        proposal.approvedAt = Date.now();
        proposal.approvedBy = params.user?.uid;

        await offering.save_file({
            filename: 'proposal.json',
            post: JSON.stringify(proposal, null, 2),
            encoding: 'utf-8',
            message: 'approved: ' + proposal.subdomain,
            role: 'USER',
            user: globalThis.WORK,
            logAuthor: params.user,
            skip_file_handler: true,
        });

        return { ok: true, proposal, provision: provisionResult };
    },
};
