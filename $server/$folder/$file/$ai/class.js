export default {
    icon: 'bootstrap:robot',
    TYPES: {
        /**
         * Канон: U (блок + servicePrompt) → M (thinking) → S → ровно один канал.
         * План: action «План» → confirm «Начать» → TYPE.task.
         * Do: каждый шаг = prompt в task.ribbon (+ этот servicePrompt) → снова U→M→S.
         */
        prompt: {
            servicePrompt: [
                'Канон хода: 1) <reasoning>; 2) ровно ОДИН канал.',
                'Классификация:',
                '• вопрос/справка → reasoning + text;',
                '• задача «сделай X» и нет active task → reasoning + <plan> ≥3–4 шагов proposed (платформа → action «План» + tip «Начать»); без tools и без spawn_agent до «Начать»;',
                '• one-shot без плана (простой ответ/одно действие) → reasoning + text|tool;',
                '• уточнения до плана → questions|form|text (стоп если невыполнимо);',
                '• prompt шага Do («Выполни шаг N») → reasoning, затем один канал: tool (если шаг закрывается сразу) ИЛИ questions|form|<subplan> (если нужна декомпозиция/уточнение); без нового общего <plan>; без prose text рядом с каналом.',
                'Запрещено: закончить только reasoning; смешивать каналы; spawn_agent вместо плана.',
            ].join(' '),
            fields: [
                { id: 'type', type: 'string' },
                { id: 'content', type: 'string' },
                { id: 'time', type: 'number' },
                { id: 'sender', type: 'string' },
                {
                    id: 'usage',
                    fields: [
                        { id: 'prompt', type: 'number' },
                        { id: 'completion', type: 'number' },
                        { id: 'total', type: 'number' },
                        { id: 'contextPct', type: 'number' },
                        { id: 'contextWindow', type: 'number' },
                    ],
                },
            ],
        },
        thinking: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'Мышление уже в ленте. Не повторяй тот же reasoning.',
                'Выдай ровно ОДИН канал:',
                '• ответ → text;',
                '• план → <plan>[…] (платформа → action «План» + «Начать»);',
                '• опрос → <questions>/ask_user (select+options ≥2);',
                '• поля → <form>;',
                '• стоп → text;',
                '• шаг Do: tool сразу ИЛИ questions/form/subplan если шаг иначе не закрыть.',
                'Не заканчивай ход; не «уточните» prose без questions/form.',
            ].join(' '),
        },
        text: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'Канал text уже показан.',
                'Жди новый prompt. Не дублируй текст. Не tools и не новый <plan> без нового prompt.',
            ].join(' '),
        },
        /** Tip: План/Начать | Отчёт/Принять | Выполнить */
        action: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'Кнопка «{button}» (title «{title}») ждёт пользователя — tip над промптом.',
                'Не вызывай tools и не дублируй кнопку до нового prompt.',
                'После «Начать» система создаст TYPE.task и пришлёт prompt шага — отвечай на него.',
                'После «Принять» — задача закрыта; не начинай новый план сам.',
                'После иного confirm — reasoning → один канал шага.',
            ].join(' '),
            fields: [
                { id: 'title', type: 'string', options: ['План', 'Отчёт', 'Действие'] },
                { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
            ],
        },
        form: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'Форма в ленте; tip «{button}» ждёт answers.',
                'Не дублируй поля. Не tools до prompt с answers.',
                'После answers система даст следующий step-prompt — отвечай на него.',
            ].join(' '),
            fields: [
                { id: 'title', type: 'string' },
                { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
                {
                    id: 'fields',
                    type: 'array',
                    fields: [
                        { id: 'id', type: 'string' },
                        { id: 'label', type: 'string' },
                        { id: 'type', options: ['text', 'textarea', 'select', 'checkbox', 'number', 'email', 'date'] },
                        { id: 'options', type: 'array' },
                        { id: 'value' },
                    ],
                },
            ],
        },
        questions: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'Опрос в ленте; tip «{button}» ждёт выбор.',
                'Не дублируй вопросы. Не tools до answers.',
                'После answers — следующий step-prompt от системы.',
            ].join(' '),
            fields: [
                { id: 'title', type: 'string' },
                { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
                {
                    id: 'fields',
                    type: 'array',
                    fields: [
                        { id: 'id', type: 'string' },
                        { id: 'label', type: 'string' },
                        { id: 'type', options: ['text', 'textarea', 'select', 'checkbox', 'number', 'email', 'date'] },
                        { id: 'options', type: 'array' },
                        { id: 'value' },
                    ],
                },
                { id: 'step', type: 'number' },
            ],
        },
        step: {
            fields: [
                { id: 'step', type: 'number' },
                { id: 'description', type: 'string' },
                { id: 'status', options: ['proposed', 'in_progress', 'done'] },
            ],
        },
        task: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'TYPE.task active: шаги выполняет harness через prompt «Выполни шаг N» в task.ribbon.',
                'Отвечай на последний step-prompt: one-shot tool или уточнение/subplan.',
                'Не предлагай новый общий <plan>. done ставит система. completed — только после «Принять».',
            ].join(' '),
            fields: [
                { id: 'label', type: 'string' },
                { id: 'state', options: ['active', 'completed', 'cancelled'] },
                { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
                {
                    id: 'steps',
                    type: 'array',
                    fields: [
                        { id: 'step', type: 'number' },
                        { id: 'description', type: 'string' },
                        { id: 'status', options: ['proposed', 'in_progress', 'done'] },
                    ],
                },
                { id: 'ribbon', type: 'TYPES.ribbon' },
            ],
        },
        file: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'Вложение {path} ({name}) в контексте. Учти файл; при необходимости read_file.',
                'Дальше: reasoning → один канал (правка того же имени или следующий шаг).',
            ].join(' '),
            fields: [
                { id: 'path', type: 'string' },
                { id: 'name', type: 'string' },
            ],
        },
        tool: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'Вызов tool отправлен. Дождись tool_result. Не повторяй тот же вызов без результата.',
            ].join(' '),
            fields: [
                { id: 'name', type: 'string' },
                { id: 'args' },
            ],
        },
        tool_result: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'Результат tool (ok={ok}, tool={tool}).',
                'Если ok: жди следующий step-prompt или Отчёт от системы.',
                'Если ошибка: reasoning → исправленный tool или questions/form.',
                'Не объявляй completed — это делает «Принять».',
            ].join(' '),
            fields: [
                { id: 'tool', type: 'string' },
                { id: 'ok', type: 'boolean' },
            ],
        },
        error: {
            extends: 'TYPES.prompt',
            servicePrompt: [
                'Ошибка в истории. reasoning → другой канал: исправленный tool, questions/form или text.',
                'Не повторяй тот же failing вызов без изменений.',
            ].join(' '),
            fields: [
                { id: 'code', type: 'string' },
            ],
        },
        ribbon: {
            type: 'array',
        },
    },
    FIELDS: [
        { id: 'title', type: 'string' },
        { id: 'created', type: 'number' },
        { id: 'model', type: 'string' },
        { id: 'system', type: 'string' },
        { id: 'ribbon', type: 'TYPES.ribbon' },
        {
            id: 'usage',
            fields: [
                { id: 'prompt', type: 'number' },
                { id: 'completion', type: 'number' },
                { id: 'total', type: 'number' },
                { id: 'contextPct', type: 'number' },
                { id: 'contextWindow', type: 'number' },
            ],
        },
    ],
};
