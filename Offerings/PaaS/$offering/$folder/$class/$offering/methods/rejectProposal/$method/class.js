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

        proposal.status = 'rejected';
        proposal.rejectedAt = Date.now();
        proposal.rejectedBy = params.user?.uid;
        proposal.rejectReason = body.reason || '';

        await offering.save_file({
            filename: 'proposal.json',
            post: JSON.stringify(proposal, null, 2),
            encoding: 'utf-8',
            message: 'rejected: ' + proposal.subdomain,
            role: 'USER',
            user: globalThis.WORK,
            logAuthor: params.user,
            skip_file_handler: true,
        });

        return { ok: true, proposal };
    },
};
