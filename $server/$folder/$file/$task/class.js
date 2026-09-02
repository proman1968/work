export default {
    icon: 'bootstrap:robot',
    contentType: 'application/json',
    GET: 'context',
    async prompt(params = {}) {
        
        // debugger;
        let { prompt, role, session } = params;
        session?.send?.({ type: 'chat.start', path: this.short });
        await this._init(params);
    
        try {
            switch (role) {
                case 'AI':{
                } break;
                case 'APPROVE':{
                    if (params.accept === true || params.accept === 'true') {
                        await params.pipe_step.approve?.(params);
                        params.block.state = 'принято';                      
                    } else {
                        params.block.state = 'отклонено';
                    }
                    
                    delete params.block.stop;
                    delete params.box.using_blocks;
                    await this._save(session);
                    this._stopped = false;
                } break;
                default:{
                    const text = String(prompt ?? '').trim();
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
                }
            }

            await this._init(params);
            await this.pipe[params.box.type]?.recalc?.(params);

            // лист без тела — только достримить; меню нельзя
            const live = params.block;
            if (live && live !== params.box && !live.box && !hasBody(live)) {
                this._stopped = false;
                await this._fillLeaf(params, session);
                await this._save(session);
                if (this._canLoop(params.block)) {
                    this.async(() => this.prompt({ role: 'AI', session }));
                    return { ok: true };
                }
            }
            else {
            let mode = this.body.mode || 'plan';

            let node = this.pipe[params.block.type];
            let next = node?.[mode]?.next || node?.next;
            if(!next || node.box){
                node = this.pipe[params.box.type];
                next = node?.[mode]?.next || node?.next;
            }
                

            let using_blocks = params.box.using_blocks ??= [];
            next = next.filter(id => !using_blocks.includes(id));  

            let choice;
            if (!next.length) {
                choice = 'total';
            }
            else if (next.length === 1) {
                choice = next[0];
            }
            else {
                const lines = next.map(id => id.toUpperCase() + ' - ' + (this.pipe[id]?.[mode]?.inject || this.pipe[id]?.inject) + ';');
                let menu = [
                    'Выбери в menu пункт, который быстрее всего закрывает запрос пользователя. Выбирай не по порядку, а по смыслу.',
                    'Пункты-остановки (вопрос, форма) — только если без ответа человека продолжить объективно нельзя.',
                    'Если разумный default или план действий уже есть в контексте — не спрашивай, действуй.',
                    'Ответь одним словом строго из списка, без знаков и пояснений.',
                    '\n\n[menu]\n',
                    ...lines,
                ].join('\n');
                let messages = await this.context({session, prompt: menu});
                let response = await this._streamChat({ messages, silent: true, session });
                // пустой content: thinking если ещё в оставшихся, иначе первый из оставшихся (не «первый в pipe»)
                choice = menuPick(response.content, next)
                    || (next.includes('thinking') ? 'thinking' : next[0]);
            }
            if (choice) {
                let next_pipe = this.pipe[choice];
            
                params.block = this._build_block(choice);
                const boxBefore = params.box;
                const pushed = await this._push_block(params);
                if (pushed) {
                    if (!params.block.box && !hasBody(params.block))
                        await this._fillLeaf(params, session);
                    if (hasBody(params.block))
                        await this.pipe[params.block.type]?.recalc?.(params);

                    const kind = this.pipe[params.block.type];
                    const src = String(params.block.content || '').trim();
                    // генерённый заголовок нужен только докам (имя в доке отчётов); в ленте хватает статичного ярлыка типа
                    if (params.block.doc && params.block.stop !== true && !this._stopped && src && kind?.label && params.block.label === kind.label) {
                        const cap = await this._streamChat({
                            messages: [{ role: 'user', content: src + '\n\n[instruction]\n Сделай заголовок для этого блока. 2-3 слова. Без знаков и пояснений.' }],
                            silent: true,
                            session,
                        });
                        const words = String(cap.content || '').trim().replace(/^["«']+|["»'.]+$/g, '').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
                        if (words)
                            params.block.label = words;
                    }
                    
                }
                await this._save(session);
                // silent close (total init false): смотреть закрытый box, не ghost-лист — иначе chat.done и нет answer на task
                if (this._canLoop(pushed ? params.block : boxBefore)) {
                    this.async(() => this.prompt({ role: 'AI', session }));
                    return { ok: true };
                }
            }
            }

        }
        catch (e) {
            params.box ??= await this.body;
            params.block = { type: 'error', content: e.message };
            await this._push_block(params);
        }

        session?.send?.({ type: 'chat.done', path: this.short });
        return { ok: true };
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
    async context(params = {}) {
        const { prompt, evidence = true, leaf } = params;
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
        const layers = chain.map(b => this._box_context(b, b === focus, evidence));
        const mode = body.mode || 'plan';
        const pipe = await this.pipe;
        const leafNode = leaf?.type ? pipe[leaf.type] : null;
        const leafSystem = leafNode?.[mode]?.system || leafNode?.system || '';
        const messages = [{ role: 'system', content: [
            ...layers.map(l => l.system).filter(Boolean),
            timeNow(body.tz),
            topicsMap(pipe, focus, mode),
            leafSystem,
        ].filter(Boolean).join('\n\n') }];
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
        if (focus !== body)
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
    _box_context(box, focus = true, evidence = true) {
        const node = this.pipe[box.type];
        const mode = this.body.mode || 'plan';
        let system = node?.[mode]?.system || node?.system || box.system || '';
        if (box.todo)
            system += '\n\n[todo]\n' + (box.todo.content || '');
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
            const file = files.find(f => f.id === 'pipe.js');
            const raw = await file.load();
            const script = this.constructor.stripAbsoluteImports(raw);
            const b64 = Buffer.from(script, 'utf-8').toString('base64');
            this._pipe = await import('data:text/javascript;base64,' + b64);
            return this._pipe;
        });
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
        if (!this.pipe[block.type]?.ignore) {
            const used = box.using_blocks ??= [];
            if (!used.includes(block.type))
                used.push(block.type);
        }
        const init = this.pipe[block.type]?.init;
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
    async _save(session){
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

/** Карта узлов из pipe, без хардкода имён: inject / label текущего mode. */
function topics(pipe, ids, mode) {
    return (ids || []).map(id => {
        const n = pipe[id];
        const inj = n?.[mode]?.inject || n?.inject || n?.label || '';
        return inj ? id + ' — ' + inj : id;
    }).join('\n');
}

/** next текущего фокуса минус using_blocks — что реально можно выбрать сейчас. */
function topicsMap(pipe, focus, mode) {
    const node = pipe[focus?.type];
    const used = focus?.using_blocks || [];
    const ids = (node?.[mode]?.next || node?.next || []).filter(id => !used.includes(id));
    const text = topics(pipe, ids, mode);
    return text ? '[доступные инструменты]\n' + text : '';
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
