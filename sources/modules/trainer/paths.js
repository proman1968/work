/**
 * Канонические пути подсистемы локальных моделей ИИ (правило метапапок WORK / ODANT):
 * - Всё, что относится к провайдеру `/MODELS/Local`, живёт внутри его метапапки `MODELS/Local/$provider/`:
 *   - `#datasets/`  — собранные обучающие наборы (.jsonl)
 *   - `#adapters/`  — обученные LoRA-адаптеры
 *   - `#runtime/`   — нативные рантаймы (bubo, gufo, strata, ROCm)
 *   - `#cache/`     — дисковый кэш инференса
 *   - `#tmp/`       — временная область распаковки импорта
 * - Дети `/MODELS/Local` — только папки конкретных моделей `MODELS/Local/<Модель>/`,
 *   а всё относящееся к модели (включая `#weights` и активные `.part`-загрузки с `download-state.json`)
 *   лежит строго внутри её метапапки `MODELS/Local/<Модель>/$ai/#weights/`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WEIGHT_FILE_EXT_RE = /\.(gguf|safetensors|hgn|hnpw|bin|onnx|pt|pth)$/i;
export const LINUX_ONLY_HALOGEN_EXT_RE = /\.(hgn|hnpw)$/i;
export const WEIGHT_SIDECAR_SUBDIRS = Object.freeze(['mtp', 'mmproj', 'twin', 'draft_head']);

function collectWeightDirRawEntriesSync(dirPath) {
    const out = [];
    const rootEntries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const ent of rootEntries) {
        if (ent.isFile()) {
            out.push(ent.name);
        }
        else if (ent.isDirectory() && WEIGHT_SIDECAR_SUBDIRS.includes(ent.name)) {
            try {
                const subEntries = fs.readdirSync(path.join(dirPath, ent.name), { withFileTypes: true });
                for (const sub of subEntries) {
                    if (sub.isFile())
                        out.push(`${ent.name}/${sub.name}`);
                }
            }
            catch { /* ignore */ }
        }
    }
    return out;
}

export function localRootDir(rootDir = process.cwd()) {
    return path.join(rootDir, 'MODELS', 'Local');
}

export function localProviderMetaDir(rootDir = process.cwd()) {
    return path.join(localRootDir(rootDir), '$provider');
}

export function localDatasetsDir(rootDir = process.cwd()) {
    return path.join(localProviderMetaDir(rootDir), '#datasets');
}

export function localAdaptersDir(rootDir = process.cwd()) {
    return path.join(localProviderMetaDir(rootDir), '#adapters');
}

export function localRuntimeDir(rootDir = process.cwd()) {
    return path.join(localProviderMetaDir(rootDir), '#runtime');
}

export function localCacheDir(rootDir = process.cwd()) {
    return path.join(localProviderMetaDir(rootDir), '#cache');
}

export function localTempDir(rootDir = process.cwd()) {
    return path.join(localProviderMetaDir(rootDir), '#tmp');
}

export function modelDir(rootDir = process.cwd(), folderName, providerFolder = 'Local') {
    return path.join(rootDir, 'MODELS', String(providerFolder || 'Local'), String(folderName || ''));
}

export function modelMetaDir(rootDir = process.cwd(), folderName, providerFolder = 'Local') {
    return path.join(modelDir(rootDir, folderName, providerFolder), '$ai');
}

export function modelWeightsDir(rootDir = process.cwd(), folderName, providerFolder = 'Local') {
    return path.join(modelMetaDir(rootDir, folderName, providerFolder), '#weights');
}

export function modelClassFile(rootDir = process.cwd(), folderName, providerFolder = 'Local') {
    return path.join(modelMetaDir(rootDir, folderName, providerFolder), 'class.js');
}

/**
 * Проверить, есть ли в директории готовые файлы весов (не .part).
 */
export function hasReadyWeightFilesSync(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath))
        return false;
    try {
        return collectWeightDirRawEntriesSync(dirPath).some(f => !f.endsWith('.part') && WEIGHT_FILE_EXT_RE.test(f));
    }
    catch {
        return false;
    }
}

/**
 * Детально проинспектировать директорию весов модели: формат, готовность и совместимость с текущей ОС.
 */
