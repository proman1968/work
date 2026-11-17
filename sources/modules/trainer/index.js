/**
 * Публичный API подсистемы локальных моделей Hugging Face и встроенного дообучения Unsloth (`trainer_*`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    CURATED_HF_MODELS,
    MODEL_MODALITIES,
    MODEL_CAPABILITIES,
    evaluateModelFit,
    estimateModelMemoryFromId,
    inferModalityAndCapabilities,
    searchHuggingFaceModels,
    inspectHuggingFaceRepo,
    startHuggingFaceDownload,
    computeDownloadEta,
    getHuggingFaceDownload,
    listHuggingFaceDownloads,
    pauseHuggingFaceDownload,
    discardHuggingFaceDownload,
    resumeHuggingFaceDownload,
    restartActiveHuggingFaceDownloads,
    resumeInterruptedDownloads,
    cancelHuggingFaceDownload,
    registerLocalModelNode,
} from './huggingface.js';
import {
    buildWorkDataset,
    listWorkDatasets,
    verifyCompletion,
    scrubSecrets,
} from './dataset.js';
import {
    computeAdaptiveDefaults,
    detectHardware,
    listLocalModelsAndAdapters,
    deleteLocalModel,
    startTrainingJob,
    getTrainingJob,
    listTrainingJobs,
    stopTrainingJob,
    publishTrainedAdapter,
} from './runner.js';
import {
    localStreamChat,
    localEngine,
    getLocalEngineStatus,
    releaseLocalEngineMemory,
    touchLocalEngineActivity,
} from './local-engine.js';
import {
    HALOGEN_DEFAULT_PORT,
    HALOGEN_DEFAULT_BASE_URL,
    HALOGEN_IMAGE_TAG,
    BUBO_WINDOWS_RELEASE,
    HALOGEN_MODELS_CATALOG,
    HALOGEN_WINDOWS_COMPANIONS,
    HALOGEN_TTS_VOICES,
    getHalogenCatalogForPlatform,
    checkWindowsHalogenPreflight,
    recordHalogenSessionHandle,
    listHalogenSessionHandles,
    releaseHalogenSessionHandle,
    normalizeHalogenTtsPayload,
    computeHalogenMemoryPlan,
    inspectWindowsHalogenEnvironment,
    prepareWindowsBuboRuntime,
    ensureWindowsBuboEngineInstalled,
    finalizeWindowsBuboModel,
    resolveBuboModelFiles,
    QWEN_FLASH_NEXT_GGUF_FILES,
    BUBO_ORIGINAL_MODEL_FILES,
    probeHalogenServer,
    startHalogenBackend,
    stopHalogenBackend,
    ensureHalogenBackendRunning,
    synthesizeFallbackWav,
    computeFallbackEmbeddings,
    computeFallbackRerank,
    computeFallbackDecision,
    ensureHalogenModelNodes,
    inspectHalogenCatalogWithStatus,
    downloadHalogenBundle,
    describeEngineSetup,
    readEngineSettings,
    writeEngineSettings,
    inspectEngineCapabilities,
    resolveSpeculationPlan,
    parseEngineHelpFlags,
    DEFAULT_ENGINE_SETTINGS,
} from './halogen.js';
import {
    AI_PROVIDER_PRESETS,
    findProviderPreset,
    buildProviderClassScripts,
    buildModelClassScript,
    scaffoldProviderOnDiskSync,
    evaluateAiNodeActivitySync,
    getProviderStatusSync,
    saveProviderConfigSync,
    addProviderModelsSync,
    toggleAiNodeEnabledSync,
} from './providers.js';
import {
    SOURCE_PRESETS,
    THREAD_OPTIONS,
    DEFAULT_HF_ORIGIN,
    HF_MIRROR_ORIGIN,
    loadTrainerNetworkSettings,
    saveTrainerNetworkSettings,
    sanitizeTrainerNetworkForClient,
    maskProxyUrl,
    probeTrainerNetwork,
} from './downloader.js';
import {
    TRANSFER_MANIFEST_FILE,
    listStorageRoots,
    browseDirectory,
    createDirectory,
    listTransferableLocalItems,
    inspectTransferSource,
    startExportToDisk,
    startImportFromDisk,
    prepareTarExport,
    importTarFromStream,
    getTransferJob,
    listTransferJobs,
    cancelTransferJob,
} from './transfer.js';
import {
    inspectWeightsDirectorySync,
    modelWeightsDir,
    migrateLocalModelsLayoutSync,
    LINUX_ONLY_HALOGEN_EXT_RE,
} from './paths.js';

export const halogenFallback = Object.freeze({
    normalizeHalogenTtsPayload,
    synthesizeFallbackWav,
    computeFallbackEmbeddings,
    computeFallbackRerank,
    computeFallbackDecision,
    recordHalogenSessionHandle,
    listHalogenSessionHandles,
    releaseHalogenSessionHandle,
    probeHalogenServer,
    computeHalogenMemoryPlan,
    inspectWindowsHalogenEnvironment,
    prepareWindowsBuboRuntime,
    ensureHalogenModelNodes,
    inspectHalogenCatalogWithStatus,
    downloadHalogenBundle,
});

export {
    localStreamChat,
    localEngine,
    SOURCE_PRESETS,
    THREAD_OPTIONS,
    loadTrainerNetworkSettings,
    saveTrainerNetworkSettings,
    sanitizeTrainerNetworkForClient,
    probeTrainerNetwork,
    AI_PROVIDER_PRESETS,
    findProviderPreset,
    buildProviderClassScripts,
    buildModelClassScript,
    scaffoldProviderOnDiskSync,
    evaluateAiNodeActivitySync,
    getProviderStatusSync,
    saveProviderConfigSync,
    addProviderModelsSync,
    toggleAiNodeEnabledSync,
    HALOGEN_DEFAULT_PORT,
    HALOGEN_DEFAULT_BASE_URL,
    HALOGEN_IMAGE_TAG,
    BUBO_WINDOWS_RELEASE,
    HALOGEN_MODELS_CATALOG,
    HALOGEN_WINDOWS_COMPANIONS,
    HALOGEN_TTS_VOICES,
    getHalogenCatalogForPlatform,
    checkWindowsHalogenPreflight,
    recordHalogenSessionHandle,
    listHalogenSessionHandles,
    releaseHalogenSessionHandle,
    normalizeHalogenTtsPayload,
    computeHalogenMemoryPlan,
    inspectWindowsHalogenEnvironment,
    prepareWindowsBuboRuntime,
    ensureWindowsBuboEngineInstalled,
    finalizeWindowsBuboModel,
    resolveBuboModelFiles,
    QWEN_FLASH_NEXT_GGUF_FILES,
    BUBO_ORIGINAL_MODEL_FILES,
    probeHalogenServer,
    startHalogenBackend,
    stopHalogenBackend,
    ensureHalogenBackendRunning,
    synthesizeFallbackWav,
    computeFallbackEmbeddings,
    computeFallbackRerank,
    computeFallbackDecision,
    ensureHalogenModelNodes,
    inspectHalogenCatalogWithStatus,
    downloadHalogenBundle,
    describeEngineSetup,
    readEngineSettings,
    writeEngineSettings,
    inspectEngineCapabilities,
    resolveSpeculationPlan,
    parseEngineHelpFlags,
    DEFAULT_ENGINE_SETTINGS,
    CURATED_HF_MODELS,
    MODEL_MODALITIES,
    MODEL_CAPABILITIES,
    evaluateModelFit,
    estimateModelMemoryFromId,
    inferModalityAndCapabilities,
    computeAdaptiveDefaults,
    searchHuggingFaceModels,
    inspectHuggingFaceRepo,
    startHuggingFaceDownload,
    computeDownloadEta,
    getHuggingFaceDownload,
    listHuggingFaceDownloads,
    pauseHuggingFaceDownload,
    discardHuggingFaceDownload,
    resumeHuggingFaceDownload,
    restartActiveHuggingFaceDownloads,
    resumeInterruptedDownloads,
    cancelHuggingFaceDownload,
    registerLocalModelNode,
    buildWorkDataset,
    listWorkDatasets,
    verifyCompletion,
    scrubSecrets,
    detectHardware,
    listLocalModelsAndAdapters,
    deleteLocalModel,
    getLocalEngineStatus,
    releaseLocalEngineMemory,
    touchLocalEngineActivity,
    startTrainingJob,
    getTrainingJob,
    listTrainingJobs,
    stopTrainingJob,
    publishTrainedAdapter,
    TRANSFER_MANIFEST_FILE,
    listStorageRoots,
    browseDirectory,
    createDirectory,
    listTransferableLocalItems,
    inspectTransferSource,
    startExportToDisk,
    startImportFromDisk,
    prepareTarExport,
    importTarFromStream,
    getTransferJob,
    listTransferJobs,
    cancelTransferJob,
};

function mergeTrainerArgs(p = {}) {
    const body = (p?.post && typeof p.post === 'object' && !Buffer.isBuffer(p.post)) ? p.post : {};
    return { ...p, ...body };
}

function parseBoolArg(v, fallback = false) {
    if (v === undefined || v === null || v === '')
        return fallback;
    if (typeof v === 'boolean')
        return v;
    return v !== false && v !== 'false' && v !== '0';
}

function parseIdListArg(v) {
    if (v === undefined || v === null)
        return null;
    if (Array.isArray(v))
        return v.map(String).filter(Boolean);
    if (typeof v === 'string') {
        const s = v.trim();
        if (!s)
            return [];
        if (s.startsWith('[')) {
            try {
                const parsed = JSON.parse(s);
                return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : null;
            }
            catch { /* fallback */ }
        }
        return s.split(',').map(x => x.trim()).filter(Boolean);
    }
    return null;
}

