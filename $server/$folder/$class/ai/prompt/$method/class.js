/**
 * $method prompt — движок агентов из пакета ai/agents/* рядом с методом (не meta peer через ~).
 * params: { session, agent, model, mode, effort, messages, prompt, block, box, live, task }
 * this.$context — класс исполнения (место / system.md / readme / config домена).
 * model: agent.model (строгая) → params.model (выбор пользователя/REST) → ai/config.js ($context или пакет движка).
 * live — контракт владельца ленты: { send(event), save(), stopped, wait(block), mode }.
 *   Нет live — движок создаёт тихий standalone: события с path класса, без save/wait.
 * messages — диалог-улики; system от заказчика (если есть) сохраняется,
 *   исполнитель дописывает локальные слои (место, agent/tool.system в fill).
 *   Нет system — standalone: buildSystemPrompt({ session }) (без location/tz — их в execute не бывает).
 * block — собрать/продолжить (мутируется на месте — живая лента владельца).
 * Стоп на человека: tool.stop + live.wait — движок ждёт ответ и продолжает; `stop` на блоке не снимать;
 *   лист-агент со stop (question/form/planning/report) возвращается владельцу как есть.
 * круг / вложенный агент — callAgent({ agent, brief }): поручение в brief/prompt,
 *   итог { ok, content, error, block }; не HTTP.
 * tool/agent.init получают engine, callAgent(id, brief), task.
 * ok create в боксе → сразу total (не pick write).
 * принятая activation или write.need=create — nextIds только create (даже если create сожжён).
 * activation в меню — после ok read в этом боксе.
 */

