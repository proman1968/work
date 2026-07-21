let buffer = {
    requests: 0,
    aiCalls: 0,
    bytesIn: 0,
    bytesOut: 0,
    started: Date.now(),
};
let timer;
const FLUSH_MS = 60_000;

export function recordRequest({ bytesIn = 0, bytesOut = 0 } = {}) {
    buffer.requests += 1;
    buffer.bytesIn += bytesIn;
    buffer.bytesOut += bytesOut;
}

export function recordAiCall(count = 1) {
    buffer.aiCalls += count;
}

async function flushUsage() {
    const snap = { ...buffer, flushedAt: Date.now(), date: new Date().toISOString().slice(0, 10) };
    buffer = { requests: 0, aiCalls: 0, bytesIn: 0, bytesOut: 0, started: Date.now() };

    if (!globalThis.WORK?.get_item) return;
    try {
        const billing = await globalThis.WORK.get_item('/SYS/Billing', 0, undefined, { user: globalThis.WORK });
        const methods = await billing?._methods;
        if (methods?.recordUsage?.execute)
            await methods.recordUsage.execute({ user: globalThis.WORK, $context: billing }, snap);
    }
    catch (e) {
        if (process.env.WORK_DEV)
            console.warn('[stats-collector] recordUsage:', e.message);
    }
}

export function startStatsCollector() {
    if (timer) return;
    timer = setInterval(() => flushUsage().catch(console.error), FLUSH_MS);
    if (typeof timer.unref === 'function')
        timer.unref();
}
