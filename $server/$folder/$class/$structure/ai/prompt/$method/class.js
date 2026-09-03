/**

 * Тонкий вход: /STRUCTURE?prompt&agent=web&prompt=…

 * One-shot: не session harness, не .task; items — для вставки в ленту.

 */

const PROMPT_REL = '$server/$folder/$class/$structure/ai/prompt.js';



export default {

    async execute(params = {}) {
debugger;
        const owner = this.$context;

        if (!owner)

            return { ok: false, error: 'ai/prompt: нет $context' };



        const { pathToFileURL } = await import('node:url');

        const path = await import('node:path');

        const { runPrompt } = await import(

            pathToFileURL(path.join(process.cwd(), PROMPT_REL)).href

        );

        return runPrompt({ owner, ...params });

    },

};

