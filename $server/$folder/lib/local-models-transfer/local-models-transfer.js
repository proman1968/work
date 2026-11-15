/**
 * Единый системный диалог выгрузки и загрузки локальных моделей (/MODELS/Local):
 *  - прямой перенос на диск / USB-флешку (с обзорщиком дисков, проверкой места и SHA-256 манифестом);
 *  - дополнительный потоковый перенос файлом .tar через браузер (для удалённого доступа).
 */
const TRANSFER_STYLE = /*css*/`
    :host {
        @apply --vertical;
        gap: 12px;
        padding: 14px 18px;
        width: min(820px, 92vw);
        max-height: 78vh;
        overflow-y: auto;
        box-sizing: border-box;
        background: var(--content-background, #ffffff);
        color: var(--content-color, #1e293b);
        font-size: 13px;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .between {
        justify-content: space-between;
    }
    .tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--border-color, #cbd5e1);
    }
    .tab-btn {
        appearance: none;
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: inherit;
        opacity: 0.72;
        padding: 7px 14px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .tab-btn:hover { opacity: 1; }
    .tab-btn.active {
        opacity: 1;
        color: var(--accent-color, #2563eb);
        border-bottom-color: var(--accent-color, #2563eb);
    }
    .pill {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 11px;
        border-radius: 6px;
        border: 1px solid var(--border-color, #cbd5e1);
        background: var(--subtle-background, #f8fafc);
        color: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }
    .pill.active {
        background: var(--accent-color, #2563eb);
        border-color: var(--accent-color, #2563eb);
        color: #ffffff;
    }
    .card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 11px 13px;
        border-radius: 8px;
        border: 1px solid var(--border-color, #cbd5e1);
        background: var(--subtle-background, #f8fafc);
    }
    .sec-title {
        font-size: 11.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.75;
    }
    .roots-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .root-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: 6px;
        border: 1px solid var(--border-color, #cbd5e1);
        background: var(--content-background, #ffffff);
        color: inherit;
        font-size: 12px;
        cursor: pointer;
    }
    .root-chip:hover {
        border-color: var(--accent-color, #2563eb);
        background: var(--accent-soft, rgba(37, 99, 235, 0.08));
    }
    .root-chip.selected {
        border-color: var(--accent-color, #2563eb);
        background: var(--accent-soft, rgba(37, 99, 235, 0.12));
        font-weight: 600;
    }
    .dirs-list {
        max-height: 155px;
        overflow-y: auto;
        border: 1px solid var(--border-color, #cbd5e1);
        border-radius: 6px;
        background: var(--content-background, #ffffff);
    }
    .dir-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 5px 10px;
        cursor: pointer;
        border-bottom: 1px solid var(--border-color, #e2e8f0);
        font-size: 12.5px;
    }
    .dir-item:last-child { border-bottom: none; }
    .dir-item:hover { background: var(--accent-soft, rgba(37, 99, 235, 0.08)); }
    .items-list {
        max-height: 210px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 5px;
    }
    .item-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 6px 10px;
        border-radius: 6px;
        border: 1px solid var(--border-color, #cbd5e1);
        background: var(--content-background, #ffffff);
        font-size: 12.5px;
    }
    .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 7px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
    }
    .badge.ok {
        background: light-dark(#dcfce7, #14532d);
        color: light-dark(#166534, #bbf7d0);
    }
    .badge.warn {
        background: light-dark(#fef3c7, #451a03);
        color: light-dark(#92400e, #fde68a);
    }
    .badge.info {
        background: var(--accent-soft, rgba(37, 99, 235, 0.12));
        color: var(--accent-color, #2563eb);
    }
    input[type="text"], input:not([type]) {
        padding: 6px 10px;
        font-size: 12.5px;
        border: 1px solid var(--border-color, #cbd5e1);
        border-radius: 6px;
        background: var(--content-background, #ffffff);
        color: inherit;
        min-width: 0;
    }
    .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        font-size: 12.5px;
        font-weight: 600;
        border-radius: 6px;
        border: 1px solid var(--border-color, #cbd5e1);
        background: var(--content-background, #ffffff);
        color: inherit;
        cursor: pointer;
        white-space: nowrap;
    }
    .btn:disabled {
        opacity: 0.48;
        cursor: not-allowed;
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
        padding: 8px 11px;
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
    .progress-track {
        width: 100%;
        height: 7px;
        background: var(--border-color, #e2e8f0);
        border-radius: 4px;
        overflow: hidden;
    }
    .progress-fill {
        height: 100%;
        background: var(--accent-color, #2563eb);
        transition: width 0.2s ease;
    }
`;

