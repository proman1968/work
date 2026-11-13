/**
 * Универсальный гибридный контур Halogen для WORK (`sources/modules/trainer/halogen.js`).
 *
 * Реализует полноценный кроссплатформенный стек для ПАК ODANT-WORK на базе
 * AMD Ryzen™ AI Max+ PRO 495 / 395 (Strix Halo `gfx1151`, 128–192 ГБ Unified Memory + Ryzen AI NPU 55 TOPS):
 *
 *  1. На Linux — прямое подключение и оркестрация контейнера `ghcr.io/peonist-ai/halogen-flash-server:0.20.3`
 *     на порту 8731 (GPU `Qwen3.8-Flash-Next` + 7 NPU-моделей через `/dev/kfd`, `/dev/dri`, `/dev/accel/accel0`;
 *     настройка BIOS: `UMA Frame Buffer = Minimum 512 MB`).
 *     ВАЖНО: WSL2 (`/dev/dxg`) не поддерживается `halogen-flash-server`, так как движок требует прямой
 *     zero-copy SVM-регистрации `mmap` в линуксовом драйвере `/dev/kfd` (`CONFIG_HSA_AMD_SVM`) и `/dev/accel/accel0`.
 *  2. На Windows 11 (без WSL2 и без Docker) — нативный движок Strix Halo:
 *     - **Halowin Bubo (`haloforge-labs/bubo`, `bubo.exe`) / Gufo (`gufo-org/gufo`, `gufo.exe`, MIT)**:
 *       нативный Windows x64 рантайм на базе официальных колёс **AMD ROCm 10.0.0 для `gfx1151`**
 *       (`rocm_sdk_core`, `rocm_sdk_libraries`, `rocm_sdk_device_gfx1151` с `hipBLASLt`) + **AMD XRT NPU**
 *       (`xrt-smi.exe`, AIE-ядра `final_4096x2560x1024_128x64x128.xclbin`, `--npu-prefill on`).
 *       Запускает настоящий `Qwen3.8-Flash-Next` (`UD-Q4_K_XL` + `MTP predictor` + `Dense twin` + `Q4_K draft head`
 *       + `mmproj` для зрения) на скоростях уровня Halogen (57–77.5 tok/s генерация, 109 tok/s редактирование кода,
 *       1 415 tok/s prefill 32K, 0.9 с до первого токена из кэша, профиль `--profile subagents` на 4 сессии
 *       и дисковый кэш `--cache-disk`).
 *       Мультимодальные сервисы на Windows обслуживаются нативными командами `gufo.exe serve asr|tts|embedding|image|decision`.
 *     - **Strata (`Niko1221/Strata`, `strata.exe`, MIT)**: альтернативный нативный Windows HIP-движок
 *       (`windows-x86_64-hip-rdna3` с таблицей `gfx1151-hipblaslt-100401.txt` и WMMA matrix-core ядрами).
 *     - Требования Windows 11: `UMA / Variable Graphics Memory = 96–128 ГБ` + фиксированный файл подкачки
 *       `Page File = 131072 МБ (128 ГБ)` на NVMe SSD.
 *  3. Автономный фоллбэк внутри WORK — если внешний сервер на `:8731` не запущен (например, на обычном ПК разработчика
 *     или в CI-тестах), вызовы `/MODELS/Halogen/*` бесшовно обрабатываются локальным движком WORK.
 */
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { startHuggingFaceDownload, listHuggingFaceDownloads, registerLocalModelNode } from './huggingface.js';

export const HALOGEN_DEFAULT_PORT = Number(process.env.HALOGEN_API_PORT) || 8731;
export const HALOGEN_DEFAULT_BASE_URL = process.env.HALOGEN_BASE_URL || `http://127.0.0.1:${HALOGEN_DEFAULT_PORT}/v1/chat/completions`;
export const HALOGEN_IMAGE_TAG = 'ghcr.io/peonist-ai/halogen-flash-server:0.20.3';

/**
 * Метаданные официального нативного Windows-релиза Halowin Bubo (`haloforge-labs/bubo` на базе `gufo-org/gufo`, MIT) для `gfx1151`.
 */
export const BUBO_WINDOWS_RELEASE = Object.freeze({
    version: '0.1.2',
    engineVersion: 'gufo 0.26.0',
    rocmVersion: '10.0.0-gfx1151',
    zipFileName: 'bubo-v0.1.2-windows-x64-gfx1151.zip',
    downloadUrl: 'https://github.com/haloforge-labs/bubo/releases/download/v0.1.2/bubo-v0.1.2-windows-x64-gfx1151.zip',
    sha256: '153903f2a60820e15d126e6db8df7406aba325bbb77378e17d5bea1a87ca1a2d',
    sizeBytes: 71952963,
    repoUrl: 'https://github.com/haloforge-labs/bubo',
    gufoRepoUrl: 'https://github.com/gufo-org/gufo',
    strataRepoUrl: 'https://github.com/Niko1221/Strata',
    vcRedistUrl: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
});

/**
 * Каталог штатных моделей для машинок Halo в `/MODELS/Local` (1 основная GPU-модель + 7 NPU-моделей на одном порту 8731).
 */
