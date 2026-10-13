export default {
    async execute(params = {}, post) {
        const gen = this.$context.streamChat(params, post);
        let result = '';
        for await (const token of gen) {
            if (typeof token === 'string')
                result += token;
        }
        return result;
    },
};
