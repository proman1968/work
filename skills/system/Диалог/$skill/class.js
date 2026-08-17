export default {
    label: 'Диалог',
    icon: 'carbon:chat',
    keywords: `
диалог
общение
разговор
ответь
объясни
расскажи
помоги
что такое
как работает
уточни
продолжи диалог
свободный диалог
вопрос
ответ
беседа
чат с ассистентом
assistant chat
general conversation`,
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'carbon:chat',
            fields: [{
                id: 'prompt',
                type: 'Text',
                placeholder: 'Введите вопрос',
            }],
        },
    },
};