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
    startHuggingFaceDownload,
} from '../sources/modules/trainer/huggingface.js';

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

    it('4. Embed/Rerank: ONNX-пара (model.onnx + model.onnx_data) предпочитается, PyTorch остаётся фоллбэком', () => {
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
        assert.ok(names.includes('onnx/model.onnx'), 'ONNX-граф выбран');
        assert.ok(names.includes('onnx/model.onnx_data'), 'внешние данные ONNX выбраны');
        assert.ok(names.includes('model.safetensors'), 'PyTorch-фоллбэк сохранён');
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
});
