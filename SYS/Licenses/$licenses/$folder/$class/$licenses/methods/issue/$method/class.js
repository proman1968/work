export default {
    async execute(params = {}, post) {
        if (params.user !== globalThis.WORK)
            throw new Error('issue: system only');

        const H = await globalThis.loadHost('billing-store');
        const L = await globalThis.loadHost('licenses');
        const licenses = params.$context || this;
        const body = typeof post === 'string' ? JSON.parse(post || '{}') : (post || params);
        const subject = String(body.subject || body.subdomain || '').trim();
        if (!subject)
            throw new Error('issue: subject required');

        const keys = await L.licenseKeys(globalThis.WORK);
        const lic = L.buildLicense({
            subject,
            planId: String(body.planId || body.tariff || '').trim(),
            holder: body.holder || body.buyer || body.uid,
            terms: body.terms || {},
            days: Number(body.days) || 365,
        }, keys);

        await H.saveWorkFile(licenses, `${subject}.lic`, lic, {
            role: 'ADMIN',
            user: globalThis.WORK,
            message: 'issue ' + subject,
        });
        return { ok: true, license: lic };
    },
};
