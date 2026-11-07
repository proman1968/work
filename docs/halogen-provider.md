# Гибридный провайдер `/MODELS/Halogen` (AMD Ryzen™ AI Max+ PRO 495 · 192 ГБ RAM)

Документация по устройству, настройке и эксплуатации гибридного ИИ-провайдера **`/MODELS/Halogen`** в платформе **WORK** для программно-аппаратного комплекса **ODANT-WORK (`WORK-PAK-495-192-4T`)** и совместимых рабочих станций с единой памятью (Unified Memory Architecture).

---

## 1. Назначение и архитектура

Провайдер `/MODELS/Halogen` реализует в WORK архитектуру [`peonist-ai/halogen-flash-server`](https://github.com/peonist-ai/halogen-flash-server): за **одним локальным портом (`127.0.0.1:8731`)** одновременно обслуживаются:
1. **Флагманская агентская модель на iGPU (`AMD Radeon 8065S / gfx1151`)** — `Qwen3.8-Flash-Next` (180B MoE, 4.16 bpw + 47.7 ГБ FP8 n-gram lookup-таблица, контекст 262 144 токена).
2. **Семейство из 7 быстрых сопроцессорных моделей на нейропроцессоре `AMD Ryzen AI NPU (55 TOPS)`** — фоновое сжатие контекста (`compactModel`), распознавание речи (`sttModel`), синтез речи (`ttsModel`), генерация/редактирование изображений (`imageModel`), эмбеддинги (`/v1/embeddings`), реранкинг (`/v1/rerank`) и однопроходный классификатор System One (`/v1/systemone`).

Маршрутизация запросов между GPU и NPU происходит прозрачно по полю `model`. Благодаря этому фоновые вызовы (озвучивание фраз в голосовом режиме, распознавание микрофона, векторный поиск или сжатие истории задачи) выполняются на NPU и **не вымывают KV-кэш основной модели на GPU**.

---

## 2. Три режима работы (Универсальный гибрид)

Модуль `sources/modules/trainer/halogen.js` и прототип `MODELS/$ai/$folder/$class/$ai/class.js` поддерживают три бесшовных режима работы:

| Режим (`mode`) | Где работает | Как устроен |
| :--- | :--- | :--- |
| **`halogen-native`** | **Linux Native** (Ubuntu 24.04+ HWE / Fedora 43, ядро с `CONFIG_HSA_AMD_SVM`, `/dev/kfd`, `/dev/accel/accel0`) | Прямое подключение к контейнеру `ghcr.io/peonist-ai/halogen-flash-server:0.19.1` на порту `8731`. Zero-copy регистрация весов в SVM, аппаратный NPU `amdxdna`. |
| **`llama-server-windows`** | **Windows 11 Native** (драйвер AMD Adrenalin + HIP/ROCm for Windows или Vulkan + Ryzen AI NPU DirectML) | Запуск нативного `llama-server.exe` на порту `8731` с общим пулом памяти до 175 ГБ, Prompt Cache (`--cache-reuse 256`), Speculative Lookup (`--lookup-cache-dynamic`) и сохранением слотов (`--slot-save-path`). |
| **`work-embedded-fallback`** | **Любая ОС (Windows / Linux / macOS)** без запущенного внешнего процесса на `:8731` | При `ECONNREFUSED` / `ETIMEDOUT` на порту `8731` все вызовы `/MODELS/Halogen/*` автоматически перехватываются встроенным движком WORK (`WORK.localStreamChat` на PyTorch `.safetensors` + `WORK.halogenFallback` для TTS WAV 24 кГц, Embeddings, Rerank и SystemOne Decide). |

---

## 3. Раскладка памяти на 192 ГБ (AMD Ryzen™ AI Max+ PRO 495)

На системах со 128 ГБ ОЗУ `halogen-flash-server` оставляет хосту всего ~12 ГБ, из-за чего 47.7 ГБ таблица n-gram lookup вытесняется на NVMe-диск. На **192 ГБ LPDDR5x-8533 Unified Memory** планировщик `computeHalogenMemoryPlan({ totalRamGb: 192 })` размещает весь стек в оперативной памяти целиком без свопинга:

| Компонент | Объём в ОЗУ | Описание |
| :--- | :--- | :--- |
| **Веса `Qwen3.8-Flash-Next` (v2)** | **62.1 ГБ** | Заблокированы в памяти (`HALOGEN_WEIGHTS_LOCK=1`), не вытесняются ядром |
| **KV-пул (`524 288` токенов, 4 слота)** | **27.0 ГБ** | Одновременное удержание до 4 глубоких агентских сессий по 130k–262k токенов |
| **FP8 N-gram Lookup Table** | **47.7 ГБ** | Постоянно находится в системном page cache в RAM (0 обращений к диску на холодных промптах) |
| **Стек из 7 моделей на NPU** | **21.2 ГБ** | `qwen3.5-2b` (1.8 ГБ) + `qwen3-asr-1.7b` (4.0 ГБ) + `qwen3-tts-1.7b` (5.0 ГБ) + `flux2-klein-4b` (7.6 ГБ) + `embedding` (0.8 ГБ) + `reranker` (0.8 ГБ) + `decider` (1.2 ГБ) |
| **Резерв ОС и сервера WORK** | **~34.0 ГБ** | Node.js, изолированные SQLite-базы организаций, индекс и системные буферы |
| **ИТОГО** | **192.0 ГБ** | Полная утилизация Unified Memory без дисковых задержек |

> **Важная настройка BIOS:** установите **UMA Frame Buffer Size (Dedicated Graphics Memory) = Minimum (512 MB / 1 GB)**, а не `Auto`. На платах Strix Halo значение `Auto` может зарезервировать до 64 ГБ под классический фреймбуфер, скрыв их от ОС и кэша.

---

## 4. Матрица моделей в `/MODELS/Halogen`

Все 8 моделей наследуют канал от `/MODELS/Halogen/$provider` (`protocol: 'halogen'`, `baseUrl: 'http://127.0.0.1:8731/v1/chat/completions'`):

| Узел в дереве WORK | Поле `model` | Вычислитель | Возможности (`capabilities`) | Роль в `ai/config.js` и методы `$ai` |
| :--- | :--- | :--- | :--- | :--- |
| **`/MODELS/Halogen/Qwen3.8-Flash-Next`** | `halogen-qwen3.8-flash-next` | iGPU (`gfx1151`) | `chat, stream, tools, functions, vision, effort, thinking, fork` | `model` — основной агент и субагенты (`streamChat`) |
| **`/MODELS/Halogen/Qwen3.5-2B-NPU`** | `qwen3.5-2b` | Ryzen AI NPU | `chat, stream` | `compactModel` — быстрое сжатие контекста (`maybeCompact`) |
| **`/MODELS/Halogen/Qwen3-ASR-NPU`** | `qwen3-asr-1.7b` | Ryzen AI NPU | `stt, asr` | `sttModel` — распознавание речи (`$ai.transcribe()`) |
| **`/MODELS/Halogen/Qwen3-TTS-NPU`** | `qwen3-tts-1.7b-customvoice` | Ryzen AI NPU | `tts, voice` | `ttsModel` — синтез речи с Barge-In (`$ai.speak()`) |
| **`/MODELS/Halogen/Flux2-Klein-NPU`** | `flux2-klein-4b` | Ryzen AI NPU | `image, text-to-image` | `imageModel` — генерация картинок (`$ai.generateImage()`) |
| **`/MODELS/Halogen/Qwen3-Embedding-NPU`** | `qwen3-embedding-0.6b` | Ryzen AI NPU | `embeddings, rag` | Векторизация текста 1024d (`$ai.embed()`) |
| **`/MODELS/Halogen/Qwen3-Reranker-NPU`** | `qwen3-reranker-0.6b` | Ryzen AI NPU | `rerank, rag` | Ранжирование документов (`$ai.rerank()`) |
| **`/MODELS/Halogen/Decider-NPU`** | `decider-0.8b` | Ryzen AI NPU | `decide, classify` | Однопроходный классификатор System One (`$ai.decide()`) |

### Пример подключения в `$server/$folder/$class/ai/config.js` (или в слое организации)

```js
export default {
    model: '/MODELS/Halogen/Qwen3.8-Flash-Next',
    compactModel: '/MODELS/Halogen/Qwen3.5-2B-NPU',
    ttsModel: '/MODELS/Halogen/Qwen3-TTS-NPU',
    sttModel: '/MODELS/Halogen/Qwen3-ASR-NPU',
    imageModel: '/MODELS/Halogen/Flux2-Klein-NPU',
    dot: { eyes: 'round', accessory: 'none' },
};
```

---

## 5. Специальные возможности протокола `halogen` в ядре WORK

### 5.1. Форкинг KV-кэша сессий для субагентов (`X-Halogen-Keep` / `X-Halogen-From`)
Когда в задаче `.task` работает модель с поддержкой `fork` (`protocol: 'halogen'`), цикл агента (`sources/modules/agent/loop.js`) автоматически синхронизирует KV-состояние:
* Основной агент (`depth === 0`) отправляет заголовок `X-Halogen-Keep: work-<taskPath>`, сохраняя вычисленный KV-кэш в пуле сервера по окончании хода.
* Вызываемые субагенты (`depth > 0`) и последующие ходы отправляют `X-Halogen-From: work-<taskPath>`, мгновенно переиспользуя прогретый KV-кэш родительской задачи (время до первого токена ~1.6 с).
* Ответный заголовок `X-Halogen-From: used | unmatched | unknown` и счётчик `timings.cache_n` автоматически записываются в `it.usage` (`cached`, `halogenFrom`, `timings`).

### 5.2. Догенерация с места обрыва (`continue_final_message`)
При передаче `continueFinalMessage: true` в `streamChat()` адаптер добавляет в тело запроса:
```json
{
  "continue_final_message": true,
  "add_generation_prompt": false
}
```
Это позволяет продолжить генерацию ответа или аргументов длинного `tool_call`, прерванного по `finish_reason: "length"`, байт-в-байт с точки остановки.

### 5.3. Потоковый защитник (`X-Halogen-Guard`) и управление `effort`
* Уровень рассуждений `effort` (`off | low | medium | high | xhigh`) транслируется в пару полей `reasoning_effort` (`none` при `off`) + `enable_thinking: true/false` (и опциональный `max_thinking_tokens`).
* При передаче `halogenGuard: true` добавляется заголовок `X-Halogen-Guard: watch`, а потоковые вердикты `qwen3guard-stream-0.6b` отдаются событиями `{ type: 'guard', guard }`.

### 5.4. Новые методы `$ai` для NPU-моделей
На любом экземпляре `$ai` доступны методы:
* `await model.embed({ input: ['Текст 1', 'Текст 2'], dimensions: 1024 })` → `POST /v1/embeddings`
* `await model.rerank({ query: 'запрос', documents: ['док 1', 'док 2'], topN: 5 })` → `POST /v1/rerank`
* `await model.decide({ state: 'текст ситуации', questions: { q1: { type: 'choice', criteria: { a: '...', b: '...' } } } })` → `POST /v1/systemone`

---

## 6. Загрузка весов и запуск сервера

### Скачивание всего пакета одной кнопкой
В интерфейсе WORK откройте **`/MODELS/Halogen` → вкладка «Обучение» → «4. Контур Halogen (Ryzen AI 192 ГБ: GPU + NPU)»** и нажмите кнопку **«Скачать весь пакет (GPU + NPU)»** (метод `halogen_download_bundle` / `downloadHalogenBundle`):
* Загрузчик автоматически ставит в очередь все 8 репозиториев (`peonist-ai/halogen-qwen3.8-flash-next` и 7 NPU-моделей `peonist-ai/halogen-npu-*`), скачивая веса (`.hgn`, `.hnpw`, `.safetensors`, `.gguf`, `config.json`, `tokenizer.json`) напрямую в `MODELS/Halogen/<Модель>/#weights` с поддержкой докачки (`HTTP Range`) и живым индикатором прогресса на каждой карточке.
* Также каждую из 8 моделей можно скачать отдельно кнопкой **«Скачать»** на её карточке.

### На Windows 11 (нативный гибридный режим)
Можно запустить прямо из интерфейса WORK (**`/MODELS/Halogen` → вкладка «Обучение» → «4. Контур Halogen» → «Запустить локальный сервер»** или вызовом метода `halogen_start`), либо из консоли:

```cmd
llama-server.exe ^
  --host 127.0.0.1 --port 8731 ^
  --alias halogen-qwen3.8-flash-next ^
  -m MODELS\Local\Qwen3-30B-A3B\#weights\model.gguf ^
  --ctx-size 262144 --parallel 4 -ngl 999 --flash-attn ^
  --cache-reuse 256 --lookup-cache-dynamic MODELS\Local\#cache\lookup.bin ^
  --slot-save-path MODELS\Local\#cache\slots
```

### На Linux (оригинальный контейнер `halogen-flash-server` с NPU)

```bash
# Фиксация частоты шины GPU/NPU (один раз при установке на хосте)
sudo systemctl enable --now halogen-fabric-clock.service

# Запуск сервера с блокировкой весов в ОЗУ и полным набором NPU-моделей
mkdir -p ~/halogen-models
podman run --rm -p 8731:8731 \
  --device /dev/kfd --device /dev/dri --device /dev/accel/accel0 --group-add keep-groups \
  --ipc=host --ulimit memlock=-1:-1 \
  -e HALOGEN_WEIGHTS_LOCK=1 \
  -e HALOGEN_VISION_TOWER=1 \
  -e HALOGEN_FORK=1 \
  -e HALOGEN_KV_POOL_POSITIONS=524288 \
  -e HALOGEN_KV_SLOTS=4 \
  -e HALOGEN_MAX_TOK=32768 \
  -e HALOGEN_DOWNLOAD=peonist-ai/halogen-qwen3.8-flash-next \
  -e HALOGEN_NPU_MODELS=decider-0.8b,qwen3-embedding-0.6b,qwen3-reranker-0.6b,qwen3.5-2b,qwen3-asr-1.7b,qwen3-tts-1.7b-customvoice,flux2-klein-4b \
  -v ~/halogen-models:/models \
  ghcr.io/peonist-ai/halogen-flash-server:0.19.1
```

---

## 7. Проверка и тестирование

Для проверки всех режимов провайдера `/MODELS/Halogen` (структура дерева, раскладка памяти 192 ГБ, работа с портом `:8731`, заголовки `X-Halogen-Keep`/`X-Halogen-From` в `runLoop` и автономный Windows-фоллбэк) выполните:

```bash
node --test tests/halogen-provider.test.js
```