function fmtGb(bytes) {
    const n = Number(bytes) || 0;
    if (n > 0 && n < 10 * 1024 * 1024)
        return `${Math.max(0.1, +(n / (1024 * 1024)).toFixed(1))} МБ`;
    return `${(n / (1024 ** 3)).toFixed(2)} ГБ`;
}

function fmtEta(sec) {
    const s = Number(sec);
    if (!Number.isFinite(s) || s <= 0)
        return '';
    if (s < 60)
        return `~${s} с`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `~${m} мин ${rem} с`;
}

ODA({
    is: 'item-local-models-transfer',
    imports: 'oda//icon',
    template: /*html*/`
    <style>${TRANSFER_STYLE}</style>

    <div class="msg ok" ~if="notice">{{notice}}</div>
    <div class="msg err" ~if="error">{{error}}</div>

    <!-- Активные или недавно завершённые задачи переноса -->
    <div class="card" ~if="activeJobs.length">
        <div class="sec-title">Выполняется перенос</div>
        <div ~for="activeJobs" style="display:flex;flex-direction:column;gap:5px;">
            <div class="row between">
                <div>
                    <strong>{{$for.item.label}}</strong>
                    <span style="opacity:0.78;font-size:12px;">
                        <span ~if="$for.item.currentItem"> · {{$for.item.currentItem}}</span>
                        <span ~if="$for.item.currentFile"> ({{$for.item.currentFile}})</span>
                    </span>
                </div>
                <div class="row">
                    <span style="font-size:12px;font-weight:600;">
                        {{$for.item.progress || 0}}% · {{fmtSize($for.item.copiedBytes)}} / {{fmtSize($for.item.totalBytes)}} · {{$for.item.speedMBs || 0}} МБ/с {{fmtTime($for.item.etaSeconds)}}
                    </span>
                    <button type="button" class="btn danger" @tap="cancelJob($for.item.id)">Отменить</button>
                </div>
            </div>
            <div class="progress-track">
                <div class="progress-fill" ~style="{width: ($for.item.progress || 0) + '%'}"></div>
            </div>
        </div>
    </div>

    <!-- Прогресс загрузки .tar через браузер (XHR) -->
    <div class="card" ~if="tarUploading">
        <div class="row between">
            <strong>Отправка и установка архива .tar…</strong>
            <span style="font-size:12px;font-weight:600;">{{tarUploadProgress}}%</span>
        </div>
        <div class="progress-track">
            <div class="progress-fill" ~style="{width: tarUploadProgress + '%'}"></div>
        </div>
    </div>

    <!-- Вкладки Выгрузка / Загрузка -->
    <div class="row between">
        <div class="tabs">
            <button type="button" class="tab-btn" ~class="{'active': mode === 'export'}" @tap="switchMode('export')">
                <oda-icon icon="carbon:upload" icon-size="16"></oda-icon>
                <span>Выгрузить (Бэкап)</span>
            </button>
            <button type="button" class="tab-btn" ~class="{'active': mode === 'import'}" @tap="switchMode('import')">
                <oda-icon icon="carbon:download" icon-size="16"></oda-icon>
                <span>Загрузить (Восстановить)</span>
            </button>
        </div>
        <div class="row">
            <button type="button" class="pill" ~class="{'active': transport === 'disk'}" @tap="transport = 'disk'">
                <oda-icon icon="carbon:usb" icon-size="14"></oda-icon>
                <span>Диск / Флешка</span>
            </button>
            <button type="button" class="pill" ~class="{'active': transport === 'tar'}" @tap="transport = 'tar'">
                <oda-icon icon="icons:archive" icon-size="14"></oda-icon>
                <span>Файл .tar (браузер)</span>
            </button>
        </div>
    </div>

    <!-- ОБЗОРЩИК ДИСКОВ И ПАПОК СЕРВЕРА (для обоих режимов на диске/флешке) -->
    <div class="card" ~if="transport === 'disk'">
        <div class="row between">
            <span class="sec-title">{{mode === 'export' ? 'Куда выгрузить (диск или флешка)' : 'Откуда загрузить (папка с бэкапом)'}}</span>
            <span style="font-size:12px;opacity:0.8;" ~if="dirInfo">
                Свободно на диске: <strong>{{dirInfo.freeGb}} ГБ</strong> из {{dirInfo.totalGb}} ГБ
            </span>
        </div>

        <div class="roots-bar" ~if="roots.length">
            <button type="button" class="root-chip" ~for="roots"
                ~class="{'selected': isRootSelected($for.item.path)}"
                @tap="openDir($for.item.path)">
                <oda-icon :icon="$for.item.kind === 'removable' ? 'carbon:usb' : 'carbon:folder'" icon-size="15"></oda-icon>
                <span>{{$for.item.label}} ({{$for.item.freeGb}} ГБ своб.)</span>
            </button>
        </div>

        <div class="row">
            <button type="button" class="btn" :disabled="!dirInfo?.parentPath" @tap="openDir(dirInfo.parentPath)">Вверх</button>
            <input type="text" style="flex:1;" :value="currentPath" placeholder="Путь на диске или флешке, например E:\\ModelsBackup"
                @input="currentPath = $this.value" @keydown.enter="openDir(currentPath)">
            <button type="button" class="btn" @tap="openDir(currentPath)">Открыть</button>
            <button type="button" class="btn" ~if="mode === 'export'" @tap="promptNewFolder()">+ Папка</button>
        </div>

        <div class="dirs-list" ~if="dirInfo">
            <div ~if="!dirInfo.dirs?.length" style="padding:8px 10px;opacity:0.65;font-size:12px;">
                Вложенных папок нет
            </div>
            <div class="dir-item" ~for="dirInfo.dirs" @tap="openDir($for.item.path)">
                <div class="row" style="gap:6px;">
                    <oda-icon icon="icons:folder" icon-size="16"></oda-icon>
                    <span>{{$for.item.name}}</span>
                </div>
                <span class="badge info" ~if="$for.item.hasBackup">Пакет моделей</span>
            </div>
        </div>
    </div>

    <!-- РЕЖИМ 1: ВЫГРУЗКА -->
    <div ~if="mode === 'export'" style="display:flex;flex-direction:column;gap:10px;">
        <div class="card">
            <div class="row between">
                <span class="sec-title">Что выгрузить из /MODELS/Local</span>
                <div class="row">
                    <button type="button" class="btn" @tap="selectAllExport(true)">Выбрать всё</button>
                    <button type="button" class="btn" @tap="selectAllExport(false)">Снять всё</button>
                </div>
            </div>

            <div ~if="!hasAnyExportItem" style="opacity:0.75;padding:6px 0;">
                В /MODELS/Local пока нет установленных моделей, адаптеров или датасетов.
            </div>

            <div class="items-list" ~if="hasAnyExportItem">
                <label class="item-row" ~for="inventory.models" style="cursor:pointer;">
                    <div class="row">
                        <input type="checkbox" :checked="selectedExportModels.includes($for.item.id)"
                            @change="toggleId('selectedExportModels', $for.item.id, $event.target.checked)">
                        <oda-icon :icon="$for.item.icon || 'ai:ollama'" icon-size="18"></oda-icon>
                        <div>
                            <strong>{{$for.item.label || $for.item.id}}</strong>
                            <span style="opacity:0.72;font-size:11.5px;"> ({{$for.item.filesCount}} файлов)</span>
                        </div>
                    </div>
                    <span style="font-weight:600;white-space:nowrap;">{{fmtSize($for.item.sizeBytes)}}</span>
                </label>

                <label class="item-row" ~for="inventory.adapters" style="cursor:pointer;">
                    <div class="row">
                        <input type="checkbox" :checked="selectedExportAdapters.includes($for.item.id)"
                            @change="toggleId('selectedExportAdapters', $for.item.id, $event.target.checked)">
                        <oda-icon icon="carbon:chip" icon-size="18"></oda-icon>
                        <div><strong>LoRA-адаптер: {{$for.item.label || $for.item.id}}</strong></div>
                    </div>
                    <span style="font-weight:600;white-space:nowrap;">{{fmtSize($for.item.sizeBytes)}}</span>
                </label>

                <label class="item-row" ~for="inventory.datasets" style="cursor:pointer;">
                    <div class="row">
                        <input type="checkbox" :checked="selectedExportDatasets.includes($for.item.id)"
                            @change="toggleId('selectedExportDatasets', $for.item.id, $event.target.checked)">
                        <oda-icon icon="icons:archive" icon-size="18"></oda-icon>
                        <div><strong>Обучающий датасет: {{$for.item.id}}.jsonl</strong></div>
                    </div>
                    <span style="font-weight:600;white-space:nowrap;">{{fmtSize($for.item.sizeBytes)}}</span>
                </label>

                <label class="item-row" ~if="inventory.runtime?.present" style="cursor:pointer;">
                    <div class="row">
                        <input type="checkbox" :checked="exportIncludeRuntime"
                            @change="exportIncludeRuntime = $event.target.checked">
                        <oda-icon icon="carbon:chip" icon-size="18"></oda-icon>
                        <div><strong>Рантайм локального ИИ (#runtime: Bubo / ROCm)</strong></div>
                    </div>
                    <span style="font-weight:600;white-space:nowrap;">{{fmtSize(inventory.runtime.sizeBytes)}}</span>
                </label>
            </div>

            <div class="row between" style="margin-top:4px;">
                <label class="row" style="cursor:pointer;font-size:12px;" ~if="transport === 'disk'">
                    <input type="checkbox" :checked="exportOverwrite" @change="exportOverwrite = $event.target.checked">
                    <span>Перезаписывать модели, если они уже есть в папке назначения</span>
                </label>
                <span style="font-size:12.5px;">
                    Итого к переносу: <strong>{{fmtSize(exportSelectedBytes)}}</strong>
                </span>
            </div>

            <div class="msg err" ~if="transport === 'disk' && exportInsufficientSpace">
                Недостаточно свободного места на выбранном диске: нужно {{fmtSize(exportSelectedBytes)}}, свободно {{dirInfo?.freeGb}} ГБ.
            </div>

            <div class="row" style="justify-content:flex-end;margin-top:4px;">
                <button type="button" class="btn primary" ~if="transport === 'disk'"
                    :disabled="!exportSelectedBytes || exportInsufficientSpace || !currentPath"
                    @tap="startExportDisk()">
                    <oda-icon icon="carbon:upload" icon-size="15"></oda-icon>
                    <span>Выгрузить на диск / флешку</span>
                </button>
                <button type="button" class="btn primary" ~if="transport === 'tar'"
                    :disabled="!exportSelectedBytes"
                    @tap="downloadTar()">
                    <oda-icon icon="carbon:download" icon-size="15"></oda-icon>
                    <span>Скачать архивом (.tar)</span>
                </button>
            </div>
        </div>
    </div>

    <!-- РЕЖИМ 2: ЗАГРУЗКА (ИМПОРТ) -->
    <div ~if="mode === 'import' && transport === 'disk'" style="display:flex;flex-direction:column;gap:10px;">
        <div class="card">
            <div class="row between">
                <span class="sec-title">Найденные модели в выбранной папке</span>
                <button type="button" class="btn" @tap="inspectSource(currentPath)">Проверить папку</button>
            </div>

            <div ~if="!sourceInfo" style="opacity:0.75;padding:6px 0;">
                Выберите папку с резервной копией выше.
            </div>

            <div ~if="sourceInfo && !hasAnySourceItem" style="opacity:0.75;padding:6px 0;">
                В «{{sourceInfo.sourceDir}}» не найдено моделей ИИ, адаптеров или датасетов.
            </div>

            <div ~if="sourceInfo && hasAnySourceItem" class="items-list">
                <div class="row" style="font-size:12px;opacity:0.8;padding-bottom:2px;" ~if="sourceInfo.hasManifest">
                    <span>Манифест проверен ({{sourceInfo.sourceHost || 'локальный ПК'}})</span>
                </div>

                <label class="item-row" ~for="sourceInfo.models" style="cursor:pointer;">
                    <div class="row">
                        <input type="checkbox" :checked="selectedImportModels.includes($for.item.id)"
                            @change="toggleId('selectedImportModels', $for.item.id, $event.target.checked)">
                        <oda-icon :icon="$for.item.icon || 'ai:ollama'" icon-size="18"></oda-icon>
                        <div><strong>{{$for.item.label || $for.item.id}}</strong></div>
                        <span class="badge warn" ~if="$for.item.alreadyInstalled">Уже установлена</span>
                        <span class="badge ok" ~if="!$for.item.alreadyInstalled">Новая</span>
                    </div>
                    <span style="font-weight:600;white-space:nowrap;">{{fmtSize($for.item.sizeBytes)}}</span>
                </label>

                <label class="item-row" ~for="sourceInfo.adapters" style="cursor:pointer;">
                    <div class="row">
                        <input type="checkbox" :checked="selectedImportAdapters.includes($for.item.id)"
                            @change="toggleId('selectedImportAdapters', $for.item.id, $event.target.checked)">
                        <oda-icon icon="carbon:chip" icon-size="18"></oda-icon>
                        <div><strong>LoRA-адаптер: {{$for.item.label || $for.item.id}}</strong></div>
                        <span class="badge warn" ~if="$for.item.alreadyInstalled">Уже есть</span>
                    </div>
                    <span style="font-weight:600;white-space:nowrap;">{{fmtSize($for.item.sizeBytes)}}</span>
                </label>

                <label class="item-row" ~for="sourceInfo.datasets" style="cursor:pointer;">
                    <div class="row">
                        <input type="checkbox" :checked="selectedImportDatasets.includes($for.item.id)"
                            @change="toggleId('selectedImportDatasets', $for.item.id, $event.target.checked)">
                        <oda-icon icon="icons:archive" icon-size="18"></oda-icon>
                        <div><strong>Датасет: {{$for.item.id}}.jsonl</strong></div>
                        <span class="badge warn" ~if="$for.item.alreadyInstalled">Уже есть</span>
                    </div>
                    <span style="font-weight:600;white-space:nowrap;">{{fmtSize($for.item.sizeBytes)}}</span>
                </label>

                <label class="item-row" ~if="sourceInfo.runtime?.present" style="cursor:pointer;">
                    <div class="row">
                        <input type="checkbox" :checked="importIncludeRuntime"
                            @change="importIncludeRuntime = $event.target.checked">
                        <oda-icon icon="carbon:chip" icon-size="18"></oda-icon>
                        <div><strong>Рантайм (#runtime: Bubo / ROCm)</strong></div>
                        <span class="badge warn" ~if="sourceInfo.runtime.alreadyInstalled">Уже есть</span>
                    </div>
                    <span style="font-weight:600;white-space:nowrap;">{{fmtSize(sourceInfo.runtime.sizeBytes)}}</span>
                </label>
            </div>

            <div class="row between" style="margin-top:4px;" ~if="sourceInfo && hasAnySourceItem">
                <label class="row" style="cursor:pointer;font-size:12px;">
                    <input type="checkbox" :checked="importOverwrite" @change="importOverwrite = $event.target.checked">
                    <span>Перезаписывать уже установленные модели</span>
                </label>
                <span style="font-size:12.5px;">
                    Будет скопировано: <strong>{{fmtSize(importEffectiveBytes)}}</strong> (своб. {{sourceInfo.localFreeGb}} ГБ)
                </span>
            </div>

            <div class="row" style="justify-content:flex-end;margin-top:4px;" ~if="sourceInfo && hasAnySourceItem">
                <span ~if="importCopyCount === 0 && importHasAnythingToCopy" style="font-size:12px;opacity:0.75;">
                    Все выбранные элементы уже установлены — включите «Перезаписывать» или выберите новые.
                </span>
                <button type="button" class="btn primary" :disabled="importCopyCount === 0"
                    @tap="startImportDisk()">
                    <oda-icon icon="carbon:download" icon-size="15"></oda-icon>
                    <span>Загрузить в /MODELS/Local</span>
                </button>
            </div>
        </div>
    </div>

    <!-- РЕЖИМ 2B: ЗАГРУЗКА .TAR ЧЕРЕЗ БРАУЗЕР -->
    <div ~if="mode === 'import' && transport === 'tar'" class="card">
        <div class="sec-title">Загрузить модели из архива .tar</div>
        <div style="font-size:12.5px;opacity:0.85;">
            Выберите ранее выгруженный файл <code>.tar</code> — сервер распакует его потоком с проверкой манифеста и автоматически зарегистрирует модели в <code>/MODELS/Local</code>.
        </div>
        <div class="row">
            <input id="tarFileInput" type="file" accept=".tar,application/x-tar" @change="onTarFilePicked($event)">
        </div>
        <label class="row" style="cursor:pointer;font-size:12px;">
            <input type="checkbox" :checked="importOverwrite" @change="importOverwrite = $event.target.checked">
            <span>Перезаписывать уже установленные модели</span>
        </label>
        <div class="row" style="justify-content:flex-end;">
            <button type="button" class="btn primary" :disabled="!tarFile || tarUploading" @tap="uploadTar()">
                <oda-icon icon="carbon:upload" icon-size="15"></oda-icon>
                <span>Загрузить .tar в /MODELS/Local</span>
            </button>
        </div>
    </div>
    `,

    $item: null,
    mode: 'export',
    transport: 'disk',
    roots: [],
    dirInfo: null,
    currentPath: '',
    inventory: { models: [], adapters: [], datasets: [], runtime: { present: false } },
    sourceInfo: null,
    jobs: [],

    selectedExportModels: [],
    selectedExportAdapters: [],
    selectedExportDatasets: [],
    exportIncludeRuntime: true,
    exportOverwrite: true,

    selectedImportModels: [],
    selectedImportAdapters: [],
    selectedImportDatasets: [],
    importIncludeRuntime: true,
    importOverwrite: false,

    tarFile: null,
    tarUploading: false,
    tarUploadProgress: 0,

    notice: '',
    error: '',
    onComplete: null,
    _pollTimer: null,
    _hadRunning: false,

    get activeJobs() {
        return (this.jobs || []).filter(j => j.status === 'running');
    },
    get hasAnyExportItem() {
        const inv = this.inventory || {};
        return Boolean((inv.models?.length) || (inv.adapters?.length) || (inv.datasets?.length) || inv.runtime?.present);
    },
    get hasAnySourceItem() {
        const s = this.sourceInfo || {};
        return Boolean((s.models?.length) || (s.adapters?.length) || (s.datasets?.length) || s.runtime?.present);
    },
    get exportSelectedBytes() {
        const inv = this.inventory || {};
        let total = 0;
        for (const m of inv.models || []) {
            if (this.selectedExportModels.includes(m.id))
                total += Number(m.sizeBytes) || 0;
        }
        for (const a of inv.adapters || []) {
            if (this.selectedExportAdapters.includes(a.id))
                total += Number(a.sizeBytes) || 0;
        }
        for (const d of inv.datasets || []) {
            if (this.selectedExportDatasets.includes(d.id))
                total += Number(d.sizeBytes) || 0;
        }
        if (this.exportIncludeRuntime && inv.runtime?.present)
            total += Number(inv.runtime.sizeBytes) || 0;
        return total;
    },
    get exportInsufficientSpace() {
        const free = Number(this.dirInfo?.freeBytes) || 0;
        return free > 0 && this.exportSelectedBytes > 0 && free < (this.exportSelectedBytes + 32 * 1024 * 1024);
    },
    get importEffectiveBytes() {
        const s = this.sourceInfo || {};
        let total = 0;
        for (const m of s.models || []) {
            if (this.selectedImportModels.includes(m.id) && (this.importOverwrite || !m.alreadyInstalled))
                total += Number(m.sizeBytes) || 0;
        }
        for (const a of s.adapters || []) {
            if (this.selectedImportAdapters.includes(a.id) && (this.importOverwrite || !a.alreadyInstalled))
                total += Number(a.sizeBytes) || 0;
        }
        for (const d of s.datasets || []) {
            if (this.selectedImportDatasets.includes(d.id) && (this.importOverwrite || !d.alreadyInstalled))
                total += Number(d.sizeBytes) || 0;
        }
        if (this.importIncludeRuntime && s.runtime?.present && (this.importOverwrite || !s.runtime.alreadyInstalled))
            total += Number(s.runtime.sizeBytes) || 0;
        return total;
    },
    get importCopyCount() {
        const s = this.sourceInfo || {};
        let count = 0;
        for (const m of s.models || []) {
            if (this.selectedImportModels.includes(m.id) && (this.importOverwrite || !m.alreadyInstalled))
                count++;
        }
        for (const a of s.adapters || []) {
            if (this.selectedImportAdapters.includes(a.id) && (this.importOverwrite || !a.alreadyInstalled))
                count++;
        }
        for (const d of s.datasets || []) {
            if (this.selectedImportDatasets.includes(d.id) && (this.importOverwrite || !d.alreadyInstalled))
                count++;
        }
        if (this.importIncludeRuntime && s.runtime?.present && (this.importOverwrite || !s.runtime.alreadyInstalled))
            count++;
        return count;
    },
    get importHasAnythingToCopy() {
        return this.selectedImportModels.length > 0
            || this.selectedImportAdapters.length > 0
            || this.selectedImportDatasets.length > 0
            || (this.importIncludeRuntime && this.sourceInfo?.runtime?.present);
    },

    fmtSize(b) { return fmtGb(b); },
    fmtTime(s) { return fmtEta(s); },
    isRootSelected(rootPath) {
        if (!rootPath || !this.currentPath)
            return false;
        const a = String(rootPath).replace(/[\\/]+$/, '').toLowerCase();
        const b = String(this.currentPath).replace(/[\\/]+$/, '').toLowerCase();
        return b === a || b.startsWith(a + '\\') || b.startsWith(a + '/');
    },

    async _call(method, params = {}, post = undefined) {
        this.error = '';
        if (!this.$item)
            return null;
        try {
            return await this.$item.fetch(method, params, post);
        }
        catch (e) {
            this.error = String(e?.message || e);
            return null;
        }
    },

    async attached() {
        await Promise.all([
            this.loadInventory(),
            this.loadRootsAndBrowse(),
            this.refreshJobs(),
        ]);
        this._pollTimer = setInterval(() => {
            if (this.activeJobs.length || this._hadRunning)
                this.refreshJobs();
        }, 800);
    },
    detached() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },

    async switchMode(m) {
        this.mode = m;
        this.error = '';
        this.notice = '';
        if (m === 'import' && this.currentPath && this.transport === 'disk') {
            await this.inspectSource(this.currentPath);
        }
    },

    async loadInventory() {
        const inv = await this._call('trainer_transfer_inventory');
        if (!inv)
            return;
        this.inventory = inv;
        this.selectAllExport(true);
    },

    selectAllExport(on) {
        const inv = this.inventory || {};
        if (on) {
            this.selectedExportModels = (inv.models || []).map(m => m.id);
            this.selectedExportAdapters = (inv.adapters || []).map(a => a.id);
            this.selectedExportDatasets = (inv.datasets || []).map(d => d.id);
            this.exportIncludeRuntime = Boolean(inv.runtime?.present);
        }
        else {
            this.selectedExportModels = [];
            this.selectedExportAdapters = [];
            this.selectedExportDatasets = [];
            this.exportIncludeRuntime = false;
        }
    },

    toggleId(listProp, id, checked) {
        const set = new Set(this[listProp] || []);
        if (checked)
            set.add(id);
        else
            set.delete(id);
        this[listProp] = [...set];
    },

    async loadRootsAndBrowse() {
        const r = await this._call('trainer_transfer_roots');
        if (r?.roots)
            this.roots = r.roots;
        await this.openDir('');
    },

    async openDir(targetPath) {
        const info = await this._call('trainer_transfer_browse', targetPath ? { path: targetPath } : {});
        if (!info)
            return;
        this.dirInfo = info;
        this.currentPath = info.path;
        if (this.mode === 'import' && info.hasBackup) {
            await this.inspectSource(info.path);
        }
        else if (this.mode === 'import') {
            this.sourceInfo = null;
        }
    },

    async promptNewFolder() {
        if (!this.currentPath)
            return;
        let name = '';
        try {
            name = await WORK.showPrompt('Имя новой папки', { placeholder: 'WORK-Models-Backup' });
        }
        catch {
            return;
        }
        if (!name)
            return;
        const info = await this._call('trainer_transfer_mkdir', {}, { parentPath: this.currentPath, name });
        if (info) {
            this.dirInfo = info;
            this.currentPath = info.path;
            this.notice = `Создана папка «${info.path}»`;
        }
    },

    async inspectSource(sourcePath) {
        if (!sourcePath)
            return;
        const info = await this._call('trainer_transfer_inspect', { sourceDir: sourcePath });
        if (!info)
            return;
        this.sourceInfo = info;
        this.selectedImportModels = (info.models || []).map(m => m.id);
        this.selectedImportAdapters = (info.adapters || []).map(a => a.id);
        this.selectedImportDatasets = (info.datasets || []).map(d => d.id);
        this.importIncludeRuntime = Boolean(info.runtime?.present);
    },

    async startExportDisk() {
        this.notice = '';
        const job = await this._call('trainer_transfer_export', {}, {
            targetDir: this.currentPath,
            modelIds: this.selectedExportModels,
            adapterIds: this.selectedExportAdapters,
            datasetIds: this.selectedExportDatasets,
            includeRuntime: this.exportIncludeRuntime,
            overwrite: this.exportOverwrite,
        });
        if (job) {
            this._hadRunning = true;
            this.notice = `Запущена выгрузка в «${this.currentPath}»…`;
            await this.refreshJobs();
        }
    },

    async startImportDisk() {
        this.notice = '';
        const job = await this._call('trainer_transfer_import', {}, {
            sourceDir: this.currentPath,
            modelIds: this.selectedImportModels,
            adapterIds: this.selectedImportAdapters,
            datasetIds: this.selectedImportDatasets,
            includeRuntime: this.importIncludeRuntime,
            overwrite: this.importOverwrite,
        });
        if (job) {
            this._hadRunning = true;
            this.notice = `Запущена загрузка моделей из «${this.currentPath}»…`;
            await this.refreshJobs();
        }
    },

    async cancelJob(jobId) {
        await this._call('trainer_transfer_cancel', {}, { jobId });
        await this.refreshJobs();
    },

    async refreshJobs() {
        const res = await this._call('trainer_transfer_status');
        if (!res?.jobs)
            return;
        this.jobs = res.jobs;
        const stillRunning = this.activeJobs.length > 0;
        if (this._hadRunning && !stillRunning) {
            this._hadRunning = false;
            const latest = this.jobs[0];
            if (latest?.status === 'completed') {
                this.notice = latest.type?.startsWith('import')
                    ? `Готово: загружено моделей — ${latest.imported?.models?.length || 0}, пропущено — ${latest.skipped?.length || 0}.`
                    : `Готово: выгружено моделей — ${latest.exported?.models?.length || 0} в «${latest.targetDir}».`;
                await this.loadInventory();
                if (this.dirInfo?.path)
                    await this.openDir(this.dirInfo.path);
                await this.onComplete?.(latest);
            }
            else if (latest?.status === 'failed') {
                this.error = latest.error || 'Ошибка переноса моделей';
            }
            else if (latest?.status === 'cancelled') {
                this.notice = 'Перенос моделей отменён.';
            }
        }
    },

    downloadTar() {
        if (!this.$item)
            return;
        const params = new URLSearchParams();
        params.set('modelIds', this.selectedExportModels.join(','));
        params.set('adapterIds', this.selectedExportAdapters.join(','));
        params.set('datasetIds', this.selectedExportDatasets.join(','));
        params.set('includeRuntime', String(Boolean(this.exportIncludeRuntime)));
        const base = encodeURI(this.$item.short || '/MODELS/Local');
        const link = document.createElement('a');
        link.href = `${base}?trainer_transfer_export_tar&${params.toString()}`;
        link.download = 'work-local-models.tar';
        document.body.appendChild(link);
        link.click();
        link.remove();
        this.notice = 'Начато скачивание архива .tar через браузер…';
    },

    onTarFilePicked(e) {
        this.tarFile = e?.target?.files?.[0] || null;
    },

    async uploadTar() {
        if (!this.tarFile || !this.$item)
            return;
        this.error = '';
        this.notice = '';
        this.tarUploading = true;
        this.tarUploadProgress = 0;

        try {
            const url = encodeURI(this.$item.short || '/MODELS/Local')
                + `?trainer_transfer_import_tar&overwrite=${this.importOverwrite ? 'true' : 'false'}`;
            const result = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', url, true);
                xhr.setRequestHeader('X-WORK-WSID', WORK.wsid || '');
                xhr.setRequestHeader('Content-Type', 'application/x-tar');
                xhr.upload.onprogress = (ev) => {
                    if (ev.lengthComputable && ev.total > 0)
                        this.tarUploadProgress = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
                };
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try { resolve(JSON.parse(xhr.responseText || '{}')); }
                        catch { resolve({ status: 'completed' }); }
                    }
                    else {
                        reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
                    }
                };
                xhr.onerror = () => reject(new Error('Сетевая ошибка при отправке .tar'));
                xhr.send(this.tarFile);
            });
            this.tarUploadProgress = 100;
            this.notice = `Архив .tar установлен: загружено моделей — ${result.imported?.models?.length || 0}, пропущено — ${result.skipped?.length || 0}.`;
            await this.loadInventory();
            await this.onComplete?.(result);
        }
        catch (err) {
            this.error = String(err?.message || err);
        }
        finally {
            this.tarUploading = false;
        }
    },
});

/**
 * Открыть единый системный диалог выгрузки и загрузки локальных моделей (/MODELS/Local).
 */
export async function openLocalModelsTransferDialog($item, { mode = 'export', onComplete = null } = {}) {
    await customElements.whenDefined('item-local-models-transfer');
    const targetItem = $item || await WORK.get_item('/MODELS/Local');
    const el = ODA.createElement('item-local-models-transfer', {
        $item: targetItem,
        mode,
        onComplete,
    });
    try {
        await WORK.showDialog(el, {
            allowClose: true,
            width: 820,
            TITLE: { label: 'Выгрузка и загрузка моделей (/MODELS/Local)', icon: 'carbon:usb' },
            OK: null,
            CANCEL: { label: 'Закрыть', icon: 'icons:close', colorMode: 'info' },
        });
    }
    catch (err) {
        if (!(err instanceof ODA.CancelError))
            throw err;
    }
}
