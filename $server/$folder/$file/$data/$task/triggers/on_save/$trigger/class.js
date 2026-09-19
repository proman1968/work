const PROMPT_REL = '$server/$folder/$class/ai/prompt/$method/class.js';

async function loadPromptMod() {
    const { pathToFileURL } = await import('node:url');
    const path = await import('node:path');
    return import(pathToFileURL(path.join(process.cwd(), PROMPT_REL)).href);
}

/** Файлы, по которым уже крутится prompt: повторный вход пропускаем (двойные сейвы, гонки). */
const RUNNING = new Set();

export default {
    async execute(params = {}) {
        const file = this.$context;
        const key = file?.dir || file?.path || null;
        if (key && RUNNING.has(key))
            return { ok: false, skipped: 'prompt уже выполняется для ' + key };
        if (key)
            RUNNING.add(key);
        try {
            const raw = await file.load({ encoding: 'utf-8' });
            const body = JSON.parse(raw);
            const mod = await loadPromptMod();
            const prompt = Object.create(mod.default);
            prompt.$context = this.$owner;
            body.system = await prompt.buildSystemPrompt({
                session: params.session,
                location: params.location,
            });

            await WORK.fsp.writeFile(file.dir, JSON.stringify(body, null, 4), 'utf-8');
            await file.init;
            params.prompt = body.name;
            return file.prompt(params);
        }
        finally {
            if (key)
                RUNNING.delete(key);
        }
    },
};