export function inspectWeightsDirectorySync(dirPath, platform = os.platform()) {
    const empty = {
        exists: false,
        pendingDownload: false,
        hasReadyWeights: false,
        weightFormat: '',
        files: [],
        hasSafetensors: false,
        hasGguf: false,
        hasBuboManifest: false,
        hasHgn: false,
        hasHnpw: false,
        hasConfig: false,
        hasTokenizer: false,
        incompatibleOnPlatform: false,
        incompatibleReason: '',
    };
    if (!dirPath || !fs.existsSync(dirPath))
        return empty;
    try {
        const raw = collectWeightDirRawEntriesSync(dirPath);
        const hasParts = raw.some(f => f.endsWith('.part'));
        let pendingState = false;
        if (raw.includes('download-state.json')) {
            try {
                const st = JSON.parse(fs.readFileSync(path.join(dirPath, 'download-state.json'), 'utf-8'));
                pendingState = st?.status !== 'completed';
            }
            catch {
                pendingState = true;
            }
        }
        const files = raw.filter(f =>
            !f.endsWith('.part')
            && !f.endsWith('.tmp')
            && f !== 'hf-manifest.json'
            && f !== 'download-state.json'
        );
        const hasSafetensors = files.some(f => f.toLowerCase().endsWith('.safetensors'));
        const hasGguf = files.some(f => f.toLowerCase().endsWith('.gguf'));
        const hasBuboManifest = files.includes('bubo-package.json');
        const hasHgn = files.some(f => f.toLowerCase().endsWith('.hgn'));
        const hasHnpw = files.some(f => f.toLowerCase().endsWith('.hnpw'));
        const hasOther = files.some(f => /\.(bin|onnx|pt|pth)$/i.test(f));
        const hasConfig = files.includes('config.json');
        const hasTokenizer = files.includes('tokenizer.json');
        const pendingDownload = hasParts || pendingState;
        const hasReadyWeights = !pendingDownload && (hasSafetensors || hasGguf || hasBuboManifest || hasHgn || hasHnpw || hasOther);

        let weightFormat = '';
        if (hasBuboManifest)
            weightFormat = 'bubo';
        else if (hasGguf)
            weightFormat = 'gguf';
        else if (hasSafetensors)
            weightFormat = 'safetensors';
        else if (hasHgn)
            weightFormat = 'hgn';
        else if (hasHnpw)
            weightFormat = 'hnpw';
        else if (hasOther)
            weightFormat = 'other';

        const isWin = platform === 'win32';
        const incompatibleOnPlatform = isWin && (hasHgn || hasHnpw) && !hasGguf && !hasBuboManifest;
        const incompatibleReason = incompatibleOnPlatform
            ? 'Скачаны веса формата Linux (.hgn/.hnpw), несовместимые с Windows. Удалите их и установите Windows-версию (GGUF / .safetensors).'
            : '';

        return {
            exists: true,
            pendingDownload,
            hasReadyWeights,
            weightFormat,
            files,
            hasSafetensors,
            hasGguf,
            hasBuboManifest,
            hasHgn,
            hasHnpw,
            hasConfig,
            hasTokenizer,
            incompatibleOnPlatform,
            incompatibleReason,
        };
    }
    catch {
        return empty;
    }
}

/**
 * Узнать объём свободного места (в ГБ) на диске, содержащем `targetPath`.
 */
export function getFreeDiskSpaceGb(targetPath = process.cwd()) {
    try {
        let probe = path.resolve(targetPath);
        while (!fs.existsSync(probe)) {
            const parent = path.dirname(probe);
            if (!parent || parent === probe)
                break;
            probe = parent;
        }
        if (typeof fs.statfsSync === 'function' && fs.existsSync(probe)) {
            const st = fs.statfsSync(probe);
            const freeBytes = Number(st.bavail || st.bfree || 0) * Number(st.bsize || 0);
            if (freeBytes > 0)
                return +(freeBytes / (1024 ** 3)).toFixed(1);
        }
    }
    catch { /* ignore */ }
    return null;
}

/**
 * Безопасно перенести/слить старую папку `src` в `dest` без потери файлов.
 * На одном томе использует мгновенный `renameSync`; при занятых файлах (`EBUSY`) не падает.
 */
