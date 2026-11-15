/**
 * form/trainer («Модели ИИ» на /MODELS/Local) — чистый интерфейс управления локальными моделями ИИ:
 *  - встроенный в WORK сервер локального ИИ (автозапуск по запросу, постоянный режим на Halo ≥ 128 ГБ, выгрузка при простое на обычных ПК);
 *  - вкладка «Модели»: установленные модели (Вкл/Выкл, Удалить с диска) + установка моделей в 1 клик (включая комплект Halo);
 *  - вкладка «Дообучение»: двухшаговый мастер (1. Собрать данные организации → 2. Дообучить модель LoRA).
 */
export default {
    imports: 'oda//button, oda//icon',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            overflow-y: auto;
            background: var(--content-background, #ffffff);
            color: var(--content-color, #1e293b);
            font-size: 13px;
            padding: 16px 20px;
            gap: 14px;
            box-sizing: border-box;
        }
        .header-card {
            @apply --horizontal;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--subtle-background, #f8fafc);
            flex-wrap: wrap;
        }
        .header-left {
            @apply --horizontal;
            align-items: center;
            gap: 12px;
            min-width: 0;
        }
        .title {
            font-size: 16px;
            font-weight: 700;
        }
        .hw-line {
            font-size: 12px;
            opacity: 0.8;
            margin-top: 2px;
        }
        .toolbar {
            @apply --horizontal;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 3px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
        }
        .badge.active {
            background: light-dark(#dcfce7, #14532d);
            color: light-dark(#166534, #bbf7d0);
            border: 1px solid light-dark(#86efac, #16a34a);
        }
        .badge.neutral {
            background: light-dark(#f1f5f9, #27272a);
            color: light-dark(#475569, #a1a1aa);
            border: 1px solid light-dark(#cbd5e1, #3f3f46);
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
            flex-shrink: 0;
        }
        .dot.on { background: #22c55e; }
        .dot.warn { background: #f59e0b; }
        .dot.off { background: #94a3b8; }

        /* Спокойные вкладки */
        .tabs-bar {
            @apply --horizontal;
            gap: 4px;
            border-bottom: 1px solid var(--border-color, #cbd5e1);
        }
        .tab-btn {
            appearance: none;
            border: none;
            border-bottom: 2px solid transparent;
            background: transparent;
            color: inherit;
            opacity: 0.7;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
        }
        .tab-btn:hover {
            opacity: 1;
        }
        .tab-btn.tab-active {
            opacity: 1;
            color: var(--accent-color, #2563eb);
            border-bottom-color: var(--accent-color, #2563eb);
        }

        .card {
            @apply --vertical;
            gap: 10px;
            padding: 14px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--content-background, #ffffff);
        }
        .section-title {
            font-weight: 700;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            opacity: 0.75;
            border-bottom: 1px solid var(--border-color, #e2e8f0);
            padding-bottom: 6px;
        }

        /* Фильтры каталога */
        .filter-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 11px;
            border-radius: 6px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--subtle-background, #f8fafc);
            color: inherit;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
        }
        .filter-pill.active {
            background: var(--accent-color, #2563eb);
            border-color: var(--accent-color, #2563eb);
            color: #ffffff;
        }

        /* Строка модели (установленной или в каталоге) */
        .model-row {
            @apply --vertical;
            gap: 6px;
            padding: 10px 12px;
            border-radius: 6px;
            border: 1px solid var(--border-color, #e2e8f0);
            background: var(--subtle-background, #f8fafc);
        }
        .model-row.off {
            opacity: 0.55;
        }
        .model-main {
            @apply --horizontal;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
        }
        .model-left {
            @apply --horizontal;
            align-items: center;
            gap: 10px;
            min-width: 0;
            flex: 1;
        }
        .model-name {
            font-weight: 700;
            font-size: 13.5px;
        }
        .model-desc {
            font-size: 12px;
            opacity: 0.8;
            margin-top: 2px;
        }
        .mem-tag {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 12px;
            color: inherit;
            opacity: 0.85;
            white-space: nowrap;
        }

        .progress-track {
            width: 100%;
            height: 6px;
            background: var(--border-color, #e2e8f0);
            border-radius: 3px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: var(--accent-color, #2563eb);
            transition: width 0.2s ease;
        }
        .progress-fill.paused {
            background: #f59e0b;
        }
        .status-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
        }
        .status-chip.ok {
            background: light-dark(#dcfce7, #14532d);
            color: light-dark(#166534, #bbf7d0);
        }
        .status-chip.busy {
            background: var(--accent-soft, rgba(37, 99, 235, 0.12));
            color: var(--accent-color, #2563eb);
        }
        .status-chip.warn {
            background: light-dark(#fef3c7, #451a03);
            color: light-dark(#92400e, #fde68a);
        }
        .status-chip.err {
            background: light-dark(#fee2e2, #450a0a);
            color: light-dark(#991b1b, #fecaca);
        }
        .inline-err {
            font-size: 12px;
            color: light-dark(#b91c1c, #fca5a5);
            margin-top: 2px;
        }
        .inline-warn {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            flex-wrap: wrap;
            padding: 6px 10px;
            border-radius: 6px;
            font-size: 12px;
            background: light-dark(#fef3c7, #451a03);
            color: light-dark(#92400e, #fde68a);
        }

        .bios-box {
            padding: 10px 14px;
            border-radius: 6px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--subtle-background, #f8fafc);
            font-size: 12.5px;
            line-height: 1.5;
        }

        .grid-2 {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 14px;
        }
        .field {
            @apply --vertical;
            gap: 4px;
        }
        .field label {
            font-size: 12px;
            font-weight: 600;
        }
        input:not([type="checkbox"]), select {
            padding: 6px 10px;
            font-size: 13px;
            border: 1px solid var(--border-color, #cbd5e1);
            border-radius: 6px;
            background: var(--content-background, #ffffff);
            color: inherit;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 13px;
            font-size: 12.5px;
            font-weight: 600;
            border-radius: 6px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--content-background, #ffffff);
            color: inherit;
            cursor: pointer;
            white-space: nowrap;
        }
        .btn.primary {
            background: var(--accent-color, #2563eb);
            border-color: var(--accent-color, #2563eb);
            color: #ffffff;
        }
        .btn.danger {
            color: light-dark(#b91c1c, #fca5a5);
            border-color: light-dark(#fecaca, #7f1d1d);
        }
        .msg {
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12.5px;
        }
        .msg.ok {
            background: light-dark(#dcfce7, #14532d);
            color: light-dark(#166534, #bbf7d0);
        }
        .msg.err {
            background: light-dark(#fee2e2, #450a0a);
            color: light-dark(#991b1b, #fecaca);
        }
    </style>

    <!-- Компактная шапка состояния локального ИИ и памяти -->
    <div class="header-card">
        <div class="header-left">
            <oda-icon icon="carbon:chip" icon-size="30"></oda-icon>
            <div>
                <div class="title">Локальный ИИ</div>
                <div class="hw-line">
                    {{hardware?.cpuModel || 'Процессор'}} · ОЗУ {{hardware?.totalRamGb || 0}} ГБ (доступно под ИИ ~{{hardware?.usableMemoryGb || 0}} ГБ)
                </div>
            </div>
        </div>
        <div class="toolbar">
            <span class="badge" ~class="runtime?.running ? 'active' : 'neutral'">
                <span class="dot" ~class="runtime?.running ? 'on' : 'off'"></span>
                <span>{{runtime?.modeLabel || 'Автозапуск по запросу'}}</span>
            </span>
            <button type="button" class="btn" ~if="runtime?.running" @tap="releaseMemory()">Освободить память</button>
        </div>
    </div>

    <div class="msg ok" ~if="notice">{{notice}}</div>
    <div class="msg err" ~if="error">{{error}}</div>

    <!-- Две чистые вкладки -->
    <div class="tabs-bar">
        <button type="button" class="tab-btn" ~class="{'tab-active': activeTab === 'models'}" @tap="activeTab = 'models'">
            Модели ({{localModels.length}})
        </button>
        <button type="button" class="tab-btn" ~class="{'tab-active': activeTab === 'train'}" @tap="activeTab = 'train'">
            Дообучение ({{adapters.length}})
        </button>
    </div>

    <!-- ВКЛАДКА 1: ЕДИНЫЙ СПИСОК МОДЕЛЕЙ (УСТАНОВЛЕННЫЕ, ЗАГРУЖАЕМЫЕ, НЕДОКАЧАННЫЕ И КАТАЛОГ) -->
    <div ~if="activeTab === 'models'" class="vertical" style="gap:14px;">

        <!-- Активный перенос на диск / с диска (если запущен в фоне) -->
        <div class="card" ~if="activeTransfers.length">
            <div class="section-title">Перенос моделей на диск / флешку ({{activeTransfers.length}})</div>
            <div class="model-row" ~for="activeTransfers">
                <div class="model-main">
                    <div>
                        <div class="model-name">{{$for.item.label}}</div>
                        <div class="model-desc">
                            <span ~if="$for.item.currentItem">{{$for.item.currentItem}}</span>
                            <span ~if="$for.item.currentFile"> · {{$for.item.currentFile}}</span>
                        </div>
                    </div>
                    <div class="toolbar">
                        <span style="font-size:12px;font-weight:600;">{{$for.item.progress || 0}}% · {{$for.item.speedMBs || 0}} МБ/с</span>
                        <button type="button" class="btn danger" @tap="cancelTransfer($for.item.id)">Отменить</button>
                    </div>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" ~style="{width: ($for.item.progress || 0) + '%'}"></div>
                </div>
            </div>
        </div>

        <!-- Единая панель моделей -->
        <div class="card">
            <div class="model-main" style="border-bottom:1px solid var(--border-color, #e2e8f0);padding-bottom:8px;">
                <div class="section-title" style="border-bottom:none;padding-bottom:0;">
                    Локальные модели (/MODELS/Local) · установлено: {{localModels.length}}
                </div>
                <div class="toolbar">
                    <button type="button" class="btn" @tap="toggleNetworkPanel()">
                        <oda-icon icon="carbon:network-4" icon-size="15"></oda-icon>
                        <span>Сеть: {{networkSummary}}</span>
                    </button>
                    <button type="button" class="btn" @tap="openTransferDialog('export')" :disabled="!localModels.length && !adapters.length && !datasets.length">
                        <oda-icon icon="carbon:usb" icon-size="15"></oda-icon>
                        <span>Выгрузить на диск / флешку</span>
                    </button>
                    <button type="button" class="btn" @tap="openTransferDialog('import')">
                        <oda-icon icon="carbon:download" icon-size="15"></oda-icon>
                        <span>Загрузить с диска / флешки</span>
                    </button>
                </div>
            </div>

            <!-- Панель настроек источника (зеркало), потоков и точечного прокси (только для загрузок моделей) -->
            <div class="bios-box" ~if="networkOpen">
                <div class="model-main" style="margin-bottom:8px;">
                    <strong>Сеть и ускорение скачивания моделей (только для загрузок ИИ)</strong>
                    <span style="font-size:12px;opacity:0.75;">Многопоточная Range-докачка и точечный прокси не затрагивают остальной WORK</span>
                </div>
                <div class="grid-2" style="gap:10px;">
                    <div class="field">
                        <label>Источник моделей</label>
                        <select @change="onNetworkPresetChange($this.value)">
                            <option value="official" :selected="netPreset === 'official'">Официальный Hugging Face (huggingface.co)</option>
                            <option value="hf-mirror" :selected="netPreset === 'hf-mirror'">HF-Mirror (ускоренное зеркало)</option>
                            <option value="custom" :selected="netPreset === 'custom'">Свой URL / зеркало</option>
                        </select>
                    </div>
                    <div class="field">
                        <label>Параллельных потоков на файл</label>
                        <select @change="setNetworkField('netThreads', Number($this.value))">
                            <option value="1" :selected="netThreads === 1">1 поток (обычный)</option>
                            <option value="4" :selected="netThreads === 4">4 потока</option>
                            <option value="8" :selected="netThreads === 8">8 потоков (рекомендуется)</option>
                            <option value="12" :selected="netThreads === 12">12 потоков</option>
                        </select>
                    </div>
                    <div class="field" ~if="netPreset === 'custom'">
                        <label>URL источника (формат http(s)://...)</label>
                        <input :value="netEndpoint" placeholder="https://hf-mirror.com" @input="setNetworkField('netEndpoint', $this.value)">
                    </div>
                    <div class="field">
                        <label>Прокси (HTTP/HTTPS или SOCKS5/SOCKS5h — опционально)</label>
                        <div class="toolbar">
                            <input style="flex:1;min-width:220px;" :value="netProxy" placeholder="socks5://127.0.0.1:1080 или http://user:pass@host:3128" @input="setNetworkField('netProxy', $this.value)">
                            <button type="button" class="btn" ~if="netProxy || netHasProxy" @tap="clearNetworkProxy()">Сбросить</button>
                        </div>
                    </div>
                    <div class="field">
                        <label>HF Token (опционально, только для huggingface.co)</label>
                        <div class="toolbar">
                            <input type="password" style="flex:1;min-width:180px;" :value="netToken" :placeholder="netHasToken ? ('Установлен (' + netTokenMask + ')') : 'hf_... (для закрытых моделей)'" @input="setNetworkField('netToken', $this.value)">
                            <button type="button" class="btn" ~if="netHasToken || netToken" @tap="clearNetworkToken()">Удалить</button>
                        </div>
                    </div>
                </div>
                <div class="toolbar" style="margin-top:10px;">
                    <button type="button" class="btn primary" @tap="saveNetworkSettings()" :disabled="netBusy">Сохранить настройки</button>
                    <button type="button" class="btn" @tap="probeNetwork()" :disabled="netBusy">
                        {{netBusy ? 'Проверка…' : 'Проверить скорость'}}
                    </button>
                    <button type="button" class="btn" @tap="networkOpen = false">Скрыть</button>
                </div>
                <div class="msg ok" style="margin-top:8px;" ~if="netProbe && netProbe.ok">
                    {{netProbe.sourceLabel}}<span ~if="netProbe.usingProxy"> (через прокси {{netProbe.proxyUrl}})</span>: {{netProbe.message}} · отклик {{netProbe.latencyMs}} мс
                </div>
                <div class="msg err" style="margin-top:8px;" ~if="netProbe && !netProbe.ok">
                    Ошибка проверки ({{netProbe.sourceLabel}}): {{netProbe.error}}
                </div>
            </div>

            <!-- Панель категорий и поиска -->
            <div class="toolbar" style="justify-content:space-between;">
                <div class="toolbar">
                    <button type="button" class="filter-pill" ~for="categoryTabs"
                        ~class="{'active': hfModality === $for.item.id}"
                        @tap="setModality($for.item.id)">
                        <oda-icon :icon="$for.item.icon" icon-size="14"></oda-icon>
                        <span>{{$for.item.label}}</span>
                    </button>
                </div>
                <div class="toolbar" ~if="hfModality !== 'halo' && hfModality !== 'installed'">
                    <input style="width:220px;" :value="hfQuery" placeholder="Поиск на Hugging Face (Qwen3, Whisper, FLUX)…" @input="hfQuery = $this.value" @keydown.enter="searchHf()">
                    <button type="button" class="btn" @tap="searchHf()">Найти</button>
                    <label class="toolbar" style="cursor:pointer;font-size:12px;">
                        <input type="checkbox" :checked="hfFilter === 'fit'" @change="setHfFilter($event.target.checked ? 'fit' : 'all')">
                        <span>Только подходящие по памяти</span>
                    </label>
                </div>
            </div>

            <!-- Памятка BIOS и кнопка комплекта Halo при выбранном фильтре Halo -->
            <div class="bios-box" ~if="hfModality === 'halo'">
                <div class="model-main">
                    <div>
                        <strong>Настройка BIOS и выделения памяти для машинок Halo (AMD Ryzen™ AI Max+ PRO 395/495 · 128–192 ГБ):</strong>
                        <div style="margin-top:4px;">
                            • <b>BIOS → UMA Frame Buffer Size (Variable Graphics Memory):</b> на Windows 11 выделите под iGPU <b>128 ГБ</b> (на системах 192 ГБ) или <b>96 ГБ</b> (на системах 128 ГБ); на Linux оставьте <b>512 МБ</b> (память выделяется динамически через GTT).<br>
                            • <b>BIOS → NPU / IPU:</b> убедитесь, что нейронный сопроцессор Ryzen AI XDNA2 включён (<code>Enabled</code>).<br>
                            • <b>Файл подкачки Windows 11:</b> рекомендуется фиксированный PageFile <b>128 ГБ</b> на NVMe SSD.
                        </div>
                    </div>
                    <button type="button" class="btn primary" ~if="hasAvailableHalo" @tap="downloadHalogenBundleAll()">
                        Установить весь комплект Halo (GPU + NPU)
                    </button>
                </div>
            </div>

            <div ~if="!unifiedModels.length" style="opacity:0.75;padding:6px 0;">
                {{hfModality === 'installed' ? 'Пока не установлено ни одной локальной модели. Переключитесь на «Все» или загрузите с диска / флешки.' : 'Модели по выбранному фильтру не найдены.'}}
            </div>

            <!-- Единый список карточек моделей: статус, прогресс + ETA и кнопки прямо в строке модели -->
            <div class="model-row" ~for="unifiedModels" ~class="{'off': $for.item.state === 'installed' && !$for.item.active}">
                <div class="model-main">
                    <div class="model-left">
                        <span class="dot" ~class="$for.item.dotClass"></span>
                        <oda-icon :icon="$for.item.icon || 'ai:ollama'" icon-size="20"></oda-icon>
                        <div style="min-width:0;flex:1;">
                            <div class="toolbar" style="gap:6px;">
                                <span class="model-name">{{$for.item.label}}</span>
                                <span class="status-chip ok" ~if="$for.item.state === 'installed'">
                                    Установлена<span ~if="$for.item.sizeGb"> · {{$for.item.sizeGb}} ГБ</span>
                                </span>
                                <span class="status-chip busy" ~if="$for.item.state === 'downloading'">
                                    Скачивается · {{$for.item.download?.progress || 0}}%
                                </span>
                                <span class="status-chip warn" ~if="$for.item.state === 'paused'">
                                    На паузе · {{fmtDownloadBytes($for.item.download?.downloadedBytes)}}
                                </span>
                                <span class="status-chip err" ~if="$for.item.state === 'failed'">
                                    Обрыв / Ошибка
                                </span>
                            </div>
                            <div class="model-desc">{{$for.item.desc}}</div>
                        </div>
                    </div>

                    <div class="toolbar">
                        <!-- Состояние: скачивается прямо сейчас -->
                        <div class="toolbar" ~if="$for.item.state === 'downloading'">
                            <span style="font-size:12px;font-weight:600;white-space:nowrap;">
                                <span ~if="$for.item.download?.sourceLabel">{{$for.item.download.sourceLabel}} · </span><span ~if="$for.item.download?.threads">{{$for.item.download.threads}} пот. · </span>{{$for.item.download?.speedMBs || 0}} МБ/с
                                <span ~if="$for.item.etaText"> · {{$for.item.etaText}}</span>
                            </span>
                            <button type="button" class="btn" @tap="pauseDownload($for.item)">Пауза</button>
                        </div>

                        <!-- Состояние: пауза / обрыв -->
                        <div class="toolbar" ~if="$for.item.state === 'paused' || $for.item.state === 'failed'">
                            <button type="button" class="btn primary" @tap="resumeDownload($for.item)">Докачать</button>
                            <button type="button" class="btn danger" @tap="discardDownload($for.item)">Сбросить</button>
                        </div>

                        <!-- Состояние: установлена -->
                        <div class="toolbar" ~if="$for.item.state === 'installed'">
                            <label class="toolbar" style="cursor:pointer;font-size:12px;font-weight:600;">
                                <input type="checkbox" :checked="$for.item.enabled !== false" @change="toggleLocalModel($for.item.path, $event.target.checked)">
                                <span>Вкл</span>
                            </label>
                            <button type="button" class="btn danger" @tap="deleteLocalModel($for.item.id)">Удалить</button>
                        </div>

                        <!-- Состояние: доступна к установке -->
                        <div class="toolbar" ~if="$for.item.state === 'available'">
                            <span class="mem-tag" :title="$for.item.fit === 'too_large' ? 'Требуется больше памяти, чем доступно на этом ПК' : 'Подходит по памяти'">
                                <span class="dot" ~class="$for.item.fit === 'too_large' ? 'off' : ($for.item.fit === 'optimal' ? 'on' : 'warn')"></span>
                                <span><span ~if="$for.item.device">{{$for.item.device}} · </span>~{{$for.item.ramGb || 4}} ГБ</span>
                            </span>
                            <button type="button" class="btn primary" @tap="installUnifiedModel($for.item)">Установить</button>
                        </div>
                    </div>
                </div>

                <!-- Прогресс-бар, объём, текущий файл и ETA на той же карточке -->
                <div ~if="$for.item.state === 'downloading' || $for.item.state === 'paused'" style="display:flex;flex-direction:column;gap:4px;margin-top:2px;">
                    <div class="progress-track">
                        <div class="progress-fill" ~class="{'paused': $for.item.state === 'paused'}"
                            ~style="{width: ($for.item.progressPct) + '%'}"></div>
                    </div>
                    <div class="model-desc" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                        <span>
                            Скачано: <b>{{fmtDownloadBytes($for.item.download?.downloadedBytes)}}</b>
                            <span ~if="$for.item.download?.totalBytes"> из {{fmtDownloadBytes($for.item.download?.totalBytes)}} ({{$for.item.download?.progress || 0}}%)</span>
                            <span ~if="$for.item.download?.currentFile"> · {{$for.item.download?.currentFile}}</span>
                        </span>
                        <span ~if="$for.item.download?.retryAttempt">
                            Авто-повтор #{{$for.item.download.retryAttempt}}: {{$for.item.download.retryError}}
                        </span>
                    </div>
                </div>

                <!-- Подсказка при стабильно низкой скорости (< 2 МБ/с) -->
                <div class="inline-warn" ~if="$for.item.state === 'downloading' && $for.item.download?.lowSpeedWarning">
                    <span>Низкая скорость ({{$for.item.download?.speedMBs || 0}} МБ/с). Попробуйте переключить источник на HF-Mirror или указать прокси для моделей.</span>
                    <button type="button" class="btn" @tap="networkOpen = true">Настроить сеть</button>
                </div>

                <!-- Текст ошибки на той же карточке при обрыве -->
                <div class="inline-err" ~if="$for.item.state === 'failed' && $for.item.download?.error">
                    {{$for.item.download.error}}
                    <span ~if="$for.item.download?.downloadedBytes"> · Сохранено на диске: {{fmtDownloadBytes($for.item.download.downloadedBytes)}} (доступна докачка)</span>
                </div>
            </div>
        </div>
    </div>

    <!-- ВКЛАДКА 2: ДООБУЧЕНИЕ НА ДАННЫХ ОРГАНИЗАЦИИ (2 ШАГА) -->
    <div ~if="activeTab === 'train'" class="grid-2">
        <!-- Шаг 1: Сборка данных организации -->
        <div class="card">
            <div class="section-title">Шаг 1. Собрать обучающий набор из организации</div>
            <div class="field">
                <label>Организация ($base)</label>
                <input :value="datasetBasePath" placeholder="/ORGANIZATIONS/Моё предприятие" @input="datasetBasePath = $this.value">
            </div>
            <div class="field">
                <label>Имя обучающего набора (.jsonl)</label>
                <input :value="datasetName" @input="datasetName = $this.value">
            </div>
            <div class="vertical" style="gap:6px;margin-top:2px;">
                <label class="toolbar" style="cursor:pointer;"><input type="checkbox" :checked="srcTasks" @change="srcTasks = $event.target.checked"> <span>Диалоги и решённые задачи ИИ (*.task)</span></label>
                <label class="toolbar" style="cursor:pointer;"><input type="checkbox" :checked="srcAccounting" @change="srcAccounting = $event.target.checked"> <span>Учётные операции, проводки и ведомости (work.db)</span></label>
                <label class="toolbar" style="cursor:pointer;"><input type="checkbox" :checked="srcClasses" @change="srcClasses = $event.target.checked"> <span>Структура классов и справочников (/MODULES)</span></label>
            </div>
            <div class="toolbar" style="margin-top:4px;">
                <button type="button" class="btn primary" @tap="buildDataset()">Собрать обучающий набор</button>
            </div>

            <div class="section-title" ~if="datasets.length" style="margin-top:8px;">Готовые наборы ({{datasets.length}})</div>
            <div class="model-row" ~for="datasets">
                <div class="model-main">
                    <div>
                        <div class="model-name">{{$for.item.name}}</div>
                        <div class="model-desc">Примеров: {{$for.item.totalExamples}} · ~{{$for.item.estimatedTokens}} токенов</div>
                    </div>
                    <button type="button" class="btn" @tap="trainDatasetName = $for.item.name">Выбрать</button>
                </div>
            </div>
        </div>

        <!-- Шаг 2: Запуск дообучения LoRA -->
        <div class="card">
            <div class="section-title">Шаг 2. Дообучить модель (LoRA)</div>
            <div class="field">
                <label>Название новой обученной модели</label>
                <input :value="trainAdapterName" @input="trainAdapterName = $this.value">
            </div>
            <div class="field">
                <label>Базовая модель (рекомендована под вашу память: {{hardware?.recommendedBaseModel || 'Qwen/Qwen3-8B'}})</label>
                <input :value="trainBaseModel" @input="trainBaseModel = $this.value">
            </div>
            <div class="field">
                <label>Обучающий набор (.jsonl)</label>
                <input :value="trainDatasetName" @input="trainDatasetName = $this.value">
            </div>
            <div class="field">
                <label>Режим обучения</label>
                <select @change="trainMode = $this.value">
                    <option value="sft" :selected="trainMode === 'sft'">Обучение на примерах организации (SFT)</option>
                    <option value="grpo" :selected="trainMode === 'grpo'">Обучение с проверкой учётных проводок (GRPO)</option>
                </select>
            </div>
            <div class="toolbar" style="margin-top:4px;">
                <button type="button" class="btn primary" @tap="startTraining()">Запустить дообучение</button>
            </div>

            <div class="section-title" ~if="jobs.length" style="margin-top:8px;">Задачи обучения ({{jobs.length}})</div>
            <div class="model-row" ~for="jobs">
                <div class="model-main">
                    <div>
                        <div class="model-name">{{$for.item.adapterName}} ({{$for.item.mode?.toUpperCase()}})</div>
                        <div class="model-desc">
                            Шаг {{$for.item.step}} / {{$for.item.totalSteps}} · Loss: {{$for.item.loss}}
                            <span ~if="$for.item.publishedPath"> · Готова: <code>{{$for.item.publishedPath}}</code></span>
                        </div>
                    </div>
                    <button type="button" class="btn danger" ~if="$for.item.status === 'running'" @tap="stopTraining($for.item.id)">Остановить</button>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" ~style="{width: Math.round(($for.item.step / ($for.item.totalSteps || 1)) * 100) + '%'}"></div>
                </div>
            </div>
        </div>
    </div>
    `,
    activeTab: 'models',
    hardware: null,
    runtime: null,
    localModels: [],
    adapters: [],
    datasets: [],
    downloads: [],
    jobs: [],
    transfers: [],
    hfModels: [],
    halogenCatalog: [],
    hfQuery: '',
    hfModality: 'all',
    hfFilter: 'all',
    datasetName: 'work-org-sft',
    datasetBasePath: '/ORGANIZATIONS/Маслоторг',
    srcTasks: true,
    srcAccounting: true,
    srcClasses: true,
    trainAdapterName: 'work-accountant-lora',
    trainBaseModel: 'Qwen/Qwen3-8B',
    trainDatasetName: 'work-org-sft.jsonl',
    trainMode: 'sft',
    trainLoraR: 16,
    trainMaxSeq: 8192,
    notice: '',
    error: '',
    network: null,
    networkOpen: false,
    netPreset: 'official',
    netEndpoint: 'https://huggingface.co',
    netProxy: '',
    netHasProxy: false,
    netThreads: 8,
    netToken: '',
    netHasToken: false,
    netTokenMask: '',
    netBusy: false,
    netProbe: null,
    _networkDirty: false,
    _pollTimer: null,

    get networkSummary() {
        const n = this.network;
        const src = n?.sourceLabel || 'huggingface.co';
        const thr = n?.threads || this.netThreads || 8;
        const pxy = n?.hasProxy ? ' · прокси' : '';
        return `${src} · ${thr} пот.${pxy}`;
    },

    get categoryTabs() {
        return [
            { id: 'all', label: 'Все', icon: 'icons:apps' },
            { id: 'installed', label: `Установленные (${(this.localModels || []).length})`, icon: 'icons:check' },
            { id: 'llm', label: 'Чат и Код', icon: 'carbon:chat' },
            { id: 'vlm', label: 'Зрение и Документы', icon: 'carbon:image-search' },
            { id: 'audio', label: 'Речь и Голос', icon: 'carbon:microphone' },
            { id: 'image', label: 'Картинки', icon: 'carbon:paint-brush' },
            { id: 'embed', label: 'Поиск (RAG)', icon: 'carbon:search-locate' },
            { id: 'halo', label: 'Комплект Halo (128–192 ГБ)', icon: 'carbon:chip' },
        ];
    },
    get activeDownloads() {
        return (this.downloads || []).filter(d => d.status === 'downloading');
    },
    get activeTransfers() {
        return (this.transfers || []).filter(t => t.status === 'running');
    },
    get hasAvailableHalo() {
        return (this.halogenCatalog || []).some(h =>
            !h.weightsDownloaded
            && !this.isRepoInstalled(h.hfRepo, h.nodeName)
            && !this.getDownloadEntry(h.hfRepo, h.nodeName)
        );
    },
    get unifiedModels() {
        const mod = String(this.hfModality || 'all');
        const q = String(this.hfQuery || '').trim().toLowerCase();
        const haloByNode = new Map();
        const haloByRepo = new Map();
        for (const h of this.halogenCatalog || []) {
            if (h?.nodeName)
                haloByNode.set(h.nodeName.toLowerCase(), h);
            if (h?.hfRepo)
                haloByRepo.set(h.hfRepo.toLowerCase(), h);
        }

        const list = [];
        const findEntry = (id, repoId) => {
            const idLow = String(id || '').toLowerCase();
            const repoLow = String(repoId || '').toLowerCase();
            const shortRepo = repoLow ? repoLow.split('/').pop() : '';
            return list.find(x =>
                (idLow && (x.id?.toLowerCase() === idLow || x.download?.folderName?.toLowerCase() === idLow))
                || (repoLow && x.repoId?.toLowerCase() === repoLow)
                || (shortRepo && x.id?.toLowerCase() === shortRepo)
            ) || null;
        };

        // 1. Установленные локальные модели
        for (const m of this.localModels || []) {
            const halo = haloByNode.get(String(m.id || '').toLowerCase())
                || haloByRepo.get(String(m.model || '').toLowerCase());
            list.push({
                key: `inst:${m.id}`,
                id: m.id,
                repoId: halo?.hfRepo || (String(m.model || '').includes('/') ? m.model : ''),
                label: m.label || halo?.label || m.id,
                desc: `Путь: ${m.path}${m.sizeGb ? ` · На диске: ${m.sizeGb} ГБ` : ''}`,
                icon: m.icon || halo?.icon || 'ai:ollama',
                modality: m.modality || halo?.modality || 'llm',
                isHalo: Boolean(halo),
                state: 'installed',
                dotClass: m.active ? 'on' : 'off',
                path: m.path,
                enabled: m.enabled !== false,
                active: Boolean(m.active),
                sizeGb: m.sizeGb || 0,
                ramGb: m.sizeGb || halo?.ramGb || 4,
                fit: 'optimal',
                device: halo?.device || '',
                download: null,
                progressPct: 100,
                etaText: '',
            });
        }

        // 2. Активные, приостановленные и упавшие загрузки (в т.ч. .part на диске)
        for (const d of this.downloads || []) {
            if (d.status === 'completed' || d.status === 'cancelled')
                continue;
            const halo = haloByNode.get(String(d.folderName || '').toLowerCase())
                || haloByRepo.get(String(d.repoId || '').toLowerCase());
            const existing = findEntry(d.folderName, d.repoId);
            const state = d.status === 'downloading' ? 'downloading' : (d.status === 'failed' ? 'failed' : 'paused');
            const progressPct = d.totalBytes > 0
                ? Math.min(99, Math.max(0, Number(d.progress) || Math.round((d.downloadedBytes / d.totalBytes) * 100)))
                : (d.downloadedBytes > 0 ? 15 : 0);
            const etaText = this.formatEta(d.etaSeconds);
            if (existing) {
                if (existing.state !== 'installed') {
                    existing.state = state;
                    existing.dotClass = state === 'downloading' ? 'on' : 'warn';
                    existing.download = d;
                    existing.progressPct = progressPct;
                    existing.etaText = etaText;
                }
                continue;
            }
            list.push({
                key: `dl:${d.id || d.folderName}`,
                id: d.folderName || halo?.nodeName || d.repoId,
                repoId: d.repoId || halo?.hfRepo || '',
                label: halo?.label || d.label || d.folderName || d.repoId,
                desc: halo?.role || d.repoId || `Папка загрузки: #downloads/${d.folderName}`,
                icon: halo?.icon || 'ai:ollama',
                modality: halo?.modality || d.modality || 'llm',
                isHalo: Boolean(halo),
                state,
                dotClass: state === 'downloading' ? 'on' : 'warn',
                ramGb: halo?.ramGb || 4,
                fit: 'optimal',
                device: halo?.device || '',
                download: d,
                progressPct,
                etaText,
            });
        }

        // 3. Каталог Halo
        for (const h of this.halogenCatalog || []) {
            if (findEntry(h.nodeName, h.hfRepo))
                continue;
            list.push({
                key: `halo:${h.nodeName}`,
                id: h.nodeName,
                repoId: h.hfRepo,
                label: h.label || h.nodeName,
                desc: h.role || '',
                icon: h.icon || 'ai:qwen',
                modality: h.modality || 'llm',
                isHalo: true,
                state: 'available',
                dotClass: 'off',
                ramGb: h.ramGb || 4,
                fit: 'optimal',
                device: h.device || '',
                download: null,
                progressPct: 0,
                etaText: '',
            });
        }

        // 4. Каталог Hugging Face
        for (const item of this.hfModels || []) {
            const short = String(item.id || '').split('/').pop();
            if (findEntry(short, item.id))
                continue;
            list.push({
                key: `hf:${item.id}`,
                id: short || item.id,
                repoId: item.id,
                label: item.id,
                desc: item.whatItDoes || item.recommendedFor || '',
                icon: item.icon || 'ai:ollama',
                modality: item.modality || 'llm',
                isHalo: false,
                state: 'available',
                dotClass: 'off',
                ramGb: item.ramRequiredGb || 4,
                fit: item.fit || 'optimal',
                device: '',
                download: null,
                progressPct: 0,
                etaText: '',
            });
        }

        const rank = { downloading: 0, paused: 1, failed: 1, installed: 2, available: 3 };
        return list
            .filter(item => {
                if (mod === 'installed')
                    return item.state === 'installed';
                if (mod === 'halo')
                    return item.isHalo;
                if (mod !== 'all' && item.modality !== mod)
                    return false;
                if (q && mod !== 'halo' && mod !== 'installed') {
                    const hay = `${item.label} ${item.id} ${item.repoId} ${item.desc}`.toLowerCase();
                    if (!hay.includes(q))
                        return false;
                }
                if (this.hfFilter === 'fit' && item.state === 'available' && item.fit === 'too_large')
                    return false;
                return true;
            })
            .sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9));
    },
    formatEta(sec) {
        const s = Number(sec);
        if (!Number.isFinite(s) || s <= 0)
            return '';
        if (s < 60)
            return `~${s} с`;
        if (s < 3600)
            return `~${Math.floor(s / 60)} мин ${s % 60} с`;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `~${h} ч ${m} мин`;
    },
    fmtDownloadBytes(bytes) {
        const b = Number(bytes) || 0;
        if (b <= 0)
            return '0 МБ';
        if (b < 1024 * 1024)
            return `${Math.round(b / 1024)} КБ`;
        if (b < 1024 ** 3)
            return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
        return `${(b / (1024 ** 3)).toFixed(2)} ГБ`;
    },
    isRepoInstalled(repoId, nodeName = '') {
        if (!repoId && !nodeName)
            return false;
        const shortName = repoId ? String(repoId).split('/').pop().toLowerCase() : '';
        const nodeLower = nodeName ? String(nodeName).toLowerCase() : '';
        const repoLower = repoId ? String(repoId).toLowerCase() : '';
        return (this.localModels || []).some(m => {
            const mId = String(m.id || '').toLowerCase();
            const mModel = String(m.model || '').toLowerCase();
            return (shortName && mId === shortName)
                || (nodeLower && mId === nodeLower)
                || (repoLower && mModel === repoLower);
        });
    },
    getDownloadEntry(repoId, nodeName = '') {
        if (!repoId && !nodeName)
            return null;
        return (this.downloads || []).find(d =>
            (d.status === 'downloading' || d.status === 'paused' || d.status === 'failed')
            && ((repoId && d.repoId === repoId) || (nodeName && d.folderName === nodeName))
        ) || null;
    },
    async attached() {
        await this.reloadAll();
        await this.searchHf();
        this._pollTimer = setInterval(() => {
            if (this.activeDownloads.length || this.activeTransfers.length || (this.jobs || []).some(j => j.status === 'running')) {
                this.reloadAll();
            }
        }, 1200);
    },
    detached() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },
    async _call(method, params = {}) {
        this.error = '';
        if (!this.$item)
            return null;
        try {
            return await this.$item.fetch(method, params);
        }
        catch (e) {
            this.error = String(e?.message || e);
            return null;
        }
    },
    _invalidateClientModelsTree() {
        for (const w of [window, window.parent, window.top]) {
            try {
                const wk = w?.WORK;
                if (!wk?.items)
                    continue;
                for (const k of Object.keys(wk.items)) {
                    if (k === '/MODELS' || k.startsWith('/MODELS/')) {
                        const node = wk.items[k];
                        if (node?.[w.R]?.cache)
                            delete node[w.R].cache.items;
                        node?.reset?.();
                    }
                }
            }
            catch { /* ignore cross-frame */ }
        }
    },
    async reloadAll() {
        const prevCount = this.localModels?.length || 0;
        const st = await this._call('trainer_status');
        if (!st)
            return;
        if (st.hardware) {
            const firstLoad = !this.hardware;
            this.hardware = st.hardware;
            if (firstLoad && st.hardware.recommendedBaseModel) {
                this.trainBaseModel = st.hardware.recommendedBaseModel;
                this.trainLoraR = st.hardware.recommendedLoraR || 16;
                this.trainMaxSeq = st.hardware.recommendedMaxSeq || 8192;
            }
        }
        this.runtime = st.runtime || null;
        this.localModels = st.models || [];
        this.adapters = st.adapters || [];
        this.datasets = st.datasets || [];
        this.downloads = st.downloads || [];
        this.jobs = st.jobs || [];
        this.transfers = st.transfers || [];
        if (st.network) {
            this.network = st.network;
            if (!this._networkDirty)
                this._applyNetworkState(st.network);
        }
        if (st.halogen?.catalog)
            this.halogenCatalog = st.halogen.catalog;
        if (this.localModels.length !== prevCount)
            this._invalidateClientModelsTree();
    },
    _applyNetworkState(n) {
        if (!n)
            return;
        this.netPreset = n.sourcePreset || 'official';
        this.netEndpoint = n.endpointUrl || 'https://huggingface.co';
        this.netProxy = n.proxyUrl || '';
        this.netHasProxy = Boolean(n.hasProxy);
        this.netThreads = Number(n.threads) || 8;
        this.netHasToken = Boolean(n.hasToken);
        this.netTokenMask = n.tokenMask || '';
        this.netToken = '';
    },
    toggleNetworkPanel() {
        this.networkOpen = !this.networkOpen;
        if (this.networkOpen && this.network && !this._networkDirty)
            this._applyNetworkState(this.network);
    },
    onNetworkPresetChange(val) {
        this.netPreset = String(val || 'official');
        this._networkDirty = true;
        if (this.netPreset === 'official')
            this.netEndpoint = 'https://huggingface.co';
        else if (this.netPreset === 'hf-mirror')
            this.netEndpoint = 'https://hf-mirror.com';
    },
    setNetworkField(field, val) {
        this[field] = val;
        this._networkDirty = true;
    },
    async saveNetworkSettings() {
        this.netBusy = true;
        this.netProbe = null;
        try {
            const payload = {
                sourcePreset: this.netPreset,
                endpointUrl: this.netPreset === 'official'
                    ? 'https://huggingface.co'
                    : (this.netPreset === 'hf-mirror' ? 'https://hf-mirror.com' : this.netEndpoint),
                proxyUrl: this.netProxy,
                threads: this.netThreads,
            };
            if (this.netToken)
                payload.token = this.netToken;
            const res = await this._call('trainer_network_set', payload);
            if (res) {
                this.network = res;
                this._networkDirty = false;
                this._applyNetworkState(res);
                this.notice = `Сетевые настройки загрузчика сохранены (${res.sourceLabel}, ${res.threads} потоков).`;
            }
        }
        finally {
            this.netBusy = false;
        }
    },
    async probeNetwork() {
        this.netBusy = true;
        this.netProbe = null;
        try {
            const endpointUrl = this.netPreset === 'official'
                ? 'https://huggingface.co'
                : (this.netPreset === 'hf-mirror' ? 'https://hf-mirror.com' : this.netEndpoint);
            const payload = {
                sourcePreset: this.netPreset,
                endpointUrl,
                proxyUrl: this.netProxy,
                threads: this.netThreads,
            };
            if (this.netToken)
                payload.token = this.netToken;
            const res = await this._call('trainer_network_probe', payload);
            if (res)
                this.netProbe = res;
        }
        finally {
            this.netBusy = false;
        }
    },
    async clearNetworkProxy() {
        this.netBusy = true;
        try {
            const res = await this._call('trainer_network_set', { clearProxy: true });
            if (res) {
                this.network = res;
                this._networkDirty = false;
                this._applyNetworkState(res);
                this.notice = 'Прокси для загрузки моделей отключён.';
            }
        }
        finally {
            this.netBusy = false;
        }
    },
    async clearNetworkToken() {
        this.netBusy = true;
        try {
            const res = await this._call('trainer_network_set', { clearToken: true });
            if (res) {
                this.network = res;
                this._networkDirty = false;
                this._applyNetworkState(res);
                this.notice = 'Сохранённый HF Token удалён.';
            }
        }
        finally {
            this.netBusy = false;
        }
    },
    async setModality(mod) {
        this.hfModality = String(mod || 'all');
        if (this.hfModality !== 'halo' && this.hfModality !== 'installed') {
            await this.searchHf();
        }
    },
    async installUnifiedModel(item) {
        if (!item)
            return;
        if (item.download && (item.state === 'paused' || item.state === 'failed')) {
            await this.resumeDownload(item);
            return;
        }
        if (item.isHalo)
            await this.downloadHalogenModel(item.id);
        else
            await this.installModelOneClick(item.repoId);
    },
    async pauseDownload(item) {
        const jobId = item?.download?.id || item?.id || item;
        if (!jobId)
            return;
        await this._call('trainer_hf_pause', { jobId });
        this.notice = `Загрузка «${item?.label || jobId}» поставлена на паузу (скачанное сохранено для докачки).`;
        await this.reloadAll();
    },
    async resumeDownload(item) {
        const dl = item?.download || item || {};
        const job = await this._call('trainer_hf_resume', {
            jobId: dl.id || '',
            folderName: dl.folderName || item?.id || '',
            repoId: item?.repoId || dl.repoId || '',
            quant: (this.hardware?.usableMemoryGb || 12) >= 24 ? 'Q8_0' : 'Q4_K_M',
        });
        if (job) {
            this.notice = `Возобновлена докачка модели «${item?.label || dl.folderName || item?.repoId}»…`;
            await this.reloadAll();
        }
    },
    async discardDownload(item) {
        const dl = item?.download || item || {};
        await this._call('trainer_hf_discard', {
            jobId: dl.id || '',
            folderName: dl.folderName || item?.id || '',
        });
        this.notice = `Недокачанные файлы «${item?.label || dl.folderName}» удалены.`;
        await this.reloadAll();
    },
    async setHfFilter(val) {
        this.hfFilter = String(val || 'all');
        await this.searchHf();
    },
    async searchHf() {
        const res = await this._call('trainer_hf_search', {
            query: this.hfQuery,
            modality: (this.hfModality === 'halo' || this.hfModality === 'installed') ? 'all' : this.hfModality,
            filter: this.hfFilter,
        });
        if (res?.items)
            this.hfModels = res.items;
    },
    async installModelOneClick(repoId) {
        if (!repoId)
            return;
        this.notice = '';
        const quant = (this.hardware?.usableMemoryGb || 12) >= 24 ? 'Q8_0' : 'Q4_K_M';
        const job = await this._call('trainer_hf_download', {
            repoId,
            quant,
        });
        if (job) {
            this.notice = `Начата установка модели «${repoId}»…`;
            await this.reloadAll();
            this._invalidateClientModelsTree();
        }
    },
    async cancelDownload(jobId) {
        await this._call('trainer_hf_cancel', { jobId });
        await this.reloadAll();
    },
    async cancelTransfer(jobId) {
        await this._call('trainer_transfer_cancel', { jobId });
        await this.reloadAll();
    },
    async openTransferDialog(mode = 'export') {
        const mod = await import('/$server/$folder/lib/local-models-transfer/local-models-transfer.js');
        await mod.openLocalModelsTransferDialog(this.$item, {
            mode,
            onComplete: async () => {
                await this.reloadAll();
                this._invalidateClientModelsTree();
            },
        });
        await this.reloadAll();
    },
    async toggleLocalModel(modelPath, checked) {
        await this._call('provider_toggle_model', {
            nodePath: modelPath,
            enabled: checked,
        });
        await this.reloadAll();
        this._invalidateClientModelsTree();
    },
    async deleteLocalModel(modelId) {
        if (!modelId)
            return;
        const res = await this._call('trainer_delete_model', { modelId });
        if (res?.ok) {
            this.notice = `Модель «${modelId}» и её веса удалены с диска.`;
            await this.reloadAll();
            this._invalidateClientModelsTree();
        }
    },
    async releaseMemory() {
        const res = await this._call('trainer_release_memory');
        if (res?.ok) {
            this.runtime = res.runtime || this.runtime;
            this.notice = 'Оперативная память и видеопамять локального ИИ освобождены.';
        }
    },
    async downloadHalogenModel(nodeName) {
        if (!nodeName)
            return;
        const res = await this._call('halogen_download_bundle', { models: nodeName });
        if (res) {
            this.notice = `Начата установка модели «${nodeName}» в /MODELS/Local…`;
            await this.reloadAll();
            this._invalidateClientModelsTree();
        }
    },
    async downloadHalogenBundleAll() {
        const res = await this._call('halogen_download_bundle', {});
        if (res) {
            this.notice = `Начата установка комплекта Halo (${res.totalModels} моделей GPU + NPU) в /MODELS/Local…`;
            await this.reloadAll();
            this._invalidateClientModelsTree();
        }
    },
    async buildDataset() {
        const sources = [];
        if (this.srcTasks)
            sources.push('tasks');
        if (this.srcAccounting)
            sources.push('accounting');
        if (this.srcClasses)
            sources.push('classes');
        const ds = await this._call('trainer_dataset_build', {
            name: this.datasetName,
            basePath: this.datasetBasePath,
            sources: sources.join(','),
        });
        if (ds) {
            this.trainDatasetName = `${ds.name}.jsonl`;
            this.notice = `Обучающий набор «${ds.name}» собран (${ds.totalExamples} примеров).`;
            await this.reloadAll();
        }
    },
    async startTraining() {
        const job = await this._call('trainer_start', {
            adapterName: this.trainAdapterName,
            baseModel: this.trainBaseModel,
            datasetName: this.trainDatasetName,
            mode: this.trainMode,
            loraR: this.trainLoraR,
            maxSeqLength: this.trainMaxSeq,
            basePath: this.datasetBasePath,
        });
        if (job) {
            this.notice = `Запущено дообучение модели «${this.trainAdapterName}»…`;
            await this.reloadAll();
        }
    },
    async stopTraining(jobId) {
        await this._call('trainer_stop', { jobId });
        await this.reloadAll();
    },
}
