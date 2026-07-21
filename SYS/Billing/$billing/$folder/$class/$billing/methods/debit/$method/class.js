export default {
    async execute(params = {}, post) {
        if (params.user !== globalThis.WORK)
            throw new Error('debit: system only');

        const H = await globalThis.loadHost('billing-store');
        const billing = params.$context || this;
        const body = typeof post === 'string' ? JSON.parse(post || '{}') : (post || params);
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0)
            throw new Error('debit: invalid amount');

        const wallet = await H.loadWorkFile(billing, 'wallet.json', 'ADMIN') || {
            balance: 0, currency: 'RUB',
        };
        const balance = Number(wallet.balance || 0);
        if (balance < amount)
            return { ok: false, reason: 'insufficient funds', balance };

        wallet.balance = balance - amount;
        wallet.updatedAt = Date.now();
        await H.saveWorkFile(billing, 'wallet.json', wallet, { role: 'ADMIN', user: globalThis.WORK });

        const tx = {
            id: body.txId || H.newTxId(),
            type: 'debit',
            source: body.source || 'usage',
            amount,
            currency: wallet.currency || 'RUB',
            status: 'succeeded',
            created: Date.now(),
            metadata: body.metadata || {},
        };
        await H.saveWorkFile(billing, `${tx.id}.tx.json`, tx, { role: 'ADMIN', user: globalThis.WORK });
        return { ok: true, balance: wallet.balance, tx };
    },
};
