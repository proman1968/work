// Скилл: Поиск файлов (deep)
// Путь: skills/system/Поиск файлов/$skill/$class/$skill/data.js
// Surface: $skill/data.js — keywords для роутинга

export default {
    label: 'Поиск файлов',
    icon: 'carbon:search',

    // Метаданные — форма ввода параметров
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [
                { id: 'filename', type: 'String', placeholder: 'Имя файла', required: true },
                { id: 'extension', type: 'String', placeholder: 'Расширение' },
                { id: 'content', type: 'String', placeholder: 'Текст в содержимом' }
            ]
        },
        STATICS: {
            id: 'STATICS',
            icon: 'carbon:tree-view-alt',
            fields: []
        }
    },

    // Логика выполнения — вызывается skill-manager
    async execute(params = {}, context = {}) {
        const data = params.data || {};
        const filename = String(data.filename ?? '').trim();
        const extension = String(data.extension ?? '').trim();
        const content = String(data.content ?? '').trim();

        if (!filename && !extension && !content)
            throw new Error('Укажите хотя бы одно поле для поиска');

        // Строим поисковый запрос
        let prompt = filename;
        if (extension) prompt += (prompt ? ' .' : '.') + extension;
        if (content) prompt += (prompt ? ' ' : '') + content;

        // Встроенный поиск WORK
        const rating = await this.search({ prompt });
        if (!rating.length)
            throw new Error('Ничего не найдено');

        // Форматируем результат
        const lines = rating.slice(0, 20)
            .map(item => `- [${item.ext || '?'}] ${item.path}`);
        const post = `Найдено: ${rating.length}\n\n${lines.join('\n')}`;

        // Сохраняем в текущий storage (caller чата)
        await this.save_file({
            filename: 'response.md',
            post,
            encoding: 'utf-8'
        });

        return { found: rating.length, path: 'response.md' };
    }
};