/**
 * Прямая интеграция с Hugging Face Hub (`https://huggingface.co`):
 * - мультимодальный каталог и поиск моделей по типам (`llm`, `vlm`, `image`, `audio`, `video`, `embed`) и умениям (`capabilities`);
 * - оценка совместимости каждой модели с реальным бюджетом памяти машины (`evaluateModelFit`);
 * - инспекция файлов репозитория (`inspectHuggingFaceRepo`: `.gguf`, `.safetensors`, `config.json`, квантизации и человекочитаемые размеры);
 * - потоковая загрузка моделей с поддержкой докачки (`Range`), отслеживанием прогресса и отменой (`startHuggingFaceDownload`);
 * - автоматическая регистрация скачанной модели как дочернего узла `$ai` в `/MODELS/Local/<Имя>` с её реальными `capabilities`.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
    DEFAULT_HF_ORIGIN,
    loadTrainerNetworkSettings,
    normalizeEndpointUrl,
    describeSourceLabel,
    canSendAuthToUrl,
    createNetworkFetch,
    downloadFileMultipart,
    mergeRanges,
    sumRangesBytes,
} from './downloader.js';
import {
    localRootDir,
    modelDir as getModelDir,
    modelWeightsDir as getModelWeightsDir,
    migrateLocalModelsLayoutSync,
    hasReadyWeightFilesSync,
    LINUX_ONLY_HALOGEN_EXT_RE,
} from './paths.js';

const HF_ORIGIN = DEFAULT_HF_ORIGIN;
const REPO_ID_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Типы (модальности) моделей ИИ для фильтрации и маршрутизации в WORK.
 */
export const MODEL_MODALITIES = Object.freeze([
    { id: 'all', label: 'Все типы', shortLabel: 'Все', hfPipeline: '' },
    { id: 'llm', label: 'Текст и Код (LLM)', shortLabel: 'Текст / Код', hfPipeline: 'text-generation' },
    { id: 'vlm', label: 'Зрение и Документы (VLM / OCR)', shortLabel: 'Зрение / OCR', hfPipeline: 'image-text-to-text' },
    { id: 'image', label: 'Изображения (Image Gen)', shortLabel: 'Картинки', hfPipeline: 'text-to-image' },
    { id: 'audio', label: 'Звук и Речь (ASR / TTS / Music)', shortLabel: 'Звук / Речь', hfPipeline: 'automatic-speech-recognition' },
    { id: 'video', label: 'Видео (Video Gen)', shortLabel: 'Видео', hfPipeline: 'text-to-video' },
    { id: 'embed', label: 'Поиск и Эмбеддинги (RAG)', shortLabel: 'RAG / Поиск', hfPipeline: 'feature-extraction' },
]);

/**
 * Справочник умений (capabilities) моделей ИИ — что именно умеет делать модель.
 */
export const MODEL_CAPABILITIES = Object.freeze({
    chat: { id: 'chat', label: 'Диалог', desc: 'Ведение диалога, ответы на вопросы и консультации' },
    tools: { id: 'tools', label: 'Инструменты', desc: 'Вызов функций и инструментов WORK (отчёты, операции, поиск)' },
    thinking: { id: 'thinking', label: 'Рассуждения', desc: 'Глубокое пошаговое мышление (Chain-of-Thought) для сложных задач' },
    coding: { id: 'coding', label: 'Код и Схемы', desc: 'Генерация class.js, правил проводок POSTINGS, форм ODA и SQL' },
    vision: { id: 'vision', label: 'Зрение / OCR', desc: 'Распознавание сканов накладных, счетов, таблиц, чертежей и фото' },
    image: { id: 'image', label: 'Генерация фото', desc: 'Создание и редактирование иллюстраций, карточек товаров и баннеров' },
    stt: { id: 'stt', label: 'Слух (ASR)', desc: 'Распознавание голоса и транскрибация звонков/совещаний в текст' },
    tts: { id: 'tts', label: 'Голос (TTS)', desc: 'Озвучивание ответов живым голосом и синтез речи в звонках' },
    music: { id: 'music', label: 'Музыка / Звук', desc: 'Генерация музыки, джинглов и звуковых эффектов по описанию' },
    video: { id: 'video', label: 'Генерация видео', desc: 'Создание видеороликов по текстовому сценарию или стартовому кадру' },
    embeddings: { id: 'embeddings', label: 'Эмбеддинги', desc: 'Векторизация текста и кода для семантического поиска (RAG)' },
    rerank: { id: 'rerank', label: 'Реранкер', desc: 'Точное ранжирование найденных документов по смысловой близости' },
    lora: { id: 'lora', label: 'Дообучение LoRA', desc: 'Поддержка локального дообучения (SFT / GRPO / LoRA) на данных компании' },
});

/**
 * Полный мультимодальный каталог моделей для всех категорий (Текст/Код, Зрение, Картинки, Звук/Речь, Видео, RAG)
 * и разных уровней железа (от 8 ГБ до 192+ ГБ).
 */
