/**
 * Мета-инструменты агента: план (todo), вопрос человеку, субагенты, навыки, картинки.
 * ctx.env — окружение сессии: { agents, skills, makeTools(def, depth), makeSystem(def), place, config, llmFor(model) }.
 */
import { genId, stringifyFrontmatter, clip } from '../util.js';
import { absPath, callAs, getItem, writeBinary } from './work.js';
import { ENGINE_AI } from '../resources.js';

const TODO_STATUS = ['pending', 'in_progress', 'completed'];
export const MAX_DEPTH = 2;

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
        description: 'Поручить подзадачу субагенту (свой контекст, свой набор инструментов). Для широкого исследования, параллельных независимых подзадач, объёмного чтения. Результат — его итоговый отчёт. Пиши поручение самодостаточно: субагент не видит этот разговор.',
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
            const llm = def.meta.model ? await env.llmFor(def.meta.model) : ctx.llm;
            const res = await ctx.runLoop({
                llm,
                system: () => env.makeSystem(def),
                items: entry.items,
                tools: await env.makeTools(def, depth),
                host: ctx.host,
                depth,
                ctx: { session: ctx.session, place: ctx.place, env },
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
            const post = stringifyFrontmatter({ name, description: args.description, created: new Date().toISOString().slice(0, 10) }, args.content);
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
];

/** Короткий листинг для system: имя — описание. */
export function listing(map, max = 60) {
    return [...map.values()].slice(0, max).map(d => '- ' + d.name + ': ' + clip(String(d.meta.description || d.body.split('\n')[0] || ''), 300)).join('\n');
}
