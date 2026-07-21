export default {
    async execute(params = {}, post) {
        if (params.user !== globalThis.WORK)
            throw new Error('recordUsage: system only');

        const H = await globalThis.loadHost('billing-store');
        const billing = params.$context || this;
        const body = typeof post === 'string' ? JSON.parse(post || '{}') : (post || params);
        const date = body.date || new Date().toISOString().slice(0, 10);
        const usage = await H.loadWorkFile(billing, 'usage.json', 'ADMIN') || { days: [] };
        if (!Array.isArray(usage.days))
            usage.days = [];

        let day = usage.days.find(d => d.date === date);
        if (!day) {
            day = { date, requests: 0, aiCalls: 0, bytesIn: 0, bytesOut: 0 };
            usage.days.push(day);
        }
        day.requests += body.requests || 0;
        day.aiCalls += body.aiCalls || 0;
        day.bytesIn += body.bytesIn || 0;
        day.bytesOut += body.bytesOut || 0;
        day.updatedAt = Date.now();
        usage.updatedAt = Date.now();

        await H.saveWorkFile(billing, 'usage.json', usage, { role: 'ADMIN', user: globalThis.WORK });
        return { ok: true, usage: day };
    },
};
