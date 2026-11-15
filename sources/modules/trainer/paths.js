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
import path from 'node:path';

export const WEIGHT_FILE_EXT_RE = /\.(gguf|safetensors|hgn|hnpw|bin|onnx|pt|pth)$/i;

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
        return fs.readdirSync(dirPath).some(f => !f.endsWith('.part') && WEIGHT_FILE_EXT_RE.test(f));
    }
    catch {
        return false;
    }
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

    // 3. Папки моделей со старым #weights на уровне модели (рядом с $ai) переносим в $ai/#weights
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
                    if (meta.weightsDir && !meta.weightsDir.includes('/$ai/#weights') && fs.existsSync(newWeights)) {
                        meta.weightsDir = expectedWeightsRel;
                        changed = true;
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
