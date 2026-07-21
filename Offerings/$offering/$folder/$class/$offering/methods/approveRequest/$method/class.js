export default {
    async execute(params = {}, post) {
        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || this;
        await offering.info?.();
        if (!P.canManageOffering(offering, params))
            throw new Error('Нет доступа');

        const body = typeof post === 'string' ? P.safeParse(post) : (post || params);
        const request = body?.request || body;
        request.status = 'approved';
        request.approvedAt = Date.now();
        request.approvedBy = params.user?.uid;

        await offering.save_file({
            filename: 'proposal.json',
            post: JSON.stringify(request, null, 2),
            encoding: 'utf-8',
            message: 'approved request',
            role: 'USER',
            user: globalThis.WORK,
            logAuthor: params.user,
            skip_file_handler: true,
        });
        return { ok: true, request };
    },
};
