const PROMPT_REL = '$server/$folder/$class/ai/prompt/$method/class.js';

async function loadPromptMod() {
    const { pathToFileURL } = await import('node:url');
    const path = await import('node:path');
    return import(pathToFileURL(path.join(process.cwd(), PROMPT_REL)).href);
}

export default {
    async execute(params = {}) {
        const file = this.$context;
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
        params.prompt = body.title;
        return file.prompt(params);
    },
};
