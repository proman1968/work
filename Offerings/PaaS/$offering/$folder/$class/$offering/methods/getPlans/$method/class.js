export default {
    async execute(params = {}) {
        const H = await globalThis.loadHost('billing-store');
        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || this;
        await offering.info?.();

        let doc = await H.loadWorkFile(offering, 'plans.json', 'USER');
        if (!doc?.plans) {
            doc = P.defaultPlansDocument();
            await H.saveWorkFile(offering, 'plans.json', doc, {
                role: 'USER',
                user: globalThis.WORK,
                message: 'seed plans',
            });
        }

        const plans = (doc.plans || [])
            .filter(p => p.visible !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        const cards = plans.map(P.planCardView);
        const defaultPlan = plans.find(p => p.default) || plans[0];
        return {
            plans: cards,
            defaultPlanId: defaultPlan?.id || cards[0]?.id || null,
        };
    },
};
