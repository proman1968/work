/**
 * form/trainer — мультимодальная витрина локальных моделей Hugging Face Hub (LLM, VLM/OCR, Image, Audio ASR/TTS/Music, Video, RAG),
 * сборщик датасетов WORK и контур дообучения ИИ (LoRA / SFT / GRPO) с адаптацией под реальное железо хоста.
 */

const MODALITY_TABS = [
    { id: 'all', label: 'Все типы', icon: 'icons:apps' },
    { id: 'llm', label: 'Текст и Код', icon: 'icons:description' },
    { id: 'vlm', label: 'Зрение / OCR', icon: 'image:remove-red-eye' },
    { id: 'image', label: 'Картинки', icon: 'image:brush' },
    { id: 'audio', label: 'Звук и Речь', icon: 'av:mic' },
    { id: 'video', label: 'Видео', icon: 'av:videocam' },
    { id: 'embed', label: 'Поиск (RAG)', icon: 'icons:search' },
];

const CAPABILITY_OPTIONS = [
    { id: '', label: 'Все умения' },
    { id: 'chat', label: 'Диалог и консультации' },
    { id: 'tools', label: 'Вызов инструментов WORK' },
    { id: 'thinking', label: 'Глубокие рассуждения (CoT)' },
    { id: 'coding', label: 'Генерация кода и схем' },
    { id: 'vision', label: 'Зрение и чтение документов (OCR)' },
    { id: 'image', label: 'Генерация изображений' },
    { id: 'stt', label: 'Распознавание речи (ASR / STT)' },
    { id: 'tts', label: 'Синтез речи и голоса (TTS)' },
    { id: 'music', label: 'Генерация музыки и звуков' },
    { id: 'video', label: 'Генерация видеороликов' },
    { id: 'embeddings', label: 'Векторные эмбеддинги (RAG)' },
    { id: 'rerank', label: 'Ранжирование поиска (Rerank)' },
    { id: 'lora', label: 'Поддержка дообучения LoRA' },
];

