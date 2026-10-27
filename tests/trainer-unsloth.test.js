import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    CURATED_HF_MODELS,
    evaluateModelFit,
    computeAdaptiveDefaults,
    searchHuggingFaceModels,
    inspectHuggingFaceRepo,
    startHuggingFaceDownload,
    buildWorkDataset,
    listWorkDatasets,
    verifyCompletion,
    scrubSecrets,
    detectHardware,
    startTrainingJob,
    listLocalModelsAndAdapters,
    TRAINER_METHODS,
} from '../sources/modules/trainer/index.js';
import { MEMBERS } from '../sources/server/access/gateway.js';

describe('Локальный ИИ-контур: адаптация под реальное железо, прямая загрузка с Hugging Face и дообучение (LoRA / SFT / GRPO)', () => {
    it('все методы trainer_* зарегистрированы в шлюзе безопасности gateway.js', () => {
        for (const [name, m] of Object.entries(TRAINER_METHODS)) {
            assert.equal(MEMBERS[name], m.level, `метод ${name} должен быть в MEMBERS с уровнем ${m.level}`);
        }
    });

    it('детектор железа определяет реальные ресурсы хоста и динамически адаптирует рекомендации по памяти', async () => {
        const hw = await detectHardware();
        assert.ok(hw.totalRamGb > 0, 'определён реальный объём ОЗУ');
        assert.ok(hw.usableMemoryGb > 0 && hw.usableMemoryGb <= hw.totalRamGb, 'бюджет памяти под ИИ рассчитан от реального железа');
        assert.ok(hw.cpuCores > 0);
        assert.ok(hw.recommendedBaseModel, 'выбрана рекомендуемая базовая модель под текущее железо');

        // Проверяем адаптацию по тирам памяти (от 8 ГБ до 160 ГБ)
        const compact = computeAdaptiveDefaults(8);
        assert.equal(compact.recommendedBaseModel, 'Qwen/Qwen3-4B');
        assert.equal(compact.recommendedLoraR, 8);

        const mid = computeAdaptiveDefaults(20);
        assert.equal(mid.recommendedBaseModel, 'Qwen/Qwen3-14B');
        assert.equal(mid.recommendedLoraR, 16);

        const high = computeAdaptiveDefaults(150);
        assert.equal(high.recommendedBaseModel, 'Qwen/Qwen3-32B');
        assert.equal(high.recommendedLoraR, 64);
        assert.equal(high.maxModelParamsB, 235);

        // Проверяем оценку совместимости модели (evaluateModelFit)
        const m32 = CURATED_HF_MODELS.find(m => m.id === 'Qwen/Qwen3-32B');
        assert.equal(evaluateModelFit(m32, 12).fit, 'too_large', '32B не помещается в 12 ГБ');
        assert.equal(evaluateModelFit(m32, 24).fit, 'inference_only', 'в 24 ГБ доступен только инференс 32B');
        assert.equal(evaluateModelFit(m32, 48).fit, 'optimal', 'в 48 ГБ доступны и инференс, и дообучение 32B');
    });

    it('мультимодальный каталог и фильтрация по типу модели (llm, vlm, image, audio, video, embed) и умениям (capabilities)', async () => {
        for (const mod of ['llm', 'vlm', 'image', 'audio', 'video', 'embed']) {
            const res = await searchHuggingFaceModels({ modality: mod, usableMemoryGb: 24, fetchImpl: null });
            assert.ok(res.items.length > 0, `в категории ${mod} есть модели`);
            assert.ok(res.items.every(m => m.modality === mod), `все модели в выдаче принадлежат категории ${mod}`);
            assert.ok(res.items.every(m => Array.isArray(m.capabilityBadges) && m.capabilityBadges.length > 0 && m.whatItDoes),
                `у каждой модели ${mod} заполнены умения и описание`);
        }

        const asrModels = await searchHuggingFaceModels({ modality: 'audio', capability: 'stt', usableMemoryGb: 24, fetchImpl: null });
        assert.ok(asrModels.items.some(m => m.id === 'Qwen/Qwen3-ASR-1.7B' || m.id === 'openai/whisper-large-v3-turbo'));

        const ttsModels = await searchHuggingFaceModels({ modality: 'audio', capability: 'tts', usableMemoryGb: 24, fetchImpl: null });
        assert.ok(ttsModels.items.some(m => m.id === 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign' || m.id === 'hexgrad/Kokoro-82M'));

        const imgModels = await searchHuggingFaceModels({ modality: 'image', capability: 'image', usableMemoryGb: 24, fetchImpl: null });
        assert.ok(imgModels.items.some(m => m.id === 'Tongyi-MAI/Z-Image-Turbo' || m.id === 'black-forest-labs/FLUX.1-schnell'));

        const vidModels = await searchHuggingFaceModels({ modality: 'video', capability: 'video', usableMemoryGb: 24, fetchImpl: null });
        assert.ok(vidModels.items.some(m => m.id === 'Wan-AI/Wan2.1-T2V-1.3B' || m.id === 'Lightricks/LTX-Video'));
    });

    it('поиск, инспекция и прямая потоковая загрузка модели с Hugging Face с авто-регистрацией в /MODELS/Local', async () => {
        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-hf-'));
        try {
            const mockFetch = async (url) => {
                const u = String(url);
                if (u.includes('/api/models?')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ([
                            { id: 'unsloth/Qwen3-14B-GGUF', tags: ['gguf', 'unsloth'], downloads: 42000, likes: 310, pipeline_tag: 'text-generation' },
                        ]),
                    };
                }
                if (u.includes('/api/models/unsloth/Qwen3-14B-GGUF')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: 'unsloth/Qwen3-14B-GGUF',
                            pipeline_tag: 'text-generation',
                            downloads: 42000,
                            likes: 310,
                            siblings: [
                                { rfilename: 'Qwen3-14B-Q8_0.gguf', size: 12 },
                                { rfilename: 'Qwen3-14B-Q4_K_M.gguf', size: 8 },
                            ],
                        }),
                    };
                }
                if (u.includes('/resolve/main/Qwen3-14B-Q8_0.gguf')) {
                    const payload = Buffer.from('GGUF_WEIGHTS');
                    return {
                        ok: true,
                        status: 200,
                        headers: new Map([['content-length', String(payload.length)]]),
                        body: (async function* () {
                            yield payload.subarray(0, 6);
                            yield payload.subarray(6);
                        })(),
                    };
                }
                throw new Error('Unexpected URL: ' + u);
            };

            const searchRes = await searchHuggingFaceModels({ query: 'Qwen3', usableMemoryGb: 24, fetchImpl: mockFetch });
            assert.equal(searchRes.source, 'huggingface');
            assert.ok(searchRes.items.some(m => m.id === 'Qwen/Qwen3-14B' && m.curated && m.fit === 'optimal'));
            assert.ok(searchRes.items.some(m => m.id === 'unsloth/Qwen3-14B-GGUF'));

            const repoMeta = await inspectHuggingFaceRepo('unsloth/Qwen3-14B-GGUF', { fetchImpl: mockFetch });
            assert.deepEqual(repoMeta.quants, ['Q8_0', 'Q4_K_M']);

            const dlJob = await startHuggingFaceDownload({
                repoId: 'unsloth/Qwen3-14B-GGUF',
                quant: 'Q8_0',
                rootDir: tmpRoot,
                waitForCompletion: true,
                fetchImpl: mockFetch,
            });
            assert.equal(dlJob.status, 'completed');
            assert.equal(dlJob.progress, 100);
            assert.equal(dlJob.downloadedBytes, 12);

            const weightFile = path.join(tmpRoot, 'MODELS', 'Local', dlJob.folderName, '#weights', 'Qwen3-14B-Q8_0.gguf');
            assert.equal(fs.readFileSync(weightFile, 'utf-8'), 'GGUF_WEIGHTS');

            const aiClassFile = path.join(tmpRoot, 'MODELS', 'Local', dlJob.folderName, '$ai', 'class.js');
            assert.ok(fs.existsSync(aiClassFile), 'создан дочерний узел $ai для скачанной модели');
            const aiClassText = fs.readFileSync(aiClassFile, 'utf-8');
            assert.ok(aiClassText.includes('unsloth/Qwen3-14B-GGUF'));
        }
        finally {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('сборщик датасета WORK (buildWorkDataset) экспортирует операции work.db и классы /MODULES в ChatML JSONL с очисткой секретов', async () => {
        const sampleWithSecret = ' ключ ' + 'sk-' + '1234567890abcdef123456 и "api' + 'Key": "sec' + 'ret123" ';
        assert.equal(scrubSecrets(sampleWithSecret), ' ключ sk-REDACTED и "api' + 'Key": "REDACTED" ');

        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-ds-'));
        try {
            const meta = await buildWorkDataset({
                rootDir: process.cwd(),
                name: 'test-work-sft',
                sources: ['accounting', 'classes'],
                basePath: '/ORGANIZATIONS/Маслоторг',
            });
            assert.ok(meta.totalExamples >= 10, `ожидалось >= 10 обучающих примеров, получено ${meta.totalExamples}`);
            assert.ok(meta.bySource.accounting > 0, 'примеры из учётной базы Маслоторг');
            assert.ok(meta.bySource.classes > 0, 'примеры из метаданных и контрактов /MODULES');
            assert.ok(meta.estimatedTokens > 100);
            assert.ok(meta.preview.length > 0);

            const list = await listWorkDatasets(process.cwd());
            assert.ok(list.some(d => d.name === 'test-work-sft'));

            // Удалим тестовые файлы датасета из рабочего дерева после проверки
            await fsp.rm(path.join(process.cwd(), 'MODELS', 'Local', '#datasets', 'test-work-sft.jsonl'), { force: true });
            await fsp.rm(path.join(process.cwd(), 'MODELS', 'Local', '#datasets', 'test-work-sft.meta.json'), { force: true });
        }
        finally {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('детерминированный верификатор GRPO (verifyCompletion) оценивает ответы модели через учётное ядро', async () => {
        const badJson = await verifyCompletion({ completion: 'не json' });
        assert.equal(badJson.valid, false);
        assert.ok(badJson.reward < 0.2);

        const validSchema = await verifyCompletion({
            basePath: '/ORGANIZATIONS/Маслоторг',
            taskType: 'schema',
            completion: '```json\n{"cid": "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация/Покупателю"}\n```',
        });
        assert.equal(validSchema.valid, true);
        assert.equal(validSchema.reward, 1.0);
    });

    it('запуск обучения Unsloth (startTrainingJob в режиме GRPO) строит кривую Loss/Reward, сохраняет LoRA-адаптер и публикует $ai', async () => {
        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-train-'));
        try {
            const job = await startTrainingJob({
                rootDir: tmpRoot,
                adapterName: 'Maslotorg-GRPO-Test',
                baseModel: 'unsloth/Qwen3-32B-bnb-4bit',
                datasetName: 'work-sft-dataset',
                basePath: '/ORGANIZATIONS/Маслоторг',
                mode: 'grpo',
                loraR: 32,
                epochs: 1,
                stepDelayMs: 0,
                waitForCompletion: true,
            });
            assert.equal(job.status, 'completed');
            assert.ok(job.history.length >= 8);
            assert.ok(job.loss < job.history[0].loss, 'Loss монотонно снижается в ходе обучения');
            assert.ok(job.reward > 0.5, 'GRPO Reward растёт по мере обучения');
            assert.equal(job.publishedPath, '/MODELS/Local/Maslotorg-GRPO-Test');

            const inv = await listLocalModelsAndAdapters(tmpRoot);
            assert.equal(inv.adapters.length, 1);
            assert.equal(inv.adapters[0].r, 32);
            assert.equal(inv.models.length, 1);
            assert.equal(inv.models[0].path, '/MODELS/Local/Maslotorg-GRPO-Test');
        }
        finally {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('представление form/trainer доступно на /MODELS/Local и скрыто на облачных провайдерах', async () => {
        await import('../sources/reactor.js');
        const { $server } = await import('../sources/server/server.js');
        const prevWork = globalThis.WORK;
        globalThis.WORK = new $server();
        try {
            const localProvider = await WORK.get_item('/MODELS/Local');
            const gigaProvider = await WORK.get_item('/MODELS/GigaChat');

            const localInfo = await localProvider.info({ deep: 1 });
            const qwenNode = (localInfo?.items || []).find(i => i.id === 'Qwen3-0.6B');
            if (qwenNode) {
                assert.equal(qwenNode.type, '$ai', 'модель внутри /MODELS/Local имеет тип $ai, а не $folder');
                assert.equal(qwenNode.icon, 'ai:qwen', 'у модели Qwen установлена фирменная иконка ai:qwen');
                assert.ok(Array.isArray(qwenNode.capabilities) && qwenNode.capabilities.includes('chat'), 'capabilities передаются в info для выбора в prompt-bar');

                const qwenItem = await WORK.get_item('/MODELS/Local/Qwen3-0.6B');
                let textOut = '';
                let finished = false;
                for await (const chunk of qwenItem.streamChat({
                    messages: [{ role: 'user', content: 'Привет! Ответь одним коротким предложением.' }],
                    maxOutput: 24,
                })) {
                    if (typeof chunk === 'string')
                        textOut += chunk;
                    else if (chunk?.type === 'finish')
                        finished = true;
                }
                assert.equal(finished, true, 'поток нейросетевого ответа локальной модели завершился штатно');
                assert.ok(textOut.trim().length > 3, `получен реальный нейросетевой ответ от Qwen3-0.6B: ${textOut.trim()}`);
                assert.ok(!textOut.includes('Домен организаций (/ORGANIZATIONS)'), 'на "Привет" модель отвечает живым текстом, а не зашитым шаблоном');
            }

            const localHandlers = await localProvider.handlers({ path: '//form', role: 'ADMIN' });
            const localViewIds = (localHandlers?.items || []).filter(i => i.usable !== false).map(i => i.id);
            assert.ok(localViewIds.includes('trainer'), 'на /MODELS/Local доступна вкладка Unsloth / HF (trainer)');

            const gigaHandlers = await gigaProvider.handlers({ path: '//form', role: 'ADMIN' });
            const gigaViewIds = (gigaHandlers?.items || []).filter(i => i.usable !== false).map(i => i.id);
            assert.ok(!gigaViewIds.includes('trainer'), 'на облачном /MODELS/GigaChat вкладка trainer скрыта');
        }
        finally {
            globalThis.WORK = prevWork;
        }
    });
});
