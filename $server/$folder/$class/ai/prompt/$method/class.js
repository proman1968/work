/**
 * $method prompt — one-shot: агент из ai/agents/.
 * params: { session, agent, model, location, messages, prompt, block }
 * messages мутируются; нет → [{ role:'system', … }].
 * block — собрать/продолжить; возврат — блок (с items) для items.push.
 * круг / вложенный агент — снова execute(params), не HTTP.
 */

export default {
    async execute(params = {}) {
        let { session, agent, model, location, messages, prompt, block } = params;

        const type = agent || 'answer';
        agent = await this.loadAgent(type);
        model ??= agent.model;

        if (!messages) {
            messages = [{
                role: 'system',
                content: await this.buildSystemPrompt({ session, location }),
            }];
        }

        if (prompt)
            messages.push({ role: 'user', content: prompt });

        block ??= {
            type,
            label: agent.label,
            icon: agent.icon,
            items: [],
        };
        if (agent.stop != null)
            block.stop = agent.stop;
        if (prompt && !block.brief)
            block.brief = String(prompt).trim();

        const path = this.$context?.short;
        const root = !params._deep;
        if (root)
            session?.send?.({ type: 'chat.start', path });

        try {
            await this.turn({
                block, agent, type, model, messages, session, location, params,
            });
            if (root)
                session?.send?.({ type: 'chat.done', path });
            return block;
        }
        catch (e) {
            if (root)
                session?.send?.({ type: 'chat.done', path });
            return { type: 'error', content: e.message };
        }
    },

    /** Ход агента: лист → fill; box → init / tool|агент → снова execute. */
    async turn(ctx) {
        const { block, agent, type, model, messages, session, location, params } = ctx;
        const tools = agent.tools || {};
        const toolIds = Object.keys(tools);

        if (!toolIds.length) {
            await this.fill(block, { agent, model, messages, session });
            if (block.content)
                messages.push({ role: 'assistant', content: block.content });
            delete block.inited;
            return;
        }

        if (!block.inited) {
            block.inited = true;
            if (typeof agent.init === 'function') {
                await agent.init({
                    block, messages, session, model,
                    owner: this.$context,
                    streamChat: (p) => this.streamChat({ ...p, model, session }),
                });
                if (block.error && block.content) {
                    messages.push({ role: 'assistant', content: block.content });
                    delete block.inited;
                    return;
                }
            }
        }

        const next = await this.pick(ctx, nextIds(agent, block, toolIds));
        if (!next || next === 'stop') {
            await this.fill(block, { agent, model, messages, session });
            if (typeof agent.enrichTotal === 'function' && block.content)
                block.content = agent.enrichTotal(block.content, block);
            if (block.content)
                messages.push({ role: 'assistant', content: block.content });
            delete block.inited;
            return;
        }

        if (tools[next]) {
            const tool = tools[next];
            const child = { type: next, label: tool.label, icon: tool.icon, items: [] };
            block.items.push(child);
            if (typeof tool.init === 'function') {
                const ok = await tool.init({
                    block: child, box: block, messages, session, model,
                    owner: this.$context,
                    agent,
                    streamChat: (p) => this.streamChat({ ...p, model, session }),
                });
                if (ok === false) {
                    block.items.pop();
                    await this.fill(block, { agent, model, messages, session });
                    if (typeof agent.enrichTotal === 'function' && block.content)
                        block.content = agent.enrichTotal(block.content, block);
                    if (block.content)
                        messages.push({ role: 'assistant', content: block.content });
                    delete block.inited;
                    return;
                }
            }
            if (!child.content && (child.draft || tool.prompt || tool.system)) {
                await this.fill(child, {
                    agent: { system: tool.system || agent.system, prompt: tool.prompt },
                    model, messages, session,
                });
                delete child.draft;
            }
            if (child.content)
                messages.push({ role: 'assistant', content: child.content });
            return this.execute({
                ...params,
                agent: type, model, messages, location, session,
                prompt: undefined,
                block,
                _deep: true,
            });
        }

        const child = await this.execute({
            session, model, location, messages,
            agent: next,
            _deep: true,
        });
        block.items.push(child);
        return this.execute({
            ...params,
            agent: type, model, messages, location, session,
            prompt: undefined,
            block,
            _deep: true,
        });
    },

    async pick(ctx, ids) {
        if (!ids?.length)
            return;
        if (ids.length === 1)
            return ids[0];
        const { agent, block, messages, model, session } = ctx;
        const lines = ids.map(id => {
            const node = agent.tools?.[id] || {};
            return `- ${id}: ${node.description || node.label || id}`;
        });
        const response = await this.streamChat({
            model, session, silent: true,
            messages: [
                ...messages,
                {
                    role: 'user',
                    content: [
                        agent.system,
                        block.brief && ('Тема: ' + block.brief),
                        'Выбери следующий шаг одним словом из списка, без знаков и пояснений.',
                        '[menu]',
                        ...lines,
                    ].filter(Boolean).join('\n'),
                },
            ],
        });
        const word = String(response.content || '').trim().split(/\s+/)[0]
            ?.replace(/^[`"'«]+|[`"'»;:,.]+$/g, '');
        return ids.includes(word) ? word : ids[0];
    },

    async fill(block, { agent, model, messages, session }) {
        const chat = messages.map(m => ({ ...m }));
        if (agent.system && chat[0]?.role === 'system')
            chat[0] = { role: 'system', content: chat[0].content + '\n\n' + agent.system };
        if (block.draft) {
            const head = (agent.prompt || '') + `\n\n[${block.type}: ${block.label || ''}]\n`;
            chat.push({
                role: 'user',
                content: head + (typeof block.draft === 'string' ? block.draft : block.draft.text || ''),
            });
        }
        else if (agent.prompt) {
            chat.push({ role: 'user', content: '[instruction]\n' + agent.prompt });
        }
        const response = await this.streamChat({ model, messages: chat, session });
        let text = String(response.content || '').trim();
        if (block.title && text)
            text = String(block.title).trim() + '\n\n' + text;
        if (text)
            block.content = text;
        else
            delete block.content;
    },

    async streamChat({ model, messages, session, silent } = {}) {
        const path = this.$context?.short;
        const modelItem = await WORK.get_item(model);
        let content = '';
        for await (const chunk of modelItem.streamChat({
            messages,
            temperature: .5,
        })) {
            if (chunk?.type === 'usage' || chunk?.type === 'reasoning')
                continue;
            const token = typeof chunk === 'string' ? chunk : chunk?.content;
            if (typeof token !== 'string' || !token)
                continue;
            content += token;
            if (!silent)
                session?.send?.({ type: 'chat.delta', path, token });
        }
        return { content: content.trim() };
    },

    async loadAgent(agent = 'answer') {
        const file = await this.$context.meta_folder.get_item(`ai/agents/${agent}.js`);
        if (!file && agent !== 'answer')
            return this.loadAgent('answer');
        return this.$context.constructor.importScript(await file.load());
    },

    async buildSystemPrompt({ session, location } = {}) {
        const user_info = await session?.$user?.info?.();
        const class_info = await this.$context?.info?.();
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
        const file = await this.$context.meta_folder.get_item('ai/system.md');
        const system = String(await file.load({ encoding: 'utf-8' })).trim();
        return [
            system,
            placeContext(user_info, class_info),
            location,
        ].filter(Boolean).join('\n');
    },
};

function nextIds(agent, block, toolIds) {
    const used = block.using_blocks || [];
    const ids = toolIds.filter(id => !used.includes(id));
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
