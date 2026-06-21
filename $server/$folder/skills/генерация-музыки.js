export default {
    token: 'sk-Nn5m5WE5oTrANRjRdrRwYvk2dJr8Hi2RHJ9Hwp6fyCKXI45EBW7qYfej3cx5',
    url: 'https://api.gen-api.ru/api/v1/networks/suno',
    metadata:{
        model: {
            value: 'v5',
            items: ['v3.5', 'v4', 'v4.5', 'v5']
        },
        title: {
            placeholder: "Название..."
        },
        tags: {
            placeholder: 'Стиль...',
            is: 'oda-textarea'
        },        
        prompt: {
            placeholder: 'Слова...',
            is: 'oda-textarea'
        }
    },  
      async execute(params = {}){
        let {skill, data} = params;
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
        await skill.save_includes({urls: result.result});
  },
  keywords: `Сделай музыку 
Генерация музыки  
Создание музыкальных композиций  
Автономная музыкальная композиция  
Музыкальное творчество ИИ  
Автоматизация музыкального творчества  
AI-композиция  
Композиция мелодий искусственным интеллектом  
Нейро-музыкальные произведения  
Генератор мелодии  
`,
}
  

