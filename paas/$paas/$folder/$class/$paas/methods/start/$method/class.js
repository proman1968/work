export default {
    async execute(params = {}) {
        const paas = params.$paas || params.$context?.$class || this;
        console.info('[paas.start] stub', {
            path: paas?.path || paas?.short,
            type: paas?.type,
        });
        return { ok: true, stub: true, action: 'start' };
    },
};
