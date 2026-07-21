export default {
    async execute(params = {}, post) {
        const H = await globalThis.loadHost('billing-store');
        const L = await globalThis.loadHost('licenses');
        await H.requireWorkAdmin(params);
        const licenses = params.$context || this;
        const body = typeof post === 'string' ? JSON.parse(post || '{}') : (post || params);
        const subject = String(body.subject || body.subdomain || '').trim();
        const metric = body.metric || 'users';
        const value = Number(body.value ?? 1);

        const lic = await H.loadWorkFile(licenses, `${subject}.lic`, 'ADMIN');
        if (!lic)
            return { ok: true, allowed: true, reason: 'no license (soft)' };

        const keys = await globalThis.WORK.read_secret({ name: 'licenses', user: globalThis.WORK });
        const v = L.verifyLicense(lic, keys);
        if (!v.ok)
            return { ok: false, allowed: false, reason: v.reason };
        if (L.isExpired(lic))
            return { ok: false, allowed: false, reason: 'expired' };

        const limit = lic.terms?.limits?.[metric];
        if (limit == null)
            return { ok: true, allowed: true };
        return { ok: true, allowed: value <= limit, limit, value, metric };
    },
};
