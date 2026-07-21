export default {
    async execute(params = {}, post) {
        if (params.user !== globalThis.WORK)
            throw new Error('renew: system only');

        const H = await globalThis.loadHost('billing-store');
        const L = await globalThis.loadHost('licenses');
        const licenses = params.$context || this;
        const body = typeof post === 'string' ? JSON.parse(post || '{}') : (post || params);
        const subject = String(body.subject || '').trim();
        const days = Number(body.days) || 365;

        const lic = await H.loadWorkFile(licenses, `${subject}.lic`, 'ADMIN');
        if (!lic)
            throw new Error('renew: license not found');

        let cfg = await globalThis.WORK.read_secret({ name: 'licenses', user: globalThis.WORK });
        const v = L.verifyLicense(lic, cfg);
        if (!v.ok)
            throw new Error('renew: invalid license');

        const now = Date.now();
        const base = Math.max(lic.header?.expiresAt || now, now);
        lic.header.expiresAt = base + days * 86400000;
        lic.header.renewedAt = now;
        lic.signature = L.signLicense(lic, cfg);
        await H.saveWorkFile(licenses, `${subject}.lic`, lic, { role: 'ADMIN', user: globalThis.WORK });
        return { ok: true, license: lic };
    },
};
