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
import AdmZip from 'adm-zip';
import { startHuggingFaceDownload, listHuggingFaceDownloads, registerLocalModelNode } from './huggingface.js';
import { loadTrainerNetworkSettings, createNetworkFetch, downloadFileMultipart } from './downloader.js';
import {
    localRuntimeDir,
    localCacheDir,
    modelWeightsDir,
    modelClassFile,
    migrateLocalModelsLayoutSync,
    inspectWeightsDirectorySync,
    getFreeDiskSpaceGb,
    WEIGHT_FILE_EXT_RE,
} from './paths.js';

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
 * Точные 8 GGUF-файлов сети `Qwen3.8-Flash-Next` (`UD-Q4_K_XL` + `MTP` + `Vision` + `Dense Twin` + `Draft Head`, 108.6 GiB)
 * для скачивания штатным многопоточным загрузчиком WORK прямо в метапапку модели `MODELS/Local/Qwen3.8-Flash-Next/$ai/#weights/`.
 */
export const QWEN_FLASH_NEXT_GGUF_FILES = Object.freeze([
    {
        name: 'UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf',
        destRelPath: 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf',
        url: 'https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/resolve/766911a6b7369840a91dbcd95f9f997acaab6cd6/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf',
        size: 10946624,
    },
    {
        name: 'UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00002-of-00004.gguf',
        destRelPath: 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00002-of-00004.gguf',
        url: 'https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/resolve/766911a6b7369840a91dbcd95f9f997acaab6cd6/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00002-of-00004.gguf',
        size: 49859583136,
    },
    {
        name: 'UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00003-of-00004.gguf',
        destRelPath: 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00003-of-00004.gguf',
        url: 'https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/resolve/766911a6b7369840a91dbcd95f9f997acaab6cd6/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00003-of-00004.gguf',
        size: 49376141504,
    },
    {
        name: 'UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00004-of-00004.gguf',
        destRelPath: 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00004-of-00004.gguf',
        url: 'https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/resolve/766911a6b7369840a91dbcd95f9f997acaab6cd6/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00004-of-00004.gguf',
        size: 12087983520,
    },
    {
        name: 'mtp/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf',
        destRelPath: 'mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf',
        url: 'https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/resolve/766911a6b7369840a91dbcd95f9f997acaab6cd6/MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf',
        size: 2786568256,
    },
    {
        name: 'mmproj/mmproj-Qwen3.8-Flash-Next-BF16.gguf',
        destRelPath: 'mmproj-Qwen3.8-Flash-Next-BF16.gguf',
        url: 'https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/resolve/766911a6b7369840a91dbcd95f9f997acaab6cd6/mmproj-BF16.gguf',
        size: 907542944,
    },
    {
        name: 'twin/iq4-nofullattn-nohc.gguf',
        destRelPath: 'iq4-nofullattn-nohc.gguf',
        url: 'https://huggingface.co/HaloForgeLabs/bubo-qwen3.8-flash-next/resolve/0a3c343bec2095f43f2906371c83e4faa8a47da1/twin-base/iq4-nofullattn-nohc.gguf',
        size: 1230788768,
    },
    {
        name: 'draft_head/draft-out-q4k.gguf',
        destRelPath: 'draft-out-q4k.gguf',
        url: 'https://huggingface.co/HaloForgeLabs/bubo-qwen3.8-flash-next/resolve/0a3c343bec2095f43f2906371c83e4faa8a47da1/draft_head/draft-out-q4k.gguf',
        size: 357581248,
    },
]);
export const BUBO_ORIGINAL_MODEL_FILES = QWEN_FLASH_NEXT_GGUF_FILES;

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
        platforms: ['linux', 'win32'],
        windowsRamGb: 116.6,
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
        windowsRole: 'Основная агентская модель 180B MoE для Windows 11 Strix Halo через встроенный движок Halowin Bubo (UD-Q4_K_XL GGUF + MTP + Dense Twin + Vision, ~116.6 ГБ + ROCm 10.0)',
    },
    {
        nodeName: 'Qwen3.5-2B-NPU',
        label: 'Qwen3.5-2B (NPU Compact)',
        icon: 'ai:qwen',
        path: '/MODELS/Local/Qwen3.5-2B-NPU',
        baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
        model: 'qwen3.5-2b',
        hfRepo: 'peonist-ai/halogen-npu-qwen3.5-2b',
        platforms: ['linux'],
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
        platforms: ['linux'],
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
        platforms: ['linux'],
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
        platforms: ['linux'],
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
        platforms: ['linux'],
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
        platforms: ['linux'],
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
        platforms: ['linux'],
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

/**
 * 7 Windows-совместимых моделей-компаньонов (.safetensors) для комплекта Halo на Windows 11,
 * заменяющих Linux-only `.hnpw` модели и работающих на встроенном движке WORK.
 */
export const HALOGEN_WINDOWS_COMPANIONS = Object.freeze([
    {
        nodeName: 'Qwen3-4B',
        label: 'Qwen3-4B (Быстрая LLM / Сжатие)',
        icon: 'ai:qwen',
        path: '/MODELS/Local/Qwen3-4B',
        baseUrl: '',
        model: 'Qwen/Qwen3-4B',
        hfRepo: 'Qwen/Qwen3-4B',
        protocol: 'local',
        runtimeType: 'local',
        device: 'Встроенный движок WORK (.safetensors)',
        modality: 'llm',
        maxTokens: 32768,
        maxOutput: 8192,
        ramGb: 3.5,
        capabilities: ['chat', 'stream', 'tools', 'functions', 'thinking', 'lora'],
        role: 'Быстрая модель для сжатия контекста (compactModel), сводок и локальных агентов без вымывания кэша основной 180B модели',
    },
    {
        nodeName: 'Qwen3-ASR-1.7B',
        label: 'Qwen3-ASR 1.7B (Распознавание речи)',
        icon: 'carbon:microphone',
        path: '/MODELS/Local/Qwen3-ASR-1.7B',
        baseUrl: '',
        model: 'Qwen/Qwen3-ASR-1.7B',
        hfRepo: 'Qwen/Qwen3-ASR-1.7B',
        protocol: 'local',
        runtimeType: 'local',
        device: 'Встроенный движок WORK (.safetensors)',
        modality: 'audio',
        maxTokens: 4096,
        maxOutput: 2048,
        ramGb: 2.0,
        capabilities: ['stt', 'asr', 'lora'],
        role: 'Потоковое распознавание русской и английской речи для голосового режима (sttModel)',
    },
    {
        nodeName: 'Qwen3-TTS-12Hz-1.7B-VoiceDesign',
        label: 'Qwen3-TTS 1.7B VoiceDesign (Голос)',
        icon: 'carbon:volume-up',
        path: '/MODELS/Local/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
        baseUrl: '',
        model: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
        hfRepo: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
        protocol: 'local',
        runtimeType: 'local',
        device: 'Встроенный движок WORK (.safetensors)',
        modality: 'audio',
        maxTokens: 4096,
        maxOutput: 2048,
        ramGb: 2.3,
        capabilities: ['tts', 'voice', 'lora'],
        role: 'Синтез живой русской и английской речи для озвучивания ответов агентов (ttsModel)',
    },
    {
        nodeName: 'Z-Image-Turbo',
        label: 'Z-Image-Turbo 6B (Картинки)',
        icon: 'ai:stablediffusion',
        path: '/MODELS/Local/Z-Image-Turbo',
        baseUrl: '',
        model: 'Tongyi-MAI/Z-Image-Turbo',
        hfRepo: 'Tongyi-MAI/Z-Image-Turbo',
        protocol: 'local',
        runtimeType: 'local',
        device: 'Встроенный движок WORK (.safetensors)',
        modality: 'image',
        maxTokens: 4096,
        maxOutput: 1024,
        ramGb: 7.5,
        capabilities: ['image', 'text-to-image', 'lora'],
        role: 'Генерация иллюстраций, фото товаров для Номенклатуры и слайдов презентаций (imageModel)',
    },
    {
        nodeName: 'bge-m3',
        label: 'BGE-M3 (Эмбеддинги RAG)',
        icon: 'carbon:search-locate',
        path: '/MODELS/Local/bge-m3',
        baseUrl: '',
        model: 'BAAI/bge-m3',
        hfRepo: 'BAAI/bge-m3',
        protocol: 'local',
        runtimeType: 'local',
        device: 'Встроенный движок WORK (.safetensors)',
        modality: 'embed',
        maxTokens: 8192,
        maxOutput: 1024,
        ramGb: 1.4,
        capabilities: ['embeddings', 'rag'],
        role: 'Мультиязычные векторные эмбеддинги для семантического поиска RAG по документам и БД WORK',
    },
    {
        nodeName: 'bge-reranker-v2-m3',
        label: 'BGE-Reranker-v2-M3 (Реранкер RAG)',
        icon: 'carbon:filter',
        path: '/MODELS/Local/bge-reranker-v2-m3',
        baseUrl: '',
        model: 'BAAI/bge-reranker-v2-m3',
        hfRepo: 'BAAI/bge-reranker-v2-m3',
        protocol: 'local',
        runtimeType: 'local',
        device: 'Встроенный движок WORK (.safetensors)',
        modality: 'embed',
        maxTokens: 8192,
        maxOutput: 1024,
        ramGb: 1.4,
        capabilities: ['rerank', 'rag'],
        role: 'Точное переранжирование найденных документов и объектов БД для RAG-контекста',
    },
    {
        nodeName: 'Qwen3-0.6B',
        label: 'Qwen3-0.6B (Быстрый классификатор)',
        icon: 'carbon:decision-tree',
        path: '/MODELS/Local/Qwen3-0.6B',
        baseUrl: '',
        model: 'Qwen/Qwen3-0.6B',
        hfRepo: 'Qwen/Qwen3-0.6B',
        protocol: 'local',
        runtimeType: 'local',
        device: 'Встроенный движок WORK (.safetensors)',
        modality: 'llm',
        maxTokens: 32768,
        maxOutput: 2048,
        ramGb: 1.0,
        capabilities: ['chat', 'stream', 'decide', 'classify'],
        role: 'Мгновенный локальный классификатор, маршрутизатор и короткие системные проверки',
    },
]);

/**
 * Вернуть каталог моделей Halo, совместимый с указанной ОС (`win32` или `linux`).
 * На Windows: 1 основная GPU-модель `Qwen3.8-Flash-Next` через Halowin Bubo (GGUF) + 7 совместимых `.safetensors` моделей.
 * На Linux: 1 `.hgn` + 7 `.hnpw` для контейнера `halogen-flash-server`.
 */
export function getHalogenCatalogForPlatform(platform = os.platform()) {
    if (platform === 'win32') {
        const flashSpec = HALOGEN_MODELS_CATALOG.find(m => m.nodeName === 'Qwen3.8-Flash-Next');
        const winFlash = flashSpec ? [{
            ...flashSpec,
            hfRepo: flashSpec.windowsBuboRepo || flashSpec.hfRepo,
            ramGb: flashSpec.windowsRamGb || flashSpec.ramGb,
            role: flashSpec.windowsRole || flashSpec.role,
            protocol: 'halogen',
            runtimeType: 'bubo',
        }] : [];
        return [...winFlash, ...HALOGEN_WINDOWS_COMPANIONS.map(m => ({ ...m }))];
    }
    return HALOGEN_MODELS_CATALOG
        .filter(spec => !Array.isArray(spec.platforms) || spec.platforms.includes(platform))
        .map(spec => ({ ...spec, protocol: 'halogen', runtimeType: 'halogen-linux' }));
}

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

const BACKEND_LOG_TAIL_CHARS = 8192;
let _managedProc = null;
let _managedInfo = null;
let _lastManagedExit = null;
let _lastSpeculationFallback = null;

function appendLogTail(prev, chunk) {
    const text = prev + (Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk || ''));
    return text.length > BACKEND_LOG_TAIL_CHARS ? text.slice(-BACKEND_LOG_TAIL_CHARS) : text;
}

