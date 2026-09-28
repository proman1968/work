/**
 * $method prompt — разовый запуск агента на классе (REST: /КЛАСС?prompt&prompt=…[&agent=explore][&model=…][&mode=plan]).
 * Без ленты на диске и без вопросов человеку: подтверждаемые действия отклоняются с объяснением.
 * Длинная сессия с человеком — файл .task (ядро sources/modules/agent/session.js).
 * this.$context — класс исполнения (место: контракт, права, навыки).
 * @returns {Promise<{status: string, content: string}>}
 */
export default {
    async execute(params = {}) {
        const core = await WORK_AGENT_CORE();
        const res = await core.runOnce({
            place: this.$context,
            session: params.session,
            prompt: params.prompt ?? params.post?.prompt ?? params.post,
            model: params.model,
            agent: params.agent,
            mode: ['auto', 'ask', 'plan'].includes(params.mode) ? params.mode : 'auto',
        });
        return { status: res.status, content: res.content };
    },
};
