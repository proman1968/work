export default {
    async execute(params = {}, post) {
        const L = await globalThis.loadHost('licenses');
        const body = typeof post === 'string' ? JSON.parse(post || '{}') : (post || params);
        const lic = body?.license || body;
        if (!lic?.header)
            return { ok: false, reason: 'invalid format' };
        const keys = await globalThis.WORK.read_secret({ name: 'licenses', user: globalThis.WORK });
        const v = L.verifyLicense(lic, keys);
        if (!v.ok)
            return { ok: false, reason: v.reason || 'verify failed' };
        if (L.isExpired(lic))
            return { ok: false, reason: 'expired', expiresAt: lic.header.expiresAt };
        return { ok: true, license: lic, anchor: v.anchor };
    },
};
