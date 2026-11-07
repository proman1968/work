# Провайдер `/MODELS/Halogen` (AMD Ryzen AI Max+ PRO 495 · 192 ГБ Unified Memory)

Универсальный гибридный провайдер локального ИИ по архитектуре [`peonist-ai/halogen-flash-server`](https://github.com/peonist-ai/halogen-flash-server), объединяющий за единым портом `8731` основную агентскую модель на iGPU (`Radeon 8065S / gfx1151`) и семейство специализированных моделей на нейропроцессоре **AMD Ryzen AI NPU (`55 TOPS`)**.

## Режимы работы (Универсальный гибрид)

1. **Linux Native (`halogen-flash-server:0.19.1`):**
   - прямая регистрация 62 ГБ весов `Qwen3.8-Flash-Next` в памяти GPU через `/dev/kfd` (`CONFIG_HSA_AMD_SVM`, `HALOGEN_WEIGHTS_LOCK=1`);
   - KV-пул на `524 288` токенов (`4` слота), `47.7 ГБ` FP8 n-gram lookup-таблица целиком в ОЗУ;
   - аппаратный NPU (`/dev/accel/accel0`, `amdxdna`) для малых моделей (`HALOGEN_NPU_MODELS`).
2. **Windows 11 Hybrid (`llama-server.exe` ROCm/Vulkan + WORK NPU Engine):**
   - запуск `Qwen3.8-Flash-Next` / `Qwen3` в GGUF на iGPU с общим пулом памяти до 175 ГБ, Prompt Cache (`--cache-reuse 256`), Speculative Lookup (`--lookup-cache-dynamic`) и сохранением слотов;
   - обслуживание NPU-моделей (TTS, ASR, Image, Embeddings, Rerank, Decider) без вымывания кэша основной модели.
3. **Встроенный фоллбэк WORK (`work-embedded-fallback`):**
   - если внешний сервер на `:8731` не запущен, все вызовы моделей `/MODELS/Halogen/*` автоматически обрабатываются встроенным локальным контуром WORK (`localStreamChat` + `halogenFallback`).

## Состав моделей в `/MODELS/Halogen`

| Узел WORK | Модель (`model`) | Вычислитель | Назначение в WORK |
| :--- | :--- | :--- | :--- |
| `/MODELS/Halogen/Qwen3.8-Flash-Next` | `halogen-qwen3.8-flash-next` | iGPU (`gfx1151`) | Основная модель агента (`ai/config.js → model`), 262k контекст, `tools`, `vision`, `effort`, `fork` |
| `/MODELS/Halogen/Qwen3.5-2B-NPU` | `qwen3.5-2b` | Ryzen AI NPU | Быстрое сжатие контекста (`ai/config.js → compactModel`) и сводки без нагрузки на GPU |
| `/MODELS/Halogen/Qwen3-ASR-NPU` | `qwen3-asr-1.7b` | Ryzen AI NPU | Распознавание речи в голосовом режиме задачи (`ai/config.js → sttModel`) |
| `/MODELS/Halogen/Qwen3-TTS-NPU` | `qwen3-tts-1.7b-customvoice` | Ryzen AI NPU | Попредложенческий синтез речи с поддержкой Barge-In (`ai/config.js → ttsModel`) |
| `/MODELS/Halogen/Flux2-Klein-NPU` | `flux2-klein-4b` | Ryzen AI NPU | Генерация и редактирование иллюстраций до 1024×1024 (`ai/config.js → imageModel`) |
| `/MODELS/Halogen/Qwen3-Embedding-NPU` | `qwen3-embedding-0.6b` | Ryzen AI NPU | Векторные эмбеддинги 1024d для семантического поиска (RAG) |
| `/MODELS/Halogen/Qwen3-Reranker-NPU` | `qwen3-reranker-0.6b` | Ryzen AI NPU | Семантическое ранжирование документов (`/v1/rerank`) |
| `/MODELS/Halogen/Decider-NPU` | `decider-0.8b` | Ryzen AI NPU | Однопроходный классификатор System One (`/v1/systemone`, ~45 мс) |
