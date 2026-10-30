/**
 * Мета-инструменты агента: план (todo), вопрос человеку, субагенты, навыки, картинки.
 * ctx.env — окружение сессии: { agents, skills, makeTools(def, depth), makeSystem(def), place, config, llmFor(model) }.
 */
import { genId, stringifyFrontmatter, clip, callSnapshots, snapshotName } from '../util.js';
import { absPath, callAs, getItem, writeBinary } from './work.js';
import { ENGINE_AI } from '../resources.js';
import { untrustedNames } from '../taint.js';

const TODO_STATUS = ['pending', 'in_progress', 'completed'];
export const MAX_DEPTH = 2;

/** F31 (final 8.24): потолок дочерних задач на зону роли (env WORK_AGENT_START_MAX). */
const MAX_CHILD_TASKS = Number(process.env.WORK_AGENT_START_MAX) || 20;

/** Сколько ДОЧЕРНИХ .task (с полем parentTask и вне статуса stopped, вне history/) уже лежит в зоне роли — прежде чем заводить ещё одного (R13). */
async function countChildTasks(point, role) {
    try {
        const zone = await point.work_zone({ role });
        const dir = zone?.dir;
        if (!dir)
            return 0;
        const fs = await import('node:fs');
        let n = 0;
        const walk = d => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                if (e.name === 'history' || e.name === '.index')
                    continue;
                if (e.isDirectory())
                    walk(d + '/' + e.name);
                else if (/\.task$/i.test(e.name)) {
                    try {
                        const raw = fs.readFileSync(d + '/' + e.name, 'utf-8');
                        if (!raw.includes('"parentTask"'))
                            continue;
                        const parsed = JSON.parse(raw);
                        if (parsed?.parentTask && parsed?.status !== 'stopped')
                            n++;
                    }
                    catch { /* пропуск битого файла */ }
                }
            }
        };
        walk(dir);
        return n;
    }
    catch {
        return 0; /* зона недоступна — путь agent_start сам откажет ниже */
    }
}

/** Снимки, созданные записями этой задачи (включая вложенные ленты субагентов). */
function collectSnapshots(items, out = []) {
    for (const it of items || []) {
        if (it?.type !== 'assistant') {
            out.push(...collectSnapshots(it?.items, []));
            continue;
        }
        for (const t of it.tools || []) {
            // любой инструмент со снимком — файл создан в WORK
            if (t?.status === 'ok' && t?.snapshot)
                out.push({ snapshot: t.snapshot, path: t.path || null, title: t.path ? String(t.path).split('/').pop() : null });
            // вложения, сохранённые через call → save_files (результат — JSON с includes)
            for (const snapshot of callSnapshots(t))
                out.push({ snapshot, path: null, title: snapshotName(snapshot) });
            if (Array.isArray(t?.items))
                collectSnapshots(t.items, out);
        }
    }
    return out;
}

function formatResults(results) {
    const list = Array.isArray(results) ? results : [];
    if (!list.length)
        return 'результаты не отмечены';
    return list.map((r, i) => (i + 1) + '. ' + (r.title || r.snapshot) + '\n   ' + r.snapshot).join('\n');
}

/** Продолжимый ребёнок доступен только из своей родительской задачи под тем же пользователем. */
async function ownedChild(path, ctx) {
    if (!ctx.task?.path || !ctx.session?.uid)
        throw new Error('продолжимый агент доступен только из задачи пользователя');
    const child = await getItem(path, ctx);
    if (!child || Array.isArray(child) || !String(child.path).endsWith('.task'))
        throw new Error('дочерняя задача не найдена: ' + path);
    await callAs(child, 'assertAccess', {}, ctx, ctx.role);
    const core = await import('../session.js');
    const body = await core.getBody(child);
    if (body.parentTask !== ctx.task.path || body.ownerUid !== ctx.session.uid || (ctx.role && core.taskRole(child) !== ctx.role))
        throw new Error('задача не принадлежит этому агенту и роли');
    return { child, body, core };
}