export default {
    async execute(params = {}) {
        let { session, agent, model, messages, prompt, block, live } = params;

        const type = agent || 'answer';
        agent = await this.loadAgent(type);
        // модель: строгая у агента → приехавшая (выбор пользователя/REST) → дефолт класса
        model = agent.model ?? model ?? (await this.loadConfig())?.model;
        if (!model)
            throw new Error('prompt: модель не задана (agent.model / params.model / ai/config.js)');

        const own = !live;
        if (own) {
            const path = this.$context?.short;
            live = params.live = {
                path,
                mode: params.mode || 'plan',
                send: e => session?.send?.({ ...e, path }),
            };
        }

        messages ??= params.messages = [];
        if (messages[0]?.role === 'system') {
            // system заказчика — база; место исполнения дописывает локальный слой
            const extra = await this.placeSupplement({ session, base: messages[0].content });
            if (extra)
                messages[0] = { role: 'system', content: messages[0].content + '\n\n' + extra };
        }
        else {
            messages.unshift({
                role: 'system',
                content: await this.buildSystemPrompt({ session }),
            });
        }

        if (prompt)
            messages.push({ role: 'user', content: prompt });

        block ??= {
            type,
            label: agent.stop === true ? undefined : agent.label,
            icon: agent.icon,
        };
        block.time ??= Date.now();
        if (agent.stop != null)
            block.stop ??= agent.stop;
        if (prompt && !block.brief)
            block.brief = String(prompt).trim();
        if (block.label == null && agent.stop !== true)
            block.label = agent.label;
        if (block.icon == null)
            block.icon = agent.icon;

        // Инвариант «несейвленных блоков нет»: сначала персист, потом события UI.
        await live.save?.();
        if (own)
            live.send({ type: 'chat.start' });

        try {
            await this.turn({
                block, agent, type, model, messages, session, live, params,
            });
            if (own)
                live.send({ type: 'chat.done' });
            return block;
        }
        catch (e) {
            block.error = true;
            block.content = [block.content, e.message].filter(Boolean).join('\n\n');
            if (typeof agent.finish === 'function')
                await agent.finish({ block, live, session, box: params.box });
            await live.save?.();
            if (own)
                live.send({ type: 'chat.done' });
            return block;
        }
    },

    /** Ход агента: лист → fill; box → init / tool / nested-агент (стоп через live.wait) → снова execute. */
    async turn(ctx) {
        const { block, agent, type, model, messages, session, live, params } = ctx;
        if (live?.stopped) {
            delete block.inited;
            return;
        }
        // Бюджет ходов бокса: страховка от вечных циклов (второй контур после леджера попыток)
        block.turns = (block.turns || 0) + 1;
        if (block.turns > MAX_TURNS) {
            block.content = [block.content, '[лимит ходов ' + MAX_TURNS + ': останавливаюсь, итог — из сделанного выше]'].filter(Boolean).join('\n\n');
            delete block.inited;
            await live.save?.();
            const m = live?.mode || 'plan';
            return this.total(ctx, agent[m]?.tools || agent.tools || {});
        }
        const mode = live?.mode || 'plan';
        const tools = agent[mode]?.tools || agent.tools || {};
        const toolIds = Object.keys(tools);
        const nested = Array.isArray(agent.nested) ? agent.nested : [];
        let system = agent[mode]?.system || agent.system;
        if (params.skillStep?.system)
            system = [system, params.skillStep.system].filter(Boolean).join('\n\n');
        if (params.skillStep?.prompt)
            system = [system, params.skillStep.prompt].filter(Boolean).join('\n\n');
        const exec = (target, call, c) => this.exec(target, call, c);

        if (!toolIds.length && !nested.length) {
            await this.fill(block, {
                agent: { ...agent, system },
                model, messages, live, box: params.box, effort: params.effort,
            });
            if (live?.stopped) {
                delete block.inited;
                return;
            }
            if (typeof agent.recalc === 'function')
                await agent.recalc({ block, live, exec, messages, session, task: params.task });
            if (block.content)
                messages.push({ role: 'assistant', content: block.content });
            delete block.inited;
            await live.save?.();
            return;
        }

        block.items ??= [];
        if (!block.inited) {
            block.inited = true;
            if (typeof agent.init === 'function') {
                const ok = await agent.init({
                    block, box: params.box, messages, session, model, live, exec, agent,
                    engine: this,
                    task: params.task,
                    streamChat: (p) => this.streamChat({ ...p, model, live }),
                    callAgent: (id, brief) => this.callAgent(ctx, { agent: id, brief, parent: block }),
                });
                await live.save?.();
                if (live?.stopped) {
                    delete block.inited;
                    return;
                }
                if (ok === false) {
                    delete block.inited;
                    block.skip = true;
                    return;
                }
                if (block.error && block.content) {
                    messages.push({ role: 'assistant', content: block.content });
                    delete block.inited;
                    return;
                }
            }
        }
        if (typeof agent.recalc === 'function')
            await agent.recalc({ block, box: params.box, messages, session, live, exec, task: params.task });

        const ids = nextIds(agent, block, toolIds);
        if ((block.items || []).some(b => b.type === 'create' && b.done && !b.error))
            return this.total(ctx, tools);
        const skillTools = params.skillStep?.tools;
        const rawNext = skillTools?.length
            ? skillToolNext(skillTools, ids, block)
            : await this.pick(ctx, ids, tools, mode);
        if (live?.stopped) {
            delete block.inited;
            return;
        }
        const picked = splitPick(rawNext, ids.concat(['stop', 'total']));
        const next = picked.id;
        if (!next || next === 'stop' || next === 'total')
            return this.total(ctx, tools);

        const tool = tools[next];
        if (tool) {
            // Инвариант «несейвленных блоков нет»: чайлд рождается скрытым
            // (ribbon и preview фильтруют hidden) и впервые попадает в сейв
            // уже видимым — после init. Отказанный/прерванный init снимает его
            // до первого сейва с ним: в файле остаётся только using_blocks.
            const child = { type: next, label: tool.label, icon: tool.icon, time: Date.now(), hidden: true };
            if (tool.stop != null)
                child.stop = tool.stop;
            // doc — только после done (write/create evidence); не копировать с tool на пустой стрим
            if (!tool.ignore) {
                const used = block.using_blocks ??= [];
                if (!used.includes(next))
                    used.push(next);
            }
            block.items.push(child);
            if (typeof tool.init === 'function') {
                const ok = await tool.init({
                    block: child, box: block, messages, session, model, live, exec, agent,
                    engine: this,
                    task: params.task,
                    streamChat: (p) => this.streamChat({ ...p, model, live }),
                    callAgent: (id, brief) => this.callAgent(ctx, { agent: id, brief, parent: block }),
                });
                if (live?.stopped || ok === false) {
                    // init === false — «здесь этому tool нечего делать»: блок снимается,
                    // тип остаётся в using_blocks — в этом боксе его больше не предлагаем (меню только сужается)
                    const i = block.items.indexOf(child);
                    if (i >= 0)
                        block.items.splice(i, 1);
                    const used = block.using_blocks ??= [];
                    if (!used.includes(next))
                        used.push(next);
                    await live.save?.();
                    if (live?.stopped) {
                        delete block.inited;
                        return;
                    }
                    return this.turn(ctx);
                }
            }
            delete child.hidden;
            await live.save?.();
            if (!child.content && !draftText(child) && (tool.prompt || tool.system)) {
                await this.fill(child, {
                    agent: {
                        system: tool.system || system,
                        prompt: tool.prompt,
                        maxOutput: tool.maxOutput,
                        allowReasoning: tool.allowReasoning,
                    },
                    model, messages, live, box: block, effort: params.effort,
                });
            }
            if (live?.stopped) {
                delete block.inited;
                return;
            }
            if (typeof tool.recalc === 'function')
                await tool.recalc({
                    block: child, box: block, messages, session, model, live, exec, agent,
                    engine: this, task: params.task,
                    streamChat: (p) => this.streamChat({ ...p, model, live }),
                    callAgent: (id, brief) => this.callAgent(ctx, { agent: id, brief, parent: block }),
                });
            pushLift(messages, child);
            // Леджер попыток: идентичный провал дважды — dropUsed агента игнорируется,
            // тип остаётся в using_blocks (защита от вечных циклов вида read ×15)
            noteAttempt(block, next, child);
            // Прерыватель: ошибки подряд (пусть и с разными операндами) — бокс закрывается
            // итогом, дальше только человек. Одинаковый мусор ловит леджер, разный — он.
            if (trippedBreaker(block, child)) {
                await live.save?.();
                return this.total(ctx, tools);
            }
            await live.save?.();
            if (child.stop) {
                if (!live.wait) {
                    // standalone: стоп возвращается владельцу как есть
                    delete block.inited;
                    return;
                }
                // Догма: повторный стоп того же типа с тем же операндом после
                // отклонения — отказ уже финален, ждать нечего, сразу итог
                if (isRepeatStop(block, next, child)) {
                    child.content = [child.content, '[повторный стоп без новых данных после отклонения — закрываю без ожидания]'].filter(Boolean).join('\n\n');
                    delete child.stop;
                    await live.save?.();
                    return this.total(ctx, tools);
                }
                // ждём человека; approve выполняет владелец ленты, сюда приходит факт
                const res = await live.wait(child) || {};
                if (live?.stopped) {
                    delete block.inited;
                    return;
                }
                if (res.accept === false)
                    recordReject(block, next, child);
                if (res.content)
                    messages.push({ role: 'user', content: String(res.content) });
                await live.save?.();
            }
            return this.execute({
                ...params,
                agent: type, model, messages, session, live,
                prompt: undefined,
                block,
            });
        }

        await this.callAgent(ctx, { agent: next, brief: picked.brief, parent: block });
        if (live?.stopped) {
            delete block.inited;
            return;
        }
        return this.execute({
            ...params,
            agent: type, model, messages, session, live,
            prompt: undefined,
            block,
        });
    },

    /**
     * Вызов субагента из потока родителя: brief → prompt ребёнка, итог в блок и в messages.
     * @returns {{ ok: boolean, agent: string, content?: string, error?: boolean, skip?: boolean, state?: string, block: object }}
     */
    async callAgent(ctx, spec = {}) {        const { agent: id, brief, parent } = spec;
        const box = parent || ctx.block;
        const live = ctx.live;
        box.items ??= [];
        const sub = { type: id, time: Date.now() };
        const text = String(brief || '').trim();
        if (text)
            sub.brief = text;
        box.items.push(sub);
        await live?.save?.();
        await this.execute({
            ...ctx.params,
            agent: id,
            prompt: text || undefined,
            block: sub,
            box,
            skillStep: undefined,
        });
        // Стоп субагента (form/question): ждём человека, как tool-стопы.
        // Без live.wait (standalone) — возвращаем как есть, ждёт владелец.
        if (sub.stop && !sub.error && !live?.stopped) {
            if (!live?.wait) {
                pushLift(ctx.messages, sub);
                return { ok: !sub.error, agent: id, content: sub.content, state: sub.state, block: sub };
            }
            const res = await live.wait(sub) || {};
            if (live?.stopped)
                return { ok: false, agent: id, block: sub };
            if (res.accept === false)
                recordReject(box, id, sub);
            if (res.content)
                ctx.messages.push({ role: 'user', content: String(res.content) });
            await live?.save?.();
        }
        if (sub.skip || isEmptyResult(sub)) {
            const i = box.items.indexOf(sub);
            if (i >= 0)
                box.items.splice(i, 1);
            // Пропущенный субагент — в меню-исключение: повторный pick без новых
            // данных ушёл бы в тот же skip (вечный холостой цикл nested).
            // Пустой итог (нет items/content/error/stop) — тоже skip: холостой вызов
            // без следа сужает меню вместо накрутки пустых боксов.
            const used = box.using_blocks ??= [];
            if (!used.includes(id))
                used.push(id);
            await live?.save?.();
            return { ok: false, skip: true, agent: id, block: sub };
        }
        pushLift(ctx.messages, sub);
        return {
            ok: !sub.error,
            agent: id,
            content: sub.content,
            error: sub.error ? true : undefined,
            state: sub.state,
            block: sub,
        };
    },

    /** Итог бокса: один ребёнок с content — лифт; только ошибки — агрегат; draft/несколько — fill. */
    async total(ctx, tools) {
        const { block, agent, model, messages, live, session, params } = ctx;
        if (live?.stopped) {
            delete block.inited;
            return;
        }
        const mode = live?.mode || 'plan';
        const data = (block.items || []).filter(b => {
            if (b.hidden)
                return false;
            if (b.type === 'prompt' || tools[b.type]?.ignore)
                return false;
            if (tools[b.type]?.role && tools[b.type].role !== 'user')
                return false;
            return !!(b.content || draftText(b));
        });
        const results = data.filter(b => !b.error);
        const fails = data.filter(b => b.error);
        const nest = Array.isArray(agent.nested) && agent.nested.length;
        const ownDraft = !!draftText(block);
        if (nest && ownDraft && !data.length) {
            // лист: только draft, сводку пишет родитель
            delete block.inited;
            delete block.using_blocks;
            await live.save?.();
            return;
        }
        if (results.length === 1 && !fails.length && !ownDraft && results[0].content) {
            // один ребёнок с готовым content — лифт; draft (простыня) не копировать
            block.content = results[0].content;
            delete block.error;
            // Терминальный state: свой — оставить, нет — ok. Пустого state у итога не бывает.
            if (!block.state)
                block.state = 'ok';
        }
        else if (!results.length && fails.length && !ownDraft) {
            block.error = true;
            block.content = fails.map(b => b.content).filter(Boolean).join('\n') || 'ошибка';
            // Красный ⟺ ошибка: stale- state прогресса перезаписывается всегда.
            if (fails.length > 1)
                block.state = 'ошибки: ' + fails.length;
            else
                block.state = fails[0].state || 'ошибка';
        }
        else if (results.length || ownDraft) {
            await this.fill(block, {
                agent: {
                    system: agent[mode]?.system || agent.system,
                    prompt: agent.prompt,
                    maxOutput: agent.maxOutput,
                    allowReasoning: agent.allowReasoning,
                },
                model, messages, live, box: block, effort: params.effort,
            });
            if (live?.stopped) {
                delete block.inited;
                return;
            }
            if (!block.content) {
                const bits = results.map(b => b.content).filter(Boolean);
                if (bits.length === 1)
                    block.content = bits[0];
                else if (bits.length)
                    block.content = bits.join('\n\n');
            }
            if (block.content) {
                delete block.error;
                if (!block.state)
                    block.state = 'ok';
                // Частичный провал при живом итоге: state обязан это отражать.
                else if (fails.length && !/ошибок|ошибка|error|gap/i.test(block.state))
                    block.state = block.state + ' (ошибок: ' + fails.length + ')';
            }
        }
        // сводка и без детей в total (check: exist/file ignore) — иначе бокс без content не закрывается
        if (typeof agent.enrichTotal === 'function') {
            const text = agent.enrichTotal(block.content || '', block);
            if (text)
                block.content = text;
        }
        if (typeof agent.finish === 'function')
            await agent.finish({ block, live, session, box: params.box });
        if (block.content)
            messages.push({ role: 'assistant', content: block.content });
        delete block.inited;
        delete block.using_blocks;
        await live.save?.();
    },

    async pick(ctx, ids, tools, mode) {
        if (!ids?.length)
            return;
        const { agent, block, messages, model, live } = ctx;
        if (live?.stopped)
            return;
        if (ids.length === 1)
            return ids[0];
        const lines = ids.map(id => {
            const node = tools[id] || (id === 'site'
                ? { description: 'страница по url из очереди' }
                : {});
            return `- ${id}: ${node.description || node.label || id}`;
        });
        const response = await this.streamChat({
            model, live, silent: true,
            messages: [
                ...messages,
                {
                    role: 'user',
                    content: [
                        agent[mode]?.system || agent.system,
                        block.brief && ('Тема: ' + block.brief),
                        'Выбери следующий шаг: id из списка. Субагенту можно дописать поручение в той же строке.',
                        '[menu]',
                        ...lines,
                    ].filter(Boolean).join('\n'),
                },
            ],
        });
        if (live?.stopped)
            return;
        const line = String(response.content || '').trim().split('\n')[0] || '';
        const word = line.split(/\s+/)[0]
            ?.replace(/^[`"'«]+|[`"'»;:,.]+$/g, '');
        return ids.includes(word) ? line : ids[0];
    },

    async fill(block, { agent, model, messages, live, box, effort }) {
        const chat = messages.map(m => ({ ...m }));
        if (agent.system && chat[0]?.role === 'system')
            chat[0] = { role: 'system', content: chat[0].content + '\n\n' + agent.system };
        if (block.draft) {
            const draft = block.draft;
            const head = (agent.prompt || '') + `\n\n[${block.type}: ${block.label || ''}]\n`;
            const content = draft?.type === 'image_url'
                ? [{ type: 'text', text: head }, draft]
                : head + (typeof draft === 'string' ? draft : draft?.text || '');
            chat.push({ role: 'user', content });
        }
        else if (agent.prompt) {
            chat.push({ role: 'user', content: '[instruction]\n' + agent.prompt });
        }
        const response = await this.streamChat({
            model, messages: chat, live, box,
            effort, allowReasoning: agent.allowReasoning, maxOutput: agent.maxOutput,
        });
        let text = String(response.content || '').trim();
        if (block.title && text)
            text = String(block.title).trim() + '\n\n' + text;
        if (text)
            text = unwrapFence(text);
        if (text)
            block.content = text;
        else
            delete block.content;
        if (response.usage)
            block.usage = response.usage;
    },

    /** Единый стрим (единственная реализация сборки ответа: effort, maxOutput, usage, стоп и reasoning-блок через live). $task._streamChat — лишь адаптер сюда. */
    async streamChat({ model, messages, live, silent, effort, allowReasoning, maxOutput, box } = {}) {
        const modelItem = await WORK.get_item(model);
        const eff = (effort && effort !== 'off' && allowReasoning === true) ? effort : 'off';
        const cap = silent ? 64 : Number(maxOutput);
        const chat = {
            messages,
            temperature: silent ? 0 : .5,
            effort: eff,
        };
        if (Number.isFinite(cap) && cap > 0)
            chat.maxOutput = cap;
        let content = '', usage;
        let reasonBlock;
        const closeReason = async () => {
            if (!reasonBlock)
                return;
            const items = box?.items;
            const i = items?.indexOf(reasonBlock) ?? -1;
            if (i >= 0)
                items.splice(i, 1);
            reasonBlock = null;
            await live?.save?.();
        };
        for await (const chunk of modelItem.streamChat(chat)) {
            if (live?.stopped) {
                content = '';
                break;
            }
            if (chunk?.type === 'usage') {
                usage = chunk;
                continue;
            }
            if (chunk?.type === 'reasoning') {
                if (eff === 'off')
                    continue;
                const token = chunk.content || '';
                if (!token)
                    continue;
                if (!reasonBlock && box?.items) {
                    // hidden: эфемерный индикатор CoT — ribbon/preview его не рисуют,
                    // в сводки total не попадает (фильтр ниже), на диск — только скрытым
                    reasonBlock = { type: 'reasoning', label: 'Рассуждаю', icon: 'carbon:idea', ignore: true, hidden: true, time: Date.now() };
                    box.items.push(reasonBlock);
                    await live?.save?.();
                }
                if (reasonBlock)
                    live?.send?.({ type: 'chat.delta', token });
                continue;
            }
            const token = typeof chunk === 'string' ? chunk : chunk?.content;
            if (typeof token !== 'string' || !token)
                continue;
            await closeReason();
            content += token;
            if (!silent)
                live?.send?.({ type: 'chat.delta', token });
        }
        await closeReason();
        return { content: content.trim(), usage };
    },

    /** Вызов метода элемента/WORK с записью результата в блок (function-call инструментов). */
    async exec(target, call = {}, ctx = {}) {
        const { method, args } = call;
        const block = ctx.block;
        // Валидация операндов до вызова (только цели со SCHEMA): подсказка без error.
        const guidance = await this.validateCall(target, method, args || {});
        if (guidance) {
            if (block) {
                block.state = 'нет операндов';
                block.content = [block.content, guidance].filter(Boolean).join('\n\n');
            }
            return { error: guidance };
        }
        try {
            let result;
            if (target && typeof target[method] === 'function')
                result = await target[method](args || {});
            else if (typeof WORK?.[method] === 'function')
                result = await WORK[method](args || {});
            else
                throw new Error('unknown method: ' + method);
            if (block && result != null && block.content == null)
                block.content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            return result;
        } catch (e) {
            if (block) {
                block.error = true;
                block.content = (block.content || '') + String(e.message || e);
            }
            throw e;
        }
    },

    /**
     * Проверка операндов по SCHEMA цели до вызова (dsh-урок: внутри execute аргументы уже правильные).
     * Только $service-цели со SCHEMA; остальным — null (без валидации).
     * @returns {Promise<string|null>} текст подсказки или null (всё на месте)
     */
    async validateCall(target, method, args = {}) {
        try {
            const p = String(target?.path || target?.short || '');
            if (!p.startsWith('/SERVICES/') || typeof target?.import !== 'function' || !method)
                return null;
            const data = await target.import();
            const spec = data?.SCHEMA?.[method];
            const required = spec?.params?.required;
            if (!Array.isArray(required) || !required.length)
                return null;
            const missing = required.filter(k => args[k] == null || String(args[k]).trim() === '');
            if (!missing.length)
                return null;
            return method + ': нет обязательных полей: ' + missing.join(', ')
                + (spec.description ? ' — ' + spec.description : '');
        }
        catch {
            return null;
        }
    },

    /**
     * Резолв WORK-пути в вид цели — для guided-ошибок tools.
     * Агенты зовут через params.engine.resolveTarget(path).
     * @returns {{kind: 'file'|'class'|'provider'|'missing'|'bad', path, type?, label?, hint?}}
     */
    async resolveTarget(path) {
        const p = String(path || '').trim();
        if (!p || !p.startsWith('/'))
            return { kind: 'bad', path: p, hint: 'нужен абсолютный WORK-путь вида /MODELS/odant' };
        let item = null;
        try {
            item = await WORK.get_item(p);
        }
        catch { item = null; }
        if (!item)
            return { kind: 'missing', path: p };
        const type = item.type || item.constructor?.name || '';
        const label = item.label || item.id || p;
        if (typeof item.list_remote === 'function' || type === '$provider') {
            return {
                kind: 'provider', path: p, type, label,
                hint: 'это провайдер ($provider): remote/list_remote — здесь, модели — дети через ls, новые — create $ai',
            };
        }
        if (type === '$file')
            return { kind: 'file', path: p, type, label };
        return {
            kind: 'class', path: p, type, label,
            hint: 'это класс, не файл: осмотр — ls/info/readme/meta, действие — create/typed/write по контракту места',
        };
    },

    /**
     * Пакет ai рядом с этим $method (parent с agents/), не meta peer через ~.
     * Код агентов — у движка; $context peer даёт место/system/config домена.
     */
    async _aiPackage() {
        let cur = this.parent;
        for (let i = 0; i < 5 && cur; i++) {
            try {
                if (typeof cur.get_item === 'function') {
                    const agents = await cur.get_item('agents');
                    if (agents)
                        return cur;
                }
            }
            catch { /* следующий parent */ }
            if (cur.id === 'ai')
                return cur;
            cur = cur.parent;
        }
        return null;
    },

    async loadAgent(agent = 'answer') {
        const ai = await this._aiPackage();
        const file = ai ? await ai.get_item(`agents/${agent}.js`) : null;
        if (!file && agent !== 'answer')
            return this.loadAgent('answer');
        if (!file)
            throw new Error('prompt: agent not found: ' + agent);
        return file.importScript();
    },

    /** config: сначала meta $context (свой/через ~), иначе пакет движка. */
    async loadConfig() {
        try {
            let file = await this.$context?.meta_folder?.get_item?.('ai/config.js');
            if (!file) {
                const ai = await this._aiPackage();
                file = ai ? await ai.get_item('config.js') : null;
            }
            return file ? await file.importScript() : {};
        }
        catch { return {}; }
    },

    /** System для on_save / standalone. location+tz — только снаружи execute (on_save); в execute не приходят. */
    async buildSystemPrompt({ session, location, tz } = {}) {
        const ctx = this.$context;
        const user_info = await session?.$user?.info?.();
        const class_info = await ctx?.info?.();
        if (location) {
            try {
                const loc = typeof location === 'string' ? JSON.parse(location) : location;
                const place = (loc.lat != null && loc.lon != null)
                    ? await resolvePlace(loc.lat, loc.lon)
                    : null;
                const coords = Object.keys(loc).map(key => key + ':' + loc[key]).join(', ');
                location = coords
                    ? 'Расположение: ' + (place ? place + ' (' + coords + ')' : coords) + '.'
                    : null;
            }
            catch { location = null; }
        }
        let system = '';
        try {
            const file = await ctx?.meta_folder?.get_item?.('ai/system.md');
            if (file)
                system = String(await file.load({ encoding: 'utf-8' })).trim();
        }
        catch { /* peer без ai */ }
        if (!system) {
            try {
                const ai = await this._aiPackage();
                const file = ai ? await ai.get_item('system.md') : null;
                if (file)
                    system = String(await file.load({ encoding: 'utf-8' })).trim();
            }
            catch { /* нет пакета */ }
        }
        const readme = await loadPlaceReadme(ctx);
        return [
            system,
            readme,
            placeContext(user_info, class_info),
            location,
            timeNow(tz),
        ].filter(Boolean).join('\n');
    },

    /** Локальный слой места исполнения поверх system заказчика (без дубля, если path уже есть). */
    async placeSupplement({ session, base } = {}) {
        const ctx = this.$context;
        const class_info = await ctx?.info?.();
        const path = class_info?.path;
        if (!path || String(base || '').includes(path))
            return null;
        const user_info = await session?.$user?.info?.();
        return placeContext(user_info, class_info);
    },
};

/** Бюджет ходов одного бокса: второй контур защиты от вечных циклов (первый — леджер попыток). */
export const MAX_TURNS = 50;

/** Повторов одного операнда подряд, после которых тип остаётся в using_blocks. */
export const MAX_SAME_ATTEMPTS = 2;

/** Ошибок подряд (с любыми операндами), после которых бокс закрывается итогом. */
export const MAX_CONSECUTIVE_ERRORS = 3;

/** Ключ попытки: tool + операнд (путь или первая строка контента). */
export function attemptKey(next, child) {
    const op = String(child?.path || '').trim()
        || String(child?.content || '').replace(/\r\n/g, '\n').trim().split('\n').find(Boolean)
        || '';
    return next + '\n' + op.slice(0, 200);
}

function pruneAttempts(box) {
    const a = box.attempts;
    if (!a)
        return;
    const keys = Object.keys(a);
    if (keys.length > 20)
        for (const k of keys.slice(0, keys.length - 20)) delete a[k];
}

/**
 * Прерыватель consecutive-ошибок: леджер ловит одинаковый мусор,
 * этот — разный (каждый раз новый путь/операнд). Успех сбрасывает счёт.
 * @returns {boolean} бокс пора закрывать итогом
 */
export function trippedBreaker(box, child) {
    if (!box || !child)
        return false;
    if (!child.error) {
        if (box.errorStreak)
            delete box.errorStreak;
        return false;
    }
    const n = (box.errorStreak = (box.errorStreak || 0) + 1);
    if (n >= MAX_CONSECUTIVE_ERRORS) {
        child.content = [child.content,
            '[ошибки подряд: ' + n + ' — останавливаю бокс, дальше нужен человек]']
            .filter(Boolean).join('\n\n');
        return true;
    }
    return false;
}

/**
 * Учёт попытки tool. Успех с новым операндом — сброс счётчиков tool.
 * Идентичный провал MAX_SAME_ATTEMPTS раз — dropUsed агента игнорируется:
 * тип возвращается в using_blocks, меню только сужается.
 * Идентичный успех (тот же тип + побайтово тот же контент сиблинга) —
 * тоже повтор: новой информации ноль, тип возвращается в using_blocks.
 * Перечитывание изменившегося файла не страдает (контент другой — не повтор).
 */
export function noteAttempt(box, next, child) {
    if (!box || !next || !child)
        return;
    if (!child.error) {
        if (sameContentSibling(box, next, child)) {
            const used = box.using_blocks ??= [];
            if (!used.includes(next))
                used.push(next);
            child.content = [child.content, '[повтор: тот же ' + next + ' с тем же результатом — заблокирован, выбери другой ход]'].filter(Boolean).join('\n\n');
            return;
        }
        const at = box.attempts;
        if (at) {
            for (const k of Object.keys(at))
                if (k.startsWith(next + '\n')) delete at[k];
            if (!Object.keys(at).length) delete box.attempts;
        }
        return;
    }
    const key = attemptKey(next, child);
    const at = box.attempts ??= {};
    at[key] = (at[key] || 0) + 1;
    pruneAttempts(box);
    if (at[key] >= MAX_SAME_ATTEMPTS) {
        const used = box.using_blocks ??= [];
        if (!used.includes(next))
            used.push(next);
        child.content = [child.content, '[повтор ' + at[key] + ': тот же ' + next + ' с тем же операндом заблокирован — выбери другой ход или спроси человека]'].filter(Boolean).join('\n\n');
    }
}

/** Сиблинг того же типа с побайтово тем же контентом (без учёта пометок леджера). */
function sameContentSibling(box, next, child) {
    const content = String(child?.content || '');
    if (!content)
        return false;
    const strip = s => String(s || '').replace(/\n\n\[повтор[^\]]*\]$/, '');
    const norm = strip(content);
    return (box?.items || []).some(b =>
        b !== child && b?.type === next && !b?.error && strip(b.content) === norm);
}

/**
 * Фиксация отклонения стоп-блока: повтор с тем же операндом ждать не будет.
 * Ключ — attemptKey (tool + путь/первая строка): пометки леджера в хвосте
 * контента на сравнение не влияют.
 */
export function recordReject(box, next, child) {
    if (!box || !next)
        return;
    (box.rejectedStops ??= {})[next] = attemptKey(next, child);
}

/** Тот же стоп с тем же операндом уже отклоняли — ожидание бессмысленно. */
export function isRepeatStop(box, next, child) {
    const r = box?.rejectedStops;
    if (!r || !next || !(next in r))
        return false;
    return r[next] === attemptKey(next, child);
}

/** id из ответа pick + хвост строки = brief субагенту. */
function splitPick(raw, ids) {    const line = String(raw || '').trim();
    if (!line)
        return { id: '', brief: '' };
    const word = line.split(/\s+/)[0]?.replace(/^[`"'«]+|[`"'»;:,.]+$/g, '');
    if (ids.includes(word))
        return { id: word, brief: line.slice(word.length).trim() };
    return { id: '', brief: '' };
}

/** Пустой итог субагента: нет детей, тела, черновика, ошибки и стопа — холостой вызов, считать skip.
 *  draft — тоже улика (site/file/image несут результат только в draft): его наличие отменяет пустоту. */
export function isEmptyResult(sub) {
    if (!sub || sub.skip || sub.error || sub.stop)
        return false;
    if ((sub.items || []).length)
        return false;
    if (String(sub.content || '').trim())
        return false;
    return !draftText(sub);
}

/** Навык: первый unused tool; уже успешный — пропуск; после ok create — итог. */
function skillToolNext(order, ids, box) {
    const items = box?.items || [];
    if (items.some(b => b.type === 'create' && b.done && !b.error))
        return 'total';
    const next = (order || []).find(id => ids.includes(id) && !skillToolOk(items, id));
    return next || 'total';
}

function skillToolOk(items, type) {
    return (items || []).some(b => {
        if (b.type !== type || !b.content || b.error)
            return false;
        if (type === 'activation')
            return b.state === 'принято';
        if (type === 'create')
            return !!b.done;
        return true;
    });
}

function draftText(block) {
    const d = block?.draft;
    if (d == null || d === '')
        return '';
    if (typeof d === 'string')
        return d;
    if (d.type === 'text')
        return String(d.text || '');
    return '';
}

/** Подъём: draft и content — разные источники, оба в контекст. */
function pushLift(messages, block) {
    const d = draftText(block);
    if (d)
        messages.push({ role: 'assistant', content: d });
    if (block?.content)
        messages.push({ role: 'assistant', content: block.content });
}

function nextIds(agent, block, toolIds) {
    const used = block.using_blocks || [];
    const ids = toolIds.filter(id => !used.includes(id));
    for (const id of agent.nested || []) {
        if (!used.includes(id) && !ids.includes(id))
            ids.push(id);
    }
    if (createFirst(block, toolIds))
        return ['create'];
    // Гейт «activation после чтения» — только агентам с tool read (work):
    // без read в меню требование okRead невыполнимо и прятало бы activation навсегда.
    if (ids.includes('activation') && toolIds.includes('read') && !okRead(block)) {
        const i = ids.indexOf('activation');
        if (i >= 0)
            ids.splice(i, 1);
    }
    if (agent.prompt && !used.includes('total') && !used.includes('stop'))
        ids.push('stop');
    return ids;
}

/** После APPROVE activation или write в отсутствующий класс — create, даже если тип сожжён. */
export function createFirst(block, toolIds) {
    if (!toolIds.includes('create'))
        return false;
    const items = block.items || [];
    if (items.some(b => b.type === 'create' && b.done && !b.error))
        return false;
    // Гейт против веера пустых create: дважды неуспешно без done — больше не форсим,
    // ход уходит в общее меню (total/question), а не в восьмой identical create
    const badCreates = items.filter(b => b.type === 'create' && b.error && !b.done);
    if (badCreates.length >= 2)
        return false;
    if (items.some(b => b.type === 'activation' && b.state === 'принято'))
        return true;
    return items.some(b => b.type === 'write' && b.need === 'create');
}

function okRead(block) {
    return (block.items || []).some(b => b.type === 'read' && b.done && !b.error);
}
function samePlace(a, b) {
    if (!a || !b) return false;
    return (a.path && a.path === b.path) || (a.id && a.id === b.id);
}

function placeContext(user_info, class_info) {
    if (samePlace(user_info, class_info))
        return 'Профиль и рабочая группа совпадают (личная зона):\n'
            + JSON.stringify(user_info || class_info, null, 2);
    return [
        'Профиль (от чьего имени):\n' + JSON.stringify(user_info, null, 2),
        'Рабочая группа (где задача):\n' + JSON.stringify(class_info, null, 2),
    ].join('\n');
}

/** Контракт места: storage_folder/readme.md ($context). Для peer-ask — закон домена цели. */
async function loadPlaceReadme(ctx) {
    if (!ctx)
        return '';
    try {
        const storage = ctx.storage_folder || ctx;
        const file = await storage?.get_item?.('readme.md');
        if (!file)
            return '';
        const text = String(await file.load({ encoding: 'utf-8' })).trim();
        if (!text)
            return '';
        return 'Контракт места (readme.md):\n' + text;
    }
    catch {
        return '';
    }
}

function timeNow(tz) {
    const now = new Date();
    const dayOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOpts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    if (tz) {
        dayOpts.timeZone = tz;
        timeOpts.timeZone = tz;
    }
    try {
        return `Сейчас: ${now.toLocaleDateString('ru-RU', dayOpts)}, время ${now.toLocaleTimeString('ru-RU', timeOpts)}${tz ? ` (${tz})` : ''}.`;
    } catch {
        return `Сейчас: ${now.toLocaleDateString('ru-RU')}, время ${now.toLocaleTimeString('ru-RU')}.`;
    }
}

/** Внешний ```…``` → содержимое в ленту; хвост после fence сохраняется. */
function unwrapFence(s) {
    const t = String(s || '').trim();
    if (!t.startsWith('```')) return t;
    const m = t.match(/^```[a-z0-9]*[^\n]*\r?\n([\s\S]*?)```/i);
    if (!m)
        return t.replace(/^```[a-z0-9]*[^\n]*\r?\n/i, '').trim();
    const inner = m[1].trim();
    const after = t.slice(m[0].length).trim();
    return after ? inner + '\n\n' + after : inner;
}

const PLACES = {};

async function resolvePlace(lat, lon) {
    const key = (+lat).toFixed(2) + ',' + (+lon).toFixed(2);
    if (PLACES[key]) return PLACES[key];
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&accept-language=ru&zoom=10`,
            {
                headers: { 'User-Agent': 'ODANT-WORK/1.0 (https://odant.org; work@odant.org)' },
                signal: AbortSignal.timeout(8000),
            },
        );
        if (!res.ok) return null;
        const a = (await res.json())?.address || {};
        const place = [a.city || a.town || a.village || a.municipality, a.state, a.country]
            .filter(Boolean).join(', ');
        if (place) PLACES[key] = place;
        return place || null;
    }
    catch { return null; }
}
