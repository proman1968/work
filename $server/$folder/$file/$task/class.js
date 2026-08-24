// Линейный реестр PIPE (по id = type блока);
export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',
    async prompt(params = {}, post) {
        
        // debugger;
        let { prompt, role, session } = params;
        params.block = await this._active_block();
        params.container = await this._active_container();
        params.pipe_step = PIPE[params.block.type] || PIPE.thinking;
        params.task = this;

        try {
            switch (role) {
                case 'AI':{
                    this._stopped = false;
                } break;
                case 'APPROVE':{
                    this._stopped = false;
                    params.block.answer = prompt;
                    if (params.accept === true || params.accept === 'true') {
                        params.block.state = 'approved';
                        params.block.icon = 'icons:check';
                        await params.pipe_step.approve?.(params);
                    } else {
                        params.block.state = 'rejected';
                        params.block.icon = 'icons:close';
                    }
                    delete params.block.stop;
                    await this._save(session);
                } break;
                default:{
                    this._stopped = false;
                    if (params.container?.content)
                        delete params.container.content;
                    const pending = [...(params.container?.items || [])].reverse().find(b => typeof b.stop === 'string');
                    if (pending) {
                        pending.state = 'rejected';
                        pending.icon = 'icons:close';
                        delete pending.stop;
                    }
                    const text = String(prompt ?? '').trim();
                    if (text) {
                        params.block = {
                            type: 'prompt',
                            content: text,
                        };
                        await this._push_block(params);
                    }
                    const files = await attachFiles(this, post || params.post, session);
                    if (files.length) {
                        params.block = {
                            type: 'includes',
                            icon: PIPE.includes.icon,
                            label: PIPE.includes.label,
                            files,
                            items: [],
                        };
                        await this._push_block(params);
                    }
                }
            }
            params.block = await this._active_block();
            params.container = await this._active_container();
            params.pipe_step = PIPE[params.block.type] || PIPE.thinking;
            await params.pipe_step.recalc?.(params);
            params.block = await this._active_block();
            params.container = await this._active_container();
            params.pipe_step = PIPE[params.block.type] || PIPE.thinking;

            if (await params.pipe_step.run?.(params))
                return this._continue(params);

            let streamed = false;
            if (!params.pipe_step.container && !params.block.content)
                streamed = await this._pipe_stream(params);
            if (streamed) {
                if (!this._stopped && !params.block.stop)
                    return { ok: true };
            }
            else {
            let mode = containerMode(await this.body, params.container);
            let options = next_options(params.container, params.block, mode);
            if (!options.length) {
                session?.send?.({ type: 'chat.done', path: this.short });
                return { ok: true };
            }
            let messages, response, choice = '';
            if(options.length === 1) {
                choice = options[0];
            }
            else {
                let menu =  options.map(id => id.toUpperCase() + ' - ' + (PIPE[id]?.[mode]?.inject || PIPE[id]?.inject || 'пропустить'));
                if(menu.length > 0)
                    menu.unshift('Выбери один вариант из списка. Ответь одним словом, без знаков и пояснений. Выберай шаг или действие, которое необходимо сделать дальше.');
                menu = menu.join('\n');
                menu += '\n\nЕсли ни один вариант не подходит, просто уточни у пользователя, что тебе нужно делать дальше.';

                messages = await this.context({prompt: menu, session});
                response = await this._streamChat({ messages, silent: true, session });
                if (!this._stopped)
                    choice = response.content.trim().toLowerCase();
            }
            if (!this._stopped) {
                let next_pipe = options.includes(choice) ? PIPE[choice] : null;
                if (!next_pipe) {
                    choice = Object.keys(PIPE).find(id => PIPE[id]?.fallback === true);
                    next_pipe = PIPE[choice];
                }
                if (!next_pipe) {
                    session?.send?.({ type: 'chat.done', path: this.short });
                    return { ok: true };
                }

                params.block = {
                    type: choice,
                    icon: next_pipe.icon || 'carbon:idea',
                    stop: next_pipe.stop,
                    label: next_pipe.label,
                }
                if(next_pipe.container)
                    params.block.items = [];

                await this._push_block(params);
                params.pipe_step = next_pipe;
                if (next_pipe.run) {
                    await this._save(session);
                    if (!params.block.stop)
                        this.async(() => this.prompt({ role: 'AI', session }));
                    return { ok: true };
                }
                if (await this._pipe_stream(params) && !this._stopped && !params.block.stop)
                    return { ok: true };
                if (next_pipe.container && !params.block.stop) {
                    this.async(() => this.prompt({ role: 'AI', session }));
                    return { ok: true };
                }
            }
            }
        }
        catch (e) {
            params.block = { type: 'error', content: e.message };
            await this._push_block(params);
        }

        session?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
    },
    async context(params = {}) {
        const {prompt} = params;
        const layers = [];
        let container = await this.body;
        for (;;) {
            layers.push(this._container_context(container));
            const next = container.items?.last;
            if (next?.items && !next.content) container = next;
            else break;
        }
        const mode = containerMode(await this.body, container);
        const modeLine = mode === 'do' ? 'Сейчас ты в режиме исполнения.' : 'Сейчас ты в режиме планирования.';
        const messages = [{ role: 'system', content: [...layers.map(l => l.system).filter(Boolean), locationNow(await this.body), modeLine].filter(Boolean).join('\n\n') }];
        const push = (nextRole, content) => {
            if (!content) return;
            if (messages.last?.role === nextRole) {
                if (nextRole === 'assistant')
                    messages.push({ role: 'user', content: 'продолжай' });
                else {
                    messages.last.content += '\n\n' + content;
                    return;
                }
            }
            messages.push({ role: nextRole, content });
        };
        for (const layer of layers)
            for (const m of layer.messages)
                push(m.role, m.content);
        if (prompt) {
            if (messages.last?.role === 'user')
                messages.last.content += '\n\n[instruction]\n' + prompt;
            else
                messages.push({ role: 'user', content: prompt });
        }
        return messages;
    },
    async _pipe_stream(params = {}) {
        const { session, block } = params;
        const pipe = params.pipe_step || PIPE[block?.type];
        if (pipe?.container)
            return false;
        const mode = containerMode(await this.body, params.container);
        const place = PIPE[params.container?.type];
        const text = pipe.close
            ? [place?.prompt, CONTINUE].filter(Boolean).join('\n')
            : (pipe[mode]?.prompt || pipe.prompt);
        if (!text)
            return false;
        const messages = await this.context({ prompt: text, session });
        const response = await this._streamChat({ messages, session });
        if (!this._stopped) {
            Object.assign(block, response);
            pipe.parse?.(block);
            await pipe.recalc?.(params);
            await PIPE.close_up(await this.body, block, params);
            await this._save(session);
            if (!block.stop)
                this.async(() => this.prompt({ role: 'AI', session }));
        }
        return true;
    },
    _container_context(container) {
        const node = PIPE[container.type];
        const mode = container.mode || 'plan';
        let system = node?.[mode]?.system || node?.system || container.system || '';
        if (container.todo)
            system += '\n\n[todo]\n' + (container.todo.content || '');
        const messages = [];
        for (const b of (container.items || [])) {
            if (PIPE[b.type]?.close)
                continue;
            messages.push({ role: PIPE[b.type]?.role || 'assistant', content: b.content || stageOpen(b) });
            if (b.page && !b.content)
                messages.push({ role: 'user', content: b.page });
            if (b.answer != null)
                messages.push({ role: 'user', content: typeof b.answer === 'string' ? b.answer : JSON.stringify(b.answer) });
        }
        return { system, messages };
    },
    async _streamChat(params = {}) {
        const {messages, silent, session} = params;
        const model = await this.model;
        let content = '', usage = 0;
        for await (const chunk of model.streamChat({ messages })) {
            if (this._stopped)
                break;
            if (chunk?.type === 'usage')
                usage = chunk;
            else {
                let token = chunk?.content ? chunk?.content : chunk;
                if (typeof token !== 'string')
                    continue;
                content += token;
                if (!silent)
                    session?.send?.({ type: 'chat.delta', path: this.short, token });
            }
        }
        return { content, usage };
    },
    async _fc_exec(service, call, { block, session } = {}) {
        const args = call.args || {};
        if (call.method === 'search' && block?.type === 'web') {
            const result = typeof service?.search === 'function'
                ? await service.search(args)
                : { error: 'сервис поиска недоступен' };
            const seen = PIPE.usedSiteUrls(PIPE.parentOf(await this.body, block), block);
            block.sites = [];
            for (const r of result?.results || []) {
                const url = r.url;
                if (!url || seen.has(url))
                    continue;
                seen.add(url);
                block.sites.push({ url, title: r.title || '' });
            }
            if (result?.error || !block.sites.length) {
                block.state = 'error';
                block.content = PIPE.shortError(result?.error || 'пусто');
            }
            await this._save(session);
            return result ?? {};
        }
        if (call.method === 'fetch_url' && block?.type === 'site') {
            const url = String(block.url || args.url || '').trim();
            const result = await service.fetch_url?.({ url });
            block.icon = PIPE.siteFavicon(url);
            if (result?.error)
                block.state = 'error';
            await this._save(session);
            return result ?? {};
        }
        if ((call.method === 'semantic_search' || call.method === 'find_text') && block?.type === 'search') {
            const query = String(args.prompt || args.text || '').trim();
            if (query)
                block.label = query;
            const result = await service[call.method]?.(args);
            block.content = PIPE.formatFileHits(result);
            await this._save(session);
            return result ?? {};
        }
        if ((call.method === 'read_text' || call.method === 'load') && block?.type === 'read') {
            const path = String(args.path || block.path || '').trim();
            block.path = path;
            block.label = path || PIPE.read.label;
            try {
                const file = await WORK.get_item(path);
                if (!file)
                    throw new Error('файл не найден: ' + path);
                const text = await file.read_text();
                block.content = typeof text === 'string' && text.trim() ? text : '—';
            } catch (e) {
                block.state = 'error';
            block.content = PIPE.shortError(e);
            }
            await this._save(session);
            return { path, content: block.content, error: block.state === 'error' ? block.content : undefined };
        }
        if (['save_file', 'save', 'edit'].includes(call.method) && block?.type === 'write') {
            const path = String(args.path || block.path || '').trim();
            try {
                if (call.method === 'save_file') {
                    const folder = path ? await WORK.get_item(path) : service;
                    const dest = [(folder.path || folder.short || path || '').replace(/\/$/, ''), args.filename].filter(Boolean).join('/');
                    await folder.save_file({ filename: args.filename, post: args.post, message: args.message });
                    block.path = dest;
                    block.label = dest;
                    block.content = 'записано: ' + dest;
                } else {
                    const file = await WORK.get_item(path);
                    await file[call.method]({ post: args.post });
                    block.path = path;
                    block.label = path;
                    block.content = (call.method === 'edit' ? 'правка: ' : 'записано: ') + path;
                }
            } catch (e) {
                block.state = 'error';
                block.content = e.message || '—';
            }
            await this._save(session);
            return { path: block.path, content: block.content, error: block.state === 'error' ? block.content : undefined };
        }
        return await service[call.method]?.(args);
    },
    get pipe(){    ;
        return globalThis.PIPE ??= new AsyncPromise(async () =>{
            let files = await this.tilde;
            let pipe = files.find(f => f.id === 'pipe.js');
            let raw = await pipe.load();
            globalThis.PIPE = await this.constructor.importScript(raw);
            return globalThis.PIPE;
        })
    },
    get body(){
        return new AsyncPromise(async () =>{
            await this.pipe;
            let raw = await  this.load();
            this.body = JSON.parse(raw);
            this.body.type ??= 'task';
            this.body.items ??= [];
            return this.body;
        })
    },
    get model(){
        return Promise.resolve(this.body).then(body => {
            return WORK.get_item(body.model)
        })
    },
    /** Stop: прервать текущий стрим и не планировать самовызовы. Ленту не трогает. */
    async stop(params = {}) {
        this._stopped = true;
        return { ok: true, stopped: true };
    },
    async _push_block(params = {}){
        const {block, container, session} = params;
        block.time ??= Date.now();
        container.items.push(block);
        delete container.close_n;
        if (block.type === 'prompt')
            delete container.using_blocks;
        useBlock(container, block.type);
        PIPE[block.type]?.recalc?.({ ...params, block, container });
        await this._save(session);
    },
    async _active_block() {
        let container = await this._active_container();
        const planned = container.todo?.steps || [];
        const real = (container.items || []).filter(b => b.type === 'step');
        if (planned.length && (real.some(s => !s.content) || real.length < planned.length))
            return container.todo;
        if (container.type === 'includes') {
            const list = PIPE.includePlan(container);
            const files = PIPE.includeReal(container);
            const open = files.find(f => !f.content);
            if (open)
                return open;
            if (list.length && files.length < list.length)
                return container;
        }
        const items = container.items || [];
        return items.last || container;
    },
    async _active_container() {
        let next,container = await this.body;
        while (next = container.items?.last){
            if(next.items && !next.content)
                container = next;
            else
                break;
        }
        return container;
    },
    async change_model(params = {}) {
        const model = params.model || params.post?.model;
        const session = params.session;
        if (!model) return { ok: false, error: 'model required' };
        (await this.body).model = model;
        await this._save(session);
        return { ok: true, model};
    },
    async _save(session){
        await WORK.fsp.writeFile(this.dir, JSON.stringify(this.body, null, 4), 'utf-8');
        session?.send?.({ path: this.short });
    },
    async _continue(params = {}) {
        const session = params.session;
        await this._save(session);
        if (!this._stopped)
            this.async(() => this.prompt({ role: 'AI', session }));
        return { ok: true };
    }
};


