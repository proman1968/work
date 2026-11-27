import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
    TRAINER_METHODS,
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
    listLocalModelsAndAdapters,
    startHuggingFaceDownload,
    listHuggingFaceDownloads,
    resumeHuggingFaceDownload,
    discardHuggingFaceDownload,
} from '../sources/modules/trainer/index.js';
import { encodeTarHeader } from '../sources/modules/trainer/tar-stream.js';
import { MEMBERS } from '../sources/server/access/gateway.js';
import transferHandlerMeta from '../MODELS/Local/$provider/handlers/methods/transfer/$handler/class.js';
import trainerFormMeta from '../$server/$folder/$class/handlers/pages/form/system/$handler/tabs/ai-local.js';

async function createSampleLocalRoot(rootDir) {
    const localRoot = path.join(rootDir, 'MODELS', 'Local');

    // 1. Модель Qwen3-Demo (в канонической структуре: всё внутри $ai)
    const m1Ai = path.join(localRoot, 'Qwen3-Demo', '$ai');
    const m1Weights = path.join(m1Ai, '#weights');
    await fsp.mkdir(m1Weights, { recursive: true });
    await fsp.writeFile(path.join(m1Weights, 'config.json'), '{"arch":"qwen3"}', 'utf-8');
    await fsp.writeFile(path.join(m1Weights, 'model.safetensors'), Buffer.from('SAFETENSORS_WEIGHTS_DEMO_DATA_001'));
    await fsp.writeFile(path.join(m1Weights, 'hf-manifest.json'), JSON.stringify({
        repoId: 'Qwen/Qwen3-Demo',
        modality: 'llm',
        capabilities: ['chat', 'tools'],
    }), 'utf-8');
    await fsp.writeFile(path.join(m1Ai, 'class.js'), `export default ${JSON.stringify({
        label: 'Qwen3 Demo',
        icon: 'ai:qwen',
        protocol: 'local',
        modality: 'llm',
        hfRepo: 'Qwen/Qwen3-Demo',
        weightsDir: 'OLD_MACHINE/MODELS/Local/Qwen3-Demo/$ai/#weights',
        primaryFile: 'model.safetensors',
        capabilities: ['chat', 'stream', 'tools'],
    }, null, 4)};\n`, 'utf-8');

    // 2. Модель с кириллическим именем и адаптером (внутри $provider/#adapters)
    const adDir = path.join(localRoot, '$provider', '#adapters', 'Бухгалтер-LoRA');
    await fsp.mkdir(adDir, { recursive: true });
    await fsp.writeFile(path.join(adDir, 'adapter_config.json'), JSON.stringify({
        name: 'Бухгалтер-LoRA',
        base_model_name_or_path: 'Qwen/Qwen3-Demo',
        mode: 'sft',
    }), 'utf-8');
    await fsp.writeFile(path.join(adDir, 'adapter_model.safetensors'), Buffer.from('LORA_WEIGHTS_12345'));

    // 3. Датасет (внутри $provider/#datasets)
    const dsDir = path.join(localRoot, '$provider', '#datasets');
    await fsp.mkdir(dsDir, { recursive: true });
    await fsp.writeFile(path.join(dsDir, 'org-sft.jsonl'), '{"messages":[]}\n', 'utf-8');
    await fsp.writeFile(path.join(dsDir, 'org-sft.meta.json'), '{"totalExamples":1}', 'utf-8');

    // 4. Рантайм #runtime (внутри $provider/#runtime)
    const rtDir = path.join(localRoot, '$provider', '#runtime', 'bubo');
    await fsp.mkdir(rtDir, { recursive: true });
    await fsp.writeFile(path.join(rtDir, 'bubo.exe'), Buffer.from('MZ_FAKE_BUBO'));

    // 5. Недокачанная модель (.part) и #cache, которые НЕ должны выгружаться
    await fsp.mkdir(path.join(localRoot, 'PartialModel', '$ai', '#weights'), { recursive: true });
    await fsp.writeFile(path.join(localRoot, 'PartialModel', '$ai', '#weights', 'w.gguf.part'), 'partial', 'utf-8');
    await fsp.mkdir(path.join(localRoot, '$provider', '#cache', 'disk'), { recursive: true });
    await fsp.writeFile(path.join(localRoot, '$provider', '#cache', 'disk', 'slot0.bin'), 'cache', 'utf-8');

    return localRoot;
}