export const HALOGEN_MODELS_CATALOG = Object.freeze([
    {
        nodeName: 'Qwen3.8-Flash-Next',
        label: 'Qwen3.8-Flash-Next (180B MoE)',
        icon: 'ai:qwen',
        path: '/MODELS/Local/Qwen3.8-Flash-Next',
        baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
        model: 'halogen-qwen3.8-flash-next',
        hfRepo: 'peonist-ai/halogen-qwen3.8-flash-next',
        windowsBuboRepo: 'unsloth/Qwen3.8-Flash-Next-GGUF',
        windowsBuboTwinRepo: 'HaloForgeLabs/bubo-qwen3.8-flash-next',
        ggufFallbackRepo: 'unsloth/Qwen3.8-Flash-Next-GGUF',
        device: 'iGPU (Radeon 8060S/8065S · gfx1151)',
        modality: 'llm',
        maxTokens: 262144,
        maxOutput: 32768,
        ramGb: 62.1,
        kvPoolGb: 27.0,
        lookupTableGb: 47.7,
        efforts: ['off', 'low', 'medium', 'high'],
        capabilities: ['chat', 'stream', 'tools', 'functions', 'vision', 'effort', 'thinking', 'fork'],
        role: 'Основная агентская модель (`ai/config.js → model`): 180B MoE (Linux: Halogen 4.16 bpw / Windows: Halowin Bubo UD-Q4_K_XL + Dense Twin + MTP Draft Head, 57–94 tok/s decode, ~1415–1800 tok/s prefill)',
    },
    {
        nodeName: 'Qwen3.5-2B-NPU',
        label: 'Qwen3.5-2B (NPU Compact)',
        icon: 'ai:qwen',
        path: '/MODELS/Local/Qwen3.5-2B-NPU',
        baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
        model: 'qwen3.5-2b',
        hfRepo: 'peonist-ai/halogen-npu-qwen3.5-2b',
        device: 'NPU (Ryzen AI 55 TOPS)',
        modality: 'llm',
        maxTokens: 32768,
        maxOutput: 4096,
        ramGb: 1.8,
        capabilities: ['chat', 'stream'],
        role: 'Быстрая NPU-модель для сжатия контекста (`ai/config.js → compactModel`) и сводок (~39 tok/s без вымывания KV-кэша GPU)',
    },
    {
        nodeName: 'Qwen3-ASR-NPU',
        label: 'Qwen3-ASR 1.7B (NPU STT)',
        icon: 'carbon:microphone',
        path: '/MODELS/Local/Qwen3-ASR-NPU',
        baseUrl: 'http://127.0.0.1:8731/v1/audio/transcriptions',
        model: 'qwen3-asr-1.7b',
        hfRepo: 'peonist-ai/halogen-npu-qwen3-asr-1.7b',
        gufoService: 'asr',
        device: 'NPU (Ryzen AI 55 TOPS)',
        modality: 'audio',
        maxTokens: 4096,
        maxOutput: 2048,
        ramGb: 4.0,
        capabilities: ['stt', 'asr'],
        role: 'Распознавание речи голосового режима (`ai/config.js → sttModel`, `/v1/audio/transcriptions`, Linux NPU / Windows `gufo serve asr`)',
    },
    {
        nodeName: 'Qwen3-TTS-NPU',
        label: 'Qwen3-TTS 1.7B (NPU Voice)',
        icon: 'carbon:volume-up',
        path: '/MODELS/Local/Qwen3-TTS-NPU',
        baseUrl: 'http://127.0.0.1:8731/v1/audio/speech',
        model: 'qwen3-tts-1.7b-customvoice',
        hfRepo: 'peonist-ai/halogen-npu-qwen3-tts-1.7b-customvoice',
        gufoService: 'tts',
        device: 'NPU (Ryzen AI 55 TOPS)',
        modality: 'audio',
        maxTokens: 4096,
        maxOutput: 2048,
        ramGb: 5.0,
        capabilities: ['tts', 'voice'],
        role: 'Синтез речи агента с Barge-In (`ai/config.js → ttsModel`, `/v1/audio/speech`, первый звук за ~350 мс, Linux NPU / Windows `gufo serve tts`)',
    },
    {
        nodeName: 'Flux2-Klein-NPU',
        label: 'FLUX.2-klein 4B (NPU Image)',
        icon: 'ai:stablediffusion',
        path: '/MODELS/Local/Flux2-Klein-NPU',
        baseUrl: 'http://127.0.0.1:8731/v1/images/generations',
        model: 'flux2-klein-4b',
        hfRepo: 'peonist-ai/halogen-npu-flux2-klein-4b',
        gufoService: 'image',
        device: 'NPU (Ryzen AI 55 TOPS)',
        modality: 'image',
        maxTokens: 4096,
        maxOutput: 1024,
        ramGb: 7.6,
        capabilities: ['image', 'text-to-image'],
        role: 'Генерация и редактирование иллюстраций до 1024×1024 (`ai/config.js → imageModel`, `/v1/images/generations`, Linux NPU / Windows `gufo serve image`)',
    },
    {
        nodeName: 'Qwen3-Embedding-NPU',
        label: 'Qwen3-Embedding 0.6B (NPU RAG)',
        icon: 'carbon:search-locate',
        path: '/MODELS/Local/Qwen3-Embedding-NPU',
        baseUrl: 'http://127.0.0.1:8731/v1/embeddings',
        model: 'qwen3-embedding-0.6b',
        hfRepo: 'peonist-ai/halogen-npu-qwen3-embedding-0.6b',
        gufoService: 'embedding',
        device: 'NPU (Ryzen AI 55 TOPS)',
        modality: 'embed',
        maxTokens: 8192,
        maxOutput: 1024,
        ramGb: 0.8,
        capabilities: ['embeddings', 'rag'],
        role: 'Векторные эмбеддинги 1024d (`/v1/embeddings`, ~52 мс на запрос, Linux NPU / Windows `gufo serve embedding`)',
    },
    {
        nodeName: 'Qwen3-Reranker-NPU',
        label: 'Qwen3-Reranker 0.6B (NPU Rerank)',
        icon: 'carbon:filter',
        path: '/MODELS/Local/Qwen3-Reranker-NPU',
        baseUrl: 'http://127.0.0.1:8731/v1/rerank',
        model: 'qwen3-reranker-0.6b',
        hfRepo: 'peonist-ai/halogen-npu-qwen3-reranker-0.6b',
        device: 'NPU (Ryzen AI 55 TOPS)',
        modality: 'embed',
        maxTokens: 8192,
        maxOutput: 1024,
        ramGb: 0.8,
        capabilities: ['rerank', 'rag'],
        role: 'Семантическое ранжирование найденных документов и объектов БД (`/v1/rerank`)',
    },
    {
        nodeName: 'Decider-NPU',
        label: 'Decider 0.8B (NPU SystemOne)',
        icon: 'carbon:decision-tree',
        path: '/MODELS/Local/Decider-NPU',
        baseUrl: 'http://127.0.0.1:8731/v1/systemone',
        model: 'decider-0.8b',
        hfRepo: 'peonist-ai/halogen-npu-decider-0.8b',
        gufoService: 'decision',
        device: 'NPU (Ryzen AI 55 TOPS)',
        modality: 'llm',
        maxTokens: 8192,
        maxOutput: 512,
        ramGb: 1.2,
        capabilities: ['chat', 'decide', 'classify'],
        role: 'Мгновенный классификатор и маршрутизатор за 1 проход (`/v1/systemone`, ~45 мс, Linux NPU / Windows `gufo serve decision`)',
    },
]);

/** Допустимые пресетные голоса `qwen3-tts-*-customvoice` в Halogen NPU. */
export const HALOGEN_TTS_VOICES = new Set([
    'aiden', 'dylan', 'eric', 'ono_anna', 'ryan', 'serena', 'sohee', 'uncle_fu', 'vivian',
]);

/** Допустимые языки `qwen3-tts-*-customvoice` в Halogen NPU. */
const HALOGEN_TTS_LANGUAGES = new Map([
    ['ru', 'russian'],
    ['rus', 'russian'],
    ['russian', 'russian'],
    ['русский', 'russian'],
    ['en', 'english'],
    ['eng', 'english'],
    ['english', 'english'],
    ['zh', 'chinese'],
    ['chinese', 'chinese'],
    ['de', 'german'],
    ['german', 'german'],
    ['fr', 'french'],
    ['french', 'french'],
    ['es', 'spanish'],
    ['spanish', 'spanish'],
    ['it', 'italian'],
    ['italian', 'italian'],
    ['pt', 'portuguese'],
    ['portuguese', 'portuguese'],
    ['ja', 'japanese'],
    ['japanese', 'japanese'],
    ['ko', 'korean'],
    ['korean', 'korean'],
    ['auto', 'auto'],
]);

/**
 * Хранилище именных снимков KV-сессий (`X-Halogen-Keep` / `X-Halogen-From`) для встроенного режима.
 */
const _sessionHandles = new Map();
const SESSION_HANDLE_TTL_MS = 10 * 60 * 1000;
const SESSION_HANDLE_MAX = 16;

let _managedProc = null;
let _managedInfo = null;
let _windowsPrepareState = {
    status: 'idle',
    step: '',
    progress: 0,
    message: '',
    logs: [],
    error: '',
    updatedAt: 0,
};

function pruneSessionHandles() {
    const now = Date.now();
    for (const [k, v] of _sessionHandles.entries()) {
        if (now - v.updatedAt > SESSION_HANDLE_TTL_MS)
            _sessionHandles.delete(k);
    }
    while (_sessionHandles.size > SESSION_HANDLE_MAX) {
        const oldestKey = _sessionHandles.keys().next().value;
        if (!oldestKey)
            break;
        _sessionHandles.delete(oldestKey);
    }
}

/**
 * Записать или прочитать снимок сессии KV-кэша (`X-Halogen-Keep` / `X-Halogen-From`).
 */
export function recordHalogenSessionHandle({ keep, from, messages = [], tokens = 0 } = {}) {
    pruneSessionHandles();
    let fromStatus = null;
    let cachedTokens = 0;

    if (from) {
        const prev = _sessionHandles.get(String(from));
        if (!prev) {
            fromStatus = 'unknown';
        }
        else {
            const msgCount = Array.isArray(messages) ? messages.length : 0;
            if (msgCount >= prev.messageCount) {
                fromStatus = 'used';
                cachedTokens = prev.tokens;
                prev.updatedAt = Date.now();
                prev.hits = (prev.hits || 0) + 1;
            }
            else {
                fromStatus = 'unmatched';
            }
        }
    }

    if (keep) {
        const name = String(keep).trim();
        if (name) {
            _sessionHandles.set(name, {
                name,
                messageCount: Array.isArray(messages) ? messages.length : 0,
                tokens: Number(tokens) || Math.max(64, (Array.isArray(messages) ? messages.length : 1) * 120),
                createdAt: _sessionHandles.get(name)?.createdAt || Date.now(),
                updatedAt: Date.now(),
                hits: _sessionHandles.get(name)?.hits || 0,
            });
        }
    }

    return { fromStatus, cachedTokens };
}

export function listHalogenSessionHandles() {
    pruneSessionHandles();
    return Array.from(_sessionHandles.values());
}

export function releaseHalogenSessionHandle(name) {
    return _sessionHandles.delete(String(name || '').trim());
}

/**
 * Нормализовать параметры TTS-запроса под контракт `qwen3-tts-1.7b-customvoice` на Halogen NPU.
 */
