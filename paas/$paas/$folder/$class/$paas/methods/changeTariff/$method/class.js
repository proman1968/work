export default {
    async execute(params = {}, post) {
        const paas = params.$paas || params.$context?.$class || this;
        const body = typeof post === 'string' ? safeParse(post) : (post || {});
        const tariff = String(params.tariff || body.tariff || '').trim();
        console.info('[paas.changeTariff] stub', {
            path: paas?.path || paas?.short,
            type: paas?.type,
            tariff,
        });
        return { ok: true, stub: true, action: 'changeTariff', tariff };
    },
};

function safeParse(s) {
    try { return JSON.parse(s); }
    catch { return null; }
}
