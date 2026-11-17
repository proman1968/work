import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    HALOGEN_MODELS_CATALOG,
    BUBO_WINDOWS_RELEASE,
    getHalogenCatalogForPlatform,
    checkWindowsHalogenPreflight,
    computeHalogenMemoryPlan,
    inspectWindowsHalogenEnvironment,
    prepareWindowsBuboRuntime,
    startHalogenBackend,
    stopHalogenBackend,
    ensureHalogenBackendRunning,
    probeHalogenServer,
    normalizeHalogenTtsPayload,
    recordHalogenSessionHandle,
    listHalogenSessionHandles,
    releaseHalogenSessionHandle,
    ensureHalogenModelNodes,
    inspectHalogenCatalogWithStatus,
    downloadHalogenBundle,
    searchHuggingFaceModels,
    startHuggingFaceDownload,
    evaluateAiNodeActivitySync,
    localStreamChat,
} from '../sources/modules/trainer/index.js';
import { selectFilesToDownload } from '../sources/modules/trainer/huggingface.js';
import { listLocalModelsAndAdapters } from '../sources/modules/trainer/runner.js';

describe('Единый локальный контур /MODELS/Local для машинок Halo (AMD Ryzen AI Max+ PRO 495 · 192 ГБ RAM: Linux + Windows 11 + WORK Fallback)', () => {
    let WORK;
    let mockServer;
    let mockPort = 0;
    const capturedRequests = [];
    const virtualHaloNodes = new Map();
    let origGetItem = null;

    before(async () => {
        const { $server } = await import('../sources/server/server.js');
        const { default: aiProto } = await import('../MODELS/$ai/$folder/$class/$ai/class.js');
        if (!globalThis.WORK)
            globalThis.WORK = new $server();
        WORK = globalThis.WORK;

        for (const spec of HALOGEN_MODELS_CATALOG) {
            const node = Object.assign(Object.create(aiProto), {
                id: spec.nodeName,
                label: spec.label || spec.nodeName,
                type: '$ai',
                path: spec.path,
                short: spec.path,
                protocol: 'halogen',
                model: spec.model,
                modality: spec.modality,
                maxTokens: spec.maxTokens,
                maxOutput: spec.maxOutput,
                capabilities: spec.capabilities,
                efforts: spec.efforts || [],
                baseUrl: spec.baseUrl || 'http://127.0.0.1:8731/v1/chat/completions',
                init: Promise.resolve(),
            });
            node.DATA = { ...node };
            virtualHaloNodes.set(spec.path, node);
        }

        origGetItem = WORK.get_item.bind(WORK);
        WORK.get_item = async function (p, ...rest) {
            if (typeof p === 'string' && virtualHaloNodes.has(p))
                return virtualHaloNodes.get(p);
            return origGetItem(p, ...rest);
        };

        // Поднимаем локальный HTTP-сервер, эмулирующий API halogen-flash-server (:8731)
        mockServer = http.createServer(async (req, res) => {
            const chunks = [];
            for await (const c of req)
                chunks.push(c);
            const rawBody = Buffer.concat(chunks);
            const url = req.url || '/';

            capturedRequests.push({
                method: req.method,
                url,
                headers: req.headers,
                rawBody,
            });

            if (req.method === 'GET' && url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    version: { frontend: '0.19.1', engine: '0.19.1' },
                    capability_probe: 'ok',
                    thinking_answer_room: 1024,
                    max_tokens_default: 32768,
                    queued: 0,
                    longest_wait_s: 0,
                }));
                return;
            }

            if (req.method === 'GET' && url === '/cache') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    hit_rate: 0.91,
                    token_hit_rate: 0.96,
                    pool: {
                        positions: 524288,
                        used: 65536,
                        usage_ratio: 0.125,
                        busy_regions: 1,
                        held_regions: 2,
                    },
                }));
                return;
            }

            if (req.method === 'GET' && url === '/v1/models') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    object: 'list',
                    data: HALOGEN_MODELS_CATALOG.map(m => ({ id: m.model, object: 'model' })),
                }));
                return;
            }

            if (req.method === 'GET' && url === '/halogen/handles') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    handles: [{ name: 'work-main-session', tokens: 12400 }],
                }));
                return;
            }

            if (req.method === 'POST' && url === '/v1/chat/completions') {
                const body = JSON.parse(rawBody.toString('utf-8') || '{}');
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    ...(req.headers['x-halogen-from'] ? { 'X-Halogen-From': 'used' } : {}),
                });
                const writeSse = obj => res.write('data: ' + JSON.stringify(obj) + '\n\n');
                if (body.enable_thinking !== false) {
                    writeSse({ choices: [{ delta: { reasoning_content: 'Проверяю KV-пул и регистры... ' } }] });
                }
                if (req.headers['x-halogen-guard']) {
                    writeSse({ halogen_guard: { event: 'user', risk: 'Safe', prob: 0.01 } });
                }
                writeSse({ choices: [{ delta: { content: 'Ответ от Halogen Flash.' }, finish_reason: 'stop' }] });
                writeSse({
                    usage: {
                        prompt_tokens: 4200,
                        completion_tokens: 18,
                        total_tokens: 4218,
                        completion_tokens_details: { reasoning_tokens: 6 },
                    },
                    timings: {
                        prompt_n: 200,
                        cache_n: 4000,
                        predicted_n: 18,
                        prompt_per_second: 1780.5,
                        predicted_per_second: 78.4,
                    },
                });
                res.write('data: [DONE]\n\n');
                res.end();
                return;
            }

            if (req.method === 'POST' && url === '/v1/audio/speech') {
                const wav = Buffer.alloc(128);
                wav.write('RIFF', 0, 'ascii');
                wav.writeUInt32LE(120, 4);
                wav.write('WAVEfmt ', 8, 'ascii');
                res.writeHead(200, { 'Content-Type': 'audio/wav' });
                res.end(wav);
                return;
            }

            if (req.method === 'POST' && url === '/v1/audio/transcriptions') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ text: 'Проведи поступление товаров на основной склад' }));
                return;
            }

            if (req.method === 'POST' && url === '/v1/images/generations') {
                // Валидный 1x1 PNG в base64 (>80 байт с заголовком iVBORw0KGgo)
                const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='.padEnd(96, 'A');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ data: [{ b64_json: b64 }] }));
                return;
            }

            if (req.method === 'POST' && url === '/v1/embeddings') {
                const body = JSON.parse(rawBody.toString('utf-8') || '{}');
                const inputs = Array.isArray(body.input) ? body.input : [body.input];
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    object: 'list',
                    model: body.model,
                    data: inputs.map((_, index) => ({ object: 'embedding', index, embedding: [0.6, 0.8, 0.0] })),
                }));
                return;
            }

            if (req.method === 'POST' && url === '/v1/rerank') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    model: 'qwen3-reranker-0.6b',
                    results: [{ index: 1, relevance_score: 0.97, document: { text: 'Счёт 41 — Товары на складах' } }],
                }));
                return;
            }

            if (req.method === 'POST' && url === '/v1/systemone') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    model: 'decider-0.8b',
                    answers: {
                        department: { choice: 'accounting', confidence: 0.94, probabilities: { accounting: 0.94, sales: 0.06 } },
                    },
                }));
                return;
            }

            res.writeHead(404);
            res.end();
        });

        await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
        mockPort = mockServer.address().port;
    });

    after(async () => {
        if (origGetItem && WORK)
            WORK.get_item = origGetItem;
        if (mockServer) {
            mockServer.closeAllConnections?.();
            await new Promise(resolve => mockServer.close(resolve));
        }
    });

    it('1. Провайдер /MODELS/Local в чистой поставке пуст, поддерживает установку всех 8 моделей Halo (iGPU Flash + 7 NPU) и вкладку trainer', async () => {
        const provider = await WORK.get_item('/MODELS/Local');
        assert.ok(provider, 'узел /MODELS/Local существует');
        await provider.init;
        assert.equal(provider.type, '$provider');
        assert.equal(provider.protocol, 'local');

        const tmpCheck = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-halo-nodes-'));
        try {
            const registered = await ensureHalogenModelNodes(tmpCheck, { onlyWithWeights: false });
            assert.equal(registered.length, 8, 'все 8 моделей Halo регистрируются в /MODELS/Local');
            for (const spec of HALOGEN_MODELS_CATALOG) {
                assert.ok(fs.existsSync(path.join(tmpCheck, 'MODELS', 'Local', spec.nodeName, '$ai', 'class.js')), `создан $ai/class.js для ${spec.nodeName}`);
                const modelNode = await WORK.get_item(spec.path);
                await modelNode.init;
                assert.equal(modelNode.type, '$ai');
                assert.equal(modelNode.model, spec.model);
                assert.equal(modelNode.protocol, 'halogen');
            }
        }
        finally {
            await fsp.rm(tmpCheck, { recursive: true, force: true });
        }

        // Представление form/trainer доступно на /MODELS/Local
        const handlers = await provider.handlers({ path: '//form', role: 'BOSS' });
        const viewIds = (handlers?.items || []).filter(i => i.usable !== false).map(i => i.id);
        assert.ok(viewIds.includes('trainer'), 'на /MODELS/Local доступна вкладка trainer');
    });

    it('2. План памяти computeHalogenMemoryPlan для AMD Ryzen AI Max+ PRO 495 (192 ГБ) разделяет настройки Linux (halogen-flash-server) и Windows 11 Native (Halowin Bubo / Gufo ROCm 10.0 gfx1151)', () => {
        const planWin = computeHalogenMemoryPlan({ totalRamGb: 192, platform: 'win32' });
        assert.equal(planWin.kvPoolPositions, 524288);
        assert.equal(planWin.kvSlots, 4);
        assert.equal(planWin.maxTok, 32768);
        assert.equal(planWin.flashWeightsGb, 62.1);
        assert.equal(planWin.deviceSideGb, 27.0);
        assert.equal(planWin.halogenCoreGb, 89.1);
        assert.equal(planWin.lookupTableGb, 47.7);
        assert.equal(planWin.lookupFitsInRam, true, 'на 192 ГБ вся 47.7 ГБ lookup-таблица помещается в ОЗУ вместе с NPU-моделями');
        assert.ok(planWin.npuSidecarGb >= 20, 'учтён объём всех 7 NPU-моделей');
        assert.ok(planWin.hostFreeForWorkGb >= 30, 'остаётся >30 ГБ свободной памяти под ОС и сервер WORK');
        assert.equal(planWin.windowsGpuMemoryGb, 128);
        assert.equal(planWin.windowsPageFileMb, 131072);
        assert.match(planWin.wslWarning, /WSL2/);
        assert.match(planWin.biosRecommendation, /131072/);
        assert.match(planWin.linuxCommand, /ghcr\.io\/peonist-ai\/halogen-flash-server:0\.20\.3/);
        assert.match(planWin.windowsPrepareCommand, /bubo\.exe prepare runtime/);
        assert.match(planWin.windowsCommand, /bubo\.exe serve llm/);
        assert.match(planWin.windowsCommand, /--profile subagents/);
        assert.match(planWin.windowsCommand, /--npu-prefill on/);
        assert.match(planWin.windowsGufoServicesCommand, /gufo\.exe serve asr/);

        const planLinux = computeHalogenMemoryPlan({ totalRamGb: 128, platform: 'linux' });
        assert.equal(planLinux.windowsGpuMemoryGb, 96);
        assert.match(planLinux.biosRecommendation, /Minimum \(512 MB/);
    });

    it('3. Прямая работа с сервером Halogen: /health, /cache, X-Halogen-Keep/From, continue_final_message, timings, NPU TTS/STT/Image/Embed/Rerank/Decide', async () => {
        const testBaseUrl = `http://127.0.0.1:${mockPort}/v1/chat/completions`;

        // 3.1. Опрос состояния сервера
        const probe = await probeHalogenServer(testBaseUrl);
        assert.equal(probe.online, true);
        assert.equal(probe.mode, 'halogen-native');
        assert.equal(probe.cache.pool.positions, 524288);
        assert.ok(probe.remoteModels.includes('halogen-qwen3.8-flash-next'));
        assert.ok(probe.remoteModels.includes('qwen3-tts-1.7b-customvoice'));

        // 3.2. Стриминговый чат с заголовками сессий X-Halogen-Keep / X-Halogen-From и continue_final_message
        const flashModel = await WORK.get_item('/MODELS/Local/Qwen3.8-Flash-Next');
        await flashModel.init;
        const origBase = flashModel.baseUrl;
        flashModel.baseUrl = testBaseUrl;

        try {
            const events = [];
            for await (const ev of flashModel.streamChat({
                messages: [{ role: 'user', content: 'Проверь баланс по счёту 51' }],
                effort: 'medium',
                halogenKeep: 'work-task-1',
                halogenFrom: 'work-task-0',
                halogenGuard: true,
                continueFinalMessage: true,
            })) {
                events.push(ev);
            }

            const chatReq = capturedRequests.find(r => r.url === '/v1/chat/completions');
            assert.ok(chatReq, 'запрос /v1/chat/completions отправлен');
            assert.equal(chatReq.headers['x-halogen-keep'], 'work-task-1');
            assert.equal(chatReq.headers['x-halogen-from'], 'work-task-0');
            assert.equal(chatReq.headers['x-halogen-guard'], 'watch');

            const sentBody = JSON.parse(chatReq.rawBody.toString('utf-8'));
            assert.equal(sentBody.reasoning_effort, 'medium');
            assert.equal(sentBody.enable_thinking, true);
            assert.equal(sentBody.continue_final_message, true);
            assert.equal(sentBody.add_generation_prompt, false);

            const textChunks = events.filter(e => typeof e === 'string').join('');
            assert.equal(textChunks, 'Ответ от Halogen Flash.');
            assert.ok(events.some(e => e?.type === 'reasoning' && e.content.includes('Проверяю KV-пул')));
            assert.ok(events.some(e => e?.type === 'guard' && e.guard?.risk === 'Safe'));

            const usageEv = events.find(e => e?.type === 'usage');
            assert.ok(usageEv, 'получена телеметрия usage');
            assert.equal(usageEv.cached_tokens, 4000, 'cached_tokens заполнен из timings.cache_n');
            assert.equal(usageEv.halogen_from, 'used', 'прочитан ответный заголовок X-Halogen-From: used');
            assert.equal(usageEv.timings.predicted_per_second, 78.4);
        }
        finally {
            flashModel.baseUrl = origBase;
        }

        // 3.3. NPU TTS (`qwen3-tts-1.7b-customvoice`)
        const ttsModel = await WORK.get_item('/MODELS/Local/Qwen3-TTS-NPU');
        await ttsModel.init;
        ttsModel.baseUrl = `http://127.0.0.1:${mockPort}/v1/audio/speech`;
        try {
            const wavBuf = await ttsModel.speak({ text: 'Добрый день, отчёт готов.', language: 'ru', voice: 'unknown-voice' });
            assert.equal(wavBuf.toString('ascii', 0, 4), 'RIFF');
            const ttsReq = capturedRequests.find(r => r.url === '/v1/audio/speech');
            const ttsBody = JSON.parse(ttsReq.rawBody.toString('utf-8'));
            assert.equal(ttsBody.model, 'qwen3-tts-1.7b-customvoice');
            assert.equal(ttsBody.voice, 'serena', 'неизвестный голос нормализован в допустимый пресет serena');
            assert.equal(ttsBody.language, 'russian', 'код языка ru нормализован в russian для Halogen NPU');
            assert.equal(ttsBody.task_type, undefined, 'лишние поля шлюза не отправляются в Halogen NPU');
        }
        finally {
            ttsModel.baseUrl = 'http://127.0.0.1:8731/v1/audio/speech';
        }

        // 3.4. NPU STT (`qwen3-asr-1.7b`)
        const sttModel = await WORK.get_item('/MODELS/Local/Qwen3-ASR-NPU');
        await sttModel.init;
        sttModel.baseUrl = `http://127.0.0.1:${mockPort}/v1/audio/transcriptions`;
        try {
            const fakeWav = Buffer.from('RIFFxxxxWAVEfmt ');
            const tr = await sttModel.transcribe({ audio: fakeWav, language: 'ru' });
            assert.equal(tr.text, 'Проведи поступление товаров на основной склад');
            const sttReq = capturedRequests.find(r => r.url === '/v1/audio/transcriptions');
            const rawStr = sttReq.rawBody.toString('utf-8');
            assert.ok(!rawStr.includes('name="temperature"'), 'для Halogen NPU ASR не передаётся поле temperature');
        }
        finally {
            sttModel.baseUrl = 'http://127.0.0.1:8731/v1/audio/transcriptions';
        }

        // 3.5. NPU Image (`flux2-klein-4b`), Embeddings, Rerank, SystemOne Decide
        const imgModel = await WORK.get_item('/MODELS/Local/Flux2-Klein-NPU');
        await imgModel.init;
        imgModel.baseUrl = `http://127.0.0.1:${mockPort}/v1/images/generations`;
        try {
            const pic = await imgModel.generateImage({ prompt: 'Иконка склада с коробками', seed: 7 });
            assert.equal(pic.mime, 'image/png');
            assert.equal(pic.model, 'flux2-klein-4b');
        }
        finally {
            imgModel.baseUrl = 'http://127.0.0.1:8731/v1/images/generations';
        }

        const embModel = await WORK.get_item('/MODELS/Local/Qwen3-Embedding-NPU');
        await embModel.init;
        embModel.baseUrl = `http://127.0.0.1:${mockPort}/v1/embeddings`;
        try {
            const emb = await embModel.embed({ input: 'Договор поставки подсолнечного масла' });
            assert.equal(emb.data.length, 1);
            assert.deepEqual(emb.data[0].embedding, [0.6, 0.8, 0.0]);
        }
        finally {
            embModel.baseUrl = 'http://127.0.0.1:8731/v1/embeddings';
        }

        const rerankModel = await WORK.get_item('/MODELS/Local/Qwen3-Reranker-NPU');
        await rerankModel.init;
        rerankModel.baseUrl = `http://127.0.0.1:${mockPort}/v1/rerank`;
        try {
            const rr = await rerankModel.rerank({ query: 'товары на складе', documents: ['Касса', 'Счёт 41 — Товары на складах'] });
            assert.equal(rr.results[0].index, 1);
        }
        finally {
            rerankModel.baseUrl = 'http://127.0.0.1:8731/v1/rerank';
        }

        const deciderModel = await WORK.get_item('/MODELS/Local/Decider-NPU');
        await deciderModel.init;
        deciderModel.baseUrl = `http://127.0.0.1:${mockPort}/v1/systemone`;
        try {
            const dec = await deciderModel.decide({
                state: 'Нужно сверить оборотно-сальдовую ведомость по счёту 60',
                questions: { department: { type: 'choice', criteria: { accounting: 'Бухгалтерия', sales: 'Продажи' } } },
            });
            assert.equal(dec.answers.department.choice, 'accounting');
        }
        finally {
            deciderModel.baseUrl = 'http://127.0.0.1:8731/v1/systemone';
        }
    });

    it('4. Встроенный гибридный фоллбэк на Windows (при закрытом порте :8731): сессии KV, TTS WAV, Embeddings, Rerank и Decide работают автономно', async () => {
        const closedUrl = 'http://127.0.0.1:59997/v1/chat/completions';

        // 4.1. Проверка записи и переиспользования именных снимков сессий (X-Halogen-Keep / X-Halogen-From)
        const s1 = recordHalogenSessionHandle({
            keep: 'work-hybrid-test',
            messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'привет' }],
            tokens: 512,
        });
        assert.equal(s1.fromStatus, null);

        const s2 = recordHalogenSessionHandle({
            from: 'work-hybrid-test',
            messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'привет' }, { role: 'user', content: 'подзадача субагента' }],
            tokens: 600,
        });
        assert.equal(s2.fromStatus, 'used');
        assert.equal(s2.cachedTokens, 512);
        assert.ok(listHalogenSessionHandles().some(h => h.name === 'work-hybrid-test'));
        releaseHalogenSessionHandle('work-hybrid-test');

        // 4.2. Автономный фоллбэк TTS WAV 24 кГц
        const ttsModel = await WORK.get_item('/MODELS/Local/Qwen3-TTS-NPU');
        await ttsModel.init;
        ttsModel.baseUrl = closedUrl;
        try {
            const wav = await ttsModel.speak({ text: 'Проверка встроенного голосового синтеза на Windows' });
            assert.ok(Buffer.isBuffer(wav) && wav.length > 64);
            assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
            assert.equal(wav.readUInt32LE(24), 24000, 'частота дискретизации WAV — 24 кГц');
        }
        finally {
            ttsModel.baseUrl = 'http://127.0.0.1:8731/v1/audio/speech';
        }

        // 4.3. Автономный фоллбэк Embeddings, Rerank и Decide
        const embModel = await WORK.get_item('/MODELS/Local/Qwen3-Embedding-NPU');
        embModel.baseUrl = closedUrl;
        try {
            const emb = await embModel.embed({ input: ['Счёт 51 Расчётные счета', 'Счёт 41 Товары'], dimensions: 128 });
            assert.equal(emb.data.length, 2);
            assert.equal(emb.data[0].embedding.length, 128);
            const norm = Math.sqrt(emb.data[0].embedding.reduce((s, v) => s + v * v, 0));
            assert.ok(Math.abs(norm - 1.0) < 0.01, 'эмбеддинг нормализован к единичной длине');
        }
        finally {
            embModel.baseUrl = 'http://127.0.0.1:8731/v1/embeddings';
        }

        const rerankModel = await WORK.get_item('/MODELS/Local/Qwen3-Reranker-NPU');
        rerankModel.baseUrl = closedUrl;
        try {
            const rr = await rerankModel.rerank({
                query: 'оплата поставщику с расчётного счёта',
                documents: ['Приём сотрудника в штат', 'Платёжное поручение: оплата поставщику с расчётного счёта'],
            });
            assert.equal(rr.results[0].index, 1, 'релевантный документ ранжирован на 1-е место');
        }
        finally {
            rerankModel.baseUrl = 'http://127.0.0.1:8731/v1/rerank';
        }

        const deciderModel = await WORK.get_item('/MODELS/Local/Decider-NPU');
        deciderModel.baseUrl = closedUrl;
        try {
            const dec = await deciderModel.decide({
                state: 'Клиент просит срочный возврат средств по счёту',
                questions: {
                    refund: { type: 'noul', instructions: 'Просит ли клиент возврат?' },
                    team: { type: 'choice', criteria: { возврат: 'Отдел возвратов', склад: 'Склад' } },
                },
            });
            assert.equal(dec.answers.refund.choice, 'yes');
            assert.equal(dec.answers.team.choice, 'возврат');
        }
        finally {
            deciderModel.baseUrl = 'http://127.0.0.1:8731/v1/systemone';
        }
    });

    it('5. Интеграция с агентским циклом WORK (llmFor + runLoop): передача X-Halogen-Keep родителем и X-Halogen-From субагентом', async () => {
        const { llmFor, runLoop } = await import('../sources/modules/agent/index.js');
        const flashModel = await WORK.get_item('/MODELS/Local/Qwen3.8-Flash-Next');
        await flashModel.init;
        const origBase = flashModel.baseUrl;
        flashModel.baseUrl = `http://127.0.0.1:${mockPort}/v1/chat/completions`;

        try {
            const llm = await llmFor('/MODELS/Local/Qwen3.8-Flash-Next');
            assert.equal(llm.fork, true, 'у адаптера модели Halogen включён флаг fork');
            assert.equal(llm.vision, true, 'у адаптера модели Halogen включён флаг vision');
            assert.equal(llm.contextTokens, 262144);

            capturedRequests.length = 0;

            // Ход основного агента (depth = 0)
            const mainItems = [{ id: 'u1', type: 'user', content: 'Сделай сверку', time: Date.now() }];
            const mainRes = await runLoop({
                llm,
                items: mainItems,
                system: 'System prompt',
                tools: [],
                host: { mode: 'auto', save: async () => {}, emit: () => {} },
                ctx: { task: { path: '/USERS/admin/task/2026-11-07/1001.task' } },
                depth: 0,
            });
            assert.equal(mainRes.status, 'done');
            const parentReq = capturedRequests.find(r => r.url === '/v1/chat/completions');
            assert.ok(parentReq?.headers['x-halogen-keep']?.startsWith('work-'), 'основной агент передал X-Halogen-Keep');

            capturedRequests.length = 0;

            // Ход субагента (depth = 1) той же задачи
            const subItems = [{ id: 'u2', type: 'user', content: 'Подзадача субагента', time: Date.now() }];
            const subRes = await runLoop({
                llm,
                items: subItems,
                system: 'Subagent system prompt',
                tools: [],
                host: { mode: 'auto', save: async () => {}, emit: () => {} },
                ctx: { task: { path: '/USERS/admin/task/2026-11-07/1001.task' } },
                depth: 1,
            });
            assert.equal(subRes.status, 'done');
            const subReq = capturedRequests.find(r => r.url === '/v1/chat/completions');
            assert.equal(
                subReq?.headers['x-halogen-from'],
                parentReq.headers['x-halogen-keep'],
                'субагент передал X-Halogen-From с тем же ключом KV-сессии родителя'
            );
        }
        finally {
            flashModel.baseUrl = origBase;
        }
    });

    it('6. Пакетная загрузка всего комплекта («Скачать весь пакет (GPU + NPU)», downloadHalogenBundle) сохраняет веса всех 8 моделей в /MODELS/Local/*/#weights', async () => {
        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-halogen-bundle-'));
        try {
            const mockFetch = async (url) => {
                const u = String(url);
                if (u.includes('/api/models/peonist-ai/')) {
                    const isFlash = u.includes('halogen-qwen3.8-flash-next');
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: u.split('/api/models/')[1].split('?')[0],
                            pipeline_tag: 'text-generation',
                            siblings: [
                                { rfilename: 'config.json', size: 10 },
                                { rfilename: isFlash ? 'qwen38-flash-next-v2.hgn' : 'halogen-npu.hnpw', size: 16 },
                            ],
                        }),
                    };
                }
                if (u.includes('/resolve/main/')) {
                    const payload = Buffer.from(u.endsWith('config.json') ? '{"ok":true}' : 'HALOGEN_WEIGHTS!');
                    return {
                        ok: true,
                        status: 200,
                        headers: new Map([['content-length', String(payload.length)]]),
                        body: (async function* () {
                            yield payload;
                        })(),
                    };
                }
                throw new Error('Unexpected HF URL: ' + u);
            };

            const bundleRes = await downloadHalogenBundle({
                rootDir: tmpRoot,
                platform: 'linux',
                waitForCompletion: true,
                fetchImpl: mockFetch,
            });
            assert.equal(bundleRes.totalModels, 8, 'в пакет Linux входят все 8 моделей (1 GPU + 7 NPU)');
            assert.equal(bundleRes.startedCount, 8, 'запущены и завершены все 8 задач скачивания');
            assert.ok(bundleRes.jobs.every(j => j.status === 'completed' && j.progress === 100));

            const statusCatalog = inspectHalogenCatalogWithStatus(tmpRoot, { platform: 'linux' });
            assert.equal(statusCatalog.length, 8);
            for (const item of statusCatalog) {
                assert.equal(item.weightsDownloaded, true, `веса модели ${item.nodeName} скачаны в ${item.weightsDir}`);
                assert.ok(item.downloadedFiles.length >= 2, `в папке ${item.nodeName}/$ai/#weights лежат файлы весов и конфига`);
                const weightPath = path.join(tmpRoot, 'MODELS', 'Local', item.nodeName, '$ai', '#weights');
                assert.ok(fs.existsSync(path.join(weightPath, 'hf-manifest.json')));
            }

            // Проверим, что пустые/недокачанные папки (только с config.json без файла весов) не попадают в установленные модели и очищаются
            const { listLocalModelsAndAdapters } = await import('../sources/modules/trainer/runner.js');
            const ghostDir = path.join(tmpRoot, 'MODELS', 'Local', 'Ghost-Incomplete');
            await fsp.mkdir(path.join(ghostDir, '$ai', '#weights'), { recursive: true });
            await fsp.writeFile(path.join(ghostDir, '$ai', 'class.js'), 'export default {"label":"Ghost"};');
            await fsp.writeFile(path.join(ghostDir, '$ai', '#weights', 'config.json'), '{"ok":true}');

            const inv = await listLocalModelsAndAdapters(tmpRoot);
            assert.equal(inv.models.length, 8, 'В установленных числятся только 8 реально скачанных моделей');
            assert.ok(!inv.models.some(m => m.id === 'Ghost-Incomplete'), 'Недокачанная папка без бинарных весов не попадает в установленные');
            assert.equal(fs.existsSync(ghostDir), false, 'Пустой дубль без весов автоматически очищен');
        }
        finally {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('7. Нативный стек Windows 11 (Halowin Bubo / Gufo ROCm 10.0.0 gfx1151): диагностика окружения, подготовка рантайма и запуск bubo.exe serve llm', async () => {
        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-halogen-bubo-'));
        try {
            const buboBinDir = path.join(tmpRoot, 'MODELS', 'Local', '$provider', '#runtime', 'bubo', 'bin');
            const rocmDir = path.join(tmpRoot, 'MODELS', 'Local', '$provider', '#runtime', 'bubo', 'runtime', 'rocm-10.0.0-gfx1151');
            const weightsDir = path.join(tmpRoot, 'MODELS', 'Local', 'Qwen3.8-Flash-Next', '$ai', '#weights');
            await fsp.mkdir(buboBinDir, { recursive: true });
            await fsp.mkdir(rocmDir, { recursive: true });
            await fsp.mkdir(path.join(weightsDir, 'mtp'), { recursive: true });
            await fsp.mkdir(path.join(weightsDir, 'mmproj'), { recursive: true });
            await fsp.mkdir(path.join(weightsDir, 'twin'), { recursive: true });
            await fsp.mkdir(path.join(weightsDir, 'draft_head'), { recursive: true });

            const fakeBuboExe = path.join(buboBinDir, 'bubo.exe');
            const fakeShard1 = path.join(weightsDir, 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf');
            const fakeMtp = path.join(weightsDir, 'mtp', 'mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf');
            const fakeMmproj = path.join(weightsDir, 'mmproj', 'mmproj-Qwen3.8-Flash-Next-BF16.gguf');
            const fakeTwin = path.join(weightsDir, 'twin', 'iq4-nofullattn-nohc.gguf');
            const fakeDraftHead = path.join(weightsDir, 'draft_head', 'draft-out-q4k.gguf');
            await fsp.writeFile(fakeBuboExe, 'MZ_FAKE_BUBO');
            await fsp.writeFile(fakeShard1, 'GGUF_MAIN');
            await fsp.writeFile(fakeMtp, 'GGUF_MTP');
            await fsp.writeFile(fakeMmproj, 'GGUF_MMPROJ');
            await fsp.writeFile(fakeTwin, 'GGUF_TWIN');
            await fsp.writeFile(fakeDraftHead, 'GGUF_DRAFT');

            const envInfo = inspectWindowsHalogenEnvironment({ rootDir: tmpRoot });
            assert.equal(envInfo.buboInstalled, true);
            assert.equal(envInfo.buboExePath, fakeBuboExe);
            assert.equal(envInfo.rocmRuntimePrepared, true);
            assert.equal(envInfo.buboModelPrepared, true);
            assert.equal(envInfo.buboManifestPath, null);
            assert.equal(envInfo.buboRelease.version, BUBO_WINDOWS_RELEASE.version);

            // Проверка оркестрации prepareWindowsBuboRuntime (только движок в $provider/#runtime/bubo)
            const spawnedCmds = [];
            const mockSpawn = (cmd, args, opts) => {
                spawnedCmds.push({ cmd, args, opts });
                return {
                    pid: 42424,
                    stdout: { on: () => {} },
                    stderr: { on: () => {} },
                    on(ev, cb) {
                        if (ev === 'close')
                            setImmediate(() => cb(0));
                    },
                    unref: () => {},
                    kill: () => {},
                };
            };

            const prepRes = await prepareWindowsBuboRuntime({
                rootDir: tmpRoot,
                step: 'runtime',
                spawnImpl: mockSpawn,
            });
            assert.equal(prepRes.ok, true);
            assert.equal(spawnedCmds.length, 1);
            assert.equal(spawnedCmds[0].cmd, fakeBuboExe);
            assert.deepEqual(spawnedCmds[0].args.slice(0, 2), ['prepare', 'runtime']);

            // Проверка запуска bubo.exe serve llm через startHalogenBackend с прямыми путями к весам и sidecar-ам
            spawnedCmds.length = 0;
            const startRes = await startHalogenBackend({
                rootDir: tmpRoot,
                port: 59996,
                profile: 'subagents',
                spawnImpl: mockSpawn,
            });
            assert.equal(startRes.started, true);
            assert.equal(startRes.mode, 'bubo-windows');
            assert.equal(spawnedCmds.length, 1);
            assert.equal(spawnedCmds[0].cmd, fakeBuboExe);
            assert.ok(spawnedCmds[0].args.includes('serve'));
            assert.ok(spawnedCmds[0].args.includes('llm'));
            assert.ok(spawnedCmds[0].args.includes('--model'));
            assert.ok(spawnedCmds[0].args.includes(fakeShard1));
            assert.ok(spawnedCmds[0].args.includes('--mtp-model'));
            assert.ok(spawnedCmds[0].args.includes(fakeMtp));
            assert.ok(spawnedCmds[0].args.includes('--mmproj'));
            assert.ok(spawnedCmds[0].args.includes(fakeMmproj));
            assert.ok(spawnedCmds[0].args.includes('--twin-model'));
            assert.ok(spawnedCmds[0].args.includes(fakeTwin));
            assert.ok(spawnedCmds[0].args.includes('--draft-head-model'));
            assert.ok(spawnedCmds[0].args.includes(fakeDraftHead));
            assert.ok(spawnedCmds[0].args.includes('subagents'));
            assert.ok(!spawnedCmds[0].args.includes('--cache-disk'), 'без bubo-package.json флаг --cache-disk не передаётся');
            assert.ok(!spawnedCmds[0].args.includes('--manifest'), 'без bubo-package.json флаг --manifest не передаётся');
            assert.deepEqual(spawnedCmds[0].opts.stdio, ['ignore', 'pipe', 'pipe']);
            assert.equal(spawnedCmds[0].opts.env.BUBO_RUNTIME_DIR, rocmDir);

            stopHalogenBackend();

            // Если рядом с весами присутствует bubo-package.json — включаются и --manifest, и --cache-disk
            spawnedCmds.length = 0;
            const manifestPath = path.join(weightsDir, 'bubo-package.json');
            await fsp.writeFile(manifestPath, '{}');
            const startWithManifest = await startHalogenBackend({
                rootDir: tmpRoot,
                port: 59996,
                profile: 'subagents',
                spawnImpl: mockSpawn,
            });
            assert.equal(startWithManifest.started, true);
            assert.ok(spawnedCmds[0].args.includes('--manifest'));
            assert.ok(spawnedCmds[0].args.includes(manifestPath));
            assert.ok(spawnedCmds[0].args.includes('--cache-disk'));

            stopHalogenBackend();
        }
        finally {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('8. Разделение форматов по ОС: на Windows в комплекте Halo 8 совместимых моделей (Bubo + 7 .safetensors), парсер реестра видит 128 ГБ UMA, а preflight не блокирует загрузку', async () => {
        const winCatalog = getHalogenCatalogForPlatform('win32');
        assert.equal(winCatalog.length, 8, 'на Windows в комплекте Halo все 8 ролей: 1 Bubo + 7 совместимых .safetensors');
        assert.equal(winCatalog[0].nodeName, 'Qwen3.8-Flash-Next');
        assert.equal(winCatalog[0].hfRepo, 'unsloth/Qwen3.8-Flash-Next-GGUF');
        assert.equal(winCatalog[0].runtimeType, 'bubo');
        assert.ok(winCatalog.slice(1).every(m => m.runtimeType === 'local' && !/^peonist-ai\/halogen-/i.test(m.hfRepo)));

        const linuxCatalog = getHalogenCatalogForPlatform('linux');
        assert.equal(linuxCatalog.length, 8);

        // Проверка парсинга реестра Windows для AMD Radeon 8065S (128 ГБ REG_QWORD / REG_BINARY)
        const { parseWindowsVideoRegistry } = await import('../sources/modules/trainer/runner.js');
        const regQwordSample = [
            'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000',
            '    DriverDesc    REG_SZ    AMD Radeon(TM) 8065S Graphics',
            '    HardwareInformation.qwMemorySize    REG_QWORD    0x2000000000',
        ].join('\n');
        const parsedQw = parseWindowsVideoRegistry(regQwordSample);
        assert.equal(parsedQw.gpuName, 'AMD Radeon(TM) 8065S Graphics');
        assert.equal(parsedQw.vramGb, 128);

        const regBinSample = [
            'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000',
            '    DriverDesc    REG_SZ    AMD Radeon(TM) 8065S Graphics',
            '    HardwareInformation.qwMemorySize    REG_BINARY    0000000020000000',
        ].join('\n');
        const parsedBin = parseWindowsVideoRegistry(regBinSample);
        assert.equal(parsedBin.vramGb, 128);

        // На Windows в curated-поиске не должно быть peonist-ai/halogen-qwen3.8-flash-next
        const winSearch = await searchHuggingFaceModels({
            platform: 'win32',
            usableMemoryGb: 150,
            fetchImpl: null,
        });
        assert.ok(!winSearch.items.some(i => i.id === 'peonist-ai/halogen-qwen3.8-flash-next'));
        assert.ok(winSearch.items.some(i => i.id === 'unsloth/Qwen3.8-Flash-Next-GGUF'));

        const linuxSearch = await searchHuggingFaceModels({
            platform: 'linux',
            usableMemoryGb: 150,
            fetchImpl: null,
        });
        assert.ok(linuxSearch.items.some(i => i.id === 'peonist-ai/halogen-qwen3.8-flash-next'));

        // selectFilesToDownload для Linux .hgn берёт только v2 + ngram + drafter-r2 + vision + tokenizer (без w4b и ht43)
        const selectedLinuxHgn = selectFilesToDownload({
            files: [
                { name: 'qwen38-flash-next-w4b.hgn', kind: 'safetensors', size: 124e9 },
                { name: 'qwen38-flash-next-w4b.overlay.hgn', kind: 'safetensors', size: 2.5e9 },
                { name: 'qwen38-flash-next-ht43.hgn', kind: 'safetensors', size: 57e9 },
                { name: 'qwen38-flash-next-mtp.hgn', kind: 'safetensors', size: 1.5e9 },
                { name: 'qwen38-flash-next-v2.hgn', kind: 'safetensors', size: 66e9 },
                { name: 'qwen38-flash-next-ngram.hgn', kind: 'safetensors', size: 51e9 },
                { name: 'qwen38-flash-next-drafter-r2.hgn', kind: 'safetensors', size: 1.5e9 },
                { name: 'qwen38-flash-next-vision.hgn', kind: 'safetensors', size: 0.9e9 },
                { name: 'tokenizer.json', kind: 'config', size: 12e6 },
            ],
        });
        const names = selectedLinuxHgn.map(f => f.name);
        assert.ok(names.includes('qwen38-flash-next-v2.hgn'));
        assert.ok(names.includes('qwen38-flash-next-ngram.hgn'));
        assert.ok(names.includes('qwen38-flash-next-drafter-r2.hgn'));
        assert.ok(names.includes('qwen38-flash-next-vision.hgn'));
        assert.ok(names.includes('tokenizer.json'));
        assert.ok(!names.includes('qwen38-flash-next-w4b.hgn'));
        assert.ok(!names.includes('qwen38-flash-next-ht43.hgn'));

        // На Windows попытка скачать peonist-ai/halogen-qwen3.8-flash-next или .hgn сразу отклоняется
        await assert.rejects(
            () => startHuggingFaceDownload({
                repoId: 'peonist-ai/halogen-qwen3.8-flash-next',
                platform: 'win32',
            }),
            /не поддерживаются на Windows/i
        );

        // Preflight при 64 ГБ памяти возвращает предупреждение, но НЕ блокирует загрузку (ok: true)
        const preflightLowMem = checkWindowsHalogenPreflight({
            requiredDiskGb: 1,
            minTotalMemoryGb: 96,
            totalMemoryGb: 64,
        });
        assert.equal(preflightLowMem.ok, true);
        assert.ok(preflightLowMem.warnings.some(w => /64 ГБ общей памяти/.test(w)));
    });

    it('9. Честная диагностика при .hgn на Windows, отсутствие заглушки про .safetensors и автозапуск движка ensureHalogenBackendRunning', async () => {
        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-halogen-diag-'));
        const origCwd = process.cwd();
        try {
            const wDir = path.join(tmpRoot, 'MODELS', 'Local', 'Qwen3.8-Flash-Next', '$ai', '#weights');
            await fsp.mkdir(wDir, { recursive: true });
            await fsp.writeFile(path.join(wDir, 'qwen38-flash-next-v2.hgn'), Buffer.from('FAKE_HGN_BYTES'));
            await fsp.writeFile(path.join(wDir, 'tokenizer.json'), '{}');
            await fsp.writeFile(
                path.join(tmpRoot, 'MODELS', 'Local', 'Qwen3.8-Flash-Next', '$ai', 'class.js'),
                'export default {"label":"Qwen3.8-Flash-Next (180B MoE)","protocol":"halogen","model":"halogen-qwen3.8-flash-next","baseUrl":"http://127.0.0.1:59995/v1/chat/completions"};'
            );

            if (os.platform() === 'win32') {
                // На Windows .hgn не должен помечаться активным
                const act = evaluateAiNodeActivitySync({
                    id: 'Qwen3.8-Flash-Next',
                    type: '$ai',
                    path: '/MODELS/Local/Qwen3.8-Flash-Next',
                    DATA: { protocol: 'halogen' },
                }, tmpRoot);
                assert.equal(act.active, false);
                assert.equal(act.incompatibleOnPlatform, true);

                const inv = await listLocalModelsAndAdapters(tmpRoot);
                const item = inv.models.find(m => m.id === 'Qwen3.8-Flash-Next');
                assert.ok(item);
                assert.equal(item.incompatibleOnPlatform, true);
                assert.equal(item.active, false);

                // localStreamChat честно объясняет про .hgn, а не выводит ложную заглушку про .safetensors
                await assert.rejects(async () => {
                    for await (const _ of localStreamChat({
                        id: 'Qwen3.8-Flash-Next',
                        protocol: 'halogen',
                        baseUrl: 'http://127.0.0.1:59995/v1/chat/completions',
                        weightsDir: wDir,
                    }, { messages: [{ role: 'user', content: 'Привет' }] })) {
                        // noop
                    }
                }, /формата Linux \(\.hgn\/\.hnpw\)/i);

                const backendCheck = await ensureHalogenBackendRunning({
                    rootDir: tmpRoot,
                    baseUrl: 'http://127.0.0.1:59995/v1/chat/completions',
                    ai: { id: 'Qwen3.8-Flash-Next', weightsDir: wDir },
                    platform: 'win32',
                });
                assert.equal(backendCheck.ready, false);
                assert.equal(backendCheck.code, 'INCOMPATIBLE_FORMAT');
            }

            // Проверка автоподъёма ensureHalogenBackendRunning на живой mock-сервер
            const readyCheck = await ensureHalogenBackendRunning({
                rootDir: tmpRoot,
                baseUrl: `http://127.0.0.1:${mockPort}/v1/chat/completions`,
                ai: { id: 'Qwen3.8-Flash-Next' },
            });
            assert.equal(readyCheck.ready, true);
            assert.equal(readyCheck.alreadyRunning, true);
        }
        finally {
            process.chdir(origCwd);
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('10. Windows Qwen3.8-Flash-Next: качает 8 GGUF-файлов прямо в $ai/#weights (без MODELS/Local/models), чинит старый class.js и переносит хвосты 1.0.32', async () => {
        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-bubo-dl-'));
        try {
            const { startHuggingFaceDownload, QWEN_FLASH_NEXT_GGUF_FILES } = await import('../sources/modules/trainer/index.js');
            const { migrateLocalModelsLayoutSync, modelWeightsDir, modelClassFile } = await import('../sources/modules/trainer/paths.js');
            const { listLocalModelsAndAdapters } = await import('../sources/modules/trainer/runner.js');
            const customMock = QWEN_FLASH_NEXT_GGUF_FILES.slice(0, 2).map((f, idx) => ({
                ...f,
                destRelPath: idx === 0 ? 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf' : 'mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf',
                url: `https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/resolve/main/${idx === 0 ? 'shard1.gguf' : 'mtp-test.gguf'}`,
                size: 16,
            }));

            let finalized = false;
            const mockFetch = async () => {
                const payload = Buffer.from('0123456789ABCDEF');
                return {
                    ok: true,
                    status: 200,
                    headers: new Map([['content-length', String(payload.length)]]),
                    body: (async function* () { yield payload; })(),
                };
            };

            const job = await startHuggingFaceDownload({
                repoId: 'unsloth/Qwen3.8-Flash-Next-GGUF',
                customFiles: customMock,
                onComplete: async () => { finalized = true; },
                rootDir: tmpRoot,
                platform: 'win32',
                targetNodeName: 'Qwen3.8-Flash-Next',
                waitForCompletion: true,
                fetchImpl: mockFetch,
            });

            assert.equal(job.status, 'completed');
            assert.equal(job.progress, 100);
            assert.equal(finalized, true, 'после скачивания файлов вызвана установка движка');
            const canonicalWeights = modelWeightsDir(tmpRoot, 'Qwen3.8-Flash-Next', 'Local');
            assert.ok(fs.existsSync(path.join(canonicalWeights, 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf')));
            assert.ok(fs.existsSync(path.join(canonicalWeights, 'mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf')));
            assert.equal(fs.existsSync(path.join(tmpRoot, 'MODELS', 'Local', 'models')), false, 'папка MODELS/Local/models не создаётся');

            // Проверка авто-миграции из MODELS/Local/models/qwen38-* и авто-починки class.js
            const tmpMigr = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-bubo-migr-'));
            try {
                const legacyPkg = path.join(tmpMigr, 'MODELS', 'Local', 'models', 'qwen38-flash-next-base-ud-q4-k-xl-v1');
                await fsp.mkdir(path.join(legacyPkg, 'mtp'), { recursive: true });
                await fsp.writeFile(path.join(legacyPkg, 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf'), 'GGUF_MAIN_123456');
                await fsp.writeFile(path.join(legacyPkg, 'mtp', 'mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf'), 'GGUF_MTP_123456');
                const aiFile = modelClassFile(tmpMigr, 'Qwen3.8-Flash-Next', 'Local');
                await fsp.mkdir(path.dirname(aiFile), { recursive: true });
                await fsp.writeFile(aiFile, `export default ${JSON.stringify({
                    label: 'Qwen3.8-Flash-Next',
                    protocol: 'halogen',
                    weightsDir: 'MODELS/Local/models/qwen38-flash-next-base-ud-q4-k-xl-v1',
                    primaryFile: 'bubo-package.json',
                }, null, 4)};\n`);

                migrateLocalModelsLayoutSync(tmpMigr);
                const newW = modelWeightsDir(tmpMigr, 'Qwen3.8-Flash-Next', 'Local');
                assert.ok(fs.existsSync(path.join(newW, 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf')));
                assert.ok(fs.existsSync(path.join(newW, 'mtp', 'mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf')));
                assert.equal(fs.existsSync(path.join(tmpMigr, 'MODELS', 'Local', 'models')), false);

                const rawClass = await fsp.readFile(aiFile, 'utf-8');
                assert.ok(rawClass.includes('MODELS/Local/Qwen3.8-Flash-Next/$ai/#weights'));
                assert.ok(rawClass.includes('Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf'));
                assert.ok(!rawClass.includes('bubo-package.json'));

                const inv = await listLocalModelsAndAdapters(tmpMigr);
                const m = inv.models.find(x => x.id === 'Qwen3.8-Flash-Next');
                assert.ok(m, 'модель видна в установленных после переноса');
                assert.equal(m.weightFiles.length, 2, 'видны как основной шард, так и файл в подпапке mtp/');
                assert.equal(m.active, true);
            }
            finally {
                await fsp.rm(tmpMigr, { recursive: true, force: true });
            }
        }
        finally {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('11. Перехват stderr при падении bubo.exe (PROCESS_EXITED) и отказ от повторного круга в localStreamChat для halogen', async () => {
        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-bubo-err-'));
        try {
            const buboBinDir = path.join(tmpRoot, 'MODELS', 'Local', '$provider', '#runtime', 'bubo', 'bin');
            const weightsDir = path.join(tmpRoot, 'MODELS', 'Local', 'Qwen3.8-Flash-Next', '$ai', '#weights');
            await fsp.mkdir(buboBinDir, { recursive: true });
            await fsp.mkdir(weightsDir, { recursive: true });
            await fsp.writeFile(path.join(buboBinDir, 'bubo.exe'), 'MZ_FAKE_BUBO');
            await fsp.writeFile(path.join(weightsDir, 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf'), 'GGUF_MAIN');

            const makeExitSpawn = (stderrText, code = 1) => () => {
                const listeners = { exit: [], error: [] };
                const stderrListeners = [];
                const proc = {
                    pid: 51515,
                    killed: false,
                    stdout: { on: () => {} },
                    stderr: {
                        on(ev, cb) {
                            if (ev === 'data')
                                stderrListeners.push(cb);
                        },
                    },
                    on(ev, cb) {
                        if (listeners[ev])
                            listeners[ev].push(cb);
                    },
                    unref: () => {},
                    kill: () => { proc.killed = true; },
                };
                setImmediate(() => {
                    if (stderrText) {
                        for (const cb of stderrListeners)
                            cb(Buffer.from(stderrText, 'utf-8'));
                    }
                    for (const cb of listeners.exit)
                        cb(code, null);
                });
                return proc;
            };

            const failWithMsg = await ensureHalogenBackendRunning({
                rootDir: tmpRoot,
                baseUrl: 'http://127.0.0.1:59994/v1/chat/completions',
                ai: { id: 'Qwen3.8-Flash-Next', weightsDir },
                waitTimeoutMs: 5000,
                platform: 'win32',
                spawnImpl: makeExitSpawn('Error: failed to allocate GPU memory buffer\n', 1),
            });
            assert.equal(failWithMsg.ready, false);
            assert.equal(failWithMsg.code, 'PROCESS_EXITED');
            assert.equal(failWithMsg.exitCode, 1);
            assert.match(failWithMsg.reason, /код 1/);
            assert.match(failWithMsg.reason, /failed to allocate GPU memory buffer/);
            assert.ok(!/проверьте наличие VC\+\+ Redistributable/i.test(failWithMsg.reason), 'при наличии stderr не выводится ложная заглушка');

            const failSilent = await ensureHalogenBackendRunning({
                rootDir: tmpRoot,
                baseUrl: 'http://127.0.0.1:59994/v1/chat/completions',
                ai: { id: 'Qwen3.8-Flash-Next', weightsDir },
                waitTimeoutMs: 5000,
                platform: 'win32',
                spawnImpl: makeExitSpawn('', 2),
            });
            assert.equal(failSilent.ready, false);
            assert.equal(failSilent.code, 'PROCESS_EXITED');
            assert.equal(failSilent.exitCode, 2);
            assert.match(failSilent.reason, /код 2/);
            assert.match(failSilent.reason, /VC\+\+ Redistributable/);

            // streamChat для halogen-модели при ошибке ensureHalogenBackendRunning не проваливается в localStreamChat
            const flashModel = await WORK.get_item('/MODELS/Local/Qwen3.8-Flash-Next');
            await flashModel.init;
            const origBase = flashModel.baseUrl;
            const origEnsure = WORK.ensureHalogenBackendRunning;
            const origLocalStream = WORK.localStreamChat;
            let localCalled = 0;
            flashModel.baseUrl = 'http://127.0.0.1:59994/v1/chat/completions';
            WORK.ensureHalogenBackendRunning = async () => ({
                ready: false,
                code: 'PROCESS_EXITED',
                reason: 'Точная причина падения движка',
            });
            WORK.localStreamChat = async function* () {
                localCalled += 1;
                yield 'unexpected';
            };
            try {
                await assert.rejects(async () => {
                    for await (const _ of flashModel.streamChat({ messages: [{ role: 'user', content: 'Привет' }] })) {
                        // noop
                    }
                }, /Точная причина падения движка/);
                assert.equal(localCalled, 0, 'повторный вызов localStreamChat не выполняется');
            }
            finally {
                flashModel.baseUrl = origBase;
                WORK.ensureHalogenBackendRunning = origEnsure;
                WORK.localStreamChat = origLocalStream;
            }
        }
        finally {
            stopHalogenBackend();
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });
});
