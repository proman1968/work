/**
 * on_save .task: новая задача (пустая лента) — первая реплика из params.prompt / body.name и запуск.
 * Повторные сохранения и уже идущая работа — пропуск (замок — в ядре сессии).
 */
export default {
    async execute(params = {}) {
        const file = this.$context;
        await file.init;
        const core = await WORK_AGENT();
        if (core.isRunning(file))
            return { ok: false, skipped: 'уже выполняется' };
        const body = await core.getBody(file);
        if (body.items.length)
            return { ok: false, skipped: 'не новая задача' };
        let location = null;
        try {
            location = params.location ? (typeof params.location === 'string' ? JSON.parse(params.location) : params.location) : (body.location || null);
        }
        catch { location = body.location || null; }
        const tz = params.tz || body.tz || location?.tz || undefined;
        let includes = params.includes;
        try {
            if (typeof includes === 'string')
                includes = JSON.parse(includes);
        }
        catch { includes = [includes]; }
        let attachments = includes;
        if (params.attachments) {
            try {
                attachments = typeof params.attachments === 'string' ? JSON.parse(params.attachments) : params.attachments;
            }
            catch { /* старый/повреждённый формат — сохраняем пути из includes */ }
        }
        const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
        const promptText = params.prompt !== undefined
            ? params.prompt
            : (body.prompt !== undefined ? body.prompt : (hasAttachments && body.name === 'task' ? '' : body.name));
        return core.prompt(file, {
            session: params.session,
            prompt: promptText,
            attachments,
            location,
            ...(tz ? { tz } : {}),
            voice: params.voice ?? body.voice,
        });
    },
};