export const metaTools = [
    {
        name: 'todo_write',
        planSafe: true,
        description: 'План работы (чек-лист), видимый человеку. Для задач из 3+ шагов: заведи план, держи ровно один пункт in_progress, отмечай completed сразу по факту. Передавай список целиком.',
        parameters: {
            type: 'object',
            properties: {
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: 'Что сделать (повелительно)' },
                            status: { type: 'string', enum: TODO_STATUS },
                        },
                        required: ['content', 'status'],
                    },
                },
            },
            required: ['todos'],
        },
        async run(args, ctx) {
            const todos = (Array.isArray(args.todos) ? args.todos : [])
                .filter(t => t && t.content)
                .map(t => ({ content: String(t.content), status: TODO_STATUS.includes(t.status) ? t.status : 'pending' }));
            ctx.host.setTodos?.(todos);
            await ctx.host.save();
            const done = todos.filter(t => t.status === 'completed').length;
            return 'план обновлён: ' + done + '/' + todos.length + ' выполнено';
        },
    },
    {
        name: 'ask_user',
        planSafe: true,
        description: 'Спросить человека, когда без его решения дальше нельзя (выбор варианта, недостающие данные, подтверждение смысла). Можно дать варианты options или поля формы fields. Не спрашивай то, что можно выяснить инструментами.',
        parameters: {
            type: 'object',
            properties: {
                question: { type: 'string', description: 'Вопрос' },
                options: { type: 'array', items: { type: 'string' }, description: 'Варианты ответа (кнопки)' },
                multiple: { type: 'boolean', description: 'Можно выбрать несколько вариантов' },
                fields: {
                    type: 'array',
                    description: 'Поля формы для ввода данных',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            label: { type: 'string' },
                            type: { type: 'string', enum: ['text', 'textarea', 'number', 'date', 'select', 'checkbox'] },
                            options: { type: 'array', items: { type: 'string' } },
                            required: { type: 'boolean' },
                            value: {},
                        },
                        required: ['id', 'label'],
                    },
                },
            },
            required: ['question'],
        },
        async run(args, ctx) {
            const { host, entry, turn } = ctx;
            if (typeof host.wait !== 'function')
                return 'Человек недоступен (автономный запуск). Прими разумное решение сам и явно укажи допущение в ответе.';
            entry.status = 'waiting';
            await host.save();
            const res = await host.wait({ kind: 'question', item: turn.id, call: entry.id, question: args.question }) || {};
            entry.status = 'running';
            if (res.values && typeof res.values === 'object') {
                entry.values = res.values;
                return 'Ответ (форма):\n' + Object.entries(res.values).map(([k, v]) => '- ' + k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join('\n')
                    + (res.content ? '\nКомментарий: ' + res.content : '');
            }
            const answer = String(res.content ?? res.answer ?? '').trim();
            entry.answer = answer;
            return answer ? 'Ответ человека: ' + answer : 'Человек не ответил по существу.';
        },
    },
    {
        name: 'task',
        concurrent: true,
        planSafe: true,
        permission: () => ({ verdict: 'allow' }),
        description: 'Поручить подзадачу субагенту (свой контекст, свой набор инструментов). Для широкого исследования, параллельных независимых подзадач, объёмного чтения. Результат — его итоговый отчёт. Пиши поручение самодостаточно: субагент не видит этот разговор. Субагент работает в той же роли задачи и не получает инструментов сверх твоего набора: работу, для которой тебе не хватает инструментов, ему не поручай — объясни ограничение пользователю.',
        parameters: {
            type: 'object',
            properties: {
                agent: { type: 'string', description: 'Имя субагента из списка «Субагенты»' },
                description: { type: 'string', description: 'Коротко (3–6 слов), что делает' },
                prompt: { type: 'string', description: 'Полное поручение: цель, контекст, что вернуть' },
            },
            required: ['prompt'],
        },
        async run(args, ctx) {
            const env = ctx.env;
            const depth = (ctx.depth || 0) + 1;
            if (depth > MAX_DEPTH)
                throw new Error('слишком глубокая вложенность субагентов');
            const name = String(args.agent || 'general');
            const def = env.agents.get(name);
            if (!def)
                throw new Error('нет субагента «' + name + '». Есть: ' + [...env.agents.keys()].join(', '));
            const entry = ctx.entry;
            entry.agent = name;
            entry.items = [{ id: genId(), type: 'user', time: Date.now(), content: String(args.prompt) }];
            await ctx.host.save();
            // 9.2: дешёвая модель для субагентов (ai/config.js subagentModel) — если у агента нет своей
            const subModel = def.meta.model || env.config?.subagentModel;
            const llm = subModel ? await env.llmFor(subModel) : ctx.llm;
            const res = await ctx.runLoop({
                llm,
                system: () => env.makeSystemParts(def),
                items: entry.items,
                tools: await env.makeTools(def, depth, ctx.tools),
                host: ctx.host,
                depth,
                taintedFrom: ctx.tainted || [],
                hooks: ctx.hooks, // правила организации действуют и на субагента: иначе их обходило бы делегирование
                // субагент работает в той же роли задачи (и тех же правах), что и основной агент
                ctx: { session: ctx.session, place: ctx.place, env, role: ctx.role, task: ctx.task, tz: ctx.tz },
                maxTurns: Number(def.meta.maxTurns) || 40,
            });
            if (res.status === 'stopped')
                return { error: 'остановлено' };
            const last = [...entry.items].reverse().find(i => i.type === 'assistant' && i.content);
            const text = res.content || last?.content || '';
            if (!text)
                return { error: 'субагент не вернул отчёт (' + res.status + ')' };
            return text;
        },
    },
    {
        name: 'agent_start',
        risk: 'write',
        outbound: true, // новый автономный агент получает инструкции: после внешнего содержимого — только с подтверждением (taint.js)
        description: 'Запустить продолжимого субагента в отдельной .task: сразу вернуть путь. Он переживает перезапуск и принимает agent_message. Роль и права — те же, что у родителя; для короткого разового поручения используй task.',
        parameters: { type: 'object', properties: {
            agent: { type: 'string', description: 'Имя агента из списка «Субагенты»' },
            prompt: { type: 'string', description: 'Самодостаточное поручение' },
            description: { type: 'string', description: 'Название задачи для человека' },
        }, required: ['agent', 'prompt'] },
        async run(args, ctx) {
            if (!ctx.task?.path || !ctx.session?.uid || !ctx.role)
                throw new Error('agent_start: нужна задача в зоне выбранной роли пользователя');
            const depth = (ctx.depth || 0) + 1;
            if (depth > MAX_DEPTH)
                throw new Error('превышена глубина делегирования');
            const def = ctx.env.agents.get(String(args.agent));
            if (!def)
                throw new Error('нет субагента «' + args.agent + '»');
            const preview = await ctx.env.makeTools(def, depth, ctx.tools);
            if (!preview.length)
                throw new Error('субагенту в этой роли недоступны инструменты');
            // R3 (8.31): ограничение call родителя переживает перезапуск дочерней задачи —
            // в теле (body.callRestrict); применяется при каждом запуске (session.js → makeTools)
            const pcall = preview.find(t => t.name === 'call' && t.restrictedMethods);
            const point = ctx.env.place;
            if (!point || typeof point.save_file !== 'function')
                throw new Error('нет рабочей точки для дочерней задачи');
            // F31: дочерняя задача не мягче родителя — наследует его режим (ask/plan);
            // у auto родителя остаётся auto (человек уже разрешил свободный режим)
            const parentMode = ['ask', 'plan'].includes(String(ctx.host?.mode || '')) ? ctx.host.mode : 'auto';
            // F31: потолок дочерних задач в зоне роли (живое чтение — настроить можно без рестарта)
            const max = Number(process.env.WORK_AGENT_START_MAX) || MAX_CHILD_TASKS;
            const existing = await countChildTasks(point, ctx.role);
            if (existing >= max)
                throw new Error('agent_start: в зоне роли уже ' + existing + ' дочерних задач (потолок ' + max
                    + ') — останови ненужные (agent_stop) или используй разовых субагентов (task)');
            const name = String(args.description || args.agent).slice(0, 80);
            const body = { name, title: name, created: Date.now(), items: [], version: 2, status: 'idle', mode: parentMode,
                parentTask: ctx.task.path, ownerUid: ctx.session.uid, childAgent: def.name, childDepth: depth,
                model: def.meta.model || ctx.llm.name, role: ctx.role,
                ...(pcall ? { callRestrict: [...pcall.restrictedMethods] } : {}) };
            // skip_file_handler: не запускать триггер одновременно с явным prompt ниже.
            const log = await callAs(point, 'save_file', {
                filename: name.replace(/[<>:"/\\|?*\r\n]/g, ' ').trim() + '.task',
                post: JSON.stringify(body), skip_file_handler: true,
            }, ctx, ctx.role);
            const path = log?.logFullPath || log?.path;
            if (!path)
                throw new Error('сохранение дочерней задачи не вернуло путь');
            const child = await getItem(path, ctx);
            if (!child || Array.isArray(child))
                throw new Error('дочерняя задача создана, но пока не найдена: ' + path);
            const core = await import('../session.js');
            await core.prompt(child, { session: ctx.session, prompt: String(args.prompt) });
            ctx.entry.path = path;
            return 'Продолжимый агент ' + def.name + ' запущен: ' + path + '. Следить: agent_status; уточнить: agent_message; остановить: agent_stop.';
        },
    },
    {
        name: 'agent_status', readonly: true,
        description: 'Статус и последний ответ своего продолжимого субагента по пути из agent_start.',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        async run(args, ctx) {
            const { child, body, core } = await ownedChild(args.path, ctx);
            // ответ дочернего агента мог быть составлен из внешнего содержимого — тот же режим, что у чужого текста
            if (ctx.entry && untrustedNames(body.items).size)
                ctx.entry.untrusted = true;
            const last = [...body.items].reverse().find(i => i.type === 'assistant' && i.content);
            return { path: child.path, status: core.isRunning(child) ? 'running' : body.status,
                waiting: body.waiting || null, last: last?.content || '', updated: body.updated };
        },
    },
    {
        name: 'agent_message', risk: 'write', outbound: true,
        description: 'Отправить сообщение своему продолжимому субагенту. Во время работы оно ставится в очередь; ожидание вопроса не подменяется ответом родителя.',
        parameters: { type: 'object', properties: { path: { type: 'string' }, prompt: { type: 'string' } }, required: ['path', 'prompt'] },
        async run(args, ctx) {
            const { child, core } = await ownedChild(args.path, ctx);
            const res = await core.message(child, { session: ctx.session, prompt: String(args.prompt) });
            return res.queued ? 'сообщение поставлено в очередь ' + child.path : 'сообщение передано ' + child.path;
        },
    },
    {
        name: 'agent_stop', risk: 'danger',
        description: 'Остановить своего продолжимого субагента; его собственная задача и история останутся доступны.',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        async run(args, ctx) {
            const { child, core } = await ownedChild(args.path, ctx);
            await core.stop(child, { session: ctx.session });
            return 'субагент остановлен: ' + child.path;
        },
    },
    {
        name: 'publish',
        risk: 'write',
        description: 'Отметить файл-результат задачи для общей ленты. В чате останется только карточка задачи с выбранным, промежуточные версии не шумят. Передай snapshot из результата write/append/edit/sandbox_export или из includes результата call → save_files (путь .../history/...), несколько файлов — несколько вызовов. Убрать: action remove. Посмотреть набор: action list.',
        parameters: {
            type: 'object',
            properties: {
                snapshot: { type: 'string', description: 'WORK-путь снимка из результата записи' },
                title: { type: 'string', description: 'Название для ленты (по умолчанию — имя файла)' },
                action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'По умолчанию add' },
            },
        },
        async run(args, ctx) {
            if (!ctx?.task?.path)
                throw new Error('publish — только внутри задачи');
            const core = await import('../session.js');
            const action = args?.action || 'add';
            if (action === 'list')
                return formatResults(await core.getBody(ctx.task).then(b => b.results || []));
            const snapshot = String(args?.snapshot || '').trim();
            if (!snapshot)
                throw new Error('publish: нужен snapshot из результата write/append/edit/sandbox_export или includes результата call → save_files');
            if (action === 'remove')
                return formatResults(await core.addTaskResult(ctx.task, { snapshot, remove: true }, ctx.session));
            const known = collectSnapshots((await core.getBody(ctx.task)).items);
            const hit = known.find(s => s.snapshot === snapshot)
                || [...known].reverse().find(s => s.path && s.path === snapshot);
            if (!hit)
                throw new Error('publish: снимок не из этой задачи — передай snapshot из результата записи (write/append/edit/sandbox_export) или includes результата call → save_files, а не живой путь файла');
            const effectiveSnapshot = hit.snapshot;
            const item = await getItem(effectiveSnapshot, ctx).catch(() => null);
            if (!item || Array.isArray(item))
                throw new Error('publish: снимок не найден: ' + effectiveSnapshot);
            const results = await core.addTaskResult(ctx.task,
                { snapshot: effectiveSnapshot, title: args?.title || hit.title }, ctx.session);
            return 'опубликовано (' + results.length + '):\n' + formatResults(results);
        },
    },
    {
        name: 'skill',
        readonly: true,
        description: 'Загрузить навык (проверенный рецепт) по имени из списка «Навыки» и следовать ему.',
        parameters: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Имя навыка' } },
            required: ['name'],
        },
        async run(args, ctx) {
            const s = ctx.env.skills.get(String(args.name));
            if (!s)
                throw new Error('нет навыка «' + args.name + '». Есть: ' + ([...ctx.env.skills.keys()].join(', ') || '—'));
            ctx.entry.path = s.path;
            return '# Навык ' + s.name + '\n' + (s.meta.description ? s.meta.description + '\n\n' : '') + s.body;
        },
    },
    {
        name: 'save_skill',
        risk: 'write',
        outbound: true, // новый навык = закрепление инструкций в системе (taint.js)
        target: args => args?.scope === 'global' ? ENGINE_AI + '/skills/' + args?.name + '.md' : null,
        description: 'Сохранить удачно выполненную работу как навык — рецепт для повторения: когда применять, шаги (какие инструменты, пути, контракты), проверки результата, подводные камни. Сохраняй, когда человек просит «запомни/зафиксируй как навык» или подтверждает предложение.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Имя навыка: латиница, цифры, дефис (например register-accounts)' },
                description: { type: 'string', description: 'Когда применять — одной фразой (по ней навык выбирают)' },
                content: { type: 'string', description: 'Тело навыка в markdown: шаги, пути, проверки' },
                scope: { type: 'string', enum: ['place', 'global'], description: 'place — для этого класса и ниже (по умолчанию), global — для всей системы' },
            },
            required: ['name', 'description', 'content'],
        },
        async run(args, ctx) {
            const name = String(args.name).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
            if (!name)
                throw new Error('имя навыка: латиница/цифры/дефис');
            const post = stringifyFrontmatter({ name, description: args.description, created: new Date().toLocalDay() }, args.content);
            let folder, where;
            if (args.scope === 'global') {
                folder = await getItem(ENGINE_AI, ctx);
                where = ENGINE_AI + '/skills/' + name + '.md';
            }
            else {
                const place = ctx.env.place;
                folder = place?.meta_folder;
                if (!folder)
                    throw new Error('у места задачи нет метапапки');
                where = folder.path + '/ai/skills/' + name + '.md';
            }
            const params = { folder: args.scope === 'global' ? 'skills' : 'ai/skills', filename: name + '.md', post };
            if (ctx?.task?.path)
                params.mainContext = ctx.task.path;
            await callAs(folder, 'save_file', params, ctx);
            ctx.entry.path = where;
            ctx.env.skills.set(name, { name, meta: { name, description: args.description }, body: String(args.content), path: where, scope: args.scope || 'place' });
            return 'навык сохранён: ' + where;
        },
    },
    {
        name: 'generate_image',
        risk: 'write',
        target: args => absPath(args?.path, null),
        description: 'Сгенерировать изображение по описанию и сохранить в файл (png).',
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'Подробное описание сцены (лучше на английском)' },
                path: { type: 'string', description: 'WORK-путь файла, например /USERS/…/work/картинка.png' },
            },
            required: ['prompt', 'path'],
        },
        async run(args, ctx) {
            const model = await ctx.env.imageModel();
            if (!model)
                throw new Error('нет модели с capabilities image в /MODELS (или imageModel в ai/config.js)');
            const pic = await model.generateImage({ prompt: args.prompt });
            const path = /\.(png|jpe?g|webp)$/i.test(args.path) ? args.path : args.path + '.png';
            const real = await writeBinary(path, Buffer.from(pic.base64, 'base64'), ctx);
            ctx.entry.path = real;
            ctx.entry.image = true;
            return 'изображение сохранено: ' + real + ' (' + (pic.model || model.short) + ')';
        },
    },
    {
        name: 'panel',
        readonly: true,
        description: 'Панель наблюдаемости (только админ): задачи в работе и ожидающие человека, стоимость агентов за день и месяц (по пользователям), последние записи журнала безопасности, песочницы.',
        parameters: {
            type: 'object',
            properties: {},
        },
        async run(args, ctx) {
            const { isAdmin } = await import('../system.js');
            if (!(await isAdmin(ctx?.session)))
                throw new Error('панель наблюдаемости — только администратору WORK (задачи и траты всех)');
            const p = await globalThis.WORK.agent_panel({}); // права проверены выше (isAdmin); вызов системный
            const { money } = await import('../cost.js');
            const out = ['Панель агентов (' + p.time.replace('T', ' ').slice(0, 16) + ')'];
            if (p.tasks?.running || p.tasks?.waiting) {
                out.push('Задачи: ' + (p.tasks.running?.length || 0) + ' в работе, ' + (p.tasks.waiting?.length || 0) + ' ждут человека');
                for (const t of (p.tasks.running || []).slice(0, 10))
                    out.push('- [работает] ' + t);
                for (const t of (p.tasks.waiting || []).slice(0, 10))
                    out.push('- [ждёт человека] ' + t);
                const more = (p.tasks.running?.length || 0) + (p.tasks.waiting?.length || 0) - 20;
                if (more > 0)
                    out.push('… ещё ' + more);
            }
            else
                out.push('Задачи: незаконченных нет');
            if (p.cost?.day) {
                const c = p.cost;
                out.push('Стоимость: сегодня ' + c.day.tokens.toLocaleString('ru-RU') + ' токенов, ' + (c.day.cost ? money(c.day.cost) : 'без тарифов')
                    + '; месяц ' + c.month.tokens.toLocaleString('ru-RU') + ' токенов, ' + (c.month.cost ? money(c.month.cost) : 'без тарифов'));
                if (c.byUserDay?.length)
                    out.push('По пользователям (сегодня): ' + c.byUserDay.slice(0, 10).map(u => u.uid + ' ' + u.tokens.toLocaleString('ru-RU') + ' ток.' + (u.cost ? ' ' + money(u.cost) : '')).join(', '));
            }
            if (p.audit?.last) {
                const counts = Object.entries(p.audit.counts || {}).map(([k, v]) => k + ' ' + v).join(', ');
                out.push('Журнал безопасности (сегодня, последние): '
                    + (p.audit.last.map(r => r.event + (r.tool ? '/' + r.tool : '') + ' → ' + (r.verdict || '') + (r.outcome ? ' ' + r.outcome : '')).slice(0, 5).join('; ') || 'записей нет'));
                if (counts)
                    out.push('События сегодня: ' + counts);
            }
            if (p.sandbox?.computers)
                out.push('Песочницы: ' + p.sandbox.computers.length + ' (' + p.sandbox.computers.filter(c => c.state === 'running').length + ' запущено)'
                    + (p.sandbox.computers.length ? ': ' + p.sandbox.computers.slice(0, 10).map(c => (c.owner || '?') + '/' + (c.name || '?') + ' ' + c.state).join(', ') : ''));
            else if (p.sandbox?.unavailable)
                out.push('Песочницы: Docker недоступен (' + p.sandbox.unavailable + ')');
            return out.join('\n');
        },
    },
    {
        name: 'budget',
        readonly: true,
        description: 'Стоимость и бюджет: потрачено в этой задаче (ходы, токены, деньги по тарифам моделей), дневной лимит пользователя и трата сегодня, оценка следующего хода. all:true (админу) — траты всех пользователей за сегодня.',
        parameters: {
            type: 'object',
            properties: { all: { type: 'boolean', description: 'Только админу: траты всех пользователей за сегодня' } },
        },
        async run(args, ctx) {
            const { usageTotals, money } = await import('../cost.js');
            const { isAdmin } = await import('../system.js');
            // сумма по ленте задачи (включая вложенные ленты субагентов)
            const walk = (items, acc) => {
                for (const it of items || []) {
                    if (it?.type !== 'assistant')
                        continue;
                    if (it.usage) {
                        acc.turns++;
                        acc.prompt += Number(it.usage.prompt) || 0;
                        acc.completion += Number(it.usage.completion) || 0;
                        acc.cached += Number(it.usage.cached) || 0;
                        acc.cost += Number(it.usage.cost ?? 0) || 0;
                        acc.priced = acc.priced || it.usage.cost != null;
                    }
                    for (const t of it.tools || [])
                        walk(t?.items, acc);
                }
                return acc;
            };
            const out = [];
            const body = ctx?.task && typeof ctx.task.getBody === 'function' ? await ctx.task.getBody().catch(() => null) : null;
            const t = body ? walk(body.items, { turns: 0, prompt: 0, completion: 0, cached: 0, cost: 0, priced: false }) : null;
            if (t?.turns)
                out.push('Задача: ' + t.turns + ' ход(ов), ' + (t.prompt + t.completion + t.cached).toLocaleString('ru-RU') + ' токенов'
                    + (t.priced ? ', ' + money(t.cost) + ' (по тарифам моделей)' : ' (тарифы моделей не заданы — pricing в карточке MODELS)'));
            else
                out.push('Задача: расходов ещё нет (списание — после каждого хода с ответом модели)');
            // дневной лимит пользователя
            const limits = ctx?.env?.config?.limits || {};
            const uid = ctx?.session?.uid || 'anonymous';
            const spent = await usageTotals({ uid });
            if (limits.dayTokens || limits.dayCost)
                out.push('Дневной лимит: ' + (limits.dayTokens ? limits.dayTokens.toLocaleString('ru-RU') + ' токенов' : '')
                    + (limits.dayTokens && limits.dayCost ? ' / ' : '') + (limits.dayCost ? '$' + limits.dayCost : '')
                    + ' — потрачено сегодня: ' + spent.tokens.toLocaleString('ru-RU') + ' токенов, ' + (spent.cost ? money(spent.cost) : 'без тарифов'));
            else
                out.push('Дневной лимит: не задан (ai/config.js limits: { dayTokens, dayCost }); потрачено сегодня: '
                    + spent.tokens.toLocaleString('ru-RU') + ' токенов' + (spent.cost ? ', ' + money(spent.cost) : ''));
            if (args?.all) {
                if (!(await isAdmin(ctx?.session)))
                    throw new Error('траты всех пользователей видит только администратор WORK');
                const every = await usageTotals({});
                out.push('Все пользователи сегодня: ' + every.rows + ' ход(ов), ' + every.tokens.toLocaleString('ru-RU') + ' токенов, ' + (every.cost ? money(every.cost) : 'без тарифов'));
            }
            // оценка следующего хода: средний расход хода этой задачи
            if (t?.turns)
                out.push('Оценка следующего хода: ~' + Math.round((t.prompt + t.completion + t.cached) / t.turns).toLocaleString('ru-RU') + ' токенов'
                    + (t.priced ? ', ~' + money(t.cost / t.turns) : ''));
            return out.join('\n');
        },
    },
];

/** Короткий листинг для system: имя — описание. */
export function listing(map, max = 60) {
    // сначала сортируем по имени, затем берём первые max: детерминированный набор и порядок независимо от обхода ФС
    return [...map.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, max).map(d => '- ' + d.name + ': ' + clip(String(d.meta.description || d.body.split('\n')[0] || ''), 400)).join('\n');
}
