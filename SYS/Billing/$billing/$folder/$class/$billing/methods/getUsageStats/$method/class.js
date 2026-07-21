export default {
    async execute(params = {}) {
        const H = await globalThis.loadHost('billing-store');
        await H.requireWorkAdmin(params);
        const billing = params.$context || this;
        const usage = await H.loadWorkFile(billing, 'usage.json', 'ADMIN') || { days: [] };
        const days = Array.isArray(usage.days) ? usage.days : [];
        const totals = days.reduce((acc, d) => {
            acc.requests += d.requests || 0;
            acc.aiCalls += d.aiCalls || 0;
            acc.bytesIn += d.bytesIn || 0;
            acc.bytesOut += d.bytesOut || 0;
            return acc;
        }, { requests: 0, aiCalls: 0, bytesIn: 0, bytesOut: 0 });
        return { ok: true, totals, days };
    },
};
