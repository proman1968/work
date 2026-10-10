/**
 * $method prompt — разовый запуск агента на классе (REST: /КЛАСС?prompt&prompt=…[&agent=explore][&model=…][&mode=plan]).
 * Без ленты на диске и без вопросов человеку: подтверждаемые действия отклоняются с объяснением.
 * Длинная сессия с человеком — файл .task (ядро sources/modules/agent/session.js).
 * this.$context — класс исполнения (место: контракт, права, навыки).
 * @returns {Promise<{status: string, content: string}>}
 */
const MAX_PROMPT = 20000;
const TIMEOUT_MS = 10 * 60 * 1000;

/** `?prompt&prompt=текст` и тело запроса: берём последнюю непустую строку. */
function promptOf(params) {
    const raw = [params.prompt, params.post?.prompt, typeof params.post === 'string' ? params.post : null].flat();
    return raw.filter(s => typeof s === 'string' && s.trim()).at(-1)?.trim() || '';
}

const text = v => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export default {
    async execute(params = {}) {
        const prompt = promptOf(params);
        if (!prompt)
            throw new Error('prompt: пустой запрос — передай prompt=… или текст в теле запроса');
        if (prompt.length > MAX_PROMPT)
            throw new Error('prompt: слишком длинный запрос (' + prompt.length + ' > ' + MAX_PROMPT + ' символов)');
        const core = await WORK_AGENT_CORE();
        const signal = params.signal instanceof AbortSignal
            ? AbortSignal.any([params.signal, AbortSignal.timeout(TIMEOUT_MS)])
            : AbortSignal.timeout(TIMEOUT_MS);
        const res = await core.runOnce({
            place: this.$context,
            session: params.session,
            prompt,
            model: text(params.model),
            agent: text(params.agent),
            mode: ['auto', 'ask', 'plan'].includes(params.mode) ? params.mode : 'auto',
            signal,
        });
        return { status: res.status, content: res.content };
    },
};
