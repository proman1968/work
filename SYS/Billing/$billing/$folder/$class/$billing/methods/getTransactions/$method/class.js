export default {
    async execute(params = {}) {
        const H = await globalThis.loadHost('billing-store');
        await H.requireWorkAdmin(params);
        const billing = params.$context || this;
        const listed = await H.listWorkFiles(billing, 'x.tx.json', 'ADMIN');
        const transactions = listed
            .map(x => x.data)
            .filter(Boolean)
            .sort((a, b) => (b.created || 0) - (a.created || 0))
            .slice(0, 100);
        return { ok: true, transactions };
    },
};