export const CURATED_HF_MODELS = Object.freeze([
    // --- ТЕКСТ И КОД (LLM / АГЕНТЫ) ---
    {
        id: 'Qwen/Qwen3-0.6B',
        author: 'Qwen',
        modelName: 'Qwen3-0.6B (Сверхлёгкий маршрутизатор)',
        modality: 'llm',
        format: 'safetensors',
        paramsB: 0.6,
        ramRequiredGb: 1.0,
        trainRamGb: 2.2,
        capabilities: ['chat', 'classify', 'decide'],
        whatItDoes: 'Мгновенная классификация запросов, маршрутизация и быстрые короткие ответы на CPU/GPU',
        recommendedFor: 'Работает на любом ПК (<1 ГБ памяти)',
        tags: ['qwen3', '0.6b', 'safetensors', 'fast'],
        downloads: 190000,
        likes: 720,
    },
    {
        id: 'Qwen/Qwen3-4B',
        author: 'Qwen',
        modelName: 'Qwen3-4B',
        modality: 'llm',
        format: 'safetensors',
        paramsB: 4,
        ramRequiredGb: 3.5,
        trainRamGb: 6.5,
        capabilities: ['chat', 'tools', 'thinking', 'lora'],
        whatItDoes: 'Быстрый чат-ассистент, вызов инструментов WORK, пошаговые рассуждения и лёгкое дообучение LoRA',
        recommendedFor: 'Компактная модель для систем с 8–16 ГБ памяти',
        tags: ['qwen3', '4b', 'safetensors', '4-bit', 'lora', 'tool-calling'],
        downloads: 145000,
        likes: 610,
    },
    {
        id: 'Qwen/Qwen3-8B',
        author: 'Qwen',
        modelName: 'Qwen3-8B',
        modality: 'llm',
        format: 'safetensors',
        paramsB: 8,
        ramRequiredGb: 6.0,
        trainRamGb: 10.5,
        capabilities: ['chat', 'tools', 'thinking', 'coding', 'lora'],
        whatItDoes: 'Универсальный агент подразделения: проводки, отчёты ОСВ, консультации и SFT/GRPO дообучение',
        recommendedFor: 'Оптимально для систем с 16–24 ГБ памяти',
        tags: ['qwen3', '8b', 'safetensors', '4-bit', 'tool-calling', 'lora'],
        downloads: 210000,
        likes: 820,
    },
    {
        id: 'Qwen/Qwen3-14B',
        author: 'Qwen',
        modelName: 'Qwen3-14B',
        modality: 'llm',
        format: 'safetensors',
        paramsB: 14,
        ramRequiredGb: 10.0,
        trainRamGb: 16.5,
        capabilities: ['chat', 'tools', 'thinking', 'coding', 'lora'],
        whatItDoes: 'Глубокий финансовый и учётный анализ, сложные цепочки инструментов, генерация схем и дообучение под базу',
        recommendedFor: 'Золотой стандарт для систем с 24–32 ГБ памяти',
        tags: ['qwen3', '14b', 'safetensors', '4-bit', 'tool-calling', 'lora'],
        downloads: 195000,
        likes: 910,
    },
    {
        id: 'Qwen/Qwen3-30B-A3B-GGUF',
        author: 'Qwen',
        modelName: 'Qwen3-30B-A3B MoE',
        modality: 'llm',
        format: 'gguf',
        paramsB: 30,
        ramRequiredGb: 18.5,
        trainRamGb: 28.0,
        capabilities: ['chat', 'tools', 'thinking', 'coding'],
        whatItDoes: 'MoE-архитектура (30B знаний, но только 3B активных на токен): мгновенный отклик при высоком интеллекте',
        recommendedFor: 'Сверхбыстрый локальный инференс на системах от 24–32 ГБ памяти',
        tags: ['qwen3', 'moe', 'gguf', 'tool-calling'],
        downloads: 162000,
        likes: 880,
    },
    {
        id: 'Qwen/Qwen3-32B',
        author: 'Qwen',
        modelName: 'Qwen3-32B',
        modality: 'llm',
        format: 'safetensors',
        paramsB: 32,
        ramRequiredGb: 21.0,
        trainRamGb: 34.0,
        capabilities: ['chat', 'tools', 'thinking', 'coding', 'lora'],
        whatItDoes: 'Полноценная замена облачным моделям: аудит учёта, многошаговые агенты, глубокое дообучение SFT и GRPO',
        recommendedFor: 'Для рабочих станций от 32–48+ ГБ памяти',
        tags: ['qwen3', '32b', 'safetensors', '4-bit', 'tool-calling', 'lora'],
        downloads: 185000,
        likes: 940,
    },
    {
        id: 'Qwen/Qwen2.5-Coder-32B-Instruct-GGUF',
        author: 'Qwen',
        modelName: 'Qwen2.5-Coder-32B-Instruct',
        modality: 'llm',
        format: 'gguf',
        paramsB: 32,
        ramRequiredGb: 22.0,
        trainRamGb: 38.0,
        capabilities: ['coding', 'tools', 'chat'],
        whatItDoes: 'Специализированный архитектор кода: пишет метаданные class.js, формулы POSTINGS, компоненты ODA и тесты',
        recommendedFor: 'Конструктор классов и разработка модулей WORK (от 32 ГБ памяти)',
        tags: ['qwen2.5-coder', '32b', 'gguf', 'coding'],
        downloads: 310000,
        likes: 1450,
    },
    {
        id: 'meta-llama/Llama-3.3-70B-Instruct',
        author: 'meta-llama',
        modelName: 'Llama-3.3-70B-Instruct',
        modality: 'llm',
        format: 'safetensors',
        paramsB: 70,
        ramRequiredGb: 42.0,
        trainRamGb: 64.0,
        capabilities: ['chat', 'tools', 'coding', 'lora'],
        whatItDoes: 'Тяжёлая корпоративная модель 70B для комплексного анализа предприятия и QLoRA-адаптации',
        recommendedFor: 'Для серверов и станций от 64–96+ ГБ памяти',
        tags: ['llama-3.3', '70b', 'safetensors', '4-bit', 'lora'],
        downloads: 290000,
        likes: 1310,
    },
    {
        id: 'peonist-ai/halogen-qwen3.8-flash-next',
        author: 'peonist-ai',
        modelName: 'Qwen3.8-Flash-Next (Halogen Linux ROCm)',
        modality: 'llm',
        format: 'hgn',
        platforms: ['linux'],
        paramsB: 180,
        ramRequiredGb: 112.0,
        trainRamGb: 138.0,
        capabilities: ['chat', 'tools', 'thinking', 'coding', 'vision'],
        whatItDoes: 'Флагманская модель 180B MoE (4.16 bpw + FP8 lookup table) для Linux Strix Halo (halogen-flash-server): 73–94 tok/s decode, 1800 tok/s prefill',
        recommendedFor: 'Только для Linux ПАК WORK на AMD Ryzen AI 495 Pro 192 ГБ RAM',
        tags: ['qwen3', 'qwen3.8', 'halogen', 'strix-halo', 'ryzen-ai', 'gfx1151', 'moe', 'tool-calling', 'vision'],
        downloads: 128000,
        likes: 1890,
    },
    {
        id: 'unsloth/Qwen3.8-Flash-Next-GGUF',
        author: 'unsloth',
        modelName: 'Qwen3.8-Flash-Next (180B MoE · Windows Halowin Bubo)',
        modality: 'llm',
        format: 'gguf',
        platforms: ['win32'],
        buboPackage: true,
        haloNodeName: 'Qwen3.8-Flash-Next',
        paramsB: 180,
        ramRequiredGb: 116.6,
        trainRamGb: 150.0,
        capabilities: ['chat', 'tools', 'thinking', 'coding', 'vision'],
        whatItDoes: 'Флагманская модель 180B MoE (UD-Q4_K_XL + MTP + Dense Twin + Vision) для Windows 11 Strix Halo через встроенный движок Halowin Bubo (ROCm 10.0 gfx1151)',
        recommendedFor: 'Оптимально для Windows 11 на AMD Ryzen AI Max+ PRO 495 (128–192 ГБ)',
        tags: ['qwen3', 'qwen3.8', 'gguf', 'bubo', 'strix-halo', 'ryzen-ai', 'gfx1151', 'moe', 'tool-calling', 'vision'],
        downloads: 142000,
        likes: 1950,
    },
    {
        id: 'Qwen/Qwen3-235B-A22B-GGUF',
        author: 'Qwen',
        modelName: 'Qwen3-235B-A22B MoE',
        modality: 'llm',
        format: 'gguf',
        paramsB: 235,
        ramRequiredGb: 128.0,
        trainRamGb: 156.0,
        capabilities: ['chat', 'tools', 'thinking', 'coding'],
        whatItDoes: 'Флагманский интеллект (235B параметров, 22B активных на шаг) для автономного управления и аудита',
        recommendedFor: 'Для станций с большой единой памятью (160–192+ ГБ RAM)',
        tags: ['qwen3', '235b', 'moe', 'gguf'],
        downloads: 95000,
        likes: 1680,
    },

    // --- ЗРЕНИЕ И ДОКУМЕНТЫ (VLM / OCR) ---
    {
        id: 'Qwen/Qwen2.5-VL-7B-Instruct',
        author: 'Qwen',
        modelName: 'Qwen2.5-VL-7B-Instruct (Vision / OCR)',
        modality: 'vlm',
        format: 'safetensors',
        paramsB: 7,
        ramRequiredGb: 6.2,
        trainRamGb: 11.5,
        capabilities: ['vision', 'chat', 'tools', 'lora'],
        whatItDoes: 'Читает сканы и фото первичных документов (накладные, счета, УПД, чеки, таблицы) и извлекает JSON для проводки',
        recommendedFor: 'Автоматический ввод первички со сканов и фото (от 8–12 ГБ памяти)',
        tags: ['vision', 'vlm', 'ocr', 'image-text-to-text', 'qwen2.5-vl', 'lora'],
        downloads: 275000,
        likes: 1180,
    },
    {
        id: 'Qwen/Qwen2.5-VL-32B-Instruct',
        author: 'Qwen',
        modelName: 'Qwen2.5-VL-32B-Instruct (Vision Pro)',
        modality: 'vlm',
        format: 'safetensors',
        paramsB: 32,
        ramRequiredGb: 22.0,
        trainRamGb: 36.0,
        capabilities: ['vision', 'chat', 'tools', 'thinking', 'lora'],
        whatItDoes: 'Экспертный разбор многостраничных договоров, сложных таблиц, чертежей, скриншотов UI и графиков',
        recommendedFor: 'Точный визуальный аудит и разбор сложных документов (от 32 ГБ памяти)',
        tags: ['vision', 'vlm', 'ocr', 'image-text-to-text', 'qwen2.5-vl', '32b'],
        downloads: 118000,
        likes: 760,
    },

    // --- ИЗОБРАЖЕНИЯ (IMAGE GENERATION) ---
    {
        id: 'Tongyi-MAI/Z-Image-Turbo',
        author: 'Tongyi-MAI',
        modelName: 'Z-Image-Turbo (6B Diffusion)',
        modality: 'image',
        format: 'safetensors',
        paramsB: 6,
        ramRequiredGb: 7.5,
        trainRamGb: 13.0,
        capabilities: ['image', 'lora'],
        whatItDoes: 'Мгновенная генерация иллюстраций, фото товаров для каталога Номенклатуры, иконок и презентационных слайдов',
        recommendedFor: 'Штатный генератор изображений в WORK (от 10–16 ГБ памяти)',
        tags: ['image', 'text-to-image', 'diffusion', 'z-image'],
        downloads: 134000,
        likes: 890,
    },
    {
        id: 'black-forest-labs/FLUX.1-schnell',
        author: 'black-forest-labs',
        modelName: 'FLUX.1-schnell (Fast Image Gen)',
        modality: 'image',
        format: 'safetensors',
        paramsB: 12,
        ramRequiredGb: 11.5,
        trainRamGb: 19.0,
        capabilities: ['image', 'lora'],
        whatItDoes: 'Фотореалистичная генерация изображений высокого разрешения с чёткими надписями всего за 4 шага',
        recommendedFor: 'Быстрая студийная графика и иллюстрации (от 16–24 ГБ памяти)',
        tags: ['image', 'text-to-image', 'flux', 'diffusion'],
        downloads: 520000,
        likes: 2840,
    },
    {
        id: 'stabilityai/sdxl-turbo',
        author: 'stabilityai',
        modelName: 'SDXL-Turbo (Real-Time Image)',
        modality: 'image',
        format: 'safetensors',
        paramsB: 3.5,
        ramRequiredGb: 4.5,
        trainRamGb: 8.5,
        capabilities: ['image', 'lora'],
        whatItDoes: 'Лёгкая генерация изображений за 1–2 шага даже на компьютерах со скромным объёмом памяти',
        recommendedFor: 'Для компактных систем от 8 ГБ памяти',
        tags: ['image', 'text-to-image', 'sdxl'],
        downloads: 410000,
        likes: 1750,
    },

    // --- ЗВУК И РЕЧЬ (AUDIO: ASR / TTS / MUSIC) ---
    {
        id: 'Qwen/Qwen3-ASR-1.7B',
        author: 'Qwen',
        modelName: 'Qwen3-ASR-1.7B (Распознавание речи)',
        modality: 'audio',
        format: 'safetensors',
        paramsB: 1.7,
        ramRequiredGb: 2.0,
        trainRamGb: 4.5,
        capabilities: ['stt', 'lora'],
        whatItDoes: 'Потоковое распознавание русской и английской речи для голосового ввода в задачах, чатах и звонках WORK',
        recommendedFor: 'Штатная модель слуха (ASR / STT) — работает на любом ПК (от 4 ГБ памяти)',
        tags: ['audio', 'asr', 'stt', 'automatic-speech-recognition', 'qwen3-asr'],
        downloads: 98000,
        likes: 540,
    },
    {
        id: 'openai/whisper-large-v3-turbo',
        author: 'openai',
        modelName: 'Whisper Large v3 Turbo (ASR)',
        modality: 'audio',
        format: 'safetensors',
        paramsB: 0.8,
        ramRequiredGb: 2.2,
        trainRamGb: 5.0,
        capabilities: ['stt', 'lora'],
        whatItDoes: 'Высокоточная транскрибация записей видеозвонков, планерок и голосовых заметок на 99 языках с таймкодами',
        recommendedFor: 'Протоколирование звонков и совещаний в подразделениях (от 4 ГБ памяти)',
        tags: ['audio', 'asr', 'stt', 'whisper', 'automatic-speech-recognition'],
        downloads: 680000,
        likes: 2310,
    },
    {
        id: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
        author: 'Qwen',
        modelName: 'Qwen3-TTS-1.7B VoiceDesign (Синтез речи)',
        modality: 'audio',
        format: 'safetensors',
        paramsB: 1.7,
        ramRequiredGb: 2.3,
        trainRamGb: 4.8,
        capabilities: ['tts', 'lora'],
        whatItDoes: 'Озвучивание ответов ИИ-Консультанта и агентов естественным голосом с настройкой интонации и тембра по описанию',
        recommendedFor: 'Штатный голос агентов WORK (TTS) — работает на любом ПК (от 4 ГБ памяти)',
        tags: ['audio', 'tts', 'text-to-speech', 'voice', 'qwen3-tts'],
        downloads: 87000,
        likes: 620,
    },
    {
        id: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        author: 'Qwen',
        modelName: 'Qwen3-TTS-0.6B CustomVoice (Быстрый синтез речи, 9 голосов)',
        modality: 'audio',
        format: 'safetensors',
        paramsB: 0.6,
        ramRequiredGb: 1.2,
        trainRamGb: 2.8,
        capabilities: ['tts', 'voice'],
        whatItDoes: 'Быстрый синтез русской и английской речи с 9 готовыми фиксированными мужскими и женскими голосами (Ryan, Aiden, Dylan, Serena, Vivian)',
        recommendedFor: 'Быстрая озвучка на CPU с фиксированным диктором (в 2.5–3 раза быстрее 1.7B, от 2 ГБ памяти)',
        tags: ['audio', 'tts', 'text-to-speech', 'voice', 'qwen3-tts', 'customvoice'],
        downloads: 64000,
        likes: 510,
    },
    {
        id: 'rhasspy/piper-voices',
        folderName: 'Piper-TTS-RU',
        author: 'rhasspy',
        modelName: 'Piper TTS RU (Мгновенный голос: Дмитрий + Ирина, CPU)',
        modality: 'audio',
        format: 'onnx',
        paramsB: 0.06,
        ramRequiredGb: 0.25,
        trainRamGb: 0.5,
        capabilities: ['tts', 'voice'],
        files: [
            'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx',
            'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx.json',
            'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx',
            'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json',
        ],
        whatItDoes: 'Сверхбыстрый локальный синтез русской речи на CPU (ONNX) за 0.15–0.4 с без нагрузки на GPU',
        recommendedFor: 'Мгновенная озвучка в голосовом режиме WORK (~125 МБ за два русских голоса, работает на любом ПК)',
        tags: ['audio', 'tts', 'text-to-speech', 'voice', 'piper', 'onnx', 'russian'],
        downloads: 920000,
        likes: 2150,
    },
    {
        id: 'snakers4/silero-models',
        folderName: 'Silero-TTS-RU',
        author: 'Silero',
        modelName: 'Silero TTS v5.6 RU (Чистый русский голос: 5 дикторов, CPU)',
        modality: 'audio',
        format: 'pytorch',
        paramsB: 0.06,
        ramRequiredGb: 0.35,
        trainRamGb: 0.6,
        capabilities: ['tts', 'voice'],
        customFiles: [
            {
                name: 'v5_6_ru.pt',
                destRelPath: 'v5_6_ru.pt',
                url: 'https://models.silero.ai/models/tts/ru/v5_6_ru.pt',
                size: 147664410,
            },
        ],
        whatItDoes: 'Чистейшая русская речь с автоударениями, омографами и вопросами за 0.1–0.3 с на CPU (5 дикторов: Айдар, Бая, Ксения, Женя, Евгений)',
        recommendedFor: 'Лучшее качество русского произношения и ударений (~141 МБ, работает на любом ПК без GPU)',
        tags: ['audio', 'tts', 'text-to-speech', 'voice', 'silero', 'russian'],
        downloads: 1200000,
        likes: 3400,
    },
    {
        id: 'hexgrad/Kokoro-82M',
        author: 'hexgrad',
        modelName: 'Kokoro-82M (Ультралёгкий TTS)',
        modality: 'audio',
        format: 'safetensors',
        paramsB: 0.08,
        ramRequiredGb: 0.6,
        trainRamGb: 1.5,
        capabilities: ['tts'],
        whatItDoes: 'Мгновенный синтез чистой речи на CPU без нагрузки на память и видеокарту',
        recommendedFor: 'Сверхбыстрая озвучка уведомлений и ответов (требует <1 ГБ памяти)',
        tags: ['audio', 'tts', 'text-to-speech', 'kokoro'],
        downloads: 340000,
        likes: 1920,
    },
    {
        id: 'facebook/musicgen-medium',
        author: 'facebook',
        modelName: 'MusicGen-Medium (Генерация музыки и звука)',
        modality: 'audio',
        format: 'safetensors',
        paramsB: 1.5,
        ramRequiredGb: 3.5,
        trainRamGb: 7.0,
        capabilities: ['music'],
        whatItDoes: 'Генерация фоновых мелодий, аудио-джинглов и звукового оформления по текстовому описанию',
        recommendedFor: 'Генерация аудио и музыки для презентаций и медиа (от 6 ГБ памяти)',
        tags: ['audio', 'music', 'text-to-audio', 'musicgen'],
        downloads: 175000,
        likes: 980,
    },

    // --- ВИДЕО (VIDEO GENERATION) ---
    {
        id: 'Wan-AI/Wan2.1-T2V-1.3B',
        author: 'Wan-AI',
        modelName: 'Wan2.1-T2V-1.3B (Компактное видео)',
        modality: 'video',
        format: 'safetensors',
        paramsB: 1.3,
        ramRequiredGb: 6.5,
        trainRamGb: 12.0,
        capabilities: ['video', 'lora'],
        whatItDoes: 'Генерация плавных видеороликов 480p по текстовому сценарию или изображению на обычных рабочих ПК',
        recommendedFor: 'Доступная генерация видео для систем от 12–16 ГБ памяти',
        tags: ['video', 'text-to-video', 'image-to-video', 'wan2.1'],
        downloads: 165000,
        likes: 1120,
    },
    {
        id: 'Lightricks/LTX-Video',
        author: 'Lightricks',
        modelName: 'LTX-Video-2B (Быстрое видео)',
        modality: 'video',
        format: 'safetensors',
        paramsB: 2,
        ramRequiredGb: 7.2,
        trainRamGb: 13.5,
        capabilities: ['video', 'lora'],
        whatItDoes: 'Сверхбыстрая генерация видеороликов по тексту и ключевому кадру быстрее реального времени',
        recommendedFor: 'Быстрый видео-продакшн на системах от 12–16 ГБ памяти',
        tags: ['video', 'text-to-video', 'image-to-video', 'ltx-video'],
        downloads: 142000,
        likes: 960,
    },
    {
        id: 'Wan-AI/Wan2.1-T2V-14B',
        author: 'Wan-AI',
        modelName: 'Wan2.1-T2V-14B (Студийное видео 720p)',
        modality: 'video',
        format: 'safetensors',
        paramsB: 14,
        ramRequiredGb: 18.0,
        trainRamGb: 32.0,
        capabilities: ['video', 'lora'],
        whatItDoes: 'Кинематографическая генерация видео 720p со сложной физикой движения, камерой и текстовыми титрами',
        recommendedFor: 'Высококачественная видеогенерация для систем от 24–32+ ГБ памяти',
        tags: ['video', 'text-to-video', 'image-to-video', 'wan2.1', '14b'],
        downloads: 210000,
        likes: 1640,
    },

    // --- ПОИСК И ЭМБЕДДИНГИ (RAG / RERANK) ---
    {
        id: 'BAAI/bge-m3',
        author: 'BAAI',
        modelName: 'BGE-M3 (Мультиязычные эмбеддинги RAG)',
        modality: 'embed',
        format: 'safetensors',
        paramsB: 0.56,
        ramRequiredGb: 1.4,
        trainRamGb: 3.2,
        capabilities: ['embeddings'],
        whatItDoes: 'Строит плотные и разреженные векторные индексы по документам, логам, чатам и справочникам WORK на 100+ языках',
        recommendedFor: 'Семантический поиск RAG в WORK — работает на любом ПК (требует ~1.5 ГБ памяти)',
        tags: ['embeddings', 'rag', 'feature-extraction', 'sentence-similarity', 'bge-m3'],
        downloads: 890000,
        likes: 2150,
    },
    {
        id: 'BAAI/bge-reranker-v2-m3',
        author: 'BAAI',
        modelName: 'BGE-Reranker-v2-M3 (Точный реранкер RAG)',
        modality: 'embed',
        format: 'safetensors',
        paramsB: 0.56,
        ramRequiredGb: 1.4,
        trainRamGb: 3.2,
        capabilities: ['rerank'],
        whatItDoes: 'Повышает точность выдачи корпоративного поиска и контекста для ИИ-Консультанта за счёт кросс-энкодера',
        recommendedFor: 'Второй этап ранжирования в RAG WORK (требует ~1.5 ГБ памяти)',
        tags: ['rerank', 'rag', 'text-ranking', 'bge-reranker'],
        downloads: 420000,
        likes: 1180,
    },
]);

/** Активные и завершённые задачи скачивания с Hugging Face */
const _downloads = new Map();

export function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b <= 0)
        return '—';
    if (b < 1024)
        return `${b} Б`;
    if (b < 1024 * 1024)
        return `${+(b / 1024).toFixed(1)} КБ`;
    if (b < 1024 ** 3)
        return `${+(b / (1024 * 1024)).toFixed(1)} МБ`;
    return `${+(b / (1024 ** 3)).toFixed(2)} ГБ`;
}

