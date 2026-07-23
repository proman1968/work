function normalizeServicePath(path) {
    if (!path)
        return '';
    return path.startsWith('/') ? path : '/' + path;
}

async function runServiceExecute(servicePath, ctx, data) {
    const item = await WORK.get_item(normalizeServicePath(servicePath));
    if (!item?.import)
        throw new Error('service не найден: ' + servicePath);
    const script = await item.import();
    const api = script?.API;
    if (!api?.execute)
        throw new Error('service не поддерживает API.execute');
    await api.execute.call(api, {
        data,
        save_file: ctx.save_file.bind(ctx),
        storage: ctx,
    });
}

export default {
    label: 'Генерация изображений',
    icon: 'carbon:image',
    services: [
        '/SERVICES/AI/GenApi/images/Grok%20Imagine%20Image',
        '/SERVICES/AI/GenApi/images/Qwen%20Image%202',
    ],
    keywords: `
генерация изображений
рисунков
картинок
иллюстраций
создание картинок
рисование по запросу
генерируй изображение
создай картинку
нарисуй по описанию
изобрази визуально
сгенерируй иллюстрацию
сделай визуализацию
отрисовка сцены
генерация изображений`,
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'prompt',
                type: 'Text',
                placeholder: 'Опишите изображение',
                required: true,
            }],
        },
        STATICS: {
            id: 'STATICS',
            icon: 'carbon:tree-view-alt',
            fields: [],
        },
    },
    async execute(params = {}) {
        const data = { ...(params.data ?? {}) };
        const prompt = String(data.prompt ?? params.prompt ?? '').trim();
        if (!prompt)
            throw new Error('Опишите изображение');
        data.prompt = prompt;
        const services = this.services || [];
        const servicePath = data.service || services[0];
        if (!servicePath)
            throw new Error('Не выбран service генерации');
        await runServiceExecute(servicePath, this, data);
    },
};