export function mergeMoveDirSync(srcDir, destDir) {
    if (!srcDir || !fs.existsSync(srcDir))
        return false;
    if (path.resolve(srcDir) === path.resolve(destDir))
        return true;

    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    if (!fs.existsSync(destDir)) {
        try {
            fs.renameSync(srcDir, destDir);
            return true;
        }
        catch { /* слияние по файлам ниже */ }
    }

    fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const e of entries) {
        const srcEntry = path.join(srcDir, e.name);
        const destEntry = path.join(destDir, e.name);
        try {
            if (e.isDirectory()) {
                mergeMoveDirSync(srcEntry, destEntry);
            }
            else if (e.isFile()) {
                if (!fs.existsSync(destEntry)) {
                    try {
                        fs.renameSync(srcEntry, destEntry);
                    }
                    catch {
                        fs.copyFileSync(srcEntry, destEntry);
                        fs.unlinkSync(srcEntry);
                    }
                }
                else {
                    // Если в цели уже есть файл — для download-state.json берём более свежий, иначе удаляем старый дубль только если целевой >= по размеру
                    const srcSt = fs.statSync(srcEntry);
                    const dstSt = fs.statSync(destEntry);
                    if (e.name === 'download-state.json' ? srcSt.mtimeMs > dstSt.mtimeMs : srcSt.size > dstSt.size) {
                        fs.rmSync(destEntry, { force: true });
                        try {
                            fs.renameSync(srcEntry, destEntry);
                        }
                        catch {
                            fs.copyFileSync(srcEntry, destEntry);
                            fs.unlinkSync(srcEntry);
                        }
                    }
                }
            }
        }
        catch { /* занятый файл другого процесса — оставим до следующего прохода */ }
    }

    try {
        if (!fs.readdirSync(srcDir).length)
            fs.rmdirSync(srcDir);
    }
    catch { /* папка не пуста или занята */ }
    return true;
}

/**
 * Разовая/идемпотентная миграция старой раскладки `MODELS/Local`:
 * - `#datasets`, `#adapters`, `#runtime`, `#cache` → `MODELS/Local/$provider/#...`;
 * - `#downloads/<Модель>` → `MODELS/Local/<Модель>/$ai/#weights/`;
 * - `MODELS/Local/<Модель>/#weights/` → `MODELS/Local/<Модель>/$ai/#weights/`.
 */