export function validateRepoId(repoId) {
    const clean = String(repoId || '').trim().replace(/^https?:\/\/huggingface\.co\//i, '').replace(/\/+$/, '');
    if (!REPO_ID_RE.test(clean) || clean.includes('..'))
        throw new Error(`Некорректный идентификатор репозитория Hugging Face: «${repoId}» (ожидается author/model)`);
    return clean;
}

export function safeModelFolderName(repoId, quant = '') {
    const clean = validateRepoId(repoId);
    const base = clean.split('/')[1] || clean.replace('/', '-');
    const suffix = quant ? `-${String(quant).replace(/[^A-Za-z0-9_.-]/g, '')}` : '';
    return (base + suffix).replace(/[<>:"/\\|?*]/g, '-').slice(0, 80);
}

/**
 * Определить модальность (`modality`), список умений (`capabilities`) и краткое описание возможностей
 * по метаданным репозитория Hugging Face (`pipeline_tag`, `tags`, `id`).
 */
export function inferModalityAndCapabilities(row = {}) {
    const id = String(row.id || row.modelId || '');
    const ptag = String(row.pipeline_tag || '').toLowerCase();
    const tags = (Array.isArray(row.tags) ? row.tags : []).map(t => String(t).toLowerCase());
    const joined = `${id.toLowerCase()} ${ptag} ${tags.join(' ')}`;
    const isGgufRepo = tags.includes('gguf') || /gguf/i.test(id);

    if (
        ptag.includes('video')
        || tags.some(t => /text-to-video|image-to-video|text-to-audio-video|image-to-audio-video|video-generation/i.test(t))
        || /\b(t2v|i2v|t2av|i2av|wan2(?:\.\d+)?|ltx(?:[-_.]?(?:video|2(?:\.\d+)?|v))?|hunyuan[-_.]?video|cogvideox?|mochi[-_.]?1|skyreels|framepack|animatediff)\b/.test(joined)
    ) {
        return {
            modality: 'video',
            capabilities: isGgufRepo ? ['video'] : ['video', 'lora'],
            whatItDoes: 'Генерация и обработка видеороликов по текстовому описанию или кадру',
        };
    }
    if (
        ptag === 'text-to-image'
        || ptag === 'image-to-image'
        || tags.some(t => /text-to-image|image-to-image|diffusion-single-file/i.test(t))
        || /\b(flux|sdxl|stable-diffusion|z-image|qwen-image|sd3\.5|hidream|chroma)\b/.test(joined)
    ) {
        return {
            modality: 'image',
            capabilities: isGgufRepo ? ['image'] : ['image', 'lora'],
            whatItDoes: 'Генерация и редактирование иллюстраций, фотографий и графики по тексту',
        };
    }
    if (ptag === 'automatic-speech-recognition' || /\b(whisper|asr|speech-to-text)\b/.test(joined)) {
        return {
            modality: 'audio',
            capabilities: ['stt', 'lora'],
            whatItDoes: 'Распознавание голоса и транскрибация аудиозаписей/звонков в текст (ASR / STT)',
        };
    }
    if (ptag === 'text-to-speech' || /\b(tts|kokoro|cosyvoice|f5-tts|voicedesign)\b/.test(joined)) {
        return {
            modality: 'audio',
            capabilities: ['tts'],
            whatItDoes: 'Синтез естественной речи и озвучивание ответов голосом (TTS)',
        };
    }
    if (ptag === 'text-to-audio' || ptag === 'audio-to-audio' || /\b(musicgen|audioldm)\b/.test(joined)) {
        return {
            modality: 'audio',
            capabilities: ['music'],
            whatItDoes: 'Генерация музыки, мелодий и звуковых эффектов по текстовому описанию',
        };
    }
    if (ptag === 'image-text-to-text' || ptag === 'visual-question-answering' || /\b(vl|vision|ocr|llava|qwen2\.5-vl)\b/.test(joined)) {
        return {
            modality: 'vlm',
            capabilities: ['vision', 'chat', 'tools', 'lora'],
            whatItDoes: 'Зрение и OCR: разбор сканов документов, накладных, таблиц, чертежей и изображений',
        };
    }
    if (ptag === 'feature-extraction' || ptag === 'sentence-similarity' || /\b(embedding|bge-m3|e5-)\b/.test(joined)) {
        return {
            modality: 'embed',
            capabilities: ['embeddings'],
            whatItDoes: 'Векторные эмбеддинги для семантического поиска по документам и базе знаний (RAG)',
        };
    }
    if (ptag === 'text-ranking' || /\b(rerank|reranker)\b/.test(joined)) {
        return {
            modality: 'embed',
            capabilities: ['rerank'],
            whatItDoes: 'Точное смысловое переранжирование результатов поиска для RAG',
        };
    }

    const caps = ['chat', 'tools'];
    if (/\b(coder|code|starcoder|deepseek-coder)\b/.test(joined))
        caps.push('coding');
    if (/\b(qwen3|r1|reasoning|thinking|qwq)\b/.test(joined))
        caps.push('thinking');
    if (!tags.includes('gguf') && !/gguf/i.test(id))
        caps.push('lora');

    return {
        modality: 'llm',
        capabilities: [...new Set(caps)],
        whatItDoes: caps.includes('coding')
            ? 'Генерация кода, схем классов, правил проводок и работа с инструментами'
            : 'Диалог, аналитика, вызов инструментов WORK и решение бизнес-задач',
    };
}

/**
 * Оценить число миллиардов параметров по названию модели (например `Qwen3-14B` → `14` или `82M` → `0.08`) и требования к памяти.
 */
export function estimateModelMemoryFromId(repoId, format = 'safetensors') {
    const mB = String(repoId || '').match(/(\d+(?:\.\d+)?)\s*[bB]\b/);
    const mM = String(repoId || '').match(/(\d+(?:\.\d+)?)\s*[mM]\b/);
    const paramsB = mB ? Number(mB[1]) : mM ? +(Number(mM[1]) / 1000).toFixed(2) : null;
    if (!paramsB)
        return { paramsB: null, ramRequiredGb: null, trainRamGb: null };
    const is4bit = /4bit|q4|iq4/i.test(repoId) || format === 'gguf';
    const ramRequiredGb = +Math.max(0.5, paramsB * (is4bit ? 0.68 : 1.1)).toFixed(1);
    const trainRamGb = +Math.max(1.2, ramRequiredGb * 1.55 + 1.5).toFixed(1);
    return { paramsB, ramRequiredGb, trainRamGb };
}

/**
 * Оценить совместимость модели с реальным доступным бюджетом памяти машины (`usableMemoryGb`).
 */
export function evaluateModelFit(model, usableMemoryGb = 16) {
    const budget = Number(usableMemoryGb) || 16;
    const infGb = Number(model?.ramRequiredGb) || 0;
    const trnGb = Number(model?.trainRamGb) || (infGb ? +(infGb * 1.55).toFixed(1) : 0);

    if (!infGb) {
        return {
            fit: 'unknown',
            fitLabel: 'Число параметров не указано в названии — размер уточнится при установке',
            canInfer: true,
            canTrain: true,
        };
    }
    if (trnGb <= budget) {
        return {
            fit: 'optimal',
            fitLabel: `Подходит для вашей системы (обучение ~${trnGb} ГБ / запуск ~${infGb} ГБ из ${budget} ГБ)`,
            canInfer: true,
            canTrain: true,
        };
    }
    if (infGb <= budget) {
        return {
            fit: 'inference_only',
            fitLabel: `Доступен запуск (~${infGb} ГБ), для обучения нужно ~${trnGb} ГБ (доступно ${budget} ГБ)`,
            canInfer: true,
            canTrain: false,
        };
    }
    return {
        fit: 'too_large',
        fitLabel: `Недостаточно памяти: требуется ~${infGb} ГБ, доступно ${budget} ГБ`,
        canInfer: false,
        canTrain: false,
    };
}

function hfHeaders(token, targetUrl = '', endpointUrl = HF_ORIGIN) {
    const h = { 'User-Agent': 'WORK-AI-Trainer/2.0' };
    const t = String(token || process.env.HF_TOKEN || '').trim();
    if (t && (!targetUrl || canSendAuthToUrl(targetUrl, endpointUrl)))
        h.Authorization = `Bearer ${t}`;
    return h;
}

function extractQuantTag(filename) {
    const m = String(filename || '').match(/\b(Q[2-8]_[A-Z0-9_]+|IQ[1-4]_[A-Z0-9_]+|F16|BF16|FP16|FP8|bnb-4bit)\b/i);
    return m ? m[1].toUpperCase() : '';
}

export function resolveModelIcon({ repoId = '', modality = 'llm', capabilities = [] } = {}) {
    const id = String(repoId || '').toLowerCase();
    const caps = Array.isArray(capabilities) ? capabilities : [];
    if (caps.includes('stt'))
        return 'carbon:microphone';
    if (caps.includes('tts') || caps.includes('music'))
        return 'carbon:volume-up';
    if (modality === 'video' || caps.includes('video'))
        return 'av:videocam';
    if (modality === 'image' || caps.includes('image'))
        return 'ai:stablediffusion';
    if (modality === 'embed' || caps.includes('embeddings') || caps.includes('rerank'))
        return 'icons:search';
    if (id.includes('qwen'))
        return 'ai:qwen';
    if (id.includes('llama'))
        return 'ai:llama3';
    if (id.includes('deepseek'))
        return 'ai:deepseek';
    if (id.includes('gemma'))
        return 'ai:gemma';
    if (id.includes('mistral'))
        return 'ai:mistral';
    if (id.includes('whisper') || id.includes('gpt'))
        return 'ai:chatgpt';
    if (id.includes('glm'))
        return 'ai:glm';
    return 'ai:ollama';
}

export function assessDiffusionRepoCompatibility({ id = '', modality = 'llm', format = '', tags = [], library_name = '', files = null } = {}) {
    const mod = String(modality || '').toLowerCase();
    if (mod !== 'image' && mod !== 'video')
        return { diffusersCompatible: true, compatibilityNote: '' };
    const lowTags = (Array.isArray(tags) ? tags : []).map(t => String(t).toLowerCase());
    const lib = String(library_name || '').toLowerCase();
    const isGguf = format === 'gguf' || lowTags.includes('gguf') || /gguf/i.test(String(id || ''));

    if (Array.isArray(files) && files.length) {
        const hasModelIndex = files.some(f => String(f?.name || '').toLowerCase() === 'model_index.json');
        const hasWeights = files.some(f => f?.kind === 'gguf' || f?.kind === 'safetensors');
        if (hasWeights && !hasModelIndex) {
            return {
                diffusersCompatible: false,
                compatibilityNote: 'Чекпоинт формата ComfyUI / single-file / GGUF без model_index.json (пайплайна Diffusers) — не запускается автономно в WORK. Выберите полноценную модель Diffusers (Z-Image-Turbo, Lightricks/LTX-Video, Wan2.1-T2V).',
            };
        }
        return { diffusersCompatible: true, compatibilityNote: '' };
    }

    if (lib === 'diffusion-single-file' || lowTags.includes('diffusion-single-file') || lowTags.includes('comfyui') || isGguf) {
        return {
            diffusersCompatible: false,
            compatibilityNote: 'Чекпоинт формата ComfyUI / single-file / GGUF без пайплайна Diffusers — не запускается автономно в WORK. Выберите полноценную модель Diffusers (Z-Image-Turbo, Lightricks/LTX-Video, Wan2.1-T2V).',
        };
    }
    return { diffusersCompatible: true, compatibilityNote: '' };
}

function decorateModelCard(m, usableMemoryGb) {
    const fitInfo = evaluateModelFit(m, usableMemoryGb);
    const modDef = MODEL_MODALITIES.find(x => x.id === m.modality) || MODEL_MODALITIES[1];
    const capabilityBadges = (m.capabilities || []).map(cid => MODEL_CAPABILITIES[cid] || { id: cid, label: cid, desc: '' });
    const icon = m.icon || resolveModelIcon({ repoId: m.id, modality: m.modality, capabilities: m.capabilities });
    const diffCompat = m.curated
        ? { diffusersCompatible: true, compatibilityNote: '' }
        : assessDiffusionRepoCompatibility(m);
    return {
        ...m,
        icon,
        modalityLabel: modDef.shortLabel,
        capabilityBadges,
        ...fitInfo,
        ...diffCompat,
        recommendedForHost: fitInfo.fit === 'optimal' && diffCompat.diffusersCompatible,
    };
}

/**
 * Поиск моделей на Hugging Face Hub с фильтрацией по типу (`modality`), умению (`capability`), формату (`filter`) и памяти машины.
 */
export async function searchHuggingFaceModels({
    query = '',
    modality = 'all',
    capability = '',
    filter = '',
    limit = 25,
    token = '',
    usableMemoryGb = 24,
    platform = os.platform(),
    rootDir = process.cwd(),
    endpointUrl,
    proxyUrl,
    fetchImpl = globalThis.fetch,
} = {}) {
    const q = String(query || '').trim();
    const qLower = q.toLowerCase();
    const modLower = String(modality || 'all').trim().toLowerCase();
    const capLower = String(capability || '').trim().toLowerCase();
    const fLower = String(filter || '').trim().toLowerCase();

    const curatedMatches = CURATED_HF_MODELS.filter(m => {
        if (Array.isArray(m.platforms) && m.platforms.length && !m.platforms.includes(platform))
            return false;
        if (platform === 'win32' && (m.format === 'hgn' || m.format === 'hnpw' || /^peonist-ai\/halogen-/i.test(m.id)))
            return false;
        if (modLower && modLower !== 'all' && m.modality !== modLower)
            return false;
        if (capLower && capLower !== 'all' && !(m.capabilities || []).includes(capLower))
            return false;
        if (qLower && !m.id.toLowerCase().includes(qLower) && !m.modelName.toLowerCase().includes(qLower) && !String(m.whatItDoes || '').toLowerCase().includes(qLower) && !m.recommendedFor.toLowerCase().includes(qLower))
            return false;
        if (fLower && fLower !== 'all') {
            if (fLower === 'fit') {
                const fit = evaluateModelFit(m, usableMemoryGb);
                return fit.canInfer;
            }
            if (!m.tags.some(t => t.toLowerCase().includes(fLower)) && m.format !== fLower)
                return false;
        }
        return true;
    }).map(m => decorateModelCard({ ...m, curated: true }, usableMemoryGb));

    curatedMatches.sort((a, b) => {
        const score = x => (x.fit === 'optimal' ? 2 : x.fit === 'inference_only' ? 1 : 0);
        if (score(b) !== score(a))
            return score(b) - score(a);
        return (b.likes || 0) - (a.likes || 0);
    });

    if (typeof fetchImpl !== 'function') {
        return { items: curatedMatches.slice(0, limit), source: 'curated', usableMemoryGb };
    }

    try {
        const netCfg = loadTrainerNetworkSettings(rootDir);
        const effEndpoint = normalizeEndpointUrl(endpointUrl || netCfg.endpointUrl || HF_ORIGIN);
        const effProxy = proxyUrl !== undefined ? proxyUrl : (fetchImpl === globalThis.fetch ? netCfg.proxyUrl : '');
        const effToken = token || netCfg.token || '';
        const netFetch = createNetworkFetch({ proxyUrl: effProxy, fetchImpl });

        const params = new URLSearchParams();
        if (q)
            params.set('search', q);
        const modObj = MODEL_MODALITIES.find(x => x.id === modLower);
        if (filter && filter !== 'all' && filter !== 'fit')
            params.set('filter', filter);
        else if (modObj?.hfPipeline)
            params.set('filter', modObj.hfPipeline);
        params.set('sort', 'downloads');
        params.set('direction', '-1');
        params.set('limit', String(Math.min(50, Math.max(5, Number(limit) || 25))));

        const url = `${effEndpoint}/api/models?${params.toString()}`;
        const res = await netFetch(url, {
            headers: { Accept: 'application/json', ...hfHeaders(effToken, url, effEndpoint) },
            signal: AbortSignal.timeout?.(10000),
        });
        if (!res.ok)
            return { items: curatedMatches.slice(0, limit), source: 'curated', usableMemoryGb, warning: `HF API HTTP ${res.status}` };

        const data = await res.json();
        const seen = new Set(curatedMatches.map(m => m.id));
        const remoteItems = [];
        for (const row of Array.isArray(data) ? data : []) {
            const id = String(row.id || row.modelId || '').trim();
            if (!id || seen.has(id))
                continue;
            const tags = Array.isArray(row.tags) ? row.tags : [];
            if (platform === 'win32' && (/^peonist-ai\/halogen-/i.test(id) || tags.includes('halogen') || tags.includes('halogen-flash')))
                continue;
            seen.add(id);
            const isGguf = tags.includes('gguf') || /gguf/i.test(id);
            const format = isGguf ? 'gguf' : 'safetensors';
            const est = estimateModelMemoryFromId(id, format);
            const inferred = inferModalityAndCapabilities(row);
            if (modLower && modLower !== 'all' && inferred.modality !== modLower)
                continue;
            if (capLower && capLower !== 'all' && !inferred.capabilities.includes(capLower))
                continue;

            const item = decorateModelCard({
                id,
                author: id.split('/')[0] || row.author || '',
                modelName: id.split('/')[1] || id,
                modality: inferred.modality,
                capabilities: inferred.capabilities,
                whatItDoes: inferred.whatItDoes,
                format,
                library_name: row.library_name || '',
                paramsB: est.paramsB,
                ramRequiredGb: est.ramRequiredGb,
                trainRamGb: est.trainRamGb,
                recommendedFor: row.pipeline_tag || inferred.whatItDoes,
                tags: tags.slice(0, 12),
                downloads: Number(row.downloads) || 0,
                likes: Number(row.likes) || 0,
                curated: false,
            }, usableMemoryGb);
            if (fLower === 'fit' && !item.canInfer)
                continue;
            remoteItems.push(item);
        }
        return {
            items: [...curatedMatches, ...remoteItems].slice(0, limit),
            source: 'huggingface',
            usableMemoryGb,
        };
    }
    catch (err) {
        return {
            items: curatedMatches.slice(0, limit),
            source: 'curated',
            usableMemoryGb,
            warning: String(err?.message || err),
        };
    }
}

/**
 * Получить список файлов репозитория модели на Hugging Face, их размеры и варианты квантизации.
 */
export async function inspectHuggingFaceRepo(repoId, {
    revision = 'main',
    token = '',
    usableMemoryGb = 24,
    rootDir = process.cwd(),
    endpointUrl,
    proxyUrl,
    fetchImpl = globalThis.fetch,
} = {}) {
    const cleanId = validateRepoId(repoId);
    const curated = CURATED_HF_MODELS.find(m => m.id.toLowerCase() === cleanId.toLowerCase()) || null;

    if (typeof fetchImpl === 'function') {
        try {
            const netCfg = loadTrainerNetworkSettings(rootDir);
            const effEndpoint = normalizeEndpointUrl(endpointUrl || netCfg.endpointUrl || HF_ORIGIN);
            const effProxy = proxyUrl !== undefined ? proxyUrl : (fetchImpl === globalThis.fetch ? netCfg.proxyUrl : '');
            const effToken = token || netCfg.token || '';
            const netFetch = createNetworkFetch({ proxyUrl: effProxy, fetchImpl });

            const url = `${effEndpoint}/api/models/${cleanId}?blobs=true`;
            const res = await netFetch(url, {
                headers: { Accept: 'application/json', ...hfHeaders(effToken, url, effEndpoint) },
                signal: AbortSignal.timeout?.(12000),
            });
            if (res.ok) {
                const info = await res.json();
                const siblings = Array.isArray(info?.siblings) ? info.siblings : [];
                const files = siblings
                    .map(s => {
                        const name = String(s.rfilename || s.path || '');
                        const size = Number(s.size ?? s.lfs?.size ?? 0);
                        const quant = extractQuantTag(name);
                        return {
                            name,
                            size,
                            sizeGb: +(size / (1024 ** 3)).toFixed(2),
                            sizeFormatted: formatBytes(size),
                            kind: classifyRepoFileKind(name),
                            quant,
                        };
                    })
                    .filter(f => isUsefulRepoFile(f.name));

                const quants = [...new Set(files.filter(f => f.kind === 'gguf' && f.quant).map(f => f.quant))];
                const totalWeightBytes = files
                    .filter(f => f.kind === 'gguf' || f.kind === 'safetensors')
                    .reduce((acc, f) => acc + f.size, 0);
                const totalWeightGb = +(totalWeightBytes / (1024 ** 3)).toFixed(2) || curated?.ramRequiredGb || 0;
                const inferred = curated || inferModalityAndCapabilities(info);
                const fitInfo = evaluateModelFit({ ramRequiredGb: totalWeightGb, trainRamGb: +(totalWeightGb * 1.5).toFixed(1) }, usableMemoryGb);
                const capabilityBadges = (inferred.capabilities || []).map(cid => MODEL_CAPABILITIES[cid] || { id: cid, label: cid, desc: '' });
                const icon = resolveModelIcon({ repoId: info.id || cleanId, modality: inferred.modality, capabilities: inferred.capabilities });
                const diffCompat = curated
                    ? { diffusersCompatible: true, compatibilityNote: '' }
                    : assessDiffusionRepoCompatibility({
                        id: info.id || cleanId,
                        modality: inferred.modality,
                        format: quants.length ? 'gguf' : 'safetensors',
                        tags: info.tags || [],
                        library_name: info.library_name || '',
                        files,
                    });

                return {
                    id: info.id || cleanId,
                    icon,
                    revision: String(revision || 'main'),
                    modality: inferred.modality || 'llm',
                    capabilities: inferred.capabilities || ['chat'],
                    capabilityBadges,
                    whatItDoes: inferred.whatItDoes || '',
                    pipeline: info.pipeline_tag || 'text-generation',
                    downloads: Number(info.downloads) || curated?.downloads || 0,
                    likes: Number(info.likes) || curated?.likes || 0,
                    files,
                    quants,
                    totalWeightGb,
                    ...fitInfo,
                    ...diffCompat,
                    curated,
                };
            }
        }
        catch { /* fallback ниже */ }
    }

    const est = curated || estimateModelMemoryFromId(cleanId, /gguf/i.test(cleanId) ? 'gguf' : 'safetensors');
    const inferred = curated || inferModalityAndCapabilities({ id: cleanId });
    const baseGb = est?.ramRequiredGb || 10;
    const fallbackFiles = (curated?.format === 'gguf' || /gguf/i.test(cleanId))
        ? [
            { name: `${cleanId.split('/')[1]}-Q8_0.gguf`, size: Math.round(baseGb * (1024 ** 3)), sizeGb: baseGb, sizeFormatted: `${baseGb} ГБ`, kind: 'gguf', quant: 'Q8_0' },
            { name: `${cleanId.split('/')[1]}-Q4_K_M.gguf`, size: Math.round(baseGb * 0.58 * (1024 ** 3)), sizeGb: +(baseGb * 0.58).toFixed(2), sizeFormatted: `${+(baseGb * 0.58).toFixed(2)} ГБ`, kind: 'gguf', quant: 'Q4_K_M' },
        ]
        : [
            { name: 'config.json', size: 1420, sizeGb: 0, sizeFormatted: '1.4 КБ', kind: 'config', quant: '' },
            { name: 'tokenizer.json', size: 7420000, sizeGb: 0.01, sizeFormatted: '7.1 МБ', kind: 'config', quant: '' },
            { name: 'model.safetensors', size: Math.round(baseGb * (1024 ** 3)), sizeGb: baseGb, sizeFormatted: `${baseGb} ГБ`, kind: 'safetensors', quant: 'BNB-4BIT' },
        ];
    const fitInfo = evaluateModelFit({ ramRequiredGb: baseGb, trainRamGb: est?.trainRamGb || +(baseGb * 1.55).toFixed(1) }, usableMemoryGb);
    const capabilityBadges = (inferred.capabilities || []).map(cid => MODEL_CAPABILITIES[cid] || { id: cid, label: cid, desc: '' });
    const icon = resolveModelIcon({ repoId: cleanId, modality: inferred.modality, capabilities: inferred.capabilities });

    return {
        id: cleanId,
        icon,
        revision: String(revision || 'main'),
        modality: inferred.modality || 'llm',
        capabilities: inferred.capabilities || ['chat'],
        capabilityBadges,
        whatItDoes: inferred.whatItDoes || '',
        pipeline: 'text-generation',
        downloads: curated?.downloads || 0,
        likes: curated?.likes || 0,
        files: fallbackFiles,
        quants: fallbackFiles.filter(f => f.quant).map(f => f.quant),
        totalWeightGb: baseGb,
        ...fitInfo,
        curated,
    };
}

const CONFIG_FILE_EXTENSIONS = ['.json', '.txt', '.model', '.tiktoken', '.jinja', '.yaml', '.yml', '.py'];

/**
 * Классификация файла репозитория HF по расширению (без `\b`-ловушек):
 * - `safetensors` включает `.onnx_data` (внешние тензоры ONNX), `.bin`, `.pt`, `.pth`, `.hgn`, `.hnpw`;
 * - `config` — ВСЕ `.json` (`model_index.json`, `*.index.json`, `preprocessor_config.json`,
 *   `scheduler_config.json`, …), `.txt`, `.model`, `.tiktoken`, `.jinja` — в том числе в подпапках
 *   Diffusers (`transformer/`, `vae/`, `text_encoder/`, `tokenizer/`, `scheduler/`) и токенизаторов.
 */
export function classifyRepoFileKind(name) {
    const ext = path.extname(String(name || '')).toLowerCase();
    if (ext === '.gguf')
        return 'gguf';
    if (['.safetensors', '.bin', '.hgn', '.hnpw', '.onnx', '.onnx_data', '.pt', '.pth'].includes(ext))
        return 'safetensors';
    if (CONFIG_FILE_EXTENSIONS.includes(ext))
        return 'config';
    return 'other';
}

/** Отсеять служебный мусор репозитория (README, лицензии, картинки, git-служебное). */
export function isUsefulRepoFile(name) {
    const n = String(name || '');
    if (!n)
        return false;
    if (/^\.git/i.test(n) || /^\.gitattributes$/i.test(n))
        return false;
    if (/(^|\/)(README|LICENSE|NOTICE|CHANGELOG|CODE_OF_CONDUCT)(\.|$)/i.test(n))
        return false;
    if (/\.(md|png|jpg|jpeg|gif|svg|webp|bmp|mp4|webm|lock|ipynb)$/i.test(n))
        return false;
    return true;
}

/** Безопасный относительный путь файла репозитория (сохраняет подпапки `speech_tokenizer/`, `transformer/`, `onnx/`, …). */
export function safeRepoDestRel(name) {
    return String(name || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(p => p && p !== '.' && p !== '..')
        .join('/');
}

/**
 * Выбрать список файлов репозитория для скачивания (либо явно переданные `files`,
 * либо подходящий `.gguf` по `quant`, либо `config` + веса).
 */
export function selectFilesToDownload(repoMeta, { files = null, quant = '', modality = '' } = {}) {
    const all = Array.isArray(repoMeta?.files) ? repoMeta.files : [];
    if (Array.isArray(files) && files.length) {
        const wanted = new Set(files.map(String));
        return all.filter(f => wanted.has(f.name));
    }
    const ggufs = all.filter(f => f.kind === 'gguf');
    if (ggufs.length) {
        const q = String(quant || 'Q8_0').toUpperCase();
        const byQuant = ggufs.filter(f => f.quant === q || f.name.toUpperCase().includes(q));
        if (byQuant.length)
            return byQuant;
        const q4 = ggufs.filter(f => f.quant === 'Q4_K_M' || /Q4_K_M/i.test(f.name));
        return q4.length ? q4 : [ggufs[0]];
    }
    // Для репозиториев Halogen (.hgn) не качаем устаревшие дублирующие чекпоинты (w4b, ht43, mtp) —
    // выбираем только актуальный v2 + ngram + drafter-r2 + vision + конфиги/токенизатор (~112 ГБ вместо 308 ГБ).
    const hgnFiles = all.filter(f => f.name.toLowerCase().endsWith('.hgn'));
    if (hgnFiles.length) {
        const hasV2 = hgnFiles.some(f => /v2\.hgn$/i.test(f.name));
        if (hasV2) {
            return all.filter(f => {
                const low = f.name.toLowerCase();
                if (low.endsWith('.hgn')) {
                    return /-(v2|ngram|drafter-r2|vision)\.hgn$/i.test(low);
                }
                return f.kind === 'config' || low.includes('tokenizer') || low === 'vocab.json' || low === 'merges.txt' || low.endsWith('.jinja');
            });
        }
    }

    // Прочие Halogen-репозитории с весами Linux (.hgn/.hnpw) без «v2»: берём их целиком + конфиги.
    const halogenWeights = all.filter(f => /\.(hgn|hnpw)$/i.test(f.name));
    if (halogenWeights.length) {
        return all.filter(f =>
            /\.(hgn|hnpw)$/i.test(f.name)
            || f.kind === 'config'
            || /tokenizer|vocab|merges|\.jinja/i.test(f.name));
    }

    const configs = all.filter(f => f.kind === 'config');
    const safetensors = all.filter(f => /\.safetensors$/i.test(f.name));
    const torchBins = all.filter(f => /\.(bin|pt|pth)$/i.test(f.name));
    const onnxModels = all.filter(f => /\.onnx$/i.test(f.name));
    const onnxData = all.filter(f => /\.onnx_data$/i.test(f.name));
    const mod = String(modality || repoMeta?.modality || '').toLowerCase();
    const onnxWithData = onnxModels.filter(m => onnxData.some(d => d.name === `${m.name}_data`));

    // Шардированные и обычные чекпоинты (включая BGE-M3 и BGE-Reranker):
    // единый стек PyTorch ROCm 7.13 использует safetensors + конфиги без ONNX/DirectML.
    if (safetensors.length)
        return all.filter(f => f.kind === 'config' || /\.safetensors$/i.test(f.name));
    if (torchBins.length)
        return all.filter(f => f.kind === 'config' || /\.(bin|pt|pth)$/i.test(f.name));
    // Self-contained ONNX как крайний вариант, если в репозитории нет PyTorch-весов.
    if (onnxModels.length)
        return all.filter(f => f.kind === 'config' || /\.onnx(_data)?$/i.test(f.name));
    return configs;
}

/**
 * Зарегистрировать локальную модель как дочерний узел `$ai` внутри `/MODELS/Local/<folderName>`
 * с учётом её реального типа (`modality`) и умений (`capabilities`).
 */
export async function registerLocalModelNode({
    rootDir = process.cwd(),
    folderName,
    label,
    repoId,
    model = '',
    protocol = '',
    icon: customIcon = '',
    modality = 'llm',
    capabilities = null,
    efforts = null,
    weightsDir,
    primaryFile = '',
    baseModel = '',
    adapterPath = '',
    maxTokens = 16384,
    maxOutput = 8192,
    baseUrl = 'http://127.0.0.1:8731/v1/chat/completions',
} = {}) {
    const safeName = String(folderName || safeModelFolderName(repoId || label || 'Local-Model')).replace(/[<>:"/\\|?*]/g, '-');
    const aiDir = path.join(rootDir, 'MODELS', 'Local', safeName, '$ai');
    await fsp.mkdir(aiDir, { recursive: true });

    const inferred = inferModalityAndCapabilities({ id: repoId || safeName });
    const defaultCaps = modality === 'image' ? ['image']
        : modality === 'video' ? ['video']
        : modality === 'embed' ? ['embeddings']
        : modality === 'vlm' ? ['chat', 'stream', 'vision', 'functions']
        : modality === 'audio' ? (inferred.capabilities?.length ? inferred.capabilities : ['tts'])
        : ['chat', 'stream', 'functions'];
    const rawCaps = Array.isArray(capabilities) && capabilities.length ? capabilities : defaultCaps;
    const resolvedCaps = [...new Set([
        ...rawCaps,
        ...(rawCaps.includes('chat') && !rawCaps.includes('stream') ? ['stream'] : []),
        ...(rawCaps.includes('tools') && !rawCaps.includes('functions') ? ['functions'] : []),
    ])];
    const icon = customIcon || resolveModelIcon({ repoId: repoId || safeName, modality, capabilities: resolvedCaps });

    const effModLow = String(modality || 'llm').toLowerCase();
    const supportsGgufChat = !['video', 'image', 'audio', 'embed'].includes(effModLow);
    const resolvedProtocol = protocol || (supportsGgufChat && String(primaryFile || '').endsWith('.gguf') ? 'openai' : 'local');
    const cleanBaseUrl = resolvedProtocol === 'local'
        ? ''
        : ((baseUrl === null || baseUrl === 'null')
            ? ''
            : (typeof baseUrl === 'string' && baseUrl.trim()
                ? baseUrl.trim()
                : 'http://127.0.0.1:8731/v1/chat/completions'));

    const meta = {
        label: String(label || safeName),
        icon,
        protocol: resolvedProtocol,
        baseUrl: cleanBaseUrl,
        model: model || repoId || safeName,
        modality,
        maxTokens: Number(maxTokens) || 16384,
        maxOutput: Number(maxOutput) || 8192,
        functionCalling: resolvedCaps.includes('tools') || resolvedCaps.includes('functions'),
        capabilities: resolvedCaps,
        ...(Array.isArray(efforts) && efforts.length ? { efforts } : {}),
        hfRepo: repoId || '',
        weightsDir: weightsDir ? path.relative(rootDir, weightsDir).replace(/\\/g, '/') : '',
        primaryFile: primaryFile || '',
        ...(baseModel ? { baseModel } : {}),
        ...(adapterPath ? { adapterPath: path.relative(rootDir, adapterPath).replace(/\\/g, '/') } : {}),
    };

    const classJs = `/**
 * Локальная модель ИИ: ${meta.label} (${modality})
 * Репозиторий Hugging Face: ${meta.hfRepo || 'локальный'}
 */
export default ${JSON.stringify(meta, null, 4)};
`;
    const classFile = path.join(aiDir, 'class.js');
    await fsp.writeFile(classFile, classJs, 'utf-8');
    return {
        folderName: safeName,
        modelPath: `/MODELS/Local/${safeName}`,
        classFile,
        meta,
    };
}

const DOWNLOAD_STATE_FILE = 'download-state.json';
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryableDownloadError(err) {
    if (!err)
        return false;
    if (err.httpStatus && RETRYABLE_HTTP_STATUSES.has(err.httpStatus))
        return true;
    if (err.httpStatus && err.httpStatus >= 400 && err.httpStatus < 500)
        return false;
    const msg = [
        err?.message,
        err?.code,
        err?.name,
        err?.cause?.message,
        err?.cause?.code,
        err?.cause?.name,
    ].filter(Boolean).join(' ') || String(err);
    if (/Unexpected URL|Некорректн|отменена/i.test(msg))
        return false;
    return err.retryable === true
        || /ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|UND_ERR_|ERR_HTTP2_|ResponseContentLengthMismatch|content[- ]length|length does not match|network|fetch failed|terminated|aborted|socket|premature/i.test(msg);
}

async function writeDownloadStateSafe(stagingDir, job, extra = {}) {
    try {
        await fsp.mkdir(stagingDir, { recursive: true });
        const payload = {
            repoId: job.repoId,
            label: job.label,
            modality: job.modality,
            capabilities: job.capabilities,
            revision: job.revision,
            providerFolder: job.providerFolder,
            folderName: job.folderName,
            endpointUrl: job.endpointUrl || HF_ORIGIN,
            sourceLabel: job.sourceLabel || describeSourceLabel(job.endpointUrl || HF_ORIGIN),
            threads: Number(job.threads) || 1,
            registerInWork: extra.registerInWork !== false,
            nodeMeta: extra.nodeMeta || null,
            customFilesDir: extra.customFilesDir || '',
            buboFinalize: Boolean(extra.buboFinalize),
            files: (job.files || []).map(f => ({
                name: f.name,
                ...(f.url ? { url: f.url } : {}),
                ...(f.destRelPath ? { destRelPath: f.destRelPath } : {}),
                size: Number(f.size) || 0,
                downloaded: Number(f.downloaded) || 0,
                done: Boolean(f.done),
                ranges: Array.isArray(f.ranges) ? f.ranges : [],
            })),
            totalBytes: Number(job.totalBytes) || 0,
            downloadedBytes: Number(job.downloadedBytes) || 0,
            avgSpeedMBs: Number(job.avgSpeedMBs) || 0,
            stats: {
                baseBytes: Math.max(0, Number(job.statsBaseBytes) || 0),
                activeMs: Math.max(0, Math.round(Number(job.statsActiveMs) || 0)),
            },
            status: job.status,
            error: job.error || null,
            updatedAt: Date.now(),
        };
        const tmp = path.join(stagingDir, `${DOWNLOAD_STATE_FILE}.tmp`);
        await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
        await fsp.rename(tmp, path.join(stagingDir, DOWNLOAD_STATE_FILE));
    }
    catch { /* ignore state write error */ }
}

function waitAbortable(ms, signal) {
    if (ms <= 0)
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('Загрузка приостановлена пользователем'));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Загрузка приостановлена пользователем'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * Запустить прямую загрузку модели с Hugging Face в `MODELS/Local/<Имя>/#weights/`
 * с поддержкой докачки (`Range`), авто-ретраев при обрывах, паузы без потери скачанного и авто-созданием узла `$ai`.
 */
/**
 * Время до конца загрузки. Базой служит устойчивая средняя скорость за всё время
 * скачивания, а не мгновенный 5-секундный замер: при просадке канала мгновенная
 * скорость занижает ETA в десятки раз (например, «осталось 318 ч» при 16 % за 3 ч).
 */
export function computeDownloadEta({ remainingBytes = 0, avgBytesPerSec = 0, shortBytesPerSec = 0 } = {}) {
    const remaining = Math.max(0, Number(remainingBytes) || 0);
    const avg = Number(avgBytesPerSec) || 0;
    const short = Number(shortBytesPerSec) || 0;
    if (remaining <= 0)
        return 0;
    const basis = avg >= 1024 ? avg : short;
    if (basis <= 1024)
        return null;
    return Math.round(remaining / basis);
}

export async function startHuggingFaceDownload({
    repoId,
    files = null,
    customFiles = null,
    customFilesDir = '',
    onComplete = null,
    quant = 'Q8_0',
    revision = 'main',
    token = '',
    platform = os.platform(),
    rootDir = process.cwd(),
    providerFolder = 'Local',
    targetNodeName = '',
    nodeMeta = null,
    registerInWork = true,
    waitForCompletion = false,
    maxRetries = 20,
    retryBaseDelayMs = 3000,
    idleTimeoutMs,
    endpointUrl,
    proxyUrl,
    threads,
    parallelFiles,
    fetchImpl = globalThis.fetch,
} = {}) {
    const cleanId = validateRepoId(repoId);
    const safeProvider = String(providerFolder || 'Local').replace(/[<>:"/\\|?*]/g, '-');

    if (platform === 'win32' && /^peonist-ai\/halogen-/i.test(cleanId)) {
        throw new Error(`Репозиторий ${cleanId} содержит веса формата Linux (.hgn/.hnpw), которые не поддерживаются на Windows. Для Windows используйте нативный стек Halowin Bubo (GGUF) или .safetensors.`);
    }

    // Если эта модель уже скачивается прямо сейчас — возвращаем активную задачу без дублирования
    for (const entry of _downloads.values()) {
        if (
            entry.job.status === 'downloading'
            && entry.job.providerFolder === safeProvider
            && (entry.job.repoId === cleanId || (targetNodeName && entry.job.folderName === targetNodeName))
        ) {
            return { ...entry.job };
        }
    }

    const netCfg = loadTrainerNetworkSettings(rootDir);
    const effEndpoint = normalizeEndpointUrl(endpointUrl || netCfg.endpointUrl || HF_ORIGIN);
    const effProxy = proxyUrl !== undefined ? proxyUrl : (fetchImpl === globalThis.fetch ? netCfg.proxyUrl : '');
    const effThreads = threads !== undefined ? Math.min(16, Math.max(1, Math.round(Number(threads) || 1))) : netCfg.threads;
    const effParallelFiles = parallelFiles !== undefined ? Math.min(4, Math.max(1, Math.round(Number(parallelFiles) || 1))) : netCfg.parallelFiles;
    const effToken = token || netCfg.token || '';
    const netFetch = createNetworkFetch({ proxyUrl: effProxy, fetchImpl });

    let repoMeta = { modality: nodeMeta?.modality || 'llm', capabilities: nodeMeta?.capabilities || ['chat'], files: [] };
    let selected = [];
    if (Array.isArray(customFiles) && customFiles.length) {
        selected = customFiles.map(cf => ({
            name: String(cf.name || ''),
            url: String(cf.url || ''),
            destRelPath: String(cf.destRelPath || path.basename(cf.name || '')),
            size: Number(cf.size) || 0,
            kind: /\.gguf$/i.test(cf.name || '') ? 'gguf' : 'safetensors',
        }));
    }
    else {
        repoMeta = await inspectHuggingFaceRepo(cleanId, {
            revision,
            token: effToken,
            rootDir,
            endpointUrl: effEndpoint,
            proxyUrl: effProxy,
            fetchImpl,
        });
        if (repoMeta.diffusersCompatible === false && !files?.length) {
            throw new Error(repoMeta.compatibilityNote || `Репозиторий ${cleanId} содержит single-file/ComfyUI веса без пайплайна Diffusers.`);
        }
        selected = selectFilesToDownload(repoMeta, { files, quant, modality: nodeMeta?.modality || repoMeta.modality });
    }
    if (!selected.length)
        throw new Error(`В репозитории ${cleanId} не найдено подходящих файлов весов (.gguf / .safetensors)`);

    const hasLinuxOnlyWeights = selected.some(f => LINUX_ONLY_HALOGEN_EXT_RE.test(f.name));
    const hasCrossPlatformWeights = selected.some(f => /\.(gguf|safetensors)$/i.test(f.name));
    if (platform === 'win32' && hasLinuxOnlyWeights && !hasCrossPlatformWeights) {
        throw new Error(`В репозитории ${cleanId} найдены только веса Linux (.hgn/.hnpw), несовместимые с Windows.`);
    }

    const folderName = targetNodeName
        ? String(targetNodeName).replace(/[<>:"/\\|?*]/g, '-')
        : safeModelFolderName(cleanId, quant && selected.some(f => f.kind === 'gguf') ? quant : '');

    migrateLocalModelsLayoutSync(rootDir, { skipModels: new Set([folderName]) });

    const modelDir = getModelDir(rootDir, folderName, safeProvider);
    const weightsDir = getModelWeightsDir(rootDir, folderName, safeProvider);
    const stagingDir = weightsDir;
    const filesRootDir = customFilesDir ? path.resolve(rootDir, customFilesDir) : stagingDir;
    const customFilesDirRel = customFilesDir ? path.relative(rootDir, filesRootDir).replace(/\\/g, '/') : '';
    const primary = selected.find(f => f.name.endsWith('.gguf'))?.name
        || selected.find(f => f.name.endsWith('.safetensors') || f.name.endsWith('.hgn') || f.name.endsWith('.hnpw'))?.name
        || selected[0]?.name || '';

    const displayLabel = nodeMeta?.label
        || `${cleanId.split('/')[1] || cleanId}${quant && primary.endsWith('.gguf') ? ' (' + quant + ')' : ''}`;

    await fsp.mkdir(weightsDir, { recursive: true });
    if (filesRootDir !== stagingDir)
        await fsp.mkdir(filesRootDir, { recursive: true });

    // Если осталась недокачанная старая папка в #downloads/<folderName>, аккуратно перенесём её в $ai/#weights
    const legacyStaging = path.join(rootDir, 'MODELS', safeProvider, '#downloads', folderName);
    if (fs.existsSync(legacyStaging))
        migrateLocalModelsLayoutSync(rootDir);

    // Создаём узел $ai/class.js сразу внутри папки модели (неактивен, пока веса не докачаны)
    if (registerInWork && safeProvider === 'Local') {
        await registerLocalModelNode({
            rootDir,
            folderName,
            label: displayLabel,
            repoId: cleanId,
            model: nodeMeta?.model || '',
            protocol: nodeMeta?.protocol || '',
            icon: nodeMeta?.icon || '',
            modality: nodeMeta?.modality || repoMeta.modality || 'llm',
            capabilities: nodeMeta?.capabilities || repoMeta.capabilities || ['chat'],
            efforts: nodeMeta?.efforts || null,
            maxTokens: nodeMeta?.maxTokens,
            maxOutput: nodeMeta?.maxOutput,
            baseUrl: nodeMeta?.baseUrl,
            weightsDir,
            primaryFile: path.basename(primary),
        });
    }

    // Читаем предыдущий download-state.json (если был), чтобы не потерять карту диапазонов при докачке
    let prevState = {};
    const stateFilePath = path.join(stagingDir, DOWNLOAD_STATE_FILE);
    if (fs.existsSync(stateFilePath)) {
        try { prevState = JSON.parse(await fsp.readFile(stateFilePath, 'utf-8')) || {}; }
        catch { /* ignore */ }
    }
    const prevFilesMap = new Map((Array.isArray(prevState.files) ? prevState.files : []).map(pf => [pf.name, pf]));

    // Убираем старые завершённые/паузовые записи для той же папки из памяти
    for (const [k, entry] of _downloads.entries()) {
        if (entry.job.status !== 'downloading' && entry.job.providerFolder === safeProvider && entry.job.folderName === folderName)
            _downloads.delete(k);
    }

    const jobFiles = [];
    for (const f of selected) {
        const size = Number(f.size) || 0;
        // Сохраняем структуру репозитория (`speech_tokenizer/`, `transformer/`, `vae/`, `onnx/`, …),
        // иначе одноимённые config.json/model.safetensors из подпапок затирают корневые файлы.
        const destRelPath = f.destRelPath || safeRepoDestRel(f.name);
        const stagedFile = path.join(filesRootDir, destRelPath);
        const partFile = stagedFile + '.part';
        let downloaded = 0;
        let done = false;
        let ranges = [];
        try {
            const stDone = await fsp.stat(stagedFile);
            if (stDone.isFile() && stDone.size > 0 && (!size || stDone.size === size)) {
                downloaded = stDone.size;
                done = true;
                ranges = [[0, downloaded]];
            }
        }
        catch { /* ещё не завершён */ }
        if (!done) {
            try {
                const stPart = await fsp.stat(partFile);
                if (stPart.isFile()) {
                    const prevF = prevFilesMap.get(f.name);
                    if (Array.isArray(prevF?.ranges) && prevF.ranges.length) {
                        ranges = mergeRanges(prevF.ranges);
                        downloaded = sumRangesBytes(ranges);
                    }
                    else {
                        // Совместимость со старым однопоточным .part: считаем [0, size) уже готовым!
                        downloaded = stPart.size;
                        ranges = downloaded > 0 ? [[0, downloaded]] : [];
                    }
                }
            }
            catch { /* .part ещё нет */ }
        }
        jobFiles.push({
            name: f.name,
            ...(f.url ? { url: f.url } : {}),
            destRelPath,
            size: size || (done ? downloaded : 0),
            downloaded,
            done,
            ranges,
        });
    }

    const jobId = 'hf_' + crypto.randomUUID().slice(0, 8);
    const totalBytes = jobFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0);
    const initialDownloaded = jobFiles.reduce((acc, f) => acc + (Number(f.downloaded) || 0), 0);
    const initialProgress = totalBytes > 0 ? Math.min(99, Math.round((initialDownloaded / totalBytes) * 100)) : 0;
    const controller = new AbortController();
    let keepFilesOnAbort = true;

    // Статистика для честного ETA: база (уже скачано до старта) и накопленное «активное» время.
    // Переживает паузы и перезапуски сервера — хранится в download-state.json.
    const prevStats = (prevState && typeof prevState.stats === 'object' && prevState.stats) || null;
    const statsBaseBytes = prevStats && Number.isFinite(Number(prevStats.baseBytes))
        ? Number(prevStats.baseBytes)
        : initialDownloaded;
    const statsActiveMs = Math.max(0, Number(prevStats?.activeMs) || 0);

    const job = {
        id: jobId,
        repoId: cleanId,
        label: displayLabel,
        modality: nodeMeta?.modality || repoMeta.modality || 'llm',
        capabilities: nodeMeta?.capabilities || repoMeta.capabilities || ['chat'],
        revision: String(revision || 'main'),
        providerFolder: safeProvider,
        folderName,
        rootDir,
        stagingDir,
        weightsDir,
        filesRootDir,
        customFilesDir: customFilesDirRel,
        endpointUrl: effEndpoint,
        sourceLabel: describeSourceLabel(effEndpoint),
        threads: effThreads,
        usingProxy: Boolean(effProxy),
        lowSpeedWarning: false,
        status: 'downloading',
        files: jobFiles,
        currentFile: (jobFiles.find(f => !f.done) || jobFiles[0])?.name || '',
        downloadedBytes: initialDownloaded,
        totalBytes,
        progress: initialProgress,
        speedMBs: 0,
        avgSpeedMBs: 0,
        etaSeconds: null,
        lastDataAt: Date.now(),
        statsBaseBytes,
        statsActiveMs,
        retryAttempt: 0,
        retryError: '',
        startedAt: Date.now(),
        finishedAt: null,
        modelPath: `/MODELS/${safeProvider}/${folderName}`,
        error: null,
    };
    const entryMeta = {
        job,
        controller,
        nodeMeta,
        registerInWork,
        quant,
        files,
        customFiles: Array.isArray(customFiles) && customFiles.length ? customFiles : null,
        customFilesDir: customFilesDirRel,
        onComplete,
        fetchImpl,
        runPromise: null,
        setKeepFiles: (v) => { keepFilesOnAbort = Boolean(v); },
    };
    _downloads.set(jobId, entryMeta);
    await writeDownloadStateSafe(stagingDir, job, { nodeMeta, registerInWork, customFilesDir: customFilesDirRel, buboFinalize: Boolean(onComplete) });

    const runPromise = (async () => {
        const t0 = Date.now();
        const speedSamples = [];
        let lastStateSave = Date.now();
        let lastDataAt = Date.now();
        let downloadFinished = false;
        let stateWriteChain = Promise.resolve();

        const scheduleStateSave = () => {
            if (downloadFinished)
                return;
            stateWriteChain = stateWriteChain.then(() => {
                if (downloadFinished)
                    return;
                return writeDownloadStateSafe(weightsDir, job, { nodeMeta, registerInWork, customFilesDir: customFilesDirRel, buboFinalize: Boolean(onComplete) });
            }).catch(() => {});
        };

        const updateMetrics = (deltaBytes = 0) => {
            const now = Date.now();
            if (deltaBytes > 0) {
                speedSamples.push([now, deltaBytes]);
                // Копим «активное» время передачи данных (простои ограничиваем минутой),
                // чтобы средняя скорость отражала реальный темп, а не 5-секундный всплеск.
                const gap = lastDataAt ? now - lastDataAt : 0;
                job.statsActiveMs = (Number(job.statsActiveMs) || 0) + Math.min(60000, Math.max(0, gap));
                lastDataAt = now;
                job.lastDataAt = now;
            }
            const cutoff = now - 5000;
            while (speedSamples.length && speedSamples[0][0] < cutoff)
                speedSamples.shift();

            job.downloadedBytes = job.files.reduce((acc, f) => acc + (Number(f.downloaded) || 0), 0);
            job.totalBytes = job.files.reduce((acc, f) => acc + (Number(f.size) || 0), 0);
            if (job.totalBytes > 0)
                job.progress = Math.min(99, Math.round((job.downloadedBytes / job.totalBytes) * 100));

            let windowBytes = 0;
            for (const [, b] of speedSamples)
                windowBytes += b;
            const spanSec = speedSamples.length
                ? Math.max(0.5, (now - Math.min(speedSamples[0][0], now - 500)) / 1000)
                : Math.max(0.5, (now - t0) / 1000);
            const bytesPerSec = windowBytes / spanSec;
            job.speedMBs = +(bytesPerSec / (1024 * 1024)).toFixed(2);

            // Устойчивая средняя скорость с начала загрузки (переживает паузы и рестарты)
            const newBytes = Math.max(0, job.downloadedBytes - (Number(job.statsBaseBytes) || 0));
            const activeMs = Number(job.statsActiveMs) || 0;
            const avgBytesPerSec = activeMs >= 3000 ? newBytes / (activeMs / 1000) : 0;
            job.avgSpeedMBs = +(avgBytesPerSec / (1024 * 1024)).toFixed(2);

            job.etaSeconds = computeDownloadEta({
                remainingBytes: job.totalBytes - job.downloadedBytes,
                avgBytesPerSec,
                shortBytesPerSec: bytesPerSec,
            });

            const activeSec = (now - t0) / 1000;
            const effectiveMBs = job.avgSpeedMBs > 0 ? job.avgSpeedMBs : job.speedMBs;
            job.lowSpeedWarning = activeSec >= 15 && effectiveMBs > 0 && effectiveMBs < 2 && !job.retryAttempt;

            if (now - lastStateSave >= 1500) {
                lastStateSave = now;
                scheduleStateSave();
            }
        };

        try {
            const pendingQueue = job.files.filter(f => !f.done);
            const workerCount = Math.min(effParallelFiles, Math.max(1, pendingQueue.length));
            // Делим потоки между одновременно качаемыми файлами, но минимум 1 поток на файл
            const perFileThreads = pendingQueue.length > 1 && effParallelFiles > 1
                ? Math.max(1, Math.min(effThreads, Math.ceil(effThreads / Math.min(2, pendingQueue.length)) + 1))
                : effThreads;
            let fileFatalErr = null;

            const processFile = async (fileEntry) => {
                if (controller.signal.aborted)
                    throw new Error('Загрузка приостановлена пользователем');
                job.currentFile = fileEntry.name;
                const destRelPath = fileEntry.destRelPath || path.basename(fileEntry.name);
                const stagedFile = path.join(filesRootDir, destRelPath);
                await fsp.mkdir(path.dirname(stagedFile), { recursive: true });
                const partFile = stagedFile + '.part';
                let url;
                if (fileEntry.url) {
                    url = String(fileEntry.url).replace(/^https:\/\/huggingface\.co(?=\/)/i, effEndpoint);
                }
                else {
                    const encodedPath = fileEntry.name.split('/').map(encodeURIComponent).join('/');
                    url = `${effEndpoint}/${cleanId}/resolve/${encodeURIComponent(job.revision)}/${encodedPath}`;
                }
                const headers = hfHeaders(effToken, url, effEndpoint);

                const res = await downloadFileMultipart({
                    url,
                    stagedFile,
                    partFile,
                    expectedSize: Number(fileEntry.size) || 0,
                    headers,
                    threads: perFileThreads,
                    initialRanges: fileEntry.ranges,
                    signal: controller.signal,
                    maxRetries,
                    retryBaseDelayMs,
                    idleTimeoutMs,
                    fetchImpl: netFetch,
                    onProgress: ({ downloadedBytes, totalBytes: fTotal, deltaBytes, ranges }) => {
                        if (fTotal > 0 && !fileEntry.size)
                            fileEntry.size = fTotal;
                        fileEntry.downloaded = downloadedBytes;
                        fileEntry.ranges = ranges;
                        job.retryAttempt = 0;
                        job.retryError = '';
                        updateMetrics(deltaBytes);
                    },
                    onRetry: ({ attempt, error }) => {
                        job.retryAttempt = attempt;
                        job.retryError = error;
                        scheduleStateSave();
                    },
                });

                fileEntry.size = fileEntry.size || res.size;
                fileEntry.downloaded = fileEntry.size || res.size;
                fileEntry.ranges = res.ranges;
                fileEntry.done = true;
                updateMetrics(0);
            };

            const fileWorkers = [];
            for (let fw = 0; fw < workerCount; fw++) {
                fileWorkers.push((async () => {
                    while (!fileFatalErr && !controller.signal.aborted) {
                        const nextFile = pendingQueue.shift();
                        if (!nextFile)
                            break;
                        try {
                            await processFile(nextFile);
                        }
                        catch (err) {
                            if (!fileFatalErr)
                                fileFatalErr = err;
                        }
                    }
                })());
            }
            await Promise.all(fileWorkers);
            if (fileFatalErr)
                throw fileFatalErr;
            if (controller.signal.aborted)
                throw new Error('Загрузка приостановлена пользователем');

            // Скачивание шло сразу в `$ai/#weights/` — перенос между папками не требуется;
            // дожидаемся завершения фоновых записей состояния, удаляем служебный файл и пишем итоговый манифест.
            downloadFinished = true;
            await stateWriteChain;
            await fsp.rm(path.join(weightsDir, DOWNLOAD_STATE_FILE), { force: true }).catch(() => {});

            const manifestFile = path.join(weightsDir, 'hf-manifest.json');
            await fsp.writeFile(manifestFile, JSON.stringify({
                repoId: cleanId,
                modality: job.modality,
                capabilities: job.capabilities,
                revision: job.revision,
                downloadedAt: new Date().toISOString(),
                files: job.files,
            }, null, 2), 'utf-8');

            if (registerInWork && safeProvider === 'Local') {
                await registerLocalModelNode({
                    rootDir,
                    folderName,
                    label: displayLabel,
                    repoId: cleanId,
                    model: nodeMeta?.model || '',
                    protocol: nodeMeta?.protocol || '',
                    icon: nodeMeta?.icon || '',
                    modality: job.modality,
                    capabilities: job.capabilities,
                    efforts: nodeMeta?.efforts || null,
                    maxTokens: nodeMeta?.maxTokens,
                    maxOutput: nodeMeta?.maxOutput,
                    baseUrl: nodeMeta?.baseUrl,
                    weightsDir: filesRootDir,
                    primaryFile: nodeMeta?.primaryFile || path.basename(primary),
                });
            }

            if (typeof onComplete === 'function') {
                job.currentFile = 'Настройка встроенного движка…';
                await onComplete({ job, weightsDir, filesRootDir, rootDir });
            }
            else if (
                fetchImpl === globalThis.fetch
                && process.env.WORK_DISABLE_AUTO_PYTHON !== '1'
                && job.files.some(f => /\.(safetensors|onnx|bin|pt|pth)$/i.test(String(f?.name || '')))
            ) {
                job.currentFile = 'Подготовка среды Python и библиотек…';
                try {
                    const capsLow = (Array.isArray(job.capabilities) ? job.capabilities : []).map(c => String(c).toLowerCase());
                    const depMod = capsLow.includes('rerank') || /rerank/i.test(cleanId) ? 'rerank'
                        : capsLow.includes('music') ? 'music'
                        : capsLow.includes('tts') ? 'tts'
                        : (capsLow.includes('stt') || capsLow.includes('asr')) ? 'stt'
                        : (capsLow.includes('video') || job.modality === 'video') ? 'video'
                        : capsLow.includes('image') ? 'image'
                        : (capsLow.includes('embeddings') || job.modality === 'embed') ? 'embed'
                        : 'llm';
                    const { ensurePythonForModality } = await import('./local-engine.js');
                    await ensurePythonForModality(depMod, { weightsDir, rootDir });
                }
                catch { /* при отсутствии PyPI веса остаются готовыми и докачают пакеты при первом вызове */ }
            }

            job.progress = 100;
            job.etaSeconds = 0;
            job.status = 'completed';
            job.finishedAt = Date.now();
            try {
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
                const modelsRoot = await globalThis.WORK?.get_item?.('/MODELS');
                modelsRoot?.reset?.();
            }
            catch { /* ignore */ }
        }
        catch (err) {
            downloadFinished = true;
            await stateWriteChain;
            if (controller.signal.aborted) {
                job.status = keepFilesOnAbort ? 'paused' : 'cancelled';
                job.error = keepFilesOnAbort ? null : String(err?.message || err);
            }
            else {
                job.status = 'failed';
                job.error = String(err?.message || err);
            }
            job.etaSeconds = null;
            job.finishedAt = Date.now();
            if (controller.signal.aborted && !keepFilesOnAbort) {
                await fsp.rm(path.join(weightsDir, DOWNLOAD_STATE_FILE), { force: true }).catch(() => {});
                for (const fileEntry of job.files)
                    await fsp.rm(path.join(filesRootDir, fileEntry.destRelPath || path.basename(fileEntry.name)) + '.part', { force: true }).catch(() => {});
                if (!hasReadyWeightFilesSync(weightsDir))
                    await fsp.rm(modelDir, { recursive: true, force: true }).catch(() => {});
            }
            else {
                await writeDownloadStateSafe(weightsDir, job, { nodeMeta, registerInWork });
            }
        }
    })();
    entryMeta.runPromise = runPromise;

    if (waitForCompletion)
        await runPromise;

    return { ...job };
}

export function getHuggingFaceDownload(jobId) {
    const entry = _downloads.get(String(jobId || ''));
    return entry ? { ...entry.job } : null;
}

export function listHuggingFaceDownloads(rootDir = process.cwd()) {
    const resolvedRoot = path.resolve(rootDir);
    const now = Date.now();
    const inMemory = [..._downloads.values()]
        .filter(e => path.resolve(e.job.rootDir || process.cwd()) === resolvedRoot)
        .map(e => {
            const snapshot = { ...e.job };
            const idleSec = Math.max(0, Math.round((now - Number(e.job.lastDataAt || e.job.startedAt || now)) / 1000));
            snapshot.idleSec = idleSec;
            snapshot.stalled = e.job.status === 'downloading' && idleSec >= 20;
            if (snapshot.stalled) {
                snapshot.speedMBs = 0;
                snapshot.lowSpeedWarning = false;
            }
            return snapshot;
        });
    const activeNames = new Set(inMemory.filter(j => j.status === 'downloading').map(j => j.folderName));
    migrateLocalModelsLayoutSync(rootDir, { skipModels: activeNames });

    const seenFolders = new Set(inMemory.map(j => `${j.providerFolder}:${j.folderName}`));

    // Подхватываем незавершённые загрузки из метапапок моделей: MODELS/Local/<Модель>/$ai/#weights/
    const localRoot = localRootDir(rootDir);
    if (fs.existsSync(localRoot)) {
        try {
            const entries = fs.readdirSync(localRoot, { withFileTypes: true });
            for (const e of entries) {
                if (!e.isDirectory() || e.name.startsWith('$') || e.name.startsWith('#') || e.name === 'models')
                    continue;
                if (seenFolders.has(`Local:${e.name}`))
                    continue;
                const folderDir = getModelWeightsDir(rootDir, e.name, 'Local');
                if (!fs.existsSync(folderDir))
                    continue;
                const stateFile = path.join(folderDir, DOWNLOAD_STATE_FILE);
                const hasStateFile = fs.existsSync(stateFile);
                let state = {};
                if (hasStateFile) {
                    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')); }
                    catch { /* ignore */ }
                }
                const dirFiles = fs.readdirSync(folderDir, { withFileTypes: true });
                const hasParts = dirFiles.some(f => f.isFile() && f.name.endsWith('.part'));
                if (!hasStateFile && !hasParts)
                    continue;
                if (state.status === 'completed' && !hasParts)
                    continue;

                const stateFilesMap = new Map((Array.isArray(state.files) ? state.files : []).map(sf => [sf.name, sf]));
                let diskBytes = 0;
                const parsedFiles = [];
                for (const f of dirFiles) {
                    if (!f.isFile() || f.name === DOWNLOAD_STATE_FILE || f.name === 'hf-manifest.json' || f.name.endsWith('.tmp'))
                        continue;
                    try {
                        const st = fs.statSync(path.join(folderDir, f.name));
                        const baseName = f.name.replace(/\.part$/, '');
                        const isPart = f.name.endsWith('.part');
                        const sf = stateFilesMap.get(baseName);
                        let downloaded = st.size || 0;
                        if (isPart && sf) {
                            if (Array.isArray(sf.ranges) && sf.ranges.length)
                                downloaded = sumRangesBytes(sf.ranges);
                            else if (Number(sf.downloaded) > 0)
                                downloaded = Math.min(downloaded || Number(sf.downloaded), Number(sf.downloaded));
                        }
                        diskBytes += downloaded;
                        parsedFiles.push({
                            name: baseName,
                            size: Number(sf?.size) || st.size || 0,
                            downloaded,
                            done: !isPart,
                            ranges: sf?.ranges || [],
                        });
                    }
                    catch { /* ignore */ }
                }
                if (diskBytes <= 0 && Array.isArray(state.files)) {
                    for (const sf of state.files) {
                        diskBytes += Number(sf?.downloaded) || 0;
                    }
                }
                if (diskBytes <= 0 && !state.repoId)
                    continue;
                const totalBytes = Number(state.totalBytes) || 0;
                const progress = totalBytes > 0 ? Math.min(99, Math.round((diskBytes / totalBytes) * 100)) : 0;
                inMemory.push({
                    id: `disk_${e.name}`,
                    repoId: state.repoId || '',
                    label: state.label || e.name,
                    modality: state.modality || 'llm',
                    capabilities: state.capabilities || ['chat'],
                    revision: state.revision || 'main',
                    providerFolder: 'Local',
                    folderName: e.name,
                    endpointUrl: state.endpointUrl || HF_ORIGIN,
                    sourceLabel: state.sourceLabel || describeSourceLabel(state.endpointUrl || HF_ORIGIN),
                    threads: Number(state.threads) || 1,
                    status: state.status === 'failed' ? 'failed' : 'paused',
                    files: Array.isArray(state.files) && state.files.length ? state.files : parsedFiles,
                    currentFile: parsedFiles[0]?.name || '',
                    downloadedBytes: diskBytes,
                    totalBytes,
                    progress,
                    speedMBs: 0,
                    avgSpeedMBs: Number(state.avgSpeedMBs) || 0,
                    etaSeconds: null,
                    idleSec: 0,
                    stalled: false,
                    startedAt: state.updatedAt || Date.now(),
                    finishedAt: state.updatedAt || Date.now(),
                    modelPath: `/MODELS/Local/${e.name}`,
                    error: state.error || null,
                    nodeMeta: state.nodeMeta || null,
                    canResume: true,
                    onDiskOnly: true,
                });
            }
        }
        catch { /* ignore */ }
    }

    return inMemory.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function pauseHuggingFaceDownload(jobId) {
    const entry = _downloads.get(String(jobId || ''));
    if (!entry)
        return null;
    entry.setKeepFiles?.(true);
    entry.controller.abort();
    entry.job.status = 'paused';
    entry.job.etaSeconds = null;
    entry.job.finishedAt = Date.now();
    writeDownloadStateSafe(entry.job.stagingDir, entry.job, {
        nodeMeta: entry.nodeMeta,
        registerInWork: entry.registerInWork,
        customFilesDir: entry.customFilesDir || '',
        buboFinalize: Boolean(entry.onComplete),
    });
    return { ...entry.job };
}

export async function discardHuggingFaceDownload({ jobId = '', folderName = '', rootDir = process.cwd() } = {}) {
    const key = String(jobId || '');
    const entry = key ? _downloads.get(key) : null;
    let targetFolder = String(folderName || entry?.job?.folderName || '').replace(/[<>:"/\\|?*]/g, '').trim();
    if (entry) {
        entry.setKeepFiles?.(false);
        if (entry.job.status === 'downloading')
            entry.controller.abort();
        entry.job.status = 'cancelled';
        _downloads.delete(key);
    }
    if (!targetFolder && key.startsWith('disk_'))
        targetFolder = key.slice(5);
    if (targetFolder) {
        const weightsDir = getModelWeightsDir(rootDir, targetFolder, 'Local');
        let customDirAbs = entry?.customFilesDir ? path.resolve(rootDir, entry.customFilesDir) : '';
        if (!customDirAbs && fs.existsSync(path.join(weightsDir, DOWNLOAD_STATE_FILE))) {
            try {
                const st = JSON.parse(await fsp.readFile(path.join(weightsDir, DOWNLOAD_STATE_FILE), 'utf-8'));
                if (st?.customFilesDir)
                    customDirAbs = path.resolve(rootDir, st.customFilesDir);
            }
            catch { /* ignore */ }
        }
        if (customDirAbs && fs.existsSync(customDirAbs)) {
            await fsp.rm(customDirAbs, { recursive: true, force: true }).catch(() => {});
        }
        if (fs.existsSync(weightsDir)) {
            await fsp.rm(path.join(weightsDir, DOWNLOAD_STATE_FILE), { force: true }).catch(() => {});
            const files = await fsp.readdir(weightsDir).catch(() => []);
            for (const f of files) {
                if (f.endsWith('.part') || f.endsWith('.tmp'))
                    await fsp.rm(path.join(weightsDir, f), { force: true }).catch(() => {});
            }
            if (!hasReadyWeightFilesSync(weightsDir))
                await fsp.rm(getModelDir(rootDir, targetFolder, 'Local'), { recursive: true, force: true }).catch(() => {});
        }
        const legacyDir = path.join(rootDir, 'MODELS', 'Local', '#downloads', targetFolder);
        await fsp.rm(legacyDir, { recursive: true, force: true }).catch(() => {});
    }
    return { ok: true, discarded: targetFolder || key };
}

export async function resumeHuggingFaceDownload({
    jobId = '',
    folderName = '',
    repoId = '',
    files = null,
    customFiles = null,
    customFilesDir = '',
    onComplete = null,
    quant = 'Q8_0',
    token = '',
    nodeMeta = null,
    rootDir = process.cwd(),
    endpointUrl,
    proxyUrl,
    threads,
    parallelFiles,
    fetchImpl = globalThis.fetch,
} = {}) {
    const key = String(jobId || '');
    const entry = key ? _downloads.get(key) : null;
    const cleanFolder = String(folderName || entry?.job?.folderName || (key.startsWith('disk_') ? key.slice(5) : '')).trim();
    if (cleanFolder)
        migrateLocalModelsLayoutSync(rootDir, { skipModels: new Set() });

    let state = {};
    if (cleanFolder) {
        const stateFile = path.join(getModelWeightsDir(rootDir, cleanFolder, 'Local'), DOWNLOAD_STATE_FILE);
        if (fs.existsSync(stateFile)) {
            try { state = JSON.parse(await fsp.readFile(stateFile, 'utf-8')); }
            catch { /* ignore */ }
        }
    }
    const resolvedRepo = repoId || entry?.job?.repoId || state.repoId;
    if (!resolvedRepo)
        throw new Error(`Не удалось определить репозиторий Hugging Face для докачки «${cleanFolder || key}»`);

    const stateHasCustomUrls = Array.isArray(state.files) && state.files.some(f => f?.url || f?.destRelPath);
    const resolvedCustomFiles = customFiles ?? entry?.customFiles ?? (stateHasCustomUrls ? state.files : null);
    const rawCustomDir = customFilesDir || entry?.customFilesDir || state.customFilesDir || '';
    const resolvedCustomDir = /^MODELS[\\/]+Local[\\/]+models([\\/]|$)/i.test(rawCustomDir) ? '' : rawCustomDir;
    const stateFileNames = Array.isArray(state.files) && state.files.length
        ? state.files.map(f => f?.name).filter(Boolean)
        : null;

    return startHuggingFaceDownload({
        repoId: resolvedRepo,
        files: files ?? entry?.files ?? stateFileNames ?? null,
        customFiles: resolvedCustomFiles,
        customFilesDir: resolvedCustomDir,
        onComplete: onComplete || entry?.onComplete || null,
        quant: quant || entry?.quant || 'Q8_0',
        revision: entry?.job?.revision || state.revision || 'main',
        token,
        rootDir,
        providerFolder: entry?.job?.providerFolder || state.providerFolder || 'Local',
        targetNodeName: cleanFolder,
        nodeMeta: nodeMeta || entry?.nodeMeta || state.nodeMeta || null,
        registerInWork: entry?.registerInWork ?? state.registerInWork ?? true,
        endpointUrl,
        proxyUrl,
        threads,
        parallelFiles,
        fetchImpl: fetchImpl || entry?.fetchImpl || globalThis.fetch,
    });
}

/**
 * Бесшовно перезапустить все активные загрузки после изменения сетевых настроек
 * (новый источник/зеркало, прокси или число потоков) с сохранением скачанных диапазонов.
 */
export async function restartActiveHuggingFaceDownloads({ rootDir = '' } = {}) {
    const active = [..._downloads.values()].filter(e =>
        e?.job?.status === 'downloading'
        && (!rootDir || path.resolve(e.job.rootDir || '') === path.resolve(rootDir))
    );
    const restarted = [];
    for (const entry of active) {
        const snapshot = {
            jobId: entry.job.id,
            folderName: entry.job.folderName,
            repoId: entry.job.repoId,
            files: entry.files ?? null,
            customFiles: entry.customFiles ?? null,
            customFilesDir: entry.customFilesDir || '',
            onComplete: entry.onComplete || null,
            quant: entry.quant || 'Q8_0',
            nodeMeta: entry.nodeMeta || null,
            rootDir: entry.job.rootDir || process.cwd(),
            fetchImpl: entry.fetchImpl || globalThis.fetch,
        };
        pauseHuggingFaceDownload(entry.job.id);
        try {
            await entry.runPromise;
        }
        catch { /* остановка по паузе — ожидаема */ }
        const resumed = await resumeHuggingFaceDownload(snapshot);
        restarted.push(resumed);
    }
    return restarted;
}

/**
 * На старте сервера автоматически подхватить загрузки, которые находились в статусе
 * `downloading` на момент аварийного завершения предыдущего процесса.
 * Паузы, поставленные пользователем (`paused`), не трогает.
 */
export async function resumeInterruptedDownloads({
    rootDir = process.cwd(),
    fetchImpl = globalThis.fetch,
} = {}) {
    migrateLocalModelsLayoutSync(rootDir);
    const localRoot = localRootDir(rootDir);
    if (!fs.existsSync(localRoot))
        return [];

    const resumed = [];
    let entries = [];
    try {
        entries = fs.readdirSync(localRoot, { withFileTypes: true });
    }
    catch {
        return [];
    }

    for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('$') || e.name.startsWith('#') || e.name === 'models')
            continue;
        const weightsDir = getModelWeightsDir(rootDir, e.name, 'Local');
        const stateFile = path.join(weightsDir, DOWNLOAD_STATE_FILE);
        if (!fs.existsSync(stateFile))
            continue;
        let state = null;
        try {
            state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        }
        catch { continue; }
        if (state?.status !== 'downloading' || !state?.repoId)
            continue;
        if (os.platform() === 'win32' && /^peonist-ai\/halogen-/i.test(String(state.repoId))) {
            try {
                state.status = 'failed';
                state.error = 'Веса формата Linux (.hgn/.hnpw) не поддерживаются на Windows. Сбросьте эту загрузку и установите Windows-версию (Halowin Bubo GGUF).';
                fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
            }
            catch { /* ignore */ }
            continue;
        }
        try {
            const job = await resumeHuggingFaceDownload({
                folderName: e.name,
                rootDir,
                fetchImpl,
            });
            resumed.push(job);
        }
        catch (err) {
            console.warn(`[trainer] не удалось авто-возобновить загрузку «${e.name}»:`, err?.message || err);
        }
    }
    return resumed;
}

export function cancelHuggingFaceDownload(jobId, { keepFiles = false } = {}) {
    const entry = _downloads.get(String(jobId || ''));
    if (!entry)
        return null;
    entry.setKeepFiles?.(Boolean(keepFiles));
    entry.controller.abort();
    entry.job.status = keepFiles ? 'paused' : 'cancelled';
    entry.job.etaSeconds = null;
    entry.job.finishedAt = Date.now();
    return { ...entry.job };
}

/** Прочитать метаданные локальной модели из `MODELS/<Провайдер>/<Модель>/$ai/class.js`. */
export function readLocalModelMetaSync(rootDir = process.cwd(), folderName = '', providerFolder = 'Local') {
    const safeName = String(folderName || '').trim();
    if (!safeName)
        return null;
    const aiDir = path.join(rootDir, 'MODELS', String(providerFolder || 'Local'), safeName, '$ai');
    const classFile = path.join(aiDir, 'class.js');
    if (!fs.existsSync(classFile))
        return null;
    try {
        const raw = fs.readFileSync(classFile, 'utf-8');
        const m = raw.match(/export\s+default\s+(\{[\s\S]*\})\s*;?\s*$/);
        const meta = JSON.parse(m ? m[1] : raw) || {};
        return {
            ...meta,
            aiDir,
            classFile,
            weightsDir: path.join(aiDir, '#weights'),
        };
    }
    catch {
        return null;
    }
}

function listFilesRecursiveSync(dir, maxDepth = 5, base = dir, depth = 0, acc = []) {
    if (depth > maxDepth || !dir || !fs.existsSync(dir))
        return acc;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return acc; }
    for (const ent of entries) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            listFilesRecursiveSync(abs, maxDepth, base, depth + 1, acc);
        }
        else if (ent.isFile() && !/\.(part|tmp)$/i.test(ent.name)) {
            acc.push(path.relative(base, abs).replace(/\\/g, '/'));
        }
    }
    return acc;
}

/**
 * Быстрая (без сети) проверка целостности раскладки `$ai/#weights`.
 * Ловит типовые последствия старого сплющивания подпапок и пропущенных файлов:
 * перезаписанный `config.json` токенизатором, отсутствие `model_index.json` (Diffusers),
 * отсутствие индекса шардов и внешних данных ONNX (`*.onnx_data`).
 */
export function detectBrokenWeightsLayout(weightsDir) {
    const reasons = [];
    if (!weightsDir || !fs.existsSync(weightsDir))
        return { broken: false, reasons, files: [] };
    const files = listFilesRecursiveSync(weightsDir);
    const hasRel = (rel) => files.includes(rel);
    const rootConfig = path.join(weightsDir, 'config.json');
    if (fs.existsSync(rootConfig)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(rootConfig, 'utf-8')) || {};
            const mt = String(cfg.model_type || '');
            if (/_tokenizer|speech_tokenizer/i.test(mt) && !fs.existsSync(path.join(weightsDir, 'speech_tokenizer')))
                reasons.push(`config.json содержит конфиг токенизатора (model_type: ${mt}) вместо основной модели`);
            else if (cfg._class_name || cfg._diffusers_version)
                reasons.push('config.json содержит конфиг компонента Diffusers вместо model_index.json');
        }
        catch {
            reasons.push('config.json повреждён (некорректный JSON)');
        }
    }
    const hasShards = files.some(f => /(^|\/)[\w.-]+-\d{5}-of-(?!00001\.)\d{5}\.safetensors$/i.test(f));
    if (hasShards && !files.some(f => /\.safetensors\.index\.json$/i.test(f)))
        reasons.push('есть шарды весов, но нет индекса *.safetensors.index.json');
    const onnxFiles = files.filter(f => /\.onnx$/i.test(f));
    const hasPiperConfig = onnxFiles.some(rel => hasRel(`${rel}.json`));
    if (onnxFiles.length && !hasPiperConfig && !files.some(f => /\.onnx_data$/i.test(f))) {
        let graphSmall = false;
        for (const rel of onnxFiles) {
            try {
                const st = fs.statSync(path.join(weightsDir, rel));
                if (st.size > 0 && st.size < 512 * 1024 * 1024)
                    graphSmall = true;
            }
            catch { /* ignore */ }
        }
        if (graphSmall)
            reasons.push('ONNX-граф без внешних данных *.onnx_data');
    }
    const componentDirs = ['transformer', 'vae', 'text_encoder', 'tokenizer', 'scheduler', 'unet']
        .filter(d => fs.existsSync(path.join(weightsDir, d)));
    if (componentDirs.length >= 2 && !hasRel('model_index.json'))
        reasons.push('нет model_index.json при наличии компонентов Diffusers');

    // Проверка полноты подпапок Diffusers (Z-Image-Turbo и др.): если model_index.json уже есть,
    // но веса компонентов (transformer/, text_encoder/, vae/) всё ещё лежат в корне или не разложены.
    const modelIndexPath = path.join(weightsDir, 'model_index.json');
    if (fs.existsSync(modelIndexPath)) {
        try {
            const idx = JSON.parse(fs.readFileSync(modelIndexPath, 'utf-8')) || {};
            const weightComponents = new Set(['transformer', 'vae', 'text_encoder', 'text_encoder_2', 'unet']);
            for (const [comp, spec] of Object.entries(idx)) {
                if (comp.startsWith('_') || !Array.isArray(spec))
                    continue;
                const compPrefix = `${comp}/`;
                const compFiles = files.filter(f => f.startsWith(compPrefix));
                if (!compFiles.length) {
                    reasons.push(`нет файлов компонента Diffusers ${comp}/`);
                    continue;
                }
                if (weightComponents.has(comp) && !compFiles.some(f => /\.(safetensors|bin)$/i.test(f))) {
                    reasons.push(`в подпапке ${comp}/ отсутствуют веса (.safetensors)`);
                }
            }
        }
        catch {
            reasons.push('model_index.json повреждён');
        }
    }
    return { broken: reasons.length > 0, reasons, files };
}

const _weightsRepairs = new Map();
const _weightsRepairCooldown = new Map();
const WEIGHTS_REPAIR_COOLDOWN_MS = 10 * 60 * 1000;

/** Текущее состояние автопочинки раскладки весов конкретной модели (для карточки/теста). */
export function getWeightsRepairState(folderName) {
    const entry = _weightsRepairs.get(String(folderName || ''));
    if (!entry)
        return null;
    return {
        active: entry.active,
        reasons: entry.reasons,
        jobId: entry.jobId || '',
        status: entry.status,
        progress: entry.progress,
        error: entry.error || '',
    };
}

/**
 * Автоматическая самопочинка уже скачанной папки `$ai/#weights`:
 * 1) мгновенно (`fs.renameSync`) раскладывает уже скачанные в корень гигабайтные файлы
 *    по их целевым подпапкам репозитория (`transformer/`, `text_encoder/`, `vae/`, `tokenizer/`, `scheduler/`, `speech_tokenizer/`, `onnx/`);
 * 2) удаляет чужой корневой `config.json`, если в репозитории на его месте `model_index.json`;
 * 3) докачивает из сети только реально недостающие файлы (индексы шардов, конфиги компонентов).
 */
export async function repairLocalModelWeightsIfNeeded({
    rootDir = process.cwd(),
    folderName = '',
    providerFolder = 'Local',
    fetchImpl = globalThis.fetch,
    force = false,
    waitForCompletion = false,
    usableMemoryGb = 192,
} = {}) {
    const safeName = String(folderName || '').trim();
    if (!safeName)
        return { repaired: false, reason: 'no_folder' };
    const existing = _weightsRepairs.get(safeName);
    if (existing?.active) {
        if (waitForCompletion && existing.promise) {
            try { await existing.promise; }
            catch { /* ignore */ }
            return { repaired: existing.status === 'repaired', reason: 'awaited_active', state: getWeightsRepairState(safeName) };
        }
        return { repaired: false, reason: 'in_progress', state: getWeightsRepairState(safeName) };
    }
    const last = _weightsRepairCooldown.get(safeName) || 0;
    if (!force && Date.now() - last < WEIGHTS_REPAIR_COOLDOWN_MS)
        return { repaired: false, reason: 'cooldown' };

    const meta = readLocalModelMetaSync(rootDir, safeName, providerFolder);
    if (!meta?.hfRepo)
        return { repaired: false, reason: 'no_repo' };
    const weightsDir = meta.weightsDir;
    const quick = detectBrokenWeightsLayout(weightsDir);
    if (!quick.broken && !force)
        return { repaired: false, reason: 'layout_ok' };

    // Не мешаем активной загрузке этой же модели (если пользователь сам не ждёт завершения).
    for (const [, entry] of _downloads.entries()) {
        if (entry.job?.folderName === safeName && entry.job.status === 'downloading' && !force)
            return { repaired: false, reason: 'download_active' };
    }

    const state = {
        active: true,
        reasons: quick.reasons,
        jobId: '',
        status: 'checking',
        progress: 0,
        error: '',
        promise: null,
    };
    _weightsRepairs.set(safeName, state);

    const run = (async () => {
        try {
            const repoMeta = await inspectHuggingFaceRepo(meta.hfRepo, {
                rootDir,
                fetchImpl,
                usableMemoryGb,
                token: meta.hfToken || '',
            });
            const selected = selectFilesToDownload(repoMeta, { modality: meta.modality || repoMeta.modality });
            if (!selected.length)
                throw new Error(`Не удалось определить список файлов ${meta.hfRepo}`);

            const repoPaths = new Set(selected.map(f => safeRepoDestRel(f.name)));
            const repoByBasename = new Map();
            for (const f of selected) {
                const rel = safeRepoDestRel(f.name);
                const base = path.basename(rel);
                if (!repoByBasename.has(base))
                    repoByBasename.set(base, []);
                repoByBasename.get(base).push({ rel, size: Number(f.size) || 0 });
            }
            const sizeOf = (rel) => {
                try { return fs.statSync(path.join(weightsDir, rel)).size; }
                catch { return -1; }
            };

            // Шаг 1. Мгновенно раскладываем уже скачанные в корень файлы по их подпапкам
            // (чтобы не качать заново 32.8 ГБ весов Z-Image-Turbo или шардов из интернета).
            const moved = [];
            for (const f of selected) {
                const rel = safeRepoDestRel(f.name);
                if (!rel.includes('/'))
                    continue;
                const expSize = Number(f.size) || 0;
                const curNestedSize = sizeOf(rel);
                if (curNestedSize > 0 && (!expSize || curNestedSize === expSize))
                    continue;
                const base = path.basename(rel);
                const rootSize = sizeOf(base);
                if (rootSize <= 0)
                    continue;
                const candidates = repoByBasename.get(base) || [];
                const uniqueInRepo = !repoPaths.has(base) && candidates.length === 1;
                const exactSizeMatch = expSize > 0 && rootSize === expSize;
                // Если в корне лежит чужой config.json (от компонента), переносим его только при точном совпадении размера
                // и отсутствии в корне валидного корневого конфига.
                let canMoveFromRoot = false;
                if (uniqueInRepo && (!expSize || rootSize === expSize)) {
                    canMoveFromRoot = true;
                }
                else if (exactSizeMatch && !repoPaths.has(base)) {
                    canMoveFromRoot = true;
                }
                else if (exactSizeMatch && base === 'config.json') {
                    try {
                        const cfg = JSON.parse(fs.readFileSync(path.join(weightsDir, 'config.json'), 'utf-8') || '{}');
                        const mt = String(cfg?.model_type || '');
                        if (/_tokenizer|speech_tokenizer/i.test(mt) || cfg?._class_name || cfg?._diffusers_version)
                            canMoveFromRoot = true;
                    }
                    catch { /* ignore */ }
                }
                if (canMoveFromRoot) {
                    try {
                        const dstAbs = path.join(weightsDir, rel);
                        fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
                        fs.renameSync(path.join(weightsDir, base), dstAbs);
                        moved.push(`${base} -> ${rel}`);
                    }
                    catch { /* ignore */ }
                }
            }

            // Шаг 2. Удаляем из корня сплющенные файлы, которых вообще не должно быть в корне репозитория
            // (например, чужой config.json в корне Diffusers-модели, где в корне только model_index.json).
            const removed = [];
            for (const [base, entries] of repoByBasename) {
                if (repoPaths.has(base))
                    continue;
                const localRootSize = sizeOf(base);
                if (localRootSize < 0)
                    continue;
                const isBogusRootConfig = base === 'config.json';
                const nestedMatch = entries.find(e => e.rel !== base && sizeOf(e.rel) === localRootSize);
                if (isBogusRootConfig || nestedMatch) {
                    try {
                        fs.rmSync(path.join(weightsDir, base), { force: true });
                        removed.push(base);
                    }
                    catch { /* ignore */ }
                }
            }

            // Шаг 3. Определяем, какие файлы всё ещё отсутствуют или имеют неверный размер, и докачиваем только их.
            const wanted = [];
            for (const f of selected) {
                const rel = safeRepoDestRel(f.name);
                const localSize = sizeOf(rel);
                if (localSize < 0) {
                    wanted.push(f.name);
                    continue;
                }
                if (Number(f.size) > 0 && localSize !== Number(f.size)) {
                    wanted.push(f.name);
                    continue;
                }
                if (/\.json$/i.test(rel) && rel === 'config.json') {
                    try {
                        const cfg = JSON.parse(fs.readFileSync(path.join(weightsDir, rel), 'utf-8') || '{}');
                        const mt = String(cfg?.model_type || '');
                        if (/_tokenizer|speech_tokenizer/i.test(mt) || cfg?._class_name || cfg?._diffusers_version)
                            wanted.push(f.name);
                    }
                    catch {
                        wanted.push(f.name);
                    }
                }
            }

            if (!wanted.length) {
                state.active = false;
                state.status = (moved.length || removed.length) ? 'repaired' : 'ok';
                state.progress = 100;
                _weightsRepairCooldown.set(safeName, Date.now());
                return { repaired: Boolean(moved.length || removed.length), moved, removed, reason: (moved.length || removed.length) ? 'relocated_locally' : 'nothing_to_do' };
            }

            state.status = 'downloading';
            state.reasons = [...new Set([...quick.reasons, ...(moved.length ? [`перенесено в подпапки: ${moved.length}`] : []), ...(wanted.length ? [`докачка ${wanted.length} файл(ов)`] : [])])];
            const job = await startHuggingFaceDownload({
                repoId: meta.hfRepo,
                files: wanted,
                quant: meta.quant || '',
                rootDir,
                providerFolder,
                targetNodeName: safeName,
                nodeMeta: {
                    modality: meta.modality || repoMeta.modality || 'llm',
                    capabilities: meta.capabilities || repoMeta.capabilities || ['chat'],
                    label: meta.label || safeName,
                },
                registerInWork: false,
                waitForCompletion,
                fetchImpl,
                token: meta.hfToken || '',
            });
            state.jobId = job?.id || '';
            const finalize = (finalJob) => {
                state.active = false;
                state.status = finalJob?.status === 'completed' ? 'repaired' : 'failed';
                state.progress = finalJob?.status === 'completed' ? 100 : (Number(finalJob?.progress) || 0);
                state.error = finalJob?.error ? String(finalJob.error) : '';
                _weightsRepairCooldown.set(safeName, Date.now());
                try {
                    Promise.resolve(globalThis.WORK?.get_item?.(`/MODELS/${providerFolder}/${safeName}`))
                        .then(node => node?.reset?.())
                        .catch(() => {});
                }
                catch { /* ignore */ }
            };
            if (waitForCompletion) {
                finalize(job);
                try {
                    const localNode = await globalThis.WORK?.get_item?.(`/MODELS/${providerFolder}/${safeName}`);
                    localNode?.reset?.();
                }
                catch { /* ignore */ }
            }
            else if (state.jobId) {
                const timer = setInterval(() => {
                    const cur = getHuggingFaceDownload(state.jobId);
                    if (!cur) {
                        clearInterval(timer);
                        state.active = false;
                        state.status = 'failed';
                        state.error = 'загрузка потеряна';
                        return;
                    }
                    state.progress = Number(cur.progress) || 0;
                    if (cur.status !== 'downloading') {
                        clearInterval(timer);
                        finalize(cur);
                    }
                }, 1500);
                timer.unref?.();
            }
            return { repaired: Boolean(wanted.length || moved.length || removed.length), job, moved, removed, reasons: state.reasons };
        }
        catch (err) {
            state.active = false;
            state.status = 'failed';
            state.error = String(err?.message || err);
            _weightsRepairCooldown.set(safeName, Date.now());
            return { repaired: false, reason: 'error', error: state.error };
        }
    })();

    state.promise = run;
    // Фоновый режим: не держим HTTP-запрос карточки, докачка видна в общем списке загрузок.
    if (!waitForCompletion)
        run.catch(() => {});
    const result = waitForCompletion ? await run : { started: true };
    return { ...result, state: getWeightsRepairState(safeName) };
}


