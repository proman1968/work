export default {
    async execute(params = {}, post) {
        const gen = this.$context.streamChat(params, post);
        let result = '';
        for await (const token of gen) {
            result += typeof token === 'string' ? token : (token?.content || '');
        }
        return result;
    },
};
