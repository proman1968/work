/**
 * Голосовой режим задачи (сервер): конфигурация, синтез и распознавание речи через модели WORK.
 *   ai/config.js: ttsModel (capability tts), sttModel (capability stt), voice { instructions, language }.
 * Ключи моделей остаются на сервере: браузер получает только звук и текст.
 * Модель не настроена или недоступна — voiceConfig честно говорит об этом, клиент работает на речи браузера.
 */
import fs from 'node:fs';
import nodePath from 'node:path';
import { loadConfig } from './resources.js';

export const MAX_SPEECH_CHARS = 1000;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const PROBE_TTL = 60_000;
const probes = new Map();
const _userPrefsMem = new Map();

function sanitizeUid(uid) {
    const s = String(uid || '').trim();
    if (!s || s === 'anon' || !/^[A-Za-z0-9_.-]{1,64}$/.test(s))
        return '';
    return s;
}

function sanitizeTtsModelPath(raw) {
    const s = String(raw || '').trim().replace(/\\/g, '/');
    if (!s || s.length > 240 || s.includes('..'))
        return '';
    const norm = s.startsWith('/') ? s : '/' + s;
    if (!/^\/MODELS\/[^/]+\/[^/]+$/i.test(norm))
        return '';
    return norm;
}

function userVoicePrefsFile(uid, rootDir = process.cwd()) {
    const clean = sanitizeUid(uid);
    if (!clean)
        return '';
    const userMetaDir = nodePath.join(rootDir, 'USERS', clean, '$user');
    if (!fs.existsSync(userMetaDir))
        return '';
    return nodePath.join(userMetaDir, '#system', 'voice-prefs.json');
}

export function readUserVoicePrefsSync(uid, rootDir = process.cwd()) {
    const clean = sanitizeUid(uid);
    if (!clean)
        return {};
    const file = userVoicePrefsFile(clean, rootDir);
    if (file && fs.existsSync(file)) {
        try {
            const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) || {};
            return {
                ttsModel: sanitizeTtsModelPath(raw.ttsModel),
                ttsVoice: String(raw.ttsVoice || '').trim().slice(0, 80),
                ttsInstructions: String(raw.ttsInstructions || '').trim().slice(0, 400),
            };
        }
        catch { /* ignore */ }
    }
    return _userPrefsMem.get(clean) || {};
}

export function setUserVoicePrefs({ uid, ttsModel, ttsVoice, ttsInstructions, rootDir = process.cwd() } = {}) {
    const clean = sanitizeUid(uid);
    if (!clean)
        return { ok: false, persisted: false, prefs: {} };
    const prev = readUserVoicePrefsSync(clean, rootDir);
    const prefs = {
        ttsModel: ttsModel !== undefined ? sanitizeTtsModelPath(ttsModel) : (prev.ttsModel || ''),
        ttsVoice: ttsVoice !== undefined ? String(ttsVoice || '').trim().slice(0, 80) : (prev.ttsVoice || ''),
        ttsInstructions: ttsInstructions !== undefined ? String(ttsInstructions || '').trim().slice(0, 400) : (prev.ttsInstructions || ''),
        updatedAt: Date.now(),
    };
    _userPrefsMem.set(clean, prefs);
    const file = userVoicePrefsFile(clean, rootDir);
    if (file) {
        try {
            fs.mkdirSync(nodePath.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(prefs, null, 2), 'utf-8');
            return { ok: true, persisted: true, prefs };
        }
        catch { /* ignore */ }
    }
    return { ok: true, persisted: false, prefs };
}

export function resetVoicePrefsCache() {
    _userPrefsMem.clear();
}

const SILERO_VOICES = Object.freeze([
    { id: 'xenia', label: 'Ксения (женский)', voice: 'xenia' },
    { id: 'baya', label: 'Бая (женский мягкий)', voice: 'baya' },
    { id: 'kseniya', label: 'Ксения (чёткий диктор)', voice: 'kseniya' },
    { id: 'aidar', label: 'Айдар (мужской)', voice: 'aidar' },
    { id: 'eugene', label: 'Евгений (мужской)', voice: 'eugene' },
]);

const PIPER_VOICES = Object.freeze([
    { id: 'dmitri', label: 'Дмитрий (мужской)', voice: 'dmitri' },
    { id: 'irina', label: 'Ирина (женский)', voice: 'irina' },
]);

