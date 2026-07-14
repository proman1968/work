import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

export default {
    async execute(params = {}, post) {
        const streamChatPath = path.join(process.cwd(), 'models/$ai/$folder/$class/$ai/methods/streamChat/$method/class.js');
        const mod = await import(pathToFileURL(streamChatPath).href);
        const streamChatHandler = mod.default;
        const gen = streamChatHandler.execute.call(this, params, post);
        let result = '';
        for await (const token of gen) {
            result += token;
        }
        return result;
    },
};