function attachManagedBackendProcess(proc, meta = {}) {
    _managedProc = proc;
    _lastManagedExit = null;
    const { onEarlyExit, ...info } = meta || {};
    const state = {
        ...info,
        pid: proc?.pid,
        startedAt: Date.now(),
        stdout: '',
        stderr: '',
        errorMessage: '',
    };
    _managedInfo = state;

    proc?.stdout?.on?.('data', chunk => {
        state.stdout = appendLogTail(state.stdout, chunk);
    });
    proc?.stderr?.on?.('data', chunk => {
        state.stderr = appendLogTail(state.stderr, chunk);
    });
    proc?.on?.('error', err => {
        state.errorMessage = String(err?.message || err || '');
    });
    proc?.on?.('exit', (code, signal) => {
        _lastManagedExit = {
            pid: proc?.pid,
            runtime: state.runtime,
            code,
            signal,
            stderr: state.stderr,
            stdout: state.stdout,
            errorMessage: state.errorMessage,
            exitedAt: Date.now(),
        };
        const earlyExit = Date.now() - state.startedAt < 30000 && code !== 0;
        if (_managedProc === proc) {
            _managedProc = null;
            _managedInfo = null;
        }
        // Движок мог не принять новый флаг спекуляции — отдаём управление повторному запуску без него.
        if (earlyExit && typeof onEarlyExit === 'function') {
            setTimeout(() => {
                try { onEarlyExit(code); }
                catch { /* ignore */ }
            }, 250);
        }
    });
    return state;
}