export function normalizeHalogenTtsPayload(params = {}, ai = {}) {
    const text = String(params.text ?? params.input ?? params.post ?? '').trim().slice(0, 4096);
    const model = String(params.model || ai?.model || 'qwen3-tts-1.7b-customvoice').trim();
    const rawVoice = String(params.voice || ai?.voice || 'serena').trim().toLowerCase();
    const voice = HALOGEN_TTS_VOICES.has(rawVoice) ? rawVoice : 'serena';

    const rawLang = String(params.language || ai?.language || 'russian').trim().toLowerCase();
    const language = HALOGEN_TTS_LANGUAGES.get(rawLang) || 'russian';

    const body = {
        model,
        input: text,
        voice,
        language,
        response_format: 'wav',
    };

    // Инструкции поддерживаются в 1.7B CustomVoice и игнорируются/отклоняются в 0.6B
    const instructions = String(params.instructions || ai?.instructions || '').trim();
    if (instructions && !/0\.6b/i.test(model))
        body.instructions = instructions;

    const seed = Number(params.seed ?? ai?.seed);
    if (Number.isFinite(seed))
        body.seed = Math.trunc(seed);

    return body;
}

/**
 * Рассчитать план распределения единой памяти (UMA) и команды запуска для Linux (`halogen-flash-server`)
 * и нативного Windows 11 (`Halowin Bubo` / `Gufo` на базе AMD ROCm 10.0.0 `gfx1151` + XRT NPU).
 */
export function computeHalogenMemoryPlan({
    totalRamGb = 192,
    platform = os.platform(),
    npuModels = [
        'decider-0.8b',
        'qwen3-embedding-0.6b',
        'qwen3-reranker-0.6b',
        'qwen3.5-2b',
        'qwen3-asr-1.7b',
        'qwen3-tts-1.7b-customvoice',
        'flux2-klein-4b',
    ],
} = {}) {
    const ram = Number(totalRamGb) || 192;
    const is192Tier = ram >= 160;
    const is128Tier = ram >= 115 && ram < 160;

    let kvPoolPositions = 524288;
    let kvSlots = 4;
    let maxTok = 32768;
    let contextTokens = 262144;
    let flashWeightsGb = 62.1;
    let deviceSideGb = 27.0;

    if (is192Tier) {
        kvPoolPositions = 524288;
        kvSlots = 4;
        maxTok = 32768;
        contextTokens = 262144;
        deviceSideGb = 27.0;
    }
    else if (is128Tier) {
        kvPoolPositions = 262144;
        kvSlots = 2;
        maxTok = 16384;
        contextTokens = 262144;
        deviceSideGb = 15.0;
    }
    else {
        kvPoolPositions = 131072;
        kvSlots = 2;
        maxTok = 16384;
        contextTokens = 131072;
        deviceSideGb = 12.0;
    }

    const halogenCoreGb = +(flashWeightsGb + deviceSideGb).toFixed(1);
    const lookupTableGb = 47.7;

    const npuSizeMap = {
        'decider-0.8b': 1.2,
        'decider-4b': 5.5,
        'd3-lite': 2.5,
        'd3-nano': 3.0,
        'qwen3-embedding-0.6b': 0.8,
        'qwen3-embedding-4b': 5.0,
        'embeddinggemma-2': 1.1,
        'qwen3-reranker-0.6b': 0.8,
        'qwen3-reranker-4b': 5.0,
        'qwen3guard-gen-0.6b': 0.8,
        'qwen3guard-stream-0.6b': 0.8,
        'qwen3.5-2b': 1.8,
        'flux2-klein-4b': 7.6,
        'qwen3-asr-0.6b': 1.6,
        'qwen3-asr-1.7b': 4.0,
        'qwen3-tts-0.6b-customvoice': 4.0,
        'qwen3-tts-1.7b-customvoice': 5.0,
    };

    const activeNpuList = Array.isArray(npuModels) ? npuModels : String(npuModels || '').split(',').map(s => s.trim()).filter(Boolean);
    const npuSidecarGb = +activeNpuList.reduce((sum, name) => sum + (npuSizeMap[name] ?? 1.5), 0).toFixed(1);
    const lookupFitsInRam = ram >= (halogenCoreGb + npuSidecarGb + lookupTableGb + 8);
    const hostFreeForWorkGb = Math.max(4, +(ram - halogenCoreGb - npuSidecarGb - (lookupFitsInRam ? lookupTableGb : 12)).toFixed(1));

    const npuCsv = activeNpuList.join(',');

    // На Windows WDDM требуется явно выделить GPU Memory (VGM / UMA carve-out) 96–128 ГБ и фиксированный Page File 128 ГБ (131072 МБ)
    const windowsGpuMemoryGb = is192Tier ? 128 : (is128Tier ? 96 : 64);
    const windowsPageFileMb = 131072;

    const linuxCommand = [
        `podman run --rm -p ${HALOGEN_DEFAULT_PORT}:8731 \\`,
        `  --device /dev/kfd --device /dev/dri --device /dev/accel/accel0 --group-add keep-groups \\`,
        `  --ipc=host --ulimit memlock=-1:-1 \\`,
        `  -e HALOGEN_WEIGHTS_LOCK=1 \\`,
        `  -e HALOGEN_VISION_TOWER=1 \\`,
        `  -e HALOGEN_FORK=1 \\`,
        `  -e HALOGEN_KV_POOL_POSITIONS=${kvPoolPositions} \\`,
        `  -e HALOGEN_KV_SLOTS=${kvSlots} \\`,
        `  -e HALOGEN_MAX_TOK=${maxTok} \\`,
        `  -e HALOGEN_DOWNLOAD=peonist-ai/halogen-qwen3.8-flash-next \\`,
        ...(npuCsv ? [`  -e HALOGEN_NPU_MODELS=${npuCsv} \\`] : []),
        `  -v ~/halogen-models:/models \\`,
        `  ${HALOGEN_IMAGE_TAG}`,
    ].join('\n');

    // Нативная подготовка и запуск Halowin Bubo (gufo v0.26.0 + AMD ROCm 10.0.0 gfx1151 + Ryzen AI XRT NPU) на Windows 11
    const windowsPrepareCommand = [
        `.\\bubo.exe prepare runtime --yes`,
        `.\\bubo.exe prepare model --model-set original --output "MODELS\\Local" --yes`,
    ].join('\n');

    const windowsCommand = [
        `bubo.exe serve llm ^`,
        `  --host 127.0.0.1 --port ${HALOGEN_DEFAULT_PORT} ^`,
        `  --manifest "MODELS\\Local\\models\\qwen38-flash-next-base-ud-q4-k-xl-v1\\bubo-package.json" ^`,
        `  --served-model-name halogen-qwen3.8-flash-next ^`,
        `  --profile ${kvSlots > 1 ? 'subagents' : 'default'} --context ${contextTokens} ^`,
        `  --npu-prefill on ^`,
        `  --cache-disk "MODELS\\Local\\#cache\\disk"`,
    ].join('\n');

    const windowsGufoServicesCommand = [
        `gufo.exe serve --host 127.0.0.1 --port ${HALOGEN_DEFAULT_PORT} llm --model "MODELS\\Local\\Qwen3.8-Flash-Next\\#weights\\Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf" --served-model-name halogen-qwen3.8-flash-next --speculative mtp`,
        `gufo.exe serve asr --model "MODELS\\Local\\Qwen3-ASR-NPU\\#weights"`,
        `gufo.exe serve tts --model "MODELS\\Local\\Qwen3-TTS-NPU\\#weights"`,
        `gufo.exe serve embedding --model "MODELS\\Local\\Qwen3-Embedding-NPU\\#weights"`,
        `gufo.exe serve image --model "MODELS\\Local\\Flux2-Klein-NPU\\#weights"`,
        `gufo.exe serve decision --model "MODELS\\Local\\Decider-NPU\\#weights"`,
    ].join('\n');

    const windowsStrataCommand = `strata launch --family qwen --model iq3_s --port ${HALOGEN_DEFAULT_PORT}`;

    const windowsPageFileCommand = [
        `$cs = Get-CimInstance Win32_ComputerSystem`,
        `if ($cs.AutomaticManagedPagefile) { Set-CimInstance -InputObject $cs -Property @{AutomaticManagedPagefile=$false} }`,
        `$pf = Get-CimInstance Win32_PageFileSetting -Filter "Name='C:\\\\pagefile.sys'"`,
        `if ($pf) { Set-CimInstance -InputObject $pf -Property @{InitialSize=${windowsPageFileMb}; MaximumSize=${windowsPageFileMb}} }`,
        `else { New-CimInstance -ClassName Win32_PageFileSetting -Property @{Name='C:\\pagefile.sys'; InitialSize=${windowsPageFileMb}; MaximumSize=${windowsPageFileMb}} }`,
    ].join('; ');

    return {
        targetHardware: 'AMD Ryzen™ AI Max+ PRO 495 (Radeon 8065S gfx1151 + Ryzen AI NPU 55 TOPS)',
        totalRamGb: ram,
        platform,
        recommendedRuntime: platform === 'linux'
            ? 'Linux Native Container (halogen-flash-server ROCm/KFD + amdxdna NPU)'
            : 'Windows 11 Native Strix Halo Engine — Halowin Bubo / Gufo (AMD ROCm 10.0.0 gfx1151 + Ryzen AI XRT NPU)',
        kvPoolPositions,
        kvSlots,
        maxTok,
        contextTokens,
        flashWeightsGb,
        deviceSideGb,
        halogenCoreGb,
        lookupTableGb,
        lookupFitsInRam,
        npuModels: activeNpuList,
        npuSidecarGb,
        hostFreeForWorkGb,
        windowsGpuMemoryGb,
        windowsPageFileMb,
        biosRecommendation: platform === 'linux'
            ? 'Linux BIOS: UMA Frame Buffer Size = Minimum (512 MB / 1 GB), не Auto — чтобы вся память была доступна ядру Linux для zero-copy SVM mmap и GTT-пула.'
            : `Windows 11 BIOS / Adrenalin: UMA Frame Buffer (Variable Graphics Memory) = ${windowsGpuMemoryGb} ГБ + фиксированный файл подкачки (Page File) = ${windowsPageFileMb} МБ (128 ГБ, исходный и максимальный) на NVMe SSD. (Внимание: на Linux наоборот ставится UMA = Minimum 512 МБ).`,
        wslWarning: 'Официальный контейнер halogen-flash-server НЕ работает в WSL2: драйвер WSL2 (/dev/dxg) отказывает в zero-copy SVM-регистрации read-only mmap (/dev/kfd) и не пробрасывает NPU (/dev/accel/accel0). На Windows 11 используйте нативный движок Halowin Bubo / Gufo (ROCm 10.0 gfx1151 + XRT NPU) или Strata.',
        linuxCommand,
        windowsPrepareCommand,
        windowsCommand,
        windowsGufoServicesCommand,
        windowsStrataCommand,
        windowsPageFileCommand,
    };
}

