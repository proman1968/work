export default {
    label: 'Уточнение задачи',
    icon: 'iconoir:help-circle',
    keywords: `
уточнение задачи
уточни запрос
выбери skill
какой skill
несколько вариантов
неоднозначный запрос
что именно нужно
уточняющий вопрос
выбор skill
кандидаты
clarify
choice
disambiguation`,
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:help-circle',
            fields: [{
                id: 'prompt',
                type: 'String',
                placeholder: 'Уточните запрос или выберите skill из списка',
            }],
        },
        STATICS: {
            id: 'STATICS',
            icon: 'carbon:tree-view-alt',
            fields: [],
        },
    },
    async execute(params = {}) {
        const prompt = String(params.data?.prompt ?? params.prompt ?? '').trim();
        const lines = [
            'Нужно уточнение: выберите подходящий skill в списке выше и нажмите OK.',
            prompt ? `\nКомментарий: ${prompt}` : '',
        ].filter(Boolean);
        await this.save_file({
            filename: 'response.md',
            post: lines.join('\n'),
            encoding: 'utf-8',
        });
    },
};