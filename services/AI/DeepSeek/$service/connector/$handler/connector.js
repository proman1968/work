import { Agent } from 'node:https';
import { LLMClient } from "../../../../../../dist/ai-client/ai-client.js";

const BASE_URL = 'https://api.deepseek.com';
const CHAT_PATH = '/chat/completions';
const MODEL = 'deepseek-chat';

export default class DeepSeek extends LLMClient {
    constructor(config) {
        config.baseURL ??= BASE_URL;
        config.chatPath ??= CHAT_PATH;
        config.chatModel ??= MODEL;
        config.agent = new Agent({ rejectUnauthorized: false });
        super(config);
    }
}