const KOKORO_VOICES = Object.freeze([
    { id: 'af_heart', label: 'Heart (EN женский)', voice: 'af_heart' },
    { id: 'af_bella', label: 'Bella (EN женский)', voice: 'af_bella' },
    { id: 'am_adam', label: 'Adam (EN мужской)', voice: 'am_adam' },
    { id: 'am_michael', label: 'Michael (EN мужской)', voice: 'am_michael' },
    { id: 'bf_emma', label: 'Emma (UK женский)', voice: 'bf_emma' },
    { id: 'bm_george', label: 'George (UK мужской)', voice: 'bm_george' },
]);

const QWEN_CUSTOM_VOICES = Object.freeze([
    { id: 'Serena', label: 'Serena (женский)', voice: 'Serena' },
    { id: 'Vivian', label: 'Vivian (женский живой)', voice: 'Vivian' },
    { id: 'Ryan', label: 'Ryan (мужской)', voice: 'Ryan' },
    { id: 'Aiden', label: 'Aiden (мужской диктор)', voice: 'Aiden' },
    { id: 'Dylan', label: 'Dylan (мужской)', voice: 'Dylan' },
]);

const VOICE_DESIGN_PRESETS = Object.freeze([
    { id: 'male_baritone', label: 'Мужской баритон', instructions: 'Мужской баритон, спокойная деловая интонация' },
    { id: 'male_announcer', label: 'Мужской диктор', instructions: 'Мужской дикторский голос, глубокий уверенный тембр, чёткая дикция' },
    { id: 'female_calm', label: 'Женский спокойный', instructions: 'Женский спокойный тёплый голос, мягкая естественная интонация' },
    { id: 'female_lively', label: 'Женский живой', instructions: 'Женский живой энергичный голос, доброжелательная выразительная подача' },
]);

export function describeTtsModel(item) {
    if (!item)
        return null;
    const itemPath = String(item.path || item.short || '').replace(/\\/g, '/');
    const hay = `${item.id || ''} ${item.model || ''} ${item.DATA?.model || ''} ${item.DATA?.hfRepo || ''} ${itemPath}`.toLowerCase();
    const label = String(item.label || item.DATA?.label || item.id || itemPath.split('/').pop() || 'TTS');
    const savedDefaultVoice = String(item.voice || item.DATA?.voice || '').trim();

    if (hay.includes('silero')) {
        return {
            path: itemPath,
            label,
            kind: 'silero',
            lang: 'ru',
            defaultVoice: SILERO_VOICES.some(v => v.voice === savedDefaultVoice) ? savedDefaultVoice : 'xenia',
            voices: SILERO_VOICES,
        };
    }
    if (hay.includes('piper')) {
        return {
            path: itemPath,
            label,
            kind: 'piper',
            lang: 'ru',
            defaultVoice: PIPER_VOICES.some(v => v.voice === savedDefaultVoice) ? savedDefaultVoice : 'dmitri',
            voices: PIPER_VOICES,
        };
    }
    if (hay.includes('kokoro')) {
        return {
            path: itemPath,
            label,
            kind: 'kokoro',
            lang: 'en',
            defaultVoice: KOKORO_VOICES.some(v => v.voice === savedDefaultVoice) ? savedDefaultVoice : 'af_heart',
            voices: KOKORO_VOICES,
        };
    }
    if (hay.includes('customvoice') || hay.includes('custom_voice')) {
        return {
            path: itemPath,
            label,
            kind: 'qwen_custom',
            lang: 'ru',
            defaultVoice: QWEN_CUSTOM_VOICES.some(v => v.voice.toLowerCase() === savedDefaultVoice.toLowerCase()) ? savedDefaultVoice : 'Serena',
            voices: QWEN_CUSTOM_VOICES,
        };
    }
    return {
        path: itemPath,
        label,
        kind: 'qwen_design',
        lang: 'ru',
        defaultVoice: savedDefaultVoice || 'default',
        voices: VOICE_DESIGN_PRESETS,
    };
}

function ttsPriorityScore(itemPath, item) {
    const hay = `${itemPath} ${item?.id || ''} ${item?.model || ''}`.toLowerCase();
    const isLocal = itemPath.startsWith('/MODELS/Local/');
    if (isLocal && hay.includes('silero'))
        return 100;
    if (isLocal && hay.includes('piper'))
        return 90;
    if (isLocal && (hay.includes('0.6b') || hay.includes('customvoice')))
        return 80;
    if (isLocal && !hay.includes('kokoro'))
        return 70;
    if (isLocal)
        return 50;
    return 10;
}

