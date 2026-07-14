/**
 * Триггер on_save для файлов .skill.
 *
 * При сохранении .skill:
 * 1. Проверяет статус — не запускать при pending
 *    (ожидание заполнения полей пользователем)
 * 2. Запускает executeSkill через глобальный __executeSkill
 *
 * executeSkill зарегистрирован в work.js:
 *   globalThis.__executeSkill = executeSkill;
 */

export default {
    label: 'on_save (.skill)',
    icon: 'carbon:skill-level-advanced',
    async execute(params = {}) {
        const storage = this;
        const skillPath = params.logFullPath || params.logPath;
        if (!skillPath) return;

        // Проверяем статус — не запускать при pending
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

        // Находим task.ai, которому принадлежит этот .skill (для планирования)
        const taskPath = normalizePath(params.logFullPath || params.logPath);

        const executeSkill = globalThis.__executeSkill;
        if (typeof executeSkill !== 'function') {
            console.warn('[skill] __executeSkill не зарегистрирован');
            return;
        }

        return executeSkill(skillPath, storage, {
            taskPath,
            logAuthor: params.logAuthor || params.user,
        });
    },
};

function normalizePath(path) {
    if (!path) return null;
    return path.startsWith('/') ? path : '/' + path;
}