function stripInventoryFiles(inv) {
    const cleanModel = m => ({
        id: m.id,
        label: m.label,
        icon: m.icon,
        modality: m.modality,
        hfRepo: m.hfRepo,
        model: m.model,
        enabled: m.enabled,
        isAdapterNode: m.isAdapterNode,
        adapterName: m.adapterName,
        filesCount: m.filesCount,
        sizeBytes: m.sizeBytes,
        sizeGb: m.sizeGb,
        ...(m.alreadyInstalled !== undefined ? { alreadyInstalled: m.alreadyInstalled } : {}),
    });
    const cleanGroup = x => ({
        id: x.id,
        label: x.label,
        baseModel: x.baseModel,
        mode: x.mode,
        filesCount: x.filesCount,
        sizeBytes: x.sizeBytes,
        sizeGb: x.sizeGb,
        ...(x.alreadyInstalled !== undefined ? { alreadyInstalled: x.alreadyInstalled } : {}),
    });
    return {
        ...inv,
        localRoot: undefined,
        models: (inv.models || []).map(cleanModel),
        adapters: (inv.adapters || []).map(cleanGroup),
        datasets: (inv.datasets || []).map(cleanGroup),
        runtime: inv.runtime ? {
            present: Boolean(inv.runtime.present),
            filesCount: inv.runtime.filesCount || 0,
            sizeBytes: inv.runtime.sizeBytes || 0,
            sizeGb: inv.runtime.sizeGb || 0,
            ...(inv.runtime.alreadyInstalled !== undefined ? { alreadyInstalled: inv.runtime.alreadyInstalled } : {}),
        } : { present: false, filesCount: 0, sizeBytes: 0, sizeGb: 0 },
    };
}

/**
 * Методы `trainer_*`, подключаемые к узлам `$class` (в `/MODELS/Local` и локальных `$ai`) и в шлюз `gateway.js`.
 */
function inferTestModality(ai) {
    const d = ai?.DATA || {};
    const mod = String(ai?.modality || d.modality || '').toLowerCase();
    const rawCaps = ai?.capabilities ?? d.capabilities ?? [];
    const caps = (Array.isArray(rawCaps) ? rawCaps : String(rawCaps || '').split(/[\s,]+/))
        .map(s => String(s).trim().toLowerCase()).filter(Boolean);
    if (caps.includes('tts') || mod === 'tts' || mod === 'voice')
        return 'tts';
    if (caps.includes('stt') || caps.includes('asr') || mod === 'stt' || mod === 'asr')
        return 'stt';
    if (caps.includes('image') || caps.includes('text-to-image') || mod === 'image')
        return 'image';
    if (caps.includes('rerank') || mod === 'rerank' || /rerank/i.test(String(ai?.id || ai?.model || '')))
        return 'rerank';
    if (caps.includes('embeddings') || caps.includes('rag') || mod === 'embed' || mod === 'embedding')
        return 'embed';
    return 'llm';
}