async function listActiveTtsItems() {
    const out = [];
    const seen = new Set();
    try {
        const modelsRoot = await WORK.get_item('/MODELS').catch(() => null);
        for (const prov of (await modelsRoot?.items) || []) {
            if (!prov || Array.isArray(prov))
                continue;
            await prov.init?.catch?.(() => {});
            if (prov.DATA?.enabled === false)
                continue;
            for (const m of (await prov.items) || []) {
                if (!m || Array.isArray(m))
                    continue;
                await m.init?.catch?.(() => {});
                if (m.DATA?.enabled === false || (m.aiActive ?? m.DATA?.aiActive) === false)
                    continue;
                if (!capsOf(m).includes('tts'))
                    continue;
                const p = String(m.path || m.short || '');
                if (!p || seen.has(p))
                    continue;
                seen.add(p);
                out.push(m);
            }
        }
    }
    catch { /* ignore */ }
    out.sort((a, b) => ttsPriorityScore(String(b.path || ''), b) - ttsPriorityScore(String(a.path || ''), a));
    return out;
}

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

/** Найти активную локальную модель в /MODELS/Local с заданной возможностью (stt/tts).
 *  Для интерактивного TTS-голоса при наличии быстрой 0.6B CustomVoice отдаём ей приоритет перед тяжёлой 1.7B VoiceDesign. */
async function localVoiceModel(cap) {
    try {
        const local = await WORK.get_item('/MODELS/Local').catch(() => null);
        const matches = [];
        for (const m of (await local?.items) || []) {
            if (!m || Array.isArray(m))
                continue;
            await m.init?.catch?.(() => {});
            if ((m.aiActive ?? m.DATA?.aiActive) === false || m.DATA?.enabled === false)
                continue;
            if (capsOf(m).includes(cap))
                matches.push(m);
        }
        if (!matches.length)
            return null;
        if (cap === 'tts' && matches.length > 1) {
            const silero = matches.find(m => /silero/i.test(String(m.id || m.model || m.path || '')));
            if (silero)
                return silero;
            const piper = matches.find(m => /piper/i.test(String(m.id || m.model || m.path || '')));
            if (piper)
                return piper;
            const fast = matches.find(m => /0\.6b|customvoice/i.test(String(m.id || m.model || m.path || '')));
            if (fast)
                return fast;
        }
        return matches[0];
    }
    catch { /* ignore */ }
    return null;
}

/** Найти активную модель по явному пути /MODELS/<Provider>/<Model> с нужной возможностью. */
async function resolveExplicitModel(rawPath, cap) {
    const norm = sanitizeTtsModelPath(rawPath);
    if (!norm)
        return null;
    let item;
    try {
        item = await WORK.get_item(norm);
        await item?.init;
    }
    catch {
        return null;
    }
    if (!item || Array.isArray(item) || !capsOf(item).includes(cap))
        return null;
    if (item.DATA?.enabled === false || (item.aiActive ?? item.DATA?.aiActive) === false)
        return null;
    return item;
}

