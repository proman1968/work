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
    getHuggingFaceDownload,
    listHuggingFaceDownloads,
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
    startTrainingJob,
    getTrainingJob,
    listTrainingJobs,
    stopTrainingJob,
    publishTrainedAdapter,
} from './runner.js';
import { localStreamChat } from './local-engine.js';

export {
    localStreamChat,
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
    getHuggingFaceDownload,
    listHuggingFaceDownloads,
    cancelHuggingFaceDownload,
    registerLocalModelNode,
    buildWorkDataset,
    listWorkDatasets,
    verifyCompletion,
    scrubSecrets,
    detectHardware,
    listLocalModelsAndAdapters,
    startTrainingJob,
    getTrainingJob,
    listTrainingJobs,
    stopTrainingJob,
    publishTrainedAdapter,
};

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
            return {
                hardware,
                models: local.models,
                adapters: local.adapters,
                datasets,
                downloads: listHuggingFaceDownloads(),
                jobs: listTrainingJobs(),
                modalities: MODEL_MODALITIES,
                capabilities: Object.values(MODEL_CAPABILITIES),
                curated: CURATED_HF_MODELS,
            };
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
            return cancelHuggingFaceDownload(p.jobId ?? p.id);
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
});

export function attachTrainerMethods($class) {
    for (const [name, { fn }] of Object.entries(TRAINER_METHODS))
        $class.prototype[name] = fn;
}
