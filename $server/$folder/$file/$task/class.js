/**
 * $task — длинная ИИ-сессия (JSON).
 * prompt / pipe / body — на этом типе; one-shot между классами — $class/ai.
 */
export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',
    GET: 'context',
    async _fc_exec(target, call = {}, ctx = {}) {
        const { method, args } = call;
        const block = ctx.block;
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
    /** Контракт живой ленты для движка агентов: события, персист, стоп, режим, ожидание человека. */
    _live(session) {
        const task = this;
        return {
            path: this.short,
            send: e => session?.send?.({ ...e, path: task.short }),
            save: () => task._save(session),
            get stopped() { return !!task._stopped; },
            get mode() { return task.body.mode || 'plan'; },
            set mode(v) { task.body.mode = v; },
            /** Side-effect агента закрыл цель сессии (например write.done). */
            goalDone() {
                const g = task.body?.goal;
                if (!g || g.status === 'done')
                    return;
                g.status = 'done';
                g.resume = null;
                g.pursue = 0;
            },
            /** Стоп на человека: отпускаем UI (chat.done → кнопка APPROVE), ждём _resolveWait. */
            wait: block => {
                session?.send?.({ type: 'chat.done', path: task.short });
                return new Promise(resolve => {
                    (task._waiters ??= new Map()).set(block.time, resolve);
                });
            },
        };
    },
    /** Доставка ответа человека в ожидающий движок (стоп-блок по time). */
    _resolveWait(block, payload) {
        const resolve = block && this._waiters?.get(block.time);
        if (!resolve)
            return false;
        this._waiters.delete(block.time);
        resolve(payload || {});
        return true;
    },
    /** Исполнение блока-агента движком класса (метод prompt из меты ~/ai). Блок мутируется на месте. */
    async _runAgent(params, session) {
        const body = await this.body;
        const owner = this.$class;
        const engine = (await owner?._methods)?.prompt;
        if (typeof engine?.execute !== 'function')
            throw new Error('$task: метод prompt (ai) не найден у класса');
        // tilde-метод общий: зафиксировать владельца до execute (иначе meta_folder = undefined)
        engine.$context = owner;
        await engine.execute({
            agent: params.block.type,
            block: params.block,
            box: params.box,
            brief: params.block.brief,
            messages: await this.context({ handoff: true, session }),
            session,
            live: this._live(session),
            model: body.model,
            effort: body.effort,
        });
        await this._save(session);
        return params.block;
    },
    /** Незавершённый блок-агент в активной цепочке (обрыв, рестарт) — продолжает движок. */
    async _activeAgentBlock() {
        if (this._waiters?.size)
            return null; // движок уже ждёт человека в этом блоке — не перезапускать
        const body = await this.body;
        let box = body;
        for (;;) {
            const next = box.items?.last;
            if (!next)
                return null;
            if (this.pipe[next.type]?.agent && !hasBody(next) && !next.error)
                return { block: next, box };
            if (next.box && !hasBody(next))
                box = next;
            else
                return null;
        }
    },
    async prompt(params = {}) {
        let { prompt: rawPrompt, role, session, agent: agentParam } = params;
        const pipe = await this.pipe;

        // @web текст… → agent + хвост (только субагент)
        let text = String(rawPrompt ?? '').trim();
        let agent = agentParam;
        const mention = text.match(/^@([a-zA-Z_][\w]*)(?:\s+|$)/);
        if (mention) {
            const id = mention[1];
            if (pipe[id]?.agent) {
                agent = id;
                text = text.slice(mention[0].length).trim();
                params.prompt = text;
                params.agent = agent;
            }
        }
        else if (agent && !pipe[agent]?.agent)
            return { ok: false, error: 'unknown agent: ' + agent };

        session?.send?.({ type: 'chat.start', path: this.short });
        await this._init(params);

        try {
            switch (role) {
                case 'AI':{
                } break;
                case 'APPROVE':{
                    const accept = params.accept === true || params.accept === 'true';
                    if (accept) {
                        await params.pipe_step.approve?.(params);
                        params.block.state = 'принято';
                    } else {
                        params.block.state = 'отклонено';
                    }
                    delete params.block.stop;
                    delete params.box.using_blocks;
                    await this._save(session);
                    this._stopped = false;
                    // движок ждёт этот блок — доставить факт; chat.done не шлём:
                    // исходный prompt ещё в _runAgent и сам закроет сессию по завершении
                    // (вход в APPROVE уже дал chat.start → pending на продолжение работы)
                    if (this._resolveWait(params.block, {
                        accept,
                        content: params.block.approved || params.block.state,
                    })) {
                        return { ok: true };
                    }
                } break;
                default:{
                    if (text) {
                        params.block = {
                            type: 'prompt',
                            content: text,
                        };
                        await this._push_block(params);
                    }
                    if (params.includes) {
                        params.block = this._build_block('includes');
                        params.block.files = JSON.parse(params.includes);
                        await this._push_block(params);
                    }
                    delete params.box.using_blocks;
                    this._stopped = false;

                    // durable goal: новая постановка или вход к открытой; waiting+resume → форс / continue
                    if (text) {
                        const body = await this.body;
                        const g = body.goal;
                        if (!g || g.status === 'done') {
                            body.goal = { text, status: 'open', resume: null, pursue: 0 };
                        }
                        else if (g.status === 'waiting' && g.resume?.agent && pipe[g.resume.agent]?.agent) {
                            agent = g.resume.agent;
                            params.agent = agent;
                            g.status = 'open';
                            g.resume = null;
                        }
                        else if (g.status === 'waiting' && g.resume?.continue) {
                            // ответ на question до субагента — меню без answer
                            g.status = 'open';
                        }
                        else if (g.status === 'waiting') {
                            g.status = 'open';
                            g.resume = null;
                        }
                        await this._save(session);
                    }

                    // прямой вход в субагента — исполняет движок класса
                    if (agent) {
                        await this._init(params);
                        if (params.box.type !== agent) {
                            params.block = this._build_block(agent);
                            if (text)
                                params.block.brief = text;
                            const pushed = await this._push_block(params);
                            if (pushed) {
                                await this._runAgent(params, session);
                                await this._captionDoc(params, session);
                            }
                            await this._save(session);
                            // движок довёл агента до итога / стопа — без меню оркестратора
                            if (pushed) {
                                if (params.block.stop && hasBody(params.block))
                                    await this._noteGoalWait(params.block, params.box, session);
                                session?.send?.({ type: 'chat.done', path: this.short });
                                return agentResult(agent, params.block, { waiting: !!params.block.stop });
                            }
                        }
                    }
                }
            }

            // цикл шагов: при agent — await до content агента; иначе один шаг + async
            for (;;) {
                await this._init(params);
                await this.pipe[params.box.type]?.recalc?.(params);

                const turn = await this._promptTurn(params, session);
                if (turn.waiting) {
                    // answer+stop тоже waiting (конец ветки) — при open goal pursue, не отдавать UI
                    if (!agent && turn.block?.type === 'answer' && await this._pursueGoal(turn, session)) {
                        params = { role: 'AI', session };
                        continue;
                    }
                    session?.send?.({ type: 'chat.done', path: this.short });
                    return agentResult(agent, turn.block, { waiting: true });
                }
                if (!turn.loop) {
                    session?.send?.({ type: 'chat.done', path: this.short });
                    if (agent) {
                        const box = findAgentBlock(await this.body, agent) || turn.block;
                        return agentResult(agent, box);
                    }
                    return { ok: true };
                }
                if (agent) {
                    const box = findAgentBlock(await this.body, agent);
                    // конец агента — только content (сводка); error на боксе при частичных site — не стоп
                    if (box && hasBody(box)) {
                        session?.send?.({ type: 'chat.done', path: this.short });
                        return agentResult(agent, box);
                    }
                    // ждём человека внутри агента
                    const live = await this._active_block();
                    if (live?.stop) {
                        session?.send?.({ type: 'chat.done', path: this.short });
                        return agentResult(agent, live, { waiting: true });
                    }
                    params = { role: 'AI', session, agent };
                    continue;
                }
                this.async(() => this.prompt({ role: 'AI', session }));
                return { ok: true };
            }
        }
        catch (e) {
            params.box ??= await this.body;
            params.block = { type: 'error', content: e.message };
            await this._push_block(params);
            session?.send?.({ type: 'chat.done', path: this.short });
            if (agent)
                return { ok: false, agent, error: e.message, content: e.message };
            return { ok: false, error: e.message };
        }
    },

    /** Один ход автомата: fill leaf или меню → push. { loop, waiting, block }. */
    async _promptTurn(params, session) {
        // незавершённый агент (обрыв, рестарт) — доигрывает движок класса, не меню таска
        const broken = await this._activeAgentBlock();
        if (broken) {
            params.block = broken.block;
            params.box = broken.box;
            this._stopped = false;
            await this._runAgent(params, session);
            await this._captionDoc(params, session);
            await this._save(session);
            const b = params.block;
            if (b?.stop && hasBody(b)) {
                await this._noteGoalWait(b, params.box, session);
                return { loop: false, waiting: true, block: b };
            }
            // агент снова без итога и без стопа — не крутить цикл, ждать человека
            if (!hasBody(b) && !b?.error)
                return { loop: false, block: b };
            return { loop: this._canLoop(b), block: b };
        }
        const leaf = params.block;
        // box.todo — чеклист плана, не лист для стрима; иначе после APPROVE fill todo → стоп без step
        const todoFocus = leaf && (leaf.type === 'todo' || leaf === params.box?.todo);
        if (leaf && leaf !== params.box && !leaf.box && !hasBody(leaf) && !todoFocus) {
            this._stopped = false;
            await this._fillLeaf(params, session);
            await this._save(session);
            if (leaf.stop) {
                await this._noteGoalWait(leaf, params.box, session);
                return { loop: false, waiting: true, block: leaf };
            }
            return { loop: this._canLoop(leaf), block: leaf };
        }

        // внутри бокса-агента таск не ходит — им владеет движок (live.wait / человек)
        if (this.pipe[params.box.type]?.agent)
            return { loop: false, block: params.box };

        let mode = this.body.mode || 'plan';
        let node = this.pipe[params.block.type];
        let next = node?.[mode]?.next || node?.next;
        if (!next || node.box) {
            node = this.pipe[params.box.type];
            next = node?.[mode]?.next || node?.next;
        }

        let using_blocks = params.box.using_blocks ??= [];
        next = (next || []).filter(id => !using_blocks.includes(id));
        // после question без субагента / pursue — answer не в меню, пока goal open
        const goal = this.body.goal;
        if (goal && goal.status !== 'done' && goal.resume?.continue)
            next = next.filter(id => id !== 'answer');

        let choice;
        // незакрытый todo → сразу step (не fill и не меню report/question)
        const planned = params.box?.todo?.steps || [];
        const realSteps = (params.box?.items || []).filter(b => b.type === 'step');
        if (todoFocus && planned.length > realSteps.length && next.includes('step'))
            choice = 'step';
        else if (!next.length)
            choice = 'total';
        else if (next.length === 1)
            choice = next[0];
        else {
            const lines = next.map(id => {
                const n = this.pipe[id];
                const cap = n?.[mode]?.description || n?.[mode]?.inject
                    || n?.description || n?.inject || '';
                return id.toUpperCase() + ' - ' + cap + ';';
            });
            let menu = [
                'Выбери в menu пункт, который двигает открытую [goal] из контекста. Выбирай не по порядку, а по смыслу.',
                'Последняя реплика пользователя — уточнение или данные к goal, не новая задача (пока goal не done).',
                'Пункты-остановки (вопрос, форма) — только если без ответа человека продолжить объективно нельзя.',
                'answer не закрывает goal и не заменяет side-effect; при данных для действия выбирай агента (work/web/…).',
                'Если разумный default или план действий уже есть в контексте — не спрашивай, действуй.',
                'Ответь одним словом строго из списка, без знаков и пояснений.',
                '\n\n[menu]\n',
                ...lines,
            ].join('\n');
            let messages = await this.context({ session, prompt: menu });
            let response = await this._streamChat({ messages, silent: true, session });
            choice = menuPick(response.content, next)
                || (next.includes('thinking') ? 'thinking' : next[0]);
        }

        if (!choice)
            return { loop: false, block: params.block };

        params.block = this._build_block(choice);
        const boxBefore = params.box;
        const pushed = await this._push_block(params);
        // выбранный агент исполняет движок класса (live-контракт), не цикл таска
        if (pushed && this.pipe[choice]?.agent) {
            await this._runAgent(params, session);
            await this._captionDoc(params, session);
            await this._save(session);
            const b = params.block;
            if (b?.stop && hasBody(b)) {
                await this._noteGoalWait(b, params.box, session);
                return { loop: false, waiting: true, block: b };
            }
            // субагент действия отработал — слот continue больше не нужен
            if (choice !== 'question' && choice !== 'form')
                clearGoalContinue(this.body.goal);
            return { loop: this._canLoop(b), block: b };
        }
        if (pushed) {
            if (!params.block.box && !hasBody(params.block))
                await this._fillLeaf(params, session);
            if (hasBody(params.block))
                await this.pipe[params.block.type]?.recalc?.(params);
            await this._captionDoc(params, session);
        }
        await this._save(session);

        const focus = pushed ? params.block : boxBefore;
        if (focus?.stop && hasBody(focus)) {
            await this._noteGoalWait(focus, params.box, session);
            return { loop: false, waiting: true, block: focus };
        }
        return { loop: this._canLoop(focus), block: focus };
    },

    /** question/form stop (не live.wait): goal.waiting + resume.agent | resume.continue. */
    async _noteGoalWait(block, box, session) {
        const type = block?.type;
        if (type !== 'question' && type !== 'form')
            return;
        const body = await this.body;
        const g = body.goal;
        if (!g || g.status === 'done')
            return;
        g.status = 'waiting';
        const pipe = await this.pipe;
        let agent = null;
        if (box && pipe[box.type]?.agent && box.type !== 'question' && box.type !== 'form')
            agent = box.type;
        else
            agent = lastResumeAgent(body, pipe);
        // до субагента — continue: следующий ход без answer в меню
        g.resume = agent ? { agent } : { continue: true };
        await this._save(session);
    },

    /**
     * После терминального answer при незакрытой goal — ещё ход оркестратора (budget).
     * chat.done не шлём: pending держит исходный prompt.
     */
    async _pursueGoal(turn, session) {
        if (this._stopped)
            return false;
        const body = await this.body;
        const g = body.goal;
        if (!g || g.status === 'done' || g.status === 'waiting')
            return false;
        const leaf = turn?.block;
        if (!leaf || leaf.type !== 'answer' || !hasBody(leaf))
            return false;
        const n = Number(g.pursue) || 0;
        if (n >= GOAL_PURSUE_MAX)
            return false;
        g.pursue = n + 1;
        g.resume = { continue: true };
        await this._save(session);
        return true;
    },

    async _captionDoc(params, session) {
        const kind = this.pipe[params.block.type];
        const src = String(params.block.content || '').trim();
        if (!(params.block.doc && params.block.stop !== true && !this._stopped && src && kind?.label && params.block.label === kind.label))
            return;
        const cap = await this._streamChat({
            messages: [{ role: 'user', content: src + '\n\n[instruction]\n Сделай заголовок для этого блока. 2-3 слова. Без знаков и пояснений.' }],
            silent: true,
            session,
        });
        const words = String(cap.content || '').trim().replace(/^["«']+|["»'.]+$/g, '').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
        if (words)
            params.block.label = words;
    },

    /** Лист без тела: стрим в тот же блок. Пустой стоп — content не писать, тип снять с using. */
    async _fillLeaf(params = {}, session) {
        const next_pipe = this.pipe[params.block.type];
        let prompt = next_pipe.prompt || this.pipe[params.box.type].prompt;
        let messages;
        if (params.block.draft) {
            const draft = params.block.draft;
            const head = prompt + `\n\n[${params.block.type}: ${params.block.label}]\n`;
            const content = draft.type === 'image_url'
                ? [{ type: 'text', text: head }, draft]
                : head + (draft.type === 'text' ? draft.text : draft);
            messages = await this.context({ session, leaf: params.block });
            messages.push({ role: 'user', content });
            delete params.block.draft;
        }
        else {
            messages = await this.context({
                prompt, session,
                evidence: params.block.type !== 'total',
                leaf: params.block,
            });
        }
        const response = await this._streamChat({
            messages, session,
            maxOutput: next_pipe.maxOutput,
            allowReasoning: next_pipe.allowReasoning,
        });
        this._applyStream(params, response);
    },
    _applyStream(params, response) {
        let text = String(response.content || '').trim();
        if (params.block.title && text)
            text = String(params.block.title).trim() + '\n\n' + text;
        // внешний ```…``` → code-block в ленте; хвост после fence (подпись form) сохраняется
        if (text && typeof this.pipe?.unwrapFence === 'function')
            text = this.pipe.unwrapFence(text);
        if (text)
            params.block.content = text;
        else
            delete params.block.content;
        if (response.usage)
            params.block.usage = response.usage;
        if (!hasBody(params.block) && !this.pipe[params.block.type]?.ignore)
            dropUsedType(params.box, params.block.type);
    },
    _canLoop(block) {
        if (this._stopped || !block) return false;
        if (!hasBody(block))
            return !!block.box;
        return !block.stop;
    },
    async _init(params = {}) {
        params.block = await this._active_block();
        params.box = await this._active_box();
        const pipe = await this.pipe;
        params.pipe_step = pipe[params.block.type] || pipe.thinking;
        params.task = this;
    },
    /** handoff: заказчик передаёт свой system (body.system: место, локация, время) + диалог-улики;
     *  без topicsMap/leafSystem/ролей ходов таска — их допишет исполнитель (агент/tool).
     *  system только role=system, не user-кадром. */
    async context(params = {}) {
        const { prompt, evidence = true, leaf, handoff } = params;
        const body = await this.body;
        const chain = [];
        let box = body;
        for (;;) {
            chain.push(box);
            const next = box.items?.last;
            if (next?.box && !hasBody(next)) box = next;
            else break;
        }
        const focus = box;
        const layers = chain.map(b => this._box_context(b, b === focus, evidence, handoff));
        let messages;
        const goalBlock = formatGoalBlock(body.goal);
        if (handoff) {
            // база system от заказчика (уже с расположением); исполнитель дополнит локально
            const base = [String(body.system || '').trim(), goalBlock].filter(Boolean).join('\n\n');
            messages = base ? [{ role: 'system', content: base }] : [];
        }
        else {
            const mode = body.mode || 'plan';
            const pipe = await this.pipe;
            const leafNode = leaf?.type ? pipe[leaf.type] : null;
            const leafSystem = leafNode?.[mode]?.system || leafNode?.system || '';
            messages = [{ role: 'system', content: [
                ...layers.map(l => l.system).filter(Boolean),
                goalBlock,
                timeNow(body.tz),
                topicsMap(pipe, focus, mode),
                leafSystem,
            ].filter(Boolean).join('\n\n') }];
        }
        /** user+user — один ход; assistant+assistant — не склеивать (thinking|html|report), между ними «продолжай» */
        const push = (nextRole, content) => {
            if (!content) return;
            const last = messages.last;
            if (last?.role === nextRole && nextRole === 'user') {
                last.content += '\n\n' + content;
                return;
            }
            if (last?.role === 'assistant' && nextRole === 'assistant')
                messages.push({ role: 'user', content: 'ok' });
            messages.push({ role: nextRole, content });
        };
        for (const layer of layers)
            for (const m of layer.messages)
                push(m.role, m.content);
        if (!handoff && focus !== body)
            push('user', stageOpen(focus, this.pipe[focus.type]));
        if (prompt) {
            if (messages.last?.role === 'user')
                messages.last.content += '\n\n[instruction]\n' + prompt;
            else
                messages.push({ role: 'user', content: prompt });
        }
        return messages;
    },
    /** focus — все блоки слоя; предок — рамка: prompt, закрытые боксы (улики), answers.
     *  evidence: false (генерация total) — предки без уликов-боксов.
     *  expand-box отдаёт листья с ролью их узла, маркер box.content в контекст не идёт. */
    _box_context(box, focus = true, evidence = true, handoff = false) {
        const node = this.pipe[box.type];
        const mode = this.body.mode || 'plan';
        // box.system (on_save: кто/где) — база; pipe.system — слой роли агента/хода, не подмена
        const place = String(box.system || '').trim();
        let system;
        if (handoff) {
            // system заказчика уже в messages[0] из body.system; слой роли хода таска не тащим
            system = '';
        }
        else {
            const role = String(node?.[mode]?.system || node?.system || '').trim();
            system = [place, role].filter(Boolean).join('\n\n');
            if (box.todo)
                system += '\n\n[todo]\n' + (box.todo.content || '');
        }
        const messages = [];
        for (const b of (box.items || [])) {
            // error в total (evidence:false) — не в сводку (ложный провенанс); в обычный контекст — да,
            // иначе после «страница недоступна» модель не видит провал и лезет в planning
            if ((b.error && !evidence) || this.pipe[b.type]?.ignore || this.pipe[b.type]?.close || (b.box && !hasBody(b)))
                continue;
            const frame = b.type === 'prompt' || (b.box && evidence) || b.answer != null;
            if (!focus && !frame)
                continue;
            if (b.box && this.pipe[b.type]?.expand) {
                for (const leaf of (b.items || []))
                    if (leaf.content && !(leaf.error && !evidence) && !this.pipe[leaf.type]?.ignore)
                        messages.push({ role: this.pipe[leaf.type]?.role || 'assistant', content: leaf.content });
            }
            else if (focus || b.type === 'prompt' || b.box)
                messages.push({ role: this.pipe[b.type]?.role || 'assistant', content: b.content });
            if (b.page && !hasBody(b))
                messages.push({ role: 'user', content: b.page });
            if (b.answer != null)
                messages.push({ role: 'user', content: b.approved || (typeof b.answer === 'string' ? b.answer : JSON.stringify(b.answer)) });
        }
        return { system, messages };
    },
    async _streamChat(params = {}) {
        const {messages, silent, session} = params;
        const model = await this.model;
        const bar = (await this.body).effort;
        const effort = (bar && bar !== 'off' && params.allowReasoning === true) ? bar : 'off';
        const cap = silent ? 64 : Number(params.maxOutput);
        let content = '', usage = 0;
        let reasonBlock, reasonBox, reasonClosed;
        const closeReason = async () => {
            if (!reasonBlock || reasonClosed)
                return;
            reasonClosed = true;
            const items = reasonBox?.items;
            const i = items?.indexOf(reasonBlock) ?? -1;
            if (i >= 0)
                items.splice(i, 1);
            await this._save(session);
        };
        const chat = {
            messages,
            temperature: silent ? 0 : .5,
        };
        if (effort !== undefined)
            chat.effort = effort;
        if (Number.isFinite(cap) && cap > 0)
            chat.maxOutput = cap;
        for await (const chunk of model.streamChat(chat)) {
            if (this._stopped){
                content = '';
                break;
            }
                
            if (chunk?.type === 'usage')
                usage = chunk;
            else if (chunk?.type === 'reasoning') {
                if (effort === 'off')
                    continue;
                const token = chunk.content || '';
                if (!token) continue;
                if (!reasonBlock) {
                    reasonBox = await this._active_box();
                    reasonBlock = this._build_block('reasoning');
                    await this._push_block({ block: reasonBlock, box: reasonBox, session });
                }
                session?.send?.({ type: 'chat.delta', path: this.short, token });
            }
            else {
                let token = chunk?.content ? chunk?.content : chunk;
                if (typeof token !== 'string')
                    continue;
                await closeReason();
                content += token;
                if (!silent)
                    session?.send?.({ type: 'chat.delta', path: this.short, token });
            }
        }
        await closeReason();
        return { content, usage };
    },
    get pipe() {
        return this._pipe ??= new AsyncPromise(async () => {
            const files = await this.tilde;
            const ns = Object.create(null);
            const taskFile = [...files].reverse().find(f => f.id === 'task.js')
                || files.find(f => f.id === 'task.js');
            if (!taskFile)
                throw new Error('$task: нет task.js в tilde');
            const taskMod = await this._importPipeFile(taskFile);
            const taskDef = taskMod.default;
            for (const [k, v] of Object.entries(taskMod)) {
                if (k === 'default') continue;
                ns[k] = v;
            }
            registerOrchestrator(ns, taskDef);
            // агенты — декларации из меты класса (~/ai/agents, канон движка), не дубли $task
            const agentIds = [];
            const stepAgents = [];
            const agentsDir = await this.$class?.meta_folder?.get_item('ai/agents');
            if (agentsDir) {
                const kids = (await agentsDir.inherit_children) || (await agentsDir.children) || [];
                const byId = new Map();
                for (const f of kids) {
                    if (f?.id?.endsWith?.('.js'))
                        byId.set(f.id, f);
                }
                for (const [fileId, file] of byId) {
                    const id = fileId.replace(/\.js$/, '');
                    if (ns[id])
                        continue; // ходы оркестратора (thinking, answer, planning, report) выше агентов-тёзок
                    const mod = await this._importPipeFile(file);
                    registerAgent(ns, id, mod.default);
                    agentIds.push(id);
                    if (mod.default?.step !== false)
                        stepAgents.push(id);
                }
            }
            const own = [
                ...Object.keys(taskDef?.moves || {}),
                ...Object.keys(taskDef?.tools || {}),
            ];
            if (ns.task)
                ns.task.next = [...own, ...agentIds];
            if (ns.step) {
                const sn = ['thinking', ...stepAgents];
                ns.step.plan = { ...(ns.step.plan || {}), next: sn };
                ns.step.do = { ...(ns.step.do || {}), next: sn };
            }
            this._pipe = ns;
            return ns;
        });
    },
    async _importPipeFile(file) {
        const raw = await file.load();
        const script = this.constructor.stripAbsoluteImports(raw);
        const b64 = Buffer.from(script, 'utf-8').toString('base64');
        return import('data:text/javascript;base64,' + b64);
    },
    get body() {
        return new AsyncPromise(async () => {
            await this.pipe;
            let raw = await this.load();
            this.body = JSON.parse(raw);
            this.body.type ??= 'task';
            this.body.items ??= [];
            return this.body;
        });
    },
    get model() {
        return Promise.resolve(this.body).then(body => WORK.get_item(body.model));
    },
    /** Stop: прервать текущий стрим и не планировать самовызовы. Ленту не трогает. */
    async stop(params = {}) {
        this._stopped = true;
        return { ok: true, stopped: true };
    },
    _build_block(type) {
        const node = this.pipe[type] || {};
        const block = {
            type,
            box: node.box,
            doc: node.doc,
            icon: node.icon,
            stop: node.stop,
            // шапка блока скрыта при stop === true — label там мёртвый вес (строковый stop шапку не прячет)
            label: node.stop === true ? undefined : node.label,
        };
        if (node.ignore)
            block.ignore = true;
        if (node.expand)
            block.expand = true;
        if (block.box)
            block.items = [];
        return block;
    },    
    async _push_block(params = {}){
        const {block, session} = params;
        const box = params.box ??= await this.body;
        if (!block || !box) return false;
        box.items ??= [];
        const node = this.pipe[block.type];
        if (node?.agent && block.brief == null) {
            const body = await this.body;
            block.brief = agentBrief(body, block);
        }
        if (!node?.ignore) {
            const used = box.using_blocks ??= [];
            if (!used.includes(block.type))
                used.push(block.type);
        }
        // init агента — жизненный цикл движка класса, не пуш ленты
        const init = node?.agent ? null : node?.init;
        if (init && !await init(params))
            return false;

        block.time ??= Date.now();
        if (block.box)
            block.items ??= [];
        box.items.push(block);
        await this._save(session);
        return true;
    },
    async _active_block() {
        let box = await this._active_box();
        const planned = box.todo?.steps || [];
        const real = (box.items || []).filter(b => b.type === 'step');
        if (planned.length && (real.some(s => !hasBody(s)) || real.length < planned.length))
            return box.todo;
        if (box.type === 'includes') {
            const pipe = await this.pipe;
            const list = pipe.includePlan(box);
            const files = pipe.includeReal(box);
            const open = files.find(f => !hasBody(f));
            if (open)
                return open;
            if (list.length && files.length < list.length)
                return box;
        }
        const items = box.items || [];
        for (let i = items.length - 1; i >= 0; i--)
            if (!this.pipe[items[i].type]?.ignore)
                return items[i];
        return box;
    },
    async _active_box() {
        let next, box = await this.body;
        while (next = box.items?.last){
            if(next.box && !hasBody(next))
                box = next;
            else
                break;
        }
        return box;
    },
    async change_model(params = {}) {
        const model = params.model || params.post?.model;
        const session = params.session;
        if (!model) return { ok: false, error: 'model required' };
        (await this.body).model = model;
        await this._save(session);
        return { ok: true, model};
    },
    async change_effort(params = {}) {
        const effort = params.effort ?? params.post?.effort;
        const session = params.session;
        if (!effort) return { ok: false, error: 'effort required' };
        (await this.body).effort = effort;
        await this._save(session);
        return { ok: true, effort };
    },
    async remove_block(params = {}) {
        const block = params.block || params.post?.block || {
            time: params.time ?? params.post?.time,
            type: params.type ?? params.post?.type,
        };
        const body = await this.body;
        const box = parentOfBlock(body, block);
        if (!box) return { ok: false, error: 'block not found' };
        const i = box.items.findIndex(b => sameBlock(b, block));
        if (i < 0) return { ok: false, error: 'block not found' };
        const type = box.items[i].type;
        box.items.splice(i, 1);
        const used = box.using_blocks;
        if (used) {
            const j = used.indexOf(type);
            if (j >= 0) used.splice(j, 1);
            if (!used.length)
                delete box.using_blocks;
        }
        await this._save(params.session);
        return { ok: true };
    },
    async _save(session) {
        await WORK.fsp.writeFile(this.dir, JSON.stringify(this.body, null, 4), 'utf-8');
        session?.send?.({ path: this.short });
    },
};

function sameBlock(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.time && b.time)
        return Number(a.time) === Number(b.time) && a.type === b.type;
    return a.type === b.type && a.label === b.label && a.content === b.content;
}

function parentOfBlock(root, block) {
    if (!root || !block) return null;
    for (const b of (root.items || [])) {
        if (sameBlock(b, block)) return root;
        const p = parentOfBlock(b, block);
        if (p) return p;
    }
    return null;
}

/** Карта узлов из pipe: description / inject / label текущего mode. */
function topics(pipe, ids, mode) {
    return (ids || []).map(id => {
        const n = pipe[id];
        const inj = n?.[mode]?.description || n?.[mode]?.inject
            || n?.description || n?.inject || n?.label || '';
        return inj ? id + ' — ' + inj : id;
    }).join('\n');
}

/** next текущего фокуса минус using_blocks — что реально можно выбрать сейчас. */
function topicsMap(pipe, focus, mode) {
    const node = pipe[focus?.type];
    const used = focus?.using_blocks || [];
    const ids = (node?.[mode]?.next || node?.next || []).filter(id => !used.includes(id));
    if (!ids.length) return '';
    const moves = ids.filter(id => pipe[id]?.move);
    const agents = ids.filter(id => pipe[id]?.agent);
    const tools = ids.filter(id => pipe[id]?.tool);
    const parts = [];
    if (node?.agent) {
        if (moves.length)
            parts.push('[доступные ходы]\n' + topics(pipe, moves, mode));
        const rest = ids.filter(id => !pipe[id]?.move);
        if (rest.length)
            parts.push('[доступные инструменты]\n' + topics(pipe, rest, mode));
        return parts.join('\n\n');
    }
    if (moves.length)
        parts.push('[доступные ходы]\n' + topics(pipe, moves, mode));
    if (tools.length)
        parts.push('[доступные инструменты]\n' + topics(pipe, tools, mode));
    const other = ids.filter(id => !pipe[id]?.move && !pipe[id]?.tool && !pipe[id]?.agent);
    if (other.length)
        parts.push('[доступные ходы]\n' + topics(pipe, other, mode));
    if (agents.length)
        parts.push('[доступные агенты]\n' + topics(pipe, agents, mode));
    return parts.join('\n\n');
}

/** Сессионная цель для system/меню: факт + норма достижения. */
function formatGoalBlock(goal) {
    if (!goal?.text)
        return '';
    const lines = [
        '[goal]',
        String(goal.text).trim(),
        'status: ' + (goal.status || 'open'),
    ];
    if (goal.resume?.agent)
        lines.push('resume: ' + goal.resume.agent);
    if (goal.resume?.continue)
        lines.push('resume: continue (данные получены — действуй, не болтай)');
    if (goal.status !== 'done') {
        lines.push(
            'Пока status не done — цель не достигнута; сессия не считается выполненной.',
            'Реплика пользователю не равна выполнению. Не утверждай side-effect без факта в ленте (write/web/…).',
            'Ответ человека после question — данные к цели; следующий ход — действие по goal, не «понял, сделаю».',
        );
    }
    return lines.join('\n');
}

function clearGoalContinue(goal) {
    if (goal?.resume?.continue)
        goal.resume = null;
}

const GOAL_PURSUE_MAX = 3;

/** Последний незакрытый субагент в ленте (не question/form) — кому вернуть ответ человека. */
function lastResumeAgent(body, pipe) {
    const walk = (items) => {
        for (let i = (items || []).length - 1; i >= 0; i--) {
            const b = items[i];
            const nested = walk(b.items);
            if (nested)
                return nested;
            if (pipe[b.type]?.agent && b.type !== 'question' && b.type !== 'form')
                return b.type;
        }
        return null;
    };
    return walk(body?.items);
}

/** Бриф агенту: URL/тема из последнего prompt, без копирования thinking. */
function agentBrief(body, block) {
    let last = '';
    let t = -1;
    const walk = (items) => {
        for (const b of items || []) {
            if (b.type === 'prompt' && b.content && (b.time || 0) >= t) {
                t = b.time || 0;
                last = b.content;
            }
            walk(b.items);
        }
    };
    walk(body?.items);
    const text = String(last || body?.title || '').trim();
    return text.slice(0, 500);
}

function liftBag(ns, bag, flag) {
    for (const [tid, raw] of Object.entries(bag || {})) {
        const t = { ...raw, ...flag };
        if (t.description && !t.inject)
            t.inject = t.description;
        ns[tid] = t;
    }
    return Object.keys(bag || {});
}

/** Оркестратор: moves + tools → pipe; next = ключи обоих (агентов добавит loader). */
function registerOrchestrator(ns, def) {
    if (!def || typeof def !== 'object')
        return;
    const moveKeys = liftBag(ns, def.moves, { move: true });
    const toolKeys = liftBag(ns, def.tools, { tool: true });
    ns.task = {
        ...def,
        box: true,
        orchestrator: true,
        inject: def.description || def.inject,
        next: [...moveKeys, ...toolKeys],
    };
}

/** Агент: moves + tools (+ plan/do.tools); next = moves ∪ tools ∪ total. */
function registerAgent(ns, id, def) {
    if (!def || typeof def !== 'object')
        return;
    const moveKeys = liftBag(ns, def.moves, { move: true });
    const toolBags = [];
    if (def.tools)
        toolBags.push(def.tools);
    if (def.plan?.tools)
        toolBags.push(def.plan.tools);
    if (def.do?.tools)
        toolBags.push(def.do.tools);
    const allTools = Object.assign({}, ...toolBags);
    const toolKeys = liftBag(ns, allTools, { tool: true });
    const hasTools = toolKeys.length > 0;
    const withTotal = (keys) => {
        const list = [...keys];
        if (hasTools && !list.includes('total'))
            list.push('total');
        return list;
    };
    const own = () => withTotal([...moveKeys, ...Object.keys(def.tools || {})]);
    const node = {
        ...def,
        agent: true,
        box: hasTools,
        inject: def.description || def.inject,
        next: own(),
    };
    if (def.step === false)
        node.step = false;
    if (def.plan) {
        node.plan = {
            ...def.plan,
            inject: def.plan.description || def.plan.inject,
            next: withTotal([...moveKeys, ...Object.keys(def.plan.tools || {})]),
        };
    }
    if (def.do) {
        node.do = {
            ...def.do,
            inject: def.do.description || def.do.inject,
            next: withTotal([...moveKeys, ...Object.keys(def.do.tools || {})]),
        };
    }
    if (!def.tools && def.plan?.tools)
        node.next = node.plan.next;
    ns[id] = node;
}

/** Последний блок типа agentId в дереве (для результата scoped-prompt). */
function findAgentBlock(root, agentId) {
    let found;
    const walk = (box) => {
        for (const b of box?.items || []) {
            if (b.type === agentId)
                found = b;
            if (b.box)
                walk(b);
        }
    };
    walk(root);
    return found;
}

function agentResult(agent, block, extra = {}) {
    return {
        ok: true,
        agent,
        content: block?.content,
        error: block?.error ? true : undefined,
        state: block?.state,
        block,
        ...extra,
    };
}

/** Слово меню: точное / первое слово / id из списка внутри текста. */
function menuPick(text, next) {
    const t = String(text || '').trim().toLowerCase();
    if (!t || !next?.length) return;
    if (next.includes(t)) return t;
    const first = t.split(/\s+/)[0]?.replace(/[^a-z0-9_]+/g, '');
    if (first && next.includes(first)) return first;
    return next.find(id => new RegExp('\\b' + id + '\\b', 'i').test(t));
}

function stageOpen(block, node) {
    if (!node?.box) return '';
    const label = node.label || block.label || block.type;
    return 'Текущий этап далее (' + label + ').';
}

function hasBody(b) {
    return !!String(b?.content ?? '').trim();
}

function dropUsedType(box, type) {
    const used = box?.using_blocks;
    if (!used) return;
    const j = used.indexOf(type);
    if (j >= 0) used.splice(j, 1);
    if (!used.length)
        delete box.using_blocks;
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

