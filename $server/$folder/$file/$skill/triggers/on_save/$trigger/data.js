export default {
    async execute(params) {
        const skillPath = params.logFullPath || params.logPath;
        if (!skillPath) return;
        // Проверяем статус — не запускать при pending (ожидание заполнения полей)
        try {
            const skillItem = await WORK.get_item(skillPath);
            if (skillItem?.load) {
                const raw = await skillItem.load();
                const skill = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (skill?.status === 'pending')
                    return;
            }
        }
        catch { /* ignore — запускаем */ }
        const taskPath = params.logFullPath
            || (params.logPath?.startsWith('/') ? params.logPath : params.logPath ? '/' + params.logPath : null);
        // executeSkill зарегистрирован в глобале ядром (data: URL не может import)
        const exec = globalThis.__executeSkill;
        if (typeof exec !== 'function') {
            console.warn('[skill on_save] executeSkill не зарегистрирован');
            return;
        }
        return exec(skillPath, this, {
            taskPath,
            logAuthor: params.logAuthor || params.user,
        });
    }
};