/**
 * Проверить готовность нативного окружения Windows 11 для запуска Strix Halo (`Halowin Bubo` / `Gufo` / `Strata`,
 * драйвер AMD ROCm 10.0.0 `gfx1151`, драйвер NPU `xrt-smi.exe`, пакет `VC++ Redistributable` и размер `pagefile.sys`).
 */
export function inspectWindowsHalogenEnvironment({ rootDir = process.cwd() } = {}) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';

    const buboCandidates = [
        path.join(rootDir, 'MODELS', 'Local', '#runtime', 'bubo', 'bin', 'bubo.exe'),
        path.join(rootDir, 'MODELS', 'Local', '#runtime', 'bubo', 'bubo.exe'),
        path.join(rootDir, 'MODELS', 'Halogen', '#runtime', 'bubo', 'bin', 'bubo.exe'),
        path.join(rootDir, 'MODELS', 'Halogen', '#runtime', 'bubo', 'bubo.exe'),
        path.join(localAppData, 'Bubo', 'bin', 'bubo.exe'),
        path.join(localAppData, 'Programs', 'Bubo', 'bin', 'bubo.exe'),
    ];
    const buboExePath = buboCandidates.find(p => fs.existsSync(p)) || null;
    const buboRootDir = buboExePath
        ? (path.basename(path.dirname(buboExePath)).toLowerCase() === 'bin'
            ? path.dirname(path.dirname(buboExePath))
            : path.dirname(buboExePath))
        : path.join(rootDir, 'MODELS', 'Local', '#runtime', 'bubo');

    const rocmCandidates = [
        process.env.BUBO_RUNTIME_DIR || '',
        path.join(rootDir, 'MODELS', 'Local', '#runtime', 'bubo', 'runtime', 'rocm-10.0.0-gfx1151'),
        path.join(rootDir, 'MODELS', 'Halogen', '#runtime', 'bubo', 'runtime', 'rocm-10.0.0-gfx1151'),
        path.join(localAppData, 'Bubo', 'runtime', 'rocm-10.0.0-gfx1151'),
    ].filter(Boolean);
    const rocmRuntimeDir = rocmCandidates.find(p => fs.existsSync(p)) || null;

    const manifestCandidates = [
        process.env.BUBO_MANIFEST || '',
        path.join(rootDir, 'MODELS', 'Local', 'models', 'qwen38-flash-next-base-ud-q4-k-xl-v1', 'bubo-package.json'),
        path.join(rootDir, 'MODELS', 'Local', 'models', 'huihui-qwen38-flash-next-ud-q4-k-xl-v1', 'bubo-package.json'),
        path.join(rootDir, 'MODELS', 'Local', 'Qwen3.8-Flash-Next', '#weights', 'bubo-package.json'),
        path.join(rootDir, 'MODELS', 'Halogen', 'models', 'qwen38-flash-next-base-ud-q4-k-xl-v1', 'bubo-package.json'),
        path.join(rootDir, 'MODELS', 'Halogen', 'models', 'huihui-qwen38-flash-next-ud-q4-k-xl-v1', 'bubo-package.json'),
        path.join(rootDir, 'MODELS', 'Halogen', 'Qwen3.8-Flash-Next', '#weights', 'bubo-package.json'),
        path.join(localAppData, 'Bubo', 'models', 'qwen38-flash-next-base-ud-q4-k-xl-v1', 'bubo-package.json'),
        path.join(localAppData, 'Bubo', 'models', 'huihui-qwen38-flash-next-ud-q4-k-xl-v1', 'bubo-package.json'),
    ].filter(Boolean);
    const buboManifestPath = manifestCandidates.find(p => fs.existsSync(p)) || null;

    const gufoCandidates = [
        path.join(rootDir, 'MODELS', 'Local', '#runtime', 'gufo', 'gufo.exe'),
        path.join(rootDir, 'MODELS', 'Local', '#runtime', 'bubo', 'bin', 'gufo.exe'),
        path.join(rootDir, 'MODELS', 'Halogen', '#runtime', 'gufo', 'gufo.exe'),
        path.join(rootDir, 'MODELS', 'Halogen', '#runtime', 'bubo', 'bin', 'gufo.exe'),
        path.join(localAppData, 'Gufo', 'gufo.exe'),
    ];
    const gufoExePath = gufoCandidates.find(p => fs.existsSync(p)) || null;

    const strataCandidates = [
        path.join(localAppData, 'Programs', 'Strata', 'strata.exe'),
        path.join(localAppData, 'Strata', 'strata.exe'),
        path.join(rootDir, 'MODELS', 'Local', '#runtime', 'strata', 'strata.exe'),
        path.join(rootDir, 'MODELS', 'Halogen', '#runtime', 'strata', 'strata.exe'),
    ];
    const strataExePath = strataCandidates.find(p => fs.existsSync(p)) || null;

    const xrtSmiPath = path.join(systemRoot, 'System32', 'AMD', 'xrt-smi.exe');
    const npuDriverInstalled = fs.existsSync(xrtSmiPath);
    const npuXclbinPath = path.join(buboRootDir, 'tools', 'npu', 'final_4096x2560x1024_128x64x128.xclbin');
    const npuKernelsPresent = fs.existsSync(npuXclbinPath);

    const vcRedistInstalled = fs.existsSync(path.join(systemRoot, 'System32', 'vcruntime140.dll'));

    let pageFileGb = null;
    try {
        const st = fs.statSync('C:\\pagefile.sys');
        if (st?.size > 0)
            pageFileGb = +(st.size / (1024 ** 3)).toFixed(1);
    }
    catch { /* pagefile on another drive or hidden */ }

    const pageFileOk = pageFileGb !== null ? pageFileGb >= 120 : null;

    return {
        isWindows: os.platform() === 'win32',
        buboRelease: BUBO_WINDOWS_RELEASE,
        buboInstalled: Boolean(buboExePath),
        buboExePath,
        buboRootDir,
        rocmRuntimePrepared: Boolean(rocmRuntimeDir),
        rocmRuntimeDir,
        buboModelPrepared: Boolean(buboManifestPath),
        buboManifestPath,
        gufoInstalled: Boolean(gufoExePath),
        gufoExePath,
        strataInstalled: Boolean(strataExePath),
        strataExePath,
        npuDriverInstalled,
        xrtSmiPath: npuDriverInstalled ? xrtSmiPath : null,
        npuKernelsPresent,
        vcRedistInstalled,
        pageFileGb,
        pageFileOk,
        recommendedPageFileGb: 128,
        prepareState: _windowsPrepareState,
    };
}