function extractProcessErrorDetail(exitInfo) {
    if (!exitInfo)
        return '';
    const combined = [exitInfo.stderr, exitInfo.stdout, exitInfo.errorMessage]
        .filter(Boolean)
        .join('\n')
        .replace(/\u001b\[[0-9;]*m/g, '');
    const lines = combined
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    if (!lines.length)
        return '';
    const errorLines = lines.filter(line => /^(error|fatal|exception|panic)\b/i.test(line) || /\b(error|failed|fatal)\s*:/i.test(line));
    const picked = (errorLines.length ? errorLines : lines).slice(-3).join(' | ');
    return picked.length > 450 ? `${picked.slice(0, 447)}...` : picked;
}

function formatBackendExitReason({ runtimeLabel, exitInfo, winEnv }) {
    const label = runtimeLabel || exitInfo?.runtime || 'встроенный движок';
    const detail = extractProcessErrorDetail(exitInfo);
    const codePart = exitInfo?.code !== undefined && exitInfo?.code !== null
        ? `код ${exitInfo.code}`
        : (exitInfo?.signal ? `сигнал ${exitInfo.signal}` : 'без кода');

    if (detail) {
        const envNotes = [];
        if (winEnv?.isWindows) {
            if (winEnv.vcRedistInstalled === false)
                envNotes.push('не найден VC++ Redistributable (vcruntime140.dll)');
            if (winEnv.pageFileOk === false)
                envNotes.push(`PageFile ${winEnv.pageFileGb} ГБ вместо рекомендуемых 128 ГБ`);
        }
        const suffix = envNotes.length ? ` (${envNotes.join('; ')})` : '';
        return `Встроенный движок ИИ (${label}) завершился (${codePart}): ${detail}${suffix}`;
    }

    return `Встроенный движок ИИ (${label}) завершился сразу после запуска (${codePart}; проверьте наличие VC++ Redistributable, драйвера AMD и PageFile 128 ГБ).`;
}
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

    // Нативная подготовка движка Halowin Bubo (AMD ROCm 10.0.0 gfx1151) и запуск нейросети из её метапапки `$ai/#weights`
    const windowsPrepareCommand = [
        `.\\bubo.exe prepare runtime --runtime-dir "MODELS\\Local\\$provider\\#runtime\\bubo\\runtime\\rocm-10.0.0-gfx1151" --yes`,
    ].join('\n');

    const windowsCommand = [
        `bubo.exe serve llm ^`,
        `  --host 127.0.0.1 --port ${HALOGEN_DEFAULT_PORT} ^`,
        `  --model "MODELS\\Local\\Qwen3.8-Flash-Next\\$ai\\#weights\\Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf" ^`,
        `  --served-model-name halogen-qwen3.8-flash-next ^`,
        `  --profile ${kvSlots > 1 ? 'subagents' : 'default'} --context ${contextTokens} ^`,
        `  --npu-prefill on`,
    ].join('\n');

    const windowsGufoServicesCommand = [
        `gufo.exe serve --host 127.0.0.1 --port ${HALOGEN_DEFAULT_PORT} llm --model "MODELS\\Local\\Qwen3.8-Flash-Next\\$ai\\#weights\\Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf" --served-model-name halogen-qwen3.8-flash-next --speculative mtp`,
        `gufo.exe serve asr --model "MODELS\\Local\\Qwen3-ASR-NPU\\$ai\\#weights"`,
        `gufo.exe serve tts --model "MODELS\\Local\\Qwen3-TTS-NPU\\$ai\\#weights"`,
        `gufo.exe serve embedding --model "MODELS\\Local\\Qwen3-Embedding-NPU\\$ai\\#weights"`,
        `gufo.exe serve image --model "MODELS\\Local\\Flux2-Klein-NPU\\$ai\\#weights"`,
        `gufo.exe serve decision --model "MODELS\\Local\\Decider-NPU\\$ai\\#weights"`,
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
    const rtBase = localRuntimeDir(rootDir);

    const nestedBuboCandidates = [];
    for (const parentDir of [path.join(rtBase, 'bubo'), path.join(rootDir, 'MODELS', 'Local', '#runtime', 'bubo')]) {
        try {
            if (fs.existsSync(parentDir)) {
                for (const sub of fs.readdirSync(parentDir, { withFileTypes: true })) {
                    if (sub.isDirectory()) {
                        nestedBuboCandidates.push(path.join(parentDir, sub.name, 'bin', 'bubo.exe'));
                        nestedBuboCandidates.push(path.join(parentDir, sub.name, 'bubo.exe'));
                    }
                }
            }
        }
        catch { /* ignore */ }
    }

    const buboCandidates = [
        path.join(rtBase, 'bubo', 'bin', 'bubo.exe'),
        path.join(rtBase, 'bubo', 'bubo.exe'),
        ...nestedBuboCandidates,
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
        : path.join(rtBase, 'bubo');

    const rocmCandidates = [
        process.env.BUBO_RUNTIME_DIR || '',
        path.join(rtBase, 'bubo', 'runtime', 'rocm-10.0.0-gfx1151'),
        path.join(rootDir, 'MODELS', 'Local', '#runtime', 'bubo', 'runtime', 'rocm-10.0.0-gfx1151'),
        path.join(rootDir, 'MODELS', 'Halogen', '#runtime', 'bubo', 'runtime', 'rocm-10.0.0-gfx1151'),
        path.join(localAppData, 'Bubo', 'runtime', 'rocm-10.0.0-gfx1151'),
    ].filter(Boolean);
    const rocmRuntimeDir = rocmCandidates.find(p => fs.existsSync(p)) || null;

    const flashWeightsDir = modelWeightsDir(rootDir, 'Qwen3.8-Flash-Next', 'Local');
    const flashResolved = resolveBuboModelFiles(flashWeightsDir);
    const anyLocalGguf = flashResolved.mainModel || findLocalGgufModel(rootDir);

    const gufoCandidates = [
        path.join(rtBase, 'gufo', 'gufo.exe'),
        path.join(rtBase, 'bubo', 'bin', 'gufo.exe'),
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
        path.join(rtBase, 'strata', 'strata.exe'),
        path.join(rootDir, 'MODELS', 'Local', '#runtime', 'strata', 'strata.exe'),
        path.join(rootDir, 'MODELS', 'Halogen', '#runtime', 'strata', 'strata.exe'),
    ];
    const strataExePath = strataCandidates.find(p => fs.existsSync(p)) || null;

    const xrtSmiPath = path.join(systemRoot, 'System32', 'AMD', 'xrt-smi.exe');
    const npuDriverInstalled = fs.existsSync(xrtSmiPath);
    let npuXclbinPath = path.join(buboRootDir, 'tools', 'npu', 'final_4096x2560x1024_128x64x128.xclbin');
    if (!fs.existsSync(npuXclbinPath)) {
        const npuDir = path.join(buboRootDir, 'tools', 'npu');
        try {
            if (fs.existsSync(npuDir)) {
                const found = fs.readdirSync(npuDir).find(f => f.toLowerCase().endsWith('.xclbin'));
                if (found)
                    npuXclbinPath = path.join(npuDir, found);
            }
        }
        catch { /* ignore */ }
    }
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
        buboModelPrepared: Boolean(anyLocalGguf),
        buboManifestPath: null,
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
 * Разобрать счётчики Prometheus из `GET /metrics` сервера `bubo.exe` / `gufo.exe` / `llama-server`.
 */
export function parseHalogenPrometheusText(rawText = '') {
    const pick = (names) => {
        for (const name of names) {
            const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const m = new RegExp(`^${esc}(?:\\{[^}]*\\})?\\s+([+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`, 'm').exec(rawText);
            if (m) {
                const v = Number(m[1]);
                if (Number.isFinite(v))
                    return v;
            }
        }
        return null;
    };
    const decodeTokens = pick(['llamacpp:tokens_predicted_total', 'tokens_predicted_total']);
    const decodeSeconds = pick(['llamacpp:tokens_predicted_seconds_total', 'tokens_predicted_seconds_total']);
    const prefillTokens = pick(['llamacpp:prompt_tokens_total', 'prompt_tokens_total']);
    const prefillSeconds = pick(['llamacpp:prompt_seconds_total', 'prompt_seconds_total']);
    const cachedTokens = pick(['llamacpp:prompt_tokens_cached_total', 'prompt_tokens_cached_total']);
    const draftRounds = pick(['llamacpp:spec_decode_num_drafts_total', 'spec_decode_num_drafts_total']);
    const draftTokens = pick(['llamacpp:spec_decode_num_draft_tokens_total', 'spec_decode_num_draft_tokens_total']);
    const acceptedTokens = pick(['llamacpp:spec_decode_num_accepted_tokens_total', 'spec_decode_num_accepted_tokens_total']);
    if (decodeTokens === null && draftTokens === null && prefillTokens === null)
        return null;
    return {
        decodeTokens: decodeTokens ?? 0,
        decodeSeconds: decodeSeconds ?? 0,
        prefillTokens: prefillTokens ?? 0,
        prefillSeconds: prefillSeconds ?? 0,
        cachedTokens: cachedTokens ?? 0,
        draftRounds: draftRounds ?? 0,
        draftTokens: draftTokens ?? 0,
        acceptedTokens: acceptedTokens ?? 0,
    };
}

/** Считать снимок счётчиков `:8731/metrics` (безопасно возвращает `null`, если эндпоинт недоступен). */
export async function readHalogenMetrics(baseUrl = HALOGEN_DEFAULT_BASE_URL, { fetchJson = httpGetJson } = {}) {
    let origin = `http://127.0.0.1:${HALOGEN_DEFAULT_PORT}`;
    try { origin = new URL(baseUrl).origin; }
    catch { /* default */ }
    try {
        const res = await fetchJson(`${origin}/metrics`, { Accept: 'text/plain' }, 2000);
        const text = typeof res === 'string' ? res : String(res?.text || '');
        return text ? parseHalogenPrometheusText(text) : null;
    }
    catch {
        return null;
    }
}

/** Вычислить дельту скорости декодирования и КПД спекуляции MTP между двумя снимками `/metrics`. */
export function computeHalogenMetricsDelta(before, after) {
    if (!after)
        return null;
    const b = before || {
        decodeTokens: 0, decodeSeconds: 0, prefillTokens: 0, prefillSeconds: 0,
        cachedTokens: 0, draftRounds: 0, draftTokens: 0, acceptedTokens: 0,
    };
    const dDecodeTokens = Math.max(0, after.decodeTokens - b.decodeTokens);
    const dDecodeSeconds = Math.max(0, after.decodeSeconds - b.decodeSeconds);
    const dPrefillTokens = Math.max(0, after.prefillTokens - b.prefillTokens);
    const dPrefillSeconds = Math.max(0, after.prefillSeconds - b.prefillSeconds);
    const dDraftRounds = Math.max(0, after.draftRounds - b.draftRounds);
    const dDraftTokens = Math.max(0, after.draftTokens - b.draftTokens);
    const dAccepted = Math.max(0, after.acceptedTokens - b.acceptedTokens);

    const serverDecodeTokPerSec = (dDecodeTokens > 0 && dDecodeSeconds > 0.005)
        ? +(dDecodeTokens / dDecodeSeconds).toFixed(1)
        : 0;
    const serverPrefillTokPerSec = (dPrefillTokens > 0 && dPrefillSeconds > 0.005)
        ? +(dPrefillTokens / dPrefillSeconds).toFixed(1)
        : 0;
    const mtpAcceptPct = dDraftTokens > 0
        ? Math.round((dAccepted / dDraftTokens) * 100)
        : null;
    const mtpTokensPerStep = dDraftRounds > 0
        ? +((dDraftRounds + dAccepted) / dDraftRounds).toFixed(2)
        : null;

    return {
        decodeTokens: dDecodeTokens,
        serverDecodeTokPerSec,
        serverPrefillTokPerSec,
        draftRounds: dDraftRounds,
        draftTokens: dDraftTokens,
        acceptedTokens: dAccepted,
        mtpAcceptPct,
        mtpTokensPerStep,
    };
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
        speculation: _managedInfo?.speculation || null,
        speculationFallback: _lastSpeculationFallback,
        windowsEnv: inspectWindowsHalogenEnvironment({ rootDir }),
    };
}

/**
 * Найти основной шард GGUF и все вспомогательные файлы (MTP, Vision mmproj, Dense Twin, Draft Head)
 * внутри метапапки модели `$ai/#weights` — поддерживается как плоская раскладка, так и подпапки `mtp/`, `mmproj/`, `twin/`, `draft_head/`.
 */
export function resolveBuboModelFiles(weightsDir) {
    const empty = { mainModel: null, mtpModel: null, mmprojModel: null, twinModel: null, draftHeadModel: null };
    if (!weightsDir || !fs.existsSync(weightsDir))
        return empty;
    const candidates = [];
    const scanDir = (dir) => {
        if (!fs.existsSync(dir))
            return;
        try {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                if (ent.isFile() && ent.name.toLowerCase().endsWith('.gguf') && !ent.name.endsWith('.part'))
                    candidates.push(path.join(dir, ent.name));
            }
        }
        catch { /* ignore */ }
    };
    scanDir(weightsDir);
    for (const sub of ['mtp', 'mmproj', 'twin', 'draft_head'])
        scanDir(path.join(weightsDir, sub));

    const isSidecar = (p) => {
        const base = path.basename(p).toLowerCase();
        const dirName = path.basename(path.dirname(p)).toLowerCase();
        return ['mtp', 'mmproj', 'twin', 'draft_head'].includes(dirName)
            || /^(mtp[-_]|mmproj[-_]|iq4-nofullattn|twin[-_]|draft[-_]?out|draft[-_]?head)/.test(base);
    };

    const mainModel = candidates
        .filter(p => !isSidecar(p))
        .sort((a, b) => (/-00001-of-/i.test(a) ? -1 : /-00001-of-/i.test(b) ? 1 : a.localeCompare(b)))[0] || null;
    const mtpModel = candidates.find(p =>
        path.basename(path.dirname(p)).toLowerCase() === 'mtp' || /^mtp[-_]/i.test(path.basename(p))
    ) || null;
    const mmprojModel = candidates.find(p =>
        path.basename(path.dirname(p)).toLowerCase() === 'mmproj' || /^mmproj[-_]/i.test(path.basename(p))
    ) || null;
    const twinModel = candidates.find(p =>
        path.basename(path.dirname(p)).toLowerCase() === 'twin' || /iq4-nofullattn|^twin[-_]/i.test(path.basename(p))
    ) || null;
    const draftHeadModel = candidates.find(p =>
        path.basename(path.dirname(p)).toLowerCase() === 'draft_head' || /draft[-_]?out|draft[-_]?head/i.test(path.basename(p))
    ) || null;

    return { mainModel, mtpModel, mmprojModel, twinModel, draftHeadModel };
}

function isNonLlmModelDir(modelDir, folderName = '', mainFile = '') {
    const joined = `${folderName} ${path.basename(mainFile || '')}`.toLowerCase();
    if (/\b(ltx(?:[-_.]?(?:video|2(?:\.\d+)?|v))?|wan2(?:\.\d+)?|hunyuan[-_.]?video|cogvideo|flux|sdxl|z-image|qwen-image|sd3\.5|hidream|chroma|musicgen|audioldm|kokoro|piper)\b/.test(joined))
        return true;
    try {
        const clsPath = path.join(modelDir, '$ai', 'class.js');
        if (fs.existsSync(clsPath)) {
            const raw = fs.readFileSync(clsPath, 'utf-8');
            const m = raw.match(/"modality"\s*:\s*"([^"]+)"/i);
            if (m && ['video', 'image', 'audio', 'embed'].includes(m[1].toLowerCase()))
                return true;
        }
    }
    catch { /* ignore */ }
    return false;
}

/**
 * Найти локальный GGUF-файл LLM-модели в метапапках моделей `/MODELS/Local/<Модель>/$ai/#weights`.
 * Пропускает диффузионные и аудио-модели (LTX, Flux, Wan и т.д.), которые не запускаются через LLM-движок `bubo.exe`.
 */
function findLocalGgufModel(rootDir = process.cwd()) {
    const preferred = resolveBuboModelFiles(modelWeightsDir(rootDir, 'Qwen3.8-Flash-Next', 'Local'));
    if (preferred.mainModel)
        return preferred.mainModel;

    const localRoot = path.join(rootDir, 'MODELS', 'Local');
    if (!fs.existsSync(localRoot))
        return null;
    try {
        for (const entry of fs.readdirSync(localRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('$') || entry.name.startsWith('#') || entry.name === 'models')
                continue;
            const modelDir = path.join(localRoot, entry.name);
            if (isNonLlmModelDir(modelDir, entry.name))
                continue;
            for (const dir of [modelWeightsDir(rootDir, entry.name, 'Local'), path.join(modelDir, '#weights')]) {
                const resolved = resolveBuboModelFiles(dir);
                if (resolved.mainModel && !isNonLlmModelDir(modelDir, entry.name, resolved.mainModel))
                    return resolved.mainModel;
            }
        }
    }
    catch { /* ignore */ }
    return null;
}

