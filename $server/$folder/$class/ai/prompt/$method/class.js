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
 * Стоп на человека: tool.stop + live.wait — движок ждёт ответ и продолжает;
 *   лист-агент со stop (question/form/planning/report) возвращается владельцу как есть.
 * круг / вложенный агент — снова execute(params), не HTTP.
 * tool/agent.init получают engine: this (для ask peer без ~/ai у цели) и task (владелец ленты, если передан).
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

        if (own)
            live.send({ type: 'chat.start' });

        await live.save?.();

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
        const skillTools = params.skillStep?.tools;
        const next = skillTools?.length
            ? skillToolNext(skillTools, ids, block)
            : await this.pick(ctx, ids, tools, mode);
        if (live?.stopped) {
            delete block.inited;
            return;
        }
        if (!next || next === 'stop' || next === 'total')
            return this.total(ctx, tools);

        const tool = tools[next];
        if (tool) {
            const child = { type: next, label: tool.label, icon: tool.icon, time: Date.now() };
            if (tool.stop != null)
                child.stop = tool.stop;
            // doc — только после done (write/create evidence); не копировать с tool на пустой стрим
            if (!tool.ignore) {
                const used = block.using_blocks ??= [];
                if (!used.includes(next))
                    used.push(next);
            }
            block.items.push(child);
            await live.save?.();
            if (typeof tool.init === 'function') {
                const ok = await tool.init({
                    block: child, box: block, messages, session, model, live, exec, agent,
                    engine: this,
                    task: params.task,
                    streamChat: (p) => this.streamChat({ ...p, model, live }),
                });
                await live.save?.();
                if (live?.stopped) {
                    delete block.inited;
                    return;
                }
                if (ok === false) {
                    // init === false — «здесь этому tool нечего делать»: блок снимается,
                    // тип остаётся в using_blocks — в этом боксе его больше не предлагаем (меню только сужается)
                    block.items.pop();
                    const used = block.using_blocks ??= [];
                    if (!used.includes(next))
                        used.push(next);
                    await live.save?.();
                    return this.turn(ctx);
                }
            }
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
                    block: child, box: block, messages, session, live, exec,
                    engine: this, task: params.task,
                });
            pushLift(messages, child);
            await live.save?.();
            if (child.stop) {
                if (!live.wait) {
                    // standalone: стоп возвращается владельцу как есть
                    delete block.inited;
                    return;
                }
                // ждём человека; approve выполняет владелец ленты, сюда приходит факт
                const res = await live.wait(child) || {};
                if (live?.stopped) {
                    delete block.inited;
                    return;
                }
                if (res.content)
                    messages.push({ role: 'user', content: String(res.content) });
                delete child.stop;
                await live.save?.();
            }
            return this.execute({
                ...params,
                agent: type, model, messages, session, live,
                prompt: undefined,
                block,
            });
        }

        // вложенный агент — в ленту до execute (как tool: push → save → ход)
        const sub = { type: next, time: Date.now() };
        block.items.push(sub);
        await live.save?.();
        await this.execute({
            ...params,
            agent: next,
            prompt: undefined,
            block: sub,
            box: block,
        });
        if (live?.stopped) {
            delete block.inited;
            return;
        }
        if (sub.skip) {
            const i = block.items.indexOf(sub);
            if (i >= 0)
                block.items.splice(i, 1);
            await live.save?.();
        }
        else
            pushLift(messages, sub);
        return this.execute({
            ...params,
            agent: type, model, messages, session, live,
            prompt: undefined,
            block,
        });
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
            delete block.state;
        }
        else if (!results.length && fails.length && !ownDraft) {
            block.error = true;
            block.content = fails.map(b => b.content).filter(Boolean).join('\n') || 'ошибка';
            if (fails.length > 1)
                block.state = 'ошибки: ' + fails.length;
            else if (!block.state || /^сайты:/.test(block.state))
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
                delete block.state;
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
                        'Выбери следующий шаг одним словом из списка, без знаков и пояснений.',
                        '[menu]',
                        ...lines,
                    ].filter(Boolean).join('\n'),
                },
            ],
        });
        if (live?.stopped)
            return;
        const word = String(response.content || '').trim().split(/\s+/)[0]
            ?.replace(/^[`"'«]+|[`"'»;:,.]+$/g, '');
        return ids.includes(word) ? word : ids[0];
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

    /** Единый стрим: effort (гейт allowReasoning), maxOutput, usage, стоп и reasoning-блок через live. */
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
                    reasonBlock = { type: 'reasoning', label: 'Рассуждаю', icon: 'carbon:idea', ignore: true, time: Date.now() };
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
    if (agent.prompt && !used.includes('total') && !used.includes('stop'))
        ids.push('stop');
    return ids;
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
