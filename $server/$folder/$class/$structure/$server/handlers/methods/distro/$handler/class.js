/**
 * Создание (сохранение) автономного дистрибутива («функционального клона»)
 * прямо из работающей и настроенной системы WORK (доступно BOSS корневого сервера).
 */
function formatBytes(bytes = 0) {
    const b = Number(bytes) || 0;
    if (b >= 1024 * 1024 * 1024)
        return `${(b / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
    if (b >= 1024 * 1024)
        return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
    if (b >= 1024)
        return `${Math.round(b / 1024)} КБ`;
    return `${b} Б`;
}

export default {
    icon: 'icons:archive',
    label: 'Создать дистрибутив…',
    roles: ['BOSS'],
    order: 5,
    async execute() {
        let info = null;
        try {
            info = await WORK.fetch('/', 'distro_info');
        }
        catch (e) {
            ODA.showError?.(e?.message || e);
            return;
        }
        const models = Array.isArray(info?.models) ? info.models : [];
        const dlg = ODA.createElement('work-distro-dialog', {
            info,
            models,
            selectedModels: models.map(m => m.id),
            includeNodeModules: Boolean(info?.hasNodeModules),
            includeModels: models.length > 0,
            includeVenv: Boolean(info?.hasVenv),
            targetDir: info?.defaultTargetDir || '../odant-work-distro',
            targetZipPath: info?.defaultZipPath || '../odant-work-distro.zip',
            mode: 'folder',
        });

        const res = await WORK.showDialog(dlg, {
            $item: this,
            TITLE: { label: 'Создать дистрибутив (функциональный клон WORK)' },
            OK: { label: 'Создать дистрибутив', icon: 'icons:check', result: 'ok', infoInvert: true },
        });
        if (res !== 'ok')
            return;

        const payload = {
            mode: dlg.mode,
            includeNodeModules: dlg.includeNodeModules,
            includeModels: dlg.includeModels,
            includeVenv: dlg.includeVenv,
            selectedModels: dlg.selectedModels,
            targetDir: dlg.targetDir,
            targetPath: dlg.targetZipPath,
        };

        if (dlg.mode === 'zip') {
            const qs = new URLSearchParams({
                mode: 'zip',
                includeNodeModules: String(Boolean(dlg.includeNodeModules)),
                includeModels: String(Boolean(dlg.includeModels)),
                includeVenv: String(Boolean(dlg.includeVenv)),
            });
            if (Array.isArray(dlg.selectedModels) && dlg.selectedModels.length)
                qs.set('selectedModels', dlg.selectedModels.join(','));
            const link = document.createElement('a');
            link.href = `/?export_distro&${qs.toString()}`;
            link.download = 'odant-work-distro.zip';
            document.body.appendChild(link);
            link.click();
            link.remove();
            return { ok: true, mode: 'zip' };
        }

        try {
            const report = await WORK.fetch('/', 'export_distro', {}, payload);
            const msg = report?.mode === 'folder'
                ? `Дистрибутив сохранён в папку:\n${report.targetDir}\nФайлов: ${report.filesCount} (hardlink весов: ${report.hardlinkedCount || 0}), объём: ${formatBytes(report.totalBytes)}`
                : `ZIP-дистрибутив сохранён:\n${report?.targetPath}\nОбъём: ${formatBytes(report?.totalBytes)}`;
            if (typeof WORK?.showConfirm === 'function')
                await WORK.showConfirm(msg, { TITLE: { label: 'Дистрибутив готов' } });
            else
                ODA.showMessage?.(msg);
            return report;
        }
        catch (e) {
            ODA.showError?.(e?.message || e);
        }
    },
};

ODA({
    is: 'work-distro-dialog',
    imports: '/oda//icon.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: 10px;
                padding: 12px 16px;
                min-width: 460px;
                max-width: 580px;
            }
            .note {
                padding: 8px 10px;
                border-radius: 8px;
                background: var(--subtle-background);
                border: 1px solid var(--border-color);
                font-size: 12.5px;
                line-height: 1.35;
            }
            .section {
                @apply --vertical;
                gap: 6px;
                padding: 8px 10px;
                border: 1px solid var(--border-color);
                border-radius: 8px;
            }
            .sec-title {
                font-size: 12px;
                font-weight: 700;
                opacity: 0.78;
                text-transform: uppercase;
            }
            label.row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                cursor: pointer;
                user-select: none;
            }
            .badge {
                margin-left: auto;
                font-size: 11.5px;
                font-family: monospace;
                padding: 2px 6px;
                border-radius: 6px;
                background: var(--subtle-background);
            }
            .models-sub {
                @apply --vertical;
                gap: 4px;
                margin-left: 22px;
                padding-left: 8px;
                border-left: 2px solid var(--border-color);
            }
            .mode-card {
                @apply --horizontal;
                align-items: flex-start;
                gap: 8px;
                padding: 7px 9px;
                border-radius: 8px;
                border: 1px solid var(--border-color);
                cursor: pointer;
            }
            .mode-card[active] {
                border-color: var(--accent-color);
                background: var(--accent-soft);
            }
            .path-input {
                width: 100%;
                box-sizing: border-box;
                padding: 6px 8px;
                border-radius: 6px;
                border: 1px solid var(--border-color);
                background: var(--content-background);
                color: var(--content-color);
                font-family: monospace;
                font-size: 12.5px;
            }
        </style>
        <div class="note">
            В дистрибутив упаковываются ядро, UI, эталонные модули (<b>/MODULES</b>), сервисы и выбранные модели ИИ со стартовыми скриптами <b>start.cmd / start.sh</b>.<br>
            Организации, проекты, пользователи, базы данных, логи и ключи/секреты сервера автоматически исключаются.
        </div>

        <div class="section">
            <div class="sec-title">Состав дистрибутива (итого ~{{totalSizeText}})</div>
            <label class="row">
                <input type="checkbox" checked disabled>
                <span>Ядро WORK, UI, модули (/MODULES) и документация</span>
                <span class="badge">{{coreSizeText}}</span>
            </label>
            <label class="row" ~if="info?.hasNodeModules">
                <input type="checkbox" :checked="includeNodeModules" @change="includeNodeModules = $event.target.checked">
                <span>Зависимости node_modules (100% офлайн-установка без npm)</span>
                <span class="badge">{{nmSizeText}}</span>
            </label>
            <label class="row" ~if="models?.length">
                <input type="checkbox" :checked="includeModels" @change="includeModels = $event.target.checked">
                <span>Локальные модели ИИ и веса (/MODELS/Local, /MODELS/Halogen)</span>
                <span class="badge">{{modelsSizeText}}</span>
            </label>
            <div class="models-sub" ~if="includeModels && models?.length">
                <label class="row" ~for="models" style="font-size:12px;">
                    <input type="checkbox" :checked="selectedModels.includes($for.item.id)" @change="_toggleModel($for.item.id, $event)">
                    <span>{{$for.item.name}}</span>
                    <span class="badge">{{_fmt($for.item.bytes)}}</span>
                </label>
            </div>
            <label class="row" ~if="info?.hasVenv">
                <input type="checkbox" :checked="includeVenv" @change="includeVenv = $event.target.checked">
                <span>Локальный Python-движок инференса (.venv)</span>
                <span class="badge">{{venvSizeText}}</span>
            </label>
        </div>

        <div class="section">
            <div class="sec-title">Способ сохранения</div>
            <label class="mode-card" :active="mode === 'folder'" @tap="mode = 'folder'">
                <input type="radio" name="distroMode" :checked="mode === 'folder'" style="margin-top:3px;">
                <div class="vertical" style="gap:3px;flex:1;">
                    <span style="font-size:13px;font-weight:600;">1. Сохранить готовую папку-клон на диске сервера (Рекомендуется)</span>
                    <span style="font-size:11.5px;opacity:0.78;">Тяжёлые веса моделей (.safetensors / .gguf) на том же диске клонируются мгновенно через hardlink без сжатия и дублирования места.</span>
                    <input ~if="mode === 'folder'" class="path-input" :value="targetDir" @input="targetDir = $event.target.value" @tap.stop placeholder="Путь к папке дистрибутива">
                </div>
            </label>
            <label class="mode-card" :active="mode === 'zip-file'" @tap="mode = 'zip-file'">
                <input type="radio" name="distroMode" :checked="mode === 'zip-file'" style="margin-top:3px;">
                <div class="vertical" style="gap:3px;flex:1;">
                    <span style="font-size:13px;font-weight:600;">2. Сохранить ZIP64-архив на диске сервера</span>
                    <span style="font-size:11.5px;opacity:0.78;">Потоковый ZIP64: веса моделей записываются методом STORE (без сжатия), исходный код сжимается DEFLATE.</span>
                    <input ~if="mode === 'zip-file'" class="path-input" :value="targetZipPath" @input="targetZipPath = $event.target.value" @tap.stop placeholder="Путь к .zip файлу">
                </div>
            </label>
            <label class="mode-card" :active="mode === 'zip'" @tap="mode = 'zip'">
                <input type="radio" name="distroMode" :checked="mode === 'zip'" style="margin-top:3px;">
                <div class="vertical" style="gap:3px;flex:1;">
                    <span style="font-size:13px;font-weight:600;">3. Скачать ZIP64-архив через браузер</span>
                    <span style="font-size:11.5px;opacity:0.78;">Прямая потоковая отдача odant-work-distro.zip в браузер.</span>
                </div>
            </label>
        </div>
    `,
    info: null,
    models: [],
    selectedModels: [],
    includeNodeModules: true,
    includeModels: true,
    includeVenv: false,
    mode: 'folder',
    targetDir: '',
    targetZipPath: '',
    _fmt(b) {
        return formatBytes(b);
    },
    _toggleModel(id, e) {
        const set = new Set(this.selectedModels || []);
        if (e?.target?.checked)
            set.add(id);
        else
            set.delete(id);
        this.selectedModels = [...set];
    },
    get coreSizeText() {
        return formatBytes(this.info?.coreBytes || 0);
    },
    get nmSizeText() {
        return formatBytes(this.info?.nodeModulesBytes || 0);
    },
    get modelsSizeText() {
        const sel = new Set(this.selectedModels || []);
        const sum = (this.models || []).filter(m => sel.has(m.id)).reduce((acc, m) => acc + (m.bytes || 0), 0);
        return formatBytes(sum);
    },
    get venvSizeText() {
        return formatBytes(this.info?.venvBytes || 0);
    },
    get totalSizeText() {
        let total = Number(this.info?.coreBytes) || 0;
        if (this.includeNodeModules)
            total += Number(this.info?.nodeModulesBytes) || 0;
        if (this.includeModels) {
            const sel = new Set(this.selectedModels || []);
            total += (this.models || []).filter(m => sel.has(m.id)).reduce((acc, m) => acc + (m.bytes || 0), 0);
        }
        if (this.includeVenv)
            total += Number(this.info?.venvBytes) || 0;
        return formatBytes(total);
    },
});
