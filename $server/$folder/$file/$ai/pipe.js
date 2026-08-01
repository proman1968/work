export default {
    step: 'thinking',
    icon: 'carbon:idea',
    prompt: [
        '\n\n[instruction]\n',
        'Как следует подумай, над тем, что необходимо сделать на следующем шаге,',
        'исходя из контекста и последнего промпта, по смыслу, и выдай свои размышления',
        '(от 5 до 100 строк) о том, что необходимо сделать на следующем шаге,',
        'не повторяйся и не пытайся ничего делать'].join(' '),
    inject: ['Исходя из твоих размышлений выбери следующий шаг.',
        '\n\n[instruction]\n',
        'Ответь одним словом без знаков препинания и пояснений:'].join('\n'),
    next: {
        plan: {
            inject: 'если необходимо согласовать план (новый общий план с нуля)',
            prompt: ['Исходя из твоих размышлений выше, предложи план работ.',
                '\n\n[instruction]\n',
                'В плане должно быть несколько пунктов в один слой;'].join('\n'),
            build: (response) => ({
                type: 'plan',
                content: response.content,
                usage: response.usage,
                button: { label: 'Принять' },
                icon: 'icons:assignment',
            }),
            next: {
                task: {
                    icon: 'icons:list',
                    prompt: ['Сделай todo список из согласованного плана.',
                        '\n\n[instruction]\n',
                        'Ответ — ТОЛЬКО нумерованный список: каждый пункт с новой строки,',
                        '"N. описание" — одно проверяемое действие с конечным результатом.',
                        'Без вступления и пояснений.'].join('\n'),
                    build: (response) => {
                        const lines = response.content.split('\n').map(line => line.trim()).filter(Boolean);
                        const steps = lines.map((line, index) => ({
                            number: index + 1,
                            description: line.replace(/^\d+\.\s*/, ''),
                            status: index === 0 ? 'in_progress' : 'pending',
                        }));
                        return {
                            type: 'task',
                            content: response.content,
                            steps,
                            items: [],
                            usage: response.usage,
                            icon: 'icons:list',
                        };
                    },
                    next: {
                        step: {
                            icon: 'av:play-arrow',
                            prompt: ['Делай пункт {n}: «{description}». Ровно одно действие;',
                                'закрыв пункт результатом — complete_step({step: {n}, summary: "что сделано"}).'].join('\n'),
                        },
                    },
                },
            },
        },
        research: {
            icon: 'icons:search',
            inject: 'если необходимо что-то исследовать',
            next: {
                search: {
                    icon: 'icons:search',
                    inject: 'если необходимо искать',
                    next: {
                        web: {
                            icon: 'icons:language',
                            inject: 'если необходимо найти в интернете',
                            prompt: ['Найди информацию в интернете ровно ОДНИМ вызовом функции:',
                                '\n\n[instruction]\n',
                                'search({query: "запрос"}) — поиск;',
                                'fetch_url({url: "https://…"}) — чтение страницы.',
                                'Если фактов уже достаточно — изложи выводы обычным текстом.'].join('\n'),
                            fc: ['search', 'fetch_url'],
                        },
                        file: {
                            icon: 'icons:folder',
                            inject: 'если необходимо найти в рабочей области',
                            prompt: ['Найди информацию в рабочей области ровно ОДНИМ вызовом функции:',
                                '\n\n[instruction]\n',
                                'read_file({name}) — файл;',
                                'get_schema({}) / inspect_schema({path}) — устройство класса;',
                                'find_text({text}) / find_item({id}) — поиск;',
                                'info({}) — состав;',
                                'logs({}) — журнал.',
                                'Если фактов уже достаточно — изложи выводы обычным текстом.'].join('\n'),
                            fc: 'readonly',
                        },
                    },
                },
                ask: {
                    icon: 'icons:help-outline',
                    inject: 'если необходимо уточнить у пользователя',
                    next: {
                        form: {
                            icon: 'icons:view-list',
                            inject: 'если необходимо заполнить форму',
                            prompt: ['Собери форму для ввода данных.',
                                '\n\n[instruction]\n',
                                'Вызови функцию ask_user({questions: [{prompt: "поле"}]}) — вопросы без options станут полями свободного ввода, с options — выбором.'].join('\n'),
                            fc: ['ask_user'],
                            askType: 'form',
                            button: { label: 'Продолжить' },
                        },
                        questions: {
                            icon: 'icons:question-answer',
                            inject: 'если необходимы вопросы с вариантами',
                            prompt: ['Задай пользователю вопросы с вариантами ответов.',
                                '\n\n[instruction]\n',
                                'Вызови функцию ask_user({questions: [{prompt: "вопрос", options: ["вариант 1", "вариант 2", "Другое"]}]}). Каждому вопросу 2–5 конкретных вариантов из контекста задачи.'].join('\n'),
                            fc: ['ask_user'],
                            askType: 'questions',
                            button: { label: 'Ответить' },
                        },
                        text: {
                            icon: 'icons:chat',
                            inject: 'если необходимо задать один вопрос',
                            prompt: ['Задай пользователю один уточняющий вопрос обычным текстом.',
                                '\n\n[instruction]\n',
                                'Только сам вопрос, коротко, без пояснений.'].join('\n'),
                            button: { label: 'Ответить' },
                        },
                    },
                },
            },
        },
        action: {
            icon: 'icons:build',
            inject: 'если необходимо выполнить одно действие',
            prompt: ['Исходя из твоих размышлений выше, выполни ровно ОДНО действие — одним вызовом функции:',
                '\n\n[instruction]\n',
                'файлы — save_file({filename, post}) | read_file({name}) | edit({filename, post});',
                'данные пользователя — ask_user({questions: [{prompt, options}]});',
                'пункт плана закрыт результатом — complete_step({step: N, summary: "что сделано"}).',
                'Если действие не требуется — дай сам результат обычным текстом.'].join('\n'),
            fc: '*',
        },
        report: {
            icon: 'icons:description',
            inject: 'если все пункты закрыты или пора отчитаться',
            prompt: ['Исходя из твоих размышлений выше, сформируй итоговый отчёт.',
                '\n\n[instruction]\n',
                'Что сделано, какие получены результаты и артефакты (только реальные), в формате md. Только факты из ленты, ничего не выдумывай.'].join('\n'),
            button: { label: 'Принять' },
        },
    },
};