async function runSingleModelSmokeTest(ai, p = {}) {
    await ai?.init?.catch?.(() => {});
    const modality = String(p.modality || inferTestModality(ai));
    const t0 = Date.now();
    try {
        if (modality === 'tts') {
            const text = String(p.text || p.prompt || 'Привет! Проверка локального синтеза речи WORK.').trim();
            const buf = await ai.speak({ text, language: p.language, instructions: p.instructions });
            const durationMs = Math.max(1, Date.now() - t0);
            return {
                ok: true,
                modality,
                durationMs,
                bytes: buf.length,
                audioBase64: buf.toString('base64'),
                summary: `WAV ${(buf.length / 1024).toFixed(1)} КБ за ${(durationMs / 1000).toFixed(2)} с`,
            };
        }
        if (modality === 'stt') {
            let audio = null;
            if (p.audioBase64)
                audio = Buffer.from(String(p.audioBase64), 'base64');
            else
                audio = synthesizeFallbackWav('проверка');
            const res = await ai.transcribe({ audio, language: p.language || 'ru' });
            const durationMs = Math.max(1, Date.now() - t0);
            return {
                ok: true,
                modality,
                durationMs,
                text: res?.text || '',
                summary: res?.text ? `«${res.text.slice(0, 60)}» (${durationMs} мс)` : `Обработано за ${durationMs} мс`,
            };
        }
        if (modality === 'image') {
            const prompt = String(p.prompt || 'Минималистичная 3D-иконка офисного здания на светлом фоне').trim();
            const pic = await ai.generateImage({ prompt, size: p.size || '512x512', steps: p.steps ? Number(p.steps) : undefined });
            const durationMs = Math.max(1, Date.now() - t0);
            return {
                ok: true,
                modality,
                durationMs,
                mime: pic?.mime || 'image/png',
                base64: pic?.base64 || '',
                summary: `Картинка ${pic?.mime || 'image/png'} за ${(durationMs / 1000).toFixed(1)} с`,
            };
        }
        if (modality === 'embed') {
            const input = Array.isArray(p.input) && p.input.length
                ? p.input
                : String(p.prompt || 'Учётная система WORK\nОборотно-сальдовая ведомость').split(/\r?\n/).filter(Boolean);
            const res = await ai.embed({ input });
            const durationMs = Math.max(1, Date.now() - t0);
            const list = res?.data || [];
            const dims = list[0]?.embedding?.length || res?.dimensions || 0;
            return {
                ok: true,
                modality,
                durationMs,
                count: list.length,
                dimensions: dims,
                summary: `${list.length} вект. × ${dims}d за ${durationMs} мс`,
            };
        }
        if (modality === 'rerank') {
            const query = String(p.query || p.prompt || 'остатки на расчётном счёте 51').trim();
            const documents = Array.isArray(p.documents) && p.documents.length
                ? p.documents
                : ['Счёт 51 «Расчётные счета»: обороты и остатки денежных средств', 'Договор аренды офиса и коммунальные услуги'];
            const res = await ai.rerank({ query, documents, top_n: documents.length });
            const durationMs = Math.max(1, Date.now() - t0);
            const top = res?.results?.[0];
            return {
                ok: true,
                modality,
                durationMs,
                results: res?.results || [],
                summary: `Топ #${(top?.index ?? 0) + 1} (${((top?.relevance_score ?? 0) * 100).toFixed(1)}%) за ${durationMs} мс`,
            };
        }
        const messages = Array.isArray(p.messages) && p.messages.length
            ? p.messages
            : [{ role: 'user', content: String(p.prompt || 'Привет! Представься коротко в одном предложении.') }];
        let text = '';
        let usage = null;
        for await (const chunk of ai.streamChat({ messages, max_tokens: Number(p.maxTokens) || 192 }, {})) {
            if (typeof chunk === 'string')
                text += chunk;
            else if (chunk?.type === 'usage')
                usage = chunk;
        }
        const durationMs = Math.max(1, Date.now() - t0);
        const ttftMs = Number(usage?.ttftMs) || 0;
        const tokPerSec = Number(usage?.tokPerSec) || 0;
        const promptTokPerSec = Number(usage?.promptTokPerSec) || 0;
        return {
            ok: true,
            modality: 'llm',
            text: text.trim(),
            durationMs,
            ttftMs,
            tokPerSec,
            promptTokPerSec,
            usage,
            summary: [
                tokPerSec > 0 ? `${tokPerSec} tok/s` : `${durationMs} мс`,
                ttftMs > 0 ? `TTFT ${(ttftMs / 1000).toFixed(2)} с` : '',
            ].filter(Boolean).join(' · '),
        };
    }
    catch (e) {
        const durationMs = Math.max(1, Date.now() - t0);
        return {
            ok: false,
            modality,
            durationMs,
            error: String(e?.message || e),
            ...(e?.pythonMissing ? { pythonMissing: true } : {}),
            ...(Array.isArray(e?.missingDeps) && e.missingDeps.length ? { missingDeps: e.missingDeps } : {}),
        };
    }
}

/**
 * Привести значение из UI/HTTP (true, 1, '1', 'true') к булеву.
 */
const isTruthy = v => v === true || v === 1 || v === '1' || v === 'true' || v === 'yes';

/**
 * Остановить движок и дождаться освобождения порта, после чего запустить его с новыми настройками
 * (иначе `startHalogenBackend` увидит ещё живой сервер и вернёт `alreadyRunning`).
 */
async function restartHalogenEngine(settings = null, params = {}) {
    stopHalogenBackend();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        const probe = await probeHalogenServer().catch(() => ({ online: false }));
        if (!probe?.online)
            break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return startHalogenBackend({
        ...(settings ? { settings } : {}),
        ...params,
    });
}

