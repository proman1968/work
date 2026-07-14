import fs from 'fs';
import path from 'path';
import https from 'https';

const DATASET_DIR = './dataset';
const TARGET_FILE = path.join(DATASET_DIR, 'text_corpus.txt');

// Стабильный альтернативный источник (Русская хранилищика, ~1.5 МБ чистого текста для старта)
const DATASET_URL = 'https://lib.ru';

async function downloadCorpus() {
    if (!fs.existsSync(DATASET_DIR)) {
        fs.mkdirSync(DATASET_DIR, { recursive: true });
    }

    if (fs.existsSync(TARGET_FILE)) {
        console.log(`[Downloader] Файл text_corpus.txt уже существует. Скачивание не требуется.`);
        return;
    }

    console.log(`[Downloader] Начало загрузки текстового корпуса для 22B модели...`);
    console.log(`[Downloader] Источник: ${DATASET_URL}`);
    
    const startTime = Date.now();
    const fileStream = fs.createWriteStream(TARGET_FILE);

    https.get(DATASET_URL, (response) => {
        if (response.statusCode !== 200) {
            console.error(`\n [Error] Ошибка сервера: Статус ${response.statusCode}`);
            fileStream.close();
            fs.unlinkSync(TARGET_FILE);
            return;
        }

        response.pipe(fileStream);

        fileStream.on('finish', () => {
            fileStream.close();
            const stats = fs.statSync(TARGET_FILE);
            const fileSizeMb = (stats.size / (1024 * 1024)).toFixed(2);
            const elapsed = (Date.now() - startTime) / 1000;

            console.log(`\n====================================================`);
            console.log(` ✗ ЗАГРУЗКА ЗАВЕРШЕНА УСПЕШНО!`);
            console.log(`====================================================`);
            console.log(` Сохранено в:   ${TARGET_FILE}`);
            console.log(` Размер файла:  ${fileSizeMb} МБ`);
            console.log(` Время загрузки: ${elapsed.toFixed(2)} сек`);
            console.log(`====================================================\n`);
        });
    }).on('error', (error) => {
        fileStream.close();
        if (fs.existsSync(TARGET_FILE)) fs.unlinkSync(TARGET_FILE);
        console.error(`\n [Error] Ошибка сети через https модуль:`, error.message);
        console.log(`Вы можете вручную переименовать любой .txt файл на ПК в "text_corpus.txt" и положить в папку dataset\\`);
    });
}

downloadCorpus();