describe('Выгрузка и загрузка локальных моделей MODELS/Local на диск/флешку и через .tar', () => {
    it('все методы trainer_transfer_* зарегистрированы в шлюзе gateway.js, а хендлер настроен на /MODELS/Local', () => {
        const expected = [
            'trainer_transfer_roots',
            'trainer_transfer_browse',
            'trainer_transfer_mkdir',
            'trainer_transfer_inventory',
            'trainer_transfer_inspect',
            'trainer_transfer_export',
            'trainer_transfer_import',
            'trainer_transfer_status',
            'trainer_transfer_cancel',
            'trainer_transfer_export_tar',
            'trainer_transfer_import_tar',
        ];
        for (const name of expected) {
            assert.ok(TRAINER_METHODS[name], `${name} должен быть в TRAINER_METHODS`);
            assert.equal(MEMBERS[name], TRAINER_METHODS[name].level, `${name} должен быть в MEMBERS`);
        }
        assert.equal(MEMBERS.trainer_transfer_export_tar, 'read');
        assert.equal(MEMBERS.trainer_transfer_import_tar, 'admin');

        assert.deepEqual(transferHandlerMeta.roles, ['BOSS']);
        assert.equal(transferHandlerMeta.allowUse({ path: '/MODELS/Local' }), true);
        assert.equal(transferHandlerMeta.allowUse({ path: '/MODELS/OpenAI' }), false);
    });

    it('обзорщик дисков и папок возвращает корни, свободное место, создание папки и флаг hasBackup', async () => {
        const roots = await listStorageRoots();
        assert.ok(Array.isArray(roots) && roots.length > 0);
        assert.ok(roots.some(r => r.path));

        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-browse-'));
        try {
            const sub = await createDirectory(tmp, 'UsbBackup');
            assert.ok(sub.path.endsWith('UsbBackup'));
            assert.equal(sub.hasBackup, false);

            await fsp.writeFile(path.join(sub.path, TRANSFER_MANIFEST_FILE), '{"version":1}', 'utf-8');
            const parentInfo = await browseDirectory(tmp);
            const found = parentInfo.dirs.find(d => d.name === 'UsbBackup');
            assert.ok(found?.hasBackup, 'папка с манифестом должна помечаться hasBackup = true');
        }
        finally {
            await fsp.rm(tmp, { recursive: true, force: true });
        }
    });

    it('выгружает модели, адаптеры, датасеты и рантайм на диск с SHA-256 манифестом, исключая #downloads и #cache', async () => {
        const srcRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-src-'));
        const usbDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-usb-'));
        try {
            await createSampleLocalRoot(srcRoot);
            const inv = await listTransferableLocalItems(srcRoot);
            assert.equal(inv.models.length, 1);
            assert.equal(inv.adapters.length, 1);
            assert.equal(inv.datasets.length, 1);
            assert.equal(inv.runtime.present, true);

            const job = await startExportToDisk({
                rootDir: srcRoot,
                targetDir: usbDir,
                includeRuntime: true,
                waitForCompletion: true,
            });
            assert.equal(job.status, 'completed');
            assert.equal(job.progress, 100);
            assert.deepEqual(job.exported.models, ['Qwen3-Demo']);
            assert.deepEqual(job.exported.adapters, ['Бухгалтер-LoRA']);
            assert.deepEqual(job.exported.datasets, ['org-sft']);
            assert.equal(job.exported.runtime, true);

            assert.ok(fs.existsSync(path.join(usbDir, TRANSFER_MANIFEST_FILE)));
            assert.ok(!fs.existsSync(path.join(usbDir, '#downloads')), '#downloads не выгружается');
            assert.ok(!fs.existsSync(path.join(usbDir, '#cache')), '#cache не выгружается');
        }
        finally {
            await fsp.rm(srcRoot, { recursive: true, force: true });
            await fsp.rm(usbDir, { recursive: true, force: true });
        }
    });

    it('импортирует модели с диска на новую машину, пересчитывает пути $ai, пропускает установленные и ловит битые SHA-256', async () => {
        const srcRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-src2-'));
        const usbDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-usb2-'));
        const dstRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-dst2-'));
        try {
            await createSampleLocalRoot(srcRoot);
            await startExportToDisk({ rootDir: srcRoot, targetDir: usbDir, waitForCompletion: true });

            // Инспекция на новой пустой машине
            const infoBefore = await inspectTransferSource(usbDir, dstRoot);
            assert.equal(infoBefore.hasManifest, true);
            assert.equal(infoBefore.models[0].alreadyInstalled, false);

            // Импорт на новую машину
            const imp1 = await startImportFromDisk({
                rootDir: dstRoot,
                sourceDir: usbDir,
                waitForCompletion: true,
            });
            assert.equal(imp1.status, 'completed');
            assert.deepEqual(imp1.imported.models, ['Qwen3-Demo']);

            const localList = await listLocalModelsAndAdapters(dstRoot);
            assert.equal(localList.models.length, 1);
            assert.equal(localList.adapters.length, 1);
            const classContent = await fsp.readFile(path.join(dstRoot, 'MODELS', 'Local', 'Qwen3-Demo', '$ai', 'class.js'), 'utf-8');
            assert.ok(classContent.includes('"weightsDir": "MODELS/Local/Qwen3-Demo/$ai/#weights"'), 'путь weightsDir должен быть обновлён под новую машину');

            // Повторный импорт без overwrite должен пропустить уже установленную модель
            const imp2 = await startImportFromDisk({
                rootDir: dstRoot,
                sourceDir: usbDir,
                overwrite: false,
                waitForCompletion: true,
            });
            assert.equal(imp2.status, 'completed');
            assert.deepEqual(imp2.imported.models, []);
            assert.ok(imp2.skipped.includes('Qwen3-Demo'));

            // Портим файл на флешке и проверяем реакцию контроля целостности при overwrite: true
            await fsp.writeFile(path.join(usbDir, 'Qwen3-Demo', '$ai', '#weights', 'config.json'), '{"arch":"CORRUPTED"}', 'utf-8');
            const impBroken = await startImportFromDisk({
                rootDir: dstRoot,
                sourceDir: usbDir,
                overwrite: true,
                waitForCompletion: true,
            });
            assert.equal(impBroken.status, 'failed');
            assert.match(impBroken.error, /целостност|SHA-256/i);
        }
        finally {
            await fsp.rm(srcRoot, { recursive: true, force: true });
            await fsp.rm(usbDir, { recursive: true, force: true });
            await fsp.rm(dstRoot, { recursive: true, force: true });
        }
    });

    it('потоковый PAX .tar переносит модели и кириллические имена и отклоняет path traversal', async () => {
        const srcRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-tarsrc-'));
        const dstRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-tardst-'));
        try {
            await createSampleLocalRoot(srcRoot);
            const exp = await prepareTarExport({
                rootDir: srcRoot,
                includeRuntime: true,
            });
            assert.ok(exp.contentLength > 1024);

            const imp = await importTarFromStream({
                rootDir: dstRoot,
                readable: exp.stream,
                contentLength: exp.contentLength,
            });
            assert.equal(imp.status, 'completed');
            assert.deepEqual(imp.imported.models, ['Qwen3-Demo']);
            assert.deepEqual(imp.imported.adapters, ['Бухгалтер-LoRA']);
            assert.deepEqual(imp.imported.datasets, ['org-sft']);
            assert.equal(imp.imported.runtime, true);

            // Проверка отклонения path traversal в .tar
            const badStream = new PassThrough();
            const badHdr = encodeTarHeader({ name: '../evil.txt', size: 4, type: '0' });
            const badData = Buffer.alloc(512);
            badData.write('evil', 0, 'utf8');
            badStream.end(Buffer.concat([badHdr, badData, Buffer.alloc(1024)]));

            await assert.rejects(
                () => importTarFromStream({ rootDir: dstRoot, readable: badStream }),
                /Недопустимый путь/i
            );
        }
        finally {
            await fsp.rm(srcRoot, { recursive: true, force: true });
            await fsp.rm(dstRoot, { recursive: true, force: true });
        }
    });

    it('UI-компонент диалога и форма form/trainer корректно подключаются без дублирования', async () => {
        const prevOda = globalThis.ODA;
        const prevWork = globalThis.WORK;
        const defs = [];
        globalThis.ODA = (def) => { defs.push(def); return def; };
        globalThis.WORK = {};
        try {
            const mod = await import('../$server/$folder/lib/local-models-transfer/local-models-transfer.js');
            assert.equal(typeof mod.openLocalModelsTransferDialog, 'function');
            const dlgDef = defs.find(d => d.is === 'item-local-models-transfer');
            assert.ok(dlgDef, 'зарегистрирован компонент item-local-models-transfer');

            const instance = Object.assign(Object.create(dlgDef), {
                inventory: {
                    models: [{ id: 'M1', sizeBytes: 1000 }, { id: 'M2', sizeBytes: 2000 }],
                    adapters: [{ id: 'A1', sizeBytes: 500 }],
                    datasets: [{ id: 'D1', sizeBytes: 250 }],
                    runtime: { present: true, sizeBytes: 300 },
                },
                selectedExportModels: [],
                selectedExportAdapters: [],
                selectedExportDatasets: [],
                exportIncludeRuntime: false,
            });
            instance.selectAllExport(true);
            assert.equal(instance.exportSelectedBytes, 4050);
            instance.toggleId('selectedExportModels', 'M2', false);
            assert.equal(instance.exportSelectedBytes, 2050);

            instance.sourceInfo = {
                models: [
                    { id: 'M1', sizeBytes: 1000, alreadyInstalled: true },
                    { id: 'M3', sizeBytes: 1500, alreadyInstalled: false },
                ],
                adapters: [],
                datasets: [],
                runtime: { present: false },
            };
            instance.selectedImportModels = ['M1', 'M3'];
            instance.selectedImportAdapters = [];
            instance.selectedImportDatasets = [];
            instance.importOverwrite = false;
            assert.equal(instance.importCopyCount, 1);
            assert.equal(instance.importEffectiveBytes, 1500);
            instance.importOverwrite = true;
            assert.equal(instance.importCopyCount, 2);
            assert.equal(instance.importEffectiveBytes, 2500);
        }
        finally {
            globalThis.ODA = prevOda;
            globalThis.WORK = prevWork;
        }

        assert.equal(typeof trainerFormMeta.openTransferDialog, 'function');
        assert.equal(typeof trainerFormMeta.cancelTransfer, 'function');
        assert.ok(trainerFormMeta.template.includes('openTransferDialog'));
        assert.ok(trainerFormMeta.template.includes('activeTransfers'));
    });

    it('авто-ретрай с Range-докачкой, подхват .part после перезапуска и единый список unifiedModels без дублей', async () => {
        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-resume-'));
        try {
            // 1. Авто-ретрай после обрыва потока на 6-м байте из 12
            const fullPayload = Buffer.from('0123456789AB');
            let rangeHeaderSeen = '';
            let fetchCount = 0;
            const retryFetch = async (url, opts = {}) => {
                const u = String(url);
                if (u.includes('/api/models/unsloth/RetryTest-GGUF')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: 'unsloth/RetryTest-GGUF',
                            pipeline_tag: 'text-generation',
                            siblings: [{ rfilename: 'RetryTest-Q8_0.gguf', size: 12 }],
                        }),
                    };
                }
                if (u.includes('/resolve/main/RetryTest-Q8_0.gguf')) {
                    fetchCount++;
                    if (fetchCount === 1) {
                        return {
                            ok: true,
                            status: 200,
                            headers: new Map([['content-length', '12']]),
                            body: (async function* () {
                                yield fullPayload.subarray(0, 6);
                                const e = new Error('socket hang up');
                                e.retryable = true;
                                throw e;
                            })(),
                        };
                    }
                    rangeHeaderSeen = opts.headers?.Range || '';
                    return {
                        ok: true,
                        status: 206,
                        headers: new Map([['content-length', '6']]),
                        body: (async function* () {
                            yield fullPayload.subarray(6);
                        })(),
                    };
                }
                throw new Error('Unexpected URL: ' + u);
            };

            const job = await startHuggingFaceDownload({
                repoId: 'unsloth/RetryTest-GGUF',
                quant: 'Q8_0',
                rootDir: tmpRoot,
                waitForCompletion: true,
                retryBaseDelayMs: 10,
                fetchImpl: retryFetch,
            });
            assert.equal(job.status, 'completed');
            assert.equal(rangeHeaderSeen, 'bytes=6-', 'повторная попытка должна докачивать через Range');
            assert.equal(fs.readFileSync(path.join(tmpRoot, 'MODELS', 'Local', job.folderName, '$ai', '#weights', 'RetryTest-Q8_0.gguf'), 'utf-8'), '0123456789AB');

            // 2. Автомиграция и подхват незавершённого .part из старой #downloads в $ai/#weights
            const legacyPartDir = path.join(tmpRoot, 'MODELS', 'Local', '#downloads', 'Qwen3.8-Flash-Next');
            await fsp.mkdir(legacyPartDir, { recursive: true });
            await fsp.writeFile(path.join(legacyPartDir, 'qwen38-flash-next-ht43.hgn.part'), Buffer.from('ABCDEF'));

            const foundDls = listHuggingFaceDownloads(tmpRoot);
            const legacyDl = foundDls.find(d => d.folderName === 'Qwen3.8-Flash-Next');
            assert.ok(legacyDl, 'недокачанная папка должна быть перенесена в $ai/#weights и подхвачена');
            assert.equal(legacyDl.status, 'paused');
            assert.equal(legacyDl.downloadedBytes, 6);
            assert.equal(fs.existsSync(legacyPartDir), false, 'старая папка #downloads должна быть очищена после миграции');
            assert.ok(fs.existsSync(path.join(tmpRoot, 'MODELS', 'Local', 'Qwen3.8-Flash-Next', '$ai', '#weights', 'qwen38-flash-next-ht43.hgn.part')), 'файл .part перенесён внутрь $ai/#weights');

            // 3. Единый список моделей unifiedModels не дублирует запись из downloads и halogenCatalog
            const trainerHost = Object.assign(Object.create(trainerFormMeta), {
                localModels: [{ id: 'Qwen3-0.6B', label: 'Qwen3-0.6B', path: '/MODELS/Local/Qwen3-0.6B', enabled: true, active: true, sizeGb: 1.2 }],
                downloads: [legacyDl],
                halogenCatalog: [{ nodeName: 'Qwen3.8-Flash-Next', label: 'Qwen3.8-Flash-Next (180B MoE)', hfRepo: 'peonist-ai/halogen-qwen3.8-flash-next', modality: 'llm', ramGb: 62.1, device: 'iGPU', role: 'Основная' }],
                hfModels: [{ id: 'Qwen/Qwen3-4B', modality: 'llm', ramRequiredGb: 3.5, fit: 'optimal', whatItDoes: 'Чат' }],
                hfModality: 'all',
                hfQuery: '',
                hfFilter: 'all',
            });
            const unified = trainerHost.unifiedModels;
            const haloMatches = unified.filter(m => m.id === 'Qwen3.8-Flash-Next');
            assert.equal(haloMatches.length, 1, 'модель не должна дублироваться в едином списке');
            assert.equal(haloMatches[0].state, 'paused');
            assert.equal(trainerHost.formatEta(3665), '~1 ч 1 мин');

            // Сброс недокачанной папки очищает её из $ai/#weights
            await discardHuggingFaceDownload({ folderName: 'Qwen3.8-Flash-Next', rootDir: tmpRoot });
            assert.equal(fs.existsSync(path.join(tmpRoot, 'MODELS', 'Local', 'Qwen3.8-Flash-Next')), false);
            void resumeHuggingFaceDownload;
        }
        finally {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('chat-item[expanded] поднимает z-index и скрывает внешний композер чата', async () => {
        const chatItemSrc = await fsp.readFile(path.join(process.cwd(), '$server/$folder/lib/chat-item/chat-item.js'), 'utf-8');
        const chatSrc = await fsp.readFile(path.join(process.cwd(), '$server/$folder/$class/$structure/handlers/pages/form/chat/$handler/chat.js'), 'utf-8');
        assert.match(chatItemSrc, /:host\(\[expanded\]\)[\s\S]*z-index:\s*30/);
        assert.ok(chatItemSrc.includes('chat-item-expanded'));
        assert.ok(chatSrc.includes('@chat-item-expanded="onCardExpanded($event)"'));
        assert.ok(chatSrc.includes(':hidden="hasExpandedCard"'));
    });
});
