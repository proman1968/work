export default {
    async execute(params = {}) {
        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || this;
        await offering.info?.();
        if (!P.canManageOffering(offering, params))
            throw new Error('Нет доступа');

        const logs = offering.read_log_bodies
            ? await offering.read_log_bodies({ ext: 'json' })
            : [];
        const requests = (logs || [])
            .map(row => {
                const body = typeof row?.content === 'string' ? P.safeParse(row.content) : row?.content;
                return body ? { ...body, logTime: row.time || row.created } : null;
            })
            .filter(Boolean)
            .reverse();
        return { ok: true, requests };
    },
};
