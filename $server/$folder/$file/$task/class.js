/**
 * $task — сессия агента (JSON, версия 2): тонкий хост над ядром sources/modules/agent/session.js.
 * Лента, цикл, инструменты, разрешения — в ядре; здесь — API файла для UI и REST.
 *
 * Методы (UI: $item.fetch(method, params)):
 *   prompt({ prompt, attachments, mode, model })   — реплика человека / ответ на вопрос / «продолжить» (пусто)
 *   approve({ call, accept, always, content, values }) — подтверждение вызова или ответ формой
 *   unqueue({ id })                                — убрать реплику из очереди (отправлена во время работы)
 *   stop()                                         — стоп
 *   revert({ id, dry?, files? })                   — откат ленты к реплике → { prompt, attachments }; dry — только список изменённых агентом файлов;
 *                                                    files — заодно вернуть эти файлы → { files: { reverted, skipped } }
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
        await this._ensureVoiceModelsFresh();
        const core = await WORK_AGENT();
        let p = params;
        if (typeof p.post === 'string') {
            try { p = { ...JSON.parse(p.post), ...p }; } catch { /* ignore */ }
        }
        else if (p.post && typeof p.post === 'object') {
            p = { ...p.post, ...p };
        }
        const isInterrupt = p.interrupt === true || p.interrupt === 'true';
        if (isInterrupt && core.isRunning(this) && typeof core.interrupt !== 'function') {
            await core.stop(this, params);
            const body = await core.getBody(this);
            const spokenText = typeof p.spokenText === 'string' ? p.spokenText.trim() : '';
            const lastAsst = [...(body.items || [])].reverse().find(i => i.type === 'assistant' && !i.error);
            if (lastAsst) {
                if (spokenText) {
                    lastAsst.fullContent ??= lastAsst.content;
                    lastAsst.content = spokenText;
                }
                lastAsst.interrupted = true;
            }
        }
        return core.prompt(this, params);
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
    async interrupt(params = {}) {
        const core = await WORK_AGENT();
        if (typeof core.interrupt === 'function')
            return core.interrupt(this, params);
        let p = params;
        if (typeof p.post === 'string') {
            try { p = { ...JSON.parse(p.post), ...p }; } catch { /* ignore */ }
        }
        else if (p.post && typeof p.post === 'object') {
            p = { ...p.post, ...p };
        }
        const res = await core.stop(this, params);
        const body = await core.getBody(this);
        const spokenText = typeof p.spokenText === 'string' ? p.spokenText.trim() : '';
        const lastAsst = [...(body.items || [])].reverse().find(i => i.type === 'assistant' && !i.error);
        if (lastAsst) {
            if (spokenText) {
                lastAsst.fullContent ??= lastAsst.content;
                lastAsst.content = spokenText;
            }
            lastAsst.interrupted = true;
        }
        return res;
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
        await this._ensureVoiceModelsFresh();
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
        await this._ensureVoiceModelsFresh();
        const text = params.text ?? (typeof params.post === 'string' ? params.post : params.post?.text);
        return (await WORK_AGENT_CORE()).voice.speak(this, { text, language: params.language, instructions: params.instructions, uid: params.session?.principal?.id || params.session?.uid });
    },
    async _ensureVoiceModelsFresh() {
        try {
            if (globalThis.__workVoiceFreshV3 === true)
                return;
            globalThis.__workVoiceFreshV3 = true;
            if (globalThis.$server) {
                globalThis.$server.merges = {};
                globalThis.$server.__merge_pairs__?.clear?.();
            }
            const aiProto = await WORK.get_item('/MODELS/$ai/$folder/$class/$ai').catch(() => null);
            aiProto?.reset?.();
            for (const p of ['/MODELS/odant/Qwen3.8 27b', '/MODELS/odant/Qwen3-TTS', '/MODELS/odant/Qwen3-ASR']) {
                const n = await WORK.get_item(p).catch(() => null);
                if (n) {
                    n.reset?.();
                    await n.init;
                }
            }
            (await WORK_AGENT_CORE()).voice.resetVoiceProbes?.();
        }
        catch { /* ignore in mock test trees */ }
    },
    /** Распознавание речи: тело запроса — WAV (16 кГц, моно) → { text }. */
    async voice_transcribe(params = {}) {
        await this.assertAccess(params, 'read');
        const audio = Buffer.isBuffer(params.post) ? params.post : null;
        return (await WORK_AGENT_CORE()).voice.transcribe(this, { audio, language: params.language, uid: params.session?.principal?.id || params.session?.uid });
    },
    /** Проверка промежуточной речи для проактивного вступления/перебивания ИИ (AI Barge-In). */
    async voice_interim(params = {}) {
        await this.assertAccess(params, 'read');
        const post = typeof params.post === 'string' ? (() => { try { return JSON.parse(params.post); } catch { return { text: params.post }; } })() : (params.post || {});
        const text = params.text ?? post.text ?? '';
        const pauseMs = Number(params.pauseMs ?? post.pauseMs ?? 0) || 0;
        return (await WORK_AGENT_CORE()).voice.checkInterim(this, { text, pauseMs, uid: params.session?.principal?.id || params.session?.uid });
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
