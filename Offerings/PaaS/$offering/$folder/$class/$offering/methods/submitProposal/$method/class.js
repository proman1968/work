export default {
    async execute(params = {}, post) {
        const uid = params.user?.uid;
        if (!uid)
            throw new Error('Требуется авторизация');

        const H = await globalThis.loadHost('billing-store');
        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || this;
        await offering.info?.();
        if (!offering?.save_file)
            throw new Error('Offering не найден');

        const body = typeof post === 'string' ? P.safeParse(post) : (post || params);
        const data = body?.proposal || body;
        let doc = await H.loadWorkFile(offering, 'plans.json', 'USER');
        const plan = (doc?.plans || []).find(p => p.id === data?.planId);
        const check = P.validateProposalData(data, { staticCfg: P.getStaticFields(offering), plan });
        if (!check.valid)
            return { ok: false, ...check };

        const existing = await WORK.get_item('/paas/' + check.normalized.subdomain, 0, undefined, { user: globalThis.WORK });
        if (existing?.type === '$paas')
            throw new Error('Имя хоста уже занято');

        const proposal = {
            ...check.normalized,
            buyer: uid,
            created: Date.now(),
            paasPath: '/paas/' + check.normalized.subdomain,
            status: 'pending',
        };

        await offering.save_file({
            filename: 'proposal.json',
            post: JSON.stringify(proposal, null, 2),
            encoding: 'utf-8',
            message: proposal.subdomain + ' / ' + proposal.planId,
            role: 'USER',
            user: params.user,
            skip_file_handler: true,
        });

        return { ok: true, proposal };
    },
};
