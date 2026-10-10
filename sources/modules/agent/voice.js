/**
 * Голосовой режим задачи (сервер): конфигурация, синтез и распознавание речи через модели WORK.
 *   ai/config.js: ttsModel (capability tts), sttModel (capability stt), voice { instructions, language }.
 * Ключи моделей остаются на сервере: браузер получает только звук и текст.
 * Модель не настроена или недоступна — voiceConfig честно говорит об этом, клиент работает на речи браузера.
 */
import { loadConfig } from './resources.js';

export const MAX_SPEECH_CHARS = 1000;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const PROBE_TTL = 60_000;
const probes = new Map();

/** Текст для синтеза: без управляющих символов и лишних пробелов, не длиннее лимита. */
export function speechInput(text, max = MAX_SPEECH_CHARS) {
    const s = String(text ?? '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
    return s.length > max ? s.slice(0, max) : s;
}

function capsOf(item) {
    const c = item?.capabilities;
    return Array.isArray(c) ? c.map(String) : String(c || '').split(/[\s,]+/).filter(Boolean);
}

/** Конфиг места задачи (слои ai/config.js) для файла .task. */
async function configFor(file) {
    const place = file?.$class || file?.$owner || null;
    return loadConfig(place);
}

/** Узел модели из конфига с нужной возможностью; нет — null. */
async function modelFor(file, key, cap) {
    const cfg = await configFor(file);
    const path = cfg?.[key];
    if (!path)
        return null;
    let item = null;
    try {
        item = await WORK.get_item(path);
        await item?.init;
    }
    catch {
        return null;
    }
    if (!item || Array.isArray(item) || !capsOf(item).includes(cap))
        return null;
    return { item, cfg, path };
}

/** Есть ли модель на шлюзе провайдера (кэш 60 с). true / false / null — проверить не удалось. */
async function listedRemote(item) {
    const key = item.path || item.id;
    const hit = probes.get(key);
    if (hit && Date.now() - hit.at < PROBE_TTL)
        return hit.value;
    let value = null;
    try {
        const res = await item.list_remote?.({});
        const tag = String(item.model || '');
        if (Array.isArray(res?.models) && tag)
            value = res.models.some(id => id === tag || String(id).endsWith('/' + tag));
    }
    catch {
        value = null;
    }
    probes.set(key, { at: Date.now(), value });
    return value;
}

/** Забыть результаты проверок моделей (тесты, смена настроек). */
export function resetVoiceProbes() {
    probes.clear();
}

const DOT_EYES = ['round', 'sleepy', 'happy'];
const DOT_ACCESSORIES = ['none', 'glasses', 'cap'];

/** Внешний вид персонажа из ai/config.js `dot`: только известные значения (то же правило — lib/dot/dot-math.js sanitizeLook). */
export function sanitizeDot(look) {
    const src = look && typeof look === 'object' ? look : {};
    const color = typeof src.color === 'string' && /^[#a-z0-9(),.%/ -]{3,48}$/i.test(src.color.trim()) ? src.color.trim() : '';
    return {
        color,
        eyes: DOT_EYES.includes(src.eyes) ? src.eyes : 'round',
        accessory: DOT_ACCESSORIES.includes(src.accessory) ? src.accessory : 'none',
    };
}

/** Внешний вид персонажа для задачи (шапка, голосовой режим). */
export async function dotLook(file) {
    return sanitizeDot((await configFor(file))?.dot);
}

/**
 * Что доступно в этой задаче: { tts, stt, lang, dot }. false — модели нет (или её нет на шлюзе): клиент
 * использует речь и распознавание браузера. Синтез при невозможности проверить шлюз считается доступным
 * (первый запрос покажет ошибку и включит запасной голос), распознавание — только если шлюз его перечислил:
 * иначе запись микрофона уходила бы в никуда.
 */
export async function voiceConfig(file) {
    const [tts, stt] = await Promise.all([modelFor(file, 'ttsModel', 'tts'), modelFor(file, 'sttModel', 'stt')]);
    const cfg = await configFor(file);
    const ttsOk = !!tts && (await listedRemote(tts.item)) !== false;
    const sttOk = !!stt && (await listedRemote(stt.item)) === true;
    return {
        tts: ttsOk,
        stt: sttOk,
        lang: String(cfg?.voice?.language || 'Russian'),
        maxChars: MAX_SPEECH_CHARS,
        dot: sanitizeDot(cfg?.dot),
    };
}
/** Синтез: текст → WAV (Buffer). Бросает ошибку, если модели нет или шлюз ответил ошибкой. */
export async function speak(file, { text, language, instructions } = {}) {
    const input = speechInput(text);
    if (!input)
        throw new Error('voice_speak: пустой текст');
    const m = await modelFor(file, 'ttsModel', 'tts');
    if (!m)
        throw new Error('voice_speak: модель синтеза речи не настроена (ai/config.js ttsModel)');
    const voice = m.cfg?.voice || {};
    return m.item.speak({
        text: input,
        language: language || voice.language,
        instructions: instructions || voice.instructions,
    });
}

/** Распознавание: аудио (Buffer, WAV) → { text }. */
export async function transcribe(file, { audio, language } = {}) {
    if (!Buffer.isBuffer(audio) || !audio.length)
        throw new Error('voice_transcribe: нет аудио');
    if (audio.length > MAX_AUDIO_BYTES)
        throw new Error('voice_transcribe: запись слишком длинная (' + Math.round(audio.length / 1024) + ' КБ)');
    const m = await modelFor(file, 'sttModel', 'stt');
    if (!m)
        throw new Error('voice_transcribe: модель распознавания речи не настроена (ai/config.js sttModel)');
    return m.item.transcribe({ audio, language });
}