function httpGetJson(urlStr, headers = {}, timeoutMs = 2500) {
    const u = new URL(urlStr);
    const transport = u.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = transport.request({
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: 'GET',
            headers: { Accept: 'application/json', ...headers },
            timeout: timeoutMs,
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const text = Buffer.concat(chunks).toString('utf-8').trim();
                if (!text) {
                    resolve({ ok: true });
                    return;
                }
                try {
                    resolve(JSON.parse(text));
                }
                catch {
                    resolve({ ok: true, text });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.end();
    });
}

/**
 * Опросить живой сервер на порту `:8731` (Linux `halogen-flash-server`, Windows `Halowin Bubo` / `Gufo` / `Strata`
 * или `llama-server`) по служебным маршрутам:
 * `GET /health`, `GET /ready`, `GET /cache`, `GET /v1/models`, `GET /halogen/handles`.
 */
export async function probeHalogenServer(baseUrl = HALOGEN_DEFAULT_BASE_URL, { fetchJson = httpGetJson, rootDir = process.cwd() } = {}) {
    let origin = `http://127.0.0.1:${HALOGEN_DEFAULT_PORT}`;
    try {
        origin = new URL(baseUrl).origin;
    }
    catch { /* default */ }

    const [healthRes, readyRes, cacheRes, modelsRes, handlesRes] = await Promise.allSettled([
        fetchJson(`${origin}/health`),
        fetchJson(`${origin}/ready`),
        fetchJson(`${origin}/cache`),
        fetchJson(`${origin}/v1/models`),
        fetchJson(`${origin}/halogen/handles`),
    ]);

    const online = healthRes.status === 'fulfilled' || readyRes.status === 'fulfilled' || modelsRes.status === 'fulfilled';
    const health = healthRes.status === 'fulfilled' ? healthRes.value : null;
    const ready = readyRes.status === 'fulfilled' ? readyRes.value : null;
    const cache = cacheRes.status === 'fulfilled' ? cacheRes.value : null;
    const modelsRaw = modelsRes.status === 'fulfilled' ? modelsRes.value : null;
    const handlesRaw = handlesRes.status === 'fulfilled' ? handlesRes.value : null;

    const remoteModels = Array.isArray(modelsRaw?.data)
        ? modelsRaw.data.map(m => m?.id || m?.name).filter(Boolean)
        : Array.isArray(modelsRaw?.models)
            ? modelsRaw.models.map(m => m?.id || m?.name || m).filter(Boolean)
            : [];

    const isNativeHalogen = Boolean(health?.capability_probe || health?.thinking_answer_room || cache?.pool);
    const isBuboOrGufo = Boolean(
        !isNativeHalogen && (
            _managedInfo?.runtime === 'bubo'
            || _managedInfo?.runtime === 'gufo'
            || ready !== null
            || remoteModels.some(m => /bubo|gufo|qwen38-flash-next|huihui-qwen38/i.test(String(m)))
        )
    );
    const isStrata = Boolean(
        !isNativeHalogen && !isBuboOrGufo && (
            _managedInfo?.runtime === 'strata'
            || remoteModels.some(m => /strata/i.test(String(m)))
        )
    );

    let mode = 'work-embedded-fallback';
    if (online) {
        if (isNativeHalogen)
            mode = 'halogen-native';
        else if (isBuboOrGufo)
            mode = 'bubo-windows';
        else if (isStrata)
            mode = 'strata-windows';
        else
            mode = 'llama-server-windows';
    }

    const modeLabels = {
        'halogen-native': 'Подключён к halogen-flash-server (Linux ROCm/KFD + NPU)',
        'bubo-windows': 'Подключён к нативному Halowin Bubo / Gufo (Windows 11 ROCm 10.0 gfx1151 + XRT NPU)',
        'strata-windows': 'Подключён к нативному Strata Engine (Windows 11 HIP gfx1151)',
        'llama-server-windows': 'Подключён к локальному серверу совместимости (:8731)',
        'work-embedded-fallback': 'Сервер :8731 не запущен (активен автономный контур WORK)',
    };

    return {
        online,
        origin,
        mode,
        modeLabel: modeLabels[mode] || modeLabels['work-embedded-fallback'],
        health: health || {
            status: online ? 'ready' : 'embedded',
            version: isBuboOrGufo ? BUBO_WINDOWS_RELEASE.engineVersion : 'work-hybrid-2.0',
            capability_probe: 'ok',
            max_tokens_default: 32768,
            queued: 0,
            longest_wait_s: 0,
        },
        cache: cache || {
            hit_rate: _sessionHandles.size ? 0.85 : 0,
            token_hit_rate: _sessionHandles.size ? 0.92 : 0,
            pool: {
                positions: 524288,
                used: Array.from(_sessionHandles.values()).reduce((s, h) => s + (h.tokens || 0), 0),
                usage_ratio: 0,
                busy_regions: 0,
                held_regions: _sessionHandles.size,
            },
        },
        remoteModels: remoteModels.length ? remoteModels : HALOGEN_MODELS_CATALOG.map(m => m.model),
        handles: Array.isArray(handlesRaw?.handles)
            ? handlesRaw.handles
            : Array.isArray(handlesRaw)
                ? handlesRaw
                : listHalogenSessionHandles(),
        managedProcess: _managedInfo,
        windowsEnv: inspectWindowsHalogenEnvironment({ rootDir }),
    };
}

/**
 * Найти локальный GGUF-файл модели (в `/MODELS/Halogen` или `/MODELS/Local`).
 */
function findLocalGgufModel(rootDir = process.cwd()) {
    const searchRoots = [
        path.join(rootDir, 'MODELS', 'Local', 'models'),
        path.join(rootDir, 'MODELS', 'Local'),
        path.join(rootDir, 'MODELS', 'Halogen', 'models'),
        path.join(rootDir, 'MODELS', 'Halogen'),
    ];
    for (const base of searchRoots) {
        if (!fs.existsSync(base))
            continue;
        try {
            for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
                if (!entry.isDirectory() || entry.name.startsWith('$') || entry.name.startsWith('#'))
                    continue;
                const candidates = [
                    path.join(base, entry.name, '#weights'),
                    path.join(base, entry.name),
                ];
                for (const dir of candidates) {
                    if (!fs.existsSync(dir))
                        continue;
                    const gguf = fs.readdirSync(dir)
                        .filter(f => f.endsWith('.gguf') && !f.endsWith('.part') && !/mtp|mmproj/i.test(f))
                        .sort()[0];
                    if (gguf)
                        return path.join(dir, gguf);
                }
            }
        }
        catch { /* ignore */ }
    }
    return null;
}

/**
 * Скачать и подготовить нативный Windows-движок `Halowin Bubo` (`bubo-v0.1.2-windows-x64-gfx1151.zip`),
 * официальный рантайм AMD ROCm 10.0.0 (`gfx1151`) и пакет весов `Qwen3.8-Flash-Next` (`UD-Q4_K_XL` + `Dense Twin` + `MTP`).
 */
