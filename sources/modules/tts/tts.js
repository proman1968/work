/**
 * Серверный модуль TTS (Text-to-Speech)
 * Два движка: GigaChat API и Silero ONNX (локально)
 */
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ===== GigaChat TTS =====

/**
 * Синтез речи через GigaChat API
 * @param {string} text - Текст для озвучки
 * @param {object} ai - Объект модели (с authUrl, token, scope)
 * @param {object} options - { voice: 'profi' | 'comfortable', format: 'wav' | 'opus' }
 * @returns {Promise<Buffer>} - Аудио данные
 */
export async function gigachatTTS(text, ai, options = {}) {
    const voice = options.voice || 'profi'; // profi — женский, comfortable — мужской
    const format = options.format || 'wav';

    // Получаем токен (переиспользуем из streamChat)
    if (!ai.accessToken || ai.accessToken.expires_at <= Date.now())
        ai.accessToken = await gigachatAuth(ai);

    const body = JSON.stringify({
        model: 'GigaChat-2:tts',
        input: text,
        voice,
        format,
    });

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'gigachat.devices.sberbank.ru',
            port: 443,
            path: '/api/v1/tts',
            method: 'POST',
            agent: new https.Agent({ rejectUnauthorized: false }),
            headers: {
                'Content-Type': 'application/json',
                'Accept': format === 'opus' ? 'audio/ogg' : 'audio/wav',
                'Authorization': 'Bearer ' + ai.accessToken.access_token,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error('GigaChat TTS error ' + res.statusCode + ': ' + buffer.toString('utf-8').slice(0, 500)));
                    return;
                }
                resolve(buffer);
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function gigachatAuth(ai) {
    const url = new URL(ai.authUrl);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: url.hostname,
            port: url.port || 9443,
            path: url.pathname,
            method: 'POST',
            agent: new https.Agent({ rejectUnauthorized: false }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'RqUID': crypto.randomUUID(),
                'Authorization': 'Bearer ' + ai.token,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
                }
                catch (e) {
                    reject(new Error('GigaChat auth parse error: ' + e.message));
                }
            });
        });
        req.on('error', reject);
        req.write('scope=' + ai.scope);
        req.end();
    });
}

// ===== Silero TTS (ONNX, локально) =====

let sileroSession = null;
const SILERO_MODEL_PATH = path.join(process.cwd(), 'models', 'silero-tts.onnx');

/**
 * Локальный TTS через Silero (ONNX)
 * Модель скачивается при первом запуске (~20МБ)
 */
export async function sileroTTS(text, options = {}) {
    const ort = await import('onnxruntime-node');
    const sampleRate = options.sampleRate || 16000;

    // Загружаем модель при первом вызове
    if (!sileroSession) {
        await downloadSileroModel();
        sileroSession = await ort.InferenceSession.create(SILERO_MODEL_PATH);
        console.log('[tts] Silero модель загружена');
    }

    // Токенизация текста (простейший токенизатор для русского)
    const tokens = tokenize(text);

    // Подготовка входов для Silero
    const inputIds = new Int64Array(tokens);
    const inputLen = new Int64Array([tokens.length]);
    const speaker = new Int64Array([0]); // speaker id

    const feeds = {
        input: new ort.Tensor('int64', inputIds, [1, tokens.length]),
        input_lengths: new ort.Tensor('int64', inputLen, [1]),
        sid: new ort.Tensor('int64', speaker, [1]),
    };

    const results = await sileroSession.run(feeds);
    const audio = results.audio.data;
    const audioBuffer = floatToWav(audio, sampleRate);
    return audioBuffer;
}

/**
 * Простейший токенизатор для Silero TTS (русский)
 */
function tokenize(text) {
    // Silero использует numbered phonemes — нужна таблица
    // Для прототипа используем коды символов
    const tokens = [];
    for (const ch of text.toLowerCase()) {
        const code = ch.charCodeAt(0);
        if (code >= 1072 && code <= 1103) { // а-я
            tokens.push(code - 1072 + 1); // 1-32
        } else if (ch === 'ё') {
            tokens.push(7); // ё = ж-1
        } else if (ch === ' ') {
            tokens.push(0);
        } else if (ch === '.') {
            tokens.push(33);
        } else if (ch === ',') {
            tokens.push(34);
        } else if (ch === '?') {
            tokens.push(35);
        } else if (ch === '!') {
            tokens.push(36);
        }
    }
    return tokens.length ? tokens : [0];
}

/**
 * Конвертация float32 array в WAV buffer
 */
function floatToWav(float32Array, sampleRate) {
    const buffer = Buffer.alloc(44 + float32Array.length * 2);
    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + float32Array.length * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);  // PCM
    buffer.writeUInt16LE(1, 22);  // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(float32Array.length * 2, 40);
    // PCM data
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
    }
    return buffer;
}

/**
 * Скачивание модели Silero TTS
 */
async function downloadSileroModel() {
    if (fs.existsSync(SILERO_MODEL_PATH))
        return;
    const dir = path.dirname(SILERO_MODEL_PATH);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });

    console.log('[tts] Скачивание Silero TTS модели...');
    // Silero TTS v3.1 (ru)
    const url = 'https://models.silero.ai/voice_recognition/silero_v3_1_ru_latest.onnx';
    // Альтернативная ссылка
    // const url = 'https://huggingface.co/silero/silero-models/resolve/main/models/v3_1_ru/silero_v3_1_ru_latest.onnx';

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(SILERO_MODEL_PATH);
        const req = https.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                // Редирект
                const redirectUrl = res.headers.location;
                https.get(redirectUrl, (res2) => {
                    res2.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        console.log('[tts] Silero модель скачана');
                        resolve();
                    });
                }).on('error', reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error('Не удалось скачать Silero: ' + res.statusCode));
                return;
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log('[tts] Silero модель скачана');
                resolve();
            });
        });
        req.on('error', reject);
    });
}

// ===== Qwen3-TTS (локальный сервис) =====

let qwen3Session = null;
const QWEN3_URL = 'http://localhost:8002/tts';

/**
 * Локальный TTS через Qwen3-TTS-12Hz-0.6B-Base.
 * @param {string} text - Текст
 * @param {object} options - { voice, speed }
 * @returns {Promise<Buffer>} - WAV buffer
 */
export async function qwen3TTS(text, options = {}) {
    const body = JSON.stringify({
        text,
        voice: options.voice || 'default',
        speed: options.speed || 1.0,
    });

    let res;
    try {
        res = await fetch(QWEN3_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
    } catch (e) {
        throw new Error('Qwen3 TTS сервер не запущен на localhost:8002');
    }

    if (!res.ok)
        throw new Error('Qwen3 TTS error ' + res.status + ': ' + (await res.text()).slice(0, 200));

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

// ===== Универсальный интерфейс =====

/**
 * Синтез речи — универсальный метод
 * @param {string} text - Текст
 * @param {object} ai - Объект модели
 * @param {object} options - { engine: 'gigachat' | 'silero', voice, format }
 * @returns {Promise<Buffer>} - WAV/opus buffer
 */
export async function synthesize(text, ai, options = {}) {
    const engine = options.engine || 'gigachat';
    switch (engine) {
        case 'qwen3':
            return qwen3TTS(text, options);
        case 'silero':
            return sileroTTS(text, options);
        case 'gigachat':
        default:
            return gigachatTTS(text, ai, options);
    }
}