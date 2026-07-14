export default {
    label: 'Генерация видео',
    icon: 'carbon:video',
    keywords: `
генерация видео
создание видео
формирование видеоконтента
автоматическая видеогенерация
видеосинтез
генерируемое видео
моделирование видео
интерактивная видеогенерация
ai-создание видео
нейронное создание видео
анимационная генерация
машинное формирование видео
динамическая видеопродукция
технологичная видеосъемка
реалистичное моделирование видео
графическое создание видео
компьютерная визуализация видео
искусственная видеопроизводительность
скриптовая генерация видео
программа генерации видео
рендеринг видеороликов
рандомизированная видеогенерация
постобработка видео
спецэффекты видеофайлов
платформа формирования видео
пользовательская видеогенерация
генератор видео
конструктор роликов
мультипликационный генератор
стримовое производство видео
настройка сценариев видеоряда`,
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'prompt',
                type: 'Text',
                placeholder: 'Опишите видео для генерации',
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
        const input = {
            is_sync: true,
            prompt: params.data?.prompt ?? params.prompt,
            aspect_ratio: '16:9',
        };
        let result = await WORK.genApi.createNetworkTask('ltx-2', input);
        result = await waitForCompletion(result.request_id);
        for (let response of result.full_response) {
            let url = response.url;
            const video = await downloadImage(url);
            let ext = $server.mime.extension(video.contentType);
            params.id = 'video.' + ext;
            params.post = video.buffer;
            await params.work_folder.save_file(params);
        }
        console.log(result);
    },
};