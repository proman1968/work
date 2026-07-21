export default {
    async execute(params = {}, post) {
        const H = await globalThis.loadHost('billing-store');
        const Y = await globalThis.loadHost('yookassa');
        await H.requireWorkAdmin(params);
        const billing = params.$context || this;

        const body = typeof post === 'string' ? JSON.parse(post || '{}') : (post || params);
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0)
            throw new Error('Укажите сумму пополнения');

        const config = await globalThis.WORK.read_secret({ name: 'yookassa', user: params.user });
        const txId = H.newTxId();
        const uid = params.user?.uid;
        const payment = await Y.createPayment(config, { amount, txId, metadata: { uid, txId } });
        const paymentId = payment?.id;
        if (!paymentId)
            throw new Error('ЮKassa не вернула payment id');

        await H.saveWorkFile(billing, `${paymentId}.pending.json`, {
            paymentId, txId, amount, currency: 'RUB', status: 'pending', uid, created: Date.now(),
        }, { role: 'ADMIN', user: globalThis.WORK, message: 'pending ' + paymentId });

        return {
            ok: true,
            paymentId,
            txId,
            confirmationUrl: payment?.confirmation?.confirmation_url,
        };
    },
};