/**
 * Проверить системные требования Windows 11 перед загрузкой тяжёлого стека Halowin Bubo (диск, RAM+UMA, PageFile).
 */
export function checkWindowsHalogenPreflight({
    rootDir = process.cwd(),
    requiredDiskGb = 120,
    minTotalMemoryGb = 96,
    totalMemoryGb = null,
} = {}) {
    const winEnv = inspectWindowsHalogenEnvironment({ rootDir });
    const freeDiskGb = getFreeDiskSpaceGb(rootDir);
    const warnings = [];
    const errors = [];

    // По требованию пользователя загрузка не блокируется из-за памяти или свободного места (может качаться на перенос/флешку),
    // а все замечания возвращаются как предупреждения.
    if (freeDiskGb !== null && requiredDiskGb > 0 && freeDiskGb < requiredDiskGb) {
        warnings.push(`На текущем диске свободно ${freeDiskGb} ГБ (для полной 180B модели требуется ~${requiredDiskGb} ГБ).`);
    }
    if (totalMemoryGb !== null && minTotalMemoryGb > 0 && totalMemoryGb < minTotalMemoryGb) {
        warnings.push(`Обнаружено ${totalMemoryGb} ГБ общей памяти (RAM + UMA); для запуска 180B модели на этой машине рекомендуется 128–192 ГБ.`);
    }
    if (winEnv.pageFileOk === false) {
        warnings.push(`Файл подкачки pagefile.sys равен ${winEnv.pageFileGb} ГБ; для стабильной работы 180B модели на Windows рекомендуется фиксированный PageFile 128 ГБ (131072 МБ).`);
    }
    if (!winEnv.vcRedistInstalled) {
        warnings.push('Не обнаружена библиотека Microsoft VC++ 2015–2022 Redistributable (vcruntime140.dll) — её нужно установить для запуска bubo.exe.');
    }

    return {
        ok: true,
        freeDiskGb,
        requiredDiskGb,
        totalMemoryGb,
        minTotalMemoryGb,
        errors,
        warnings,
        windowsEnv: winEnv,
    };
}

/**
 * Скачать и подготовить общий нативный Windows-движок `Halowin Bubo` (`bubo-v0.1.2-windows-x64-gfx1151.zip`)
 * и официальный рантайм AMD ROCm 10.0.0 (`gfx1151`) в `MODELS/Local/$provider/#runtime/bubo/`.
 */
