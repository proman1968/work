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
    computeHalogenMemoryPlan,
    inspectWindowsHalogenEnvironment,
    prepareWindowsBuboRuntime,
    startHalogenBackend,
    stopHalogenBackend,
    probeHalogenServer,
    normalizeHalogenTtsPayload,
    recordHalogenSessionHandle,
    listHalogenSessionHandles,
    releaseHalogenSessionHandle,
    ensureHalogenModelNodes,
    inspectHalogenCatalogWithStatus,
    downloadHalogenBundle,
} from '../sources/modules/trainer/index.js';

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
                waitForCompletion: true,
                fetchImpl: mockFetch,
            });
            assert.equal(bundleRes.totalModels, 8, 'в пакет входят все 8 моделей (1 GPU + 7 NPU)');
            assert.equal(bundleRes.startedCount, 8, 'запущены и завершены все 8 задач скачивания');
            assert.ok(bundleRes.jobs.every(j => j.status === 'completed' && j.progress === 100));

            const statusCatalog = inspectHalogenCatalogWithStatus(tmpRoot);
            assert.equal(statusCatalog.length, 8);
            for (const item of statusCatalog) {
                assert.equal(item.weightsDownloaded, true, `веса модели ${item.nodeName} скачаны в ${item.weightsDir}`);
                assert.ok(item.downloadedFiles.length >= 2, `в папке ${item.nodeName}/#weights лежат файлы весов и конфига`);
                const weightPath = path.join(tmpRoot, 'MODELS', 'Local', item.nodeName, '#weights');
                assert.ok(fs.existsSync(path.join(weightPath, 'hf-manifest.json')));
            }

            // Проверим, что пустые/недокачанные папки (только с config.json без файла весов) не попадают в установленные модели и очищаются
            const { listLocalModelsAndAdapters } = await import('../sources/modules/trainer/runner.js');
            const ghostDir = path.join(tmpRoot, 'MODELS', 'Local', 'Ghost-Incomplete');
            await fsp.mkdir(path.join(ghostDir, '$ai'), { recursive: true });
            await fsp.mkdir(path.join(ghostDir, '#weights'), { recursive: true });
            await fsp.writeFile(path.join(ghostDir, '$ai', 'class.js'), 'export default {"label":"Ghost"};');
            await fsp.writeFile(path.join(ghostDir, '#weights', 'config.json'), '{"ok":true}');

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
            const buboBinDir = path.join(tmpRoot, 'MODELS', 'Local', '#runtime', 'bubo', 'bin');
            const rocmDir = path.join(tmpRoot, 'MODELS', 'Local', '#runtime', 'bubo', 'runtime', 'rocm-10.0.0-gfx1151');
            const manifestDir = path.join(tmpRoot, 'MODELS', 'Local', 'models', 'qwen38-flash-next-base-ud-q4-k-xl-v1');
            await fsp.mkdir(buboBinDir, { recursive: true });
            await fsp.mkdir(rocmDir, { recursive: true });
            await fsp.mkdir(manifestDir, { recursive: true });

            const fakeBuboExe = path.join(buboBinDir, 'bubo.exe');
            const fakeManifest = path.join(manifestDir, 'bubo-package.json');
            await fsp.writeFile(fakeBuboExe, 'MZ_FAKE_BUBO');
            await fsp.writeFile(fakeManifest, JSON.stringify({ model: 'qwen38-flash-next-base-ud-q4-k-xl-v1' }));

            const envInfo = inspectWindowsHalogenEnvironment({ rootDir: tmpRoot });
            assert.equal(envInfo.buboInstalled, true);
            assert.equal(envInfo.buboExePath, fakeBuboExe);
            assert.equal(envInfo.rocmRuntimePrepared, true);
            assert.equal(envInfo.buboModelPrepared, true);
            assert.equal(envInfo.buboManifestPath, fakeManifest);
            assert.equal(envInfo.buboRelease.version, BUBO_WINDOWS_RELEASE.version);

            // Проверка оркестрации prepareWindowsBuboRuntime
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

            // Проверка запуска bubo.exe serve llm через startHalogenBackend
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
            assert.ok(spawnedCmds[0].args.includes('--manifest'));
            assert.ok(spawnedCmds[0].args.includes(fakeManifest));
            assert.ok(spawnedCmds[0].args.includes('subagents'));
            assert.equal(spawnedCmds[0].opts.env.BUBO_RUNTIME_DIR, rocmDir);

            stopHalogenBackend();
        }
        finally {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });
});
