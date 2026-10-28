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
        // eslint-disable-next-line no-control-regex -- управляющие символы здесь вырезаются намеренно (текст для синтеза речи)
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

/** Конфиг места задачи (слои ai/config.js) для файла .task или узла класса. */
async function configFor(file) {
    const isTask = file?.ext === 'task' || String(file?.path || '').endsWith('.task') || file?.$class?.id === '$task';
    const place = isTask ? (file?.$class || file?.$owner || null) : (file || file?.$class || file?.$owner || null);
    return loadConfig(place);
}

/** Узел модели из конфига с нужной возможностью; нет — null. */
async function modelFor(file, key, cap) {
    const cfg = await configFor(file);
    const path = cfg?.[key];
    if (!path)
        return null;
    let item;
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
            value = res.models.some(id => id === tag || String(id).endsWith('/' + tag) || tag.endsWith('/' + String(id)));
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

/**
 * F25 (final 8.18): лимит частоты голосовых вызовов — синтез и распознавание
 * ходят с платными ключами; тот, кто видит задачу (право чтения), не должен
 * выжигать счётчик бесконечными запросами. Ведро на субъекта, окно 1 минута.
 */
export const VOICE_RATE = Object.freeze({
    speak: Number(process.env.WORK_VOICE_RATE_TTS) || 20,
    transcribe: Number(process.env.WORK_VOICE_RATE_STT) || 20,
});
const rateBuckets = new Map(); // kind:uid → { count, at }
const RATE_WINDOW_MS = 60_000;

/** Забыть счётчики (тесты). */
export function resetVoiceRate() {
    rateBuckets.clear();
}

function voiceRateOk(kind, uid) {
    const limit = Number(VOICE_RATE[kind]) || 20;
    const key = kind + ':' + (String(uid || 'anon').slice(0, 40));
    const now = Date.now();
    let b = rateBuckets.get(key);
    if (!b || now - b.at >= RATE_WINDOW_MS) {
        if (rateBuckets.size > 10_000)
            rateBuckets.clear(); // страховка от роста
        b = { count: 0, at: now };
        rateBuckets.set(key, b);
    }
    if (b.count >= limit)
        return false;
    b.count++;
    return true;
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
export async function speak(file, { text, language, instructions, uid } = {}) {
    const input = speechInput(text);
    if (!input)
        throw new Error('voice_speak: пустой текст');
    if (!voiceRateOk('speak', uid))
        throw new Error('voice_speak: слишком часто (лимит ' + VOICE_RATE.speak + '/мин) — попробуйте через минуту');
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
export async function transcribe(file, { audio, language, uid } = {}) {
    if (!Buffer.isBuffer(audio) || !audio.length)
        throw new Error('voice_transcribe: нет аудио');
    if (!voiceRateOk('transcribe', uid))
        throw new Error('voice_transcribe: слишком часто (лимит ' + VOICE_RATE.transcribe + '/мин) — попробуйте через минуту');
    if (audio.length > MAX_AUDIO_BYTES)
        throw new Error('voice_transcribe: запись слишком длинная (' + Math.round(audio.length / 1024) + ' КБ)');
    const m = await modelFor(file, 'sttModel', 'stt');
    if (!m)
        throw new Error('voice_transcribe: модель распознавания речи не настроена (ai/config.js sttModel)');
    return m.item.transcribe({ audio, language });
}

const GENERIC_WAREHOUSE_WORDS = new Set(['основной', 'главный', 'наш', 'этот', 'какой', 'любой', 'товары', 'материалы', 'склад']);

/**
 * Быстрая проверка промежуточной речи человека (AI Barge-In / проактивное перебивание со стороны ИИ):
 * 1) Если человек на лету назвал несуществующий счёт или склад в текущей организации ($base) — ИИ сразу мягко перебивает и уточняет.
 * 2) Если человек замялся (пауза >= 350 мс на «эээ…», «как его…», «какой там счёт…») — сигнал раннего подхвата реплики (submitEarly).
 */
export async function checkInterim(file, { text, pauseMs = 0 } = {}) {
    const clean = speechInput(text, 600);
    if (!clean || clean.length < 4)
        return { interject: false };

    try {
        const { resolveBasePath, dataStore } = await import('../../data/api.js');
        const { classesOfType } = await import('../../data/classes.js');
        const { queryObjects } = await import('../../data/objects.js');
        const rawPath = String(file?.path || file?.$owner?.path || file?.$class?.path || '');
        const basePath = resolveBasePath(rawPath) || '';
        const db = await dataStore(basePath);

        // 1. Проверка названного вслух счёта («по счёту 99», «на счёт 77»)
        const accMatch = /(?:сч[её]т[ауеом]*)\s*(?:№|номер)?\s*(\d{2}(?:\.\d{1,2})?)\b/iu.exec(clean);
        if (accMatch) {
            const code = accMatch[1];
            const accounts = classesOfType(db, '$account') || [];
            if (accounts.length > 0) {
                const found = accounts.some(a => {
                    const id = a.name || String(a.cid || a.path || '').split('/').pop() || '';
                    return id === code || id.startsWith(code + '.') || String(a.label || '').startsWith(code + ' ');
                });
                if (!found) {
                    const topCodes = [...new Set(accounts.map(a => (a.name || String(a.cid || a.path || '').split('/').pop() || '').split('.')[0]).filter(Boolean))].slice(0, 8).join(', ');
                    return {
                        interject: true,
                        kind: 'fact_check',
                        text: `Секунду, перебью: счёта ${code} в плане счетов нет. Доступны счета: ${topCodes}. Какой берём?`,
                    };
                }
            }
        }

        // 2. Проверка названного вслух склада («со склада Северный», «на склад Южный»)
        const whMatch = /(?:со\s+склада|на\s+склад|склад)\s+«?([А-ЯЁA-Z][а-яёa-z0-9-]{2,24})»?/u.exec(clean);
        if (whMatch) {
            const whName = whMatch[1].trim();
            if (!GENERIC_WAREHOUSE_WORDS.has(whName.toLowerCase())) {
                const catalogs = classesOfType(db, '$catalog') || [];
                const whClass = catalogs.find(c => /Склады$/i.test(c.cid || c.path || ''));
                if (whClass) {
                    const res = queryObjects(db, { cid: whClass.cid || whClass.path, limit: 20 });
                    const items = res?.items || [];
                    if (items.length > 0) {
                        const hit = items.some(it => String(it.name || '').toLowerCase().includes(whName.toLowerCase()));
                        if (!hit) {
                            const names = items.map(it => it.name).filter(Boolean).slice(0, 3);
                            return {
                                interject: true,
                                kind: 'fact_check',
                                text: `Секунду, перебью: склада «${whName}» в базе нет, есть «${names.join('», «')}». Какой указать?`,
                            };
                        }
                    }
                }
            }
        }
    }
    catch { /* если база недоступна — не мешаем потоку речи */ }

    // 3. Подхват при заминке человека (пауза >= 350 мс на незаконченной мысли)
    if (pauseMs >= 350 && /(?:ээ+|мм+|хм+|как\s+его|как\s+там(?:\s+\S+)?|какой\s+там(?:\s+\S+)?|забыл(?:\s+как)?|подскажи)\s*[.…,?-]*$/iu.test(clean)) {
        return {
            interject: true,
            kind: 'hesitation',
            submitEarly: true,
        };
    }

    return { interject: false };
}
