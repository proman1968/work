/**
 * Каталог облачных и локальных провайдеров ИИ (`$provider`) и их типовых моделей (`$ai`).
 *
 * Используется:
 *  - для предустановленных российских провайдеров в `/MODELS` (`GigaChat`, `Yandex`, `T-Bank`, `MTS-AI`);
 *  - в диалоге создания нового провайдера (`+` на `/MODELS`);
 *  - в представлении управления провайдером (`form/provider`): настройка ключей `#secret`, проверка связи
 *    и быстрое добавление моделей в 1 клик.
 */
import fs from 'node:fs';
import path from 'node:path';

export const AI_PROVIDER_PRESETS = Object.freeze([
    {
        id: 'GigaChat',
        label: 'GigaChat (Сбер)',
        category: 'ru',
        icon: 'ai:gigachat',
        protocol: 'gigachat',
        baseUrl: 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
        authUrl: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
        scope: 'GIGACHAT_API_PERS',
        secretFile: 'gigachat.json',
        secretField: 'token',
        envVar: 'GIGACHAT_KEY',
        keyLabel: 'Ключ авторизации (Authorization Key Base64)',
        keyPlaceholder: 'MDE5... (ключ из личного кабинета developers.sber.ru)',
        description: 'Нейросетевая платформа Сбера: GigaChat 2 Lite, Pro, Max и векторные эмбеддинги.',
        models: [
            {
                id: 'GigaChat 2 Lite',
                label: 'GigaChat 2 Lite',
                model: 'GigaChat-2',
                icon: 'ai:gigachat',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
            {
                id: 'GigaChat 2 Pro',
                label: 'GigaChat 2 Pro',
                model: 'GigaChat-2-Pro',
                icon: 'ai:gigachat',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
            {
                id: 'GigaChat 2 Max',
                label: 'GigaChat 2 Max',
                model: 'GigaChat-2-Max',
                icon: 'ai:gigachat',
                modality: 'vlm',
                maxTokens: 131072,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision'],
            },
            {
                id: 'GigaChat Embeddings',
                label: 'GigaChat Embeddings',
                model: 'EmbeddingsGigaR',
                icon: 'carbon:search-locate',
                modality: 'embed',
                maxTokens: 4096,
                maxOutput: 1024,
                functionCalling: false,
                capabilities: ['embeddings', 'rag'],
            },
        ],
    },
    {
        id: 'Yandex',
        label: 'Yandex AI (Алиса)',
        category: 'ru',
        icon: 'ai:yandex',
        protocol: 'yandex',
        baseUrl: 'https://llm.api.cloud.yandex.net/v1/chat/completions',
        secretFile: 'yandex.json',
        secretField: 'apiKey',
        envVar: 'YANDEX_API_KEY',
        folderEnvVar: 'YANDEX_FOLDER_ID',
        needsFolderId: true,
        keyLabel: 'API-ключ или IAM-токен Yandex Cloud',
        keyPlaceholder: 'AQVN... (API-ключ сервисного аккаунта Yandex Cloud)',
        folderPlaceholder: 'b1g... (ID каталога Yandex Cloud)',
        description: 'Модели Яндекса (Yandex Cloud Foundation Models): Alice AI / YandexGPT 5 Pro, Lite, Reasoning, YandexART и SpeechKit.',
        models: [
            {
                id: 'Alice AI (YandexGPT 5 Pro)',
                label: 'Alice AI (YandexGPT 5 Pro)',
                model: 'yandexgpt/latest',
                icon: 'ai:yandex',
                modality: 'llm',
                maxTokens: 32768,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
            {
                id: 'YandexGPT 5 Lite',
                label: 'YandexGPT 5 Lite',
                model: 'yandexgpt-lite/latest',
                icon: 'ai:yandex',
                modality: 'llm',
                maxTokens: 32768,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
            {
                id: 'YandexGPT Reasoning',
                label: 'YandexGPT Reasoning',
                model: 'yandexgpt/rc',
                icon: 'ai:yandex',
                modality: 'llm',
                maxTokens: 32768,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'effort', 'thinking'],
                efforts: ['low', 'medium', 'high'],
            },
            {
                id: 'YandexART',
                label: 'YandexART',
                model: 'yandex-art/latest',
                icon: 'ai:stablediffusion',
                modality: 'image',
                maxTokens: 4096,
                maxOutput: 1024,
                functionCalling: false,
                capabilities: ['image', 'text-to-image'],
            },
            {
                id: 'Yandex SpeechKit ASR',
                label: 'Yandex SpeechKit ASR',
                model: 'general:rc',
                icon: 'carbon:microphone',
                modality: 'audio',
                maxTokens: 4096,
                maxOutput: 2048,
                functionCalling: false,
                capabilities: ['stt', 'asr'],
            },
            {
                id: 'Yandex SpeechKit TTS',
                label: 'Yandex SpeechKit TTS',
                model: 'alena',
                icon: 'carbon:volume-up',
                modality: 'audio',
                maxTokens: 4096,
                maxOutput: 2048,
                functionCalling: false,
                capabilities: ['tts', 'voice'],
            },
            {
                id: 'Yandex Embeddings',
                label: 'Yandex Embeddings',
                model: 'text-search-doc/latest',
                icon: 'carbon:search-locate',
                modality: 'embed',
                maxTokens: 4096,
                maxOutput: 1024,
                functionCalling: false,
                capabilities: ['embeddings', 'rag'],
            },
        ],
    },
    {
        id: 'T-Bank',
        label: 'T-Bank AI (T-Pro)',
        category: 'ru',
        icon: 'ai:tbank',
        protocol: 'openai',
        baseUrl: 'https://api.tbank.ru/v1/chat/completions',
        secretFile: 'tbank.json',
        secretField: 'apiKey',
        envVar: 'TBANK_API_KEY',
        keyLabel: 'API-ключ T-Bank AI / T-Pro',
        keyPlaceholder: 'tb-... (ключ доступа к API T-Bank)',
        description: 'Российские языковые и голосовые модели Т-Банка: T-Pro 2.0, T-Lite 2.0 и T-VoiceKit.',
        models: [
            {
                id: 'T-Pro 2.0',
                label: 'T-Pro 2.0',
                model: 't-tech/T-pro-it-2.0',
                icon: 'ai:tbank',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'thinking'],
            },
            {
                id: 'T-Lite 2.0',
                label: 'T-Lite 2.0',
                model: 't-tech/T-lite-it-2.0',
                icon: 'ai:tbank',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
            {
                id: 'T-VoiceKit ASR',
                label: 'T-VoiceKit ASR',
                model: 't-voicekit-asr',
                icon: 'carbon:microphone',
                modality: 'audio',
                maxTokens: 4096,
                maxOutput: 2048,
                functionCalling: false,
                capabilities: ['stt', 'asr'],
            },
            {
                id: 'T-VoiceKit TTS',
                label: 'T-VoiceKit TTS',
                model: 't-voicekit-tts',
                icon: 'carbon:volume-up',
                modality: 'audio',
                maxTokens: 4096,
                maxOutput: 2048,
                functionCalling: false,
                capabilities: ['tts', 'voice'],
            },
        ],
    },
    {
        id: 'MTS-AI',
        label: 'MTS AI (Cotype)',
        category: 'ru',
        icon: 'ai:mts',
        protocol: 'openai',
        baseUrl: 'https://api.mts.ai/v1/chat/completions',
        secretFile: 'mts.json',
        secretField: 'apiKey',
        envVar: 'MTS_API_KEY',
        keyLabel: 'API-ключ MTS AI (Cotype)',
        keyPlaceholder: 'mts-... (ключ доступа к API MTS AI)',
        description: 'Корпоративные модели МТС ИИ: Cotype Pro 2, Cotype Lite и мультимодальная Cotype Vision.',
        models: [
            {
                id: 'Cotype Pro 2',
                label: 'Cotype Pro 2',
                model: 'cotype-pro-2',
                icon: 'ai:mts',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
            {
                id: 'Cotype Lite',
                label: 'Cotype Lite',
                model: 'cotype-lite',
                icon: 'ai:mts',
                modality: 'llm',
                maxTokens: 32768,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
            {
                id: 'Cotype Vision',
                label: 'Cotype Vision',
                model: 'cotype-vl',
                icon: 'ai:mts',
                modality: 'vlm',
                maxTokens: 32768,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'vision'],
            },
        ],
    },
    {
        id: 'OpenAI',
        label: 'OpenAI (ChatGPT)',
        category: 'global',
        icon: 'ai:chatgpt',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1/chat/completions',
        secretFile: 'openai.json',
        secretField: 'apiKey',
        envVar: 'OPENAI_API_KEY',
        keyLabel: 'OpenAI API Key',
        keyPlaceholder: 'sk-proj-...',
        description: 'Модели OpenAI: GPT-4.1, GPT-4.1 mini, o3, o4-mini, Whisper, TTS и DALL-E / gpt-image-1.',
        models: [
            {
                id: 'GPT-4.1',
                label: 'GPT-4.1',
                model: 'gpt-4.1',
                icon: 'ai:chatgpt',
                modality: 'vlm',
                maxTokens: 1047576,
                maxOutput: 32768,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision'],
            },
            {
                id: 'GPT-4.1 mini',
                label: 'GPT-4.1 mini',
                model: 'gpt-4.1-mini',
                icon: 'ai:chatgpt',
                modality: 'vlm',
                maxTokens: 1047576,
                maxOutput: 32768,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision'],
            },
            {
                id: 'o3',
                label: 'OpenAI o3',
                model: 'o3',
                icon: 'ai:chatgpt',
                modality: 'vlm',
                maxTokens: 200000,
                maxOutput: 65536,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision', 'effort', 'thinking'],
                efforts: ['low', 'medium', 'high'],
            },
            {
                id: 'o4-mini',
                label: 'OpenAI o4-mini',
                model: 'o4-mini',
                icon: 'ai:chatgpt',
                modality: 'vlm',
                maxTokens: 200000,
                maxOutput: 65536,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision', 'effort', 'thinking'],
                efforts: ['low', 'medium', 'high'],
            },
        ],
    },
    {
        id: 'Anthropic',
        label: 'Anthropic (Claude)',
        category: 'global',
        icon: 'ai:claude',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1/messages',
        secretFile: 'anthropic.json',
        secretField: 'apiKey',
        envVar: 'ANTHROPIC_API_KEY',
        keyLabel: 'Anthropic API Key',
        keyPlaceholder: 'sk-ant-api03-...',
        description: 'Модели Anthropic Claude: Claude Opus 4.6, Claude Sonnet 4.6 и Claude Haiku 4.5 с кэшированием промптов.',
        models: [
            {
                id: 'Claude Sonnet 4.6',
                label: 'Claude Sonnet 4.6',
                model: 'claude-sonnet-4-6',
                icon: 'ai:claude',
                modality: 'vlm',
                maxTokens: 200000,
                maxOutput: 16384,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision', 'effort', 'thinking'],
                efforts: ['low', 'medium', 'high'],
            },
            {
                id: 'Claude Opus 4.6',
                label: 'Claude Opus 4.6',
                model: 'claude-opus-4-6',
                icon: 'ai:claude',
                modality: 'vlm',
                maxTokens: 200000,
                maxOutput: 32768,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision', 'effort', 'thinking'],
                efforts: ['low', 'medium', 'high', 'max'],
            },
            {
                id: 'Claude Haiku 4.5',
                label: 'Claude Haiku 4.5',
                model: 'claude-haiku-4-5',
                icon: 'ai:claude',
                modality: 'vlm',
                maxTokens: 200000,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision'],
            },
        ],
    },
    {
        id: 'DeepSeek',
        label: 'DeepSeek',
        category: 'global',
        icon: 'ai:deepseek',
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com/v1/chat/completions',
        secretFile: 'deepseek.json',
        secretField: 'apiKey',
        envVar: 'DEEPSEEK_API_KEY',
        keyLabel: 'DeepSeek API Key',
        keyPlaceholder: 'sk-...',
        description: 'Модели DeepSeek: DeepSeek V3 (Chat) и рассуждающая модель DeepSeek R1 (Reasoner).',
        models: [
            {
                id: 'DeepSeek V3',
                label: 'DeepSeek V3 (Chat)',
                model: 'deepseek-chat',
                icon: 'ai:deepseek',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
            {
                id: 'DeepSeek R1',
                label: 'DeepSeek R1 (Reasoner)',
                model: 'deepseek-reasoner',
                icon: 'ai:deepseek',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 16384,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'thinking'],
            },
        ],
    },
    {
        id: 'Gemini',
        label: 'Google Gemini',
        category: 'global',
        icon: 'ai:gemini',
        protocol: 'openai',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        secretFile: 'gemini.json',
        secretField: 'apiKey',
        envVar: 'GEMINI_API_KEY',
        keyLabel: 'Google AI Studio API Key',
        keyPlaceholder: 'AIzaSy...',
        description: 'Мультимодальные модели Google Gemini (2.5 Pro и 2.5 Flash) с контекстом до 1 млн токенов.',
        models: [
            {
                id: 'Gemini 2.5 Pro',
                label: 'Gemini 2.5 Pro',
                model: 'gemini-2.5-pro',
                icon: 'ai:gemini',
                modality: 'vlm',
                maxTokens: 1048576,
                maxOutput: 32768,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision', 'effort', 'thinking'],
                efforts: ['low', 'medium', 'high'],
            },
            {
                id: 'Gemini 2.5 Flash',
                label: 'Gemini 2.5 Flash',
                model: 'gemini-2.5-flash',
                icon: 'ai:gemini',
                modality: 'vlm',
                maxTokens: 1048576,
                maxOutput: 16384,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision', 'effort', 'thinking'],
                efforts: ['low', 'medium', 'high'],
            },
        ],
    },
    {
        id: 'OpenRouter',
        label: 'OpenRouter',
        category: 'global',
        icon: 'ai:openrouter',
        protocol: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        secretFile: 'openrouter.json',
        secretField: 'apiKey',
        envVar: 'OPENROUTER_API_KEY',
        keyLabel: 'OpenRouter API Key',
        keyPlaceholder: 'sk-or-v1-...',
        description: 'Единый шлюз ко всем мировым моделям (Qwen, Claude, GPT, Gemini, DeepSeek, Llama, Mistral).',
        models: [
            {
                id: 'Qwen3 235B A22B',
                label: 'Qwen3 235B A22B',
                model: 'qwen/qwen3-235b-a22b',
                icon: 'ai:qwen',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 16384,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'thinking'],
            },
            {
                id: 'DeepSeek R1 (OpenRouter)',
                label: 'DeepSeek R1 (OpenRouter)',
                model: 'deepseek/deepseek-r1',
                icon: 'ai:deepseek',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 16384,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'thinking'],
            },
        ],
    },
    {
        id: 'Grok',
        label: 'xAI (Grok)',
        category: 'global',
        icon: 'ai:grok',
        protocol: 'openai',
        baseUrl: 'https://api.x.ai/v1/chat/completions',
        secretFile: 'grok.json',
        secretField: 'apiKey',
        envVar: 'XAI_API_KEY',
        keyLabel: 'xAI API Key',
        keyPlaceholder: 'xai-...',
        description: 'Модели xAI: Grok 4 и Grok 3 Mini.',
        models: [
            {
                id: 'Grok 4',
                label: 'Grok 4',
                model: 'grok-4',
                icon: 'ai:grok',
                modality: 'vlm',
                maxTokens: 256000,
                maxOutput: 16384,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'vision', 'thinking'],
            },
            {
                id: 'Grok 3 Mini',
                label: 'Grok 3 Mini',
                model: 'grok-3-mini',
                icon: 'ai:grok',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 16384,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions', 'effort', 'thinking'],
                efforts: ['low', 'high'],
            },
        ],
    },
    {
        id: 'Mistral',
        label: 'Mistral AI',
        category: 'global',
        icon: 'ai:mistral',
        protocol: 'openai',
        baseUrl: 'https://api.mistral.ai/v1/chat/completions',
        secretFile: 'mistral.json',
        secretField: 'apiKey',
        envVar: 'MISTRAL_API_KEY',
        keyLabel: 'Mistral API Key',
        keyPlaceholder: '...',
        description: 'Европейские модели Mistral Large и Codestral.',
        models: [
            {
                id: 'Mistral Large',
                label: 'Mistral Large',
                model: 'mistral-large-latest',
                icon: 'ai:mistral',
                modality: 'llm',
                maxTokens: 131072,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
            {
                id: 'Codestral',
                label: 'Codestral',
                model: 'codestral-latest',
                icon: 'ai:mistral',
                modality: 'llm',
                maxTokens: 256000,
                maxOutput: 8192,
                functionCalling: true,
                capabilities: ['chat', 'stream', 'tools', 'functions'],
            },
        ],
    },
    {
        id: 'Ollama',
        label: 'Ollama / LM Studio / vLLM',
        category: 'local-api',
        icon: 'ai:ollama',
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
        secretFile: 'ollama.json',
        secretField: 'apiKey',
        keyLabel: 'API Key (опционально)',
        keyPlaceholder: 'ollama (не требуется для локального сервера)',
        noKeyRequired: true,
        description: 'Подключение к локальному или сетевому серверу Ollama (:11434), LM Studio (:1234) или vLLM (:8000).',
        models: [],
    },
    {
        id: 'Custom',
        label: 'Свой провайдер (OpenAI API)',
        category: 'custom',
        icon: 'carbon:api',
        protocol: 'openai',
        baseUrl: 'https://api.example.com/v1/chat/completions',
        secretFile: 'custom.json',
        secretField: 'apiKey',
        keyLabel: 'API Key',
        keyPlaceholder: 'sk-...',
        description: 'Любой внешний или корпоративный OpenAI-совместимый сервер ИИ.',
        models: [],
    },
]);

export function findProviderPreset(idOrName = '') {
    const clean = String(idOrName || '').trim().toLowerCase();
    if (!clean)
        return null;
    return AI_PROVIDER_PRESETS.find(p =>
        p.id.toLowerCase() === clean || p.label.toLowerCase() === clean
    ) || null;
}

/**
 * Сформировать содержимое `MODELS/<Provider>/$provider/class.js` и `MODELS/<Provider>/$provider/$folder/$class/$ai/class.js`.
 */
export function buildProviderClassScripts(preset, overrides = {}) {
    const label = overrides.label || preset?.label || overrides.id || 'Provider';
    const icon = overrides.icon || preset?.icon || 'carbon:api';
    const protocol = overrides.protocol || preset?.protocol || 'openai';
    const baseUrl = overrides.baseUrl || preset?.baseUrl || 'https://api.openai.com/v1/chat/completions';
    const secretFile = overrides.secretFile || preset?.secretFile || `${String(overrides.id || preset?.id || 'provider').toLowerCase()}.json`;

    const providerObj = {
        icon,
        label,
        form: 'provider',
        protocol,
        baseUrl,
    };
    if (protocol === 'gigachat') {
        providerObj.authUrl = overrides.authUrl || preset?.authUrl || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
        providerObj.token = `secret:${secretFile}`;
        providerObj.scope = overrides.scope || preset?.scope || 'GIGACHAT_API_PERS';
    }
    else if (protocol === 'yandex') {
        providerObj.apiKey = `secret:${secretFile}`;
        providerObj.folderId = `secret:${secretFile}`;
    }
    else {
        providerObj.apiKey = `secret:${secretFile}`;
    }

    const aiProtoObj = {
        icon,
        description: `Модель провайдера ${label}`,
        protocol,
        baseUrl,
        functionCalling: true,
    };
    if (protocol === 'gigachat') {
        aiProtoObj.authUrl = providerObj.authUrl;
        aiProtoObj.token = providerObj.token;
        aiProtoObj.scope = providerObj.scope;
    }
    else if (protocol === 'yandex') {
        aiProtoObj.apiKey = providerObj.apiKey;
        aiProtoObj.folderId = providerObj.folderId;
    }
    else {
        aiProtoObj.apiKey = providerObj.apiKey;
    }

    return {
        providerScript: `export default ${JSON.stringify(providerObj, null, 4)};\n`,
        aiProtoScript: `export default ${JSON.stringify(aiProtoObj, null, 4)};\n`,
    };
}

/**
 * Сформировать `class.js` дочерней модели `$ai`.
 */
export function buildModelClassScript(modelSpec = {}) {
    const obj = {
        label: modelSpec.label || modelSpec.id || modelSpec.model,
        model: modelSpec.model || modelSpec.id,
        icon: modelSpec.icon || undefined,
        modality: modelSpec.modality || 'llm',
        maxTokens: Number(modelSpec.maxTokens) || 32768,
        maxOutput: Number(modelSpec.maxOutput) || 8192,
        functionCalling: modelSpec.functionCalling !== false,
        capabilities: Array.isArray(modelSpec.capabilities) ? modelSpec.capabilities : ['chat', 'stream'],
    };
    if (Array.isArray(modelSpec.efforts) && modelSpec.efforts.length)
        obj.efforts = modelSpec.efforts;
    if (!obj.icon)
        delete obj.icon;
    return `export default ${JSON.stringify(obj, null, 4)};\n`;
}

/**
 * Развернуть файлы провайдера и его предустановленных моделей на диске (`MODELS/<providerId>`).
 */
export function scaffoldProviderOnDiskSync({
    rootDir = process.cwd(),
    providerId,
    presetId = '',
    label = '',
    baseUrl = '',
    protocol = '',
    icon = '',
    apiKey = '',
    folderId = '',
    scope = '',
    includeDefaultModels = true,
} = {}) {
    const preset = findProviderPreset(presetId || providerId);
    const id = String(providerId || preset?.id || 'Provider').trim();
    const providerDir = path.join(rootDir, 'MODELS', id);
    const secretFile = preset?.secretFile || `${id.toLowerCase().replace(/[^a-z0-9_-]/gi, '_')}.json`;

    const { providerScript, aiProtoScript } = buildProviderClassScripts(preset, {
        id,
        label: label || preset?.label || id,
        baseUrl: baseUrl || preset?.baseUrl,
        protocol: protocol || preset?.protocol,
        icon: icon || preset?.icon,
        scope: scope || preset?.scope,
        secretFile,
    });

    const provClassFile = path.join(providerDir, '$provider', 'class.js');
    fs.mkdirSync(path.dirname(provClassFile), { recursive: true });
    fs.writeFileSync(provClassFile, providerScript, 'utf-8');

    const aiProtoFile = path.join(providerDir, '$provider', '$folder', '$class', '$ai', 'class.js');
    fs.mkdirSync(path.dirname(aiProtoFile), { recursive: true });
    fs.writeFileSync(aiProtoFile, aiProtoScript, 'utf-8');

    const cleanKey = String(apiKey || '').trim();
    const cleanFolder = String(folderId || '').trim();
    if (cleanKey || cleanFolder) {
        const secretDir = path.join(providerDir, '$provider', '#secret');
        fs.mkdirSync(secretDir, { recursive: true });
        const secretPayload = {};
        if ((protocol || preset?.protocol) === 'gigachat') {
            secretPayload.token = cleanKey;
            if (scope || preset?.scope)
                secretPayload.scope = scope || preset.scope;
        }
        else {
            if (cleanKey)
                secretPayload.apiKey = cleanKey;
            if (cleanFolder)
                secretPayload.folderId = cleanFolder;
        }
        fs.writeFileSync(path.join(secretDir, secretFile), JSON.stringify(secretPayload, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
    }

    const createdModels = [];
    if (includeDefaultModels && Array.isArray(preset?.models)) {
        for (const m of preset.models) {
            const safeModelDir = String(m.id || m.label || m.model).replace(/[<>:"/\\|?*]/g, '_').trim();
            const modelClassFile = path.join(providerDir, safeModelDir, '$ai', 'class.js');
            fs.mkdirSync(path.dirname(modelClassFile), { recursive: true });
            fs.writeFileSync(modelClassFile, buildModelClassScript(m), 'utf-8');
            createdModels.push(`/MODELS/${id}/${safeModelDir}`);
        }
    }

    return {
        providerPath: `/MODELS/${id}`,
        createdModels,
    };
}

function hasWeightFilesInDirSync(dir) {
    if (!dir || !fs.existsSync(dir))
        return false;
    try {
        return fs.readdirSync(dir).some(f =>
            !f.endsWith('.part')
            && f !== 'hf-manifest.json'
            && /\.(safetensors|gguf|bin|onnx|pt|pth|hgn|hnpw|json)$/i.test(f)
        );
    }
    catch {
        return false;
    }
}

function readSecretJsonSync(rootDir, relFolder, filename) {
    if (!filename)
        return null;
    const candidates = [
        path.join(rootDir, relFolder, '#secret', filename),
        path.join(rootDir, '#system', filename),
    ];
    for (const p of candidates) {
        try {
            if (!fs.existsSync(p))
                continue;
            const raw = fs.readFileSync(p, 'utf-8').trim();
            if (!raw)
                continue;
            if (raw.startsWith('{'))
                return JSON.parse(raw);
            return { value: raw };
        }
        catch { /* ignore */ }
    }
    return null;
}

/**
 * Проверить синхронно, активен ли узел `$provider` или `$ai` в дереве `/MODELS`.
 * Возвращает `{ active: boolean, reason: string, configuredKey: boolean }`.
 */
export function evaluateAiNodeActivitySync(item, rootDir = process.cwd()) {
    if (!item)
        return { active: false, reason: 'Узел не найден', configuredKey: false };
    const type = item.type;
    if (type !== '$provider' && type !== '$ai')
        return { active: true, reason: '', configuredKey: true };

    const itemPath = String(item.path || item.short || '');
    const data = item.DATA || {};

    if (data.enabled === false) {
        return { active: false, reason: 'Отключена в настройках', configuredKey: false };
    }

    // Проверка отключения родительского провайдера у дочерней модели $ai
    const parts = itemPath.split('/').filter(Boolean); // ['MODELS', '<Provider>', '<Model>']
    const providerId = parts[0] === 'MODELS' ? (parts[1] || '') : '';
    if (type === '$ai' && providerId) {
        try {
            const provClassPath = path.join(rootDir, 'MODELS', providerId, '$provider', 'class.js');
            if (fs.existsSync(provClassPath)) {
                const rawProv = fs.readFileSync(provClassPath, 'utf-8');
                if (/\benabled\s*:\s*false\b/.test(rawProv)) {
                    return { active: false, reason: `Провайдер ${providerId} отключён`, configuredKey: false };
                }
            }
        }
        catch { /* ignore */ }
    }

    // 1. Локальный провайдер /MODELS/Local и его модели
    if (providerId === 'Local' || data.protocol === 'local' || data.protocol === 'halogen') {
        if (type === '$provider') {
            const localDir = path.join(rootDir, 'MODELS', 'Local');
            let installedCount = 0;
            try {
                if (fs.existsSync(localDir)) {
                    for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
                        if (!entry.isDirectory() || entry.name.startsWith('$') || entry.name.startsWith('#') || entry.name === 'models')
                            continue;
                        if (
                            hasWeightFilesInDirSync(path.join(localDir, entry.name, '#weights'))
                            || hasWeightFilesInDirSync(path.join(localDir, entry.name, '#adapters'))
                        ) {
                            installedCount++;
                        }
                    }
                }
            }
            catch { /* ignore */ }
            const buboManifest1 = path.join(rootDir, 'MODELS', 'Local', 'models', 'qwen38-flash-next-base-ud-q4-k-xl-v1', 'bubo-package.json');
            if (installedCount > 0 || fs.existsSync(buboManifest1)) {
                return { active: true, reason: `Активен (моделей: ${installedCount || 1})`, configuredKey: true };
            }
            return { active: false, reason: 'Нет скачанных локальных моделей (откройте для установки)', configuredKey: false };
        }

        // Дочерняя модель в /MODELS/Local/<Model>
        const modelName = parts[2] || item.id || '';
        const weightsRel = data.weightsDir || path.join('MODELS', 'Local', modelName, '#weights');
        const adapterRel = data.adapterPath || path.join('MODELS', 'Local', modelName, '#adapters');
        const hasWeights = hasWeightFilesInDirSync(path.resolve(rootDir, weightsRel))
            || hasWeightFilesInDirSync(path.resolve(rootDir, adapterRel))
            || fs.existsSync(path.join(rootDir, 'MODELS', 'Local', 'models', 'qwen38-flash-next-base-ud-q4-k-xl-v1', 'bubo-package.json'));
        if (hasWeights) {
            return { active: true, reason: 'Активна (веса модели на диске)', configuredKey: true };
        }
        return { active: false, reason: 'Веса модели не скачаны в #weights', configuredKey: false };
    }

    // 2. Внешние и облачные провайдеры ($provider и их $ai)
    const preset = findProviderPreset(providerId);
    const protocol = String(data.protocol || preset?.protocol || 'openai').toLowerCase();
    const baseUrl = String(data.baseUrl || preset?.baseUrl || '').trim();
    const rawKey = String(
        (protocol === 'gigachat' ? (data.token || data.apiKey) : (data.apiKey || data.token))
        || (preset?.secretFile ? `secret:${preset.secretFile}` : '')
    ).trim();

    // Локальные серверы без ключа (Ollama, LM Studio, vLLM)
    if (preset?.noKeyRequired || protocol === 'ollama' || (!rawKey && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(baseUrl))) {
        return { active: true, reason: 'Активна (локальный API)', configuredKey: true };
    }

    // Проверим env-переменную пресета
    if (preset?.envVar && String(process.env[preset.envVar] || '').trim()) {
        return { active: true, reason: `Активна (ключ из env ${preset.envVar})`, configuredKey: true };
    }

    if (!rawKey) {
        return { active: false, reason: 'Не настроен API-ключ провайдера', configuredKey: false };
    }

    if (/^env:/i.test(rawKey)) {
        const envName = rawKey.slice(4).trim();
        const val = String(process.env[envName] || '').trim();
        return val
            ? { active: true, reason: `Активна (env:${envName})`, configuredKey: true }
            : { active: false, reason: `Не задана переменная окружения ${envName}`, configuredKey: false };
    }

    if (/^secret:/i.test(rawKey)) {
        const secretFile = rawKey.slice(7).trim();
        const modelRel = itemPath.replace(/^\/+/, '');
        const provRel = providerId ? path.join('MODELS', providerId, '$provider') : modelRel;
        const secretObj = readSecretJsonSync(rootDir, path.join(modelRel, item.type || '$ai'), secretFile)
            || readSecretJsonSync(rootDir, provRel, secretFile);
        const keyVal = String(secretObj?.value ?? secretObj?.apiKey ?? secretObj?.token ?? secretObj?.key ?? '').trim();
        if (!keyVal) {
            return { active: false, reason: 'Не настроен API-ключ (откройте провайдер для ввода ключа)', configuredKey: false };
        }
        if (protocol === 'yandex') {
            const folderVal = String(secretObj?.folderId ?? data.folderId ?? process.env.YANDEX_FOLDER_ID ?? '').trim();
            if (!folderVal || /^secret:/i.test(folderVal)) {
                return { active: false, reason: 'Не указан Folder ID каталога Yandex Cloud', configuredKey: false };
            }
        }
        return { active: true, reason: 'Активна (API-ключ настроен)', configuredKey: true };
    }

    // Прямой литерал ключа
    return { active: true, reason: 'Активна', configuredKey: true };
}

/**
 * Прочитать состояние провайдера `/MODELS/<id>` для формы настройки `form/provider`.
 */
export function getProviderStatusSync(providerItem, rootDir = process.cwd()) {
    const itemPath = String(providerItem?.path || providerItem?.short || '');
    const parts = itemPath.split('/').filter(Boolean);
    const providerId = parts[1] || providerItem?.id || '';
    const preset = findProviderPreset(providerId);
    const data = providerItem?.DATA || {};
    const protocol = String(data.protocol || preset?.protocol || 'openai');
    const baseUrl = String(data.baseUrl || preset?.baseUrl || '');
    const authUrl = String(data.authUrl || preset?.authUrl || '');
    const scope = String(data.scope || preset?.scope || 'GIGACHAT_API_PERS');
    const enabled = data.enabled !== false;

    const rawSecretRef = String(
        (protocol === 'gigachat' ? (data.token || data.apiKey) : (data.apiKey || data.token))
        || (preset?.secretFile ? `secret:${preset.secretFile}` : `secret:${providerId.toLowerCase()}.json`)
    ).trim();
    const secretFile = /^secret:/i.test(rawSecretRef)
        ? rawSecretRef.slice(7).trim()
        : (preset?.secretFile || `${providerId.toLowerCase()}.json`);

    const provRel = path.join('MODELS', providerId, '$provider');
    const secretObj = readSecretJsonSync(rootDir, provRel, secretFile) || {};
    const rawKey = String(secretObj.value ?? secretObj.apiKey ?? secretObj.token ?? secretObj.key ?? '').trim();
    const folderId = String(secretObj.folderId ?? (!/^secret:/i.test(String(data.folderId || '')) ? (data.folderId || '') : '')).trim();
    const maskedKey = rawKey
        ? (rawKey.length > 10 ? `${rawKey.slice(0, 4)}••••••${rawKey.slice(-4)}` : '••••••••')
        : '';

    const activity = evaluateAiNodeActivitySync(providerItem, rootDir);

    // Дочерние модели на диске
    const providerDir = path.join(rootDir, 'MODELS', providerId);
    const installedModels = [];
    if (fs.existsSync(providerDir)) {
        try {
            for (const entry of fs.readdirSync(providerDir, { withFileTypes: true })) {
                if (!entry.isDirectory() || entry.name.startsWith('$') || entry.name.startsWith('#'))
                    continue;
                const aiClassFile = path.join(providerDir, entry.name, '$ai', 'class.js');
                if (!fs.existsSync(aiClassFile))
                    continue;
                let mData = {};
                try {
                    const txt = fs.readFileSync(aiClassFile, 'utf-8');
                    const jsonPart = txt.replace(/^[^{]*/, '').replace(/;\s*$/, '');
                    mData = JSON.parse(jsonPart);
                }
                catch { /* non-json class.js */ }
                const mEnabled = mData.enabled !== false;
                installedModels.push({
                    id: entry.name,
                    path: `/MODELS/${providerId}/${entry.name}`,
                    label: mData.label || entry.name,
                    model: mData.model || entry.name,
                    modality: mData.modality || 'llm',
                    maxTokens: mData.maxTokens || 32768,
                    capabilities: Array.isArray(mData.capabilities) ? mData.capabilities : ['chat', 'stream'],
                    enabled: mEnabled,
                    active: activity.active && mEnabled,
                });
            }
        }
        catch { /* ignore */ }
    }

    return {
        providerId,
        label: data.label || preset?.label || providerId,
        icon: data.icon || preset?.icon || 'carbon:api',
        description: preset?.description || data.description || '',
        protocol,
        baseUrl,
        authUrl,
        scope,
        enabled,
        active: activity.active,
        statusReason: activity.reason,
        hasKey: Boolean(rawKey),
        maskedKey,
        folderId,
        needsFolderId: Boolean(preset?.needsFolderId || protocol === 'yandex'),
        keyLabel: preset?.keyLabel || (protocol === 'gigachat' ? 'Authorization Key (Base64)' : 'API Key'),
        keyPlaceholder: preset?.keyPlaceholder || 'sk-...',
        folderPlaceholder: preset?.folderPlaceholder || 'b1g...',
        secretFile,
        installedModels,
        presetModels: preset?.models || [],
    };
}

/**
 * Сохранить настройки провайдера (API-ключ / токен / Folder ID в `#secret` + `baseUrl` / `scope` / `enabled` в `class.js`).
 */
export function saveProviderConfigSync({
    rootDir = process.cwd(),
    providerId,
    apiKey,
    folderId,
    baseUrl,
    authUrl,
    scope,
    protocol,
    enabled,
} = {}) {
    const id = String(providerId || '').trim();
    if (!id)
        throw new Error('Не указан идентификатор провайдера');
    const preset = findProviderPreset(id);
    const provDir = path.join(rootDir, 'MODELS', id, '$provider');
    const classFile = path.join(provDir, 'class.js');
    const aiProtoFile = path.join(provDir, '$folder', '$class', '$ai', 'class.js');
    const secretFile = preset?.secretFile || `${id.toLowerCase().replace(/[^a-z0-9_-]/gi, '_')}.json`;
    const secretDir = path.join(provDir, '#secret');
    const secretPath = path.join(secretDir, secretFile);

    let existingSecret = {};
    try {
        if (fs.existsSync(secretPath))
            existingSecret = JSON.parse(fs.readFileSync(secretPath, 'utf-8'));
    }
    catch { /* ignore */ }

    const resolvedProto = String(protocol || preset?.protocol || 'openai');
    if (apiKey !== undefined) {
        const cleanKey = String(apiKey || '').trim();
        if (cleanKey) {
            if (resolvedProto === 'gigachat')
                existingSecret.token = cleanKey;
            else
                existingSecret.apiKey = cleanKey;
        }
        else {
            delete existingSecret.token;
            delete existingSecret.apiKey;
            delete existingSecret.value;
            delete existingSecret.key;
        }
    }
    if (folderId !== undefined) {
        const cleanFolder = String(folderId || '').trim();
        if (cleanFolder)
            existingSecret.folderId = cleanFolder;
        else
            delete existingSecret.folderId;
    }
    if (scope !== undefined && resolvedProto === 'gigachat') {
        existingSecret.scope = String(scope || 'GIGACHAT_API_PERS').trim();
    }

    if (Object.keys(existingSecret).length > 0) {
        fs.mkdirSync(secretDir, { recursive: true });
        fs.writeFileSync(secretPath, JSON.stringify(existingSecret, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
    }
    else if (fs.existsSync(secretPath)) {
        fs.rmSync(secretPath, { force: true });
    }

    // Обновим class.js провайдера и прототипа $ai
    const { providerScript, aiProtoScript } = buildProviderClassScripts(preset, {
        id,
        label: preset?.label || id,
        icon: preset?.icon,
        protocol: resolvedProto,
        baseUrl: baseUrl || preset?.baseUrl,
        authUrl: authUrl || preset?.authUrl,
        scope: scope || preset?.scope,
        secretFile,
    });

    let finalProviderScript = providerScript;
    if (enabled === false) {
        const obj = JSON.parse(providerScript.replace(/^export\s+default\s+/, '').replace(/;\s*$/, ''));
        obj.enabled = false;
        finalProviderScript = `export default ${JSON.stringify(obj, null, 4)};\n`;
    }

    fs.mkdirSync(path.dirname(classFile), { recursive: true });
    fs.writeFileSync(classFile, finalProviderScript, 'utf-8');
    fs.mkdirSync(path.dirname(aiProtoFile), { recursive: true });
    fs.writeFileSync(aiProtoFile, aiProtoScript, 'utf-8');

    return { ok: true, providerId: id, secretFile };
}

/**
 * Добавить одну или несколько моделей (`$ai`) в провайдер `/MODELS/<providerId>`.
 */
export function addProviderModelsSync({
    rootDir = process.cwd(),
    providerId,
    models = [],
} = {}) {
    const id = String(providerId || '').trim();
    if (!id)
        throw new Error('Не указан провайдер');
    const preset = findProviderPreset(id);
    const providerDir = path.join(rootDir, 'MODELS', id);
    const list = Array.isArray(models) ? models : [models];
    const created = [];

    for (const raw of list) {
        const spec = typeof raw === 'string'
            ? (preset?.models?.find(m => m.id === raw || m.model === raw) || { id: raw, label: raw, model: raw })
            : raw;
        if (!spec || !(spec.id || spec.model || spec.label))
            continue;
        const rawDirName = String(spec.id || spec.label || spec.model).replace(/[<>:"/\\|?*]/g, '_').trim();
        if (!rawDirName)
            continue;
        const modelClassFile = path.join(providerDir, rawDirName, '$ai', 'class.js');
        fs.mkdirSync(path.dirname(modelClassFile), { recursive: true });
        fs.writeFileSync(modelClassFile, buildModelClassScript({
            ...spec,
            icon: spec.icon || preset?.icon || 'carbon:machine-learning-model',
        }), 'utf-8');
        created.push(`/MODELS/${id}/${rawDirName}`);
    }

    return { ok: true, created };
}

/**
 * Включить или отключить модель `$ai` или провайдер `$provider` (`enabled: true/false`).
 */
export function toggleAiNodeEnabledSync({
    rootDir = process.cwd(),
    nodePath,
    enabled = true,
} = {}) {
    const clean = String(nodePath || '').replace(/^\/+/, '');
    const parts = clean.split('/').filter(Boolean); // ['MODELS', '<Provider>', '<Model>?']
    if (parts[0] !== 'MODELS' || !parts[1])
        throw new Error('Некорректный путь узла ИИ: ' + nodePath);
    const isProvider = parts.length === 2;
    const classFile = isProvider
        ? path.join(rootDir, 'MODELS', parts[1], '$provider', 'class.js')
        : path.join(rootDir, 'MODELS', parts[1], parts[2], '$ai', 'class.js');

    if (!fs.existsSync(classFile))
        throw new Error('Файл class.js не найден: ' + classFile);

    const raw = fs.readFileSync(classFile, 'utf-8');
    let updated = raw;
    try {
        const jsonPart = raw.replace(/^[^{]*/, '').replace(/;\s*$/, '');
        const obj = JSON.parse(jsonPart);
        if (enabled)
            delete obj.enabled;
        else
            obj.enabled = false;
        updated = `export default ${JSON.stringify(obj, null, 4)};\n`;
    }
    catch {
        if (/\benabled\s*:\s*(true|false)\b/.test(raw)) {
            updated = raw.replace(/\benabled\s*:\s*(true|false)\b/, `enabled: ${Boolean(enabled)}`);
        }
        else {
            updated = raw.replace(/export\s+default\s*\{/, `export default {\n    enabled: ${Boolean(enabled)},`);
        }
    }
    fs.writeFileSync(classFile, updated, 'utf-8');
    return { ok: true, path: '/' + parts.join('/'), enabled: Boolean(enabled) };
}

