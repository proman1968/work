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
    computeHalogenMemoryPlan,
    probeHalogenServer,
    normalizeHalogenTtsPayload,
    recordHalogenSessionHandle,
    listHalogenSessionHandles,
    releaseHalogenSessionHandle,
    inspectHalogenCatalogWithStatus,
    downloadHalogenBundle,
} from '../sources/modules/trainer/index.js';

describe('Гибридный провайдер /MODELS/Halogen (AMD Ryzen AI Max+ PRO 495 · 192 ГБ RAM: Linux + Windows 11 + WORK Fallback)', () => {
    let WORK;
    let mockServer;
    let mockPort = 0;
    const capturedRequests = [];

    before(async () => {
        const { $server } = await import('../sources/server/server.js');
        if (!globalThis.WORK)
            globalThis.WORK = new $server();
        WORK = globalThis.WORK;

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
        if (mockServer) {
            await new Promise(resolve => mockServer.close(resolve));
        }
    });

    it('1. Дерево /MODELS/Halogen содержит провайдер $provider и все 8 моделей (iGPU Flash + 7 NPU)', async () => {
        const provider = await WORK.get_item('/MODELS/Halogen');
        assert.ok(provider, 'узел /MODELS/Halogen существует');
        await provider.init;
        assert.equal(provider.type, '$provider');
        assert.equal(provider.protocol, 'halogen');

        const children = await provider.items;
        const childNames = children.map(c => c.id);
        for (const spec of HALOGEN_MODELS_CATALOG) {
            assert.ok(childNames.includes(spec.nodeName), `модель ${spec.nodeName} присутствует в /MODELS/Halogen`);
            const modelNode = await WORK.get_item(spec.path);
            await modelNode.init;
            assert.equal(modelNode.type, '$ai');
            assert.equal(modelNode.model, spec.model);
            assert.equal(modelNode.protocol, 'halogen');
        }

        // Представление form/trainer доступно на /MODELS/Halogen
        const handlers = await provider.handlers({ path: '//form', role: 'BOSS' });
        const viewIds = (handlers?.items || []).filter(i => i.usable !== false).map(i => i.id);
        assert.ok(viewIds.includes('trainer'), 'на /MODELS/Halogen доступна вкладка trainer');
    });

    it('2. План памяти computeHalogenMemoryPlan для AMD Ryzen AI Max+ PRO 495 (192 ГБ) размещает Flash + 524k KV + 47.7 ГБ Lookup + NPU в ОЗУ', () => {
        const plan192 = computeHalogenMemoryPlan({ totalRamGb: 192, platform: 'win32' });
        assert.equal(plan192.kvPoolPositions, 524288);
        assert.equal(plan192.kvSlots, 4);
        assert.equal(plan192.maxTok, 32768);
        assert.equal(plan192.flashWeightsGb, 62.1);
        assert.equal(plan192.deviceSideGb, 27.0);
        assert.equal(plan192.halogenCoreGb, 89.1);
        assert.equal(plan192.lookupTableGb, 47.7);
        assert.equal(plan192.lookupFitsInRam, true, 'на 192 ГБ вся 47.7 ГБ lookup-таблица помещается в ОЗУ вместе с NPU-моделями');
        assert.ok(plan192.npuSidecarGb >= 20, 'учтён объём всех 7 NPU-моделей');
        assert.ok(plan192.hostFreeForWorkGb >= 30, 'остаётся >30 ГБ свободной памяти под ОС и сервер WORK');
        assert.match(plan192.linuxCommand, /ghcr\.io\/peonist-ai\/halogen-flash-server:0\.19\.1/);
        assert.match(plan192.windowsCommand, /llama-server\.exe/);
        assert.match(plan192.windowsCommand, /--cache-reuse 256/);
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
        const flashModel = await WORK.get_item('/MODELS/Halogen/Qwen3.8-Flash-Next');
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
        const ttsModel = await WORK.get_item('/MODELS/Halogen/Qwen3-TTS-NPU');
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
        const sttModel = await WORK.get_item('/MODELS/Halogen/Qwen3-ASR-NPU');
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
        const imgModel = await WORK.get_item('/MODELS/Halogen/Flux2-Klein-NPU');
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

        const embModel = await WORK.get_item('/MODELS/Halogen/Qwen3-Embedding-NPU');
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

        const rerankModel = await WORK.get_item('/MODELS/Halogen/Qwen3-Reranker-NPU');
        await rerankModel.init;
        rerankModel.baseUrl = `http://127.0.0.1:${mockPort}/v1/rerank`;
        try {
            const rr = await rerankModel.rerank({ query: 'товары на складе', documents: ['Касса', 'Счёт 41 — Товары на складах'] });
            assert.equal(rr.results[0].index, 1);
        }
        finally {
            rerankModel.baseUrl = 'http://127.0.0.1:8731/v1/rerank';
        }

        const deciderModel = await WORK.get_item('/MODELS/Halogen/Decider-NPU');
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
        const ttsModel = await WORK.get_item('/MODELS/Halogen/Qwen3-TTS-NPU');
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
        const embModel = await WORK.get_item('/MODELS/Halogen/Qwen3-Embedding-NPU');
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

        const rerankModel = await WORK.get_item('/MODELS/Halogen/Qwen3-Reranker-NPU');
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

        const deciderModel = await WORK.get_item('/MODELS/Halogen/Decider-NPU');
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
        const flashModel = await WORK.get_item('/MODELS/Halogen/Qwen3.8-Flash-Next');
        await flashModel.init;
        const origBase = flashModel.baseUrl;
        flashModel.baseUrl = `http://127.0.0.1:${mockPort}/v1/chat/completions`;

        try {
            const llm = await llmFor('/MODELS/Halogen/Qwen3.8-Flash-Next');
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

    it('6. Пакетная загрузка всего комплекта («Скачать весь пакет (GPU + NPU)», downloadHalogenBundle) сохраняет веса всех 8 моделей в /MODELS/Halogen/*/#weights', async () => {
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
                const weightPath = path.join(tmpRoot, 'MODELS', 'Halogen', item.nodeName, '#weights');
                assert.ok(fs.existsSync(path.join(weightPath, 'hf-manifest.json')));
            }
        }
        finally {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        }
    });
});