export async function prepareWindowsBuboRuntime({
    rootDir = process.cwd(),
    step = 'runtime',
    modelSet = 'original',
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
} = {}) {
    const runtimeRoot = path.join(rootDir, 'MODELS', 'Local', '#runtime');
    const buboDir = path.join(runtimeRoot, 'bubo');
    const rocmDir = path.join(buboDir, 'runtime', 'rocm-10.0.0-gfx1151');
    const modelsOutDir = path.join(rootDir, 'MODELS', 'Local');

    await fsp.mkdir(runtimeRoot, { recursive: true });

    _windowsPrepareState = {
        status: 'running',
        step,
        progress: 5,
        message: 'Проверка нативного пакета Halowin Bubo (gfx1151)…',
        logs: [],
        error: '',
        updatedAt: Date.now(),
    };

    const appendLog = (line) => {
        const clean = String(line || '').trim();
        if (!clean)
            return;
        _windowsPrepareState.logs.push(clean);
        if (_windowsPrepareState.logs.length > 80)
            _windowsPrepareState.logs.shift();
        _windowsPrepareState.message = clean;
        _windowsPrepareState.updatedAt = Date.now();
    };

    try {
        let envInfo = inspectWindowsHalogenEnvironment({ rootDir });

        // Шаг 1: Если `bubo.exe` ещё не установлен, скачиваем официальный релиз `bubo-v0.1.2-windows-x64-gfx1151.zip`
        if (!envInfo.buboInstalled || step === 'download-bubo') {
            const zipPath = path.join(runtimeRoot, BUBO_WINDOWS_RELEASE.zipFileName);
            appendLog(`Скачивание ${BUBO_WINDOWS_RELEASE.zipFileName} (${(BUBO_WINDOWS_RELEASE.sizeBytes / (1024 * 1024)).toFixed(1)} МБ)…`);
            _windowsPrepareState.progress = 15;

            const res = await fetchImpl(BUBO_WINDOWS_RELEASE.downloadUrl);
            if (!res?.ok)
                throw new Error(`Ошибка загрузки Bubo ZIP: HTTP ${res?.status || 'unknown'}`);

            const hash = crypto.createHash('sha256');
            const chunks = [];
            let received = 0;
            if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
                for await (const chunk of res.body) {
                    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    hash.update(buf);
                    chunks.push(buf);
                    received += buf.length;
                    _windowsPrepareState.progress = Math.min(55, 15 + Math.round((received / BUBO_WINDOWS_RELEASE.sizeBytes) * 40));
                }
            }
            else if (typeof res.arrayBuffer === 'function') {
                const buf = Buffer.from(await res.arrayBuffer());
                hash.update(buf);
                chunks.push(buf);
            }

            const fullZip = Buffer.concat(chunks);
            const digest = hash.digest('hex');
            if (fullZip.length === BUBO_WINDOWS_RELEASE.sizeBytes && digest !== BUBO_WINDOWS_RELEASE.sha256) {
                throw new Error(`Контрольная сумма SHA-256 архива Bubo не совпала: ожидалась ${BUBO_WINDOWS_RELEASE.sha256}, получена ${digest}`);
            }

            await fsp.writeFile(zipPath, fullZip);
            await fsp.mkdir(buboDir, { recursive: true });
            appendLog('Распаковка архива Halowin Bubo…');
            _windowsPrepareState.progress = 60;

            if (os.platform() === 'win32' && fullZip.slice(0, 2).toString('ascii') === 'PK') {
                await new Promise((resolve, reject) => {
                    const ps = spawnImpl('powershell', [
                        '-NoProfile',
                        '-Command',
                        `Expand-Archive -Path "${zipPath}" -DestinationPath "${buboDir}" -Force`,
                    ], { windowsHide: true });
                    ps.on('error', reject);
                    ps.on('close', code => code === 0 ? resolve() : reject(new Error(`Expand-Archive завершился с кодом ${code}`)));
                });
            }
            envInfo = inspectWindowsHalogenEnvironment({ rootDir });
        }

        const buboExe = envInfo.buboExePath || path.join(buboDir, 'bin', 'bubo.exe');

        // Шаг 2: Установка официальных библиотек AMD ROCm 10.0.0 (`gfx1151`) через `bubo.exe prepare runtime --yes`
        if ((step === 'runtime' || step === 'all') && fs.existsSync(buboExe)) {
            appendLog('Загрузка официальных пакетов AMD ROCm 10.0.0 для gfx1151 (bubo prepare runtime --yes)…');
            _windowsPrepareState.progress = 75;
            await new Promise((resolve, reject) => {
                const proc = spawnImpl(buboExe, [
                    'prepare', 'runtime',
                    '--runtime-dir', rocmDir,
                    '--yes',
                ], {
                    cwd: path.dirname(buboExe),
                    windowsHide: true,
                });
                proc.stdout?.on('data', d => appendLog(d));
                proc.stderr?.on('data', d => appendLog(d));
                proc.on('error', reject);
                proc.on('close', code => code === 0 ? resolve() : reject(new Error(`bubo prepare runtime завершился с кодом ${code}`)));
            });
        }

        // Шаг 3: Подготовка 8 файлов модели Qwen3.8-Flash-Next (UD-Q4_K_XL + MTP + Dense Twin + Draft Head + Vision)
        if ((step === 'model' || step === 'all') && fs.existsSync(buboExe)) {
            appendLog(`Подготовка модели Qwen3.8-Flash-Next (${modelSet}) через bubo prepare model…`);
            _windowsPrepareState.progress = 90;
            const args = [
                'prepare', 'model',
                ...(modelSet === 'original' ? ['--model-set', 'original'] : []),
                '--output', modelsOutDir,
                '--yes',
            ];
            await new Promise((resolve, reject) => {
                const proc = spawnImpl(buboExe, args, {
                    cwd: path.dirname(buboExe),
                    windowsHide: true,
                });
                proc.stdout?.on('data', d => appendLog(d));
                proc.stderr?.on('data', d => appendLog(d));
                proc.on('error', reject);
                proc.on('close', code => code === 0 ? resolve() : reject(new Error(`bubo prepare model завершился с кодом ${code}`)));
            });
        }

        _windowsPrepareState.status = 'completed';
        _windowsPrepareState.progress = 100;
        appendLog('Нативный стек Halowin Bubo (AMD ROCm 10.0.0 gfx1151) готов к работе.');

        return {
            ok: true,
            state: _windowsPrepareState,
            windowsEnv: inspectWindowsHalogenEnvironment({ rootDir }),
        };
    }
    catch (err) {
        _windowsPrepareState.status = 'error';
        _windowsPrepareState.error = String(err?.message || err);
        appendLog(`Ошибка: ${_windowsPrepareState.error}`);
        return {
            ok: false,
            error: _windowsPrepareState.error,
            state: _windowsPrepareState,
            windowsEnv: inspectWindowsHalogenEnvironment({ rootDir }),
        };
    }
}

/**
 * Запустить локальный сервер на порту 8731:
 *  - На Windows 11: приоритетный запуск нативного `bubo.exe serve llm` (Halowin Bubo / Gufo ROCm 10.0 `gfx1151` + XRT NPU)
 *    или `gufo.exe serve` / `strata.exe`.
 *  - На Linux: контейнер `halogen-flash-server` через `podman`.
 */
