/**
 * TTS (Text-to-Speech) — Silero ONNX (локально).
 *
 * Модель скачивается при первом запуске (~20МБ) в models/silero-tts.onnx.
 * Токенизатор: таблица фонем Silero для русского языка.
 */
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

let sileroSession = null;
const SILERO_MODEL_PATH = path.join(process.cwd(), 'models', 'silero-tts.onnx');

// Таблица фонем Silero (русский)
// Источник: silero/data/dict/ru_dict.txt + символы модели
const SYMBOLS = [
    '_', '^', '$', '—', ' ', 'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З',
    'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П', 'Р', 'С', 'Т', 'У', 'Ф',
    'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я', 'а', 'б',
    'в', 'г', 'д', 'е', 'ж', 'з', 'и', 'й', 'к', 'л', 'м', 'н', 'о',
    'п', 'р', 'с', 'т', 'у', 'ф', 'х', 'ц', 'ч', 'ш', 'щ', 'ъ', 'ы',
    'ь', 'э', 'ю', 'я', 'ё', 'Ё', 'A', 'B', 'C', 'D', 'E', 'F', 'G',
    'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
    'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f', 'g',
    'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
    'u', 'v', 'w', 'x', 'y', 'z', '.', ',', '!', '?', '-', ':', ';',
    '"', "'", '(', ')', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    '0',
];
const SYMBOL_TO_ID = {};
SYMBOLS.forEach((s, i) => { SYMBOL_TO_ID[s] = i; });

/**
 * Токенизация текста для Silero TTS.
 * Преобразует текст в массив ID фонем.
 * @param {string} text — текст для озвучки
 * @returns {number[]} — массив ID токенов
 */
function tokenize(text) {
    const tokens = [];
    // Начальный токен
    tokens.push(SYMBOL_TO_ID['^'] ?? 1);
    for (const ch of text) {
        const id = SYMBOL_TO_ID[ch];
        if (id !== undefined)
            tokens.push(id);
    }
    // Конечный токен
    tokens.push(SYMBOL_TO_ID['$'] ?? 2);
    return tokens;
}

/**
 * Локальный TTS через Silero (ONNX).
 * @param {string} text — текст для озвучки
 * @param {object} options — { sampleRate, speakerId, speed }
 * @returns {Promise<Buffer>} — WAV buffer
 */
export async function sileroTTS(text, options = {}) {
    const sampleRate = options.sampleRate || 48000;
    const speakerId = options.speakerId ?? 0;
    const speed = options.speed ?? 1.0;

    // Загружаем модель при первом вызове
    if (!sileroSession) {
        await downloadSileroModel();
        const ort = await import('onnxruntime-node');
        sileroSession = await ort.InferenceSession.create(SILERO_MODEL_PATH);
        console.log('[tts] Silero модель загружена');
    }

    const ort = await import('onnxruntime-node');
    const tokens = tokenize(text);
    const tokenCount = tokens.length;

    // Входы Silero v3/v4: x, x_lengths, sid(s), speed
    const inputIds = BigInt64Array.from(tokens.map(Number));
    const inputLen = BigInt64Array.from([BigInt(tokenCount)]);
    const speaker = BigInt64Array.from([BigInt(speakerId)]);
    const speedArr = Float32Array.from([speed]);

    const feeds = {
        x: new ort.Tensor('int64', inputIds, [1, tokenCount]),
        x_lengths: new ort.Tensor('int64', inputLen, [1]),
    };
    // Разные версии модели имеют разные имена входов
    if (sileroSession.inputNames.includes('sid'))
        feeds.sid = new ort.Tensor('int64', speaker, [1]);
    if (sileroSession.inputNames.includes('sids'))
        feeds.sids = new ort.Tensor('int64', speaker, [1]);
    if (sileroSession.inputNames.includes('speed'))
        feeds.speed = new ort.Tensor('float32', speedArr, [1]);

    const results = await sileroSession.run(feeds);
    // Имя выхода: 'audio' или 'y'
    const audioKey = results.audio ? 'audio' : (results.y ? 'y' : Object.keys(results)[0]);
    const audio = results[audioKey].data;
    return floatToWav(audio, sampleRate);
}

/**
 * Конвертация Float32Array в WAV buffer.
 */
function floatToWav(float32Array, sampleRate) {
    const buffer = Buffer.alloc(44 + float32Array.length * 2);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + float32Array.length * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);   // PCM
    buffer.writeUInt16LE(1, 22);   // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(float32Array.length * 2, 40);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
    }
    return buffer;
}

/**
 * Скачивание модели Silero TTS.
 */
async function downloadSileroModel() {
    if (fs.existsSync(SILERO_MODEL_PATH))
        return;
    const dir = path.dirname(SILERO_MODEL_PATH);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });

    console.log('[tts] Скачивание Silero TTS модели...');
    const url = 'https://models.silero.ai/voice_recognition/silero_v3_1_ru_latest.onnx';

    return new Promise((resolve, reject) => {
        const download = (downloadUrl) => {
            https.get(downloadUrl, (res) => {
                if (res.statusCode === 302 || res.statusCode === 301) {
                    download(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error('Не удалось скачать Silero: ' + res.statusCode));
                    return;
                }
                const file = fs.createWriteStream(SILERO_MODEL_PATH);
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log('[tts] Silero модель скачана');
                    resolve();
                });
                file.on('error', reject);
            }).on('error', reject);
        };
        download(url);
    });
}

/**
 * Синтез речи — единственный метод.
 * @param {string} text — текст
 * @param {object} options — { sampleRate, speakerId, speed }
 * @returns {Promise<Buffer>} — WAV buffer
 */
export async function synthesize(text, options = {}) {
    return sileroTTS(text, options);
}