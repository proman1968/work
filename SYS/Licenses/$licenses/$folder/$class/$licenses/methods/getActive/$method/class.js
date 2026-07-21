export default {
    async execute(params = {}) {
        const H = await globalThis.loadHost('billing-store');
        const L = await globalThis.loadHost('licenses');
        await H.requireWorkAdmin(params);
        const licenses = params.$context || this;
        const keys = await L.licenseKeys(globalThis.WORK);
        const listed = await H.listWorkFiles(licenses, 'x.lic', 'ADMIN');
        const active = [];
        for (const { id, data: lic } of listed) {
            const v = L.verifyLicense(lic, keys);
            if (!v.ok || L.isExpired(lic)) continue;
            active.push({
                id: lic.header?.id,
                subject: lic.human?.subject,
                planId: lic.human?.planId,
                holder: lic.human?.holder,
                expiresAt: lic.header?.expiresAt,
                file: id,
            });
        }
        return { ok: true, active, count: active.length };
    },
};
