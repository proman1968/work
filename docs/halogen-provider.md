# Провайдер `/MODELS/Halogen` (AMD Strix Halo `gfx1151` · 128–192 ГБ Unified Memory)

Документация по устройству, настройке и эксплуатации провайдера **`/MODELS/Halogen`** в платформе **WORK** для программно-аппаратного комплекса **ODANT-WORK (`WORK-PAK-495-192-4T`)** и рабочих станций/ноутбуков на базе **AMD Ryzen™ AI Max+ PRO 495 / 395 (Strix Halo, Radeon 8060S/8065S `gfx1151` + Ryzen AI NPU 55 TOPS)**.

---

## 1. Назначение и архитектура

Провайдер `/MODELS/Halogen` объединяет за **единым локальным портом (`127.0.0.1:8731`)**:
1. **Флагманскую агентскую модель на iGPU (`AMD Radeon 8060S/8065S · gfx1151`)** — `Qwen3.8-Flash-Next` (180B MoE, контекст до 262 144 токенов, спекулятивное декодирование MTP + Prompt Lookup, зрение и вызов инструментов).
2. **Семейство из 7 быстрых сопроцессорных моделей (`AMD Ryzen AI NPU 55 TOPS`)** — фоновое сжатие контекста (`compactModel`), распознавание речи (`sttModel`), синтез речи (`ttsModel`), генерация/редактирование изображений (`imageModel`), эмбеддинги (`/v1/embeddings`), реранкинг (`/v1/rerank`) и однопроходный классификатор System One (`/v1/systemone`).

---

## 2. Режимы работы: Linux Native, Windows 11 Native (Bubo / Gufo) и почему WSL2 не подходит

