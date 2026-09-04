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
        const { buildSystemPrompt } = await loadPromptMod();
        body.system = await buildSystemPrompt({
            owner: this.$owner,
            session: params.session,
            role: params.role,
            location: params.location,
        });

        await WORK.fsp.writeFile(file.dir, JSON.stringify(body, null, 4), 'utf-8');
        await file.init;
        params.prompt = body.title;
        return file.prompt(params);
    },
};
