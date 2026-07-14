/**
 * Серверный метод tts для модели $ai — синтез речи
 * Возвращает аудио (WAV) через HTTP response
 */
export default {
    async execute(params = {}, post) {
        const options = typeof post === 'string' ? JSON.parse(post) : (post || params);
        const text = options.text || params.text || '';
        if (!text)
            throw new Error('Текст пуст');

        const engine = options.engine || params.engine || 'gigachat';
        const voice = options.voice || params.voice || 'profi';
        const modelPath = options.modelPath || params.modelPath;

        // Получаем объект модели через WORK.get_item (this — handler, не имеет token/authUrl)
        let ai = params.$ai;
        if (!ai?.authUrl && modelPath && options.engine !== 'qwen3')
            ai = await WORK.get_item(modelPath);
        if (!ai?.authUrl && options.engine !== 'qwen3')
            throw new Error('Модель не найдена: ' + (modelPath || '?'));

        // Динамический import через pathToFileURL — обходит ограничение data: URL
        const { pathToFileURL } = await import('node:url');
        const nodePath = await import('node:path');
        const ttsModule = await import(pathToFileURL(nodePath.join(process.cwd(), 'sources/modules/tts/tts.js')).href);
        const audioBuffer = await ttsModule.synthesize(text, ai, { engine, voice });
        return audioBuffer;
    },
};
