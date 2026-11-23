/**
 * Раскладка весов локальных моделей: структура подпапок репозитория HF, выбор формата
 * (ONNX-пара для embed/rerank, safetensors/bin для остальных) и автопочинка уже
 * скачанных «сплющенных» папок `$ai/#weights`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import {
    classifyRepoFileKind,
    isUsefulRepoFile,
    safeRepoDestRel,
    selectFilesToDownload,
    detectBrokenWeightsLayout,
    repairLocalModelWeightsIfNeeded,
    startHuggingFaceDownload,
} from '../sources/modules/trainer/huggingface.js';
import { inspectWeightsDirectorySync } from '../sources/modules/trainer/paths.js';

function tmpDir(prefix = 'work-layout-test-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function repoFile(name, size = 100) {
    return { name, size, kind: classifyRepoFileKind(name), quant: '' };
}

async function startMockRepo(files) {
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/api/models/')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'Org/TtsLike',
                siblings: Object.keys(files).map(name => ({ rfilename: name, size: files[name].length })),
            }));
            return;
        }
        const rel = decodeURIComponent((req.url.split('/resolve/main/')[1] || '').split('?')[0]);
        const body = files[rel];
        if (!body) {
            res.writeHead(404);
            res.end('not found');
            return;
        }
        const range = req.headers.range || '';
        const m = /^bytes=(\d+)-(\d+)?/.exec(range);
        if (m) {
            const start = Number(m[1]) || 0;
            const end = m[2] ? Number(m[2]) : body.length - 1;
            const slice = body.subarray(start, Math.min(end + 1, body.length));
            res.writeHead(206, {
                'Content-Type': 'application/octet-stream',
                'Content-Range': `bytes ${start}-${start + slice.length - 1}/${body.length}`,
                'Content-Length': String(slice.length),
                'Accept-Ranges': 'bytes',
            });
            res.end(slice);
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(body.length),
            'Accept-Ranges': 'bytes',
        });
        res.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

describe('trainer-weights-layout: структура репозитория, форматы и автопочинка', () => {
    it('1. Классификация файлов HF не теряет model_index.json, индексы шардов и *.onnx_data', () => {
        assert.equal(classifyRepoFileKind('model.safetensors'), 'safetensors');
        assert.equal(classifyRepoFileKind('pytorch_model.bin'), 'safetensors');
        assert.equal(classifyRepoFileKind('onnx/model.onnx'), 'safetensors');
        assert.equal(classifyRepoFileKind('onnx/model.onnx_data'), 'safetensors');
        assert.equal(classifyRepoFileKind('model_index.json'), 'config');
        assert.equal(classifyRepoFileKind('model.safetensors.index.json'), 'config');
        assert.equal(classifyRepoFileKind('preprocessor_config.json'), 'config');
        assert.equal(classifyRepoFileKind('scheduler_config.json'), 'config');
        assert.equal(classifyRepoFileKind('speech_tokenizer/model.safetensors'), 'safetensors');
        assert.equal(classifyRepoFileKind('tokenizer.model'), 'config');
        assert.equal(classifyRepoFileKind('chat_template.jinja'), 'config');
        assert.equal(classifyRepoFileKind('README.md'), 'other');
        assert.equal(isUsefulRepoFile('README.md'), false);
        assert.equal(isUsefulRepoFile('config.json'), true);
        assert.equal(isUsefulRepoFile('onnx/model.onnx_data'), true);
    });

    it('2. safeRepoDestRel сохраняет подпапки и отбрасывает выход за пределы каталога', () => {
        assert.equal(safeRepoDestRel('speech_tokenizer/model.safetensors'), 'speech_tokenizer/model.safetensors');
        assert.equal(safeRepoDestRel('onnx\\model.onnx_data'), 'onnx/model.onnx_data');
        assert.equal(safeRepoDestRel('../../etc/passwd'), 'etc/passwd');
    });

    it('3. TTS/Diffusers: выбираются веса и конфиги из подпапок, а не только корень', () => {
        const repoMeta = {
            modality: 'tts',
            files: [
                repoFile('config.json', 1000),
                repoFile('model.safetensors', 1000),
                repoFile('speech_tokenizer/config.json', 900),
                repoFile('speech_tokenizer/model.safetensors', 800),
                repoFile('tokenizer.json', 700),
            ],
        };
        const selected = selectFilesToDownload(repoMeta, { modality: 'tts' });
        const names = selected.map(f => f.name).sort();
        assert.deepEqual(names, [
            'config.json',
            'model.safetensors',
            'speech_tokenizer/config.json',
            'speech_tokenizer/model.safetensors',
            'tokenizer.json',
        ]);
    });

    it('4. Embed/Rerank: скачиваются safetensors для единого PyTorch ROCm (без лишних .bin и ONNX/DirectML)', () => {
        const repoMeta = {
            modality: 'embed',
            files: [
                repoFile('config.json'),
                repoFile('model.safetensors'),
                repoFile('pytorch_model.bin'),
                repoFile('onnx/model.onnx'),
                repoFile('onnx/model.onnx_data'),
            ],
        };
        const names = selectFilesToDownload(repoMeta, { modality: 'embed' }).map(f => f.name).sort();
        assert.ok(names.includes('model.safetensors'), 'PyTorch safetensors выбраны');
        assert.ok(!names.includes('onnx/model.onnx'), 'ONNX/DirectML больше не дублирует веса');
        assert.ok(!names.includes('pytorch_model.bin'), 'дублирующий .bin не качается');
    });

    it('5. LLM: при наличии safetensors дублирующие .bin не скачиваются', () => {
        const repoMeta = {
            modality: 'llm',
            files: [repoFile('config.json'), repoFile('model.safetensors'), repoFile('pytorch_model.bin')],
        };
        const names = selectFilesToDownload(repoMeta, { modality: 'llm' }).map(f => f.name).sort();
        assert.deepEqual(names, ['config.json', 'model.safetensors']);
    });

    it('6. detectBrokenWeightsLayout ловит перезаписанный config.json, шарды без индекса и ONNX без *_data', () => {
        const root = tmpDir();
        try {
            const tts = path.join(root, 'tts');
            fs.mkdirSync(tts, { recursive: true });
            fs.writeFileSync(path.join(tts, 'config.json'), JSON.stringify({ model_type: 'qwen3_tts_tokenizer_12hz' }));
            fs.writeFileSync(path.join(tts, 'model.safetensors'), 'w');
            assert.equal(detectBrokenWeightsLayout(tts).broken, true);

            const asr = path.join(root, 'asr');
            fs.mkdirSync(asr, { recursive: true });
            fs.writeFileSync(path.join(asr, 'config.json'), JSON.stringify({ model_type: 'qwen3_asr' }));
            fs.writeFileSync(path.join(asr, 'model-00001-of-00002.safetensors'), 'w');
            fs.writeFileSync(path.join(asr, 'model-00002-of-00002.safetensors'), 'w');
            assert.equal(detectBrokenWeightsLayout(asr).broken, true);

            const embed = path.join(root, 'embed');
            fs.mkdirSync(path.join(embed, 'onnx'), { recursive: true });
            fs.writeFileSync(path.join(embed, 'config.json'), JSON.stringify({ model_type: 'xlm-roberta' }));
            fs.writeFileSync(path.join(embed, 'onnx', 'model.onnx'), 'tiny-graph');
            assert.equal(detectBrokenWeightsLayout(embed).broken, true);

            const healthy = path.join(root, 'healthy');
            fs.mkdirSync(healthy, { recursive: true });
            fs.writeFileSync(path.join(healthy, 'config.json'), JSON.stringify({ model_type: 'qwen3' }));
            fs.writeFileSync(path.join(healthy, 'model.safetensors'), 'w');
            assert.equal(detectBrokenWeightsLayout(healthy).broken, false);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('7. Загрузка сохраняет структуру репозитория (speech_tokenizer/ не затирает корневой config.json)', async () => {
        const payload = {
            'config.json': Buffer.from(JSON.stringify({ model_type: 'qwen3_tts' })),
            'model.safetensors': Buffer.from('main-weights'),
            'speech_tokenizer/config.json': Buffer.from(JSON.stringify({ model_type: 'qwen3_tts_tokenizer_12hz' })),
            'speech_tokenizer/model.safetensors': Buffer.from('tokenizer-weights'),
        };
        const srv = await startMockRepo(payload);
        const root = tmpDir();
        try {
            const job = await startHuggingFaceDownload({
                repoId: 'Org/TtsLike',
                rootDir: root,
                endpointUrl: srv.url,
                fetchImpl: (url, opts) => globalThis.fetch(url, opts),
                targetNodeName: 'TtsLike',
                nodeMeta: { modality: 'tts', capabilities: ['tts'], label: 'TtsLike' },
                registerInWork: false,
                waitForCompletion: true,
                retryBaseDelayMs: 20,
            });
            assert.equal(job.status, 'completed', job.error || '');
            const weights = path.join(root, 'MODELS', 'Local', 'TtsLike', '$ai', '#weights');
            assert.equal(
                fs.readFileSync(path.join(weights, 'config.json'), 'utf8'),
                JSON.stringify({ model_type: 'qwen3_tts' }),
                'корневой config.json не перезаписан конфигом токенизатора',
            );
            assert.equal(fs.readFileSync(path.join(weights, 'model.safetensors'), 'utf8'), 'main-weights');
            assert.equal(
                fs.readFileSync(path.join(weights, 'speech_tokenizer', 'config.json'), 'utf8'),
                JSON.stringify({ model_type: 'qwen3_tts_tokenizer_12hz' }),
            );
            assert.equal(
                fs.readFileSync(path.join(weights, 'speech_tokenizer', 'model.safetensors'), 'utf8'),
                'tokenizer-weights',
            );
        }
        finally {
            await srv.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('8. Готовность весов: фоновая докачка подпапок не помечает модель как «не скачана», незавершённые шарды — помечают', () => {
        const root = tmpDir();
        try {
            // Основные веса на диске, в фоне докачивается speech_tokenizer + состояние paused.
            const tts = path.join(root, 'tts');
            fs.mkdirSync(path.join(tts, 'speech_tokenizer'), { recursive: true });
            fs.writeFileSync(path.join(tts, 'config.json'), JSON.stringify({ model_type: 'qwen3_tts', tts_model_type: 'voice_design' }));
            fs.writeFileSync(path.join(tts, 'model.safetensors'), 'main-weights');
            fs.writeFileSync(path.join(tts, 'speech_tokenizer', 'model.safetensors.part'), 'partial');
            fs.writeFileSync(path.join(tts, 'download-state.json'), JSON.stringify({ status: 'paused' }));
            const info = inspectWeightsDirectorySync(tts, 'win32');
            assert.equal(info.hasReadyWeights, true, 'модель с готовыми основными весами активна');
            assert.equal(info.pendingDownload, true, 'фоновая докачка видна отдельно');

            // Шарды скачаны не все — модель ещё не готова.
            const llm = path.join(root, 'llm');
            fs.mkdirSync(llm, { recursive: true });
            fs.writeFileSync(path.join(llm, 'config.json'), JSON.stringify({ model_type: 'qwen3' }));
            fs.writeFileSync(path.join(llm, 'model-00001-of-00003.safetensors'), 'w');
            fs.writeFileSync(path.join(llm, 'model.safetensors.index.json'), '{}');
            assert.equal(inspectWeightsDirectorySync(llm, 'win32').hasReadyWeights, false);
            fs.writeFileSync(path.join(llm, 'model-00002-of-00003.safetensors'), 'w');
            fs.writeFileSync(path.join(llm, 'model-00003-of-00003.safetensors'), 'w');
            assert.equal(inspectWeightsDirectorySync(llm, 'win32').hasReadyWeights, true);

            // Основной файл ещё качается (.part в корне) — не готова.
            const fresh = path.join(root, 'fresh');
            fs.mkdirSync(fresh, { recursive: true });
            fs.writeFileSync(path.join(fresh, 'model.safetensors.part'), 'partial');
            assert.equal(inspectWeightsDirectorySync(fresh, 'win32').hasReadyWeights, false);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('9. Автопочинка Z-Image-Turbo: мгновенно переносит уже скачанные в корень шарды по подпапкам без их повторного скачивания', async () => {
        const repoFiles = {
            'model_index.json': Buffer.from(JSON.stringify({
                _class_name: 'ZImagePipeline',
                _diffusers_version: '0.33.0',
                transformer: ['diffusers', 'ZImageTransformer2DModel'],
                text_encoder: ['transformers', 'Qwen3Model'],
                vae: ['diffusers', 'AutoencoderKL'],
                tokenizer: ['transformers', 'Qwen2Tokenizer'],
                scheduler: ['diffusers', 'FlowMatchEulerDiscreteScheduler'],
            })),
            'transformer/config.json': Buffer.from(JSON.stringify({ _class_name: 'ZImageTransformer2DModel', hidden_size: 3072 })),
            'transformer/diffusion_pytorch_model.safetensors.index.json': Buffer.from(JSON.stringify({ weight_map: {} })),
            'transformer/diffusion_pytorch_model-00001-of-00001.safetensors': Buffer.from('BIG_TRANSFORMER_WEIGHTS_1234567890'),
            'text_encoder/config.json': Buffer.from(JSON.stringify({ model_type: 'qwen3', hidden_size: 2560 })),
            'text_encoder/model.safetensors.index.json': Buffer.from(JSON.stringify({ weight_map: {} })),
            'text_encoder/model-00001-of-00001.safetensors': Buffer.from('BIG_TEXT_ENCODER_WEIGHTS_0987654321'),
            'vae/config.json': Buffer.from(JSON.stringify({ _class_name: 'AutoencoderKL', latent_channels: 16, extra_pad: true })),
            'vae/diffusion_pytorch_model.safetensors': Buffer.from('BIG_VAE_WEIGHTS_ABCDEF'),
            'tokenizer/tokenizer.json': Buffer.from('{"version":"1.0"}'),
            'scheduler/scheduler_config.json': Buffer.from('{"num_train_timesteps":1000}'),
        };
        const downloadedOverHttp = [];
        const server = http.createServer((req, res) => {
            if (req.url.startsWith('/api/models/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    id: 'Tongyi-MAI/Z-Image-Turbo',
                    pipeline_tag: 'text-to-image',
                    siblings: Object.keys(repoFiles).map(name => ({ rfilename: name, size: repoFiles[name].length })),
                }));
                return;
            }
            const rel = decodeURIComponent((req.url.split('/resolve/main/')[1] || '').split('?')[0]);
            downloadedOverHttp.push(rel);
            const body = repoFiles[rel];
            if (!body) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(body.length),
                'Accept-Ranges': 'bytes',
            });
            res.end(body);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const srvUrl = `http://127.0.0.1:${server.address().port}`;
        const root = tmpDir();
        try {
            const aiDir = path.join(root, 'MODELS', 'Local', 'Z-Image-Turbo', '$ai');
            const weightsDir = path.join(aiDir, '#weights');
            fs.mkdirSync(weightsDir, { recursive: true });
            fs.writeFileSync(path.join(aiDir, 'class.js'), `export default ${JSON.stringify({
                label: 'Z-Image-Turbo 6B (Картинки)',
                protocol: 'local',
                modality: 'image',
                capabilities: ['image', 'text-to-image'],
                hfRepo: 'Tongyi-MAI/Z-Image-Turbo',
            }, null, 2)};\n`);

            // Имитируем старую «сплющенную» раскладку: все тяжёлые веса уже лежат в корне #weights/,
            // а корневой config.json перезаписан конфигом vae/config.json.
            fs.writeFileSync(path.join(weightsDir, 'config.json'), repoFiles['vae/config.json']);
            fs.writeFileSync(
                path.join(weightsDir, 'diffusion_pytorch_model-00001-of-00001.safetensors'),
                repoFiles['transformer/diffusion_pytorch_model-00001-of-00001.safetensors'],
            );
            fs.writeFileSync(
                path.join(weightsDir, 'model-00001-of-00001.safetensors'),
                repoFiles['text_encoder/model-00001-of-00001.safetensors'],
            );
            fs.writeFileSync(
                path.join(weightsDir, 'diffusion_pytorch_model.safetensors'),
                repoFiles['vae/diffusion_pytorch_model.safetensors'],
            );
            fs.writeFileSync(path.join(weightsDir, 'tokenizer.json'), repoFiles['tokenizer/tokenizer.json']);
            fs.writeFileSync(path.join(weightsDir, 'scheduler_config.json'), repoFiles['scheduler/scheduler_config.json']);

            assert.equal(detectBrokenWeightsLayout(weightsDir).broken, true);

            const rep = await repairLocalModelWeightsIfNeeded({
                rootDir: root,
                folderName: 'Z-Image-Turbo',
                force: true,
                waitForCompletion: true,
                fetchImpl: (url, opts) => globalThis.fetch(String(url).replace(/^https:\/\/huggingface\.co/i, srvUrl), opts),
            });
            assert.equal(rep.repaired, true);

            // Ни один из тяжёлых .safetensors не должен был скачиваться по сети — они перенесены локально!
            const safetensorsDownloaded = downloadedOverHttp.filter(f => f.endsWith('.safetensors'));
            assert.deepEqual(safetensorsDownloaded, [], 'тяжёлые веса перенесены через renameSync без повторного скачивания');

            // Проверяем, что все подпапки собраны, а лишний корневой config.json удалён
            assert.equal(fs.existsSync(path.join(weightsDir, 'config.json')), false, 'чужой корневой config.json удалён');
            assert.equal(fs.existsSync(path.join(weightsDir, 'model_index.json')), true, 'model_index.json в корне');
            assert.equal(
                fs.readFileSync(path.join(weightsDir, 'transformer', 'diffusion_pytorch_model-00001-of-00001.safetensors'), 'utf8'),
                'BIG_TRANSFORMER_WEIGHTS_1234567890',
            );
            assert.equal(
                fs.readFileSync(path.join(weightsDir, 'text_encoder', 'model-00001-of-00001.safetensors'), 'utf8'),
                'BIG_TEXT_ENCODER_WEIGHTS_0987654321',
            );
            assert.equal(
                fs.readFileSync(path.join(weightsDir, 'vae', 'diffusion_pytorch_model.safetensors'), 'utf8'),
                'BIG_VAE_WEIGHTS_ABCDEF',
            );
            const afterCheck = detectBrokenWeightsLayout(weightsDir);
            assert.equal(afterCheck.broken, false, `раскладка полностью здорова: ${afterCheck.reasons.join('; ')}`);
        }
        finally {
            await new Promise(resolve => server.close(resolve));
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
