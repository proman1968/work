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
 */
export default {
    icon: 'bootstrap:robot',
    label: 'Задачи',
    contentType: 'application/json',
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
