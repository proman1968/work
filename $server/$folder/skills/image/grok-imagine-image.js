export default {
    token: 'sk-Nn5m5WE5oTrANRjRdrRwYvk2dJr8Hi2RHJ9Hwp6fyCKXI45EBW7qYfej3cx5',
    url: 'https://api.gen-api.ru/api/v1/networks/grok-imagine-image',      
    metadata:{
        aspect_ratio: {
            value: '16:9',
            items: ['2:1', '20:9', '19.5:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:19.5', '1:2']
        },
        output_format: {
            value: "jpeg",
            items: ['jpeg', 'png', 'webp']
        },
        num_images: {
            value: 1,
            items: [1,2,3,4]
        },        
        prompt: {
            placeholder: 'Опишите изображение, которое хотите получить',
            is: 'oda-textarea'
        }
    },
    async execute(params = {}){
        let {$item, data} = params;
        
        
        // await $item.save_includes({urls: ["https://www.wiz.ai/content/uploads/2025/09/Blog-images-scaled.jpg"]});
        
        
        
        let options = {
            body:  JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.token,
            },
            method: 'POST'
        }
        let result = await WORK.request(this.url, options);
        let url = 'https://api.gen-api.ru/api/v1/request/get/' + result.request_id;

        options.method = 'GET';
        delete options.body;
        result = await WORK.awaitRequestResult(url, options);
        await $item.save_includes({urls: result.result});
    },
    keywords: `
        Генерация изображений рисунков картинок иллюстраций
        Создание картинок
        Рисование по запросу
        Генерируй изображение
        Создай картинку
        Нарисуй по описанию
        Изобрази визуально
        Сгенерируй иллюстрацию
        Сделай визуализацию
        Отрисовка сцены    
        Генерация изображений`
}

