/**
 * Публичный API подсистемы локальных моделей Hugging Face и встроенного дообучения Unsloth (`trainer_*`).
 */
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
    HALOGEN_TTS_VOICES,
    recordHalogenSessionHandle,
    listHalogenSessionHandles,
    releaseHalogenSessionHandle,
    normalizeHalogenTtsPayload,
    computeHalogenMemoryPlan,
    inspectWindowsHalogenEnvironment,
    prepareWindowsBuboRuntime,
    probeHalogenServer,
    startHalogenBackend,
    stopHalogenBackend,
    synthesizeFallbackWav,
    computeFallbackEmbeddings,
    computeFallbackRerank,
    computeFallbackDecision,
    ensureHalogenModelNodes,
    inspectHalogenCatalogWithStatus,
    downloadHalogenBundle,
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
    HALOGEN_TTS_VOICES,
    recordHalogenSessionHandle,
    listHalogenSessionHandles,
    releaseHalogenSessionHandle,
    normalizeHalogenTtsPayload,
    computeHalogenMemoryPlan,
    inspectWindowsHalogenEnvironment,
    prepareWindowsBuboRuntime,
    probeHalogenServer,
    startHalogenBackend,
    stopHalogenBackend,
    synthesizeFallbackWav,
    computeFallbackEmbeddings,
    computeFallbackRerank,
    computeFallbackDecision,
    ensureHalogenModelNodes,
    inspectHalogenCatalogWithStatus,
    downloadHalogenBundle,
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
            const runtime = getLocalEngineStatus({
                totalRamGb: hardware?.totalRamGb,
            });
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
                curated: CURATED_HF_MODELS,
                halogen: {
                    memoryPlan: halogenPlan,
                    catalog: inspectHalogenCatalogWithStatus(),
                    handles: listHalogenSessionHandles(),
                    windowsEnv: inspectWindowsHalogenEnvironment(),
                },
            };
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
            const res = await downloadHalogenBundle({
                models: p.models || p.nodeName || p.model || null,
                token: p.token || '',
                waitForCompletion: p.wait === true || p.wait === 'true',
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
            });
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
            const haloSpec = HALOGEN_MODELS_CATALOG.find(m =>
                (folderName && m.nodeName === folderName)
                || (args.repoId && m.hfRepo === args.repoId)
            );
            const job = await resumeHuggingFaceDownload({
                jobId: args.jobId ?? args.id ?? '',
                folderName,
                repoId: args.repoId || haloSpec?.hfRepo || '',
                quant: args.quant || 'Q8_0',
                token: args.token || '',
                nodeMeta: haloSpec ? {
                    label: haloSpec.label || haloSpec.nodeName,
                    model: haloSpec.model,
                    protocol: 'halogen',
                    icon: haloSpec.icon || 'ai:qwen',
                    modality: haloSpec.modality,
                    capabilities: haloSpec.capabilities,
                    efforts: haloSpec.efforts,
                    maxTokens: haloSpec.maxTokens,
                    maxOutput: haloSpec.maxOutput,
                    baseUrl: haloSpec.baseUrl || HALOGEN_DEFAULT_BASE_URL,
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
});

export function attachTrainerMethods($class) {
    for (const [name, { fn }] of Object.entries(TRAINER_METHODS))
        $class.prototype[name] = fn;
}