/** Узел модели из конфига с нужной возможностью (учитывает персональный выбор пользователя, затем локальную/облачную модель по конфигу). */
async function modelFor(file, key, cap, preferredModelPath = '') {
    const cfg = await configFor(file);
    if (preferredModelPath) {
        const picked = await resolveExplicitModel(preferredModelPath, cap);
        if (picked)
            return { item: picked, cfg, path: picked.path || preferredModelPath };
    }
    const path = cfg?.[key];
    const isDefaultCloud = !path || /^\/MODELS\/odant\//i.test(String(path));
    if (isDefaultCloud) {
        const local = await localVoiceModel(cap);
        if (local)
            return { item: local, cfg, path: local.path };
    }
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

function resolveVoiceSelection(desc, { requestedVoice = '', requestedInstructions = '', savedVoice = '', savedInstructions = '', cfgVoice = {} } = {}) {
    if (!desc)
        return { voice: '', instructions: '' };
    if (desc.kind === 'qwen_design') {
        const inst = String(requestedInstructions || savedInstructions || cfgVoice?.instructions || '').trim();
        const v = String(requestedVoice || savedVoice || cfgVoice?.voice || cfgVoice?.speaker || desc.defaultVoice || '').trim();
        return { voice: v, instructions: inst };
    }
    const allowed = Array.isArray(desc.voices) ? desc.voices.map(x => String(x.voice || x.id || '')).filter(Boolean) : [];
    const pickValid = (cand) => {
        const s = String(cand || '').trim();
        if (!s)
            return '';
        if (!allowed.length)
            return s;
        return allowed.find(a => a.toLowerCase() === s.toLowerCase()) || '';
    };
    const voice = pickValid(requestedVoice)
        || pickValid(savedVoice)
        || pickValid(cfgVoice?.voice || cfgVoice?.speaker)
        || pickValid(desc.defaultVoice)
        || allowed[0]
        || '';
    return {
        voice,
        instructions: String(requestedInstructions || savedInstructions || cfgVoice?.instructions || '').trim(),
    };
}

/** Есть ли модель на шлюзе провайдера (кэш 60 с). true / false / null — проверить не удалось. */
async function listedRemote(item) {
    const p = String(item?.path || item?.short || '');
    const proto = String(item?.protocol || item?.DATA?.protocol || '');
    if (proto === 'local' || proto === 'halogen' || p.startsWith('/MODELS/Local/'))
        return (item?.aiActive ?? item?.DATA?.aiActive) !== false;
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
export async function voiceConfig(file, { uid } = {}) {
    const prefs = readUserVoicePrefsSync(uid);
    const [tts, stt, activeTtsItems] = await Promise.all([
        modelFor(file, 'ttsModel', 'tts', prefs.ttsModel),
        modelFor(file, 'sttModel', 'stt'),
        listActiveTtsItems(),
    ]);
    const cfg = await configFor(file);
    const ttsOk = !!tts && (await listedRemote(tts.item)) !== false;
    const sttOk = !!stt && (await listedRemote(stt.item)) === true;

    const ttsDescs = [];
    const seen = new Set();
    for (const m of activeTtsItems) {
        const d = describeTtsModel(m);
        if (d && d.path && !seen.has(d.path)) {
            seen.add(d.path);
            ttsDescs.push(d);
        }
    }
    if (tts?.item) {
        const d = describeTtsModel(tts.item);
        if (d && d.path && !seen.has(d.path)) {
            seen.add(d.path);
            ttsDescs.push(d);
        }
    }

    const activeDesc = tts?.item ? describeTtsModel(tts.item) : null;
    const resolved = activeDesc
        ? resolveVoiceSelection(activeDesc, {
            savedVoice: prefs.ttsVoice,
            savedInstructions: prefs.ttsInstructions,
            cfgVoice: cfg?.voice || {},
        })
        : { voice: '', instructions: '' };

    return {
        tts: ttsOk,
        stt: sttOk,
        lang: String(cfg?.voice?.language || 'Russian'),
        maxChars: MAX_SPEECH_CHARS,
        dot: sanitizeDot(cfg?.dot),
        ttsModel: activeDesc?.path || '',
        ttsVoice: resolved.voice,
        ttsInstructions: resolved.instructions,
        ttsModels: ttsDescs,
    };
}
/** Синтез: текст → WAV (Buffer). Бросает ошибку, если модели нет или шлюз ответил ошибкой. */
export async function speak(file, { text, language, instructions, voice, ttsModel, uid } = {}) {
    const input = speechInput(text);
    if (!input)
        throw new Error('voice_speak: пустой текст');
    if (!voiceRateOk('speak', uid))
        throw new Error('voice_speak: слишком часто (лимит ' + VOICE_RATE.speak + '/мин) — попробуйте через минуту');
    const prefs = readUserVoicePrefsSync(uid);
    const m = await modelFor(file, 'ttsModel', 'tts', ttsModel || prefs.ttsModel);
    if (!m)
        throw new Error('voice_speak: модель синтеза речи не настроена (ai/config.js ttsModel)');
    const cfgVoice = m.cfg?.voice || {};
    const desc = describeTtsModel(m.item);
    const picked = resolveVoiceSelection(desc, {
        requestedVoice: voice,
        requestedInstructions: instructions,
        savedVoice: prefs.ttsVoice,
        savedInstructions: prefs.ttsInstructions,
        cfgVoice,
    });
    return m.item.speak({
        text: input,
        language: language || cfgVoice.language,
        ...(picked.voice ? { voice: picked.voice } : {}),
        ...(picked.instructions ? { instructions: picked.instructions } : {}),
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
