export default{
    metadata:{
        prompt:{
            placeholder: 'Ваедите запрос'
        },
        email:{
            type: 'email'
        }
    },
    async execute(param = {}){
        let {$item, data} = param;

        alert("ОПА!!!")


        
    },
    keywords:`Отправить файл
Переслать файл
Отправить по почте
Скинуть на email
Выслать документ
Прикрепить файл
Послать письмо с вложением
Отправить вложение
Email с файлом`
}