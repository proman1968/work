export default {
    async execute(params = {}, post) {
        const t0 = Date.now();
        const gen = this.$context.streamChat(params, post);
        let result = '';
        let usage = null;
        for await (const token of gen) {
            if (typeof token === 'string')
                result += token;
            else if (token?.type === 'usage')
                usage = token;
        }
        if (params?.metrics || post?.metrics) {
            const durationMs = Math.max(1, Date.now() - t0);
            const ttftMs = Number(usage?.ttftMs) || 0;
            const completionTokens = Number(usage?.completion_tokens) || 0;
            const tokPerSec = Number(usage?.tokPerSec)
                || (completionTokens > 0 ? +((completionTokens * 1000) / Math.max(1, durationMs - ttftMs)).toFixed(1) : 0);
            return {
                text: result,
                durationMs,
                ttftMs,
                tokPerSec,
                promptTokPerSec: Number(usage?.promptTokPerSec) || 0,
                usage,
            };
        }
        return result;
    },
};
