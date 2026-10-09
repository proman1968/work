/**
 * $task — сессия агента (JSON, версия 2): тонкий хост над ядром sources/modules/agent/session.js.
 * Лента, цикл, инструменты, разрешения — в ядре; здесь — API файла для UI и REST.
 *
 * Методы (UI: $item.fetch(method, params)):
 *   prompt({ prompt, attachments, mode, model })   — реплика человека / ответ на вопрос / «продолжить» (пусто)
 *   approve({ call, accept, always, content, values }) — подтверждение вызова или ответ формой
 *   unqueue({ id })                                — убрать реплику из очереди (отправлена во время работы)
 *   stop()                                         — стоп
 *   revert({ id })                                 — откат ленты к реплике → { prompt, attachments }
 *   configure({ model, effort, mode })             — настройки
 *   compact()                                      — сжать контекст
 *   state()                                        — тело + running
 *   voice_config() / voice_speak({ text }) / voice_transcribe(WAV) — голосовой режим (см. sources/modules/agent/voice.js)
 */
export default {
    icon: 'bootstrap:robot',
    label: 'Задачи',
    contentType: 'application/json',
    point: true,
    METADATA: {},

    async prompt(params = {}) {
        return (await WORK_AGENT()).prompt(this, params);
    },
    async approve(params = {}) {
        return (await WORK_AGENT()).approve(this, params);
    },
    /** Карточка подключения: данные вводит человек → { auth_url } окна входа или { ok } (токен). Не пишется в ленту. */
    async connect_start(params = {}) {
        return (await WORK_AGENT()).connectStart(this, params);
    },
    async unqueue(params = {}) {
        return (await WORK_AGENT()).unqueue(this, params);
    },
    async stop(params = {}) {
        return (await WORK_AGENT()).stop(this, params);
    },
    async revert(params = {}) {
        return (await WORK_AGENT()).revert(this, params);
    },
    async configure(params = {}) {
        return (await WORK_AGENT()).configure(this, params);
    },
    async compact(params = {}) {
        return (await WORK_AGENT()).compact(this, params);
    },
    /** @deprecated configure({ model }) */
    async change_model(params = {}) {
        return (await WORK_AGENT()).configure(this, { session: params.session, model: params.model ?? params.post?.model });
    },
    /** @deprecated configure({ effort }) */
    async change_effort(params = {}) {
        return (await WORK_AGENT()).configure(this, { session: params.session, effort: params.effort ?? params.post?.effort });
    },
    /** Голосовой режим: что доступно ({ tts, stt, lang }). Нет моделей — клиент работает на речи браузера. */
    async voice_config(params = {}) {
        await this.assertAccess(params, 'read');
        return (await WORK_AGENT_CORE()).voice.voiceConfig(this);
    },
    /** Внешний вид персонажа агента (ai/config.js `dot`): { color, eyes, accessory }. */
    async dot_look(params = {}) {
        await this.assertAccess(params, 'read');
        return (await WORK_AGENT_CORE()).voice.dotLook(this);
    },
    /** Синтез речи: ?voice_speak&text=… → WAV (24 кГц). Ключи модели остаются на сервере. */
    async voice_speak(params = {}) {
        await this.assertAccess(params, 'read');
        const text = params.text ?? (typeof params.post === 'string' ? params.post : params.post?.text);
        return (await WORK_AGENT_CORE()).voice.speak(this, { text, language: params.language, instructions: params.instructions });
    },
    /** Распознавание речи: тело запроса — WAV (16 кГц, моно) → { text }. */
    async voice_transcribe(params = {}) {
        await this.assertAccess(params, 'read');
        const audio = Buffer.isBuffer(params.post) ? params.post : null;
        return (await WORK_AGENT_CORE()).voice.transcribe(this, { audio, language: params.language });
    },
    /** { running, body } — тело не на верхнем уровне: клиентский WORK.__bind принял бы {type:'task'} за элемент дерева и склеил ответы разных задач. */
    async state(params = {}) {
        const core = await WORK_AGENT();
        const body = await core.getBody(this);
        return { running: core.isRunning(this), body };
    },
    get body() {
        return WORK_AGENT().then(core => core.getBody(this));
    },
};
