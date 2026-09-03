/**
 * One-shot prompt: не создаёт .task; возвращает items для вставки в ленту.
 * ?prompt → answerOnce; ?prompt&agent=web → runAgent.
 */
const HARNESS_REL = '$server/$folder/$class/$structure/ai/harness.js';

async function loadHarness() {
    const { pathToFileURL } = await import('node:url');
    const path = await import('node:path');
    return import(pathToFileURL(path.join(process.cwd(), HARNESS_REL)).href);
}

export async function runPrompt(params = {}) {
    const owner = params.owner;
    if (!owner)
        return { ok: false, error: 'prompt: нет owner' };

    const { buildSystemPrompt, createRuntime, answerOnce, runAgent } = await loadHarness();
    const system = await buildSystemPrompt({
        owner,
        session: params.session,
        role: params.role,
        location: params.location,
    });
    const runtime = createRuntime({
        owner,
        system,
        model: params.model || '',
        effort: params.effort || '',
        tz: params.tz || '',
    });
    const body = await runtime.body;
    body.system = system;
    if (params.model)
        body.model = params.model;
    if (params.effort)
        body.effort = params.effort;
    if (params.tz)
        body.tz = params.tz;

    if (params.agent)
        return runAgent(runtime, params);
    return answerOnce(runtime, params);
}
