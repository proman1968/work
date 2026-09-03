/**
 * $task — хранитель длинной ИИ-сессии (JSON).
 * Способность (pipe/agents) — у $structure/ai/; этот тип делегирует в harness.
 */
const HARNESS_REL = '$server/$folder/$class/$structure/ai/harness.js';

async function loadHarnessMod() {
    const { pathToFileURL } = await import('node:url');
    const path = await import('node:path');
    return import(pathToFileURL(path.join(process.cwd(), HARNESS_REL)).href);
}

async function harnessFor(file) {
    const { createAiHarness } = await loadHarnessMod();
    const owner = file.$owner || file.$class || file.$parent;
    // не кэшируем: on_save мог обновить JSON на диске
    return createAiHarness({ owner, file });
}

export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',
    GET: 'context',

    async prompt(params = {}) {
        return (await harnessFor(this)).prompt(params);
    },
    async stop(params = {}) {
        return (await harnessFor(this)).stop(params);
    },
    async change_model(params = {}) {
        return (await harnessFor(this)).change_model(params);
    },
    async change_effort(params = {}) {
        return (await harnessFor(this)).change_effort(params);
    },
    async remove_block(params = {}) {
        return (await harnessFor(this)).remove_block(params);
    },
    get pipe() {
        return new AsyncPromise(async () => (await harnessFor(this)).pipe);
    },
    get body() {
        return new AsyncPromise(async () => {
            const h = await harnessFor(this);
            const body = await h.body;
            this.body = body;
            return body;
        });
    },
    get model() {
        return new AsyncPromise(async () => (await harnessFor(this)).model);
    },
};
