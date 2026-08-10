/**
 * PIPE — конечный автомат (FSM): состояние = блок, переходы = next.
 * Линейный реестр узлов по id (= type блока). Каждый узел несёт свой next.
 * Движок: _step(from) → исполняет узел → маршрутизирует из from.next → self-call.
 *
 * Поля узла: role (для context; default assistant), prompt, inject, next (массив — LLM-меню),
 * yes/no (вилка по vote; строка = обычный маршрут,
 *   { convert: id } = hide источника + push build(id) без LLM),
 * build, fc.
 * button живёт в build (блок — единственный источник правды для UI и движка).
 * complete — особый узел подъёма: после подтверждения закрывает текущий контейнер.
 * Для блоков с items движок автоматически добавляет complete в меню выбора.
 * Router — узел без prompt/build (только next): маршрутизируется, не исполняется.
 * Лист без next — терминал.
 */
export default {
    /** вход: блок prompt пушится вручную в prompt(); отсюда auto-переход в thought */
    prompt: {
        role: 'user',
        next: ['plan'],
    },

    /** размышление над следующим шагом; мерджит инструкцию в последний user-промпт */
    thought: {
        icon: 'carbon:idea',
        inject: 'если необходимо обдумать дальнейшие действия',
        prompt: [
            'Как следует подумай, над тем, что необходимо сделать на следующем шаге ',
            'исходя из контекста, и выдай свои размышления от 5 до 100 строк (от своего лица).',
            'Не повторяйся внутри размышлений, не фантазируй, не выдумывай и не пытайся ничего делать сам.',
            'Не обращайся к пользвателю, т.к. это твои размышления, только для тебя.',
            ].join(' '),
        next: ['answer', 'plan'],
    },
    text: {
        icon: 'icons:text',
        prompt: 'Просто ответь пользователю, не выполняя никаких действий.',
        stop: true,
    },

    plan: {
        icon: 'icons:assignment',
        inject: 'если необходимо сделать несколько действий подряд, сначала надо согласовать план с пользователем',
        prompt: ['Исходя из размышлений выше, предложи план работ по запросу пользователя.',
            '\n\n[instruction]\n',
            'Первая строка — короткий заголовок будущей задачи (без нумерации, без слова task).',
            'Далее — нумерованный список пунктов в один слой. Без вступления и пояснений.',
        ].join('\n'),
        button: { label: 'Принять' },
        convert: (block) => {
            const text = block.content || '';
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            const numbered = lines.filter(l => /^\d+\.\s+\S/.test(l));
            const bullets = lines.filter(l => /^[-*•]\s+\S/.test(l));
            const titleLine = lines.find(l => !/^\d+\.\s*/.test(l) && !/^[-*•]\s/.test(l));
            const src = numbered.length ? numbered : bullets;
            block.type = 'task';
            block.label = (titleLine || '').replace(/\*\*/g, '').trim()
                || src[0]?.replace(/^\d+\.\s*/, '').replace(/^[-*•]\s+/, '').trim()
                || '';
            block.steps = src
                .map(line => line
                    .replace(/^\d+\.\s*/, '')
                    .replace(/^[-*•]\s+/, '')
                    .replace(/\*\*/g, '')
                    .trim())
                .filter(Boolean)
                .map((description, i) => ({
                    number: i + 1,
                    description,
                    status: i === 0 ? 'in_progress' : 'pending',
                }));
            block.items = [];
            block.icon = 'icons:list';
            delete block.button; // план принят — кнопка больше не нужна
            return block;
        },
        next: ['thought'],
    },

    // /** Согласованный plan: без LLM, build из ctx.from (блок plan). */
    // task: {
    //     build: (r, ctx) => {
    //         const text = ctx?.from?.content || r.content || '';
    //         const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    //         const numbered = lines.filter(l => /^\d+\.\s+\S/.test(l));
    //         const bullets = lines.filter(l => /^[-*•]\s+\S/.test(l));
    //         const titleLine = lines.find(l => !/^\d+\.\s*/.test(l) && !/^[-*•]\s/.test(l));
    //         const src = numbered.length ? numbered : bullets;
    //         const steps = src
    //             .map(line => line
    //                 .replace(/^\d+\.\s*/, '')
    //                 .replace(/^[-*•]\s+/, '')
    //                 .replace(/\*\*/g, '')
    //                 .trim())
    //             .filter(Boolean)
    //             .map((description, index) => ({
    //                 number: index + 1,
    //                 description,
    //                 status: index === 0 ? 'in_progress' : 'pending',
    //             }));
    //         const label = (titleLine || '').replace(/\*\*/g, '').trim()
    //             || steps[0]?.description || '';
    //         return {
    //             type: 'task',
    //             label,
    //             content: text,
    //             steps,
    //             items: [],
    //             icon: 'icons:list',
    //         };
    //     },
    //     next: ['step'],
    // },

    /** шаг плана: заголовок = «N. описание» текущего in_progress, тело = items. */
    step: {
        role: 'user',
        inject: 'если необходимо выполнить один пункт плана',
        prompt: ['Выполни текущий пункт плана (со статусом in_progress) из последнего task-блока в ленте.',
            'Ровно одно действие. По завершении — подтверди кнопкой «Завершить» (узел complete).'].join('\n'),
        build: (r, ctx) => {
            const s = ctx?.currentStep;
            const title = s ? `${s.number}. ${s.description}` : '';
            return {
                type: 'step',
                content: title,
                icon: 'icons:chevron-right',
                items: r.content
                    ? [{ type: 'thought', content: r.content, usage: r.usage, icon: 'carbon:idea' }]
                    : [],
            };
        },
        next: ['thought'],
    },

    research: {
        icon: 'icons:search',
        inject: 'если тебе что-то непонятно, или неизвестно, и необходимо провести исследование, но только, если уже есть конкретный план.',
        autocomplete: true,
        next: ['work', 'web', 'question', 'form'],
    },

    web: {
        icon: 'icons:language',
        inject: 'если необходимо найти информацию в интернете',
        prompt: ['Найди информацию в интернете ровно ОДНИМ вызовом функции:'].join('\n'),
        fc: ['search', 'fetch_url'],
        build: (r) => r.calls?.length
            ? { type: 'tool', name: r.calls[0].method, args: r.calls[0].args }
            : { type: 'answer', content: r.content },
        next: ['thought'],
    },

    work: {
        icon: 'icons:folder',
        inject: 'если необходимо найти файлы или информацию в рабочей области',
        prompt: ['Найди информацию в рабочей области ровно ОДНИМ вызовом функции:',
            '\n\n[instruction]\n',
            'read_file({name}) — файл;',
            'get_schema({}) / inspect_schema({path}) — устройство класса;',
            'find_text({text}) / find_item({id}) — поиск;',
            'info({}) — состав;',
            'logs({}) — журнал.',
            'Если фактов уже достаточно — изложи выводы обычным текстом.'].join('\n'),
        fc: 'readonly',
        build: (r) => ({
            type: 'work',
            content: r.content,
            usage: r.usage,
            icon: 'icons:folder',
        }),
        next: ['thought'],
    },

    answer: {
        icon: 'icons:question-answer',
        inject: 'если точно знаешь ответ на запрос пользователя',
        prompt: ['Ответь пользователю обычным текстом.',
            'Только ответ, коротко и по делу, без лишних пояснений.'].join('\n'),
        stop: true,
    },

    question: {
        inject: 'если нужно выяснить у пользователя, что не так с предложением или планом, или задать один уточняющий вопрос',
        prompt: ['Задай пользователю один уточняющий вопрос обычным текстом.',
            '\n\n[instruction]\n',
            'Если пользователь отклонил план — спроси, что не устроило или что изменить.',
            'Не предлагай новый план в этом ходе. Только сам вопрос, коротко, без пояснений.'].join('\n'),
        build: (r) => ({
            type: 'question',
            content: r.content,
            usage: r.usage,
            icon: 'lineawesome:question-circle',
            stop: true,
        }),
    },

    form: {
        icon: 'icons:view-list',
        inject: 'если необходимо запросить у пользователя данные формой (поля ввода и/или выбор из вариантов)',
        prompt: ['Собери форму для ввода данных.',
            '\n\n[instruction]\n',
            'Вызови функцию ask_user({questions: [{prompt: "поле"|"вопрос", options?: ["вариант 1", "вариант 2"]}]}).',
            'Без options — свободный ввод; с options — выбор.',
            'Первой строкой обычного текста (до вызова) можно дать краткое пояснение к форме.'].join('\n'),
        fc: ['ask_user'],
        build: (r) => {
            const call = r.calls?.find(c => c.method === 'ask_user');
            if (!call) return null;
            const fields = (call.args.questions || []).map((q, i) => {
                const id = q.id || `f${i + 1}`;
                const label = q.prompt || q.label || id;
                const field = { id, type: 'String', label, placeholder: label };
                if (q.options?.length) field.options = q.options;
                return field;
            });
            const block = {
                type: 'form',
                fields,
                button: { label: 'Продолжить' },
                icon: 'icons:view-list',
            };
            if (r.content?.trim()) block.content = r.content.trim();
            return block;
        },
        next: ['thought'],
    },

    actions: {
        inject: 'если необходимо выполнить одно или несколько действий, над системой или в интернете',
        prompt: 'Как следует подумай, что ты собираешься сделать',
        autocomplete: true,
        build: (r) => ({
            type: 'action',
            content: r.content,
            usage: r.usage,
            icon: 'icons:build',
            items: []
        }),
    },

    report: {
        icon: 'icons:description',
        inject: 'если все пункты закрыты или пора отчитаться',
        prompt: ['Исходя из твоих размышлений выше, сформируй итоговый отчёт.',
            '\n\n[instruction]\n',
            'Что сделано, какие получены результаты и артефакты (только реальные), в формате md. Только факты из ленты, ничего не выдумывай.'].join('\n'),
        build: (r) => ({
            type: 'report',
            content: r.content,
            usage: r.usage,
            button: { label: 'Принять' },
            icon: 'icons:description',
        }),
    },

    complete: {
        inject: 'если считаешь, что текущая задача завершена',
        prompt: ['Сформируй краткий итог по текущей ветке.',
            '\n\n[instruction]\n',
            'Что было сделано в рамках текущей задачи, какой получен результат. Кратко, по фактам из ленты, в формате md.'].join('\n'),
        build: (r) => ({
            type: 'complete',
            content: r.content,
            usage: r.usage,
            button: { label: 'Завершить' },
        }),
    },
};