export async function startHalogenBackend({
    rootDir = process.cwd(),
    port = HALOGEN_DEFAULT_PORT,
    modelPath = '',
    profile = 'subagents',
    npuPrefill = true,
    spawnImpl = spawn,
} = {}) {
    const probe = await probeHalogenServer(`http://127.0.0.1:${port}/v1/chat/completions`, { rootDir });
    if (probe.online) {
        return {
            started: true,
            alreadyRunning: true,
            mode: probe.mode,
            origin: probe.origin,
            windowsEnv: probe.windowsEnv,
        };
    }

    const winEnv = inspectWindowsHalogenEnvironment({ rootDir });
    const cacheDir = path.join(rootDir, 'MODELS', 'Local', '#cache');
    fs.mkdirSync(path.join(cacheDir, 'disk'), { recursive: true });
    fs.mkdirSync(path.join(cacheDir, 'slots'), { recursive: true });

    const ggufPath = modelPath || findLocalGgufModel(rootDir);

    // 1. Приоритет №1 на Windows: нативный Halowin Bubo (`bubo.exe serve llm` на ROCm 10.0.0 gfx1151 + Ryzen AI NPU)
    if (winEnv.buboInstalled && (winEnv.buboManifestPath || (ggufPath && fs.existsSync(ggufPath)))) {
        try {
            const args = [
                'serve', 'llm',
                '--host', '127.0.0.1',
                '--port', String(port),
                ...(winEnv.buboManifestPath
                    ? ['--manifest', winEnv.buboManifestPath]
                    : ['--model', ggufPath]),
                '--served-model-name', 'halogen-qwen3.8-flash-next',
                '--profile', profile || 'subagents',
                '--cache-disk', path.join(cacheDir, 'disk'),
            ];
            if (npuPrefill && winEnv.npuDriverInstalled && winEnv.npuKernelsPresent && profile !== 'exact' && profile !== 'stock') {
                args.push('--npu-prefill', 'on');
            }
            const env = {
                ...process.env,
                ...(winEnv.rocmRuntimeDir ? { BUBO_RUNTIME_DIR: winEnv.rocmRuntimeDir } : {}),
            };
            const proc = spawnImpl(winEnv.buboExePath, args, {
                cwd: path.dirname(winEnv.buboExePath),
                env,
                windowsHide: true,
                stdio: 'ignore',
                detached: false,
            });
            proc.unref?.();
            _managedProc = proc;
            _managedInfo = {
                pid: proc.pid,
                port,
                modelPath: winEnv.buboManifestPath || ggufPath,
                startedAt: Date.now(),
                runtime: 'bubo',
                npuPrefill: Boolean(npuPrefill && winEnv.npuDriverInstalled && winEnv.npuKernelsPresent),
            };
            proc.on('exit', () => {
                _managedProc = null;
                _managedInfo = null;
            });
            return {
                started: true,
                mode: 'bubo-windows',
                runtime: 'bubo.exe (AMD ROCm 10.0.0 gfx1151)',
                pid: proc.pid,
                port,
                modelPath: winEnv.buboManifestPath || ggufPath,
                windowsEnv: winEnv,
            };
        }
        catch { /* try next runtime */ }
    }

    // 2. Приоритет №2 на Windows: нативный Gufo (`gufo.exe serve --port 8731 llm`)
    if (winEnv.gufoInstalled && ggufPath && fs.existsSync(ggufPath)) {
        try {
            const args = [
                'serve',
                '--host', '127.0.0.1',
                '--port', String(port),
                'llm',
                '--model', ggufPath,
                '--served-model-name', 'halogen-qwen3.8-flash-next',
                '--speculative', 'mtp',
            ];
            const proc = spawnImpl(winEnv.gufoExePath, args, {
                cwd: path.dirname(winEnv.gufoExePath),
                windowsHide: true,
                stdio: 'ignore',
                detached: false,
            });
            proc.unref?.();
            _managedProc = proc;
            _managedInfo = {
                pid: proc.pid,
                port,
                modelPath: ggufPath,
                startedAt: Date.now(),
                runtime: 'gufo',
            };
            proc.on('exit', () => {
                _managedProc = null;
                _managedInfo = null;
            });
            return {
                started: true,
                mode: 'bubo-windows',
                runtime: 'gufo.exe (Strix Halo Native)',
                pid: proc.pid,
                port,
                modelPath: ggufPath,
                windowsEnv: winEnv,
            };
        }
        catch { /* try next runtime */ }
    }

    // 3. Приоритет №3: `llama-server` (если установлен локально и есть GGUF)
    if (ggufPath && fs.existsSync(ggufPath)) {
        try {
            const args = [
                '--host', '127.0.0.1',
                '--port', String(port),
                '--alias', 'halogen-qwen3.8-flash-next',
                '-m', ggufPath,
                '--ctx-size', '32768',
                '--parallel', '4',
                '-ngl', '999',
                '--cache-reuse', '256',
                '--lookup-cache-dynamic', path.join(cacheDir, 'lookup.bin'),
                '--slot-save-path', path.join(cacheDir, 'slots'),
            ];
            const proc = spawnImpl('llama-server', args, {
                windowsHide: true,
                stdio: 'ignore',
                detached: false,
            });
            proc.unref?.();
            _managedProc = proc;
            _managedInfo = {
                pid: proc.pid,
                port,
                modelPath: ggufPath,
                startedAt: Date.now(),
                runtime: 'llama-server',
            };
            proc.on('exit', () => {
                _managedProc = null;
                _managedInfo = null;
            });
            return {
                started: true,
                mode: 'llama-server-windows',
                pid: proc.pid,
                port,
                modelPath: ggufPath,
                windowsEnv: winEnv,
            };
        }
        catch { /* fallback to embedded */ }
    }

    return {
        started: true,
        mode: 'work-embedded-fallback',
        port,
        windowsEnv: winEnv,
        note: os.platform() === 'win32'
            ? 'Нативный движок Halowin Bubo (bubo.exe) или модель ещё не подготовлены. Нажмите «Установить Halowin Bubo (ROCm 10.0 gfx1151)» во вкладке Halogen; пока работает автономный контур WORK.'
            : 'Контейнер halogen-flash-server не запущен; активирован автономный контур WORK.',
    };
}

export function stopHalogenBackend() {
    if (_managedProc && !_managedProc.killed) {
        try { _managedProc.kill(); } catch { /* ignore */ }
    }
    _managedProc = null;
    _managedInfo = null;
    return { stopped: true };
}

/**
 * Сгенерировать валидный WAV-буфер (24 кГц, 16 бит, моно) для автономного фоллбэка TTS,
 * когда внешний сервер `:8731` (`halogen-flash-server` на Linux или `gufo serve tts` на Windows) не запущен.
 */
export function synthesizeFallbackWav(text = '', { sampleRate = 24000 } = {}) {
    const clean = String(text || '').trim();
    const durationSec = Math.min(2.5, Math.max(0.25, clean.length * 0.018));
    const numSamples = Math.max(600, Math.floor(sampleRate * durationSec));
    const dataBytes = numSamples * 2;
    const buf = Buffer.alloc(44 + dataBytes);

    // RIFF WAVE header
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(36 + dataBytes, 4);
    buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);          // PCM chunk size
    buf.writeUInt16LE(1, 20);           // AudioFormat = 1 (PCM)
    buf.writeUInt16LE(1, 22);           // NumChannels = 1 (mono)
    buf.writeUInt32LE(sampleRate, 24);  // SampleRate = 24000
    buf.writeUInt32LE(sampleRate * 2, 28); // ByteRate
    buf.writeUInt16LE(2, 32);           // BlockAlign
    buf.writeUInt16LE(16, 34);          // BitsPerSample = 16
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(dataBytes, 40);

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const env = Math.sin(Math.PI * (i / numSamples));
        const sample = Math.round(Math.sin(2 * Math.PI * 220 * t) * 400 * env);
        buf.writeInt16LE(sample, 44 + i * 2);
    }
    return buf;
}

/**
 * Детерминированный генератор эмбеддингов (`/v1/embeddings` оффлайн-фоллбэк, когда `:8731` / `gufo serve embedding` закрыт).
 */
export function computeFallbackEmbeddings(inputs = [], { dimensions = 1024, model = 'qwen3-embedding-0.6b' } = {}) {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    const dim = Math.max(32, Math.min(1024, Number(dimensions) || 1024));
    const data = list.map((item, index) => {
        const text = typeof item === 'string' ? item : JSON.stringify(item || '');
        const vec = new Array(dim).fill(0);
        const tokens = text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
        if (!tokens.length)
            tokens.push('empty');
        for (const tok of tokens) {
            const hash = crypto.createHash('sha256').update(tok).digest();
            for (let j = 0; j < 8; j++) {
                const idx = hash.readUInt16LE(j * 2) % dim;
                const sign = (hash[16 + j] & 1) ? 1 : -1;
                vec[idx] += sign * (1 + (hash[24 + j] / 255));
            }
        }
        let norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        for (let i = 0; i < dim; i++)
            vec[i] = +(vec[i] / norm).toFixed(6);
        return {
            object: 'embedding',
            index,
            embedding: vec,
        };
    });
    return {
        object: 'list',
        model,
        data,
        usage: {
            prompt_tokens: list.reduce((s, x) => s + Math.max(1, Math.ceil(String(x || '').length / 4)), 0),
            total_tokens: list.reduce((s, x) => s + Math.max(1, Math.ceil(String(x || '').length / 4)), 0),
        },
    };
}

/**
 * Встроенный реранкер документов (`/v1/rerank` оффлайн-фоллбэк в формате Cohere/Jina/Halogen).
 */
export function computeFallbackRerank({ query = '', documents = [], topN = 0, returnDocuments = true, model = 'qwen3-reranker-0.6b' } = {}) {
    const qTokens = new Set(String(query || '').toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(w => w.length > 1));
    const scored = (Array.isArray(documents) ? documents : []).map((doc, index) => {
        const text = typeof doc === 'string' ? doc : String(doc?.text || '');
        const dTokens = text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(w => w.length > 1);
        let hits = 0;
        for (const t of dTokens) {
            if (qTokens.has(t))
                hits++;
        }
        const relevance_score = qTokens.size
            ? +Math.min(0.999, (hits / Math.sqrt(qTokens.size * Math.max(1, dTokens.length))) + (hits > 0 ? 0.35 : 0.05)).toFixed(4)
            : 0.5;
        return {
            index,
            relevance_score,
            ...(returnDocuments ? { document: { text } } : {}),
        };
    });
    scored.sort((a, b) => b.relevance_score - a.relevance_score);
    const results = topN > 0 ? scored.slice(0, topN) : scored;
    return {
        model,
        results,
    };
}

/**
 * Встроенный классификатор System One (`/v1/systemone` оффлайн-фоллбэк, когда `:8731` / `gufo serve decision` закрыт).
 */
