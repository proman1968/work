export default {
    async execute(params = {}) {
        const H = await globalThis.loadHost('billing-store');
        await H.requireWorkAdmin(params);
        const billing = params.$context || this;
        const wallet = await H.loadWorkFile(billing, 'wallet.json', 'ADMIN') || {
            balance: 0,
            currency: 'RUB',
            updatedAt: Date.now(),
        };
        return { balance: wallet.balance || 0, currency: wallet.currency || 'RUB', updatedAt: wallet.updatedAt };
    },
};
