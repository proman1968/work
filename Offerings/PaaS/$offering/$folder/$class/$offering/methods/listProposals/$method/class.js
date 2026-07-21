export default {
    async execute(params = {}) {
        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || this;
        await offering.info?.();
        if (!P.canManageOffering(offering, params))
            throw new Error('Нет доступа к заявкам');

        const logs = offering.read_log_bodies
            ? await offering.read_log_bodies({ ext: 'json' })
            : [];
        const proposals = (logs || [])
            .map(row => {
                const body = typeof row?.content === 'string' ? P.safeParse(row.content) : row?.content;
                if (!body) return null;
                return { ...body, logId: row.id || row.path, logTime: row.time || row.created };
            })
            .filter(Boolean)
            .reverse();
        return { ok: true, proposals };
    },
};
