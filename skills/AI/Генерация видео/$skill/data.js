export default {
  metadata:{

  },
    async execute(params = {}){
        const input = {
            is_sync: true,
            prompt: params.prompt,
            aspect_ratio: '16:9'

        };
        let result = await WORK.genApi.createNetworkTask('ltx-2', input);
        result = await waitForCompletion(result.request_id);
        for(let response of result.full_response){
            let url = response.url;
            const video = await downloadImage(url);
            let ext = $server.mime.extension(video.contentType);
            params.id = 'video.' + ext;
            params.post = video.buffer;
            await params.work_folder.save_file(params);
        }
        console.log(result)
    }, 
    keywords: `Генерация видео
Создание видео
Формирование видеоконтента
Автоматическая видеогенерация
Видеосинтез
Генерируемое видео
Моделирование видео
Интерактивная видеогенерация
AI-создание видео
Нейронное создание видео
Анимационная генерация
Машинное формирование видео
Динамическая видеопродукция
Технологичная видеосъемка
Реалистичное моделирование видео
Графическое создание видео
Компьютерная визуализация видео
Искусственная видеопроизводительность
Скриптовая генерация видео
Программа генерации видео
Рендеринг видеороликов
Рандомизированная видеогенерация
Постобработка видео
Спецэффекты видеофайлов
Платформа формирования видео
Пользовательская видеогенерация
Генератор видео
Конструктор роликов
Мультипликационный генератор
Стримовое производство видео
Настройка сценариев видеоряда`,
}