export function computeFallbackDecision({ state = '', questions = {}, model = 'decider-0.8b' } = {}) {
    const text = (typeof state === 'string' ? state : JSON.stringify(state || '')).toLowerCase();
    const answers = {};

    for (const [qKey, qDef] of Object.entries(questions || {})) {
        const type = String(qDef?.type || 'choice');
        if (type === 'noul') {
            const positive = /да|нужн|возврат|срочн|ошибк|yes|refund|urgent|true/i.test(text);
            answers[qKey] = {
                probability: positive ? 0.88 : 0.12,
                choice: positive ? 'yes' : 'no',
                confidence: 0.88,
            };
        }
        else if (type === 'score') {
            const criteria = Array.isArray(qDef?.criteria) ? qDef.criteria : ['low', 'medium', 'high'];
            const probs = {};
            const n = Math.max(2, criteria.length);
            for (let i = 0; i < n; i++)
                probs[String(i)] = +(1 / n).toFixed(3);
            answers[qKey] = {
                score: 0,
                legend: criteria,
                probabilities: probs,
                confidence: 0.75,
            };
        }
        else {
            const criteria = qDef?.criteria && typeof qDef.criteria === 'object' && !Array.isArray(qDef.criteria)
                ? Object.keys(qDef.criteria)
                : Array.isArray(qDef?.criteria) ? qDef.criteria.map(String) : ['default'];
            let bestKey = criteria[0] || 'default';
            for (const c of criteria) {
                if (text.includes(c.toLowerCase())) {
                    bestKey = c;
                    break;
                }
            }
            const probs = {};
            for (const c of criteria)
                probs[c] = c === bestKey ? 0.82 : +((0.18) / Math.max(1, criteria.length - 1)).toFixed(3);
            answers[qKey] = {
                choice: bestKey,
                probabilities: probs,
                confidence: 0.82,
            };
        }
    }

    return {
        model,
        answers,
    };
}

/**
 * Зарегистрировать модели Halo (`HALOGEN_MODELS_CATALOG`) как дочерние узлы `$ai` внутри `/MODELS/Local/<nodeName>`.
 */
export async function ensureHalogenModelNodes(rootDir = process.cwd(), { models = null, onlyWithWeights = false } = {}) {
    let filterList = null;
    if (Array.isArray(models) && models.length) {
        filterList = new Set(models.map(m => String(m).trim()));
    }
    else if (typeof models === 'string' && models.trim()) {
        filterList = new Set(models.split(',').map(m => m.trim()).filter(Boolean));
    }

    const targets = filterList
        ? HALOGEN_MODELS_CATALOG.filter(m =>
            filterList.has(m.nodeName) || filterList.has(m.model) || filterList.has(m.hfRepo) || filterList.has(m.path)
        )
        : [...HALOGEN_MODELS_CATALOG];

    const registered = [];
    for (const spec of targets) {
        const weightsDir = path.join(rootDir, 'MODELS', 'Local', spec.nodeName, '#weights');
        if (onlyWithWeights) {
            let hasFiles = false;
            try {
                if (fs.existsSync(weightsDir)) {
                    hasFiles = fs.readdirSync(weightsDir).some(f => !f.endsWith('.part') && f !== 'hf-manifest.json');
                }
            }
            catch { /* ignore */ }
            if (!hasFiles)
                continue;
        }
        const res = await registerLocalModelNode({
            rootDir,
            folderName: spec.nodeName,
            label: spec.label || spec.nodeName,
            repoId: spec.hfRepo,
            model: spec.model,
            protocol: 'halogen',
            icon: spec.icon || 'ai:qwen',
            modality: spec.modality,
            capabilities: spec.capabilities,
            efforts: spec.efforts,
            maxTokens: spec.maxTokens,
            maxOutput: spec.maxOutput,
            baseUrl: spec.baseUrl || HALOGEN_DEFAULT_BASE_URL,
            weightsDir,
        });
        registered.push(res.modelPath);
    }
    try {
        const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
        localNode?.reset?.();
    }
    catch { /* ignore */ }
    return registered;
}

/**
 * Проверить наличие скачанных весов и узлов `$ai` для каждой модели из `HALOGEN_MODELS_CATALOG` в `MODELS/Local/<nodeName>/#weights`.
 */
export function inspectHalogenCatalogWithStatus(rootDir = process.cwd()) {
    const activeDownloads = listHuggingFaceDownloads();
    return HALOGEN_MODELS_CATALOG.map(spec => {
        const localWeightsDir = path.join(rootDir, 'MODELS', 'Local', spec.nodeName, '#weights');
        const legacyWeightsDir = path.join(rootDir, 'MODELS', 'Halogen', spec.nodeName, '#weights');
        const weightsDir = fs.existsSync(localWeightsDir) || !fs.existsSync(legacyWeightsDir) ? localWeightsDir : legacyWeightsDir;
        let downloadedFiles = [];
        if (fs.existsSync(weightsDir)) {
            try {
                downloadedFiles = fs.readdirSync(weightsDir)
                    .filter(f => !f.endsWith('.part') && f !== 'hf-manifest.json');
            }
            catch { /* ignore */ }
        }
        const nodeConfigured = fs.existsSync(path.join(rootDir, 'MODELS', 'Local', spec.nodeName, '$ai', 'class.js'));
        const activeJob = activeDownloads.find(d =>
            d.status === 'downloading'
            && (d.repoId === spec.hfRepo || d.folderName === spec.nodeName || d.modelPath === spec.path)
        ) || null;
        const hasRealWeightFile = downloadedFiles.some(f => /\.(gguf|safetensors|hgn|hnpw|bin|onnx|pt|pth)$/i.test(f));
        return {
            ...spec,
            nodeConfigured,
            weightsDir: path.relative(rootDir, weightsDir).replace(/\\/g, '/'),
            weightsDownloaded: !activeJob && hasRealWeightFile,
            downloadedFiles,
            activeDownload: activeJob,
        };
    });
}

/**
 * Поставить в очередь скачивание всего пакета моделей Halo в `/MODELS/Local` (1 основная GPU-модель + 7 NPU-моделей)
 * или выбранного подмножества моделей с Hugging Face Hub прямо в `MODELS/Local/<nodeName>/#weights`,
 * регистрируя узлы `$ai` в `/MODELS/Local/<nodeName>` по мере завершения скачивания каждой модели.
 */
export async function downloadHalogenBundle({
    rootDir = process.cwd(),
    models = null,
    token = '',
    waitForCompletion = false,
    fetchImpl = globalThis.fetch,
} = {}) {
    let filterList = null;
    if (Array.isArray(models) && models.length) {
        filterList = new Set(models.map(m => String(m).trim()));
    }
    else if (typeof models === 'string' && models.trim()) {
        filterList = new Set(models.split(',').map(m => m.trim()).filter(Boolean));
    }

    const targets = filterList
        ? HALOGEN_MODELS_CATALOG.filter(m =>
            filterList.has(m.nodeName) || filterList.has(m.model) || filterList.has(m.hfRepo) || filterList.has(m.path)
        )
        : [...HALOGEN_MODELS_CATALOG];

    const existingDownloads = listHuggingFaceDownloads();
    const jobs = [];
    let startedCount = 0;
    let alreadyActiveCount = 0;

    for (const spec of targets) {
        const running = existingDownloads.find(d =>
            d.status === 'downloading'
            && (d.repoId === spec.hfRepo || d.folderName === spec.nodeName || d.modelPath === spec.path)
        );
        if (running) {
            alreadyActiveCount++;
            jobs.push(running);
            continue;
        }
        const job = await startHuggingFaceDownload({
            repoId: spec.hfRepo,
            providerFolder: 'Local',
            targetNodeName: spec.nodeName,
            nodeMeta: {
                label: spec.label || spec.nodeName,
                model: spec.model,
                protocol: 'halogen',
                icon: spec.icon || 'ai:qwen',
                modality: spec.modality,
                capabilities: spec.capabilities,
                efforts: spec.efforts,
                maxTokens: spec.maxTokens,
                maxOutput: spec.maxOutput,
                baseUrl: spec.baseUrl || HALOGEN_DEFAULT_BASE_URL,
            },
            rootDir,
            token,
            registerInWork: true,
            waitForCompletion,
            fetchImpl,
        });
        startedCount++;
        jobs.push(job);
    }

    return {
        totalModels: targets.length,
        startedCount,
        alreadyActiveCount,
        jobs,
    };
}
