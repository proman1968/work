export default {
    async execute(params = {}, post) {
        if (params.user !== globalThis.WORK)
            throw new Error('creditWallet: system only');

        const H = await globalThis.loadHost('billing-store');
        const Y = await globalThis.loadHost('yookassa');
        const billing = params.$context || this;
        const body = typeof post === 'string' ? JSON.parse(post || '{}') : (post || params);
        const paymentId = body.paymentId || body.object?.id;
        const event = body.event;
        if (!paymentId)
            throw new Error('creditWallet: paymentId required');

        const existing = await H.loadWorkFile(billing, `yk_${paymentId}.tx.json`, 'ADMIN');
        if (existing)
            return { ok: true, duplicate: true };

        let pending = await H.loadWorkFile(billing, `${paymentId}.pending.json`, 'ADMIN');

        const config = await globalThis.WORK.read_secret({ name: 'yookassa', user: globalThis.WORK });
        const remote = await Y.getPayment(config, paymentId);
        if (remote?.status !== 'succeeded')
            return { ok: false, status: remote?.status || event };

        const remoteAmount = Number(remote?.amount?.value);
        if (!Number.isFinite(remoteAmount) || remoteAmount <= 0)
            throw new Error('creditWallet: invalid remote amount');
        if (pending && Number(pending.amount) !== remoteAmount)
            throw new Error('creditWallet: amount mismatch');

        const amount = remoteAmount;
        const uid = remote?.metadata?.uid || pending?.uid;

        if (!Number.isFinite(amount) || amount <= 0)
            throw new Error('creditWallet: invalid amount');

        const wallet = await H.loadWorkFile(billing, 'wallet.json', 'ADMIN') || {
            balance: 0, currency: 'RUB',
        };
        wallet.balance = Number(wallet.balance || 0) + amount;
        wallet.updatedAt = Date.now();
        await H.saveWorkFile(billing, 'wallet.json', wallet, { role: 'ADMIN', user: globalThis.WORK });

        const tx = {
            id: `yk_${paymentId}`,
            type: 'credit',
            source: 'yookassa',
            amount,
            currency: 'RUB',
            paymentId,
            status: 'succeeded',
            created: Date.now(),
            metadata: { uid },
        };
        await H.saveWorkFile(billing, `${tx.id}.tx.json`, tx, { role: 'ADMIN', user: globalThis.WORK });
        return { ok: true, balance: wallet.balance, tx };
    },
};