//-----------------------------------------------------------------------------


const CONTINUE = 'continue — только если в этом этапе ещё нужен поиск или работа, не потому что пользователь не уточнил тему.';



function next_options(container, block, mode) {
    if (container?.content)
        return [];
    const node = PIPE[block?.type];
    const own = node?.[mode]?.next || node?.next;
    const place = PIPE[container?.type];
    const parentNext = place?.[mode]?.next || place?.next || [];
    let options;
    if (block?.content && node?.container)
        options = node.done?.next?.length ? node.done.next : parentNext;
    else if (own?.length)
        options = own;
    else
        options = parentNext;
    const used = new Set(container?.using_blocks || []);
    const list = options.filter(id => {
        if (container?.type === 'includes') {
            const list = PIPE.includePlan(container);
            const files = PIPE.includeReal(container);
            const more = list.length && files.length < list.length;
            const all = list.length && files.length >= list.length && files.every(f => f.content);
            if (id === 'file')
                return more && !used.has(id);
            if (id === 'report')
                return all && !used.has(id);
        }
        if (PIPE[id]?.close && !can_close(container))
            return false;
        return !used.has(id);
    });
    if (container?.type === 'task' && !taskAsked(container) && list.includes('question'))
        return ['question'];
    return list;
}

function taskAsked(container) {
    return (container?.items || []).some(b => b.type === 'prompt' && String(b.content || '').trim());
}

