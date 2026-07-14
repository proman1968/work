export default {
    async execute(params, post) {
        const skillPath = params.skillPath || params.path;
        if (!skillPath)
            throw new Error('skillPath обязателен');
        const taskPath = params.taskPath || null;
        const logAuthor = params.user || params.logAuthor;
        const executeSkill = globalThis.__executeSkill;
        if (typeof executeSkill !== 'function')
            throw new Error('__executeSkill не зарегистрирован');
        return executeSkill(skillPath, this, { taskPath, logAuthor });
    },
};