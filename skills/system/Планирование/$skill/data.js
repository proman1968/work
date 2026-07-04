function extractJsonObject(text) {
    const raw = String(text ?? '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start)
        throw new Error('План: модель не вернула JSON');
    return JSON.parse(raw.slice(start, end + 1));
}

function formatPlanMarkdown(prompt, steps) {
    const lines = [`## План задачи`, '', `**Запрос:** ${prompt}`, '', '### Шаги'];
    steps.forEach((step, index) => {
        lines.push(`${index + 1}. **${step.title || 'Шаг ' + (index + 1)}** — ${step.prompt || ''}`);
    });
    lines.push('', '_Первый шаг будет добавлен в микрочат автоматически._');
    return lines.join('\n');
}

export default {
    keywords: `
планирование
спланируй
план задачи
план действий
несколько шагов
составная задача
комплексная задача
сначала потом
этапы
разбей на шаги
пошаговый план
оркестрация задач
pipeline
multi-step plan`,
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'carbon:tree-view-alt',
            fields: [{
                id: 'prompt',
                type: 'Text',
                placeholder: 'Опишите составную задачу',
            }],
        },
    },
    async execute(params = {}) {
        const prompt = String(params.data?.prompt ?? params.prompt ?? '').trim();
        if (!prompt)
            throw new Error('Опишите составную задачу');
        const LLM = params.LLM;
        if (!LLM?.generate)
            throw new Error('LLM недоступен для планирования');

        const messages = [{
            role: 'system',
            content: [
                'Ты планировщик задач в системе WORK.',
                'Разбей запрос пользователя на 2–5 последовательных шагов.',
                'Каждый шаг — отдельная атомарная задача для skill-router.',
                'Ответь только JSON без markdown:',
                '{"steps":[{"title":"краткое название","prompt":"текст шага"}]}',
            ].join(' '),
        }, {
            role: 'user',
            content: prompt,
        }];
        const raw = await LLM.generate({ messages });
        const parsed = extractJsonObject(raw);
        const steps = (parsed?.steps || []).map((step, index) => ({
            title: String(step?.title || `Шаг ${index + 1}`).trim(),
            prompt: String(step?.prompt || '').trim(),
        })).filter(step => step.prompt);
        if (!steps.length)
            throw new Error('План не содержит шагов');

        await this.save_file({
            filename: 'response.md',
            post: formatPlanMarkdown(prompt, steps),
            encoding: 'utf-8',
        });
        return { steps, prompt };
    },
};