async function attachFiles(task, post, session) {
    const incoming = post?.files;
    if (!incoming?.length)
        return [];
    const logs = await task.$owner.save_files({
        post: { files: incoming },
        ignore_save_logs: true,
        session,
    });
    const out = [];
    for (const log of logs || []) {
        const path = log?.logFullPath || log?.path;
        if (!path)
            continue;
        const full = path.startsWith('/') ? path : '/' + path;
        const file = await WORK.get_item(full);
        out.push({
            path: full,
            label: file?.id || full.split('/').pop(),
            icon: file?.icon || PIPE.file.icon,
        });
    }
    return out;
}

function useBlock(container, type) {
    if (!container || !type) return;
    container.using_blocks ??= [];
    if (!container.using_blocks.includes(type))
        container.using_blocks.push(type);
}


function can_close(container) {
    return (container?.items || []).some(b =>
        b.content && b.state !== 'error' && !PIPE[b.type]?.close && b.type !== 'thinking' && b.type !== 'prompt');
}

function stageOpen(block) {
    if (!PIPE[block?.type]?.container) return '';
    const label = PIPE[block.type].label || block.label || block.type;
    return 'Текущий этап далее (' + label + ').';
}

function containerMode(root, node) {
    let n = node;
    while (n) {
        if (n.mode)
            return n.mode;
        n = PIPE.parentOf(root, n);
    }
    return 'plan';
}

function locationNow(body) {
    const loc = body?.location;
    const tz = loc?.tz;
    const now = new Date();
    const dayOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOpts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    if (tz) {
        dayOpts.timeZone = tz;
        timeOpts.timeZone = tz;
    }
    let day, clock;
    try {
        day = now.toLocaleDateString('ru-RU', dayOpts);
        clock = now.toLocaleTimeString('ru-RU', timeOpts);
    } catch {
        day = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        clock = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
    const parts = [`Сейчас: ${day}, время ${clock}${tz ? ` (${tz})` : ''}.`];
    if (loc?.lat != null && loc?.lon != null) {
        const point = `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`;
        const city = loc.place ? ` (${loc.place})` : '';
        parts.push(`Пользователь сейчас в точке ${point}${city}. Это его город и место, пока он сам не назвал другое.`);
    }
    return parts.join(' ');
}
