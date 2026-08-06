/**
 * PIPE — конечный автомат (FSM): состояние = блок, переходы = next.
 * Линейный реестр узлов по id (= type блока). Каждый узел несёт свой next.
 * Движок: _step(from) → исполняет узел → маршрутизирует из from.next → self-call.
 *
 * Поля узла: prompt (генерация/инъекция), inject (подсказка меню родителя),
 * next (массив id), build (сборка блока из ответа),
 * fc (массив | '*' | 'readonly'), askType ('form'|'questions').
 * button живёт в build (блок — единственный источник правды для UI и движка).
 * complete — особый узел подъёма: после подтверждения закрывает текущий контейнер.
 * Для блоков с items движок автоматически добавляет complete в меню выбора.
 * Router — узел без prompt/build (только next): маршрутизируется, не исполняется.
 * Лист без next — терминал.
 */
export default {
    /** вход: блок prompt пушится вручную в prompt(); отсюда auto-переход в thinking */
    prompt: {
        next: ['thinking', 'answer'],
    },

    /** размышление над следующим шагом; мерджит инструкцию в последний user-промпт */
    thinking: {
        inject: 'если необходимо обдумать дальнейшие действия',
        prompt: [
            'Как следует подумай, над тем, что необходимо сделать на следующем шаге ',
            'исходя из контекста, и выдай свои размышления от 5 до 100 строк (от своего лица).',
            'Не повторяйся внутри размышлений, не фантазируй, не выдумывай и не пытайся ничего делать'].join(' '),
        next: ['plan', 'research', 'actions'],
        build: (r) => ({
            type: 'thinking',
            content: r.content,
            usage: r.usage,
            icon: 'carbon:idea',
        }),
    },

    plan: {
        inject: 'если необходимо сделать несколько действий подряд, сначала надо согласовать план с пользователем',
        prompt: ['Исходя из твоих размышлений выше, предложи план работ.',
            '\n\n[instruction]\n',
            'В плане должно быть несколько пунктов в один слой;'].join('\n'),
        build: (r) => ({
            type: 'plan',
            content: r.content,
            usage: r.usage,
            button: { label: 'Принять' },
            icon: 'icons:assignment',
        }),
        next: ['task', 'thinking'],
    },

    task: {
        prompt: ['Сделай todo список из согласованного плана.',
            '\n\n[instruction]\n',
            'Первая строка — короткий заголовок задачи (без слова task, без нумерации).',
            'Далее — ТОЛЬКО нумерованный список: каждый пункт с новой строки,',
            '"N. описание" — одно проверяемое действие с конечным результатом.',
            'Без вступления и пояснений.'].join('\n'),
        build: (r) => {
            const lines = r.content.split('\n').map(line => line.trim()).filter(Boolean);
            const numbered = lines.filter(l => /^\d+\.\s*/.test(l));
            const titleLine = lines.find(l => !/^\d+\.\s*/.test(l));
            const src = numbered.length ? numbered : lines;
            const steps = src.map((line, index) => ({
                number: index + 1,
                description: line.replace(/^\d+\.\s*/, ''),
                status: index === 0 ? 'in_progress' : 'pending',
            }));
            return {
                type: 'task',
                label: titleLine || steps[0]?.description || '',
                content: r.content,
                steps,
                items: [],
                usage: r.usage,
                icon: 'icons:list',
            };
        },
        next: ['step'],
    },

    /** шаг плана: заголовок = «N. описание» текущего in_progress, тело = items. */
    step: {
        inject: 'если необходимо выполнить один пункт плана',
        prompt: ['Выполни текущий пункт плана (со статусом in_progress) из последнего task-блока в ленте.',
            'Ровно одно действие. По завершении — подтверди кнопкой «Завершить» (узел complete).'].join('\n'),
        build: (r, ctx) => {
            const s = ctx?.currentStep;
            const title = s ? `${s.number}. ${s.description}` : '';
            return {
                type: 'step',
                content: title,
                icon: 'icons:assignment',
                items: r.content
                    ? [{ type: 'thinking', content: r.content, usage: r.usage, icon: 'carbon:idea' }]
                    : [],
            };
        },
        next: ['thinking'],
    },

    research: {
        inject: 'если тебе что-то непонятно, или неизвестно, и необходимо провести исследование, но только, если уже есть конкретный план.',
        autocomplete: true,
        next: ['work', 'web', 'question', 'form', 'questions'],
        build: () => ({
            type: 'research',
            icon: 'icons:search',
            items: []
        }),
    },

    web: {
        icon: 'icons:language',
        inject: 'если необходимо найти информацию в интернете',
        prompt: ['Найди информацию в интернете ровно ОДНИМ вызовом функции:'].join('\n'),
        fc: ['search', 'fetch_url'],
        build: (r) => r.calls?.length
            ? { type: 'tool', name: r.calls[0].method, args: r.calls[0].args }
            : { type: 'answer', content: r.content },
        next: ['thinking'],
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
        build: (r) => r.calls?.length
            ? { type: 'tool', name: r.calls[0].method, args: r.calls[0].args }
            : { type: 'answer', content: r.content },
        next: ['thinking'],
    },

    answer: {
        inject: 'если точно знаешь ответ на запрос пользователя',
        prompt: ['Ответь пользователю обычным текстом.',
            'Только ответ, коротко и по делу, без лишних пояснений.'].join('\n'),
        build: (r) => ({
            type: 'answer',
            content: r.content,
            usage: r.usage,
            icon: 'icons:question-answer',
            stop: true,
        }),
        
    },

    question: {
        inject: 'если нужно задать один уточняющий вопрос пользователю',
        prompt: ['Задай пользователю один уточняющий вопрос обычным текстом.',
            '\n\n[instruction]\n',
            'Только сам вопрос, коротко, без пояснений.'].join('\n'),
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
        inject: 'если необходимо заполнить форму',
        prompt: ['Собери форму для ввода данных.',
            '\n\n[instruction]\n',
            'Вызови функцию ask_user({questions: [{prompt: "поле"}]}) — вопросы без options станут полями свободного ввода, с options — выбором.'].join('\n'),
        fc: ['ask_user'],
        askType: 'form',
        build: (r) => {
            const call = r.calls?.find(c => c.method === 'ask_user');
            return call
                ? { type: 'form', questions: call.args.questions, button: { label: 'Продолжить' } }
                : null;
        },
        next: ['thinking'],
    },

    questions: {
        icon: 'icons:question-answer',
        inject: 'если необходимы вопросы с вариантами',
        prompt: ['Задай пользователю вопросы с вариантами ответов.',
            '\n\n[instruction]\n',
            'Вызови функцию ask_user({questions: [{prompt: "вопрос", options: ["вариант 1", "вариант 2", "Другое"]}]}). Каждому вопросу 2–5 конкретных вариантов из контекста задачи.'].join('\n'),
        fc: ['ask_user'],
        askType: 'questions',
        build: (r) => {
            const call = r.calls?.find(c => c.method === 'ask_user');
            return call
                ? { type: 'questions', questions: call.args.questions, needAnswers: true, button: { label: 'Ответить' } }
                : null;
        },
        next: ['thinking'],
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