### Почему `halogen-flash-server` НЕ работает в WSL2
Оригинальный контейнер [`peonist-ai/halogen-flash-server`](https://github.com/peonist-ai/halogen-flash-server) поставляется с закрытым бинарником `flash_serve`, который жёстко привязан к нативному Linux-драйверу `amdgpu/KFD`:
* При старте сервер отображает файл весов (`mmap` read-only) и регистрирует его в контроллере памяти GPU без копирования (zero-copy SVM) через `/dev/kfd` (требуется `CONFIG_HSA_AMD_SVM`), а к NPU обращается напрямую через `/dev/accel/accel0` (`amdxdna`).
* В **WSL2** доступ к GPU идёт через паравиртуализированный мост DirectX `/dev/dxg` (`librocdxg`), который **отказывает в регистрации read-only `mmap`**, а устройство `/dev/accel/accel0` в WSL2 отсутствует. В официальной документации `peonist-ai/halogen-flash-server` (`docs/troubleshooting.md`) прямо указано: *«WSL2 (ROCm through `/dev/dxg`) is not a supported host: the registration is refused there, and the server does not reach readiness»*.

### Нативный стек для Windows 11: Halowin Bubo / Gufo (MIT) и Strata (MIT)
Вместо WSL2 на Windows 11 в WORK используется **нативный открытый стек под архитектуру Strix Halo (`gfx1151`)**:

| Режим (`mode`) | ОС и движок | Как устроен |
| :--- | :--- | :--- |
| **`halogen-native`** | **Linux Native** (`ghcr.io/peonist-ai/halogen-flash-server:0.20.3`) | Прямое подключение к контейнеру `halogen-flash-server` на порту `8731`. Zero-copy SVM `/dev/kfd`, аппаратный NPU `/dev/accel/accel0`. |
| **`bubo-windows`** | **Windows 11 Native** — [**Halowin Bubo**](https://github.com/haloforge-labs/bubo) (`bubo.exe`) / [**Gufo**](https://github.com/gufo-org/gufo) (`gufo.exe`, MIT) | Нативный Windows x64 движок (`gufo 0.26.0`) на базе официальных колёс **AMD ROCm 10.0.0 для `gfx1151`** (`rocm_sdk_core`, `rocm_sdk_libraries`, `rocm_sdk_device_gfx1151` с `hipBLASLt`) и драйвера **AMD XRT NPU** (`C:\Windows\System32\AMD\xrt-smi.exe` + AIE-ядра `final_4096x2560x1024_128x64x128.xclbin`, `--npu-prefill on`). Запускает `Qwen3.8-Flash-Next` (`UD-Q4_K_XL` + `MTP predictor` + `Dense twin` + `Q4_K draft head` + `mmproj`) со скоростью **57–77.5 tok/s** (код/проза), **109 tok/s** (редактирование кода), **1 415 tok/s** (prefill 32K) и **0.9 с** до первого токена из кэша. Мультимодальные сервисы запускаются командами `gufo.exe serve asr\|tts\|embedding\|image\|decision`. |
| **`strata-windows`** | **Windows 11 Native** — [**Strata**](https://github.com/Niko1221/Strata) (`strata.exe`, MIT) | Альтернативный нативный Windows HIP-движок (`windows-x86_64-hip-rdna3`) с калиброванной таблицей `gfx1151-hipblaslt-100401.txt` и матричными ядрами WMMA (`STRATA_HIP_WMMA`, `STRATA_PF_FUSED`). |
| **`work-embedded-fallback`** | **Любая ОС (оффлайн / CI / ПК без Strix Halo)** | Если порт `:8731` закрыт, вызовы `/MODELS/Halogen/*` автоматически обрабатываются локальным контуром WORK (`WORK.localStreamChat` на PyTorch `.safetensors` + `WORK.halogenFallback`). |

---

## 3. Противоположные настройки BIOS (UMA) и файла подкачки на Linux и Windows 11

Обратите особое внимание: настройки памяти BIOS для Linux и для Windows 11 на Strix Halo **прямо противоположны**:

| Параметр | Настройка для **Linux (`halogen-flash-server`)** | Настройка для **Windows 11 (`Halowin Bubo` / `Gufo` / `Strata`)** |
| :--- | :--- | :--- |
| **BIOS UMA Frame Buffer / Variable Graphics Memory (VGM)** | **Minimum (`512 MB` / `1 GB`)**, **НЕ `Auto`** — ядро Linux выделяет всю единую память через динамический пул `GTT` (`ttm.pages_limit`), а статический carve-out только отнимает память у системного файлового кэша. | **`96 ГБ`** (на машинах со 128 ГБ ОЗУ) или **`128 ГБ`** (на машинах со 192 ГБ ОЗУ) через BIOS или `AMD Software: Adrenalin Edition → Performance → Tuning → Variable Graphics Memory`. Под Windows WDDM ROCm/HIP выделяет буферы модели внутри выделенного пула GPU. |
| **Файл подкачки (Page File / Swap)** | Стандартный / zram (веса удерживаются в ОЗУ через `HALOGEN_WEIGHTS_LOCK=1`). | **Фиксированный Page File = `131072 МБ` (128 ГБ)** на системном NVMe SSD (`Исходный размер = 131072 МБ`, `Максимальный размер = 131072 МБ`). Необходим диспетчеру виртуальной памяти Windows (Commit Charge limit) для резервирования 117 ГБ буферов ROCm и весов при старте. |
| **Драйверы и системные пакеты** | Ядро Linux `>= 6.18.4` / Ubuntu 24.04 HWE с `CONFIG_HSA_AMD_SVM`, драйвер `amdxdna` (`/dev/accel/accel0`), `halogen-fabric-clock.service`. | Графический драйвер AMD Adrenalin `>= 32.0.31041.1004` (`26.10.1`+), драйвер NPU AMD XRT `32.0.20102.3931` (`C:\Windows\System32\AMD\xrt-smi.exe`), пакет [Microsoft VC++ 2015–2022 Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe), профиль питания **Performance**. |

### Быстрая настройка фиксированного Page File 128 ГБ в Windows 11 (PowerShell от Администратора)

```powershell
$cs = Get-CimInstance Win32_ComputerSystem
if ($cs.AutomaticManagedPagefile) { Set-CimInstance -InputObject $cs -Property @{AutomaticManagedPagefile=$false} }
$pf = Get-CimInstance Win32_PageFileSetting -Filter "Name='C:\\pagefile.sys'"
if ($pf) { Set-CimInstance -InputObject $pf -Property @{InitialSize=131072; MaximumSize=131072} }
else { New-CimInstance -ClassName Win32_PageFileSetting -Property @{Name='C:\pagefile.sys'; InitialSize=131072; MaximumSize=131072} }
```
*(После выполнения перезагрузите Windows).*

---

## 4. Раскладка памяти на 192 ГБ (AMD Ryzen™ AI Max+ PRO 495)

Планировщик `computeHalogenMemoryPlan({ totalRamGb: 192 })` рассчитывает бюджет единой памяти без свопинга:

| Компонент | Объём в ОЗУ | Описание |
| :--- | :--- | :--- |
| **Веса `Qwen3.8-Flash-Next`** | **62.1 ГБ** | Основные веса модели (4.16 bpw / UD-Q4_K_XL + Dense Twin + MTP Draft Head) |
| **KV-пул (`524 288` токенов, 4 слота)** | **27.0 ГБ** | Одновременное удержание до 4 глубоких агентских сессий (`--profile subagents`) |
| **FP8 N-gram Lookup Table** | **47.7 ГБ** | Таблица быстрого поиска n-грамм в оперативной памяти |
| **Стек из 7 моделей на NPU** | **21.2 ГБ** | `qwen3.5-2b` (1.8 ГБ) + `qwen3-asr-1.7b` (4.0 ГБ) + `qwen3-tts-1.7b` (5.0 ГБ) + `flux2-klein-4b` (7.6 ГБ) + `embedding` (0.8 ГБ) + `reranker` (0.8 ГБ) + `decider` (1.2 ГБ) |
| **Резерв ОС и сервера WORK** | **~34.0 ГБ** | Node.js, изолированные SQLite-базы организаций, индекс и системные буферы |
| **ИТОГО** | **192.0 ГБ** | Полная утилизация Unified Memory без дисковых задержек |

---

## 5. Матрица моделей в `/MODELS/Halogen`

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

---

## 6. Установка и запуск сервера на Windows 11 и Linux

### На Windows 11 (нативный движок Halowin Bubo / Gufo без WSL2)

1. В интерфейсе WORK откройте **`/MODELS/Halogen` → вкладка «Обучение» → «4. Контур Halogen»** и нажмите **«Установить Halowin Bubo (ROCm 10.0 gfx1151)»** (метод `halogen_prepare_windows` / `prepareWindowsBuboRuntime`), либо выполните в PowerShell:
   ```powershell
   # 1. Установка официальных библиотек AMD ROCm 10.0.0 для gfx1151 (1.0 ГБ, без прав администратора и без Python)
   .\bubo.exe prepare runtime --yes

   # 2. Скачивание оригинального набора Qwen3.8-Flash-Next (4 шарда UD-Q4_K_XL + MTP predictor + Vision mmproj + Dense Twin + Q4_K Draft Head)
   .\bubo.exe prepare model --model-set original --output "MODELS\Halogen" --yes
   ```
2. Запустите сервер кнопкой **«Запустить локальный сервер»** в интерфейсе WORK (метод `halogen_start`) или командой:
   ```powershell
   bubo.exe serve llm ^
     --host 127.0.0.1 --port 8731 ^
     --manifest "MODELS\Halogen\models\qwen38-flash-next-base-ud-q4-k-xl-v1\bubo-package.json" ^
     --served-model-name halogen-qwen3.8-flash-next ^
     --profile subagents --context 262144 ^
     --npu-prefill on ^
     --cache-disk "MODELS\Halogen\#cache\disk"
   ```
3. Для запуска мультимодальных сервисов через базовый бинарник `gufo.exe`:
   ```powershell
   gufo.exe serve asr --model "MODELS\Halogen\Qwen3-ASR-NPU\#weights"
   gufo.exe serve tts --model "MODELS\Halogen\Qwen3-TTS-NPU\#weights"
   gufo.exe serve embedding --model "MODELS\Halogen\Qwen3-Embedding-NPU\#weights"
   gufo.exe serve image --model "MODELS\Halogen\Flux2-Klein-NPU\#weights"
   gufo.exe serve decision --model "MODELS\Halogen\Decider-NPU\#weights"
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
  ghcr.io/peonist-ai/halogen-flash-server:0.20.3
```

---

## 7. Проверка и тестирование

```bash
node --test tests/halogen-provider.test.js
```
