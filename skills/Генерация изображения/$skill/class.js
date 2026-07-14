export default {
    label: 'Генерация изображения',
    icon: 'carbon:image',
    keywords: `
        генерация изображения
        нарисуй
        создай картинку
        generate image
        create image
        image generation
        картинка
        изображение
        рисунок`,
    services: ['Grok Imagine Image'],
    selectedService: 'Grok Imagine Image',
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'prompt',
                type: 'Text',
                placeholder: 'Опишите изображение для генерации',
                required: true,
            }],
        },
        STATICS: {
            id: 'STATICS',
            icon: 'carbon:tree-view-alt',
            fields: [],
        },
    },
    async execute(params = {}, context = {}) {
        const prompt = String(params.data?.prompt ?? params.prompt ?? '').trim();
        if (!prompt)
            throw new Error('Опишите изображение для генерации');
        // TODO: вызов внешнего сервиса генерации изображений
        throw new Error('Генерация изображений пока не поддерживается (services)');
    },
};