export async function prepareWindowsBuboRuntime({
    rootDir = process.cwd(),
    step = 'runtime',
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
} = {}) {
    migrateLocalModelsLayoutSync(rootDir);
    const runtimeRoot = localRuntimeDir(rootDir);
    const buboDir = path.join(runtimeRoot, 'bubo');
    const rocmDir = path.join(buboDir, 'runtime', 'rocm-10.0.0-gfx1151');

    await fsp.mkdir(runtimeRoot, { recursive: true });

    _windowsPrepareState = {
        status: 'running',
        step,
        progress: 5,
        message: 'Проверка нативного движка Halowin Bubo (gfx1151)…',
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

        const netCfg = loadTrainerNetworkSettings(rootDir);
        const childEnv = {
            ...process.env,
            ...(netCfg.proxyUrl ? { HTTPS_PROXY: netCfg.proxyUrl, HTTP_PROXY: netCfg.proxyUrl } : {}),
        };

        let envInfo = inspectWindowsHalogenEnvironment({ rootDir });

        // Шаг 1: Если `bubo.exe` ещё не установлен, скачиваем официальный релиз `bubo-v0.1.2-windows-x64-gfx1151.zip`
        if (!envInfo.buboInstalled || step === 'download-bubo') {
            const zipPath = path.join(runtimeRoot, BUBO_WINDOWS_RELEASE.zipFileName);
            const effProxy = fetchImpl === globalThis.fetch ? netCfg.proxyUrl : '';
            const netFetch = createNetworkFetch({ proxyUrl: effProxy, fetchImpl });

            appendLog(`Скачивание ${BUBO_WINDOWS_RELEASE.zipFileName} (${(BUBO_WINDOWS_RELEASE.sizeBytes / (1024 * 1024)).toFixed(1)} МБ, ${netCfg.threads} потоков)…`);
            _windowsPrepareState.progress = 10;

            await downloadFileMultipart({
                url: BUBO_WINDOWS_RELEASE.downloadUrl,
                stagedFile: zipPath,
                expectedSize: BUBO_WINDOWS_RELEASE.sizeBytes,
                threads: netCfg.threads,
                fetchImpl: netFetch,
                onProgress: ({ downloadedBytes, totalBytes }) => {
                    const denom = totalBytes || BUBO_WINDOWS_RELEASE.sizeBytes;
                    if (denom > 0)
                        _windowsPrepareState.progress = Math.min(25, 10 + Math.round((downloadedBytes / denom) * 15));
                },
            });

            const statZip = await fsp.stat(zipPath);
            if (statZip.size === BUBO_WINDOWS_RELEASE.sizeBytes) {
                const hash = crypto.createHash('sha256');
                await new Promise((resolve, reject) => {
                    const rs = fs.createReadStream(zipPath);
                    rs.on('data', c => hash.update(c));
                    rs.once('end', resolve);
                    rs.once('error', reject);
                });
                const digest = hash.digest('hex');
                if (digest !== BUBO_WINDOWS_RELEASE.sha256) {
                    await fsp.rm(zipPath, { force: true }).catch(() => {});
                    throw new Error(`Контрольная сумма SHA-256 архива Bubo не совпала: ожидалась ${BUBO_WINDOWS_RELEASE.sha256}, получена ${digest}`);
                }
            }

            await fsp.mkdir(buboDir, { recursive: true });
            appendLog('Распаковка архива Halowin Bubo…');
            _windowsPrepareState.progress = 28;

            let isPkZip = false;
            try {
                const fh = await fsp.open(zipPath, 'r');
                const magic = Buffer.alloc(2);
                await fh.read(magic, 0, 2, 0);
                await fh.close();
                isPkZip = magic.toString('ascii') === 'PK';
            }
            catch { /* ignore */ }

            if (os.platform() === 'win32' && isPkZip) {
                const zip = new AdmZip(zipPath);
                const entries = zip.getEntries();
                // В релизе bubo все файлы лежат внутри одной корневой папки `bubo-v0.1.2-windows-x64-gfx1151/` —
                // снимаем этот общий префикс при распаковке, чтобы `bin/bubo.exe` оказался прямо в `#runtime/bubo/bin/bubo.exe`.
                const topDirs = new Set(entries.map(e => String(e.entryName || '').split('/')[0]).filter(Boolean));
                const stripPrefix = topDirs.size === 1 ? ([...topDirs][0] + '/') : '';
                for (const entry of entries) {
                    let rel = String(entry.entryName || '').replace(/^\/+/, '');
                    if (stripPrefix && rel.startsWith(stripPrefix))
                        rel = rel.slice(stripPrefix.length);
                    if (!rel || rel.includes('..'))
                        continue;
                    const dest = path.resolve(buboDir, rel);
                    if (!dest.startsWith(path.resolve(buboDir)))
                        continue;
                    if (entry.isDirectory) {
                        await fsp.mkdir(dest, { recursive: true });
                    }
                    else {
                        await fsp.mkdir(path.dirname(dest), { recursive: true });
                        await fsp.writeFile(dest, entry.getData());
                    }
                }
            }
            envInfo = inspectWindowsHalogenEnvironment({ rootDir });
            if (os.platform() === 'win32' && !envInfo.buboExePath && spawnImpl === spawn) {
                throw new Error('После распаковки архива Halowin Bubo не найден файл bin/bubo.exe.');
            }
        }

        const buboExe = envInfo.buboExePath || path.join(buboDir, 'bin', 'bubo.exe');
        if ((step === 'runtime' || step === 'all') && !fs.existsSync(buboExe)) {
            throw new Error(`Исполняемый файл bubo.exe не найден по пути: ${buboExe}`);
        }

        // Шаг 2: Установка официальных библиотек AMD ROCm 10.0.0 (`gfx1151`) в общий #runtime/bubo/runtime/
        if ((step === 'runtime' || step === 'all') && fs.existsSync(buboExe)) {
            appendLog('Загрузка официальных пакетов AMD ROCm 10.0.0 для gfx1151 (bubo prepare runtime --yes)…');
            _windowsPrepareState.progress = Math.max(_windowsPrepareState.progress, 35);
            await new Promise((resolve, reject) => {
                const proc = spawnImpl(buboExe, [
                    'prepare', 'runtime',
                    '--runtime-dir', rocmDir,
                    '--yes',
                ], {
                    cwd: path.dirname(buboExe),
                    env: childEnv,
                    windowsHide: true,
                });
                proc.stdout?.on('data', d => appendLog(d));
                proc.stderr?.on('data', d => appendLog(d));
                proc.on('error', reject);
                proc.on('close', code => code === 0 ? resolve() : reject(new Error(`bubo prepare runtime завершился с кодом ${code}`)));
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
 * Настройки движка Halowin Bubo по умолчанию:
 *  - `profile: 'default'` — 1 сессия, контекст 200K, 8.6 ГБ RAM-кэш снимков и максимальная скорость спекуляции;
 *  - `mtpDraftVocab: 'auto'` — автопереключение словаря черновика MTP латиница ↔ кириллица (без просадки на русском тексте);
 *  - `draftMax: 7` — штатная глубина черновика Bubo (`--draft-tokens 7`);
 *  - `npuPrefill: true` — задействование Ryzen AI NPU для чтения длинных промптов (при наличии драйвера AMD XRT).
 */
export const DEFAULT_ENGINE_SETTINGS = Object.freeze({
    speculation: 'auto',
    draftMax: 7,
    promptLookup: 'auto',
    profile: 'default',
    mtpDraftVocab: 'auto',
    npuPrefill: true,
});

const ENGINE_STATE_MODES = ['auto', 'on', 'off'];
const ENGINE_PROFILES = ['default', 'subagents', 'exact', 'stock', 'vanilla'];

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

/** Файл настроек движка (`MODELS/Local/$provider/#runtime/engine.json`). */
export function engineSettingsFile(rootDir = process.cwd()) {
    return path.join(localRuntimeDir(rootDir), 'engine.json');
}

/** Файл состояния запущенного процесса движка (`MODELS/Local/$provider/#runtime/engine-state.json`). */
export function engineStateFile(rootDir = process.cwd()) {
    return path.join(localRuntimeDir(rootDir), 'engine-state.json');
}

export function readEngineStateSync(rootDir = process.cwd()) {
    try {
        return JSON.parse(fs.readFileSync(engineStateFile(rootDir), 'utf8')) || null;
    }
    catch {
        return null;
    }
}

export function writeEngineStateSync(rootDir = process.cwd(), state = {}) {
    try {
        fs.mkdirSync(localRuntimeDir(rootDir), { recursive: true });
        fs.writeFileSync(engineStateFile(rootDir), JSON.stringify(state, null, 2), 'utf8');
    }
    catch { /* ignore */ }
}

/** Прочитать сохранённые настройки движка (с валидацией значений). */
export function readEngineSettings(rootDir = process.cwd()) {
    let saved = {};
    try {
        saved = JSON.parse(fs.readFileSync(engineSettingsFile(rootDir), 'utf8')) || {};
    }
    catch { saved = {}; }
    const mode = v => ENGINE_STATE_MODES.includes(String(v || '')) ? String(v) : '';
    const savedProfile = ENGINE_PROFILES.includes(String(saved.profile || '')) ? String(saved.profile) : '';
    const profile = (saved.profileExplicit && savedProfile) ? savedProfile : DEFAULT_ENGINE_SETTINGS.profile;
    return {
        speculation: mode(saved.speculation) || DEFAULT_ENGINE_SETTINGS.speculation,
        promptLookup: mode(saved.promptLookup) || DEFAULT_ENGINE_SETTINGS.promptLookup,
        draftMax: clampInt(saved.draftMax, 1, 32, DEFAULT_ENGINE_SETTINGS.draftMax),
        profile,
        profileExplicit: Boolean(saved.profileExplicit && savedProfile),
        mtpDraftVocab: ['auto', 'latin', 'full'].includes(String(saved.mtpDraftVocab || '')) ? String(saved.mtpDraftVocab) : 'auto',
        npuPrefill: saved.npuPrefill !== false,
        updatedAt: Number(saved.updatedAt) || 0,
    };
}

/** Сохранить настройки движка (частичное обновление). */
export function writeEngineSettings(rootDir = process.cwd(), patch = {}) {
    const current = readEngineSettings(rootDir);
    const hasExplicitProfile = Boolean(patch && typeof patch.profile === 'string' && ENGINE_PROFILES.includes(patch.profile));
    const merged = {
        ...current,
        ...(patch && typeof patch === 'object' ? patch : {}),
        profileExplicit: hasExplicitProfile ? true : current.profileExplicit,
        updatedAt: Date.now(),
    };
    fs.mkdirSync(localRuntimeDir(rootDir), { recursive: true });
    fs.writeFileSync(engineSettingsFile(rootDir), JSON.stringify(merged, null, 2), 'utf8');
    return readEngineSettings(rootDir);
}

/** Разобрать список поддерживаемых флагов CLI из текста `--help` движка. */
export function parseEngineHelpFlags(text) {
    const out = new Set();
    for (const m of String(text || '').matchAll(/(?:^|[\s,;|[(=])(--[a-z][a-z0-9-]{1,40})/gi))
        out.add(m[1].toLowerCase());
    return [...out];
}

function engineCapabilitiesFile(rootDir = process.cwd()) {
    return path.join(localCacheDir(rootDir), 'engine-capabilities.json');
}

/** Прочитать закэшированные возможности движка (без запуска процесса). */
export function readEngineCapabilitiesSync(rootDir = process.cwd(), exePath = '') {
    try {
        const raw = JSON.parse(fs.readFileSync(engineCapabilitiesFile(rootDir), 'utf8'));
        if (Array.isArray(raw?.flags) && (!exePath || raw.exePath === exePath))
            return raw;
    }
    catch { /* нет кэша */ }
    return null;
}

function captureProcessOutput(cmd, args, spawnImpl, timeoutMs) {
    return new Promise(resolve => {
        let text = '';
        let done = false;
        const finish = () => {
            if (!done) {
                done = true;
                resolve(text);
            }
        };
        try {
            const proc = spawnImpl(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            const timer = setTimeout(() => {
                try { proc?.kill?.(); } catch { /* ignore */ }
                finish();
            }, timeoutMs);
            proc?.stdout?.on?.('data', d => { text += String(d); if (text.length > 40000) text = text.slice(-40000); });
            proc?.stderr?.on?.('data', d => { text += String(d); if (text.length > 40000) text = text.slice(-40000); });
            proc?.on?.('error', () => { clearTimeout(timer); finish(); });
            proc?.on?.('close', () => { clearTimeout(timer); finish(); });
        }
        catch {
            finish();
        }
    });
}

/**
 * Определить возможности `bubo.exe serve llm` по его `--help` (с кэшем на 7 дней).
 */
export async function inspectEngineCapabilities({
    rootDir = process.cwd(),
    exePath = '',
    spawnImpl = spawn,
    timeoutMs = 9000,
    maxAgeMs = 7 * 24 * 60 * 60 * 1000,
    force = false,
} = {}) {
    if (!exePath)
        return null;
    const cached = readEngineCapabilitiesSync(rootDir, exePath);
    if (!force && cached && Date.now() - Number(cached.checkedAt || 0) < maxAgeMs)
        return { ...cached, cached: true };

    let helpText = '';
    for (const args of [['serve', 'llm', '--help'], ['--help'], ['serve', '--help']]) {
        helpText = await captureProcessOutput(exePath, args, spawnImpl, timeoutMs);
        if (parseEngineHelpFlags(helpText).length)
            break;
    }
    const flags = parseEngineHelpFlags(helpText);
    const result = {
        exePath,
        flags,
        known: flags.length > 0,
        speculative: flags.includes('--speculative'),
        mtpDraftVocabFlag: flags.includes('--mtp-draft-vocab'),
        draftTokensFlag: flags.includes('--draft-tokens'),
        promptLookupFlag: flags.includes('--prompt-lookup'),
        noPromptLookupFlag: flags.includes('--no-prompt-lookup'),
        draftMaxFlag: flags.includes('--draft-tokens') || flags.includes('--draft-max'),
        lookupFlag: flags.includes('--prompt-lookup')
            ? '--prompt-lookup'
            : (flags.includes('--lookup-cache-dynamic') ? '--lookup-cache-dynamic' : ''),
        checkedAt: Date.now(),
        helpText: helpText.slice(-4000),
    };
    try {
        fs.mkdirSync(path.dirname(engineCapabilitiesFile(rootDir)), { recursive: true });
        fs.writeFileSync(engineCapabilitiesFile(rootDir), JSON.stringify(result, null, 2), 'utf8');
    }
    catch { /* кэш не критичен */ }
    return { ...result, cached: false };
}

/**
 * Собрать аргументы и переменные окружения `bubo.exe` для спекулятивного декодирования (по спецификации Bubo v0.1.2):
 *  - `--mtp-model` + `--twin-model` (`GUFO_DENSE_TWIN_MODEL`) + `--draft-head-model` (`GUFO_DRAFT_OUT_MODEL`);
 *  - `--speculative mtp` и `--mtp-draft-vocab auto` (критично для русского текста и кода одновременно);
 *  - `--prompt-lookup` включён в Bubo с MTP по умолчанию (или отключается через `--no-prompt-lookup`).
 */
export function resolveSpeculationPlan({
    settings = {},
    capabilities = null,
    sidecars = {},
    hasManifest = false,
    lookupPath = '',
} = {}) {
    const cfg = { ...DEFAULT_ENGINE_SETTINGS, ...(settings || {}) };
    const flags = new Set((capabilities?.flags || []).map(f => String(f).toLowerCase()));
    const capsKnown = flags.size > 0;
    const mtp = Boolean(sidecars?.mtpModel);
    const twin = Boolean(sidecars?.twinModel);
    const draftHead = Boolean(sidecars?.draftHeadModel);
    const args = [];
    const envVars = {};
    const reasons = [];
    let enabled = false;
    let promptLookup = false;

    if (cfg.speculation === 'off') {
        if (flags.has('--no-mtp'))
            args.push('--no-mtp');
        if (flags.has('--no-twin'))
            args.push('--no-twin');
        if (flags.has('--no-draft-head'))
            args.push('--no-draft-head');
        reasons.push('Спекулятивное декодирование отключено — используется только основная модель.');
    }
    else if (!mtp) {
        reasons.push('Файл MTP-предсказателя (mtp-*.gguf) не найден в $ai/#weights — спекуляция недоступна.');
    }
    else {
        args.push('--mtp-model', sidecars.mtpModel);
        if (twin) {
            args.push('--twin-model', sidecars.twinModel);
            envVars.GUFO_DENSE_TWIN_MODEL = sidecars.twinModel;
        }
        if (draftHead) {
            args.push('--draft-head-model', sidecars.draftHeadModel);
            envVars.GUFO_DRAFT_OUT_MODEL = sidecars.draftHeadModel;
        }
        if (!capsKnown || flags.has('--speculative')) {
            if (flags.has('--speculative'))
                args.push('--speculative', 'mtp');
            enabled = true;
        }
        // Автопереключение словаря черновика латиница ↔ кириллица снимает просадку скорости на русском языке
        const vocabMode = cfg.mtpDraftVocab || 'auto';
        if (!capsKnown || flags.has('--mtp-draft-vocab')) {
            args.push('--mtp-draft-vocab', vocabMode);
        }
        if (cfg.speculation === 'on') {
            const dTok = String(clampInt(cfg.draftMax, 1, 32, DEFAULT_ENGINE_SETTINGS.draftMax));
            if (flags.has('--draft-tokens'))
                args.push('--draft-tokens', dTok);
            else if (flags.has('--draft-max'))
                args.push('--draft-max', dTok);
        }
        if (cfg.promptLookup === 'off') {
            if (flags.has('--no-prompt-lookup'))
                args.push('--no-prompt-lookup');
        }
        else {
            promptLookup = true;
            if (!hasManifest && flags.has('--lookup-cache-dynamic') && !flags.has('--prompt-lookup') && lookupPath) {
                args.push('--lookup-cache-dynamic', lookupPath);
            }
        }
        reasons.push(
            `Активен полный стек спекуляции Bubo: MTP${twin ? ' + Dense Twin' : ''}${draftHead ? ' + Q4_K Draft Head' : ''} (словарь черновика: ${vocabMode}).`
        );
    }

    const mode = cfg.speculation === 'off'
        ? 'off'
        : (!mtp ? 'unavailable' : (capsKnown && flags.has('--speculative') ? 'explicit' : 'weights-only'));
    const parts = [
        mtp && mode !== 'off'
            ? `MTP${twin ? ' + Twin' : ''}${draftHead ? ' + Draft Head' : ''} (vocab: ${cfg.mtpDraftVocab || 'auto'})`
            : 'MTP выключен',
        promptLookup ? 'Prompt Lookup вкл.' : 'Prompt Lookup выкл.',
    ].filter(Boolean);

    return {
        mode,
        enabled: Boolean(mtp && mode !== 'off'),
        promptLookup,
        sidecars: {
            mtp: Boolean(mtp),
            twin: Boolean(twin),
            draftHead: Boolean(draftHead),
        },
        capabilitiesKnown: capsKnown,
        args,
        envVars,
        reasons,
        summary: parts.join(' · '),
        settings: { ...cfg },
    };
}

export function computeBuboLaunchSignature({
    exePath = '',
    port = HALOGEN_DEFAULT_PORT,
    modelPath = '',
    sidecars = null,
    profile = 'default',
    mtpDraftVocab = 'auto',
    speculation = 'auto',
    npuPrefill = false,
} = {}) {
    const raw = JSON.stringify({
        schema: 'bubo-v2.1',
        exePath,
        port: Number(port) || HALOGEN_DEFAULT_PORT,
        modelPath,
        mtp: sidecars?.mtpModel || '',
        twin: sidecars?.twinModel || '',
        draftHead: sidecars?.draftHeadModel || '',
        mmproj: sidecars?.mmprojModel || '',
        profile,
        mtpDraftVocab,
        speculation,
        npuPrefill: Boolean(npuPrefill),
    });
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

async function stopStaleBuboProcess({ rootDir = process.cwd(), port = HALOGEN_DEFAULT_PORT, winEnv = null } = {}) {
    stopHalogenBackend();
    const prevState = readEngineStateSync(rootDir);
    if (prevState?.pid && Number.isInteger(prevState.pid) && prevState.pid > 0 && prevState.pid !== process.pid) {
        try { process.kill(prevState.pid); } catch { /* уже завершён */ }
    }
    if (os.platform() === 'win32' && winEnv?.buboExePath && fs.existsSync(winEnv.buboExePath)) {
        await captureProcessOutput(winEnv.buboExePath, ['stop'], spawn, 3000).catch(() => '');
    }
    // Если старый bubo.exe запущен другим экземпляром WORK на этом же порту — аккуратно завершаем именно bubo/gufo на нашем порту
    if (os.platform() === 'win32') {
        const psCmd = `$c = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -match '^(bubo|gufo)$') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }`;
        await captureProcessOutput('powershell.exe', ['-NoProfile', '-Command', psCmd], spawn, 4000).catch(() => '');
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        const pr = await probeHalogenServer(`http://127.0.0.1:${port}/v1/chat/completions`, { rootDir }).catch(() => ({ online: false }));
        if (!pr?.online)
            break;
        await new Promise(r => setTimeout(r, 250));
    }
}

/**
 * Полное описание контура спекулятивного декодирования для UI: сохранённые настройки,
 * найденные веса (MTP / Dense twin / Draft head / Vision mmproj), возможности движка и итоговые флаги.
 */
export async function describeEngineSetup({
    rootDir = process.cwd(),
    settings = null,
    capabilities = undefined,
    forceCapabilities = false,
} = {}) {
    const winEnv = inspectWindowsHalogenEnvironment({ rootDir });
    const gguf = findLocalGgufModel(rootDir);
    const weightsDir = gguf ? path.dirname(gguf) : modelWeightsDir(rootDir, 'Qwen3.8-Flash-Next', 'Local');
    const sidecars = resolveBuboModelFiles(weightsDir);
    const hasManifest = Boolean(gguf && fs.existsSync(path.join(path.dirname(gguf), 'bubo-package.json')));
    const cfg = { ...readEngineSettings(rootDir), ...(settings || {}) };
    const exePath = winEnv.buboExePath || winEnv.gufoExePath || '';
    const caps = capabilities !== undefined
        ? capabilities
        : (readEngineCapabilitiesSync(rootDir, exePath)
            || (forceCapabilities ? await inspectEngineCapabilities({ rootDir, exePath, force: true }) : null));
    const plan = resolveSpeculationPlan({
        settings: cfg,
        capabilities: caps,
        sidecars,
        hasManifest,
        lookupPath: path.join(localCacheDir(rootDir), 'lookup.bin'),
    });
    const describeFile = p => {
        if (!p)
            return null;
        let sizeGb = 0;
        try { sizeGb = +((fs.statSync(p).size || 0) / (1024 ** 3)).toFixed(2); }
        catch { /* ignore */ }
        return { path: p, name: path.basename(p), sizeGb };
    };
    const stateOnDisk = readEngineStateSync(rootDir);
    const runningNpu = _managedInfo ? Boolean(_managedInfo.npuPrefill) : Boolean(stateOnDisk?.pid && stateOnDisk.npuPrefill);
    const npuReady = Boolean(winEnv.npuDriverInstalled && winEnv.npuKernelsPresent);
    let npuStatusText = '';
    if (os.platform() === 'linux') {
        const hasAccel = fs.existsSync('/dev/accel/accel0');
        npuStatusText = hasAccel ? 'Доступен (/dev/accel/accel0)' : 'Не обнаружен (/dev/accel/accel0)';
    }
    else if (runningNpu) {
        npuStatusText = 'Активен (--npu-prefill on · Ryzen AI XRT)';
    }
    else if (!cfg.npuPrefill) {
        npuStatusText = 'Отключён в настройках движка (npuPrefill: false)';
    }
    else if (!winEnv.npuDriverInstalled) {
        npuStatusText = 'Не включён: не найден драйвер AMD XRT NPU (C:\\Windows\\System32\\AMD\\xrt-smi.exe)';
    }
    else if (!winEnv.npuKernelsPresent) {
        npuStatusText = 'Не включён: отсутствует AIE-ядро *.xclbin в папке bubo\\tools\\npu';
    }
    else if (['exact', 'stock', 'vanilla'].includes(String(_managedInfo?.profile || cfg.profile || ''))) {
        npuStatusText = `Отключён профилем ${_managedInfo?.profile || cfg.profile} (переключите на default)`;
    }
    else if (npuReady) {
        npuStatusText = 'Готов к запуску (--npu-prefill on, перезапустите движок при необходимости)';
    }

    return {
        settings: cfg,
        weightsDir,
        mainModel: describeFile(gguf),
        sidecars: {
            mtp: describeFile(sidecars?.mtpModel),
            twin: describeFile(sidecars?.twinModel),
            draftHead: describeFile(sidecars?.draftHeadModel),
            mmproj: describeFile(sidecars?.mmprojModel),
        },
        plan,
        hasManifest,
        capabilities: caps ? {
            known: Boolean(caps.known),
            speculative: Boolean(caps.speculative),
            draftMax: Boolean(caps.draftMaxFlag),
            lookupFlag: caps.lookupFlag || '',
            cached: Boolean(caps.cached),
            checkedAt: caps.checkedAt || 0,
            flags: caps.flags || [],
        } : null,
        engine: {
            installed: Boolean(winEnv.buboInstalled || winEnv.gufoInstalled),
            runtime: winEnv.buboInstalled ? 'bubo.exe' : (winEnv.gufoInstalled ? 'gufo.exe' : ''),
            exePath,
            npuReady,
            npuDriverInstalled: Boolean(winEnv.npuDriverInstalled),
            npuKernelsPresent: Boolean(winEnv.npuKernelsPresent),
            npuActive: runningNpu,
            npuStatusText,
        },
        running: _managedInfo ? {
            runtime: _managedInfo.runtime,
            profile: _managedInfo.profile || cfg.profile,
            npuPrefill: Boolean(_managedInfo.npuPrefill),
            speculation: _managedInfo.speculation || plan,
            startedAt: _managedInfo.startedAt,
        } : (stateOnDisk?.pid ? {
            runtime: stateOnDisk.runtime || 'bubo',
            profile: stateOnDisk.profile || cfg.profile,
            npuPrefill: Boolean(stateOnDisk.npuPrefill),
            speculation: plan,
            startedAt: stateOnDisk.startedAt || 0,
        } : null),
        fallback: null,
    };
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
    profile = '',
    npuPrefill = null,
    spawnImpl = spawn,
    settings = null,
    capabilities = undefined,
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

    if (_managedProc && !_managedProc.killed && _managedInfo?.port === port) {
        return {
            started: true,
            alreadyStarting: true,
            mode: _managedInfo.runtime === 'llama-server' ? 'llama-server-windows' : 'bubo-windows',
            runtime: _managedInfo.runtimeLabel || _managedInfo.runtime,
            pid: _managedProc.pid,
            port,
            modelPath: _managedInfo.modelPath,
            windowsEnv: winEnv,
        };
    }

    const cacheDir = localCacheDir(rootDir);
    fs.mkdirSync(path.join(cacheDir, 'disk'), { recursive: true });
    fs.mkdirSync(path.join(cacheDir, 'slots'), { recursive: true });

    const ggufPath = modelPath || findLocalGgufModel(rootDir);
    const resolvedSidecars = ggufPath ? resolveBuboModelFiles(path.dirname(ggufPath)) : null;
    const manifestCandidate = ggufPath ? path.join(path.dirname(ggufPath), 'bubo-package.json') : '';
    const hasBuboManifest = Boolean(manifestCandidate && fs.existsSync(manifestCandidate));

    const engineSettings = { ...readEngineSettings(rootDir), ...(settings || {}) };
    const activeProfile = profile || engineSettings.profile || DEFAULT_ENGINE_SETTINGS.profile;
    const prefillEnabled = npuPrefill === null ? engineSettings.npuPrefill !== false : Boolean(npuPrefill);
    const effectiveNpuPrefill = Boolean(prefillEnabled && winEnv.npuDriverInstalled && winEnv.npuKernelsPresent && activeProfile !== 'exact' && activeProfile !== 'stock' && activeProfile !== 'vanilla');

    // 1. Приоритет №1 на Windows: нативный движок Halowin Bubo (`bubo.exe serve llm` на ROCm 10.0.0 gfx1151 + Ryzen AI NPU)
    if (winEnv.buboInstalled && ggufPath && fs.existsSync(ggufPath)) {
        try {
            const caps = capabilities !== undefined
                ? capabilities
                : await inspectEngineCapabilities({ rootDir, exePath: winEnv.buboExePath, spawnImpl });
            const plan = resolveSpeculationPlan({
                settings: engineSettings,
                capabilities: caps,
                sidecars: resolvedSidecars || {},
                hasManifest: hasBuboManifest,
                lookupPath: path.join(cacheDir, 'lookup.bin'),
            });
            const args = [
                'serve', 'llm',
                '--host', '127.0.0.1',
                '--port', String(port),
                '--model', ggufPath,
                ...(hasBuboManifest ? ['--manifest', manifestCandidate, '--cache-disk', path.join(cacheDir, 'disk')] : []),
                ...(resolvedSidecars?.mmprojModel ? ['--mmproj', resolvedSidecars.mmprojModel] : []),
                ...plan.args,
                '--served-model-name', 'halogen-qwen3.8-flash-next',
                '--profile', activeProfile,
            ];
            if (effectiveNpuPrefill) {
                args.push('--npu-prefill', 'on');
            }
            const signature = computeBuboLaunchSignature({
                exePath: winEnv.buboExePath,
                port,
                modelPath: ggufPath,
                sidecars: resolvedSidecars,
                profile: activeProfile,
                mtpDraftVocab: engineSettings.mtpDraftVocab || 'auto',
                speculation: engineSettings.speculation || 'auto',
                npuPrefill: effectiveNpuPrefill,
            });
            const env = {
                ...process.env,
                ...(winEnv.rocmRuntimeDir ? { BUBO_RUNTIME_DIR: winEnv.rocmRuntimeDir } : {}),
                ...(plan.envVars || {}),
            };
            const proc = spawnImpl(winEnv.buboExePath, args, {
                cwd: path.dirname(winEnv.buboExePath),
                env,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
            });
            proc.unref?.();
            attachManagedBackendProcess(proc, {
                port,
                modelPath: ggufPath,
                runtime: 'bubo',
                npuPrefill: effectiveNpuPrefill,
                profile: activeProfile,
                signature,
                args,
                speculation: plan,
            });
            writeEngineStateSync(rootDir, {
                pid: proc?.pid || null,
                port,
                runtime: 'bubo',
                profile: activeProfile,
                npuPrefill: effectiveNpuPrefill,
                signature,
                args,
                startedAt: Date.now(),
            });
            return {
                started: true,
                mode: 'bubo-windows',
                runtime: 'bubo.exe (AMD ROCm 10.0.0 gfx1151)',
                pid: proc.pid,
                port,
                signature,
                modelPath: ggufPath,
                windowsEnv: winEnv,
                speculation: {
                    ...plan,
                    appliedArgs: plan.args,
                },
                capabilities: caps ? { known: caps.known, flags: caps.flags, cached: Boolean(caps.cached) } : null,
            };
        }
        catch { /* try next runtime */ }
    }

    // 2. Приоритет №2 на Windows: нативный Gufo (`gufo.exe serve --port 8731 llm`)
    if (winEnv.gufoInstalled && ggufPath && fs.existsSync(ggufPath)) {
        try {
            const gufoSpeculation = engineSettings.speculation !== 'off' && Boolean(resolvedSidecars?.mtpModel);
            const args = [
                'serve',
                '--host', '127.0.0.1',
                '--port', String(port),
                'llm',
                '--model', ggufPath,
                '--served-model-name', 'halogen-qwen3.8-flash-next',
                ...(gufoSpeculation ? ['--speculative', 'mtp'] : []),
                ...(gufoSpeculation && resolvedSidecars?.mmprojModel ? ['--mmproj', resolvedSidecars.mmprojModel] : []),
            ];
            const proc = spawnImpl(winEnv.gufoExePath, args, {
                cwd: path.dirname(winEnv.gufoExePath),
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
            });
            proc.unref?.();
            attachManagedBackendProcess(proc, {
                port,
                modelPath: ggufPath,
                runtime: 'gufo',
                args,
                speculation: {
                    mode: gufoSpeculation ? 'explicit' : 'off',
                    enabled: gufoSpeculation,
                    summary: gufoSpeculation ? 'MTP включён (--speculative mtp)' : 'MTP выключен',
                    args: gufoSpeculation ? ['--speculative', 'mtp'] : [],
                },
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
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
            });
            proc.unref?.();
            attachManagedBackendProcess(proc, {
                port,
                modelPath: ggufPath,
                runtime: 'llama-server',
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

let _backendStartPromise = null;

export function stopHalogenBackend() {
    if (_managedProc && !_managedProc.killed) {
        try { _managedProc.kill(); } catch { /* ignore */ }
    }
    _managedProc = null;
    _managedInfo = null;
    _lastManagedExit = null;
    _lastSpeculationFallback = null;
    return { stopped: true };
}

/**
 * Проверить готовность локального движка на порту `:8731` и при необходимости автоматически запустить его
 * внутри ядра WORK (Windows: `bubo.exe` / `gufo.exe` / `llama-server`).
 */
export async function ensureHalogenBackendRunning({
    rootDir = process.cwd(),
    baseUrl = HALOGEN_DEFAULT_BASE_URL,
    ai = null,
    waitTimeoutMs = 120000,
    platform = os.platform(),
    spawnImpl = spawn,
} = {}) {
    let port = HALOGEN_DEFAULT_PORT;
    try {
        const u = new URL(baseUrl || HALOGEN_DEFAULT_BASE_URL);
        if (u.port)
            port = Number(u.port) || HALOGEN_DEFAULT_PORT;
    }
    catch { /* default */ }

    const modelFolderName = String(ai?.id || ai?.path || '').split('/').filter(Boolean).pop() || '';
    const candidateWeightsDir = ai?.weightsDir
        ? path.resolve(rootDir, ai.weightsDir)
        : (modelFolderName ? modelWeightsDir(rootDir, modelFolderName, 'Local') : '');
    const wInsp = candidateWeightsDir ? inspectWeightsDirectorySync(candidateWeightsDir, platform) : null;
    let winEnv = inspectWindowsHalogenEnvironment({ rootDir });

    const explicitGguf = (wInsp?.hasGguf && candidateWeightsDir)
        ? (resolveBuboModelFiles(candidateWeightsDir).mainModel || '')
        : '';
    const targetGguf = (explicitGguf && fs.existsSync(explicitGguf)) ? explicitGguf : findLocalGgufModel(rootDir);

    const probe1 = await probeHalogenServer(baseUrl, { rootDir });
    if (probe1.online) {
        // Если на Windows запущен старый процесс bubo.exe с прежними параметрами (например, --profile subagents с latin-словарём),
        // автоматически перезапускаем его с актуальной сигнатурой флагов.
        if (
            platform === 'win32'
            && probe1.mode === 'bubo-windows'
            && winEnv.buboInstalled
            && targetGguf
            && fs.existsSync(targetGguf)
            && spawnImpl === spawn
        ) {
            const cfg = readEngineSettings(rootDir);
            const activeProfile = cfg.profile || DEFAULT_ENGINE_SETTINGS.profile;
            const effectiveNpu = Boolean(cfg.npuPrefill !== false && winEnv.npuDriverInstalled && winEnv.npuKernelsPresent && activeProfile !== 'exact' && activeProfile !== 'stock' && activeProfile !== 'vanilla');
            const targetSig = computeBuboLaunchSignature({
                exePath: winEnv.buboExePath,
                port,
                modelPath: targetGguf,
                sidecars: resolveBuboModelFiles(path.dirname(targetGguf)),
                profile: activeProfile,
                mtpDraftVocab: cfg.mtpDraftVocab || 'auto',
                speculation: cfg.speculation || 'auto',
                npuPrefill: effectiveNpu,
            });
            const currentSig = _managedInfo?.signature || readEngineStateSync(rootDir)?.signature || '';
            if (currentSig === targetSig) {
                return {
                    ready: true,
                    alreadyRunning: true,
                    mode: probe1.mode,
                    origin: probe1.origin,
                };
            }
            await stopStaleBuboProcess({ rootDir, port, winEnv });
        }
        else {
            return {
                ready: true,
                alreadyRunning: true,
                mode: probe1.mode,
                origin: probe1.origin,
            };
        }
    }

    if (platform === 'win32' && wInsp?.incompatibleOnPlatform) {
        return {
            ready: false,
            code: 'INCOMPATIBLE_FORMAT',
            reason: wInsp.incompatibleReason,
            weightsDir: candidateWeightsDir,
        };
    }

    if (_backendStartPromise)
        return _backendStartPromise;

    _backendStartPromise = (async () => {
        try {
            // Автоматическая развёртка рантайма Halowin Bubo + ROCm 10.0, если веса GGUF уже лежат на диске
            if (
                platform === 'win32'
                && targetGguf
                && fs.existsSync(targetGguf)
                && !winEnv.buboInstalled
                && !winEnv.gufoInstalled
                && spawnImpl === spawn
                && process.env.WORK_DISABLE_AUTO_BUBO !== '1'
            ) {
                const prep = await prepareWindowsBuboRuntime({ rootDir, step: 'runtime', spawnImpl });
                if (!prep.ok) {
                    return {
                        ready: false,
                        code: 'RUNTIME_INSTALL_FAILED',
                        reason: `Не удалось автоматически развернуть движок Halowin Bubo: ${prep.error || 'нет доступа к сети'}`,
                        windowsEnv: prep.windowsEnv || winEnv,
                    };
                }
                winEnv = prep.windowsEnv || inspectWindowsHalogenEnvironment({ rootDir });
            }

            const startRes = await startHalogenBackend({
                rootDir,
                port,
                modelPath: explicitGguf && fs.existsSync(explicitGguf) ? explicitGguf : '',
                spawnImpl,
            });

            if (startRes.mode === 'work-embedded-fallback') {
                const code = platform === 'win32'
                    ? (winEnv.buboInstalled ? 'MODEL_MISSING' : 'RUNTIME_MISSING')
                    : 'SERVER_OFFLINE';
                return {
                    ready: false,
                    code,
                    reason: startRes.note,
                    windowsEnv: winEnv,
                };
            }

            const timeoutMs = Math.max(2000, Number(waitTimeoutMs) || 120000);
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (!_managedProc && startRes.started && !startRes.alreadyRunning) {
                    const exitInfo = _lastManagedExit;
                    return {
                        ready: false,
                        code: 'PROCESS_EXITED',
                        reason: formatBackendExitReason({
                            runtimeLabel: startRes.runtime || startRes.mode,
                            exitInfo,
                            winEnv,
                        }),
                        exitCode: exitInfo?.code ?? null,
                        stderr: exitInfo?.stderr || '',
                        windowsEnv: winEnv,
                    };
                }
                const probe2 = await probeHalogenServer(baseUrl, { rootDir });
                if (probe2.online) {
                    return {
                        ready: true,
                        alreadyRunning: false,
                        mode: probe2.mode,
                        origin: probe2.origin,
                    };
                }
                await new Promise(r => setTimeout(r, 500));
            }

            return {
                ready: false,
                code: 'START_TIMEOUT',
                reason: `Встроенный движок (${startRes.runtime || startRes.mode}) запущен, но ещё загружает веса модели в память (ожидание ${Math.round(timeoutMs / 1000)} с истекло). Повторите запрос через 15–30 секунд.`,
                windowsEnv: winEnv,
            };
        }
        finally {
            _backendStartPromise = null;
        }
    })();

    return _backendStartPromise;
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
        const weightsDir = modelWeightsDir(rootDir, spec.nodeName, 'Local');
        if (onlyWithWeights) {
            let hasFiles = false;
            try {
                if (fs.existsSync(weightsDir)) {
                    hasFiles = fs.readdirSync(weightsDir).some(f => !f.endsWith('.part') && f !== 'hf-manifest.json' && f !== 'download-state.json');
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
 * Убедиться, что общий нативный Windows-движок `bubo.exe` + `ROCm 10.0.0 gfx1151`
 * установлен в `MODELS/Local/$provider/#runtime/bubo/` (без скачивания или копирования весов).
 */
export async function ensureWindowsBuboEngineInstalled({
    rootDir = process.cwd(),
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
} = {}) {
    const envInfo = inspectWindowsHalogenEnvironment({ rootDir });
    if (!envInfo.buboInstalled || !envInfo.rocmRuntimePrepared) {
        const rtRes = await prepareWindowsBuboRuntime({
            rootDir,
            step: 'runtime',
            fetchImpl,
            spawnImpl,
        });
        if (!rtRes.ok)
            throw new Error(rtRes.error || 'Не удалось установить встроенный движок Halowin Bubo (ROCm 10.0 gfx1151)');
    }
    return { ok: true, windowsEnv: inspectWindowsHalogenEnvironment({ rootDir }) };
}
export const finalizeWindowsBuboModel = ensureWindowsBuboEngineInstalled;

/**
 * Проверить наличие скачанных весов и узлов `$ai` для каждой модели Halo, совместимой с текущей ОС.
 */
export function inspectHalogenCatalogWithStatus(rootDir = process.cwd(), { platform = os.platform() } = {}) {
    migrateLocalModelsLayoutSync(rootDir);
    const activeDownloads = listHuggingFaceDownloads(rootDir);
    const catalog = getHalogenCatalogForPlatform(platform);

    return catalog.map(spec => {
        const localWeightsDir = modelWeightsDir(rootDir, spec.nodeName, 'Local');
        const legacyLocalDir = path.join(rootDir, 'MODELS', 'Local', spec.nodeName, '#weights');
        const legacyHalogenDir = path.join(rootDir, 'MODELS', 'Halogen', spec.nodeName, '#weights');
        const weightsDir = fs.existsSync(localWeightsDir) ? localWeightsDir
            : (fs.existsSync(legacyLocalDir) ? legacyLocalDir
            : (fs.existsSync(legacyHalogenDir) ? legacyHalogenDir : localWeightsDir));

        const wInsp = inspectWeightsDirectorySync(weightsDir, platform);

        const nodeConfigured = fs.existsSync(modelClassFile(rootDir, spec.nodeName, 'Local'));
        let activeJob = activeDownloads.find(d =>
            (d.status === 'downloading' || d.status === 'paused' || d.status === 'failed')
            && (d.repoId === spec.hfRepo || (spec.windowsBuboRepo && d.repoId === spec.windowsBuboRepo) || d.folderName === spec.nodeName || d.modelPath === spec.path)
        ) || null;

        if (!activeJob && platform === 'win32' && spec.nodeName === 'Qwen3.8-Flash-Next' && (_windowsPrepareState.status === 'running' || _windowsPrepareState.status === 'error')) {
            activeJob = {
                id: 'bubo_prepare',
                repoId: spec.windowsBuboRepo || spec.hfRepo,
                folderName: spec.nodeName,
                label: spec.label,
                status: _windowsPrepareState.status === 'error' ? 'failed' : 'downloading',
                error: _windowsPrepareState.error || '',
                progress: _windowsPrepareState.progress || 5,
                downloadedBytes: 0,
                totalBytes: 0,
                currentFile: _windowsPrepareState.message || 'Установка движка Halowin Bubo…',
                sourceLabel: 'Halowin Bubo (ROCm 10.0)',
                speedMBs: 0,
                avgSpeedMBs: 0,
            };
        }

        const weightsDownloaded = !activeJob && !wInsp.pendingDownload && wInsp.hasReadyWeights && !wInsp.incompatibleOnPlatform;

        return {
            ...spec,
            nodeConfigured,
            weightsDir: path.relative(rootDir, weightsDir).replace(/\\/g, '/'),
            weightsDownloaded,
            incompatibleOnPlatform: wInsp.incompatibleOnPlatform,
            incompatibleReason: wInsp.incompatibleReason || '',
            downloadedFiles: wInsp.files,
            activeDownload: activeJob,
        };
    });
}

/**
 * Поставить в очередь скачивание совместимого с текущей ОС стека моделей Halo в `/MODELS/Local`:
 * - На Windows 11: проверяет диск/память и запускает нативную установку `Halowin Bubo` (ROCm 10.0.0 gfx1151 + GGUF 116.6 ГБ).
 * - На Linux: скачивает актуальные файлы `.hgn` + `.hnpw` для `halogen-flash-server`.
 */
export async function downloadHalogenBundle({
    rootDir = process.cwd(),
    models = null,
    token = '',
    waitForCompletion = false,
    platform = os.platform(),
    totalMemoryGb = null,
    fetchImpl = globalThis.fetch,
} = {}) {
    let filterList = null;
    if (Array.isArray(models) && models.length) {
        filterList = new Set(models.map(m => String(m).trim()));
    }
    else if (typeof models === 'string' && models.trim()) {
        filterList = new Set(models.split(',').map(m => m.trim()).filter(Boolean));
    }

    const platformCatalog = getHalogenCatalogForPlatform(platform);
    const targets = filterList
        ? platformCatalog.filter(m =>
            filterList.has(m.nodeName) || filterList.has(m.model) || filterList.has(m.hfRepo) || filterList.has(m.path)
        )
        : [...platformCatalog];

    if (platform === 'win32') {
        if (!targets.length) {
            throw new Error('Выбранная модель предназначена только для Linux (формат .hnpw/.hgn) и не поддерживается на Windows. Используйте совместимые Windows-модели из каталога.');
        }

        const hasBuboTarget = targets.some(m => m.runtimeType === 'bubo');
        const preflight = hasBuboTarget
            ? checkWindowsHalogenPreflight({
                rootDir,
                requiredDiskGb: 120,
                minTotalMemoryGb: 96,
                totalMemoryGb,
            })
            : { ok: true, warnings: [], errors: [] };

        const existingDownloads = listHuggingFaceDownloads(rootDir);
        const jobs = [];
        let startedCount = 0;
        let alreadyActiveCount = 0;

        for (const spec of targets) {
            const running = existingDownloads.find(d =>
                d.status === 'downloading'
                && (d.repoId === spec.hfRepo || (spec.windowsBuboRepo && d.repoId === spec.windowsBuboRepo) || d.folderName === spec.nodeName || d.modelPath === spec.path)
            );
            if (running) {
                alreadyActiveCount++;
                jobs.push(running);
                continue;
            }

            if (spec.runtimeType === 'bubo') {
                const job = await startHuggingFaceDownload({
                    repoId: spec.windowsBuboRepo || 'unsloth/Qwen3.8-Flash-Next-GGUF',
                    customFiles: QWEN_FLASH_NEXT_GGUF_FILES,
                    onComplete: ({ rootDir: rd }) => ensureWindowsBuboEngineInstalled({ rootDir: rd, fetchImpl }),
                    providerFolder: 'Local',
                    targetNodeName: spec.nodeName,
                    platform,
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
                        primaryFile: 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf',
                    },
                    rootDir,
                    token,
                    registerInWork: true,
                    waitForCompletion,
                    fetchImpl,
                });
                startedCount++;
                jobs.push(job);
                continue;
            }

            const job = await startHuggingFaceDownload({
                repoId: spec.hfRepo,
                providerFolder: 'Local',
                targetNodeName: spec.nodeName,
                platform,
                nodeMeta: {
                    label: spec.label || spec.nodeName,
                    model: spec.model || spec.hfRepo,
                    protocol: spec.protocol || 'local',
                    icon: spec.icon || 'ai:qwen',
                    modality: spec.modality,
                    capabilities: spec.capabilities,
                    efforts: spec.efforts,
                    maxTokens: spec.maxTokens,
                    maxOutput: spec.maxOutput,
                    baseUrl: spec.baseUrl || '',
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
            mode: hasBuboTarget ? 'bubo-windows' : 'local-windows',
            warnings: preflight.warnings || [],
            preflight,
            jobs,
        };
    }

    const existingDownloads = listHuggingFaceDownloads(rootDir);
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
            platform,
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