export default {
    imports: 'oda//button, oda//icon',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            overflow: hidden;
            background: var(--content-background, #ffffff);
            color: var(--content-color, #1e293b);
            font-size: 13px;
        }
        /* Верхняя плашка оборудования */
        .hw-banner {
            @apply --horizontal;
            flex-shrink: 0;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 8px 14px;
            background: light-dark(linear-gradient(90deg, #f3f0ff 0%, #f8fafc 100%), linear-gradient(90deg, #271745 0%, #1a1b22 100%));
            border-bottom: 1px solid light-dark(#d8b4fe, #4c1d95);
            flex-wrap: wrap;
        }
        .hw-left {
            @apply --vertical;
            gap: 3px;
            min-width: 0;
        }
        .hw-title {
            font-weight: 700;
            font-size: 14px;
            color: light-dark(#4c1d95, #e9d5ff);
        }
        .hw-specs {
            @apply --horizontal;
            gap: 6px;
            align-items: center;
            flex-wrap: wrap;
            font-size: 12px;
            color: light-dark(#334155, #cbd5e1);
        }
        .hw-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 1px 8px;
            border-radius: 4px;
            background: light-dark(rgba(255,255,255,0.85), rgba(255,255,255,0.07));
            border: 1px solid light-dark(#cbd5e1, #3f3f46);
            white-space: nowrap;
        }
        .hw-badges {
            @apply --horizontal;
            gap: 6px;
            align-items: center;
            flex-wrap: wrap;
        }
        /* Универсальные неразрывные бейджи */
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 999px;
            font-size: 11.5px;
            font-weight: 600;
            line-height: 1.35;
            white-space: nowrap;
            flex-shrink: 0;
            background: light-dark(#f1f5f9, #2d2f39);
            color: light-dark(#334155, #e2e8f0);
            border: 1px solid light-dark(#cbd5e1, #475569);
        }
        .badge.purple {
            background: light-dark(#f3e8ff, #3b0764);
            border-color: light-dark(#c084fc, #7e22ce);
            color: light-dark(#6b21a8, #e9d5ff);
        }
        .badge.optimal {
            background: light-dark(#dcfce7, #14532d);
            border-color: light-dark(#86efac, #16a34a);
            color: light-dark(#166534, #bbf7d0);
        }
        .badge.warn {
            background: light-dark(#fef9c3, #422006);
            border-color: light-dark(#fde047, #ca8a04);
            color: light-dark(#854d0e, #fef08a);
        }
        .badge.heavy {
            background: light-dark(#fee2e2, #450a0a);
            border-color: light-dark(#fca5a5, #dc2626);
            color: light-dark(#991b1b, #fecaca);
        }
        .badge.mod {
            background: light-dark(#e0e7ff, #1e1b4b);
            border-color: light-dark(#a5b4fc, #4338ca);
            color: light-dark(#3730a3, #c7d2fe);
        }
        .cap-pill {
            display: inline-flex;
            align-items: center;
            padding: 1px 7px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            background: light-dark(#f8fafc, #1e293b);
            color: light-dark(#0f172a, #cbd5e1);
            border: 1px solid light-dark(#cbd5e1, #334155);
        }

        /* Главные вкладки экрана */
        .tabs-bar {
            @apply --horizontal;
            flex-shrink: 0;
            gap: 4px;
            padding: 5px 12px 0 12px;
            background: light-dark(#efeee4, #24252b);
            border-bottom: 1px solid light-dark(#b5b4ac, #3e4049);
        }
        .tab-btn {
            padding: 6px 14px;
            font-size: 12.5px;
            font-weight: 600;
            border: 1px solid transparent;
            border-bottom: none;
            border-radius: 5px 5px 0 0;
            background: transparent;
            color: light-dark(#475569, #94a3b8);
            cursor: pointer;
            white-space: nowrap;
        }
        .tab-btn:hover {
            color: light-dark(#1e293b, #f1f5f9);
        }
        .tab-btn.tab-active {
            background: var(--content-background, #ffffff);
            border-color: light-dark(#b5b4ac, #3e4049);
            color: light-dark(#5b21b6, #c4b5fd);
        }

        .error {
            padding: 6px 12px;
            color: var(--error-color, #c53030);
            background: light-dark(#fff5f5, rgba(229, 62, 62, 0.15));
            border-bottom: 1px solid var(--error-color, #feb2b2);
            flex-shrink: 0;
        }

        /* Двухпанельная рабочая область */
        .workspace {
            @apply --horizontal;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }
        .panel-left {
            @apply --vertical;
            flex: 1.38;
            min-width: 0;
            min-height: 0;
            overflow: hidden;
            border-right: 1px solid light-dark(#c8c7be, #3e4049);
        }
        .sticky-header {
            @apply --vertical;
            flex-shrink: 0;
            gap: 8px;
            padding: 10px 12px;
            background: light-dark(#f8f8f4, #202127);
            border-bottom: 1px solid light-dark(#dcdbd2, #343640);
        }
        .cards-scroll {
            @apply --vertical;
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 10px 12px;
            gap: 8px;
        }
        .panel-right {
            @apply --vertical;
            flex: 1;
            min-width: 320px;
            min-height: 0;
            overflow-y: auto;
            padding: 10px 12px;
            gap: 10px;
            background: light-dark(#fafaf7, #1b1c22);
        }

        /* Полоса выбора категории модели (Текст, Зрение, Картинки, Звук, Видео, RAG) */
        .modality-bar {
            @apply --horizontal;
            gap: 5px;
            flex-wrap: wrap;
        }
        .mod-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            font-size: 12px;
            font-weight: 600;
            border: 1px solid light-dark(#cbd5e1, #3f414d);
            border-radius: 6px;
            background: light-dark(#ffffff, #282a33);
            color: light-dark(#334155, #cbd5e1);
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.12s ease;
        }
        .mod-btn:hover {
            border-color: #7c3aed;
        }
        .mod-btn.mod-active {
            background: light-dark(#6d28d9, #7c3aed);
            border-color: light-dark(#5b21b6, #6d28d9);
            color: #ffffff;
        }

        .section-title {
            font-weight: 700;
            font-size: 11.5px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: light-dark(#475569, #94a3b8);
            border-bottom: 1px solid light-dark(#e2e8f0, #334155);
            padding-bottom: 4px;
            flex-shrink: 0;
        }
        .toolbar {
            @apply --horizontal;
            gap: 6px;
            align-items: center;
            flex-wrap: wrap;
        }
        input:not([type="checkbox"]):not([type="radio"]), select, textarea {
            padding: 4px 8px;
            font-size: 12.5px;
            border: 1px solid light-dark(#b8b7ae, #475569);
            border-radius: 4px;
            background: light-dark(#ffffff, #15161a);
            color: inherit;
            box-sizing: border-box;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 5px 12px;
            font-size: 12.5px;
            font-weight: 600;
            border: 1px solid light-dark(#b8b7ae, #4a4c56);
            border-radius: 4px;
            background: light-dark(linear-gradient(180deg, #fafaf8 0%, #e8e7de 100%), linear-gradient(180deg, #32343a 0%, #26282d 100%));
            color: inherit;
            cursor: pointer;
            white-space: nowrap;
        }
        .btn.primary {
            background: linear-gradient(180deg, #6d28d9 0%, #5b21b6 100%);
            border-color: #4c1d95;
            color: #ffffff;
        }
        .btn.danger {
            background: #dc2626;
            border-color: #b91c1c;
            color: #ffffff;
        }

        /* Карточка модели (используем .card-active вместо глобального .selected!) */
        .card {
            @apply --vertical;
            flex-shrink: 0;
            gap: 6px;
            padding: 9px 11px;
            border: 1px solid light-dark(#d6d5cc, #343642);
            border-radius: 6px;
            background: light-dark(#ffffff, #23252f);
            transition: border-color 0.12s ease, background 0.12s ease;
        }
        .card.clickable {
            cursor: pointer;
        }
        .card.clickable:hover {
            border-color: light-dark(#a78bfa, #8b5cf6);
        }
        .card.card-active {
            background: light-dark(#f5f3ff, #2b2342) !important;
            border: 1.5px solid #7c3aed !important;
            box-shadow: 0 2px 8px rgba(109, 40, 217, 0.12);
        }
        .model-top {
            @apply --horizontal;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .model-title-group {
            @apply --horizontal;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            min-width: 0;
        }
        .model-id {
            font-weight: 700;
            font-size: 13.5px;
            color: light-dark(#0f172a, #f8fafc);
        }
        .model-what {
            font-size: 12px;
            line-height: 1.4;
            color: light-dark(#334155, #cbd5e1);
        }
        .caps-row {
            @apply --horizontal;
            align-items: center;
            gap: 5px;
            flex-wrap: wrap;
        }
        .caps-label {
            font-size: 11px;
            font-weight: 700;
            color: light-dark(#64748b, #94a3b8);
            margin-right: 2px;
        }
        .progress-track {
            width: 100%;
            height: 8px;
            background: light-dark(#e2e8f0, #334155);
            border-radius: 4px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #7c3aed, #2563eb);
            transition: width 0.2s ease;
        }
        .form-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(140px, 1fr));
            gap: 8px;
        }
        .field-box {
            @apply --vertical;
            gap: 3px;
        }
        .field-box label {
            font-size: 11.5px;
            font-weight: 600;
            color: light-dark(#475569, #94a3b8);
        }
        .chart-box {
            padding: 8px;
            border: 1px solid light-dark(#cbd5e1, #334155);
            border-radius: 4px;
            background: light-dark(#ffffff, #15161a);
        }
        .file-list {
            max-height: 170px;
            overflow-y: auto;
            margin-top: 4px;
            border-top: 1px solid light-dark(#e2e8f0, #334155);
            padding-top: 4px;
        }
        .file-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            font-size: 11.5px;
            padding: 2px 0;
        }
        .mono {
            font-family: Consolas, monospace;
            font-size: 11.5px;
            white-space: pre-wrap;
            word-break: break-word;
        }
    </style>

    <!-- Верхний баннер реального аппаратного профиля хоста -->
    <div class="hw-banner">
        <div class="hw-left">
            <div class="hw-title">Локальные модели ИИ и дообучение (LoRA / SFT / GRPO)</div>
            <div class="hw-specs">
                <span class="hw-chip">CPU: <strong>{{hardware?.cpuModel || 'Определение…'}}</strong> ({{hardware?.cpuCores || 0}} потоков)</span>
                <span class="hw-chip">ОЗУ: <strong>{{hardware?.totalRamGb || 0}} ГБ</strong> (свободно {{hardware?.freeRamGb || 0}} ГБ)</span>
                <span class="hw-chip">Бюджет под ИИ: <strong>~{{hardware?.usableMemoryGb || 0}} ГБ</strong></span>
            </div>
        </div>
        <div class="hw-badges">
            <span class="badge purple">Локальных моделей: {{localModels.length}}</span>
            <span class="badge purple">LoRA-адаптеров: {{adapters.length}}</span>
            <span class="badge">Датасетов WORK: {{datasets.length}}</span>
        </div>
    </div>

    <div class="tabs-bar">
        <button type="button" class="tab-btn" ~class="{'tab-active': activeTab === 'hf'}" @tap="activeTab = 'hf'">1. Каталог моделей Hugging Face ({{hfModels.length}})</button>
        <button type="button" class="tab-btn" ~class="{'tab-active': activeTab === 'dataset'}" @tap="activeTab = 'dataset'">2. Датасеты WORK ({{datasets.length}})</button>
        <button type="button" class="tab-btn" ~class="{'tab-active': activeTab === 'train'}" @tap="activeTab = 'train'">3. Дообучение (LoRA / SFT / GRPO)</button>
    </div>

    <div class="error" ~if="error">{{error}}</div>

    <!-- ВКЛАДКА 1: КАТАЛОГ МОДЕЛЕЙ HUGGING FACE -->
    <div class="workspace" ~if="activeTab === 'hf'">
        <div class="panel-left">
            <!-- Закреплённая сверху панель выбора типа модели, умений и поиска -->
            <div class="sticky-header">
                <div class="modality-bar">
                    <button type="button" class="mod-btn" ~for="modalityTabs"
                        ~class="{'mod-active': hfModality === $for.item.id}"
                        @tap="setModality($for.item.id)">
                        <oda-icon :icon="$for.item.icon" icon-size="15"></oda-icon>
                        <span>{{$for.item.label}}</span>
                    </button>
                </div>
                <div class="toolbar">
                    <input style="flex:1;min-width:180px;" :value="hfQuery" placeholder="Поиск модели на Hugging Face (например: Qwen3, Whisper, FLUX, Wan2.1, BGE)…" @input="hfQuery = $this.value" @keydown.enter="searchHf()">
                    <select title="Фильтр по умению модели" @change="setCapability($this.value)">
                        <option ~for="capabilityOptions" :value="$for.item.id" :selected="hfCapability === $for.item.id">{{$for.item.label}}</option>
                    </select>
                    <select title="Совместимость и формат" @change="setHfFilter($this.value)">
                        <option value="all" :selected="hfFilter === 'all'">Все по памяти</option>
                        <option value="fit" :selected="hfFilter === 'fit'">Подходящие моей системе</option>
                        <option value="gguf" :selected="hfFilter === 'gguf'">Формат GGUF</option>
                    </select>
                    <button type="button" class="btn primary" @tap="searchHf()">Найти</button>
                </div>
            </div>

            <!-- Прокручиваемый список карточек моделей -->
            <div class="cards-scroll">
                <div class="card clickable" ~for="hfModels"
                    ~class="{'card-active': selectedRepo?.id === $for.item.id}"
                    @tap="inspectRepo($for.item.id)">
                    <div class="model-top">
                        <div class="model-title-group">
                            <oda-icon :icon="$for.item.icon || 'ai:ollama'" icon-size="20" style="flex-shrink:0;"></oda-icon>
                            <span class="model-id">{{$for.item.id}}</span>
                            <span class="badge mod">{{$for.item.modalityLabel || $for.item.modality}}</span>
                            <span class="badge optimal" ~if="$for.item.fit === 'optimal'">Подходит (обучение + запуск)</span>
                            <span class="badge warn" ~if="$for.item.fit === 'inference_only'">Доступен запуск</span>
                            <span class="badge heavy" ~if="$for.item.fit === 'too_large'">Мало памяти</span>
                        </div>
                        <div class="hw-badges">
                            <span class="badge" ~if="$for.item.ramRequiredGb">Запуск: ~{{$for.item.ramRequiredGb}} ГБ</span>
                            <span class="badge" ~if="$for.item.trainRamGb && $for.item.capabilities?.includes('lora')">LoRA: ~{{$for.item.trainRamGb}} ГБ</span>
                            <span class="badge">{{$for.item.format}}</span>
                        </div>
                    </div>
                    <div class="model-what">{{$for.item.whatItDoes || $for.item.recommendedFor}}</div>
                    <div class="caps-row" ~if="$for.item.capabilityBadges?.length">
                        <span class="caps-label">Умеет:</span>
                        <span class="cap-pill" ~for="$for.item.capabilityBadges" :title="$for.$for.item.desc">{{$for.$for.item.label}}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="panel-right">
            <div class="section-title">Паспорт репозитория и загрузка</div>
            <div class="card" ~if="selectedRepo">
                <div class="model-top">
                    <div class="model-title-group">
                        <oda-icon :icon="selectedRepo.icon || 'ai:ollama'" icon-size="22" style="flex-shrink:0;"></oda-icon>
                        <span class="model-id">{{selectedRepo.id}}</span>
                    </div>
                    <span class="badge mod">{{selectedRepo.modality || 'llm'}}</span>
                </div>
                <div class="model-what" ~if="selectedRepo.whatItDoes">{{selectedRepo.whatItDoes}}</div>
                <div class="caps-row" ~if="selectedRepo.capabilityBadges?.length">
                    <span class="caps-label">Возможности:</span>
                    <span class="cap-pill" ~for="selectedRepo.capabilityBadges" :title="$for.item.desc">{{$for.item.label}}</span>
                </div>
                <div style="font-size:12px;margin-top:2px;">
                    Вес файлов: <strong>~{{selectedRepo.totalWeightGb}} ГБ</strong> · Файлов: <strong>{{selectedRepo.files?.length || 0}}</strong>
                </div>
                <div style="font-size:11.5px;opacity:0.9;" ~if="selectedRepo.fitLabel">{{selectedRepo.fitLabel}}</div>
                <div class="field-box" ~if="selectedRepo.quants?.length">
                    <label>Квантизация / Формат весов:</label>
                    <select @change="selectedQuant = $this.value">
                        <option ~for="selectedRepo.quants" :value="$for.item" :selected="$for.item === selectedQuant">{{$for.item}}</option>
                    </select>
                </div>
                <div class="toolbar" style="margin-top:4px;">
                    <button type="button" class="btn primary" @tap="downloadRepo(selectedRepo.id)">Скачать с Hugging Face в /MODELS/Local</button>
                    <input style="width:140px;" type="password" :value="hfToken" placeholder="HF Token (опц.)" @change="hfToken = $this.value">
                </div>
                <div class="file-list" ~if="selectedRepo.files?.length">
                    <div class="file-row" ~for="selectedRepo.files">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{$for.item.name}}</span>
                        <span style="flex-shrink:0;font-weight:600;">{{$for.item.sizeFormatted || ($for.item.sizeGb + ' ГБ')}}</span>
                    </div>
                </div>
            </div>

            <div class="section-title">Загрузки ({{downloads.length}})</div>
            <div class="card" ~for="downloads">
                <div class="model-top">
                    <strong>{{$for.item.repoId}}</strong>
                    <span class="badge purple">{{$for.item.status}} · {{$for.item.progress}}%</span>
                </div>
                <div style="font-size:11.5px;">Файл: {{$for.item.currentFile}} · Скорость: {{$for.item.speedMBs}} МБ/с</div>
                <div class="progress-track">
                    <div class="progress-fill" ~style="{width: ($for.item.progress || 0) + '%'}"></div>
                </div>
                <div style="font-size:11.5px;" ~if="$for.item.modelPath">Узел в дереве: <strong>{{$for.item.modelPath}}</strong></div>
                <div class="error" ~if="$for.item.error">{{$for.item.error}}</div>
                <div class="toolbar" ~if="$for.item.status === 'downloading'">
                    <button type="button" class="btn danger" @tap="cancelDownload($for.item.id)">Отменить</button>
                </div>
            </div>

            <div class="section-title">Установленные модели в /MODELS/Local ({{localModels.length}})</div>
            <div class="card" ~for="localModels">
                <div class="model-top">
                    <strong>{{$for.item.id}}</strong>
                    <span class="badge">{{$for.item.path}}</span>
                </div>
                <div style="font-size:11.5px;">Файлы: {{$for.item.weightFiles?.join(', ') || 'метаданные $ai'}}</div>
            </div>
        </div>
    </div>

    <!-- ВКЛАДКА 2: ДАТАСЕТЫ WORK -->
    <div class="workspace" ~if="activeTab === 'dataset'">
        <div class="panel-left">
            <div class="sticky-header">
                <div class="section-title">Сборка обучающего датасета из живых данных WORK (ChatML JSONL)</div>
                <div class="form-grid">
                    <div class="field-box">
                        <label>Имя датасета (.jsonl)</label>
                        <input :value="datasetName" @input="datasetName = $this.value">
                    </div>
                    <div class="field-box">
                        <label>Организация ($base)</label>
                        <input :value="datasetBasePath" @input="datasetBasePath = $this.value">
                    </div>
                </div>
                <div class="toolbar" style="gap:14px;">
                    <label><input type="checkbox" :checked="srcTasks" @change="srcTasks = $this.checked"> Задачи ИИ и Консультанта (*.task)</label>
                    <label><input type="checkbox" :checked="srcAccounting" @change="srcAccounting = $this.checked"> Операции, проводки и ОСВ (work.db)</label>
                    <label><input type="checkbox" :checked="srcClasses" @change="srcClasses = $this.checked"> Классы, контракты и навыки (/MODULES)</label>
                </div>
                <div class="toolbar">
                    <button type="button" class="btn primary" @tap="buildDataset()">Собрать датасет WORK</button>
                </div>
            </div>

            <div class="cards-scroll">
                <div class="section-title">Собранные датасеты ({{datasets.length}})</div>
                <div class="card clickable" ~for="datasets" ~class="{'card-active': selectedDataset?.name === $for.item.name}" @tap="selectedDataset = $for.item">
                    <div class="model-top">
                        <strong>{{$for.item.name}}</strong>
                        <span class="badge purple">Примеров: {{$for.item.totalExamples}} · ~{{$for.item.estimatedTokens}} токенов</span>
                    </div>
                    <div style="font-size:11.5px;">
                        Файл: <code>{{$for.item.filePath}}</code> · Источники: задачи ({{$for.item.bySource?.tasks || 0}}), учёт ({{$for.item.bySource?.accounting || 0}}), классы ({{$for.item.bySource?.classes || 0}})
                    </div>
                </div>
            </div>
        </div>

        <div class="panel-right">
            <div class="section-title">Предпросмотр обучающих примеров (ShareGPT / ChatML)</div>
            <div class="card" ~for="selectedDataset?.preview">
                <div class="model-top">
                    <strong>{{$for.item.id}}</strong>
                    <span class="badge">{{$for.item.category}} · {{$for.item.tokens}} tok</span>
                </div>
                <div style="font-size:12px;"><strong>User:</strong> {{$for.item.userPrompt}}</div>
                <div class="mono" style="background:rgba(128,128,128,0.08);padding:6px;border-radius:4px;">{{$for.item.assistantReply}}</div>
            </div>
        </div>
    </div>

    <!-- ВКЛАДКА 3: ДООБУЧЕНИЕ (LoRA / SFT / GRPO) -->
    <div class="workspace" ~if="activeTab === 'train'">
        <div class="panel-left">
            <div class="sticky-header">
                <div class="section-title">Параметры дообучения (адаптированы под доступные ~{{hardware?.usableMemoryGb || 0}} ГБ памяти)</div>
                <div class="form-grid">
                    <div class="field-box">
                        <label>Имя обучаемой модели / LoRA-адаптера</label>
                        <input :value="trainAdapterName" @input="trainAdapterName = $this.value">
                    </div>
                    <div class="field-box">
                        <label>Базовая модель (рекомендована: {{hardware?.recommendedBaseModel || 'Qwen/Qwen3-14B'}})</label>
                        <input :value="trainBaseModel" @input="trainBaseModel = $this.value">
                    </div>
                    <div class="field-box">
                        <label>Датасет (.jsonl)</label>
                        <input :value="trainDatasetName" @input="trainDatasetName = $this.value">
                    </div>
                    <div class="field-box">
                        <label>Метод обучения</label>
                        <select @change="trainMode = $this.value">
                            <option value="sft" :selected="trainMode === 'sft'">SFT (Supervised Fine-Tuning на примерах)</option>
                            <option value="grpo" :selected="trainMode === 'grpo'">GRPO (RL с верификатором учётного ядра WORK)</option>
                        </select>
                    </div>
                    <div class="field-box">
                        <label>Ранг LoRA (r)</label>
                        <select @change="trainLoraR = Number($this.value)">
                            <option value="8" :selected="trainLoraR === 8">r = 8 (компактный)</option>
                            <option value="16" :selected="trainLoraR === 16">r = 16 (стандарт)</option>
                            <option value="32" :selected="trainLoraR === 32">r = 32 (глубокая адаптация)</option>
                            <option value="64" :selected="trainLoraR === 64">r = 64 (максимальный)</option>
                        </select>
                    </div>
                    <div class="field-box">
                        <label>Длина контекста (max_seq_length)</label>
                        <select @change="trainMaxSeq = Number($this.value)">
                            <option value="4096" :selected="trainMaxSeq === 4096">4 096 токенов</option>
                            <option value="8192" :selected="trainMaxSeq === 8192">8 192 токена</option>
                            <option value="16384" :selected="trainMaxSeq === 16384">16 384 токена</option>
                            <option value="32768" :selected="trainMaxSeq === 32768">32 768 токенов</option>
                        </select>
                    </div>
                </div>
                <div class="toolbar">
                    <button type="button" class="btn primary" @tap="startTraining()">Запустить дообучение</button>
                </div>
            </div>

            <div class="cards-scroll">
                <div class="section-title">Монитор задач обучения ({{jobs.length}})</div>
                <div class="card" ~for="jobs">
                    <div class="model-top">
                        <strong>{{$for.item.adapterName}} ({{$for.item.mode.toUpperCase()}})</strong>
                        <span class="badge purple">{{$for.item.status}} · шаг {{$for.item.step}} / {{$for.item.totalSteps}}</span>
                    </div>
                    <div style="font-size:12px;">
                        База: <code>{{$for.item.baseModel}}</code> · Loss: <strong>{{$for.item.loss}}</strong>
                        <span ~if="$for.item.reward !== null"> · GRPO Reward: <strong>{{$for.item.reward}}</strong></span>
                        · Память: <strong>{{$for.item.ramUsedGb}} / {{$for.item.usableMemoryGb || hardware?.usableMemoryGb || 0}} ГБ</strong> · Скорость: {{$for.item.tokensPerSec}} tok/s
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" ~style="{width: Math.round(($for.item.step / ($for.item.totalSteps || 1)) * 100) + '%'}"></div>
                    </div>
                    <div style="font-size:12px;" ~if="$for.item.publishedPath">
                        Опубликована в дереве: <strong>{{$for.item.publishedPath}}</strong>
                    </div>
                    <div class="toolbar" ~if="$for.item.status === 'running'">
                        <button type="button" class="btn danger" @tap="stopTraining($for.item.id)">Остановить</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="panel-right">
            <div class="section-title">Кривая обучения (Loss) и Верификатор GRPO</div>
            <div class="chart-box" ~if="activeJob?.history?.length">
                <div style="font-size:12px;font-weight:600;margin-bottom:4px;">
                    График падения Loss ({{activeJob.adapterName}}): {{activeJob.history[0]?.loss}} → {{activeJob.loss}}
                </div>
                <svg viewBox="0 0 320 110" style="width:100%;height:110px;display:block;">
                    <polyline fill="none" stroke="#7c3aed" stroke-width="2.5" :points="lossPolyline"></polyline>
                </svg>
            </div>

            <div class="section-title">Песочница Верификатора GRPO (Reward Function учётного ядра)</div>
            <div class="card">
                <div style="font-size:11.5px;opacity:0.85;">
                    Проверяет ответ модели через <code>checkSchema</code> и <code>previewEntries</code> в БД организации и начисляет награду <code>reward (0..1)</code>.
                </div>
                <textarea rows="5" class="mono" :value="verifySample" @input="verifySample = $this.value"></textarea>
                <div class="toolbar">
                    <button type="button" class="btn" @tap="runVerify()">Проверить ответ (GRPO Reward)</button>
                    <span class="badge purple" ~if="verifyResult">Reward: {{verifyResult.reward}} ({{verifyResult.valid ? 'валидно' : 'ошибка'}})</span>
                </div>
                <div ~if="verifyResult?.reasons?.length" style="font-size:11.5px;">
                    <div ~for="verifyResult.reasons">• {{$for.item}}</div>
                </div>
            </div>
        </div>
    </div>
    `,
    activeTab: 'hf',
    modalityTabs: MODALITY_TABS,
    capabilityOptions: CAPABILITY_OPTIONS,
    hardware: null,
    localModels: [],
    adapters: [],
    datasets: [],
    downloads: [],
    jobs: [],
    hfQuery: '',
    hfModality: 'all',
    hfCapability: '',
    hfFilter: 'all',
    hfToken: '',
    hfModels: [],
    selectedRepo: null,
    selectedQuant: 'Q8_0',
    datasetName: 'work-sft-dataset',
    datasetBasePath: '/ORGANIZATIONS/Маслоторг',
    srcTasks: true,
    srcAccounting: true,
    srcClasses: true,
    selectedDataset: null,
    trainAdapterName: 'Маслоторг-Ассистент-LoRA',
    trainBaseModel: '',
    trainDatasetName: 'work-sft-dataset',
    trainMode: 'grpo',
    trainLoraR: 16,
    trainMaxSeq: 8192,
    _defaultsApplied: false,
    verifySample: JSON.stringify({
        cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступления на расчётный счёт/От покупателя',
        body: { sum: 50000, purpose: 'Оплата по договору поставки' },
    }, null, 2),
    verifyResult: null,
    error: '',
    _pollTimer: null,
    get activeJob() {
        return (this.jobs || [])[0] || null;
    },
    get lossPolyline() {
        const hist = this.activeJob?.history || [];
        if (!hist.length)
            return '';
        const maxLoss = Math.max(...hist.map(h => Number(h.loss) || 0), 2.2);
        const minLoss = Math.min(...hist.map(h => Number(h.loss) || 0), 0.2);
        const span = Math.max(0.1, maxLoss - minLoss);
        return hist.map((h, idx) => {
            const x = Math.round((idx / Math.max(1, hist.length - 1)) * 304) + 8;
            const y = Math.round(98 - ((Number(h.loss) - minLoss) / span) * 84);
            return `${x},${y}`;
        }).join(' ');
    },
    async attached() {
        await this.reloadStatus();
        await this.searchHf();
    },
    detached() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },
    _ensurePolling() {
        const hasActive = (this.downloads || []).some(d => d.status === 'downloading')
            || (this.jobs || []).some(j => j.status === 'running');
        if (hasActive && !this._pollTimer) {
            this._pollTimer = setInterval(() => this.reloadStatus(), 500);
        }
        else if (!hasActive && this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },
    async reloadStatus() {
        if (!this.$item)
            return;
        try {
            const st = await this.$item.fetch('trainer_status');
            this.hardware = st?.hardware || null;
            if (this.hardware && !this._defaultsApplied) {
                this._defaultsApplied = true;
                this.trainBaseModel = this.hardware.recommendedBaseModel || 'Qwen/Qwen3-14B';
                this.trainLoraR = this.hardware.recommendedLoraR || 16;
                this.trainMaxSeq = this.hardware.recommendedMaxSeq || 8192;
            }
            const prevCount = this.localModels?.length || 0;
            this.localModels = Array.isArray(st?.models) ? st.models : [];
            if (this.localModels.length !== prevCount)
                this._invalidateClientModelsTree();
            this.adapters = Array.isArray(st?.adapters) ? st.adapters : [];
            this.datasets = Array.isArray(st?.datasets) ? st.datasets : [];
            this.downloads = Array.isArray(st?.downloads) ? st.downloads : [];
            this.jobs = Array.isArray(st?.jobs) ? st.jobs : [];
            if (!this.selectedDataset && this.datasets.length)
                this.selectedDataset = this.datasets[0];
            this._ensurePolling();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    _invalidateClientModelsTree() {
        for (const w of [window, window.parent, window.top]) {
            try {
                const wk = w?.WORK;
                if (!wk?.items)
                    continue;
                for (const p of ['/MODELS', '/MODELS/Local']) {
                    const node = wk.items[p];
                    if (node?.[w.R]?.cache)
                        delete node[w.R].cache.items;
                    node?.reset?.();
                }
            }
            catch { /* ignore cross-frame */ }
        }
    },
    async setModality(mod) {
        this.hfModality = String(mod || 'all');
        await this.searchHf();
    },
    async setCapability(cap) {
        this.hfCapability = String(cap || '');
        await this.searchHf();
    },
    async setHfFilter(val) {
        this.hfFilter = String(val || 'all');
        await this.searchHf();
    },
    async searchHf() {
        this.error = '';
        if (!this.$item)
            return;
        try {
            const res = await this.$item.fetch('trainer_hf_search', {
                query: this.hfQuery,
                modality: this.hfModality,
                capability: this.hfCapability,
                filter: this.hfFilter,
                token: this.hfToken,
            });
            this.hfModels = Array.isArray(res?.items) ? res.items : [];
            if (this.hfModels.length && (!this.selectedRepo || !this.hfModels.some(m => m.id === this.selectedRepo.id)))
                await this.inspectRepo(this.hfModels[0].id);
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async inspectRepo(repoId) {
        this.error = '';
        if (!this.$item || !repoId)
            return;
        try {
            this.selectedRepo = await this.$item.fetch('trainer_hf_inspect', {
                repoId,
                token: this.hfToken,
            });
            if (this.selectedRepo?.quants?.length)
                this.selectedQuant = this.selectedRepo.quants[0];
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async downloadRepo(repoId) {
        this.error = '';
        if (!this.$item || !repoId)
            return;
        try {
            await this.$item.fetch('trainer_hf_download', {
                repoId,
                quant: this.selectedQuant || 'Q8_0',
                token: this.hfToken,
            });
            await this.reloadStatus();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async cancelDownload(jobId) {
        if (!this.$item || !jobId)
            return;
        await this.$item.fetch('trainer_hf_cancel', { jobId });
        await this.reloadStatus();
    },
    async buildDataset() {
        this.error = '';
        if (!this.$item)
            return;
        const sources = [];
        if (this.srcTasks)
            sources.push('tasks');
        if (this.srcAccounting)
            sources.push('accounting');
        if (this.srcClasses)
            sources.push('classes');
        try {
            const meta = await this.$item.fetch('trainer_dataset_build', {
                name: this.datasetName,
                basePath: this.datasetBasePath,
                sources: sources.join(','),
            });
            this.selectedDataset = meta;
            this.trainDatasetName = meta?.name || this.datasetName;
            await this.reloadStatus();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async startTraining() {
        this.error = '';
        if (!this.$item)
            return;
        try {
            await this.$item.fetch('trainer_start', {
                adapterName: this.trainAdapterName,
                baseModel: this.trainBaseModel,
                datasetName: this.trainDatasetName,
                basePath: this.datasetBasePath,
                mode: this.trainMode,
                loraR: this.trainLoraR,
                maxSeqLength: this.trainMaxSeq,
            });
            await this.reloadStatus();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async stopTraining(jobId) {
        if (!this.$item || !jobId)
            return;
        await this.$item.fetch('trainer_stop', { jobId });
        await this.reloadStatus();
    },
    async runVerify() {
        this.error = '';
        if (!this.$item)
            return;
        try {
            this.verifyResult = await this.$item.fetch('trainer_verify', {
                basePath: this.datasetBasePath,
                taskType: 'operation',
                completion: this.verifySample,
            });
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
};
