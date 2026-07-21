export default {
    async execute(params = {}, post) {
        const H = await globalThis.loadHost('billing-store');
        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || this;
        await offering.info?.();
        const body = typeof post === 'string' ? P.safeParse(post) : (post || params);
        const planId = body?.planId || params.planId;

        let doc = await H.loadWorkFile(offering, 'plans.json', 'USER');
        if (!doc?.plans)
            doc = P.defaultPlansDocument();
        const plans = doc.plans || [];
        const plan = plans.find(p => p.id === planId) || plans[0];
        return P.buildProposalForm({
            plan,
            staticCfg: P.getStaticFields(offering),
            fields: P.getFormFields(offering),
            values: body?.values || { planId: plan?.id, subdomain: body?.subdomain || '' },
        });
    },
};
