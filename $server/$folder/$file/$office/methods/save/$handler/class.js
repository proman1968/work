export default {
    async execute(params = {}) {
        const ctx = this.$item?.$context || this.$context;
        if (ctx && typeof ctx.office_save === 'function')
            return ctx.office_save(params);
        if (ctx)
            ctx.isChanged = false;
        return true;
    }
}
