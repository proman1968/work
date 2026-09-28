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
            location = params.location ? (typeof params.location === 'string' ? JSON.parse(params.location) : params.location) : null;
        }
        catch { /* без геопозиции */ }
        let includes = params.includes;
        try {
            if (typeof includes === 'string')
                includes = JSON.parse(includes);
        }
        catch { includes = [includes]; }
        return core.prompt(file, {
            session: params.session,
            prompt: params.prompt || body.prompt || body.name,
            attachments: includes,
            location,
        });
    },
};