export const TRAINER_METHODS = Object.freeze({
    trainer_status: {
        level: 'read',
        fn: async function () {
            const [hardware, local, datasets] = await Promise.all([
                detectHardware(),
                listLocalModelsAndAdapters(),
                listWorkDatasets(),
            ]);
            const halogenPlan = computeHalogenMemoryPlan({
                totalRamGb: hardware?.totalRamGb >= 120 ? hardware.totalRamGb : 192,
                platform: hardware?.platform,
            });
            const platform = hardware?.platform || os.platform();
            const probe = await probeHalogenServer(HALOGEN_DEFAULT_BASE_URL).catch(() => null);
            const runtime = getLocalEngineStatus({
                totalRamGb: hardware?.totalRamGb,
                halogenOnline: Boolean(probe?.online),
            });
            const curatedCompatible = CURATED_HF_MODELS.filter(m =>
                (!Array.isArray(m.platforms) || !m.platforms.length || m.platforms.includes(platform))
                && !(platform === 'win32' && (m.format === 'hgn' || m.format === 'hnpw'))
            );
            return {
                hardware,
                runtime,
                models: local.models,
                adapters: local.adapters,
                datasets,
                downloads: listHuggingFaceDownloads(),
                jobs: listTrainingJobs(),
                transfers: listTransferJobs(),
                network: sanitizeTrainerNetworkForClient(loadTrainerNetworkSettings()),
                modalities: MODEL_MODALITIES,
                capabilities: Object.values(MODEL_CAPABILITIES),
                curated: curatedCompatible,
                halogen: {
                    online: Boolean(probe?.online),
                    mode: probe?.mode || '',
                    modeLabel: probe?.modeLabel || '',
                    memoryPlan: halogenPlan,
                    catalog: inspectHalogenCatalogWithStatus(process.cwd(), { platform }),
                    handles: listHalogenSessionHandles(),
                    windowsEnv: probe?.windowsEnv || inspectWindowsHalogenEnvironment(),
                },
            };
        },
    },
    trainer_model_info: {
        level: 'read',
        fn: async function () {
            await this?.init;
            const d = this?.DATA || {};
            const itemPath = String(this?.path || this?.short || '');
            const parts = itemPath.split('/').filter(Boolean);
            const providerId = parts[1] || 'MODELS';
            const isLocal = providerId === 'Local' || d.protocol === 'local' || d.protocol === 'halogen';
            if (isLocal) {
                migrateLocalModelsLayoutSync(process.cwd());
            }
            const act = evaluateAiNodeActivitySync(this);

            let weightInfo = null;
            let halogenProbe = null;
            let sizeGb = 0;
            let needsRuntime = false;
            let resolvedWeightsRel = d.weightsDir || '';
            let resolvedPrimaryFile = d.primaryFile || '';

            if (isLocal) {
                const canonicalWeightsRel = path.join('MODELS', 'Local', this?.id || '', '$ai', '#weights');
                const canonicalWeightsAbs = path.resolve(process.cwd(), canonicalWeightsRel);
                const configuredAbs = d.weightsDir ? path.resolve(process.cwd(), d.weightsDir) : '';
                const wDirAbs = fs.existsSync(canonicalWeightsAbs) ? canonicalWeightsAbs : (configuredAbs || canonicalWeightsAbs);
                resolvedWeightsRel = path.relative(process.cwd(), wDirAbs).replace(/\\/g, '/');
                weightInfo = inspectWeightsDirectorySync(wDirAbs, os.platform());
                if (resolvedPrimaryFile === 'bubo-package.json' || (!resolvedPrimaryFile && weightInfo?.hasGguf)) {
                    const resolvedGguf = resolveBuboModelFiles(wDirAbs);
                    if (resolvedGguf.mainModel)
                        resolvedPrimaryFile = path.basename(resolvedGguf.mainModel);
                }
                if (weightInfo.exists) {
                    let bytes = 0;
                    for (const f of weightInfo.files) {
                        try {
                            bytes += fs.statSync(path.join(wDirAbs, f)).size || 0;
                        }
                        catch { /* ignore */ }
                    }
                    sizeGb = +(bytes / (1024 ** 3)).toFixed(2);
                }
                if (d.protocol === 'halogen' || weightInfo?.hasGguf || weightInfo?.hasBuboManifest) {
                    halogenProbe = await probeHalogenServer(d.baseUrl || HALOGEN_DEFAULT_BASE_URL).catch(() => null);
                    const winEnv = halogenProbe?.windowsEnv || inspectWindowsHalogenEnvironment();
                    if (os.platform() === 'win32' && !halogenProbe?.online && !winEnv.buboInstalled && !winEnv.gufoInstalled) {
                        needsRuntime = true;
                    }
                }
            }

            return {
                id: this?.id || '',
                label: d.label || this?.label || this?.id || '',
                icon: d.icon || this?.icon || 'carbon:machine-learning-model',
                path: itemPath,
                providerName: providerId,
                isLocal,
                protocol: d.protocol || (isLocal ? 'local' : 'openai'),
                model: d.model || this?.id || '',
                baseUrl: d.baseUrl || '',
                modality: d.modality || 'llm',
                maxTokens: Number(d.maxTokens || d.$public?.maxTokens) || 32768,
                maxOutput: Number(d.maxOutput || d.$public?.maxOutput) || 8192,
                capabilities: Array.isArray(d.capabilities) ? d.capabilities : (d.$public?.capabilities || ['chat', 'stream']),
                efforts: Array.isArray(d.efforts) ? d.efforts : [],
                weightsDir: resolvedWeightsRel,
                primaryFile: resolvedPrimaryFile,
                enabled: d.enabled !== false,
                aiActive: act.active,
                aiStatusReason: act.reason,
                weightFormat: weightInfo?.weightFormat || '',
                incompatibleOnPlatform: Boolean(act.incompatibleOnPlatform || weightInfo?.incompatibleOnPlatform),
                incompatibleReason: act.incompatibleOnPlatform ? act.reason : (weightInfo?.incompatibleReason || ''),
                sizeGb,
                needsRuntime,
                halogenOnline: Boolean(halogenProbe?.online),
                halogenMode: halogenProbe?.mode || '',
                halogenModeLabel: halogenProbe?.modeLabel || '',
                speculation: halogenProbe?.speculation || null,
                speculationFallback: halogenProbe?.speculationFallback || null,
                engineSettings: (d.protocol === 'halogen' || weightInfo?.hasGguf) ? readEngineSettings(process.cwd()) : null,
                windowsEnv: halogenProbe?.windowsEnv || null,
            };
        },
    },
    trainer_delete_incompatible: {
        level: 'admin',
        fn: async function (p = {}) {
            await this?.init;
            const modelId = p.modelId || p.id || this?.id || '';
            const cleanId = String(modelId).replace(/^\/?MODELS\/Local\//i, '').replace(/[<>:"/\\|?*]/g, '').trim();
            if (!cleanId)
                throw new Error('Не указана модель');
            const wDir = modelWeightsDir(process.cwd(), cleanId, 'Local');
            const info = inspectWeightsDirectorySync(wDir, os.platform());
            if (info.exists && !info.hasGguf && !info.hasSafetensors && !info.hasBuboManifest) {
                const res = await deleteLocalModel({ modelId: cleanId });
                try {
                    const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                    localNode?.reset?.();
                    const modelsRoot = await globalThis.WORK?.get_item?.('/MODELS');
                    modelsRoot?.reset?.();
                }
                catch { /* ignore */ }
                return { ...res, mode: 'deleted_model' };
            }
            let removedCount = 0;
            if (fs.existsSync(wDir)) {
                for (const f of fs.readdirSync(wDir)) {
                    if (LINUX_ONLY_HALOGEN_EXT_RE.test(f) || (LINUX_ONLY_HALOGEN_EXT_RE.test(f.replace(/\.part$/i, '')))) {
                        fs.rmSync(path.join(wDir, f), { force: true });
                        removedCount++;
                    }
                }
            }
            try {
                this?.reset?.();
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
            }
            catch { /* ignore */ }
            return { ok: true, removedCount, mode: 'removed_files' };
        },
    },
    trainer_delete_model: {
        level: 'admin',
        fn: async function (p = {}) {
            const modelId = p.modelId || p.id || p.path || '';
            const res = await deleteLocalModel({ modelId });
            try {
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
                const modelsRoot = await globalThis.WORK?.get_item?.('/MODELS');
                modelsRoot?.reset?.();
            }
            catch { /* ignore */ }
            return res;
        },
    },
    trainer_release_memory: {
        level: 'admin',
        fn: async function () {
            const res = releaseLocalEngineMemory();
            const hw = await detectHardware().catch(() => null);
            return {
                ...res,
                runtime: getLocalEngineStatus({ totalRamGb: hw?.totalRamGb }),
            };
        },
    },
    halogen_status: {
        level: 'read',
        fn: async function (p = {}) {
            const baseUrl = p.baseUrl || this?.baseUrl || this?.DATA?.baseUrl || HALOGEN_DEFAULT_BASE_URL;
            const [hw, probe] = await Promise.all([
                detectHardware(),
                probeHalogenServer(baseUrl),
            ]);
            const memoryPlan = computeHalogenMemoryPlan({
                totalRamGb: Number(p.totalRamGb) || (hw?.totalRamGb >= 120 ? hw.totalRamGb : 192),
                platform: p.platform || hw?.platform,
                npuModels: p.npuModels,
            });
            return {
                ...probe,
                hardware: hw,
                memoryPlan,
                catalog: inspectHalogenCatalogWithStatus(),
                windowsEnv: probe.windowsEnv || inspectWindowsHalogenEnvironment(),
            };
        },
    },
    halogen_prepare_windows: {
        level: 'admin',
        fn: async function (p = {}) {
            return prepareWindowsBuboRuntime({
                step: p.step || 'runtime',
                modelSet: p.modelSet || 'original',
            });
        },
    },
    halogen_download_bundle: {
        level: 'admin',
        fn: async function (p = {}) {
            const hw = await detectHardware().catch(() => null);
            const res = await downloadHalogenBundle({
                models: p.models || p.nodeName || p.model || null,
                token: p.token || '',
                waitForCompletion: p.wait === true || p.wait === 'true',
                totalMemoryGb: hw?.totalRamGb ?? null,
            });
            try {
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
                const modelsRoot = await globalThis.WORK?.get_item?.('/MODELS');
                modelsRoot?.reset?.();
            }
            catch { /* ignore */ }
            return res;
        },
    },
    provider_presets: {
        level: 'read',
        fn: async function () {
            return { items: AI_PROVIDER_PRESETS };
        },
    },
    provider_status: {
        level: 'read',
        fn: async function () {
            await this?.init;
            return getProviderStatusSync(this);
        },
    },
    provider_save_config: {
        level: 'admin',
        fn: async function (p = {}) {
            await this?.init;
            const itemPath = String(this?.path || this?.short || '');
            const parts = itemPath.split('/').filter(Boolean);
            const providerId = p.providerId || parts[1] || this?.id || '';
            const res = saveProviderConfigSync({
                providerId,
                apiKey: p.apiKey,
                folderId: p.folderId,
                baseUrl: p.baseUrl,
                authUrl: p.authUrl,
                scope: p.scope,
                protocol: p.protocol,
                enabled: p.enabled !== undefined ? (p.enabled !== false && p.enabled !== 'false') : undefined,
            });
            try {
                const provNode = await globalThis.WORK?.get_item?.(`/MODELS/${providerId}`);
                if (provNode) {
                    provNode.reset?.();
                    provNode.DATA = await provNode.import?.();
                    const children = await provNode.children;
                    if (Array.isArray(children)) {
                        for (const ch of children) {
                            ch.reset?.();
                            ch.DATA = await ch.import?.();
                        }
                    }
                }
                const modelsRoot = await globalThis.WORK?.get_item?.('/MODELS');
                modelsRoot?.reset?.();
            }
            catch { /* ignore */ }
            return {
                ...res,
                status: getProviderStatusSync(this),
            };
        },
    },
    provider_add_models: {
        level: 'admin',
        fn: async function (p = {}) {
            await this?.init;
            const itemPath = String(this?.path || this?.short || '');
            const parts = itemPath.split('/').filter(Boolean);
            const providerId = p.providerId || parts[1] || this?.id || '';
            let models = p.models || p.model || [];
            if (typeof models === 'string' && models.trim().startsWith('[')) {
                try { models = JSON.parse(models); } catch { /* ignore */ }
            }
            else if (typeof models === 'string') {
                models = models.split(',').map(s => s.trim()).filter(Boolean);
            }
            const res = addProviderModelsSync({
                providerId,
                models,
            });
            try {
                const provNode = await globalThis.WORK?.get_item?.(`/MODELS/${providerId}`);
                provNode?.reset?.();
                const modelsRoot = await globalThis.WORK?.get_item?.('/MODELS');
                modelsRoot?.reset?.();
            }
            catch { /* ignore */ }
            return {
                ...res,
                status: getProviderStatusSync(this),
            };
        },
    },
    provider_toggle_model: {
        level: 'admin',
        fn: async function (p = {}) {
            const nodePath = p.nodePath || p.path || this?.path || '';
            const enabled = p.enabled !== false && p.enabled !== 'false';
            const res = toggleAiNodeEnabledSync({ nodePath, enabled });
            try {
                const node = await globalThis.WORK?.get_item?.(res.path);
                if (node) {
                    node.reset?.();
                    node.DATA = await node.import?.();
                }
                const parts = res.path.split('/').filter(Boolean);
                if (parts[1]) {
                    const provNode = await globalThis.WORK?.get_item?.(`/MODELS/${parts[1]}`);
                    provNode?.reset?.();
                }
            }
            catch { /* ignore */ }
            return res;
        },
    },
    halogen_start: {
        level: 'admin',
        fn: async function (p = {}) {
            return startHalogenBackend({
                port: Number(p.port) || HALOGEN_DEFAULT_PORT,
                modelPath: p.modelPath || '',
                ...(p.profile ? { profile: String(p.profile) } : {}),
                ...(p.npuPrefill === undefined ? {} : { npuPrefill: isTruthy(p.npuPrefill) }),
                ...(p.settings && typeof p.settings === 'object' ? { settings: p.settings } : {}),
            });
        },
    },
    /** Текущие настройки движка и готовность спекулятивного декодирования (MTP + Draft Head). */
    halogen_engine_config: {
        level: 'read',
        fn: async function (p = {}) {
            return describeEngineSetup({ forceCapabilities: isTruthy(p.refresh) });
        },
    },
    /** Сохранить настройки спекуляции и (по желанию) перезапустить движок с ними. */
    halogen_save_engine_config: {
        level: 'admin',
        fn: async function (p = {}) {
            const saved = writeEngineSettings(process.cwd(), {
                ...(p.speculation ? { speculation: p.speculation } : {}),
                ...(p.promptLookup ? { promptLookup: p.promptLookup } : {}),
                ...(p.draftMax !== undefined ? { draftMax: p.draftMax } : {}),
                ...(p.profile ? { profile: p.profile } : {}),
                ...(p.npuPrefill === undefined ? {} : { npuPrefill: isTruthy(p.npuPrefill) }),
            });
            const wantsRestart = isTruthy(p.restart);
            if (wantsRestart)
                await restartHalogenEngine(saved).catch(() => null);
            return {
                ...(await describeEngineSetup({ settings: saved, forceCapabilities: isTruthy(p.refresh) })),
                saved,
                restarted: wantsRestart,
            };
        },
    },
    /** Перезапустить встроенный движок с текущими настройками. */
    halogen_restart: {
        level: 'admin',
        fn: async function (p = {}) {
            const started = await restartHalogenEngine(null, {
                ...(p.profile ? { profile: String(p.profile) } : {}),
            });
            return { ...started, restarted: true };
        },
    },
    halogen_stop: {
        level: 'admin',
        fn: async function () {
            return stopHalogenBackend();
        },
    },
    halogen_handles: {
        level: 'read',
        fn: async function () {
            return { handles: listHalogenSessionHandles() };
        },
    },
    halogen_release_handle: {
        level: 'admin',
        fn: async function (p = {}) {
            const released = releaseHalogenSessionHandle(p.name ?? p.id);
            return { released, handles: listHalogenSessionHandles() };
        },
    },
    trainer_hf_search: {
        level: 'read',
        fn: async function (p = {}) {
            const hw = await detectHardware();
            return searchHuggingFaceModels({
                query: p.query ?? p.q ?? '',
                modality: p.modality ?? 'all',
                capability: p.capability ?? '',
                filter: p.filter ?? '',
                limit: p.limit ?? 25,
                token: p.token ?? '',
                usableMemoryGb: Number(p.usableMemoryGb) || hw.usableMemoryGb,
            });
        },
    },
    trainer_hf_inspect: {
        level: 'read',
        fn: async function (p = {}) {
            const hw = await detectHardware();
            return inspectHuggingFaceRepo(p.repoId ?? p.id, {
                revision: p.revision || 'main',
                token: p.token || '',
                usableMemoryGb: Number(p.usableMemoryGb) || hw.usableMemoryGb,
            });
        },
    },
    trainer_hf_download: {
        level: 'admin',
        fn: async function (p = {}) {
            const files = typeof p.files === 'string' && p.files.trim().startsWith('[')
                ? JSON.parse(p.files)
                : Array.isArray(p.files) ? p.files : null;
            const job = await startHuggingFaceDownload({
                repoId: p.repoId ?? p.id,
                files,
                quant: p.quant || 'Q8_0',
                revision: p.revision || 'main',
                token: p.token || '',
                registerInWork: p.registerInWork !== false && p.registerInWork !== 'false',
                waitForCompletion: p.wait === true || p.wait === 'true',
            });
            try {
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
            }
            catch { /* ignore */ }
            return job;
        },
    },
    trainer_hf_cancel: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            return cancelHuggingFaceDownload(args.jobId ?? args.id, {
                keepFiles: parseBoolArg(args.keepFiles, false),
            });
        },
    },
    trainer_hf_pause: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            return pauseHuggingFaceDownload(args.jobId ?? args.id);
        },
    },
    trainer_hf_discard: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            return discardHuggingFaceDownload({
                jobId: args.jobId ?? args.id ?? '',
                folderName: args.folderName || '',
            });
        },
    },
    trainer_hf_resume: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            const folderName = args.folderName || '';
            const platformCatalog = getHalogenCatalogForPlatform(os.platform());
            const haloSpec = platformCatalog.find(m =>
                (folderName && m.nodeName === folderName)
                || (args.repoId && m.hfRepo === args.repoId)
            );
            const isWinBubo = os.platform() === 'win32' && (haloSpec?.runtimeType === 'bubo' || folderName === 'Qwen3.8-Flash-Next');
            const job = await resumeHuggingFaceDownload({
                jobId: args.jobId ?? args.id ?? '',
                folderName,
                repoId: isWinBubo ? (haloSpec?.windowsBuboRepo || 'unsloth/Qwen3.8-Flash-Next-GGUF') : (args.repoId || haloSpec?.hfRepo || ''),
                ...(isWinBubo ? {
                    customFiles: QWEN_FLASH_NEXT_GGUF_FILES,
                    onComplete: ({ rootDir: rd }) => ensureWindowsBuboEngineInstalled({ rootDir: rd }),
                } : {}),
                quant: args.quant || 'Q8_0',
                token: args.token || '',
                nodeMeta: haloSpec ? {
                    label: haloSpec.label || haloSpec.nodeName,
                    model: haloSpec.model,
                    protocol: haloSpec.protocol || 'local',
                    icon: haloSpec.icon || 'ai:qwen',
                    modality: haloSpec.modality,
                    capabilities: haloSpec.capabilities,
                    efforts: haloSpec.efforts,
                    maxTokens: haloSpec.maxTokens,
                    maxOutput: haloSpec.maxOutput,
                    baseUrl: haloSpec.baseUrl ?? '',
                    ...(isWinBubo ? { primaryFile: 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf' } : {}),
                } : null,
            });
            try {
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
            }
            catch { /* ignore */ }
            return job;
        },
    },
    trainer_dataset_build: {
        level: 'admin',
        fn: async function (p = {}) {
            const sources = typeof p.sources === 'string'
                ? p.sources.split(',').map(s => s.trim()).filter(Boolean)
                : Array.isArray(p.sources) ? p.sources : ['tasks', 'accounting', 'classes'];
            return buildWorkDataset({
                name: p.name || 'work-sft-dataset',
                sources,
                basePath: p.basePath || '/ORGANIZATIONS/Маслоторг',
            });
        },
    },
    trainer_dataset_list: {
        level: 'read',
        fn: async function () {
            return listWorkDatasets();
        },
    },
    trainer_start: {
        level: 'admin',
        fn: async function (p = {}) {
            const job = await startTrainingJob({
                adapterName: p.adapterName || 'Маслоторг-Ассистент-LoRA',
                baseModel: p.baseModel || '',
                datasetName: p.datasetName || 'work-sft-dataset',
                basePath: p.basePath || '/ORGANIZATIONS/Маслоторг',
                mode: p.mode || 'sft',
                loraR: p.loraR ?? 0,
                loraAlpha: p.loraAlpha ?? 0,
                epochs: p.epochs ?? 2,
                maxSeqLength: p.maxSeqLength ?? 0,
                learningRate: p.learningRate ?? 2e-4,
                exportGguf: p.exportGguf !== false && p.exportGguf !== 'false',
                ggufQuant: p.ggufQuant || 'Q8_0',
                autoPublish: p.autoPublish !== false && p.autoPublish !== 'false',
                stepDelayMs: p.stepDelayMs !== undefined ? Number(p.stepDelayMs) : 60,
                waitForCompletion: p.wait === true || p.wait === 'true',
            });
            try {
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
            }
            catch { /* ignore */ }
            return job;
        },
    },
    trainer_stop: {
        level: 'admin',
        fn: async function (p = {}) {
            return stopTrainingJob(p.jobId ?? p.id);
        },
    },
    trainer_jobs: {
        level: 'read',
        fn: async function (p = {}) {
            if (p.jobId || p.id)
                return getTrainingJob(p.jobId ?? p.id);
            return {
                jobs: listTrainingJobs(),
                downloads: listHuggingFaceDownloads(),
            };
        },
    },
    trainer_publish: {
        level: 'admin',
        fn: async function (p = {}) {
            const res = await publishTrainedAdapter(p.jobId ?? p.id, { label: p.label || '' });
            try {
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
            }
            catch { /* ignore */ }
            return res;
        },
    },
    trainer_verify: {
        level: 'read',
        fn: async function (p = {}) {
            return verifyCompletion({
                basePath: p.basePath || '/ORGANIZATIONS/Маслоторг',
                taskType: p.taskType || 'operation',
                completion: p.completion || '',
            });
        },
    },
    trainer_transfer_roots: {
        level: 'read',
        fn: async function () {
            return { roots: await listStorageRoots() };
        },
    },
    trainer_transfer_browse: {
        level: 'read',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            return browseDirectory(args.path || args.dir || '');
        },
    },
    trainer_transfer_mkdir: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            return createDirectory(args.parentPath || args.path || '', args.name || '');
        },
    },
    trainer_transfer_inventory: {
        level: 'read',
        fn: async function () {
            const inv = await listTransferableLocalItems();
            return stripInventoryFiles(inv);
        },
    },
    trainer_transfer_inspect: {
        level: 'read',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            const info = await inspectTransferSource(args.sourceDir || args.path || '');
            return stripInventoryFiles(info);
        },
    },
    trainer_transfer_export: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            return startExportToDisk({
                targetDir: args.targetDir || args.path || '',
                modelIds: parseIdListArg(args.modelIds),
                adapterIds: parseIdListArg(args.adapterIds),
                datasetIds: parseIdListArg(args.datasetIds),
                includeRuntime: parseBoolArg(args.includeRuntime, true),
                overwrite: parseBoolArg(args.overwrite, true),
                waitForCompletion: parseBoolArg(args.wait, false),
            });
        },
    },
    trainer_transfer_import: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            const job = await startImportFromDisk({
                sourceDir: args.sourceDir || args.path || '',
                modelIds: parseIdListArg(args.modelIds),
                adapterIds: parseIdListArg(args.adapterIds),
                datasetIds: parseIdListArg(args.datasetIds),
                includeRuntime: parseBoolArg(args.includeRuntime, true),
                overwrite: parseBoolArg(args.overwrite, false),
                waitForCompletion: parseBoolArg(args.wait, false),
            });
            try {
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
                const modelsRoot = await globalThis.WORK?.get_item?.('/MODELS');
                modelsRoot?.reset?.();
            }
            catch { /* ignore */ }
            return job;
        },
    },
    trainer_transfer_status: {
        level: 'read',
        fn: async function (p = {}) {
            if (p.jobId || p.id)
                return getTransferJob(p.jobId ?? p.id);
            return { jobs: listTransferJobs() };
        },
    },
    trainer_transfer_cancel: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            return cancelTransferJob(args.jobId ?? args.id);
        },
    },
    trainer_transfer_export_tar: {
        level: 'read',
        fn: async function (p = {}) {
            const res = await prepareTarExport({
                modelIds: parseIdListArg(p.modelIds),
                adapterIds: parseIdListArg(p.adapterIds),
                datasetIds: parseIdListArg(p.datasetIds),
                includeRuntime: parseBoolArg(p.includeRuntime, false),
            });
            p.filename = res.filename;
            p.contentLength = res.contentLength;
            return res.stream;
        },
    },
    trainer_transfer_import_tar: {
        level: 'admin',
        fn: async function (p = {}) {
            const job = await importTarFromStream({
                readable: p.stream || (Buffer.isBuffer(p.post) ? (await import('node:stream')).Readable.from(p.post) : null),
                contentLength: Number(p.contentLength) || 0,
                overwrite: parseBoolArg(p.overwrite, false),
            });
            try {
                const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local');
                localNode?.reset?.();
                const modelsRoot = await globalThis.WORK?.get_item?.('/MODELS');
                modelsRoot?.reset?.();
            }
            catch { /* ignore */ }
            return job;
        },
    },
    trainer_network_get: {
        level: 'admin',
        fn: async function () {
            return sanitizeTrainerNetworkForClient(loadTrainerNetworkSettings());
        },
    },
    trainer_network_set: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            const updated = saveTrainerNetworkSettings({
                sourcePreset: args.sourcePreset,
                endpointUrl: args.endpointUrl,
                proxyUrl: args.proxyUrl,
                threads: args.threads,
                parallelFiles: args.parallelFiles,
                token: args.token,
                clearProxy: args.clearProxy,
                clearToken: args.clearToken,
            });
            const restarted = await restartActiveHuggingFaceDownloads().catch(() => []);
            return {
                ...sanitizeTrainerNetworkForClient(updated),
                restartedCount: restarted.length,
            };
        },
    },
    trainer_network_probe: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            const saved = loadTrainerNetworkSettings();
            let endpointUrl = args.endpointUrl;
            if (!endpointUrl) {
                if (args.sourcePreset === 'hf-mirror')
                    endpointUrl = HF_MIRROR_ORIGIN;
                else if (args.sourcePreset === 'official')
                    endpointUrl = DEFAULT_HF_ORIGIN;
                else
                    endpointUrl = saved.endpointUrl;
            }
            let proxyUrl = args.proxyUrl;
            if (proxyUrl !== undefined) {
                const masked = maskProxyUrl(saved.proxyUrl || '');
                if (saved.proxyUrl && (proxyUrl === masked))
                    proxyUrl = saved.proxyUrl;
            }
            let token = args.token;
            if (token !== undefined && (String(token).includes('…') || token === '***'))
                token = saved.token;
            return probeTrainerNetwork({
                endpointUrl,
                proxyUrl,
                threads: args.threads !== undefined ? Number(args.threads) : saved.threads,
                token,
            });
        },
    },
    trainer_test_model: {
        level: 'call',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            let target = this;
            if (args.nodePath || args.path) {
                const found = await globalThis.WORK?.get_item?.(args.nodePath || args.path).catch(() => null);
                if (found)
                    target = found;
            }
            return runSingleModelSmokeTest(target, args);
        },
    },
    trainer_check_all_models: {
        level: 'call',
        fn: async function () {
            const pythonDeps = await localEngine.checkDeps();
            const localNode = await globalThis.WORK?.get_item?.('/MODELS/Local').catch(() => null);
            const items = (await localNode?.items) || [];
            const results = [];
            for (const m of items) {
                if (!m || Array.isArray(m))
                    continue;
                await m.init?.catch?.(() => {});
                const act = evaluateAiNodeActivitySync(m);
                const modality = inferTestModality(m);
                if (!act.active) {
                    results.push({
                        id: m.id,
                        path: m.path,
                        label: m.label || m.DATA?.label || m.id,
                        modality,
                        active: false,
                        ok: false,
                        skipped: true,
                        summary: act.reason || 'Неактивна',
                    });
                    continue;
                }
                const res = await runSingleModelSmokeTest(m, {
                    prompt: modality === 'llm' ? 'Ответь одним словом: Готов.' : undefined,
                });
                results.push({
                    id: m.id,
                    path: m.path,
                    label: m.label || m.DATA?.label || m.id,
                    active: true,
                    ...res,
                });
            }
            return {
                ok: results.every(r => r.skipped || r.ok),
                pythonDeps,
                results,
            };
        },
    },
    trainer_install_python_deps: {
        level: 'admin',
        fn: async function (p = {}) {
            const args = mergeTrainerArgs(p);
            const list = Array.isArray(args.packages)
                ? args.packages
                : String(args.packages || '').split(/[\s,]+/).filter(Boolean);
            return localEngine.installDeps(list);
        },
    },
});

export function attachTrainerMethods($class) {
    for (const [name, { fn }] of Object.entries(TRAINER_METHODS))
        $class.prototype[name] = fn;
}
