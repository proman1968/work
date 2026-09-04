/** Агент planning: план работ → todo после APPROVE. Лист, не в меню step. */
export default {
    label: 'План',
    icon: 'icons:assignment',
    model: '/MODELS/BIS-Ollama/gemma3 4b',
    doc: true,
    description: 'несколько ещё не сделанных действий',
    step: false,
    system: [
        '# Режим: план',
        'Несколько ещё не сделанных действий — краткое название и нумерованный список.',
        'Не для приветствий и не вместо ответа по уже известным фактам.',
    ].join('\n'),
    prompt: `
Предложи план:
[instruction]
Краткое название плана работ.
Пронумерованый список пунктов плана работ.
`,
    stop: 'Принять план',
    async approve(params = {}) {
        const { box, block, task } = params;
        block.type = 'plan';
        const parse = task.pipe.parsePlanMarkdown;
        const plan = typeof parse === 'function'
            ? parse(block.content)
            : { label: '', steps: [] };
        const stepLabel = task.pipe.step?.label || 'Шаг';
        box.todo = {
            type: 'todo',
            icon: 'icons:list',
            ...plan,
        };
        const n = (box.todo.steps || []).length;
        box.todo.state = n ? `0/${n} ${stepLabel}` : '';
    },
};
