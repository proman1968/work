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
import path from 'node:path';
import crypto from 'node:crypto';

const HF_ORIGIN = 'https://huggingface.co';
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

    if (ptag.includes('video') || /\b(t2v|i2v|wan2|ltx-video|hunyuanvideo|cogvideo)\b/.test(joined)) {
        return {
            modality: 'video',
            capabilities: ['video', 'lora'],
            whatItDoes: 'Генерация и обработка видеороликов по текстовому описанию или кадру',
        };
    }
    if (ptag === 'text-to-image' || ptag === 'image-to-image' || /\b(flux|sdxl|stable-diffusion|z-image)\b/.test(joined)) {
        return {
            modality: 'image',
            capabilities: ['image', 'lora'],
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
            fitLabel: 'Размер уточняется при инспекции',
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

function hfHeaders(token) {
    const h = { 'User-Agent': 'WORK-AI-Trainer/2.0' };
    const t = String(token || process.env.HF_TOKEN || '').trim();
    if (t)
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
    if (caps.includes('tts'))
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

function decorateModelCard(m, usableMemoryGb) {
    const fitInfo = evaluateModelFit(m, usableMemoryGb);
    const modDef = MODEL_MODALITIES.find(x => x.id === m.modality) || MODEL_MODALITIES[1];
    const capabilityBadges = (m.capabilities || []).map(cid => MODEL_CAPABILITIES[cid] || { id: cid, label: cid, desc: '' });
    const icon = m.icon || resolveModelIcon({ repoId: m.id, modality: m.modality, capabilities: m.capabilities });
    return {
        ...m,
        icon,
        modalityLabel: modDef.shortLabel,
        capabilityBadges,
        ...fitInfo,
        recommendedForHost: fitInfo.fit === 'optimal',
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
    fetchImpl = globalThis.fetch,
} = {}) {
    const q = String(query || '').trim();
    const qLower = q.toLowerCase();
    const modLower = String(modality || 'all').trim().toLowerCase();
    const capLower = String(capability || '').trim().toLowerCase();
    const fLower = String(filter || '').trim().toLowerCase();

    const curatedMatches = CURATED_HF_MODELS.filter(m => {
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

        const url = `${HF_ORIGIN}/api/models?${params.toString()}`;
        const res = await fetchImpl(url, {
            headers: { Accept: 'application/json', ...hfHeaders(token) },
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
            seen.add(id);
            const tags = Array.isArray(row.tags) ? row.tags : [];
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
                paramsB: est.paramsB,
                ramRequiredGb: est.ramRequiredGb,
                trainRamGb: est.trainRamGb,
                recommendedFor: row.pipeline_tag || inferred.whatItDoes,
                tags: tags.slice(0, 8),
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
    fetchImpl = globalThis.fetch,
} = {}) {
    const cleanId = validateRepoId(repoId);
    const curated = CURATED_HF_MODELS.find(m => m.id.toLowerCase() === cleanId.toLowerCase()) || null;

    if (typeof fetchImpl === 'function') {
        try {
            const url = `${HF_ORIGIN}/api/models/${cleanId}?blobs=true`;
            const res = await fetchImpl(url, {
                headers: { Accept: 'application/json', ...hfHeaders(token) },
                signal: AbortSignal.timeout?.(12000),
            });
            if (res.ok) {
                const info = await res.json();
                const siblings = Array.isArray(info?.siblings) ? info.siblings : [];
                const files = siblings
                    .map(s => {
                        const name = String(s.rfilename || s.path || '');
                        const size = Number(s.size ?? s.lfs?.size ?? 0);
                        const ext = path.extname(name).toLowerCase();
                        const quant = extractQuantTag(name);
                        return {
                            name,
                            size,
                            sizeGb: +(size / (1024 ** 3)).toFixed(2),
                            sizeFormatted: formatBytes(size),
                            kind: ext === '.gguf' ? 'gguf'
                                : ext === '.safetensors' || ext === '.bin' ? 'safetensors'
                                : /\b(config|tokenizer|adapter|special_tokens|generation_config|merges|vocab|preprocessor)\b/i.test(name) ? 'config'
                                : 'other',
                            quant,
                        };
                    })
                    .filter(f => f.name && !/^\.git/i.test(f.name) && !/^README|^LICENSE/i.test(f.name));

                const quants = [...new Set(files.filter(f => f.kind === 'gguf' && f.quant).map(f => f.quant))];
                const totalWeightBytes = files
                    .filter(f => f.kind === 'gguf' || f.kind === 'safetensors')
                    .reduce((acc, f) => acc + f.size, 0);
                const totalWeightGb = +(totalWeightBytes / (1024 ** 3)).toFixed(2) || curated?.ramRequiredGb || 0;
                const inferred = curated || inferModalityAndCapabilities(info);
                const fitInfo = evaluateModelFit({ ramRequiredGb: totalWeightGb, trainRamGb: +(totalWeightGb * 1.5).toFixed(1) }, usableMemoryGb);
                const capabilityBadges = (inferred.capabilities || []).map(cid => MODEL_CAPABILITIES[cid] || { id: cid, label: cid, desc: '' });
                const icon = resolveModelIcon({ repoId: info.id || cleanId, modality: inferred.modality, capabilities: inferred.capabilities });

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

/**
 * Выбрать список файлов репозитория для скачивания (либо явно переданные `files`, либо подходящий `.gguf` по `quant`, либо `config` + `.safetensors`).
 */
export function selectFilesToDownload(repoMeta, { files = null, quant = '' } = {}) {
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
    return all.filter(f => f.kind === 'config' || f.kind === 'safetensors');
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
    modality = 'llm',
    capabilities = null,
    weightsDir,
    primaryFile = '',
    baseModel = '',
    adapterPath = '',
    maxTokens = 16384,
    baseUrl = 'http://127.0.0.1:8080/v1/chat/completions',
} = {}) {
    const safeName = String(folderName || safeModelFolderName(repoId || label || 'Local-Model')).replace(/[<>:"/\\|?*]/g, '-');
    const aiDir = path.join(rootDir, 'MODELS', 'Local', safeName, '$ai');
    await fsp.mkdir(aiDir, { recursive: true });

    const defaultCaps = modality === 'image' ? ['image']
        : modality === 'video' ? ['video']
        : modality === 'embed' ? ['embeddings']
        : modality === 'vlm' ? ['chat', 'stream', 'vision', 'functions']
        : ['chat', 'stream', 'functions'];
    const rawCaps = Array.isArray(capabilities) && capabilities.length ? capabilities : defaultCaps;
    const resolvedCaps = [...new Set([
        ...rawCaps,
        ...(rawCaps.includes('chat') && !rawCaps.includes('stream') ? ['stream'] : []),
        ...(rawCaps.includes('tools') && !rawCaps.includes('functions') ? ['functions'] : []),
    ])];
    const icon = resolveModelIcon({ repoId: repoId || safeName, modality, capabilities: resolvedCaps });

    const meta = {
        label: String(label || safeName),
        icon,
        protocol: String(primaryFile || '').endsWith('.gguf') ? 'openai' : 'local',
        baseUrl,
        model: repoId || safeName,
        modality,
        maxTokens: Number(maxTokens) || 16384,
        maxOutput: 8192,
        functionCalling: resolvedCaps.includes('tools') || resolvedCaps.includes('functions'),
        capabilities: resolvedCaps,
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

/**
 * Запустить прямую загрузку модели с Hugging Face в `MODELS/Local/<Имя>/#weights/`
 * с поддержкой докачки (`Range`), отслеживанием прогресса и авто-созданием узла `$ai`.
 */
export async function startHuggingFaceDownload({
    repoId,
    files = null,
    quant = 'Q8_0',
    revision = 'main',
    token = '',
    rootDir = process.cwd(),
    registerInWork = true,
    waitForCompletion = false,
    fetchImpl = globalThis.fetch,
} = {}) {
    const cleanId = validateRepoId(repoId);
    const repoMeta = await inspectHuggingFaceRepo(cleanId, { revision, token, fetchImpl });
    const selected = selectFilesToDownload(repoMeta, { files, quant });
    if (!selected.length)
        throw new Error(`В репозитории ${cleanId} не найдено подходящих файлов весов (.gguf / .safetensors)`);

    const folderName = safeModelFolderName(cleanId, quant && selected.some(f => f.kind === 'gguf') ? quant : '');
    const modelDir = path.join(rootDir, 'MODELS', 'Local', folderName);
    const weightsDir = path.join(modelDir, '#weights');
    const primary = selected.find(f => f.name.endsWith('.gguf'))?.name
        || selected.find(f => f.name.endsWith('.safetensors'))?.name
        || selected[0]?.name || '';

    // Сначала создаём $ai/class.js, чтобы папка с первой миллисекунды распознавалась сервером как $ai, а не $folder
    if (registerInWork) {
        await registerLocalModelNode({
            rootDir,
            folderName,
            label: `${cleanId.split('/')[1] || cleanId}${quant && primary.endsWith('.gguf') ? ' (' + quant + ')' : ''}`,
            repoId: cleanId,
            modality: repoMeta.modality || 'llm',
            capabilities: repoMeta.capabilities || ['chat'],
            weightsDir,
            primaryFile: path.basename(primary),
        });
    }
    await fsp.mkdir(weightsDir, { recursive: true });

    const jobId = 'hf_' + crypto.randomUUID().slice(0, 8);
    const totalBytes = selected.reduce((acc, f) => acc + (Number(f.size) || 0), 0);
    const controller = new AbortController();

    const job = {
        id: jobId,
        repoId: cleanId,
        modality: repoMeta.modality || 'llm',
        capabilities: repoMeta.capabilities || ['chat'],
        revision: String(revision || 'main'),
        folderName,
        weightsDir,
        status: 'downloading',
        files: selected.map(f => ({ name: f.name, size: Number(f.size) || 0, downloaded: 0, done: false })),
        currentFile: selected[0]?.name || '',
        downloadedBytes: 0,
        totalBytes,
        progress: 0,
        speedMBs: 0,
        startedAt: Date.now(),
        finishedAt: null,
        modelPath: `/MODELS/Local/${folderName}`,
        error: null,
    };
    _downloads.set(jobId, { job, controller });

    const runPromise = (async () => {
        const t0 = Date.now();
        try {
            for (const fileEntry of job.files) {
                if (controller.signal.aborted)
                    throw new Error('Загрузка отменена пользователем');
                job.currentFile = fileEntry.name;
                const destFile = path.join(weightsDir, path.basename(fileEntry.name));
                const partFile = destFile + '.part';

                let existingSize = 0;
                try {
                    const st = await fsp.stat(partFile);
                    existingSize = st.size;
                }
                catch { /* файла ещё нет */ }

                const encodedPath = fileEntry.name.split('/').map(encodeURIComponent).join('/');
                const url = `${HF_ORIGIN}/${cleanId}/resolve/${encodeURIComponent(job.revision)}/${encodedPath}`;
                const headers = hfHeaders(token);
                if (existingSize > 0)
                    headers.Range = `bytes=${existingSize}-`;

                const res = await fetchImpl(url, { headers, signal: controller.signal });
                if (!res.ok && res.status !== 206 && res.status !== 416)
                    throw new Error(`Ошибка загрузки ${fileEntry.name}: HTTP ${res.status}`);

                const isPartial = res.status === 206;
                if (!isPartial && res.status !== 416)
                    existingSize = 0;

                const contentLen = Number(res.headers?.get?.('content-length') || 0);
                if (!fileEntry.size && contentLen > 0) {
                    fileEntry.size = existingSize + contentLen;
                    job.totalBytes = job.files.reduce((acc, f) => acc + (Number(f.size) || 0), 0);
                }

                fileEntry.downloaded = existingSize;

                if (res.status !== 416 && res.body) {
                    const flags = isPartial ? 'a' : 'w';
                    const out = fs.createWriteStream(partFile, { flags });
                    for await (const chunk of res.body) {
                        if (controller.signal.aborted) {
                            out.destroy();
                            throw new Error('Загрузка отменена пользователем');
                        }
                        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                        if (!out.write(buf))
                            await new Promise(r => out.once('drain', r));
                        fileEntry.downloaded += buf.length;
                        job.downloadedBytes = job.files.reduce((acc, f) => acc + f.downloaded, 0);
                        if (job.totalBytes > 0)
                            job.progress = Math.min(99, Math.round((job.downloadedBytes / job.totalBytes) * 100));
                        const elapsedSec = Math.max(0.1, (Date.now() - t0) / 1000);
                        job.speedMBs = +((job.downloadedBytes / (1024 * 1024)) / elapsedSec).toFixed(2);
                    }
                    await new Promise((resolve, reject) => {
                        out.end();
                        out.once('finish', resolve);
                        out.once('error', reject);
                    });
                }

                await fsp.rename(partFile, destFile);
                fileEntry.done = true;
            }

            const manifestFile = path.join(weightsDir, 'hf-manifest.json');
            await fsp.writeFile(manifestFile, JSON.stringify({
                repoId: cleanId,
                modality: job.modality,
                capabilities: job.capabilities,
                revision: job.revision,
                downloadedAt: new Date().toISOString(),
                files: job.files,
            }, null, 2), 'utf-8');

            job.progress = 100;
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
            job.status = controller.signal.aborted ? 'cancelled' : 'failed';
            job.error = String(err?.message || err);
            job.finishedAt = Date.now();
            // Если ни один файл весов(.gguf / .safetensors) не скачался целиком — убираем недокачанную папку, чтобы она не висела пустой в /MODELS/Local
            const hasWeights = job.files.some(f => f.done && (f.name.endsWith('.gguf') || f.name.endsWith('.safetensors')));
            if (!hasWeights) {
                await fsp.rm(modelDir, { recursive: true, force: true }).catch(() => {});
                try {
                    const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                    localNode?.reset?.();
                }
                catch { /* ignore */ }
            }
        }
    })();

    if (waitForCompletion)
        await runPromise;

    return { ...job };
}

export function getHuggingFaceDownload(jobId) {
    const entry = _downloads.get(String(jobId || ''));
    return entry ? { ...entry.job } : null;
}

export function listHuggingFaceDownloads() {
    return [..._downloads.values()].map(e => ({ ...e.job })).sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelHuggingFaceDownload(jobId) {
    const entry = _downloads.get(String(jobId || ''));
    if (!entry)
        return null;
    entry.controller.abort();
    entry.job.status = 'cancelled';
    entry.job.finishedAt = Date.now();
    return { ...entry.job };
}