export function migrateLocalModelsLayoutSync(rootDir = process.cwd(), { skipModels = null } = {}) {
    const localRoot = localRootDir(rootDir);
    if (!fs.existsSync(localRoot))
        return;

    const providerMeta = localProviderMetaDir(rootDir);

    // 1. Служебные папки провайдера Local переносим в $provider/
    for (const dirName of ['#datasets', '#adapters', '#runtime', '#cache']) {
        const legacy = path.join(localRoot, dirName);
        if (fs.existsSync(legacy))
            mergeMoveDirSync(legacy, path.join(providerMeta, dirName));
    }

    // 2. Старая папка #downloads/<Модель> переносится в <Модель>/$ai/#weights
    const legacyDownloads = path.join(localRoot, '#downloads');
    if (fs.existsSync(legacyDownloads)) {
        try {
            const dlEntries = fs.readdirSync(legacyDownloads, { withFileTypes: true });
            for (const e of dlEntries) {
                if (!e.isDirectory() || e.name.startsWith('.'))
                    continue;
                if (e.name.startsWith('_import_') || e.name.startsWith('_tar_import_')) {
                    mergeMoveDirSync(path.join(legacyDownloads, e.name), path.join(localTempDir(rootDir), e.name));
                    continue;
                }
                if (skipModels && skipModels.has(e.name))
                    continue;
                const src = path.join(legacyDownloads, e.name);
                const dstWeights = modelWeightsDir(rootDir, e.name);
                mergeMoveDirSync(src, dstWeights);

                // Если $ai/class.js ещё нет, но в download-state.json сохранены метаданные — создадим неактивный узел $ai
                const aiClass = modelClassFile(rootDir, e.name);
                const stateFile = path.join(dstWeights, 'download-state.json');
                if (!fs.existsSync(aiClass) && fs.existsSync(stateFile)) {
                    try {
                        const st = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) || {};
                        const meta = {
                            label: st.label || e.name,
                            icon: st.nodeMeta?.icon || 'ai:ollama',
                            protocol: st.nodeMeta?.protocol || 'local',
                            baseUrl: st.nodeMeta?.baseUrl || 'http://127.0.0.1:8731/v1/chat/completions',
                            model: st.nodeMeta?.model || st.repoId || e.name,
                            modality: st.modality || st.nodeMeta?.modality || 'llm',
                            maxTokens: Number(st.nodeMeta?.maxTokens) || 16384,
                            maxOutput: Number(st.nodeMeta?.maxOutput) || 8192,
                            capabilities: Array.isArray(st.capabilities) ? st.capabilities : ['chat', 'stream'],
                            hfRepo: st.repoId || '',
                            weightsDir: path.relative(rootDir, dstWeights).replace(/\\/g, '/'),
                        };
                        fs.mkdirSync(path.dirname(aiClass), { recursive: true });
                        fs.writeFileSync(aiClass, `/**\n * Локальная модель ИИ: ${meta.label}\n */\nexport default ${JSON.stringify(meta, null, 4)};\n`, 'utf-8');
                    }
                    catch { /* ignore */ }
                }
            }
            try {
                if (!fs.readdirSync(legacyDownloads).length)
                    fs.rmdirSync(legacyDownloads);
            }
            catch { /* ignore */ }
        }
        catch { /* ignore */ }
    }

    // 2.5. Перенос весов из ошибочной папки v1.0.32 `MODELS/Local/models/qwen38-*` в `MODELS/Local/Qwen3.8-Flash-Next/$ai/#weights`
    const legacyModelsDir = path.join(localRoot, 'models');
    if (fs.existsSync(legacyModelsDir) && !(skipModels && skipModels.has('Qwen3.8-Flash-Next'))) {
        try {
            const flashWeightsDir = modelWeightsDir(rootDir, 'Qwen3.8-Flash-Next');
            for (const pkgName of ['qwen38-flash-next-base-ud-q4-k-xl-v1', 'huihui-qwen38-flash-next-ud-q4-k-xl-v1']) {
                const pkgDir = path.join(legacyModelsDir, pkgName);
                if (fs.existsSync(pkgDir))
                    mergeMoveDirSync(pkgDir, flashWeightsDir);
            }
            if (fs.existsSync(legacyModelsDir) && !fs.readdirSync(legacyModelsDir).length)
                fs.rmdirSync(legacyModelsDir);
        }
        catch { /* ignore */ }
    }

    // 3. Папки моделей со старым #weights на уровне модели (рядом с $ai) переносим в $ai/#weights и чиним пути в class.js
    try {
        const entries = fs.readdirSync(localRoot, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('$') || e.name.startsWith('#') || e.name === 'models')
                continue;
            if (skipModels && skipModels.has(e.name))
                continue;
            const mDir = path.join(localRoot, e.name);
            const legacyWeights = path.join(mDir, '#weights');
            const newWeights = modelWeightsDir(rootDir, e.name);
            if (fs.existsSync(legacyWeights))
                mergeMoveDirSync(legacyWeights, newWeights);

            const classFile = modelClassFile(rootDir, e.name);
            if (fs.existsSync(classFile)) {
                try {
                    const raw = fs.readFileSync(classFile, 'utf-8');
                    const jsonPart = raw.replace(/^[^{]*/, '').replace(/;\s*$/, '');
                    const meta = JSON.parse(jsonPart);
                    let changed = false;
                    const expectedWeightsRel = path.relative(rootDir, newWeights).replace(/\\/g, '/');
                    if (meta.weightsDir && meta.weightsDir !== expectedWeightsRel && fs.existsSync(newWeights)) {
                        meta.weightsDir = expectedWeightsRel;
                        changed = true;
                    }
                    if (meta.primaryFile === 'bubo-package.json' && fs.existsSync(newWeights)) {
                        const wFiles = collectWeightDirRawEntriesSync(newWeights);
                        const primaryGguf = wFiles
                            .filter(f => f.toLowerCase().endsWith('.gguf') && !f.endsWith('.part') && !/^(mtp|mmproj|twin|draft|iq4-nofullattn)/i.test(path.basename(f)))
                            .sort((a, b) => (/-00001-of-/i.test(a) ? -1 : /-00001-of-/i.test(b) ? 1 : a.localeCompare(b)))[0];
                        if (primaryGguf) {
                            meta.primaryFile = path.basename(primaryGguf);
                            changed = true;
                        }
                    }
                    if (meta.adapterPath && !meta.adapterPath.includes('/$provider/#adapters/')) {
                        const adName = path.basename(String(meta.adapterPath));
                        const newAdPath = path.join(localAdaptersDir(rootDir), adName);
                        if (fs.existsSync(newAdPath)) {
                            meta.adapterPath = path.relative(rootDir, newAdPath).replace(/\\/g, '/');
                            changed = true;
                        }
                    }
                    if (changed) {
                        fs.writeFileSync(classFile, `/**\n * Локальная модель ИИ: ${meta.label || e.name}\n */\nexport default ${JSON.stringify(meta, null, 4)};\n`, 'utf-8');
                    }
                }
                catch { /* ignore non-json */ }
            }
        }
    }
    catch { /* ignore */ }
}
