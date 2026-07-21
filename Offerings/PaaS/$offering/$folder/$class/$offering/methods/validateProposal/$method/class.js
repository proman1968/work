export default {
    async execute(params = {}, post) {
        const H = await globalThis.loadHost('billing-store');
        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || this;
        await offering.info?.();
        const body = typeof post === 'string' ? P.safeParse(post) : (post || params);
        const data = body?.proposal || body;
        let doc = await H.loadWorkFile(offering, 'plans.json', 'USER');
        const plan = (doc?.plans || []).find(p => p.id === data?.planId);
        return P.validateProposalData(data, { staticCfg: P.getStaticFields(offering), plan });
    },
};
